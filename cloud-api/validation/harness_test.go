// Package validation holds the NexaU Cloud API production validation and
// failure-test suite (spec: "Production Validation and Failure-Test
// Specification", sections 1–40).
//
// Test names follow TestV{NN}_ where NN is the spec section under test; the
// report generator (scripts/validation_report.py) maps that convention onto
// PASS / FAIL / DEGRADED / NOT TESTED per requirement.
//
// Environment (spec §2): the full production stack is assembled in-process —
// real middleware chain, real auth, real Redis semantics (miniredis), real
// agent pipeline, real SSE/WebSocket transports — against a scripted
// OpenAI-compatible mock Bifrost with fault injection. PostgreSQL is faked at
// the repository interface seam with fault-injectable decorators; every other
// byte of code on the request path is production code. The desktop side is
// driven by OpenAI-compatible HTTP/WebSocket/SSE clients (the NexAU desktop
// runtime itself is NOT run — the API contract is OpenAI-compatible, so a
// mock client exercises the exact wire shape).
//
// Every test emits VALMETRIC lines (t.Logf) that the report generator lifts
// into the performance section (spec §39).
package validation

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
	"log/slog"

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

// ---------------------------------------------------------------------------
// Spec §2: mock Bifrost — OpenAI-compatible upstream with fault injection.
// ---------------------------------------------------------------------------

type bifrostMode int

const (
	bifrostScript      bifrostMode = iota // scripted SSE chunks (default)
	bifrostHTTPStatus                     // immediate HTTP status + body
	bifrostHeaderStall                    // accept, stall before headers (response timeout)
	bifrostMalformed                      // SSE with non-JSON data lines
	bifrostInBandErr                      // 200 stream carrying an in-band BifrostError
	bifrostGarbageBody                    // error status with unparseable body
)

type chunk struct {
	data  string
	delay time.Duration // wait BEFORE emitting
}

// dropConn sentinel: terminate the raw TCP stream mid-flight (no [DONE]).
const dropConn = "\x00CLOSE"

type mockBifrost struct {
	srv    *httptest.Server
	apiKey string // the server-side credential the API must present

	mu         sync.Mutex
	script     []chunk
	scriptFn   func(n int) []chunk       // per-request script (multi-turn loops)
	bodyScript func(body string) []chunk // deterministic per-BODY script (mixed load)
	mode       bifrostMode
	status     int
	statusBody string
	stall      time.Duration

	requests int
	cancels  int
	bodies   []string
	auths    []string
	active   int
	peak     int

	// failFirst: the first N upstream requests receive failStatus (then the
	// script path resumes) — deterministic transient-failure injection.
	failFirst  int
	failStatus int
}

func newMockBifrost(t *testing.T, apiKey string) *mockBifrost {
	mb := &mockBifrost{apiKey: apiKey}
	mb.srv = httptest.NewServer(http.HandlerFunc(mb.serve))
	t.Cleanup(mb.srv.Close)
	return mb
}

func (mb *mockBifrost) serve(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 8<<20))

	mb.mu.Lock()
	mb.requests++
	mb.bodies = append(mb.bodies, string(body))
	mb.auths = append(mb.auths, r.Header.Get("Authorization"))
	mb.active++
	if mb.active > mb.peak {
		mb.peak = mb.active
	}
	mode, status, statusBody, stall := mb.mode, mb.status, mb.statusBody, mb.stall
	script := mb.script
	if mb.bodyScript != nil {
		script = mb.bodyScript(string(body))
	} else if mb.scriptFn != nil {
		script = mb.scriptFn(mb.requests)
	}
	failFirst, failStatus, idx := mb.failFirst, mb.failStatus, mb.requests
	mb.mu.Unlock()

	defer func() {
		mb.mu.Lock()
		mb.active--
		mb.mu.Unlock()
	}()

	if failFirst > 0 && idx <= failFirst {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(failStatus)
		_, _ = w.Write([]byte(bifrostErrBody(failStatus, fmt.Sprintf("%d", failStatus), "injected transient failure")))
		return
	}

	switch mode {
	case bifrostHTTPStatus, bifrostGarbageBody:
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(statusBody))
		return
	case bifrostHeaderStall:
		select {
		case <-time.After(stall):
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		case <-r.Context().Done():
			mb.noteCancel()
			return
		}
	}

	isStream := r.Header.Get("Accept") == "text/event-stream"

	if !isStream {
		// Non-streaming completion: single JSON body.
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(nonStreamBody))
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	flusher := w.(http.Flusher)
	flusher.Flush()

	if mode == bifrostMalformed {
		_, _ = fmt.Fprintf(w, "data: {this is not json\n\n")
		flusher.Flush()
		// Hold briefly so the client observes the malformed event, then drop.
		<-r.Context().Done()
		mb.noteCancel()
		return
	}
	if mode == bifrostInBandErr {
		_, _ = fmt.Fprintf(w, "data: %s\n\n", inBandErrChunk)
		flusher.Flush()
		<-r.Context().Done()
		mb.noteCancel()
		return
	}

	for _, c := range script {
		select {
		case <-r.Context().Done():
			mb.noteCancel()
			return
		case <-time.After(c.delay):
		}
		if c.data == dropConn {
			return // raw TCP termination mid-stream
		}
		_, _ = fmt.Fprintf(w, "data: %s\n\n", c.data)
		flusher.Flush()
	}
	// Drain-and-hold: keeps the upstream open so late cancellation is
	// observable; the API closes its reader after [DONE] which cancels us.
	<-r.Context().Done()
	mb.noteCancel()
}

