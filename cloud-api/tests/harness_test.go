// Package tests holds the end-to-end integration suite: fake desktop →
// real API stack (auth, validation, rate limits, idempotency, agent service,
// event bus, SSE transport) → mock Bifrost emitting scripted SSE chunks.
//
// PostgreSQL is replaced by in-memory fakes at the repository interface
// seam; Redis is real (miniredis); everything else is the production code
// path. The suite proves incremental forwarding, cancellation propagation,
// clean error termination, tenant isolation and exactly-once metering.
package tests

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/nexau-cloud/nexau-api/internal/agent"
	"github.com/nexau-cloud/nexau-api/internal/api"
	"github.com/nexau-cloud/nexau-api/internal/auth"
	"github.com/nexau-cloud/nexau-api/internal/bifrost"
	"github.com/nexau-cloud/nexau-api/internal/config"
	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/idempotency"
	"github.com/nexau-cloud/nexau-api/internal/metering"
	"github.com/nexau-cloud/nexau-api/internal/middleware"
	"github.com/nexau-cloud/nexau-api/internal/observability"
	"github.com/nexau-cloud/nexau-api/internal/ratelimit"
	"github.com/nexau-cloud/nexau-api/internal/streaming"
)

// fakeBifrost is a scripted upstream: it emits SSE chunks with configurable
// pacing and observes request receipt and upstream cancellation.
type fakeBifrost struct {
	srv *httptest.Server

	mu       sync.Mutex
	requests int
	canceled bool

	script []scriptChunk
}

type scriptChunk struct {
	data  string
	delay time.Duration // wait BEFORE emitting this chunk
}

// sentinelClose drops the upstream connection when reached in a script.
const sentinelClose = "\x00CLOSE"

func newFakeBifrost(t *testing.T) *fakeBifrost {
	fb := &fakeBifrost{}
	fb.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fb.mu.Lock()
		fb.requests++
		fb.canceled = false
		script := append([]scriptChunk(nil), fb.script...)
		fb.mu.Unlock()

		if r.Header.Get("Accept") != "text/event-stream" {
			// Non-stream completion: single JSON body.
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"cmpl_1","object":"chat.completion","created":1,"model":"openai/gpt-4o","choices":[{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":"Revenue is up 12%"}}],"usage":{"prompt_tokens":50,"completion_tokens":10,"total_tokens":60},"extra_fields":{"provider":"openai","model_deployment":"gpt-4o-2024","latency_ms":42}}`))
			return
		}

		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		flusher.Flush()

		for _, c := range script {
			select {
			case <-r.Context().Done():
				fb.mu.Lock()
				fb.canceled = true
				fb.mu.Unlock()
				return
			case <-time.After(c.delay):
			}
			if c.data == sentinelClose {
				// True connection drop: return WITHOUT [DONE] — the raw TCP
				// stream terminates mid-flight.
				return
			}
			fmt.Fprintf(w, "data: %s\n\n", c.data)
			flusher.Flush()
		}
		// Drain-and-hold: keep the stream open so late behavior (cancellation,
		// disconnect) is observable unless the script itself terminates.
		<-r.Context().Done()
		fb.mu.Lock()
		fb.canceled = true
		fb.mu.Unlock()
	}))
	t.Cleanup(fb.srv.Close)
	return fb
}

func (fb *fakeBifrost) setScript(chunks ...scriptChunk) {
	fb.mu.Lock()
	fb.script = chunks
	fb.mu.Unlock()
}

func (fb *fakeBifrost) count() int {
	fb.mu.Lock()
	defer fb.mu.Unlock()
	return fb.requests
}

func (fb *fakeBifrost) wasCanceled() bool {
	fb.mu.Lock()
	defer fb.mu.Unlock()
	return fb.canceled
}

// standardScript returns a 4-chunk assistant completion with tool call,
// usage in the final chunk (Bifrost standardization).
func standardScript() []scriptChunk {
	return []scriptChunk{
		{data: `{"id":"cmpl_1","object":"chat.completion.chunk","model":"openai/gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":"Revenue"}}]}`, delay: 30 * time.Millisecond},
		{data: `{"id":"cmpl_1","choices":[{"index":0,"delta":{"content":" is up"}}]}`, delay: 150 * time.Millisecond},
		{data: `{"id":"cmpl_1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"tcall_1","type":"function","function":{"name":"read_excel","arguments":"{}"}}]}}]}`, delay: 150 * time.Millisecond},
		{data: `{"id":"cmpl_1","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":100,"completion_tokens":40,"total_tokens":140,"prompt_tokens_details":{"cached_read_tokens":20},"cost":{"input_tokens_cost":0.001,"output_tokens_cost":0.002,"total_cost":0.003}},"extra_fields":{"provider":"openai","model_deployment":"gpt-4o-2024","latency_ms":321}}`, delay: 150 * time.Millisecond},
		{data: `{"id":"cmpl_1","choices":[{"index":0,"delta":{}}]}`, delay: 10 * time.Millisecond},
		{data: `[DONE]`, delay: 0},
	}
}

