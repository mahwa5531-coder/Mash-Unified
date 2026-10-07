package bifrost

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/mash-cloud/mash-api/internal/domain"
	"github.com/mash-cloud/mash-api/internal/observability"
)

const (
	// maxSSELine bounds a single SSE data line (a chunk payload). Model
	// deltas are small; a huge line signals a protocol fault or abuse.
	maxSSELine = 1 << 20 // 1 MiB
)

// StreamReader consumes a Bifrost SSE stream incrementally. It:
//   - parses "data: …" lines and the "[DONE]" sentinel,
//   - feeds an idle watchdog (no chunk within IdleTimeout → abort upstream),
//   - propagates context cancellation to the underlying connection,
//   - exposes the raw data line for zero-reserialization passthrough,
//   - is closed exactly once; Close is idempotent and aborts the upstream
//     request when the stream ends early.
type StreamReader struct {
	ctx     context.Context
	parent  context.Context // the caller's (run) context: distinguishes idle-abort from external cancel
	body    io.ReadCloser
	cancel  context.CancelFunc
	reader  *bufio.Reader
	metrics *observability.Metrics
	cb      *circuitBreaker // receives mid-stream gateway-fault outcomes

	idleTimer   *time.Timer
	timerMu     sync.Mutex
	lastResetAt time.Time
	closed      sync.Once
	done        bool

	// lastID remembers the last SSE id for diagnostics.
	lastID string
}

func newStreamReader(ctx context.Context, body io.ReadCloser, metrics *observability.Metrics, cb *circuitBreaker) *StreamReader {
	wctx, cancel := context.WithCancel(ctx)
	sr := &StreamReader{
		ctx:     wctx,
		parent:  ctx,
		body:    body,
		cancel:  cancel,
		reader:  bufio.NewReaderSize(body, 64<<10),
		metrics: metrics,
		cb:      cb,
	}
	// Idle watchdog: fires when no event arrives within the window. It must
	// BOTH cancel the local context (error classification) AND close the
	// response body: a blocked network Read only observes context
	// cancellation of the REQUEST context, not of this derived context, so
	// cancel() alone would leave the Read blocked until the total-duration
	// cap. Closing the body aborts the upstream request immediately — same
	// abort semantic as Close(), telling Bifrost to stop pulling from the
	// provider — and unblocks the pending Read.
	idle, _ := ctx.Value(idleTimeoutKey{}).(time.Duration)
	if idle <= 0 {
		idle = 300 * time.Second
	}
	sr.idleTimer = time.AfterFunc(idle, func() {
		cancel()
		_ = body.Close()
	})
	return sr
}

type idleTimeoutKey struct{}

// WithIdleTimeout attaches the stream idle timeout to the call context.
func WithIdleTimeout(ctx context.Context, d time.Duration) context.Context {
	return context.WithValue(ctx, idleTimeoutKey{}, d)
}

// Next returns the next decoded chunk. raw is the original SSE data payload
// (for passthrough). done=true marks a clean end ([DONE] or EOF after DONE).
// A non-nil error is terminal: the stream must be closed.
func (sr *StreamReader) Next() (chunk *ChatChunk, raw []byte, done bool, err error) {
	for {
		if sr.ctx.Err() != nil {
			err := sr.idleOrCancelError()
			sr.cbOnTimeout(err)
			return nil, nil, false, err
		}
		line, readErr := sr.readLine()
		sr.resetIdle()
		if readErr != nil {
			// The read may have been unblocked by the idle watchdog or an abort
			// closing the body: classify from the stream context first, so a
			// watchdog abort surfaces as MODEL_TIMEOUT (stream-idle) instead of
			// a misleading protocol error.
			if sr.ctx.Err() != nil {
				err := sr.idleOrCancelError()
				sr.cbOnTimeout(err)
				return nil, nil, false, err
			}
			if errors.Is(readErr, context.Canceled) || errors.Is(readErr, io.ErrClosedPipe) {
				err := sr.idleOrCancelError()
				sr.cbOnTimeout(err)
				return nil, nil, false, err
			}
			if errors.Is(readErr, context.DeadlineExceeded) {
				sr.cbFail() // read deadline: upstream stalled past the idle window
				return nil, nil, false, domain.ErrUpstreamTimeout("stream-read")
			}
			if sr.done {
				return nil, nil, true, nil // clean EOF after [DONE]
			}
			sr.cbFail() // raw termination without [DONE]: gateway fault
			return nil, nil, false, domain.ErrStreamProtocol("upstream stream terminated unexpectedly")
		}
		if len(line) == 0 {
			continue // blank separator line
		}
		switch line[0] {
		case ':':
			continue // comment/keepalive (": ping")
		case 'd', 'e':
			// data: or event: prefixes
			field, value, ok := splitSSELine(line)
			if !ok {
				continue
			}
			switch string(field) {
			case "data":
				if string(value) == "[DONE]" {
					sr.done = true
					return nil, nil, true, nil
				}
				c, derr := decodeChunk(value)
				if derr != nil {
					sr.cbFail() // upstream sent non-JSON SSE data
					return nil, nil, false, domain.ErrStreamProtocol("malformed stream chunk")
				}
				if c != nil {
					if c.ID != "" {
						sr.lastID = c.ID
					}
					// An in-band Bifrost error chunk (200 stream with error
					// payload) surfaces as a domain error immediately.
					if berr := errorFromChunk(c); berr != nil {
						return nil, nil, false, berr
					}
				}
				if sr.metrics != nil {
					sr.metrics.BifrostStreamEvents.Add(sr.ctx, 1)
				}
				return c, value, false, nil
			case "event":
				// Bifrost chat-completions streams use data-only lines; event
				// lines from other surface routes are ignored safely.
			case "id":
				sr.lastID = string(value)
			}
		default:
			// Unknown field: ignore per SSE spec.
		}
	}
}

