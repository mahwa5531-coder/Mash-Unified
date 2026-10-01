package metering

// Poison-pill containment proof for the batcher (2026-09-18 post-mortem
// audit): the batcher runs on a detached goroutine. Before the fix, a
// panicking UsageWriter implementation would kill the process — and had it
// merely failed silently, metering (authoritative billing facts) would have
// stopped for the pod's remaining lifetime. Post-fix contract: the poison
// batch is dropped loudly and the batcher keeps serving later records.

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/domain"
)

type flakyWriter struct {
	mu       sync.Mutex
	failNext bool
	calls    atomic.Int64
	okCalls  atomic.Int64
	seen     []domain.UsageRecord
}

func (w *flakyWriter) InsertUsageRecords(ctx context.Context, recs []domain.UsageRecord) error {
	n := w.calls.Add(1)
	w.mu.Lock()
	fail := w.failNext
	if fail {
		w.failNext = false
	}
	w.mu.Unlock()
	if fail {
		panic("poison writer: simulated storage panic")
	}
	w.mu.Lock()
	w.seen = append(w.seen, recs...)
	w.mu.Unlock()
	w.okCalls.Store(n)
	return nil
}

func TestBatcherSurvivesWriterPanic(t *testing.T) {
	w := &flakyWriter{failNext: true}
	rec := New(w, Config{
		QueueSize:     128,
		BatchSize:     1,
		FlushInterval: 10 * time.Millisecond,
		RetryMax:      0,
	}, nil)
	defer rec.Close(2 * time.Second)

	// 1. The poison batch: the writer panics on this flush.
	rec.Record(domain.UsageRecord{RunID: "run_poison"})
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && w.calls.Load() == 0 {
		time.Sleep(5 * time.Millisecond)
	}
	if w.calls.Load() == 0 {
		t.Fatal("writer never called")
	}

	// 2. The batcher must still be alive: later records flush normally.
	rec.Record(domain.UsageRecord{RunID: "run_after"})
	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		w.mu.Lock()
		n := len(w.seen)
		w.mu.Unlock()
		if n > 0 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.seen) == 0 {
		t.Fatal("batcher died after a contained writer panic: later records never flushed")
	}
	if w.seen[0].RunID != "run_after" {
		t.Fatalf("unexpected first persisted record: %s", w.seen[0].RunID)
	}
}