// --- in-memory stores --------------------------------------------------------

type fakeSessions struct {
	mu   sync.Mutex
	byID map[string]*domain.Session
}

func newFakeSessions() *fakeSessions { return &fakeSessions{byID: map[string]*domain.Session{}} }

func (f *fakeSessions) Create(_ context.Context, s *domain.Session) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.byID[s.ID] = s
	return nil
}

func (f *fakeSessions) Get(_ context.Context, tenantID, id string) (*domain.Session, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	s, ok := f.byID[id]
	if !ok || s.TenantID != tenantID {
		return nil, nil // not found — tenant isolation at the seam
	}
	return s, nil
}

func (f *fakeSessions) TouchSession(_ context.Context, _, _ string, _ time.Duration) error {
	return nil
}
func (f *fakeSessions) Close(_ context.Context, _, _ string) error { return nil }

type fakeRuns struct {
	mu     sync.Mutex
	byID   map[string]*domain.Run
	byIdem map[string]*domain.Run
}

func newFakeRuns() *fakeRuns {
	return &fakeRuns{byID: map[string]*domain.Run{}, byIdem: map[string]*domain.Run{}}
}

func (f *fakeRuns) Create(_ context.Context, run *domain.Run) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if run.IdempotencyKey != "" {
		if _, exists := f.byIdem[run.TenantID+"\x00"+run.UserID+"\x00"+run.IdempotencyKey]; exists {
			return &uniqueViolation{}
		}
		f.byIdem[run.TenantID+"\x00"+run.UserID+"\x00"+run.IdempotencyKey] = run
	}
	f.byID[run.ID] = run
	return nil
}

func (f *fakeRuns) Get(_ context.Context, tenantID, id string) (*domain.Run, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	r, ok := f.byID[id]
	if !ok || r.TenantID != tenantID {
		return nil, nil
	}
	// SNAPSHOT copy, mirroring pgx row scanning (which never aliases
	// server-side state). The 2026-09-18 post-mortem audit run surfaced
	// this gap via the race detector: CancelRun's optimistic local
	// mutation of the returned run raced the producer's authoritative
	// Complete() on the shared pointer. With pgx (the real repo) Get is
	// always a fresh row scan, so the production path never aliases.
	cp := *r
	return &cp, nil
}

func (f *fakeRuns) GetByIdempotencyKey(_ context.Context, tenantID, userID, key string) (*domain.Run, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.byIdem[tenantID+"\x00"+userID+"\x00"+key], nil
}

func (f *fakeRuns) Complete(_ context.Context, tenantID, runID, status, errorCode, errorMessage, cancelReason, cancelBy, resolvedModel, provider string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	r, ok := f.byID[runID]
	if !ok || r.TenantID != tenantID {
		return false, nil
	}
	if r.Status != domain.RunRunning {
		return false, nil // exactly-once: second terminal write is a no-op
	}
	r.Status = status
	r.ErrorCode = errorCode
	r.ErrorMessage = errorMessage
	r.CancelReason = cancelReason
	r.CancelBy = cancelBy
	r.ResolvedModel = resolvedModel
	r.Provider = provider
	now := time.Now().UTC()
	r.CompletedAt = &now
	return true, nil
}

func (f *fakeRuns) SetFirstEvent(_ context.Context, _, _ string) error { return nil }
func (f *fakeRuns) SetRunning(_ context.Context, _, _ string) error    { return nil }
func (f *fakeRuns) CountRunning(_ context.Context, _, _ string) (int, error) {
	return 0, nil
}

// get returns a SNAPSHOT copy — mirroring pgx row scanning, which never
// aliases server-side state (and keeping the test race-detector-clean).
func (f *fakeRuns) get(id string) *domain.Run {
	f.mu.Lock()
	defer f.mu.Unlock()
	r, ok := f.byID[id]
	if !ok {
		return nil
	}
	clone := *r
	return &clone
}

type uniqueViolation struct{}

func (u *uniqueViolation) Error() string    { return "unique violation (23505)" }
func (u *uniqueViolation) SQLState() string { return "23505" }

type fakeUsageWriter struct {
	mu   sync.Mutex
	recs []domain.UsageRecord
}

func (f *fakeUsageWriter) InsertUsageRecords(_ context.Context, recs []domain.UsageRecord) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.recs = append(f.recs, recs...)
	return nil
}

func (f *fakeUsageWriter) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.recs)
}

