package agent

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	goredis "github.com/redis/go-redis/v9"

	"github.com/nexau-cloud/nexau-api/internal/auth"
	"github.com/nexau-cloud/nexau-api/internal/bifrost"
	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/idempotency"
	"github.com/nexau-cloud/nexau-api/internal/ratelimit"
	"github.com/nexau-cloud/nexau-api/internal/reqctx"
)

// These tests guard audit finding 5: an idempotency key claimed by an
// instance that crashed mid-run must not poison retries for the full 24 h
// Redis TTL. Redis "running" + PostgreSQL terminal (ORPHANED_RUN sweep) is a
// stale claim: the retry must replay the original outcome instead of 409.

// --- minimal fakes over the service seams -----------------------------------

type fakeSessions struct{ sess *domain.Session }

func (f *fakeSessions) Get(ctx context.Context, tenantID, id string) (*domain.Session, error) {
	return f.sess, nil
}
func (f *fakeSessions) Create(ctx context.Context, s *domain.Session) error { return nil }
func (f *fakeSessions) TouchSession(ctx context.Context, t, id string, ttl time.Duration) error {
	return nil
}
func (f *fakeSessions) Close(ctx context.Context, tenantID, id string) error { return nil }

type fakeRuns struct {
	mu   sync.Mutex
	runs map[string]*domain.Run
}

func (f *fakeRuns) Create(ctx context.Context, run *domain.Run) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	cp := *run
	f.runs[run.ID] = &cp
	return nil
}

func (f *fakeRuns) Get(ctx context.Context, tenantID, id string) (*domain.Run, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if r, ok := f.runs[id]; ok {
		cp := *r
		return &cp, nil
	}
	return nil, nil
}

func (f *fakeRuns) GetByIdempotencyKey(ctx context.Context, tenantID, userID, key string) (*domain.Run, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, r := range f.runs {
		if r.IdempotencyKey == key {
			cp := *r
			return &cp, nil
		}
	}
	return nil, nil
}

func (f *fakeRuns) Complete(ctx context.Context, tenantID, runID, status, errorCode, errorMessage, cancelReason, cancelBy, resolvedModel, provider string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if r, ok := f.runs[runID]; ok && r.Status == domain.RunRunning {
		r.Status = status
		r.ErrorCode = errorCode
		return true, nil
	}
	return false, nil
}

func (f *fakeRuns) SetFirstEvent(ctx context.Context, tenantID, runID string) error { return nil }
func (f *fakeRuns) CountRunning(ctx context.Context, tenantID, userID string) (int, error) {
	return 0, nil
}

func (f *fakeRuns) setStatus(id, status, errorCode string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if r, ok := f.runs[id]; ok {
		r.Status = status
		r.ErrorCode = errorCode
	}
}

// --- harness ------------------------------------------------------------------

func newIdemTestService(t *testing.T) (*Service, *fakeRuns) {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	lim := ratelimit.New(rdb, true, nil)
	// NOTE: the manager's control loop intentionally outlives the test (its
	// Close would block on the live pubsub subscription); the goroutine dies
	// with the test process. miniredis + rdb cleanup below tear the
	// subscription down regardless.
	mgr := NewManager(rdb, lim, time.Minute, nil)

	runs := &fakeRuns{runs: map[string]*domain.Run{}}
	svc := NewService(Config{
		Sessions: &fakeSessions{sess: &domain.Session{
			ID: "sess_1", TenantID: "ten_1", UserID: "usr_1", Status: domain.SessionActive,
		}},
		Runs:    runs,
		Idem:    idempotency.New(rdb, 24*time.Hour),
		Manager: mgr,
		Limiter: lim,
		Limits:  Limits{MaxMessages: 16, MaxTools: 8, MaxModelLen: 64},
		Rate:    RateRules{RPMUser: 1000, RPMTenant: 1000, ConcUser: 100, ConcTenant: 100},
		Timing:  StreamTiming{IdleTimeout: time.Second, MaxDuration: 5 * time.Second},
	})
	return svc, runs
}

func idemTestIdentity() *auth.Identity {
	return &auth.Identity{
		User:               auth.UserInfo{ID: "usr_1", Status: "active"},
		Tenant:             auth.TenantInfo{ID: "ten_1", Status: "active"},
		Membership:         auth.MembershipInfo{Status: "active"},
		SubscriptionStatus: "active",
	}
}

func idemTestRequest(key string) *RunRequest {
	return &RunRequest{
		Model:          "openai/gpt-4o",
		Stream:         true,
		IdempotencyKey: key,
		Messages:       []bifrost.Message{{Role: "user", Content: json.RawMessage(`"hello"`)}},
	}
}

// --- tests --------------------------------------------------------------------