func (mb *mockBifrost) noteCancel() {
	mb.mu.Lock()
	mb.cancels++
	mb.mu.Unlock()
}

func (mb *mockBifrost) setScript(chunks ...chunk) {
	mb.mu.Lock()
	mb.script = chunks
	mb.scriptFn = nil
	mb.mu.Unlock()
}

func (mb *mockBifrost) setScriptFn(fn func(n int) []chunk) {
	mb.mu.Lock()
	mb.scriptFn = fn
	mb.bodyScript = nil
	mb.mu.Unlock()
}

// setBodyScript selects the script per request by inspecting the request
// body — deterministic under arbitrary concurrency (mixed load legs).
func (mb *mockBifrost) setBodyScript(fn func(body string) []chunk) {
	mb.mu.Lock()
	mb.bodyScript = fn
	mb.scriptFn = nil
	mb.mu.Unlock()
}

func (mb *mockBifrost) setMode(m bifrostMode, status int, body string, stall time.Duration) {
	mb.mu.Lock()
	mb.mode, mb.status, mb.statusBody, mb.stall = m, status, body, stall
	mb.mu.Unlock()
}

func (mb *mockBifrost) setFailFirst(n, status int) {
	mb.mu.Lock()
	mb.failFirst, mb.failStatus = n, status
	mb.mu.Unlock()
}

func (mb *mockBifrost) reset() {
	mb.mu.Lock()
	mb.requests, mb.cancels, mb.peak, mb.active = 0, 0, 0, 0
	mb.bodies, mb.auths = nil, nil
	mb.scriptFn = nil
	mb.failFirst, mb.failStatus = 0, 0
	mb.mu.Unlock()
}

func (mb *mockBifrost) count() int {
	mb.mu.Lock()
	defer mb.mu.Unlock()
	return mb.requests
}

func (mb *mockBifrost) cancelCount() int {
	mb.mu.Lock()
	defer mb.mu.Unlock()
	return mb.cancels
}

func (mb *mockBifrost) lastBody() string {
	mb.mu.Lock()
	defer mb.mu.Unlock()
	if len(mb.bodies) == 0 {
		return ""
	}
	return mb.bodies[len(mb.bodies)-1]
}

func (mb *mockBifrost) lastAuth() string {
	mb.mu.Lock()
	defer mb.mu.Unlock()
	if len(mb.auths) == 0 {
		return ""
	}
	return mb.auths[len(mb.auths)-1]
}

const nonStreamBody = `{"id":"cmpl_1","object":"chat.completion","created":1,"model":"openai/gpt-4o","choices":[{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":"Revenue is up 12%"}}],"usage":{"prompt_tokens":50,"completion_tokens":10,"total_tokens":60},"extra_fields":{"provider":"openai","model_deployment":"gpt-4o-2024","latency_ms":42}}`

const inBandErrChunk = `{"id":"cmpl_x","object":"chat.completion.chunk","model":"openai/gpt-4o","type":"error","is_bifrost_error":true,"status_code":500,"error":{"type":"provider_error","code":"500","message":"provider exploded: org_7731 quota exceeded for key sk-live-9f3a"}}`

// standardScript: 4 content chunks + tool call + usage in final chunk.
func standardScript() []chunk {
	return []chunk{
		{data: `{"id":"cmpl_1","object":"chat.completion.chunk","model":"openai/gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":"Revenue"}}]}`, delay: 20 * time.Millisecond},
		{data: `{"id":"cmpl_1","choices":[{"index":0,"delta":{"content":" is up"}}]}`, delay: 60 * time.Millisecond},
		{data: `{"id":"cmpl_1","choices":[{"index":0,"delta":{"content":" 12%"}}]}`, delay: 60 * time.Millisecond},
		{data: `{"id":"cmpl_1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"tcall_1","type":"function","function":{"name":"read_excel","arguments":"{\"sheet\":\"Q3\"}"}}]}}]}`, delay: 60 * time.Millisecond},
		{data: `{"id":"cmpl_1","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":100,"completion_tokens":40,"total_tokens":140,"prompt_tokens_details":{"cached_read_tokens":20}},"extra_fields":{"provider":"openai","model_deployment":"gpt-4o-2024","latency_ms":321}}`, delay: 60 * time.Millisecond},
		{data: `[DONE]`, delay: 0},
	}
}

// bifrostErrBody builds a BifrostError JSON body for a status code.
func bifrostErrBody(status int, code, msg string) string {
	return fmt.Sprintf(`{"event_id":"evt_%d","type":"error","is_bifrost_error":true,"status_code":%d,"error":{"type":"gateway_error","code":"%s","message":"%s","param":""},"extra_fields":{"provider":"openai","model_requested":"openai/gpt-4o"}}`, status, status, code, msg)
}

// ---------------------------------------------------------------------------
// Fault-injectable PostgreSQL seam fakes.
// ---------------------------------------------------------------------------

// faultSessions implements agent.SessionsStore with injected faults.
type faultSessions struct {
	mu   sync.Mutex
	byID map[string]*domain.Session

	getErr    error
	createErr error
	latency   time.Duration
}

func newFaultSessions() *faultSessions {
	return &faultSessions{byID: map[string]*domain.Session{}}
}

func (f *faultSessions) inject(get, create error, latency time.Duration) {
	f.mu.Lock()
	f.getErr, f.createErr, f.latency = get, create, latency
	f.mu.Unlock()
}

func (f *faultSessions) Create(_ context.Context, s *domain.Session) error {
	f.mu.Lock()
	err, lat := f.createErr, f.latency
	f.mu.Unlock()
	if lat > 0 {
		time.Sleep(lat)
	}
	if err != nil {
		return err
	}
	f.mu.Lock()
	f.byID[s.ID] = s
	f.mu.Unlock()
	return nil
}

