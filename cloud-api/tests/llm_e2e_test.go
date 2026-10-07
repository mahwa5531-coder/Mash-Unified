// Package tests holds the integration suite for the LLM tunnel: the real
// proxy pipeline (entitlement → quota → rate limits → Bifrost → verbatim SSE
// passthrough → metering) against a scripted fake Bifrost, real Redis
// semantics (miniredis) and the real HTTP surface (api.Router + SSE framing).
//
// PostgreSQL is replaced by in-memory fakes at the repository seams;
// everything else is the production code path.
package tests

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/mash-cloud/mash-api/internal/api"
	"github.com/mash-cloud/mash-api/internal/auth"
	"github.com/mash-cloud/mash-api/internal/bifrost"
	"github.com/mash-cloud/mash-api/internal/config"
	"github.com/mash-cloud/mash-api/internal/domain"
	"github.com/mash-cloud/mash-api/internal/llm"
	"github.com/mash-cloud/mash-api/internal/middleware"
	"github.com/mash-cloud/mash-api/internal/observability"
	"github.com/mash-cloud/mash-api/internal/ratelimit"
	"github.com/mash-cloud/mash-api/internal/reqctx"
)

// ---- fake Bifrost ---------------------------------------------------------------

type scriptChunk struct {
	data string
	// optional delay before writing this chunk
	delay time.Duration
}

type fakeBifrost struct {
	srv *httptest.Server

	mu       sync.Mutex
	requests int
	canceled bool
	bodies   []string

	script     []scriptChunk
	scriptMode bool
	status     int // non-2xx → error path (0 = ok)
}

func newFakeBifrost(t *testing.T) *fakeBifrost {
	t.Helper()
	fb := &fakeBifrost{status: 0}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/chat/completions", func(w http.ResponseWriter, r *http.Request) {
		fb.mu.Lock()
		fb.requests++
		script := fb.script
		scriptMode := fb.scriptMode
		status := fb.status
		fb.bodies = append(fb.bodies, readBody(r))
		fb.mu.Unlock()

		if status != 0 {
			w.WriteHeader(status)
			_, _ = w.Write([]byte(`{"error":{"type":"upstream_error","code":"PROVIDER_500","message":"boom"}}`))
			return
		}
		if !scriptMode {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"cc_1","object":"chat.completion","created":1,"model":"openai/gpt-4o","choices":[{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":"hello"}}],"usage":{"prompt_tokens":12,"completion_tokens":5,"total_tokens":17}}`))
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		for _, sc := range script {
			if sc.delay > 0 {
				select {
				case <-r.Context().Done():
					fb.mu.Lock()
					fb.canceled = true
					fb.mu.Unlock()
					return
				case <-time.After(sc.delay):
				}
			}
			_, _ = fmt.Fprintf(w, "data: %s\n\n", sc.data)
			flusher.Flush()
		}
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
		flusher.Flush()
	})
	fb.srv = httptest.NewServer(mux)
	t.Cleanup(fb.srv.Close)
	return fb
}

func readBody(r *http.Request) string {
	b, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	return string(b)
}

func (fb *fakeBifrost) setScript(chunks ...scriptChunk) {
	fb.mu.Lock()
	defer fb.mu.Unlock()
	fb.scriptMode = true
	fb.script = chunks
	fb.status = 0
}

func (fb *fakeBifrost) setNonStream(status int) {
	fb.mu.Lock()
	defer fb.mu.Unlock()
	fb.scriptMode = false
	fb.status = status
}

func (fb *fakeBifrost) requestCount() int {
	fb.mu.Lock()
	defer fb.mu.Unlock()
	return fb.requests
}

func (fb *fakeBifrost) wasCanceled() bool {
	fb.mu.Lock()
	defer fb.mu.Unlock()
	return fb.canceled
}

func chunk(s string) scriptChunk { return scriptChunk{data: s} }

func finalChunk(s string) scriptChunk {
	return scriptChunk{data: s, delay: 10 * time.Millisecond}
}

// ---- fakes for the proxy seams ----------------------------------------------------

type fakeRecorder struct {
	mu    sync.Mutex
	calls []domain.LLMCall
}

func (f *fakeRecorder) Record(c domain.LLMCall) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, c)
}