func (f *fakeUsageWriter) total() domain.TokenUsage {
	f.mu.Lock()
	defer f.mu.Unlock()
	var t domain.TokenUsage
	for _, r := range f.recs {
		t = t.Add(r.Usage)
	}
	return t
}

// stubResolver returns a fixed healthy identity (test tenancy).
type stubResolver struct {
	idn *auth.Identity
}

func (s *stubResolver) Resolve(_ context.Context, _, _ string) (*auth.Identity, error) {
	return s.idn, nil
}

// harness wires the full production stack.
type harness struct {
	t        *testing.T
	srv      *httptest.Server
	bifrost  *fakeBifrost
	sessions *fakeSessions
	runs     *fakeRuns
	usage    *fakeUsageWriter
	meter    *metering.Recorder
	mr       *miniredis.Miniredis
	signer   *auth.LocalSigner
	token    string
	cfg      *config.Config
	mgr      *agent.Manager
}

func newHarness(t *testing.T) *harness {
	t.Helper()

	fb := newFakeBifrost(t)
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	cfg := &config.Config{
		MaxBodyBytes:        2 << 20,
		MaxMessages:         256,
		MaxTools:            128,
		MaxModelLen:         256,
		WSHeartbeatInterval: 50 * time.Millisecond,
		WSWriteWait:         2 * time.Second,
		WSMaxMessageSize:    512 << 10,
		WSSendQueue:         64,
		WSSlowConsumerGrace: 500 * time.Millisecond,
		WSIdleTimeout:       30 * time.Second,
		StreamIdleTimeout:   2 * time.Second,
		StreamMaxDuration:   30 * time.Second,
		AuthTimeout:         2 * time.Second,
		AllowedOrigins:      nil,
		Auth: config.AuthConfig{
			Mode: "local", LoginEnabled: false,
			Issuer: "https://auth.nexau.test", Audience: "nexau-cloud-api-test",
		},
		Bifrost: config.BifrostConfig{BaseURL: fb.srv.URL},
		Rate: config.RateLimitConfig{
			RequestsPerMinuteUser: 1000, RequestsPerMinuteTenant: 10000,
			ConcurrentRunsUser: 100, ConcurrentRunsTenant: 1000,
			RunConcurrencyTimeout: time.Minute,
		},
		Replay:         config.ReplayConfig{MaxEventsPerRun: 2048, Window: 5 * time.Minute},
		Meter:          config.MeterConfig{QueueSize: 256, BatchSize: 8, FlushInterval: 20 * time.Millisecond, RetryMax: 1},
		IdempotencyTTL: time.Hour,
		SessionIdleTTL: time.Hour,
	}

	metrics := observability.NewMetrics()

	sessions := newFakeSessions()
	runs := newFakeRuns()
	usageW := &fakeUsageWriter{}
	meter := metering.New(usageW, metering.Config{QueueSize: cfg.Meter.QueueSize, BatchSize: cfg.Meter.BatchSize, FlushInterval: cfg.Meter.FlushInterval, RetryMax: cfg.Meter.RetryMax}, metrics)
	t.Cleanup(func() { meter.Close(2 * time.Second) })

	bus := streaming.NewBus(rdb, streaming.Config{MaxEventsPerRun: cfg.Replay.MaxEventsPerRun, Window: cfg.Replay.Window})
	limiter := ratelimit.New(rdb, true, metrics)
	idem := idempotency.New(rdb, cfg.IdempotencyTTL)
	bfClient := bifrost.NewClient(bifrost.TransportConfig{BaseURL: fb.srv.URL, MaxRetries: 0}, metrics)

	mgr := agent.NewManager(rdb, limiter, cfg.Rate.RunConcurrencyTimeout, metrics)
	runSvc := agent.NewService(agent.Config{
		Sessions: sessions, Runs: runs, Bifrost: bfClient, Bus: bus,
		Meter: meter, Idem: idem, Manager: mgr, Limiter: limiter,
		Limits: agent.Limits{MaxMessages: cfg.MaxMessages, MaxTools: cfg.MaxTools, MaxModelLen: cfg.MaxModelLen},
		Rate: agent.RateRules{
			RPMUser: cfg.Rate.RequestsPerMinuteUser, RPMTenant: cfg.Rate.RequestsPerMinuteTenant,
			ConcUser: cfg.Rate.ConcurrentRunsUser, ConcTenant: cfg.Rate.ConcurrentRunsTenant,
		},
		Timing:       agent.StreamTiming{IdleTimeout: cfg.StreamIdleTimeout, MaxDuration: cfg.StreamMaxDuration},
		SetupTimeout: 5 * time.Second,
		Metrics:      metrics,
	})
	sessSvc := agent.NewSessionService(sessions, cfg.SessionIdleTTL)

	signer := auth.NewLocalSigner(testSecret, cfg.Auth.Issuer, cfg.Auth.Audience, 0, time.Hour)
	idn := &auth.Identity{
		User:               auth.UserInfo{ID: "usr_1", Email: "dev@nexau.test", Status: "active"},
		Tenant:             auth.TenantInfo{ID: "ten_A", Slug: "acme", Status: "active"},
		Membership:         auth.MembershipInfo{Role: domain.RoleMember, Status: "active"},
		SubscriptionStatus: "active",
		Limits:             auth.Limits{MaxRequestBytes: 2 << 20},
	}
	authMW := auth.Middleware{
		Verifier: signer, Resolver: &stubResolver{idn: idn},
		AuthTimeout: cfg.AuthTimeout,
	}

	apiH := api.New(cfg, &auth.Service{}, authMW, sessSvc, runSvc, nil, nil, nil, nil, meter, limiter, metrics, nil, nil)
	chain := middleware.Chain(middleware.Options{
		MaxBodyBytes: cfg.MaxBodyBytes, MaxInFlight: 64, AllowedOrigins: cfg.AllowedOrigins,
	}, metrics)

	srv := httptest.NewServer(chain(apiH.Router()))
	t.Cleanup(srv.Close)

	token, err := signer.Sign("usr_1", "ten_A", "member", "", "jti_test", time.Now())
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	return &harness{
		t: t, srv: srv, bifrost: fb, sessions: sessions, runs: runs, usage: usageW,
		meter: meter, mr: mr, signer: signer, token: token, cfg: cfg, mgr: mgr,
	}
}