// readLine reads one SSE line with a bounded buffer. Long lines are an
// upstream protocol fault: abort rather than buffer. The read deadline is the
// idle window itself: a read that outlives it means the watchdog should fire.
func (sr *StreamReader) readLine() ([]byte, error) {
	type deadlineSetter interface{ SetReadDeadline(time.Time) error }
	if ds, ok := sr.body.(deadlineSetter); ok {
		_ = ds.SetReadDeadline(time.Now().Add(sr.idleWindow()))
	}
	var collected []byte
	for {
		if len(collected) > maxSSELine {
			return nil, domain.ErrStreamProtocol("SSE line exceeds limit")
		}
		line, isPrefix, err := sr.reader.ReadLine()
		collected = append(collected, line...)
		if err != nil {
			return nil, err
		}
		if !isPrefix {
			return collected, nil
		}
		// continue accumulating a long line up to the bound
	}
}

func (sr *StreamReader) resetIdle() {
	sr.timerMu.Lock()
	sr.lastResetAt = time.Now()
	if sr.idleTimer != nil {
		sr.idleTimer.Reset(sr.idleWindow())
	}
	sr.timerMu.Unlock()
}

func (sr *StreamReader) idleWindow() time.Duration {
	if v, ok := sr.ctx.Value(idleTimeoutKey{}).(time.Duration); ok && v > 0 {
		return v
	}
	return 300 * time.Second
}

func (sr *StreamReader) idleOrCancelError() error {
	// Our own watchdog (or Close) cancelled the stream context while the
	// caller's context is still alive: that is, by elimination, the idle
	// watchdog firing — the timer reset bookkeeping can be off by the read
	// latency at the boundary, so this deterministic check wins.
	if sr.parent.Err() == nil && sr.ctx.Err() != nil {
		return domain.ErrUpstreamTimeout("stream-idle")
	}
	if time.Since(sr.lastReset()) > sr.idleWindow() {
		return domain.ErrUpstreamTimeout("stream-idle")
	}
	if sr.done {
		return io.EOF
	}
	return domain.ErrCancelled
}

func (sr *StreamReader) lastReset() time.Time {
	sr.timerMu.Lock()
	defer sr.timerMu.Unlock()
	return sr.lastResetAt
}

// LastID reports the last upstream event id (diagnostics).
func (sr *StreamReader) LastID() string { return sr.lastID }

// cbFail records a mid-stream gateway fault to the circuit breaker.
func (sr *StreamReader) cbFail() {
	if sr.cb != nil {
		sr.cb.recordFailure()
	}
}

// cbOnTimeout records ONLY the idle-watchdog outcome: idleOrCancelError
// conflates several benign endings (client cancellation, run-manager abort,
// clean close) with the one breaker-relevant case — the upstream stalled and
// the watchdog fired (MODEL_TIMEOUT). Everything else must not count.
func (sr *StreamReader) cbOnTimeout(err error) {
	if sr.cb == nil || err == nil {
		return
	}
	if de, ok := err.(*domain.Error); ok && de.Code == "MODEL_TIMEOUT" {
		sr.cb.recordFailure()
	}
}

// Close aborts the upstream request and releases resources. Safe to call
// multiple times; after Close, Next returns an error.
func (sr *StreamReader) Close() error {
	var err error
	sr.closed.Do(func() {
		sr.timerMu.Lock()
		if sr.idleTimer != nil {
			sr.idleTimer.Stop()
		}
		sr.timerMu.Unlock()
		sr.cancel()
		err = sr.body.Close()
	})
	return err
}

func decodeChunk(raw []byte) (*ChatChunk, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	c := &ChatChunk{}
	if err := json.Unmarshal(raw, c); err != nil {
		return nil, err
	}
	return c, nil
}

// errorFromChunk detects BifrostError payloads riding inside 200-OK streams.
func errorFromChunk(c *ChatChunk) error {
	if !c.IsError() {
		return nil
	}
	ef := c.Error
	if ef == nil {
		ef = &ErrorField{}
	}
	be := &ErrorResponse{
		Type:           c.Type,
		IsBifrostError: true,
		StatusCode:     c.StatusCode,
		Error:          *ef,
	}
	if be.StatusCode == 0 {
		be.StatusCode = http.StatusInternalServerError
	}
	return be.toDomain(be.StatusCode)
}

func splitSSELine(line []byte) (field, value []byte, ok bool) {
	for i := 0; i < len(line); i++ {
		if line[i] == ':' {
			// "data:" without space, "data: x", "data:x"
			rest := line[i+1:]
			if len(rest) > 0 && rest[0] == ' ' {
				rest = rest[1:]
			}
			return trimCR(line[:i]), trimCR(rest), true
		}
	}
	return nil, nil, false
}

func trimCR(b []byte) []byte {
	if len(b) > 0 && b[len(b)-1] == '\r' {
		return b[:len(b)-1]
	}
	return b
}
