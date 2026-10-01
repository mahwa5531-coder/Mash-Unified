// Bus is the distributed event backbone. Every run event is:
//
//   - XADDed to a per-run Redis Stream (bounded MAXLEN, TTL window) → durable
//     replay buffer for reconnecting desktops, readable from ANY instance
//     (no sticky sessions), and
//   - PUBLISHed to the per-session live channel → instant fan-out to whichever
//     instance holds the desktop's WebSocket.
//
// Redis is deliberately NOT the source of truth: runs/status live in
// PostgreSQL; the bus is a fast, lossy-on-expiry delivery layer. Producers
// serialize once; consumers forward the exact bytes.
package streaming

import (
	"context"
	"errors"
	"runtime/debug"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/observability"
	"github.com/nexau-cloud/nexau-api/internal/store"
)

// Config bounds the bus.
type Config struct {
	MaxEventsPerRun int
	Window          time.Duration
}

// Bus is safe for concurrent use.
type Bus struct {
	rdb redis.UniversalClient
	cfg Config
}

func NewBus(rdb redis.UniversalClient, cfg Config) *Bus {
	if cfg.MaxEventsPerRun <= 0 {
		cfg.MaxEventsPerRun = 2048
	}
	if cfg.Window <= 0 {
		cfg.Window = 15 * time.Minute
	}
	return &Bus{rdb: rdb, cfg: cfg}
}

func runStreamKey(runID string) string       { return "nexau:run:" + runID }
func sessionChannel(sessionID string) string { return "nexau:sess:" + sessionID }

// Publish stores the envelope in the run stream and fans it out live.
// Errors are best-effort per leg: replay-buffer failure is logged (live
// delivery still works; resumability degrades), live-fanout failure is logged
// (replay still works). The caller's direct SSE write is unaffected.
func (b *Bus) Publish(ctx context.Context, env *Envelope) error {
	if env == nil {
		return nil
	}
	blob := env.Marshal()

	// Replay leg: XADD with approximate trim. Errors here must not break the
	// live leg, so the first error is remembered but both legs always run.
	var firstErr error
	if err := b.rdb.XAdd(ctx, &redis.XAddArgs{
		Stream: runStreamKey(env.RunID),
		MaxLen: int64(b.cfg.MaxEventsPerRun),
		Approx: true,
		Values: map[string]any{"e": blob},
	}).Err(); err != nil && !store.IsRedisDown(err) {
		firstErr = err
	}
	// Live leg.
	if err := b.rdb.Publish(ctx, sessionChannel(env.SessionID), blob).Err(); err != nil && firstErr == nil && !store.IsRedisDown(err) {
		firstErr = err
	}
	return firstErr
}

// Retain applies the retention window to a run's stream (called on completion).
func (b *Bus) Retain(ctx context.Context, runID string) {
	b.rdb.Expire(ctx, runStreamKey(runID), b.cfg.Window)
}

// Live is a live subscription to a session's events.
type Live struct {
	sub       *redis.PubSub
	C         <-chan LiveEvent
	close     chan struct{}
	closeOnce sync.Once
}

// LiveEvent carries the raw envelope bytes plus the delivery error channel.
type LiveEvent struct {
	Blob []byte
}