func (f *fakeRecorder) recorded() []domain.LLMCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]domain.LLMCall, len(f.calls))
	copy(out, f.calls)
	return out
}

type fakeUsageQuery struct {
	mu       sync.Mutex
	used     map[string]int64 // 5h window position
	weekly   map[string]int64 // weekly window position
	recovers map[string]time.Time
}

func (f *fakeUsageQuery) WindowUsage(_ context.Context, tenantID string) (*domain.WindowUsage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return &domain.WindowUsage{Used5h: f.used[tenantID], UsedWeekly: f.weekly[tenantID]}, nil
}

func (f *fakeUsageQuery) WindowRecovery(_ context.Context, tenantID string, _ time.Duration, _, _ int64) (*time.Time, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if t, ok := f.recovers[tenantID]; ok {
		return &t, nil
	}
	return nil, nil
}

func (f *fakeUsageQuery) set(tenantID string, v int64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.used[tenantID] = v
}

func (f *fakeUsageQuery) setWeekly(tenantID string, v int64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.weekly[tenantID] = v
}

// ---- identity + env ------------------------------------------------------------

func testIdentity() *auth.Identity {
	return &auth.Identity{
		User:       auth.UserInfo{ID: "usr_t1", Email: "t@example.test", DisplayName: "T", Status: "active"},
		Tenant:     auth.TenantInfo{ID: "ten_t1", Slug: "t1", Name: "T1", Status: "active"},
		Membership: auth.MembershipInfo{Role: "owner", Status: "active"},
		Limits: auth.Limits{
			RequestsPerMinuteUser:    600,
			RequestsPerMinuteTenant:  6000,
			ConcurrentRequestsUser:   16,
			ConcurrentRequestsTenant: 256,
			Window5hTokens:           1_000_000,
			WindowWeeklyTokens:       10_000_000,
		},
		SubscriptionStatus: "active",
	}
}

type env struct {
	fb       *fakeBifrost
	mr       *miniredis.Miniredis
	recorder *fakeRecorder
	usage    *fakeUsageQuery
	proxy    *llm.Proxy
	limiter  *ratelimit.Limiter
}

func newEnv(t *testing.T) *env {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	fb := newFakeBifrost(t)
	metrics := observability.NewMetrics()
	limiter := ratelimit.New(rdb, true, metrics)
	recorder := &fakeRecorder{}
	usage := &fakeUsageQuery{used: map[string]int64{}, weekly: map[string]int64{}}

	bfClient := bifrost.NewClient(bifrost.TransportConfig{BaseURL: fb.srv.URL}, metrics)
	proxy := &llm.Proxy{
		Bifrost: bfClient, Meter: recorder, Limiter: limiter, Usage: usage, Metrics: metrics,
		Limits: llm.Limits{MaxMessages: 32, MaxTools: 16, MaxModelLen: 128},
		Rate:   llm.RateRules{RPMUser: 600, RPMTenant: 6000, ConcUser: 16, ConcTenant: 256},
		Timing: llm.Timing{
			IdleTimeout: 2 * time.Second, MaxDuration: 5 * time.Second,
			NonStreamTimeout: 5 * time.Second,
		},
		SlotTTL: time.Minute,
	}
	return &env{fb: fb, mr: mr, recorder: recorder, usage: usage, proxy: proxy, limiter: limiter}
}

func sampleRequest(stream bool) *llm.Request {
	return &llm.Request{
		Model:  "openai/gpt-4o",
		Stream: stream,
		Messages: []bifrost.Message{
			{Role: "user", Content: json.RawMessage(`"hi"`)},
		},
	}
}

// ---- sink ------------------------------------------------------------------------

type captureSink struct {
	mu       sync.Mutex
	chunks   []string
	errEvent string
	failAt   int // make SendChunk fail at the Nth write (0 = never)
	written  int
}