func (f *faultSessions) Get(_ context.Context, tenantID, id string) (*domain.Session, error) {
	f.mu.Lock()
	err, lat := f.getErr, f.latency
	f.mu.Unlock()
	if lat > 0 {
		time.Sleep(lat)
	}
	if err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	s, ok := f.byID[id]
	if !ok || s.TenantID != tenantID {
		return nil, nil // tenant isolation at the seam
	}
	return s, nil
}

func (f *faultSessions) TouchSession(_ context.Context, _, _ string, _ time.Duration) error {
	return nil
}
func (f *faultSessions) Close(_ context.Context, _, _ string) error { return nil }

// snapshot returns copies of all sessions (race-detector clean).
func (f *faultSessions) snapshot() []*domain.Session {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]*domain.Session, 0, len(f.byID))
	for _, s := range f.byID {
		clone := *s
		out = append(out, &clone)
	}
	return out
}

// faultRuns implements agent.RunsStore with injected faults.
type faultRuns struct {
	mu     sync.Mutex
	byID   map[string]*domain.Run
	byIdem map[string]*domain.Run

	createErr   error
	getErr      error
	completeErr error
	completeN   int // fail the first N Complete calls
	latency     time.Duration
}

func newFaultRuns() *faultRuns {
	return &faultRuns{byID: map[string]*domain.Run{}, byIdem: map[string]*domain.Run{}}
}

func (f *faultRuns) inject(create, get, complete error, completeN int, latency time.Duration) {
	f.mu.Lock()
	f.createErr, f.getErr, f.completeErr, f.completeN, f.latency = create, get, complete, completeN, latency
	f.mu.Unlock()
}

func (f *faultRuns) Create(_ context.Context, run *domain.Run) error {
	f.mu.Lock()
	err, lat := f.createErr, f.latency
	f.mu.Unlock()
	if lat > 0 {
		time.Sleep(lat)
	}
	if err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if run.IdempotencyKey != "" {
		k := run.TenantID + "\x00" + run.UserID + "\x00" + run.IdempotencyKey
		if _, exists := f.byIdem[k]; exists {
			return &uniqueViolation{}
		}
		f.byIdem[k] = run
	}
	f.byID[run.ID] = run
	return nil
}

func (f *faultRuns) Get(_ context.Context, tenantID, id string) (*domain.Run, error) {
	f.mu.Lock()
	err, lat := f.getErr, f.latency
	f.mu.Unlock()
	if lat > 0 {
		time.Sleep(lat)
	}
	if err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	r, ok := f.byID[id]
	if !ok || r.TenantID != tenantID {
		return nil, nil
	}
	return r, nil
}

func (f *faultRuns) GetByIdempotencyKey(_ context.Context, tenantID, userID, key string) (*domain.Run, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.byIdem[tenantID+"\x00"+userID+"\x00"+key], nil
}

func (f *faultRuns) Complete(_ context.Context, tenantID, runID, status, errorCode, errorMessage, cancelReason, cancelBy, resolvedModel, provider string) (bool, error) {
	f.mu.Lock()
	err, lat, n := f.completeErr, f.latency, f.completeN
	if n > 0 {
		f.completeN--
	}
	f.mu.Unlock()
	if lat > 0 {
		time.Sleep(lat)
	}
	if err != nil || n > 0 {
		return false, errOrFallback(err, "complete failed (simulated)")
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	r, ok := f.byID[runID]
	if !ok || r.TenantID != tenantID {
		return false, nil
	}
	if r.Status != domain.RunRunning {
		return false, nil // exactly-once terminal write
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

func (f *faultRuns) SetFirstEvent(_ context.Context, _, _ string) error { return nil }

func (f *faultRuns) CountRunning(_ context.Context, _, _ string) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, r := range f.byID {
		if r.Status == domain.RunRunning {
			n++
		}
	}
	return n, nil
}

// get returns a snapshot copy (race-detector clean, mirrors pgx semantics).
func (f *faultRuns) get(id string) *domain.Run {
	f.mu.Lock()
	defer f.mu.Unlock()
	r, ok := f.byID[id]
	if !ok {
		return nil
	}
	clone := *r
	return &clone
}

func (f *faultRuns) all() []*domain.Run {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]*domain.Run, 0, len(f.byID))
	for _, r := range f.byID {
		clone := *r
		out = append(out, &clone)
	}
	return out
}

type uniqueViolation struct{}

func (u *uniqueViolation) Error() string    { return "unique violation (23505)" }
func (u *uniqueViolation) SQLState() string { return "23505" }

func errOrFallback(err error, fallback string) error {
	if err != nil {
		return err
	}
	return errors.New(fallback)
}

// faultUsage implements metering.UsageWriter with injected faults.
type faultUsage struct {
	mu      sync.Mutex
	recs    []domain.UsageRecord
	failN   int
	latency time.Duration
}

func (f *faultUsage) InsertUsageRecords(_ context.Context, recs []domain.UsageRecord) error {
	f.mu.Lock()
	fail, lat := f.failN, f.latency
	if fail > 0 {
		f.failN--
	}
	f.mu.Unlock()
	if lat > 0 {
		time.Sleep(lat)
	}
	if fail > 0 {
		return errors.New("insert usage: database unavailable (simulated)")
	}
	f.mu.Lock()
	f.recs = append(f.recs, recs...)
	f.mu.Unlock()
	return nil
}