const testSecret = "0123456789abcdef0123456789abcdef0123456789abcdef"

// createSession opens a session for the harness identity.
func (h *harness) createSession() string {
	h.t.Helper()
	sess := &domain.Session{
		ID:       "sess_" + fmt.Sprintf("%d", time.Now().UnixNano()),
		TenantID: "ten_A", UserID: "usr_1", Status: domain.SessionActive,
	}
	if err := h.sessions.Create(context.Background(), sess); err != nil {
		h.t.Fatalf("session create: %v", err)
	}
	return sess.ID
}

// createForeignSession opens a session owned by tenant B / another user.
func (h *harness) createForeignSession() string {
	h.t.Helper()
	sess := &domain.Session{
		ID:       "sess_foreign_" + fmt.Sprintf("%d", time.Now().UnixNano()),
		TenantID: "ten_B", UserID: "usr_2", Status: domain.SessionActive,
	}
	_ = h.sessions.Create(context.Background(), sess)
	return sess.ID
}

// postRun issues a run-creation request; stream bodies are read by the caller.
func (h *harness) postRun(sessionID string, body string, extraHeaders map[string]string) (*http.Response, error) {
	h.t.Helper()
	req, err := http.NewRequest(http.MethodPost, h.srv.URL+"/v1/agent/sessions/"+sessionID+"/runs", strings.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+h.token)
	req.Header.Set("Content-Type", "application/json")
	for k, v := range extraHeaders {
		req.Header.Set(k, v)
	}
	return http.DefaultClient.Do(req)
}

// sseEvent is one parsed desktop-side event.
type sseEvent struct {
	env streaming.Envelope
	at  time.Time
}

// readSSE consumes the SSE stream until the terminal event or deadline.
func readSSE(t *testing.T, resp *http.Response, stopOn string, maxWait time.Duration) []sseEvent {
	t.Helper()
	defer resp.Body.Close()
	events := make(chan sseEvent, 128)
	go func() {
		buf := make([]byte, 64<<10)
		var carry []byte
		for {
			n, err := resp.Body.Read(buf)
			if n > 0 {
				carry = append(carry, buf[:n]...)
				for {
					idx := indexTerminator(carry)
					if idx < 0 {
						break
					}
					frame := string(carry[:idx])
					carry = carry[idx+2:]
					if line, ok := strings.CutPrefix(frame, "data: "); ok {
						env, derr := streaming.DecodeEnvelope([]byte(line))
						if derr == nil {
							events <- sseEvent{env: *env, at: time.Now()}
						}
					}
				}
			}
			if err != nil {
				close(events)
				return
			}
		}
	}()

	deadline := time.After(maxWait)
	var out []sseEvent
	for {
		select {
		case ev, ok := <-events:
			if !ok {
				return out
			}
			out = append(out, ev)
			if stopOn != "" && ev.env.Type == stopOn {
				return out
			}
		case <-deadline:
			return out
		}
	}
}

func indexTerminator(b []byte) int {
	for i := 0; i+1 < len(b); i++ {
		if b[i] == '\n' && b[i+1] == '\n' {
			return i
		}
	}
	return -1
}