func (s *captureSink) SendChunk(raw []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failAt > 0 && s.written >= s.failAt {
		return fmt.Errorf("client went away")
	}
	s.written++
	s.chunks = append(s.chunks, string(raw))
	return nil
}

func (s *captureSink) SendError(errType, code, message string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.errEvent = code
	return nil
}

func (s *captureSink) Started() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.written > 0
}

func (s *captureSink) chunkList() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string{}, s.chunks...)
}

// ---- tests -------------------------------------------------------------------------

func TestStreamHappyPathForwardsVerbatimAndMeters(t *testing.T) {
	env := newEnv(t)
	idn := testIdentity()

	env.fb.setScript(
		chunk(`{"id":"c1","object":"chat.completion.chunk","model":"openai/gpt-4o","choices":[{"index":0,"delta":{"content":"he"}}]}`),
		chunk(`{"id":"c1","object":"chat.completion.chunk","model":"openai/gpt-4o","choices":[{"index":0,"delta":{"content":"llo"}}]}`),
		finalChunk(`{"id":"c1","object":"chat.completion.chunk","model":"openai/gpt-4o","choices":[{"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12,"cost":{"total_cost":0.0004}},"extra_fields":{"provider":"openai","resolved_model_used":"openai/gpt-4o"}}`),
	)

	sink := &captureSink{}
	ctx := reqctx.WithRequestID(context.Background(), "req_test_1")
	derr := env.proxy.Stream(ctx, idn, sampleRequest(true), sink)
	if derr != nil {
		t.Fatalf("stream: %v", derr)
	}
	got := sink.chunkList()
	if len(got) != 3 {
		t.Fatalf("chunks forwarded: %d want 3 (%v)", len(got), got)
	}
	if !strings.Contains(got[2], `"usage"`) {
		t.Fatalf("usage chunk not forwarded verbatim: %s", got[2])
	}

	calls := env.recorder.recorded()
	if len(calls) != 1 {
		t.Fatalf("metered calls: %d", len(calls))
	}
	c := calls[0]
	if c.Status != domain.CallCompleted || c.RequestedModel != "openai/gpt-4o" {
		t.Fatalf("call: %+v", c)
	}
	if c.Usage.TotalTokens != 12 || c.Usage.TotalCost != 0.0004 {
		t.Fatalf("usage: %+v", c.Usage)
	}
	if c.ResolvedModel != "openai/gpt-4o" || c.Provider != "openai" {
		t.Fatalf("resolved: %q provider: %q", c.ResolvedModel, c.Provider)
	}
	if c.TenantID != "ten_t1" || c.UserID != "usr_t1" || c.RequestID != "req_test_1" {
		t.Fatalf("attribution: %+v", c)
	}
	if c.CallID == "" || !strings.HasPrefix(c.CallID, "llm_") {
		t.Fatalf("call id: %q", c.CallID)
	}
}

func TestNonStreamHappyPathReturnsBodyAndMeters(t *testing.T) {
	env := newEnv(t)
	idn := testIdentity()
	env.fb.setNonStream(0)

	body, derr := env.proxy.Complete(context.Background(), idn, sampleRequest(false))
	if derr != nil {
		t.Fatalf("complete: %v", derr)
	}
	var parsed map[string]any
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatalf("body not valid JSON: %v", err)
	}
	if parsed["object"] != "chat.completion" {
		t.Fatalf("object: %v", parsed["object"])
	}
	calls := env.recorder.recorded()
	if len(calls) != 1 || calls[0].Status != domain.CallCompleted {
		t.Fatalf("metering: %+v", calls)
	}
	if calls[0].Usage.TotalTokens != 17 {
		t.Fatalf("usage: %+v", calls[0].Usage)
	}
}

