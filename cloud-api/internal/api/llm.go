package api

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/mash-cloud/mash-api/internal/auth"
	"github.com/mash-cloud/mash-api/internal/domain"
	"github.com/mash-cloud/mash-api/internal/llm"
	"github.com/mash-cloud/mash-api/internal/reqctx"
)

// handleChatCompletions: POST /v1/chat/completions
//
// THE LLM endpoint of the cloud: an OpenAI-compatible pass-through tunnel to
// the private Bifrost gateway. The desktop agent runtime points its
// OpenAI-style client at this endpoint (model = "provider/model"); everything
// agent-related (sessions, transcripts, tools, retries) stays on the desktop.
//
// Full pipeline enforcement happens in the proxy (auth → account state →
// validation → model entitlement → rolling 5h/weekly token windows →
// RPM + concurrency limits → Bifrost). Raw upstream SSE bytes are forwarded
// verbatim after validation — no re-serialization on the hot path. One
// llm_calls row meters the fact.
//
// Stream semantics (stream=true): SSE data: frames + [DONE], lazy headers —
// the HTTP 200 + SSE headers commit only when the first upstream byte is
// ready, so pre-stream upstream failures still answer with a real HTTP error
// (OpenAI SDKs observe status + code). A failure after bytes flowed surfaces
// as an in-band OpenAI-style error event before [DONE].
func (a *API) handleChatCompletions(w http.ResponseWriter, r *http.Request) {
	idn := auth.FromIdentity(r.Context())
	if idn == nil {
		writeError(w, r, domain.ErrUnauthorized(nil))
		return
	}

	var req llm.Request
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, domain.ErrValidation("invalid chat payload: "+jsonErrText(err)))
		return
	}

	if !req.Stream {
		// Synchronous path: gates → Bifrost → the completion JSON body.
		body, derr := a.proxy.Complete(r.Context(), idn, &req)
		if derr != nil {
			writeError(w, r, derr.WithRequestID(reqctx.RequestID(r.Context())))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(body)
		return
	}

	// Streaming path: raw SSE pass-through with a LAZY writer.
	sink := &sseRawSink{
		w:          w,
		deadline:   a.cfg.StreamWriteDeadline,
		hbInterval: a.cfg.StreamHeartbeatInterval,
		once:       sync.Once{},
	}
	derr := a.proxy.Stream(r.Context(), idn, &req, sink)
	if !sink.Started() {
		// Nothing ever reached the client: upstream failed pre-first-byte or
		// the transport could not start. Either way the client receives a
		// real HTTP error, never a bare 200.
		if derr == nil {
			derr = domain.ErrInternal(nil)
		}
		writeError(w, r, derr.WithRequestID(reqctx.RequestID(r.Context())))
		return
	}
	sink.Finish() // stop heartbeat + terminal [DONE] frame + close
}

// sseRawSink writes raw chunk payloads inside SSE framing. The SSE writer —
// and therefore the HTTP 200 + stream headers — is created lazily on the
// first forwarded byte so pre-stream upstream failures can still be answered
// with a proper HTTP error.
type sseRawSink struct {
	w          http.ResponseWriter
	deadline   time.Duration
	hbInterval time.Duration
	once       sync.Once

	mu     sync.Mutex
	sse    *llm.SSEWriter
	hbStop context.CancelFunc
}

// start commits the response (200 + SSE headers) on first use and arms the
// heartbeat. Idempotent.
func (s *sseRawSink) start() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sse == nil {
		sse, err := llm.NewSSEWriter(s.w, s.deadline)
		if err != nil {
			return err
		}
		s.sse = sse
		hbCtx, stop := context.WithCancel(context.Background())
		s.hbStop = stop
		go sse.Heartbeat(hbCtx, s.hbInterval)
	}
	return nil
}

// Started reports whether the response has been committed and bytes flowed.
func (s *sseRawSink) Started() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sse != nil
}

func (s *sseRawSink) SendChunk(raw []byte) error {
	if err := s.start(); err != nil {
		return err
	}
	return s.sse.Event(raw)
}

// SendError writes one in-band OpenAI-style error object as an SSE event —
// the wire shape OpenAI SDKs treat as a streamed failure.
func (s *sseRawSink) SendError(errType, code, message string) error {
	blob, err := json.Marshal(map[string]any{
		"error": map[string]string{
			"message": message,
			"type":    errType,
			"code":    code,
		},
	})
	if err != nil {
		return err
	}
	return s.SendChunk(blob)
}

// Finish terminates the SSE stream: stops the heartbeat, writes the [DONE]
// sentinel, closes. No-op when nothing was ever started.
func (s *sseRawSink) Finish() {
	s.mu.Lock()
	sse := s.sse
	stop := s.hbStop
	s.mu.Unlock()
	if stop != nil {
		stop()
	}
	if sse == nil {
		return
	}
	_ = sse.Event([]byte("[DONE]"))
	sse.Close()
}
