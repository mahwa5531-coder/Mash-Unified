// Package metering records authoritative usage asynchronously. The streaming
// hot path must never block on PostgreSQL: records flow through a bounded
// queue to a single batcher goroutine that flushes in batches with retries.
//
// Exactly-once is guaranteed by the usage_records UNIQUE(run_id, call_seq)
// constraint with ON CONFLICT DO NOTHING — a retried batch can never
// double-charge. Bounded-queue overflow drops records loudly (metric + error
// log): billing gaps are visible, never silent, and never OOM the process.
package metering

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/observability"
)

// UsageWriter persists a batch of usage records (implemented by
// repos.UsageRepo.InsertUsageRecords).
type UsageWriter interface {
	InsertUsageRecords(ctx context.Context, recs []domain.UsageRecord) error
}

// Config bounds the recorder.
type Config struct {
	QueueSize     int
	BatchSize     int
	FlushInterval time.Duration
	RetryMax      int
}

// Recorder is safe for concurrent use. Close must be called exactly once.
type Recorder struct {
	w   UsageWriter
	cfg Config
	m   *observability.Metrics

	ch     chan domain.UsageRecord
	wg     sync.WaitGroup
	cancel context.CancelFunc

	// dropCount tracks queue-overflow drops between logs.
	dropMu   sync.Mutex
	dropped  int64
	lastDrop time.Time
}

// New starts the recorder and its batcher goroutine.
func New(w UsageWriter, cfg Config, m *observability.Metrics) *Recorder {
	if cfg.QueueSize < 64 {
		cfg.QueueSize = 64
	}
	if cfg.BatchSize < 1 {
		cfg.BatchSize = 1
	}
	if cfg.FlushInterval <= 0 {
		cfg.FlushInterval = 500 * time.Millisecond
	}
	if cfg.RetryMax < 0 {
		cfg.RetryMax = 0
	}
	ctx, cancel := context.WithCancel(context.Background())
	r := &Recorder{
		w:      w,
		cfg:    cfg,
		m:      m,
		ch:     make(chan domain.UsageRecord, cfg.QueueSize),
		cancel: cancel,
	}
	r.wg.Add(1)
	go r.batcher(ctx)
	return r
}

// Record enqueues one authoritative usage fact. It never blocks the streaming
// path: a full queue drops the record loudly.
func (r *Recorder) Record(rec domain.UsageRecord) {
	select {
	case r.ch <- rec:
		if r.m != nil {
			r.m.MeterQueueDepth.Set(int64(len(r.ch)))
		}
	default:
		r.drop()
	}
}

func (r *Recorder) drop() {
	if r.m != nil {
		r.m.UsageDropped.Add(context.Background(), 1, observability.Attr("reason", "queue_full"))
	}
	r.dropMu.Lock()
	r.dropped++
	// Log at most once per second per process — a flood must not become a
	// log flood.
	if time.Since(r.lastDrop) > time.Second {
		r.lastDrop = time.Now()
		n := r.dropped
		r.dropped = 0
		r.dropMu.Unlock()
		observability.LogWarn("metering: usage records dropped (queue full)",
			"dropped_recent", n, "queue_size", r.cfg.QueueSize)
		return
	}
	r.dropMu.Unlock()
}

// batcher drains the queue into batches and persists with retry.
func (r *Recorder) batcher(ctx context.Context) {
	defer r.wg.Done()

	batch := make([]domain.UsageRecord, 0, r.cfg.BatchSize)
	ticker := time.NewTicker(r.cfg.FlushInterval)
	defer ticker.Stop()

	flush := func() {
		if len(batch) == 0 {
			return
		}
		start := time.Now()
		if err := safePersist(ctx, r.persistWithRetry, batch); err != nil {
			// Final failure: records are lost. Loud, counted, and attributed.
			if r.m != nil {
				r.m.UsageDropped.Add(ctx, int64(len(batch)), observability.Attr("reason", "db_error"))
			}
			observability.LogError("metering: usage batch permanently failed",
				"error", err, "records", len(batch))
		} else if r.m != nil {
			r.m.MeterBatchLatencyMS.Record(ctx, time.Since(start).Milliseconds())
		}
		batch = batch[:0]
	}

	for {
		select {
		case <-ctx.Done():
			// Shutdown: drain what is already queued (bounded), then stop.
			for {
				select {
				case rec := <-r.ch:
					batch = append(batch, rec)
					if len(batch) >= r.cfg.BatchSize {
						flush()
					}
				default:
					flush()
					return
				}
			}
		case rec := <-r.ch:
			batch = append(batch, rec)
			if len(batch) >= r.cfg.BatchSize {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}

// safePersist guards the batch write against panics (2026-09-18 post-
// mortem audit): the batcher runs on a detached goroutine where a panic
// would kill the process — and even if it only died silently, metering
// would stop for the pod's remaining lifetime (invisible billing gap). A
// contained panic is surfaced as a normal batch failure: dropped, counted,
// logged — and the loop keeps serving later records.
func safePersist(ctx context.Context, persist func(context.Context, []domain.UsageRecord) error, batch []domain.UsageRecord) (err error) {
	defer func() {
		if rec := recover(); rec != nil {
			err = fmt.Errorf("usage writer panic contained: %v", rec)
		}
	}()
	return persist(ctx, batch)
}

// persistWithRetry retries only transient failures. Batch insert is
// idempotent (ON CONFLICT DO NOTHING), so a retry after a timeout can neither
// double-charge nor corrupt.
func (r *Recorder) persistWithRetry(ctx context.Context, batch []domain.UsageRecord) error {
	backoff := 100 * time.Millisecond
	var lastErr error
	for attempt := 0; attempt <= r.cfg.RetryMax; attempt++ {
		// Per-attempt budget: the batcher must not wedge on a stuck query.
		cctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		err := r.w.InsertUsageRecords(cctx, batch)
		cancel()
		if err == nil {
			return nil
		}
		lastErr = err
		if !retryableDB(err) {
			return err
		}
		select {
		case <-ctx.Done():
			return lastErr
		case <-time.After(backoff):
		}
		if backoff < 2*time.Second {
			backoff *= 2
		}
	}
	return lastErr
}

// retryableDB classifies storage failures. Context cancellation of the parent
// (shutdown) is NOT retryable here — the final drain runs on a live budget.
func retryableDB(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
		return false
	}
	return true // connection/timeout class: retry (idempotent insert)
}

// Close drains the queue, flushes remaining batches and stops the batcher,
// bounded by drain: a wedged PostgreSQL cannot extend process shutdown past
// the operator's grace window (abandoned records take the loss + alarm path).
func (r *Recorder) Close(drain time.Duration) {
	if drain <= 0 {
		drain = 30 * time.Second
	}
	done := make(chan struct{})
	go func() {
		r.cancel()
		r.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(drain):
		// Bounded: stop waiting. The batcher goroutine exits on its own when
		// the in-flight statement budget elapses; remaining records are
		// dropped-and-counted by the worker's final flush attempt.
	}
}

// QueueLen reports the current queue depth (diagnostics/metrics sampler).
func (r *Recorder) QueueLen() int { return len(r.ch) }