func TestQuotaGateBlocksAtConsumptionPoint(t *testing.T) {
	env := newEnv(t)
	idn := testIdentity()
	idn.Limits.Window5hTokens = 1000
	idn.Limits.WindowWeeklyTokens = 10_000
	env.usage.set("ten_t1", 1000) // 5h window at quota
	recovery := time.Now().UTC().Add(2 * time.Hour)
	env.usage.recovers = map[string]time.Time{"ten_t1": recovery}

	derr := env.proxy.Stream(context.Background(), idn, sampleRequest(true), &captureSink{})
	if derr == nil || derr.Code != "WINDOW_QUOTA_EXCEEDED" {
		t.Fatalf("want WINDOW_QUOTA_EXCEEDED, got %v", derr)
	}
	if derr.Details["window"] != "5h" || derr.Details["quota_tokens"] != int64(1000) || derr.Details["used_tokens"] != int64(1000) {
		t.Fatalf("quota error details: %+v", derr.Details)
	}
	if derr.Details["resets_at"] != recovery.Format(time.RFC3339) {
		t.Fatalf("resets_at = %v, want %v", derr.Details["resets_at"], recovery)
	}
	if env.fb.requestCount() != 0 {
		t.Fatal("quota gate must block before the upstream call")
	}
	if len(env.recorder.recorded()) != 0 {
		t.Fatal("blocked calls must not be metered")
	}

	// One token under quota: admitted (the gate is >=, matching the display's
	// "100% exactly when rejected").
	env.usage.set("ten_t1", 999)
	env.fb.setScript(chunk(`{"id":"c","object":"chat.completion.chunk","model":"m","choices":[]}`))
	if derr := env.proxy.Stream(context.Background(), idn, sampleRequest(true), &captureSink{}); derr != nil {
		t.Fatalf("under quota must pass: %v", derr)
	}
}

// TestWeeklyWindowBlocksIndependently: the 7-day window binds even when the
// 5-hour window is fine — sustained spend is bounded separately from bursts.
func TestWeeklyWindowBlocksIndependently(t *testing.T) {
	env := newEnv(t)
	idn := testIdentity()
	idn.Limits.Window5hTokens = 1_000_000
	idn.Limits.WindowWeeklyTokens = 5000
	env.usage.set("ten_t1", 100)        // 5h: fine
	env.usage.setWeekly("ten_t1", 5000) // weekly: at quota

	derr := env.proxy.Stream(context.Background(), idn, sampleRequest(true), &captureSink{})
	if derr == nil || derr.Code != "WINDOW_QUOTA_EXCEEDED" {
		t.Fatalf("want WINDOW_QUOTA_EXCEEDED, got %v", derr)
	}
	if derr.Details["window"] != "weekly" {
		t.Fatalf("binding window: %+v", derr.Details)
	}
	if env.fb.requestCount() != 0 {
		t.Fatal("weekly gate must block before the upstream call")
	}
}

// TestNormalizationWeightsDriveMetering: token accounting is table-driven —
// the resolved rule's weights (not hardcoded constants) decide the metered
// values, raw provider numbers are preserved alongside, and cached tokens
// are discounted from the input.
func TestNormalizationWeightsDriveMetering(t *testing.T) {
	env := newEnv(t)
	idn := testIdentity()
	env.proxy.Norm = llm.NewRuleCache(staticRules{
		{Model: "openai/gpt-4o", InputWeight: 1, CachedReadWeight: 0.5, CachedWriteWeight: 1, OutputWeight: 0.5},
	}, time.Hour)

	env.fb.setScript(
		chunk(`{"id":"c1","object":"chat.completion.chunk","model":"openai/gpt-4o","choices":[{"index":0,"delta":{"content":"h"}}]}`),
		finalChunk(`{"id":"c1","object":"chat.completion.chunk","model":"openai/gpt-4o","choices":[{"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":100,"completion_tokens":10,"total_tokens":110,"prompt_tokens_details":{"cached_read_tokens":20,"cached_write_tokens":10},"cost":{"total_cost":0.002}}}`),
	)

	sink := &captureSink{}
	if derr := env.proxy.Stream(context.Background(), idn, sampleRequest(true), sink); derr != nil {
		t.Fatalf("stream: %v", derr)
	}
	calls := env.recorder.recorded()
	if len(calls) != 1 {
		t.Fatalf("metered calls: %d", len(calls))
	}
	u := calls[0].Usage
	// input  = round(100·1) − round(20·0.5) − round(10·1) = 100 − 10 − 10 = 80
	// output = round(10·0.5) = 5
	// total  = 85 (NOT the provider-reported 110)
	if u.InputTokens != 80 || u.OutputTokens != 5 || u.TotalTokens != 85 {
		t.Fatalf("normalized usage: %+v", u)
	}
	// Raw provider numbers preserved for audit.
	if u.RawPromptTokens != 100 || u.RawCompletionTokens != 10 {
		t.Fatalf("raw usage: %+v", u)
	}
	if u.CacheReadTokens != 20 || u.CacheWriteTokens != 10 {
		t.Fatalf("cache counts: %+v", u)
	}
	if u.TotalCost != 0.002 {
		t.Fatalf("cost: %+v", u)
	}
}

