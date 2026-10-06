package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/agent"
	"github.com/nexau-cloud/nexau-api/internal/auth"
	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/reqctx"
	"github.com/nexau-cloud/nexau-api/internal/streaming"
)

// handleChatCompletions: POST /v1/agent/chat/completions
//
// OpenAI-compatible pass-through for the existing NexAU
// LLMConfig(api_type="openai_chat_completion") client: point OPENAI_BASE_URL
// at the cloud and everything else keeps working. Full pipeline enforcement
// (auth, entitlement, rate limits, idempotency, metering); an implicit
// session is derived deterministically per user. Raw SSE bytes are forwarded
// verbatim after validation — no re-serialization on the hot path.
func (a *API) handleChatCompletions(w http.ResponseWriter, r *http.Request) {
	idn := auth.FromIdentity(r.Context())
	if idn == nil {
		writeError(w, r, domain.ErrUnauthorized(nil))
		return
	}

	var req agent.RunRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, domain.ErrValidation("invalid chat payload: "+jsonErrText(err)))
		return
	}
	if k := strings.TrimSpace(r.Header.Get("Idempotency-Key")); k != "" {
		if err := validIdemKey(k); err != nil {
			writeError(w, r, domain.ErrValidation("invalid Idempotency-Key header"))
			return
		}
		req.IdempotencyKey = k
	}

	// Implicit session (deterministic per user; lazily created).
	sctx, scancel := context.WithTimeout(r.Context(), 10*time.Second)
	sessionID, derr := a.runs.EnsureCompatSession(sctx, idn)
	scancel()
	if derr != nil {
		writeError(w, r, derr)
		return
	}

	resp, handle, derr := a.runs.CreateRun(r.Context(), idn, sessionID, &req)
	if derr != nil {
		writeError(w, r, derr)
		return
	}
	if resp != nil && handle == nil {
		// Synchronous outcome (stream=false execution or idempotent replay).
		// OpenAI-compatible contract: clients of this surface expect either
		// the RAW completion JSON body or an HTTP error — never the agent
		// run wrapper.
		if fe := resp.Failure(); fe != nil {
			writeError(w, r, fe.WithRequestID(reqctxFrom(r)))
			return
		}
		if len(resp.Completion) > 0 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(resp.Completion)
			return
		}
		// Replay of an outcome without a stored completion (e.g. cancelled).
		writeOK(w, resp)
		return
	}
	if handle == nil {
		// Defensive: service contract is resp-or-handle; never panic.
		writeError(w, r, domain.ErrInternal(nil))
		return
	}

	// req.Stream is necessarily true here: CreateRun only returns a live
	// handle for streaming runs (non-stream completes synchronously inside
	// CreateRun and returns resp with the raw completion payload).

	// Streaming: raw SSE pass-through with a LAZY writer (audit finding 8).
	// The HTTP 200 + SSE headers are committed only when the first upstream
	// byte is ready to forward. An upstream failure before that moment is
	// answered with a real HTTP error (OpenAI SDKs observe status + code);
	// a failure after bytes flowed is surfaced as an in-band OpenAI-style
	// error event before [DONE]. Never again 200 + bare [DONE].
	sink := &rawSSERawSink{
		w:          w,
		deadline:   a.cfg.WSWriteWait,
		hbInterval: a.cfg.WSHeartbeatInterval,
		cancel:     handle.Cancel,
		userID:     idn.User.ID,
		once:       sync.Once{},
	}

	go func() {
		select {
		case <-r.Context().Done():
			handle.Cancel(agent.NewCancelCause(agent.CancelDisconnect, idn.User.ID))
		case <-handle.Done():
		}
	}()

	derr = a.runs.ProduceRaw(idn, handle, &req, sink)
	if !sink.Started() {
		// Nothing ever reached the client: upstream failed pre-first-byte
		// (derr set, run finalized) or the transport could not start. Either
		// way the client receives a real HTTP error, never a bare 200.
		if derr == nil {
			derr = domain.ErrInternal(nil)
		}
		writeError(w, r, derr.WithRequestID(reqctxFrom(r)))
		return
	}
	sink.Finish() // stop heartbeat + terminal [DONE] frame + close
}

// reqctxFrom pulls the request id from the request context (middleware).
func reqctxFrom(r *http.Request) string {
	return reqctx.RequestID(r.Context())
}

// rawSSERawSink writes raw chunk payloads inside SSE framing. The SSE
// writer — and therefore the HTTP 200 + stream headers — is created lazily
// on the first forwarded byte so pre-stream upstream failures can still be
// answered with a proper HTTP error (audit finding 8).
type rawSSERawSink struct {
	w          http.ResponseWriter
	deadline   time.Duration
	hbInterval time.Duration
	cancel     context.CancelCauseFunc
	userID     string
	once       sync.Once

	mu     sync.Mutex
	sse    *streaming.SSEWriter
	hbStop context.CancelFunc
}

// start commits the response (200 + SSE headers) on first use and arms the
// heartbeat. Idempotent.
func (s *rawSSERawSink) start() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sse == nil {
		sse, err := streaming.NewSSEWriter(s.w, s.deadline)
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
func (s *rawSSERawSink) Started() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sse != nil
}

func (s *rawSSERawSink) SendChunk(raw []byte) error {
	if err := s.start(); err != nil {
		s.once.Do(func() { s.cancel(agent.NewCancelCause(agent.CancelDisconnect, s.userID)) })
		return err
	}
	if err := s.sse.Event(raw); err != nil {
		s.once.Do(func() { s.cancel(agent.NewCancelCause(agent.CancelDisconnect, s.userID)) })
		return err
	}
	return nil
}

// SendError writes one in-band OpenAI-style error object as an SSE event —
// the wire shape OpenAI SDKs treat as a streamed failure.
func (s *rawSSERawSink) SendError(errType, code, message string) error {
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
func (s *rawSSERawSink) Finish() {
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

// handleResponses: POST /v1/responses
// Canonical MASh inference endpoint. Speaks OpenAI Responses / Completions format
// with model alias resolution ("mash-agent" -> default model), raw SSE streaming,
// server-side rate limits, entitlements, and authoritative usage accounting.
func (a *API) handleResponses(w http.ResponseWriter, r *http.Request) {
	a.handleChatCompletions(w, r)
}

// handleChatCompletionsCancel: POST /v1/agent/chat/completions/cancel
func (a *API) handleChatCompletionsCancel(w http.ResponseWriter, r *http.Request) {
	idn := auth.FromIdentity(r.Context())
	if idn == nil {
		writeError(w, r, domain.ErrUnauthorized(nil))
		return
	}
	var body struct {
		RunID string `json:"run_id"`
	}
	_ = decodeJSON(r, &body)
	if body.RunID != "" && a.runs != nil {
		_, _ = a.runs.CancelRun(r.Context(), idn, body.RunID)
	}
	writeOK(w, map[string]any{"cancelled": true})
}

func validIdemKey(k string) error {
	if k == "" || len(k) > 256 {
		return errInvalid
	}
	for i := 0; i < len(k); i++ {
		c := k[i]
		ok := (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
			c == '_' || c == '-' || c == '.' || c == '/'
		if !ok {
			return errInvalid
		}
	}
	return nil
}

type strErr string

func (e strErr) Error() string { return string(e) }

const errInvalid = strErr("invalid")

func jsonErrText(err error) string {
	if err == nil {
		return ""
	}
	if _, ok := err.(errTrailingJSON); ok {
		return "body contains trailing JSON"
	}
	msg := err.Error()
	if len(msg) > 160 {
		msg = msg[:160] // validation hints must never leak internal detail
	}
	return msg
}