func (f *faultUsage) records() []domain.UsageRecord {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]domain.UsageRecord(nil), f.recs...)
}

func (f *faultUsage) total() domain.TokenUsage {
	f.mu.Lock()
	defer f.mu.Unlock()
	var t domain.TokenUsage
	for _, r := range f.recs {
		t = t.Add(r.Usage)
	}
	return t
}

// MonthToDateTokens sums input+output tokens recorded for the tenant — the
// agent quota gate's enforcement input (mirrors repos.UsageRepo; wired into
// the agent service so the §45 plan-quota scenarios run the real gate).
func (f *faultUsage) MonthToDateTokens(_ context.Context, tenantID string) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var used int64
	for _, r := range f.recs {
		if r.TenantID == tenantID {
			used += r.Usage.InputTokens + r.Usage.OutputTokens
		}
	}
	return used, nil
}

// ---------------------------------------------------------------------------
// Identity table (server-authoritative resolver with mutable state).
// ---------------------------------------------------------------------------

type identityTable struct {
	mu    sync.RWMutex
	byKey map[string]*auth.Identity
}

func newIdentityTable() *identityTable {
	return &identityTable{byKey: map[string]*auth.Identity{}}
}

func identKey(userID, tenantID string) string { return userID + "\x00" + tenantID }

func (it *identityTable) add(id *auth.Identity) {
	it.mu.Lock()
	it.byKey[identKey(id.User.ID, id.Tenant.ID)] = id
	it.mu.Unlock()
}

func (it *identityTable) get(userID, tenantID string) *auth.Identity {
	it.mu.RLock()
	defer it.mu.RUnlock()
	id := it.byKey[identKey(userID, tenantID)]
	if id == nil {
		return nil
	}
	clone := *id
	return &clone
}

func (it *identityTable) mutate(userID, tenantID string, fn func(*auth.Identity)) {
	it.mu.Lock()
	defer it.mu.Unlock()
	if id := it.byKey[identKey(userID, tenantID)]; id != nil {
		fn(id)
	}
}

// Resolve implements auth.Resolver: fail-closed.
func (it *identityTable) Resolve(_ context.Context, userID, tenantID string) (*auth.Identity, error) {
	id := it.get(userID, tenantID)
	if id == nil {
		return nil, domain.ErrUnauthorized(errors.New("no such identity in test table"))
	}
	return id, nil
}

// ---------------------------------------------------------------------------
// The multi-replica validation stack (spec §25).
// ---------------------------------------------------------------------------

type stackOpts struct {
	replicas      int
	rpmUser       int64
	rpmTenant     int64
	concUser      int64
	concTenant    int64
	wsPerUser     int64
	failOpen      bool
	maxBodyBytes  int64
	idleTimeout   time.Duration
	maxDuration   time.Duration
	maxRetries    int
	retryMin      time.Duration
	dialTimeout   time.Duration
	headerTO      time.Duration
	bifrostAPIKey string
	revocation    bool
	inFlight      int
	sessIdleTTL   time.Duration
	meterFlush    time.Duration
	meterQueue    int           // metering queue depth (default 4096)
	meterBatch    int           // metering batch size (default 8)
	wsHB          time.Duration // SSE+WS heartbeat interval (default 50ms)
	redisAddr     string        // override: address replicas dial (network-fault proxy)
	refreshPerIP  int           // POST /v1/auth/refresh per-IP budget (0 = off; §45)

	// Upstream circuit breaker. The harness default is "enabled but inert"
	// (thresholds far above any fault-injection volume) so sections §1–§43
	// keep their documented semantics; §44 tunes real thresholds.
	cbEnabled     bool
	cbConsecutive int
	cbWindow      int
	cbMinSamples  int
	cbRate        float64
	cbOpenBase    time.Duration
	cbOpenMax     time.Duration
	cbProbes      int
}

func defaultOpts() stackOpts {
	return stackOpts{
		replicas:      1,
		rpmUser:       1000,
		rpmTenant:     10000,
		concUser:      100,
		concTenant:    1000,
		wsPerUser:     64,
		failOpen:      true,
		maxBodyBytes:  2 << 20,
		idleTimeout:   2 * time.Second,
		maxDuration:   30 * time.Second,
		maxRetries:    0,
		dialTimeout:   2 * time.Second,
		headerTO:      3 * time.Second,
		bifrostAPIKey: "bifrost-server-side-secret",
		revocation:    true,
		inFlight:      512,
		sessIdleTTL:   time.Hour,
		meterFlush:    20 * time.Millisecond,
		meterQueue:    4096,
		meterBatch:    8,
		wsHB:          50 * time.Millisecond,

		cbEnabled:     true,
		cbConsecutive: 100000, // inert under fault injection
		cbWindow:      1024,
		cbMinSamples:  1000000, // rate trip effectively off
		cbRate:        0.99,
		cbOpenBase:    50 * time.Millisecond,
		cbOpenMax:     200 * time.Millisecond,
		cbProbes:      1,
	}
}

type replica struct {
	api     *api.API
	svc     *agent.Service
	mgr     *agent.Manager
	meter   *metering.Recorder
	metrics *observability.Metrics
	srv     *httptest.Server
	url     string
}

func (rp *replica) base() string { return rp.url }

type stack struct {
	t          *testing.T
	opts       stackOpts
	bifrost    *mockBifrost
	mr         *miniredis.Miniredis
	rdb        *redis.Client
	sessions   *faultSessions
	runs       *faultRuns
	usage      *faultUsage
	signer     *auth.LocalSigner
	ids        *identityTable
	replicas   []*replica
	replicasMu sync.RWMutex
	seq        atomic.Int64
	cfg        *config.Config
}