// TestNormalizationFloorAndDefault: cached tokens exceeding the prompt floor
// at zero (never negative, never free below zero), and the default rule gives
// the classic accounting (cache free, total = input + output).
func TestNormalizationFloorAndDefault(t *testing.T) {
	weird := &bifrost.Usage{
		PromptTokens: 30, CompletionTokens: 7, TotalTokens: 37,
		PromptTokensDetails: &bifrost.PromptTokensDetails{CachedReadTokens: 50},
	}
	got := llm.NormalizeUsage(weird, domain.DefaultNormRule)
	if got.InputTokens != 0 || got.OutputTokens != 7 || got.TotalTokens != 7 {
		t.Fatalf("floored usage: %+v", got)
	}
	if got.RawPromptTokens != 30 {
		t.Fatalf("raw prompt: %+v", got)
	}

	plain := &bifrost.Usage{PromptTokens: 12, CompletionTokens: 5, TotalTokens: 17}
	got2 := llm.NormalizeUsage(plain, domain.DefaultNormRule)
	if got2.InputTokens != 12 || got2.OutputTokens != 5 || got2.TotalTokens != 17 {
		t.Fatalf("default rule usage: %+v", got2)
	}
	if llm.NormalizeUsage(nil, domain.DefaultNormRule) != nil {
		t.Fatal("nil usage must stay nil")
	}
}

// staticRules is a fixed RuleSource (no DB).
type staticRules []domain.NormRule

func (s staticRules) All(context.Context) ([]domain.NormRule, error) { return s, nil }

func TestModelEntitlementBlocksOffAllowlist(t *testing.T) {
	env := newEnv(t)
	idn := testIdentity()
	idn.Restricted = true
	idn.Models = []string{"anthropic/*"}

	derr := env.proxy.Stream(context.Background(), idn, sampleRequest(true), &captureSink{})
	if derr == nil || derr.Code != "MODEL_NOT_ENTITLED" {
		t.Fatalf("want MODEL_NOT_ENTITLED, got %v", derr)
	}

	// Pattern match passes.
	req := sampleRequest(true)
	req.Model = "anthropic/claude-3-5-sonnet"
	env.fb.setScript(chunk(`{"id":"c","object":"chat.completion.chunk","model":"m","choices":[]}`))
	if derr := env.proxy.Stream(context.Background(), idn, req, &captureSink{}); derr != nil {
		t.Fatalf("allowlisted model must pass: %v", derr)
	}

	// Fallback bypass attempt: primary allowed, fallback not.
	req2 := sampleRequest(true)
	req2.Model = "anthropic/claude-3-5-sonnet"
	req2.Fallbacks = []string{"openai/gpt-4o"}
	if derr := env.proxy.Stream(context.Background(), idn, req2, &captureSink{}); derr == nil || derr.Code != "MODEL_NOT_ENTITLED" {
		t.Fatalf("fallback bypass must be blocked, got %v", derr)
	}
}

func TestSubscriptionInactiveBlocks(t *testing.T) {
	env := newEnv(t)
	idn := testIdentity()
	idn.SubscriptionStatus = "canceled"

	derr := env.proxy.Stream(context.Background(), idn, sampleRequest(true), &captureSink{})
	if derr == nil || derr.Code != "SUBSCRIPTION_INACTIVE" {
		t.Fatalf("want SUBSCRIPTION_INACTIVE, got %v", derr)
	}
}