// Stale InFlight (crashed instance): Redis says running, PostgreSQL says
// terminal → the retry REPLAYS the original outcome instead of 409 for 24 h.
func TestCreateRunStaleInFlightReplays(t *testing.T) {
	svc, runs := newIdemTestService(t)
	idn := idemTestIdentity()
	req := idemTestRequest("key-stale")

	// 1. The original request claims the key and starts a run.
	resp, handle, derr := svc.CreateRun(context.Background(), idn, "sess_1", req)
	if derr != nil || resp != nil || handle == nil {
		t.Fatalf("original create: resp=%v handle=%v derr=%v", resp, handle, derr)
	}
	origID := handle.Run.ID

	// 2. The owning instance "crashes": no ProduceStream, no finalize, no
	// idem Complete. Housekeeping later sweeps the PG row to failed.
	runs.setStatus(origID, domain.RunFailed, "ORPHANED_RUN")

	// 3. The client retries with the same key. Redis still holds
	// status=running (24 h TTL) — the stale claim. PostgreSQL is the truth.
	resp2, handle2, derr2 := svc.CreateRun(context.Background(), idn, "sess_1", req)
	if derr2 != nil {
		t.Fatalf("stale in-flight must replay, got error %s (%s)", derr2.Message, derr2.Code)
	}
	if handle2 != nil {
		t.Fatal("replay must not start a producer")
	}
	if resp2 == nil || resp2.Run == nil {
		t.Fatal("replay must return the original run view")
	}
	if resp2.Run.ID != origID {
		t.Fatalf("replay pointed at %s, want the original %s", resp2.Run.ID, origID)
	}
	if resp2.Run.Status != domain.RunFailed {
		t.Fatalf("replay status = %s, want failed (ORPHANED_RUN)", resp2.Run.Status)
	}
}

// Genuine InFlight: the original run is still running in PostgreSQL → the
// retry is a duplicate in progress (409 semantics preserved).
func TestCreateRunGenuineInFlightStillConflicts(t *testing.T) {
	svc, _ := newIdemTestService(t)
	idn := idemTestIdentity()
	req := idemTestRequest("key-live")

	_, handle, derr := svc.CreateRun(context.Background(), idn, "sess_1", req)
	if derr != nil || handle == nil {
		t.Fatalf("original create: derr=%v", derr)
	}

	_, _, derr2 := svc.CreateRun(context.Background(), idn, "sess_1", req)
	if derr2 == nil {
		t.Fatal("genuine in-flight must conflict")
	}
	want := domain.ErrDuplicate()
	if derr2.Code != want.Code {
		t.Fatalf("code = %s, want %s", derr2.Code, want.Code)
	}
}

// Concurrent-duplicate race: the winner claimed the key but its PG row is not
// visible yet (Get → nil) with a FRESH claim. The loser must conflict — it
// must NOT abort the winner's claim (regression: this exact race returned
// IDEMPOTENCY_ORPHANED and released the winner's key before the claim-age
// check existed).
func TestCreateRunInsertRaceStillConflicts(t *testing.T) {
	svc, runs := newIdemTestService(t)
	idn := idemTestIdentity()
	req := idemTestRequest("key-race")

	_, handle, derr := svc.CreateRun(context.Background(), idn, "sess_1", req)
	if derr != nil || handle == nil {
		t.Fatalf("original create: derr=%v", derr)
	}

	// Simulate the pre-insert visibility window: the row is not readable.
	runs.mu.Lock()
	delete(runs.runs, handle.Run.ID)
	runs.mu.Unlock()

	_, _, derr2 := svc.CreateRun(context.Background(), idn, "sess_1", req)
	if derr2 == nil {
		t.Fatal("fresh-claim insert race must conflict, not replay")
	}
	if want := domain.ErrDuplicate(); derr2.Code != want.Code {
		t.Fatalf("code = %s, want %s (must not abort the winner's claim)", derr2.Code, want.Code)
	}
}

// TestCreateRunAttachesRunIDToProducerContext guards the 2026-09-23 cleanup
// finding: bifrost.Client stamped x-nexau-run-id from reqctx.RunID, but
// nothing ever called WithRunID — the correlation header reached upstream
// empty on every request since the beginning. The producer context is the
// single wiring point (both the sync path via completeSync and the streaming
// producer via handle.ctx derive from it).
func TestCreateRunAttachesRunIDToProducerContext(t *testing.T) {
	svc, _ := newIdemTestService(t)
	idn := idemTestIdentity()
	req := idemTestRequest("key-runid")

	_, handle, derr := svc.CreateRun(context.Background(), idn, "sess_1", req)
	if derr != nil || handle == nil {
		t.Fatalf("create: handle=%v derr=%v", handle, derr)
	}
	if got := reqctx.RunID(handle.ctx); got != handle.Run.ID {
		t.Fatalf("producer context run id = %q, want %q — x-nexau-run-id would be sent empty", got, handle.Run.ID)
	}
}