// replica returns replica i (bounds-wrapped) under a read lock: replica
// churn (spec §25) swaps the slice while traffic workers read it.
func (s *stack) replica(i int) *replica {
	s.replicasMu.RLock()
	defer s.replicasMu.RUnlock()
	if len(s.replicas) == 0 {
		return nil
	}
	if i < 0 || i >= len(s.replicas) {
		i = 0
	}
	return s.replicas[i]
}

// setReplicas atomically replaces the replica set (churn under traffic).
func (s *stack) setReplicas(rs []*replica) {
	s.replicasMu.Lock()
	s.replicas = rs
	s.replicasMu.Unlock()
}

func newStack(t *testing.T, o stackOpts) *stack {
	t.Helper()

	mb := newMockBifrost(t, o.bifrostAPIKey)
	mr := miniredis.RunT(t)
	redisAddr := o.redisAddr
	if redisAddr == "" {
		redisAddr = mr.Addr()
	}
	rdb := redis.NewClient(&redis.Options{Addr: redisAddr})
	t.Cleanup(func() { _ = rdb.Close() })

	cfg := &config.Config{
		MaxBodyBytes:        o.maxBodyBytes,
		MaxMessages:         256,
		MaxTools:            128,
		MaxModelLen:         256,
		WSHeartbeatInterval: o.wsHB,
		WSWriteWait:         2 * time.Second,
		WSMaxMessageSize:    512 << 10,
		WSSendQueue:         64,
		WSSlowConsumerGrace: 400 * time.Millisecond,
		WSIdleTimeout:       30 * time.Second,
		StreamIdleTimeout:   o.idleTimeout,
		StreamMaxDuration:   o.maxDuration,
		AuthTimeout:         2 * time.Second,
		Auth: config.AuthConfig{
			Mode: "local", LoginEnabled: false,
			Issuer: "https://auth.nexau.test", Audience: "nexau-cloud-api-validation",
			MaxRefreshPerIP: o.refreshPerIP, // 0 = unthrottled (§1–§44 semantics); §45 sets a budget
			RevocationCheck: o.revocation,   // must mirror the middleware: the WS auth guard reads it
		},
		Bifrost: config.BifrostConfig{BaseURL: mb.srv.URL, APIKey: o.bifrostAPIKey},
		Rate: config.RateLimitConfig{
			RequestsPerMinuteUser:   o.rpmUser,
			RequestsPerMinuteTenant: o.rpmTenant,
			ConcurrentRunsUser:      o.concUser,
			ConcurrentRunsTenant:    o.concTenant,
			WSConnectionsPerUser:    o.wsPerUser,
			FailOpen:                o.failOpen,
			RunConcurrencyTimeout:   time.Minute,
		},
		Replay:         config.ReplayConfig{MaxEventsPerRun: 2048, Window: 5 * time.Minute, MaxReplayBytes: 8 << 20},
		Meter:          config.MeterConfig{QueueSize: o.meterQueue, BatchSize: o.meterBatch, FlushInterval: o.meterFlush, RetryMax: 1},
		IdempotencyTTL: time.Hour,
		SessionIdleTTL: o.sessIdleTTL,
	}

	s := &stack{
		t: t, opts: o, bifrost: mb, mr: mr, rdb: rdb,
		sessions: newFaultSessions(), runs: newFaultRuns(), usage: &faultUsage{},
		signer: auth.NewLocalSigner(testSecret, cfg.Auth.Issuer, cfg.Auth.Audience, 0, time.Hour),
		ids:    newIdentityTable(), cfg: cfg,
	}

	s.seedIdentities()

	for i := 0; i < o.replicas; i++ {
		s.replicas = append(s.replicas, s.buildReplica(t))
	}
	return s
}

func newStackDefault(t *testing.T) *stack { return newStack(t, defaultOpts()) }

// seedIdentities installs the full validation identity matrix.
func (s *stack) seedIdentities() {
	active := func(user, tenant, sub string, restricted bool, models []string, limits auth.Limits) *auth.Identity {
		id := &auth.Identity{
			User:               auth.UserInfo{ID: user, Email: user + "@nexau.test", Status: "active"},
			Tenant:             auth.TenantInfo{ID: tenant, Slug: tenant, Status: "active"},
			Membership:         auth.MembershipInfo{Role: domain.RoleMember, Status: "active"},
			SubscriptionStatus: sub,
			Restricted:         restricted,
			Models:             models,
			Limits:             limits,
		}
		s.ids.add(id)
		return id
	}

	active("usr_1", "ten_A", "active", false, nil, auth.Limits{})                                         // primary happy-path identity
	active("usr_x", "ten_A", "active", false, nil, auth.Limits{})                                         // same tenant, other user
	active("usr_b1", "ten_B", "active", false, nil, auth.Limits{})                                        // tenant B (isolation target)
	active("usr_susp", "ten_A", "active", false, nil, auth.Limits{})                                      // user later suspended
	active("usr_tsusp", "ten_S", "active", false, nil, auth.Limits{})                                     // tenant later suspended
	active("usr_nosub", "ten_N", "canceled", false, nil, auth.Limits{})                                   // inactive subscription
	active("usr_pastdue", "ten_P", "past_due", false, nil, auth.Limits{})                                 // grace-period subscription
	active("usr_restr", "ten_R", "active", true, []string{"openai/gpt-4o", "anthropic/*"}, auth.Limits{}) // model allowlist
	active("usr_lowrpm", "ten_L", "active", false, nil, auth.Limits{
		RequestsPerMinuteUser: 5, ConcurrentRunsUser: 2,
	}) // plan-level low limits (RPM + concurrency)
	active("usr_rpm5", "ten_M", "active", false, nil, auth.Limits{
		RequestsPerMinuteUser: 5,
	}) // RPM-only limit (concurrency stays at stack default) — multi-instance test
	active("usr_quota", "ten_Q", "active", false, nil, auth.Limits{
		MonthlyTokenQuota: 100, // 2026-09-19 audit: plan quota enforced at run creation (§45; standard script meters 60/run)
	})
}

