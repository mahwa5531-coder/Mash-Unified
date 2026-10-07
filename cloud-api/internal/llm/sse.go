// SSE writer: incremental event forwarding over HTTP. Each event is flushed
// the moment it is produced — the API never buffers a complete model response.
// A periodic comment heartbeat keeps intermediaries alive and detects dead
// clients (write failure → context cancel → upstream abort).
package llm

import (
	"context"
	"net/http"
	"sync"
	"time"
)

// SSEWriter wraps an http.ResponseWriter as an event stream.
type SSEWriter struct {
	w        http.ResponseWriter
	ctrl     *http.ResponseController
	flusher  http.Flusher
	mu       sync.Mutex
	deadline time.Duration
	closed   bool
}

// NewSSEWriter prepares the response. It must be called before the first byte.
func NewSSEWriter(w http.ResponseWriter, deadline time.Duration) (*SSEWriter, error) {
	f, ok := w.(http.Flusher)
	if !ok {
		return nil, ErrNoFlusher
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream; charset=utf-8")
	h.Set("Cache-Control", "no-cache, no-transform")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no") // nginx: do not buffer this response
	w.WriteHeader(http.StatusOK)
	f.Flush()
	if deadline <= 0 {
		deadline = 10 * time.Second
	}
	return &SSEWriter{w: w, ctrl: http.NewResponseController(w), flusher: f, deadline: deadline}, nil
}

// ErrNoFlusher is returned when the transport cannot stream.
var ErrNoFlusher = &staticError{"SSE requires a flushing ResponseWriter"}

type staticError struct{ msg string }

func (e *staticError) Error() string { return e.msg }

// setWriteDeadline arms the per-event write deadline via the Response
// Controller: it descends through wrapper types that implement Unwrap(),
// so the deadline reaches the real connection even behind the middleware
// wrapper chain. A slow consumer that blocks a write past the deadline
// fails the write → the stream is aborted → upstream is cancelled.
func (s *SSEWriter) setWriteDeadline() {
	_ = s.ctrl.SetWriteDeadline(time.Now().Add(s.deadline))
}

// Event writes one envelope payload as an SSE event and flushes immediately.
// Write errors close the stream: the caller observes the error and cancels the
// upstream request.
func (s *SSEWriter) Event(blob []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return ErrSSEClosed
	}
	s.setWriteDeadline()
	if _, err := s.w.Write(prefixEvent); err != nil {
		s.closed = true
		return err
	}
	if _, err := s.w.Write(blob); err != nil {
		s.closed = true
		return err
	}
	if _, err := s.w.Write(suffixEvent); err != nil {
		s.closed = true
		return err
	}
	s.flusher.Flush()
	return nil
}

// Comment writes a keepalive comment line.
func (s *SSEWriter) Comment(text string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return ErrSSEClosed
	}
	s.setWriteDeadline()
	if _, err := s.w.Write([]byte(": " + text + "\n\n")); err != nil {
		s.closed = true
		return err
	}
	s.flusher.Flush()
	return nil
}

// ErrSSEClosed marks a terminated stream.
var ErrSSEClosed = &staticError{"SSE stream is closed"}

// Heartbeat pumps comments until stop is closed or the context dies. One
// goroutine per stream, clear lifecycle, released on stream end.
func (s *SSEWriter) Heartbeat(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 15 * time.Second
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := s.Comment("ping"); err != nil {
				return
			}
		}
	}
}

// Close finalizes the stream. Idempotent.
func (s *SSEWriter) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	s.closed = true
	s.flusher.Flush()
}

var (
	prefixEvent = []byte("data: ")
	suffixEvent = []byte("\n\n")
)