func TestRPMLimitBlocksBeforeUpstream(t *testing.T) {
	env := newEnv(t)
	idn := testIdentity()
	idn.Limits.RequestsPerMinuteUser = 2 // tight per-plan limit

	for i := 0; i < 2; i++ {
		env.fb.setScript(chunk(`{"id":"c","object":"chat.completion.chunk","model":"m","choices":[]}`))
		if derr := env.proxy.Stream(context.Background(), idn, sampleRequest(true), &captureSink{}); derr != nil {
			t.Fatalf("call %d: %v", i, derr)
		}
	}
	env.fb.setScript(chunk(`{"id":"c","object":"chat.completion.chunk","model":"m","choices":[]}`))
	derr := env.proxy.Stream(context.Background(), idn, sampleRequest(true), &captureSink{})
	if derr == nil || derr.Code != "RATE_LIMITED" {
		t.Fatalf("want RATE_LIMITED, got %v", derr)
	}
	if derr.Details["scope"] != "llm_rpm" {
		t.Fatalf("scope: %v", derr.Details)
	}
	if retry, ok := derr.Details["retry_after_ms"].(int64); !ok || retry <= 0 {
		t.Fatalf("retry_after_ms: %v", derr.Details["retry_after_ms"])
	}
}

func TestConcurrencyLimitBlocksAndReleases(t *testing.T) {
	env := newEnv(t)
	idn := testIdentity()
	idn.Limits.ConcurrentRequestsUser = 1

	env.fb.setScript(
		chunk(`{"id":"c1","object":"chat.completion.chunk","model":"m","choices":[{"index":0,"delta":{"content":"a"}}]}`),
		finalChunk(`{"id":"c1","object":"chat.completion.chunk","model":"m","choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`),
	)

	// Hold the single slot open with a sink that blocks in SendChunk.
	unblock := make(chan struct{})
	sink := &blockingSink{unblock: unblock}
	go func() {
		_ = env.proxy.Stream(context.Background(), idn, sampleRequest(true), sink)
	}()

	// Wait until the first stream reached the upstream (slot held).
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if env.fb.requestCount() >= 1 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}

	derr := env.proxy.Stream(context.Background(), idn, sampleRequest(true), &captureSink{})
	if derr == nil || derr.Code != "CONCURRENCY_LIMIT" {
		t.Fatalf("want CONCURRENCY_LIMIT, got %v", derr)
	}

	close(unblock) // release the first stream
	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if len(env.recorder.recorded()) >= 1 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	// The slot must be free again: the next call passes the concurrency gate.
	env.fb.setScript(chunk(`{"id":"c2","object":"chat.completion.chunk","model":"m","choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`))
	if derr := env.proxy.Stream(context.Background(), idn, sampleRequest(true), &captureSink{}); derr != nil {
		t.Fatalf("slot not released after stream end: %v", derr)
	}
}

type blockingSink struct {
	unblock chan struct{}
	started bool
}

func (s *blockingSink) SendChunk(raw []byte) error {
	if !s.started {
		s.started = true
		<-s.unblock // hold the stream open
	}
	return nil
}
func (s *blockingSink) SendError(errType, code, message string) error { return nil }
func (s *blockingSink) Started() bool                                 { return s.started }