// SubscribeLive attaches to the session channel. The caller must Close.
func (b *Bus) SubscribeLive(ctx context.Context, sessionID string) (*Live, error) {
	sub := b.rdb.Subscribe(ctx, sessionChannel(sessionID))
	// Verify subscription before returning (Redis pub/sub is fire-and-forget;
	// a failed SUBSCRIBE must surface now, not at first message).
	if err := sub.Ping(ctx); err != nil {
		_ = sub.Close()
		return nil, domain.ErrDependencyUnavailable("redis")
	}

	ch := make(chan LiveEvent, 64) // small buffer: forwarder must keep up
	l := &Live{sub: sub, C: ch, close: make(chan struct{})}

	go func() {
		defer close(ch)
		// Poison-pill containment (2026-09-18 audit): a panic in the
		// forwarder would kill the process. Closing the channel ends
		// the live leg; clients refill from the durable replay buffer.
		defer func() {
			if rec := recover(); rec != nil {
				observability.LogError("live forwarder panic contained",
					"panic", rec, "stack", string(debug.Stack()))
			}
		}()
		msgs := sub.Channel()
		for {
			select {
			case <-l.close:
				return
			case m, ok := <-msgs:
				if !ok {
					return
				}
				blob := []byte(m.Payload)
				select {
				case ch <- LiveEvent{Blob: blob}:
				case <-l.close:
					return
				default:
					// Drop when the consumer stalls: live events are
					// replaceable by replay. Ordering is preserved for what
					// remains; the resumable stream fills gaps.
				}
			}
		}
	}()
	return l, nil
}

// Close ends the live subscription exactly once.
func (l *Live) Close() error {
	if l == nil {
		return nil
	}
	var err error
	l.closeOnce.Do(func() {
		close(l.close)
		err = l.sub.Close()
	})
	return err
}

// Replay reads stored events for a run after the given sequence. Returns the
// events in order, plus whether the buffer still covers the requested point
// (complete=false → the client's last_sequence predates the retained window:
// send RESUME_MISSED).
func (b *Bus) Replay(ctx context.Context, runID string, afterSequence int64, maxBytes int64) ([]*Envelope, int64, bool, error) {
	msgs, err := b.rdb.XRange(ctx, runStreamKey(runID), "-", "+").Result()
	if err != nil {
		if errors.Is(err, redis.Nil) || store.IsRedisDown(err) {
			return nil, 0, false, nil // degraded: no replay data
		}
		return nil, 0, false, domain.ErrInternal(err)
	}

	var out []*Envelope
	var total int64
	lastSeq := int64(0)
	covered := true
	for _, m := range msgs {
		blob, _ := m.Values["e"].(string)
		if blob == "" {
			continue
		}
		env, err := DecodeEnvelope([]byte(blob))
		if err != nil || env.Sequence == 0 {
			continue
		}
		if env.Sequence > afterSequence {
			total += int64(len(blob))
			if maxBytes > 0 && total > maxBytes {
				covered = false
				break // client asked for more than the replay cap
			}
			out = append(out, env)
		}
		lastSeq = env.Sequence
	}
	// The retained window no longer contains the client's resume point when
	// its sequence is at/below the oldest surviving sequence.
	if len(msgs) > 0 && afterSequence > 0 {
		if first := firstSequence(msgs); first > 0 && afterSequence < first {
			covered = false
		}
	}
	return out, lastSeq, covered, nil
}

func firstSequence(msgs []redis.XMessage) int64 {
	for _, m := range msgs {
		blob, _ := m.Values["e"].(string)
		if blob == "" {
			continue
		}
		env, err := DecodeEnvelope([]byte(blob))
		if err == nil && env.Sequence > 0 {
			return env.Sequence
		}
	}
	return 0
}

// LastSequence reports the newest stored sequence for a run (0 when absent).
func (b *Bus) LastSequence(ctx context.Context, runID string) int64 {
	msgs, err := b.rdb.XRevRangeN(ctx, runStreamKey(runID), "+", "-", 1).Result()
	if err != nil || len(msgs) == 0 {
		return 0
	}
	blob, _ := msgs[0].Values["e"].(string)
	if blob == "" {
		return 0
	}
	env, err := DecodeEnvelope([]byte(blob))
	if err != nil {
		return 0
	}
	return env.Sequence
}

// RunStatusHint is a cheap existence probe (used by resume before hitting PG).
func (b *Bus) HasReplay(ctx context.Context, runID string) bool {
	n, err := b.rdb.Exists(ctx, runStreamKey(runID)).Result()
	return err == nil && n > 0
}
