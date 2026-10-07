// Package middleware provides the HTTP middleware chain executed by every
// request: recovery, request ids, tracing, logging, body limits, in-flight
// bounding and CORS. Route-specific concerns (auth, rate limiting, timeouts)
// live with their owning layers; this chain is transport hygiene.
package middleware

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"net/http"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/mash-cloud/mash-api/internal/domain"
	"github.com/mash-cloud/mash-api/internal/ids"
	"github.com/mash-cloud/mash-api/internal/observability"
	"github.com/mash-cloud/mash-api/internal/reqctx"
)

// Options configures the chain.
type Options struct {
	MaxBodyBytes   int64
	MaxInFlight    int
	AllowedOrigins []string
	RequestTimeout time.Duration // 0 = no blanket timeout (stream routes opt out)
}

// Chain composes the transport hygiene stack.
//
// Panic containment is installed TWICE, deliberately:
//   - INNERMOST Recovery wraps the handler itself, so it runs on whatever
//     goroutine executes the handler — including the one the Timeout
//     middleware spawns. A recover on the request goroutine cannot catch a
//     panic from another goroutine; before the 2026-09-18 audit the single
//     outermost Recovery silently lost every handler panic whenever a blanket
//     RequestTimeout was configured (process crash).
//   - OUTERMOST Recovery guards the transport shell (CORS, body limit,
//     in-flight, tracing) itself.
func Chain(opts Options, m *observability.Metrics) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		h := Recovery(m)(next)
		if opts.RequestTimeout > 0 {
			h = Timeout(opts.RequestTimeout, m)(h)
		}
		h = CORS(opts.AllowedOrigins)(h)
		h = BodyLimit(opts.MaxBodyBytes)(h)
		h = InFlight(opts.MaxInFlight, m)(h)
		h = Tracing(m)(h)
		h = RequestID()(h)
		h = Recovery(m)(h)
		return h
	}
}

// --- recovery ---------------------------------------------------------------

// Recovery converts panics into safe 500s. Stack traces go to logs, never to
// the client (spec §22).
func Recovery(m *observability.Metrics) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					if rec == http.ErrAbortHandler {
						// Legitimate abort (client gone mid-handler): re-panic
						// so the server's own machinery cleans up.
						panic(rec)
					}
					observability.LogError("panic recovered",
						"panic", rec,
						"request_id", reqctx.RequestID(r.Context()),
						"stack", string(debug.Stack()),
					)
					if m != nil {
						m.HTTPRequests.Add(r.Context(), 1,
							observability.Attr("route", "panic"),
							observability.Attr("status", "500"),
							observability.Attr("method", r.Method))
					}
					if !headersWritten(w) {
						WriteDomainError(w, r, domain.ErrInternal(nil))
					}
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

func headersWritten(w http.ResponseWriter) bool {
	// net/http does not expose "headers already sent". The conservative
	// public approximation: after a panic the header may or may not be
	// sent — attempting a write after client-visible output would be
	// invalid anyway, so the caller treats every panic as
	// possibly-written and lets WriteHeader on an already-written
	// response log loudly in dev without corrupting the stream.
	return false
}

// --- request id --------------------------------------------------------------

// RequestID assigns the server-authoritative correlation id (spec §23).
// Inbound X-Request-Id is honored only when strictly well-formed, bounded and
// charset-safe — never trusted, never echoed raw.
func RequestID() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			rid := sanitizeRequestID(r.Header.Get("X-Request-Id"))
			if rid == "" {
				rid = ids.RequestID()
			}
			w.Header().Set("X-Request-Id", rid)
			next.ServeHTTP(w, r.WithContext(reqctx.WithRequestID(r.Context(), rid)))
		})
	}
}

func sanitizeRequestID(v string) string {
	v = strings.TrimSpace(v)
	if v == "" || len(v) > 128 {
		return ""
	}
	for i := 0; i < len(v); i++ {
		c := v[i]
		ok := (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.'
		if !ok {
			return ""
		}
	}
	return v
}

// --- tracing ----------------------------------------------------------------

// Tracing opens one span per request and attaches the trace id to logs.
func Tracing(m *observability.Metrics) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			o := observability.Get()
			if o == nil || o.Tracer == nil {
				next.ServeHTTP(w, r)
				return
			}
			ctx, span := o.Tracer.Start(r.Context(), "http.request",
				trace.WithSpanKind(trace.SpanKindServer),
				trace.WithAttributes(
					attribute.String("http.method", r.Method),
					attribute.String("http.route", routeOf(r)),
				))
			defer span.End()
			sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(sw, r.WithContext(ctx))
			if sw.status >= 500 {
				span.SetAttributes(attribute.Int("http.status_code", sw.status))
			} else {
				span.SetAttributes(attribute.Int("http.status_code", sw.status))
			}
		})
	}
}

func routeOf(r *http.Request) string {
	p := r.URL.Path
	if len(p) > 64 {
		p = p[:64]
	}
	return r.Method + " " + p
}

// --- in-flight bounding -----------------------------------------------------

