package idempotency

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/nexau-cloud/nexau-api/internal/domain"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	return New(rdb, time.Hour)
}

func TestFreshThenCompleteThenReplay(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	outcome, _, err := s.Begin(ctx, "ten", "usr", "key1", "hashA", "run_1", "sess_1")
	if err != nil || outcome != Fresh {
		t.Fatalf("first Begin: outcome=%v err=%v", outcome, err)
	}

	s.Complete(ctx, "ten", "usr", "key1", "run_1", domain.RunCompleted)

	outcome, rec, err := s.Begin(ctx, "ten", "usr", "key1", "hashA", "run_2", "sess_1")
	if err != nil || outcome != Replay {
		t.Fatalf("second Begin: outcome=%v err=%v", outcome, err)
	}
	if rec.RunID != "run_1" {
		t.Fatalf("replay must point at the original run: %q", rec.RunID)
	}
}

func TestInFlightWhileRunning(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	s.Begin(ctx, "ten", "usr", "key2", "hashA", "run_1", "sess_1")
	outcome, _, err := s.Begin(ctx, "ten", "usr", "key2", "hashA", "run_2", "sess_1")
	if err != nil || outcome != InFlight {
		t.Fatalf("duplicate while running: outcome=%v err=%v", outcome, err)
	}
}

func TestReuseWithDifferentBody(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	s.Begin(ctx, "ten", "usr", "key3", "hashA", "run_1", "sess_1")
	outcome, _, err := s.Begin(ctx, "ten", "usr", "key3", "hashB", "run_2", "sess_1")
	if err != nil || outcome != Reuse {
		t.Fatalf("key reuse with different body: outcome=%v err=%v", outcome, err)
	}
}

func TestScopingByTenantAndUser(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	s.Begin(ctx, "tenA", "usr", "key4", "hashA", "run_1", "sess_1")
	// Same key, different tenant: independent.
	outcome, _, err := s.Begin(ctx, "tenB", "usr", "key4", "hashA", "run_2", "sess_1")
	if err != nil || outcome != Fresh {
		t.Fatalf("tenant scoping broken: outcome=%v err=%v", outcome, err)
	}
	// Same key, different user: independent.
	outcome, _, err = s.Begin(ctx, "tenA", "usr2", "key4", "hashA", "run_3", "sess_1")
	if err != nil || outcome != Fresh {
		t.Fatalf("user scoping broken: outcome=%v err=%v", outcome, err)
	}
}

func TestTTLExpiry(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	s := New(rdb, 50*time.Millisecond)
	ctx := context.Background()

	s.Begin(ctx, "ten", "usr", "key5", "hashA", "run_1", "sess_1")
	mr.FastForward(80 * time.Millisecond)
	outcome, _, err := s.Begin(ctx, "ten", "usr", "key5", "hashA", "run_2", "sess_1")
	if err != nil || outcome != Fresh {
		t.Fatalf("expired record must be fresh: outcome=%v err=%v", outcome, err)
	}
}

func TestHashRequestStable(t *testing.T) {
	a := HashRequestBytes([]byte(`{"m":"openai/gpt-4o"}`))
	b := HashRequestBytes([]byte(`{"m":"openai/gpt-4o"}`))
	if a != b {
		t.Fatal("hash must be deterministic")
	}
	if a == HashRequestBytes([]byte(`{"m":"anthropic/claude"}`)) {
		t.Fatal("hash must differ")
	}
	if len(a) != 64 {
		t.Fatalf("sha256 hex: %d", len(a))
	}
}