// buildReplica assembles one API instance sharing Redis/PG/Bifrost.
func (s *stack) buildReplica(t *testing.T) *replica {
	t.Helper()
	cfg := s.cfg

	metrics := observability.NewMetrics()

	// Per-replica Redis client: same server (distributed state), separate pool.
	// When a network-fault proxy fronts Redis, all replicas experience the
	// same outage — the multi-instance topology stays intact.
	rcAddr := s.mr.Addr()
	if s.opts.redisAddr != "" {
		rcAddr = s.opts.redisAddr
	}
	rc := redis.NewClient(&redis.Options{Addr: rcAddr})
	t.Cleanup(func() { _ = rc.Close() })

	meter := metering.New(s.usage, metering.Config{
		QueueSize: cfg.Meter.QueueSize, BatchSize: cfg.Meter.BatchSize,
		FlushInterval: cfg.Meter.FlushInterval, RetryMax: cfg.Meter.RetryMax,
	}, metrics)
	t.Cleanup(func() { meter.Close(2 * time.Second) })

	bus := streaming.NewBus(rc, streaming.Config{
		MaxEventsPerRun: cfg.Replay.MaxEventsPerRun,
		Window:          cfg.Replay.Window,
	})
	limiter := ratelimit.New(rc, cfg.Rate.FailOpen, metrics)
	idem := idempotency.New(rc, cfg.IdempotencyTTL)
	bfClient := bifrost.NewClient(bifrost.TransportConfig{
		BaseURL:          s.bifrost.srv.URL,
		APIKey:           s.opts.bifrostAPIKey,
		DialTimeout:      s.opts.dialTimeout,
		ResponseHeaderTO: s.opts.headerTO,
		MaxRetries:       s.opts.maxRetries,
		RetryMinBackoff:  20 * time.Millisecond,
		RetryMaxBackoff:  200 * time.Millisecond,
		CircuitBreaker: bifrost.CircuitBreakerConfig{
			Enabled: s.opts.cbEnabled, ConsecutiveFailures: s.opts.cbConsecutive,
			WindowSize: s.opts.cbWindow, MinSamples: s.opts.cbMinSamples,
			FailureRate: s.opts.cbRate, OpenBase: s.opts.cbOpenBase,
			OpenMax: s.opts.cbOpenMax, HalfOpenProbes: s.opts.cbProbes,
		},
	}, metrics)

	mgr := agent.NewManager(rc, limiter, cfg.Rate.RunConcurrencyTimeout, metrics)
	runSvc := agent.NewService(agent.Config{
		Sessions: s.sessions, Runs: s.runs, Bifrost: bfClient, Bus: bus,
		Usage: s.usage, // quota-gate enforcement seam (§45; inert when the plan sets no quota)
		Meter: meter, Idem: idem, Manager: mgr, Limiter: limiter,
		Limits: agent.Limits{MaxMessages: cfg.MaxMessages, MaxTools: cfg.MaxTools, MaxModelLen: cfg.MaxModelLen},
		Rate: agent.RateRules{
			RPMUser: cfg.Rate.RequestsPerMinuteUser, RPMTenant: cfg.Rate.RequestsPerMinuteTenant,
			ConcUser: cfg.Rate.ConcurrentRunsUser, ConcTenant: cfg.Rate.ConcurrentRunsTenant,
			FailOpen: cfg.Rate.FailOpen,
		},
		Timing:       agent.StreamTiming{IdleTimeout: cfg.StreamIdleTimeout, MaxDuration: cfg.StreamMaxDuration},
		SetupTimeout: 5 * time.Second,
		Metrics:      metrics,
	})
	sessSvc := agent.NewSessionService(s.sessions, cfg.SessionIdleTTL)

	authSvc := &auth.Service{Redis: rc, RevocationCheck: s.opts.revocation, RefreshRepo: &v41Refresh{byHash: map[string]*v41RefreshToken{}}}
	authMW := auth.Middleware{
		Verifier:        s.signer,
		Resolver:        s.ids,
		Service:         authSvc,
		AuthTimeout:     cfg.AuthTimeout,
		RevocationCheck: s.opts.revocation,
	}

	// bfClient rides through so /health/ready can report the circuit
	// state; HealthURL stays empty in the harness cfg, so the readiness
	// PROBE is not performed (matching every §1–§43 expectation).
	apiH := api.New(cfg, authSvc, authMW, sessSvc, runSvc, nil, nil, nil, bfClient, meter, limiter, metrics, nil, nil)
	chain := middleware.Chain(middleware.Options{
		MaxBodyBytes: cfg.MaxBodyBytes, MaxInFlight: s.opts.inFlight, AllowedOrigins: nil,
	}, metrics)

	srv := httptest.NewServer(chain(apiH.Router()))
	t.Cleanup(srv.Close)

	return &replica{
		api: apiH, svc: runSvc, mgr: mgr, meter: meter, metrics: metrics,
		srv: srv, url: srv.URL,
	}
}

const testSecret = "0123456789abcdef0123456789abcdef0123456789abcdef"

