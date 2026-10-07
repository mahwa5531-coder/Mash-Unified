package metering

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/mash-cloud/mash-api/internal/domain"
)

type fakeWriter struct {
	mu      sync.Mutex
	batches [][]domain.LLMCall
	fail    int // fail the first N inserts
}

func (f *fakeWriter) InsertCalls(ctx context.Context, recs []domain.LLMCall) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.fail > 0 {
		f.fail--
		return errors.New("db down")
	}
	f.batches = append(f.batches, recs)
	return nil
}

func (f *fakeWriter) total() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, b := range f.batches {
		n += len(b)
	}
	return n
}

func rec(run string) domain.LLMCall {
	return domain.LLMCall{CallID: run, ResolvedModel: "openai/gpt-4o", StartedAt: time.Now().UTC()}
}

func TestRecorderBatchesAndFlushes(t *testing.T) {
	w := &fakeWriter{}
	r := New(w, Config{QueueSize: 128, BatchSize: 3, FlushInterval: 20 * time.Millisecond, RetryMax: 0}, nil)
	for i := 0; i < 7; i++ {
		r.Record(rec("run_a"))
	}
	deadline := time.After(2 * time.Second)
	for w.total() < 7 {
		select {
		case <-deadline:
			t.Fatalf("records not flushed: %d", w.total())
		case <-time.After(5 * time.Millisecond):
		}
	}
	r.Close(5 * time.Second)
}

func TestRecorderRetriesTransientFailures(t *testing.T) {
	w := &fakeWriter{fail: 2} // first two inserts fail
	r := New(w, Config{QueueSize: 128, BatchSize: 2, FlushInterval: 10 * time.Millisecond, RetryMax: 3}, nil)
	r.Record(rec("run_b"))
	r.Record(rec("run_b2"))
	deadline := time.After(3 * time.Second)
	for w.total() < 2 {
		select {
		case <-deadline:
			t.Fatalf("records not persisted after retries: %d", w.total())
		case <-time.After(5 * time.Millisecond):
		}
	}
	r.Close(5 * time.Second)
}

func TestRecorderDropsOnOverflow(t *testing.T) {
	w := &fakeWriter{}
	// Queue tiny; never flush (huge interval); no reader contention needed
	// because Record is non-blocking.
	r := New(w, Config{QueueSize: 64, BatchSize: 64, FlushInterval: time.Hour, RetryMax: 0}, nil)
	for i := 0; i < 200; i++ {
		r.Record(rec("run_c")) // must never block
	}
	if n := r.QueueLen(); n > 64 {
		t.Fatalf("queue exceeded bound: %d", n)
	}
	r.Close(5 * time.Second)
}

func TestRecorderCloseDrains(t *testing.T) {
	w := &fakeWriter{}
	r := New(w, Config{QueueSize: 256, BatchSize: 512, FlushInterval: time.Hour, RetryMax: 0}, nil)
	for i := 0; i < 10; i++ {
		r.Record(rec("run_d"))
	}
	r.Close(5 * time.Second)
	if w.total() != 10 {
		t.Fatalf("Close must drain the queue: %d", w.total())
	}
}

func TestRecorderEmptyClose(t *testing.T) {
	r := New(&fakeWriter{}, Config{QueueSize: 128, BatchSize: 2, FlushInterval: 10 * time.Millisecond, RetryMax: 0}, nil)
	r.Close(5 * time.Second) // must not hang
}