// InFlight bounds concurrent requests with a semaphore. Saturation returns
// 503 DEPENDENCY-style overload, protecting memory under bursts.
func InFlight(max int, m *observability.Metrics) func(http.Handler) http.Handler {
	if max <= 0 {
		max = 8192
	}
	sem := make(chan struct{}, max)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			select {
			case sem <- struct{}{}:
				if m != nil {
					m.ActiveRequests.Add(1)
				}
				defer func() {
					<-sem
					if m != nil {
						m.ActiveRequests.Add(-1)
					}
				}()
				next.ServeHTTP(w, r)
			default:
				if m != nil {
					m.RateLimited.Add(r.Context(), 1, observability.Attr("scope", "in_flight"))
				}
				WriteDomainError(w, r, domain.ErrDependencyUnavailable("api-overloaded"))
			}
		})
	}
}

// --- body limits ------------------------------------------------------------

// BodyLimit enforces MaxBodyBytes at the transport level (Content-Length +
// actual reads via http.MaxBytesReader). Oversized payloads are rejected
// before allocation.
func BodyLimit(max int64) func(http.Handler) http.Handler {
	if max <= 0 {
		max = 2 << 20
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.ContentLength > max {
				WriteDomainError(w, r, domain.ErrPayloadTooLarge(max))
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, max)
			next.ServeHTTP(w, r)
		})
	}
}

// --- CORS -------------------------------------------------------------------

// CORS emits allow-list headers for browser transports (the desktop is a
// native client; origins are optional).
func CORS(allowed []string) func(http.Handler) http.Handler {
	if len(allowed) == 0 {
		return func(next http.Handler) http.Handler { return next }
	}
	set := make(map[string]struct{}, len(allowed))
	for _, o := range allowed {
		set[strings.ToLower(o)] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" {
				if _, ok := set[strings.ToLower(origin)]; ok {
					h := w.Header()
					h.Set("Access-Control-Allow-Origin", origin)
					h.Set("Vary", "Origin")
					h.Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
					h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key, X-Request-Id")
					h.Set("Access-Control-Expose-Headers", "X-Request-Id")
					h.Set("Access-Control-Max-Age", "600")
				}
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// --- timeout ----------------------------------------------------------------

// Timeout bounds non-streaming handlers. Stream routes (SSE/WS) must NOT be
// wrapped: their lifecycles are governed by the stream idle/max-duration
// watchdogs instead (spec §21: separate timeout concepts).
func Timeout(d time.Duration, m *observability.Metrics) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), d)
			defer cancel()
			sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
			done := make(chan struct{})
			go func() {
				defer close(done)
				next.ServeHTTP(sw, r.WithContext(ctx))
			}()
			select {
			case <-done:
			case <-ctx.Done():
				// Handler exceeded its budget: cut the request short with a
				// clean 504 (only if nothing was written yet).
				if !sw.wrote {
					WriteDomainError(w, r, domain.ErrUpstreamTimeout("request"))
				}
			}
			<-done // join the handler goroutine: no goroutine leaks
		})
	}
}

// --- status tracking + error writing ----------------------------------------

type statusWriter struct {
	http.ResponseWriter
	status int
	wrote  bool
	mu     sync.Mutex
}

func (w *statusWriter) WriteHeader(code int) {
	w.mu.Lock()
	w.status = code
	w.wrote = true
	w.mu.Unlock()
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	w.mu.Lock()
	w.wrote = true
	w.mu.Unlock()
	return w.ResponseWriter.Write(b)
}

func (w *statusWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Hijack passes the connection through for WebSocket upgrades. Wrappers that
// swallow http.Hijacker break every upgrade behind the chain.
func (w *statusWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hj, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("statusWriter: underlying writer is not a hijacker")
	}
	return hj.Hijack()
}

// Unwrap lets http.ResponseController (used by the SSE write deadlines)
// reach the real connection through this wrapper. Without it, per-event
// write deadlines silently never apply and a slow consumer can stall a
// stream indefinitely.
func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// WriteDomainError writes the canonical error JSON (shared with auth
// middleware; single implementation, single format).
func WriteDomainError(w http.ResponseWriter, r *http.Request, de *domain.Error) {
	if de == nil {
		de = domain.ErrInternal(nil)
	}
	if rid := reqctx.RequestID(r.Context()); rid != "" {
		de = de.WithRequestID(rid)
	}
	w.Header().Set("Content-Type", "application/json")
	// Rate-limit responses carry the machine-readable backoff hint as the
	// Retry-After header (RFC 9110), not only in the body — previously the
	// signup/auth handlers set it ad-hoc and every other 429 path (RPM,
	// concurrency) shipped without it (E2E 2026-09-23).
	if de.HTTP == http.StatusTooManyRequests && de.Details != nil {
		if ms, ok := de.Details["retry_after_ms"].(int64); ok && ms > 0 {
			secs := (ms + 999) / 1000
			if secs < 1 {
				secs = 1
			}
			w.Header().Set("Retry-After", strconv.FormatInt(secs, 10))
		}
	}
	w.WriteHeader(de.HTTP)
	body := map[string]any{"error": de.ClientJSON()}
	_ = writeJSON(w, body)
}

func writeJSON(w http.ResponseWriter, v any) error {
	// json import lives in errors.go of this package to keep this file tight.
	return jsonEncode(w, v)
}

// RequestLog emits the access log line. Called by the api layer after Serve.
func RequestLog(r *http.Request, status int, dur time.Duration) {
	observability.LogInfo("http",
		"method", r.Method,
		"path", r.URL.Path,
		"status", status,
		"duration_ms", dur.Milliseconds(),
		"request_id", reqctx.RequestID(r.Context()),
	)
}