// tokenFor signs a token for an identity in the table.
func (s *stack) tokenFor(userID, tenantID string) string {
	s.t.Helper()
	jti := fmt.Sprintf("jti_%s_%d", userID, s.seq.Add(1))
	tok, err := s.signer.Sign(userID, tenantID, "member", "", jti, time.Now())
	if err != nil {
		s.t.Fatalf("sign: %v", err)
	}
	return tok
}

// tokenWithJTI signs a token with a known jti (revocation tests).
func (s *stack) tokenWithJTI(userID, tenantID, jti string) string {
	s.t.Helper()
	tok, err := s.signer.Sign(userID, tenantID, "member", "", jti, time.Now())
	if err != nil {
		s.t.Fatalf("sign: %v", err)
	}
	return tok
}

// sessionFor creates a session directly in the store for the given owner.
func (s *stack) sessionFor(tag, tenantID, userID string) string {
	s.t.Helper()
	id := fmt.Sprintf("sess_%s_%d", tag, s.seq.Add(1))
	sess := &domain.Session{
		ID: id, TenantID: tenantID, UserID: userID,
		Status: domain.SessionActive, CreatedAt: time.Now().UTC(),
	}
	if err := s.sessions.Create(context.Background(), sess); err != nil {
		s.t.Fatalf("session create: %v", err)
	}
	return id
}

// loadClient bounds the load generator's own connection pool: the sandbox
// fd limit (1024) cannot hold thousands of concurrent client sockets, and
// real desktop clients pool connections anyway. Requests queue in the
// transport instead of exhausting fds.
var loadClient = &http.Client{
	Transport: &http.Transport{
		MaxConnsPerHost:     384,
		MaxIdleConns:        384,
		MaxIdleConnsPerHost: 384,
		IdleConnTimeout:     30 * time.Second,
		DisableCompression:  true,
	},
	Timeout: 0, // streams manage their own deadlines
}

// postRunLoad issues a run-creation request through the bounded load client.
func (s *stack) postRunLoad(i int, token, sessionID, body string, hdrs map[string]string) (*http.Response, error) {
	req, err := http.NewRequest(http.MethodPost, s.replica(i).url+"/v1/agent/sessions/"+sessionID+"/runs", strings.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	for k, v := range hdrs {
		req.Header.Set(k, v)
	}
	return loadClient.Do(req)
}

// postRun issues a run-creation request against replica i.
func (s *stack) postRun(i int, token, sessionID, body string, hdrs map[string]string) (*http.Response, error) {
	req, err := http.NewRequest(http.MethodPost, s.replica(i).url+"/v1/agent/sessions/"+sessionID+"/runs", strings.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	for k, v := range hdrs {
		req.Header.Set(k, v)
	}
	return http.DefaultClient.Do(req)
}

// get issues an authenticated GET.
func (s *stack) get(i int, token, path string) (*http.Response, error) {
	req, err := http.NewRequest(http.MethodGet, s.replica(i).url+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	return http.DefaultClient.Do(req)
}

// post issues an authenticated POST with a body.
func (s *stack) post(i int, token, path, body string) (*http.Response, error) {
	req, err := http.NewRequest(http.MethodPost, s.replica(i).url+path, strings.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	return http.DefaultClient.Do(req)
}

// chat issues an OpenAI-compatible chat/completions request (mock desktop).
func (s *stack) chat(i int, token, body string, hdrs map[string]string) (*http.Response, error) {
	req, err := http.NewRequest(http.MethodPost, s.replica(i).url+"/v1/agent/chat/completions", strings.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	for k, v := range hdrs {
		req.Header.Set(k, v)
	}
	return http.DefaultClient.Do(req)
}

// runBody builds a minimal run request.
func runBody(model, userText string, stream bool) string {
	return fmt.Sprintf(`{"model":%q,"messages":[{"role":"user","content":%q}],"stream":%t}`, model, userText, stream)
}

// ---------------------------------------------------------------------------
// SSE / WebSocket desktop-side readers.
// ---------------------------------------------------------------------------

type sseEvt struct {
	env streaming.Envelope
	at  time.Time
}

// readSSE consumes the desktop SSE stream until stopOn or deadline.
func readSSE(t *testing.T, resp *http.Response, stopOn string, maxWait time.Duration) []sseEvt {
	t.Helper()
	defer resp.Body.Close()
	events := make(chan sseEvt, 512)
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
							events <- sseEvt{env: *env, at: time.Now()}
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
	var out []sseEvt
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

// readRawSSE collects raw data lines (OpenAI pass-through surface).
func readRawSSE(t *testing.T, resp *http.Response, maxWait time.Duration) []string {
	t.Helper()
	defer resp.Body.Close()
	lines := make(chan string, 512)
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
						lines <- line
					}
				}
			}
			if err != nil {
				close(lines)
				return
			}
		}
	}()
	deadline := time.After(maxWait)
	var out []string
	for {
		select {
		case l, ok := <-lines:
			if !ok {
				return out
			}
			out = append(out, l)
			if l == "[DONE]" {
				return out
			}
		case <-deadline:
			return out
		}
	}
}

// dialWS opens the session WebSocket (mock desktop transport).
func dialWS(t *testing.T, base, token, sessionID string) (*websocket.Conn, *http.Response, error) {
	t.Helper()
	url := "ws" + strings.TrimPrefix(base, "http") + "/v1/agent/sessions/" + sessionID + "/stream"
	dialer := &websocket.Dialer{HandshakeTimeout: 5 * time.Second}
	return dialer.Dial(url, map[string][]string{"Authorization": {"Bearer " + token}})
}

// wsRead collects envelopes + control frames until stopOn or deadline.
func wsRead(t *testing.T, conn *websocket.Conn, stopOn string, maxWait time.Duration) ([]streaming.Envelope, []map[string]any) {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(maxWait))
	var events []streaming.Envelope
	var controls []map[string]any
	deadline := time.Now().Add(maxWait)
	for time.Now().Before(deadline) {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return events, controls
		}
		var probe map[string]any
		if json.Unmarshal(data, &probe) == nil {
			if typ, _ := probe["type"].(string); typ != "" && !isEnvelopeType(typ) {
				controls = append(controls, probe)
				continue
			}
		}
		env, err := streaming.DecodeEnvelope(data)
		if err != nil {
			continue
		}
		events = append(events, *env)
		if stopOn != "" && env.Type == stopOn {
			return events, controls
		}
	}
	return events, controls
}