func TestClientDisconnectCancelsUpstreamAndMetersCancelled(t *testing.T) {
	env := newEnv(t)
	idn := testIdentity()

	// The second chunk is delayed long enough that the client disconnect
	// lands while the upstream is still producing.
	env.fb.setScript(
		chunk(`{"id":"c1","object":"chat.completion.chunk","model":"m","choices":[{"index":0,"delta":{"content":"a"}}]}`),
		scriptChunk{data: `{"id":"c1","object":"chat.completion.chunk","model":"m","choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`, delay: 2 * time.Second},
	)

	ctx, cancel := context.WithCancel(context.Background())
	sink := &captureSink{failAt: 1} // client stops reading after the first chunk

	go func() {
		time.Sleep(100 * time.Millisecond)
		cancel() // client disconnects
	}()

	derr := env.proxy.Stream(ctx, idn, sampleRequest(true), sink)
	if derr != nil {
		t.Fatalf("client disconnect must not surface as an upstream error: %v", derr)
	}

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if env.fb.wasCanceled() {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !env.fb.wasCanceled() {
		t.Fatal("upstream request must be canceled on client disconnect")
	}

	calls := env.recorder.recorded()
	if len(calls) != 1 {
		t.Fatalf("metered: %d", len(calls))
	}
	if calls[0].Status != domain.CallCancelled {
		t.Fatalf("status: %s want cancelled", calls[0].Status)
	}
}

func TestUpstreamPreStreamFailureIsHTTPError(t *testing.T) {
	env := newEnv(t)
	idn := testIdentity()
	env.fb.setNonStream(500)

	sink := &captureSink{}
	derr := env.proxy.Stream(context.Background(), idn, sampleRequest(true), sink)
	if derr == nil {
		t.Fatal("upstream 500 must surface")
	}
	if sink.Started() {
		t.Fatal("nothing may be forwarded pre-first-byte on upstream failure")
	}
	calls := env.recorder.recorded()
	if len(calls) != 1 || calls[0].Status != domain.CallFailed {
		t.Fatalf("metering: %+v", calls)
	}
}

func TestUpstreamMidStreamFailureEmitsInBandError(t *testing.T) {
	env := newEnv(t)
	idn := testIdentity()

	// A server that sends one good SSE chunk then closes the connection
	// abruptly (truncation without [DONE]).
	trunc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"id\":\"c1\",\"object\":\"chat.completion.chunk\",\"model\":\"m\",\"choices\":[]}\n\n"))
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		conn, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			return
		}
		_ = conn.Close()
	}))
	defer trunc.Close()

	metrics := observability.NewMetrics()
	env.proxy.Bifrost = bifrost.NewClient(bifrost.TransportConfig{BaseURL: trunc.URL}, metrics)

	sink := &captureSink{}
	derr := env.proxy.Stream(context.Background(), idn, sampleRequest(true), sink)
	if derr == nil {
		t.Fatal("mid-stream truncation must fail")
	}
	if !sink.Started() {
		t.Fatal("bytes already flowed — Started must be true")
	}
	if sink.errEvent == "" {
		t.Fatal("in-band OpenAI-style error event must be emitted after bytes flowed")
	}
	calls := env.recorder.recorded()
	if len(calls) != 1 || calls[0].Status != domain.CallFailed {
		t.Fatalf("metering: %+v", calls)
	}
}

func TestValidationRejectsBadPayloads(t *testing.T) {
	env := newEnv(t)
	idn := testIdentity()

	cases := []struct {
		name string
		req  *llm.Request
		want string
	}{
		{"no model", &llm.Request{Model: "", Messages: []bifrost.Message{{Role: "user", Content: json.RawMessage(`"x"`)}}}, "model is required"},
		{"bare model", &llm.Request{Model: "gpt-4o", Messages: []bifrost.Message{{Role: "user", Content: json.RawMessage(`"x"`)}}}, `model must be "provider/model"`},
		{"no messages", &llm.Request{Model: "openai/gpt-4o"}, "messages must not be empty"},
		{"bad role", &llm.Request{Model: "openai/gpt-4o", Messages: []bifrost.Message{{Role: "wizard", Content: json.RawMessage(`"x"`)}}}, "invalid role"},
		{"bad temperature", &llm.Request{Model: "openai/gpt-4o", Messages: []bifrost.Message{{Role: "user", Content: json.RawMessage(`"x"`)}}, Temperature: f64p(3)}, "temperature"},
	}
	for _, tc := range cases {
		derr := env.proxy.Stream(context.Background(), idn, tc.req, &captureSink{})
		if derr == nil || !strings.Contains(derr.Message, tc.want) {
			t.Fatalf("%s: want %q, got %v", tc.name, tc.want, derr)
		}
	}
	if env.fb.requestCount() != 0 {
		t.Fatal("validation must block before the upstream call")
	}
}