func isEnvelopeType(typ string) bool {
	switch typ {
	case "error", "pong", "run.replay", "run.cancel.ok", "RESUME_OK", "RESUME_MISSED":
		return false
	}
	return true
}

// wsRunCreate sends a run.create frame.
func wsRunCreate(t *testing.T, conn *websocket.Conn, request string) {
	t.Helper()
	if err := conn.WriteJSON(map[string]any{"type": "run.create", "request": json.RawMessage(request)}); err != nil {
		t.Fatalf("run.create: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Resource monitoring (spec §22, §32, §33, §34).
// ---------------------------------------------------------------------------

func goroutines() int { return runtime.NumGoroutine() }

func fdCount() int {
	entries, err := os.ReadDir("/proc/self/fd")
	if err != nil {
		return -1
	}
	return len(entries)
}

// rssKB reads the resident set size from /proc/self/status.
func rssKB() int64 {
	raw, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return -1
	}
	for _, line := range strings.Split(string(raw), "\n") {
		if strings.HasPrefix(line, "VmRSS:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				var kb int64
				if _, err := fmt.Sscanf(fields[1], "%d", &kb); err == nil {
					return kb
				}
			}
		}
	}
	return -1
}

type memStat struct {
	HeapAlloc uint64
	HeapInuse uint64
	NumGC     uint32
}

func memStats() memStat {
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	return memStat{HeapAlloc: ms.HeapAlloc, HeapInuse: ms.HeapInuse, NumGC: ms.NumGC}
}

// vm emits a machine-readable metric line for the report generator.
func vm(t *testing.T, key string, val any) {
	t.Helper()
	t.Logf("VALMETRIC %s=%v", key, val)
}

// waitFor polls until cond or timeout; returns whether cond was met.
func waitFor(t *testing.T, d time.Duration, cond func() bool) bool {
	t.Helper()
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		if cond() {
			return true
		}
		time.Sleep(15 * time.Millisecond)
	}
	return cond()
}

// captureLogs swaps the default slog logger for a capturing buffer and
// returns the restore function.
func captureLogs(t *testing.T) (*bytes.Buffer, func()) {
	t.Helper()
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	return &buf, func() { slog.SetDefault(prev) }
}

// errBody decodes a domain error response.
type errBody struct {
	Error struct {
		Code      string         `json:"code"`
		Message   string         `json:"message"`
		RequestID string         `json:"request_id"`
		Details   map[string]any `json:"details"`
	} `json:"error"`
}

func decodeErr(t *testing.T, resp *http.Response) errBody {
	t.Helper()
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		t.Fatalf("read error body: %v", err)
	}
	var e errBody
	if err := json.Unmarshal(raw, &e); err != nil {
		t.Fatalf("error body not JSON: %s", raw)
	}
	return e
}

func jsonUnmarshal(b []byte, v any) error { return json.Unmarshal(b, v) }

// redisProxy is a toggleable TCP proxy in front of miniredis: breaking it
// simulates a TRUE network-level Redis outage (connections reset, dials
// fail), restoring it simulates recovery — without losing the server state.
type redisProxy struct {
	ln     net.Listener
	up     string
	broken atomic.Bool
	mu     sync.Mutex
	conns  []net.Conn
}

func newRedisProxy(t *testing.T, upstream string) *redisProxy {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("proxy listen: %v", err)
	}
	p := &redisProxy{ln: ln, up: upstream}
	go p.acceptLoop()
	t.Cleanup(func() { _ = ln.Close() })
	return p
}

func (p *redisProxy) addr() string { return p.ln.Addr().String() }

func (p *redisProxy) acceptLoop() {
	for {
		c, err := p.ln.Accept()
		if err != nil {
			return
		}
		go p.handle(c)
	}
}

func (p *redisProxy) handle(c net.Conn) {
	if p.broken.Load() {
		_ = c.Close()
		return
	}
	u, err := net.Dial("tcp", p.up)
	if err != nil {
		_ = c.Close()
		return
	}
	p.mu.Lock()
	p.conns = append(p.conns, c, u)
	p.mu.Unlock()
	done := make(chan struct{}, 2)
	go func() { _, _ = io.Copy(u, c); done <- struct{}{} }()
	go func() { _, _ = io.Copy(c, u); done <- struct{}{} }()
	<-done
	_ = c.Close()
	_ = u.Close()
}

// breakConn resets every live connection and refuses new ones: from the
// API's perspective Redis is unreachable.
func (p *redisProxy) breakConn() {
	p.broken.Store(true)
	p.mu.Lock()
	for _, c := range p.conns {
		_ = c.Close()
	}
	p.conns = nil
	p.mu.Unlock()
}

// restore resumes proxying; go-redis reconnects automatically.
func (p *redisProxy) restore() { p.broken.Store(false) }