func f64p(v float64) *float64 { return &v }

// ---- HTTP-surface test (router + SSE framing + auth middleware) ------------------

// stubResolver resolves every subject to the test identity.
type stubResolver struct{ idn *auth.Identity }

func (s *stubResolver) Resolve(_ context.Context, _, _ string) (*auth.Identity, error) {
	return s.idn, nil
}

type stubVerifier struct{ signer *auth.LocalSigner }

func (s *stubVerifier) Verify(ctx context.Context, token string) (*auth.Claims, error) {
	return s.signer.Verify(ctx, token)
}

func TestHTTPEndpointSSEFramingAndAuth(t *testing.T) {
	env := newEnv(t)
	idn := testIdentity()

	cfg := &config.Config{
		TrustProxyHeaders:       true,
		StreamWriteDeadline:     2 * time.Second,
		StreamHeartbeatInterval: 500 * time.Millisecond,
		MaxBodyBytes:            2 << 20,
		MaxMessages:             32, MaxTools: 16, MaxModelLen: 128,
		StreamIdleTimeout: 2 * time.Second,
		StreamMaxDuration: 5 * time.Second,
	}
	signer := auth.NewLocalSigner("0123456789abcdef0123456789abcdef0123456789abcdef", "test-iss", "test-aud", 0, time.Hour)
	authMW := auth.Middleware{
		Verifier: &stubVerifier{signer: signer}, Resolver: &stubResolver{idn: idn},
		AuthTimeout: 2 * time.Second,
	}
	handler := api.New(cfg, &auth.Service{}, authMW, env.proxy, nil, nil, nil, nil, env.limiter, observability.NewMetrics(), nil, nil)

	tok, err := signer.Sign(idn.User.ID, idn.Tenant.ID, "owner", "", "jti_httptest", time.Now())
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	env.fb.setScript(
		chunk(`{"id":"c1","object":"chat.completion.chunk","model":"openai/gpt-4o","choices":[{"index":0,"delta":{"content":"hi"}}]}`),
		finalChunk(`{"id":"c1","object":"chat.completion.chunk","model":"openai/gpt-4o","choices":[{"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}`),
	)

	srv := httptest.NewServer(middleware.Chain(middleware.Options{MaxBodyBytes: cfg.MaxBodyBytes, MaxInFlight: 64}, observability.NewMetrics())(handler.Router()))
	defer srv.Close()

	// Unauthenticated → 401.
	resp, err := http.Post(srv.URL+"/v1/chat/completions", "application/json", strings.NewReader(`{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}]}`))
	if err != nil {
		t.Fatalf("unauth post: %v", err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status: %d", resp.StatusCode)
	}

	// Authenticated stream: SSE framing with [DONE] terminator.
	body := `{"model":"openai/gpt-4o","stream":true,"messages":[{"role":"user","content":"hi"}]}`
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+tok)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status: %d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Fatalf("content-type: %s", ct)
	}

	outBytes, _ := io.ReadAll(resp.Body)
	out := string(outBytes)
	if !strings.Contains(out, "data: {\"id\":\"c1\"") {
		t.Fatalf("SSE data frames missing: %s", out)
	}
	if !strings.Contains(out, "data: [DONE]") {
		t.Fatalf("[DONE] terminator missing: %s", out)
	}

	// The old agent surface is gone: 404, not 405/401.
	req2, _ := http.NewRequest(http.MethodPost, srv.URL+"/v1/agent/sessions", strings.NewReader(`{}`))
	req2.Header.Set("Authorization", "Bearer "+tok)
	resp2, err := http.DefaultClient.Do(req2)
	if err != nil {
		t.Fatalf("old route probe: %v", err)
	}
	_ = resp2.Body.Close()
	if resp2.StatusCode != http.StatusNotFound {
		t.Fatalf("old agent route must 404, got %d", resp2.StatusCode)
	}
}
