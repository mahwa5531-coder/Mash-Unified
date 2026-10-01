package api

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"sync"

	"github.com/nexau-cloud/nexau-api/internal/agent"
	"github.com/nexau-cloud/nexau-api/internal/auth"
	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/streaming"
)

// handleCreateRun: POST /v1/agent/sessions/{session_id}/runs
//
// stream=false → JSON RunResponse.
// stream=true  → SSE of AG-UI envelopes, forwarded incrementally (never
// buffered), heartbeat keepalive, disconnect → upstream cancellation.
func (a *API) handleCreateRun(w http.ResponseWriter, r *http.Request) {
	idn := auth.FromIdentity(r.Context())
	if idn == nil {
		writeError(w, r, domain.ErrUnauthorized(nil))
		return
	}
	sessionID := r.PathValue("session_id")

	var req agent.RunRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, domain.ErrValidation("invalid run payload: "+jsonErrText(err)))
		return
	}
	// Idempotency-Key header wins over the body field (documented contract).
	if k := strings.TrimSpace(r.Header.Get("Idempotency-Key")); k != "" {
		if err := validIdemKey(k); err != nil {
			writeError(w, r, domain.ErrValidation("invalid Idempotency-Key header"))
			return
		}
		req.IdempotencyKey = k
	}

	resp, handle, derr := a.runs.CreateRun(r.Context(), idn, sessionID, &req)
	if derr != nil {
		writeError(w, r, derr)
		return
	}
	if resp != nil {
		writeOK(w, resp)
		return
	}
	if handle == nil {
		// Defensive: service contract is resp-or-handle; never panic.
		writeError(w, r, domain.ErrInternal(nil))
		return
	}

	// stream=true: become the SSE producer on this handler goroutine.
	sse, err := streaming.NewSSEWriter(w, a.cfg.WSWriteWait)
	if err != nil {
		// Headers not yet usable: abort the run synchronously (terminal
		// state, slots, idempotency released) and report JSON. Waiting on
		// Done() here would deadlock — no producer was started.
		a.runs.AbortStream(idn, handle, &req, agent.CancelDisconnect)
		writeError(w, r, domain.ErrInternal(nil))
		return
	}

	sink := &sseEventSink{w: sse, cancel: handle.Cancel, userID: idn.User.ID, once: sync.Once{}}

	// Disconnect watcher: r.Context() dies when the client TCP connection
	// drops; cancel the run immediately (spec §20).
	go func() {
		select {
		case <-r.Context().Done():
			handle.Cancel(agent.NewCancelCause(agent.CancelDisconnect, idn.User.ID))
		case <-handle.Done():
		}
	}()

	// Heartbeat goroutine: bounded lifetime, ends with the run.
	hbCtx, hbStop := context.WithCancel(context.Background())
	defer hbStop()
	go sse.Heartbeat(hbCtx, a.cfg.WSHeartbeatInterval)

	a.runs.ProduceStream(idn, handle, &req, sink)
	hbStop()
	sse.Close()
}

// sseEventSink adapts the SSE writer into the agent EventSink. First write
// failure cancels the run promptly (upstream abort within one event).
type sseEventSink struct {
	w      *streaming.SSEWriter
	cancel context.CancelCauseFunc
	userID string
	once   sync.Once
}

func (s *sseEventSink) SendEvent(env *streaming.Envelope) error {
	if env == nil {
		return nil
	}
	if err := s.w.Event(env.Marshal()); err != nil {
		s.once.Do(func() { s.cancel(agent.NewCancelCause(agent.CancelDisconnect, s.userID)) })
		return err
	}
	return nil
}

// handleGetRun: GET /v1/agent/runs/{run_id} — resume-decision metadata.
func (a *API) handleGetRun(w http.ResponseWriter, r *http.Request) {
	idn := auth.FromIdentity(r.Context())
	if idn == nil {
		writeError(w, r, domain.ErrUnauthorized(nil))
		return
	}
	run, derr := a.runs.GetRun(r.Context(), idn, r.PathValue("run_id"))
	if derr != nil {
		writeError(w, r, derr)
		return
	}
	writeOK(w, runView(run))
}

func runView(run *domain.Run) map[string]any {
	v := map[string]any{
		"id": run.ID, "session_id": run.SessionID, "status": run.Status,
		"stream": run.Stream, "requested_model": run.RequestedModel,
		"started_at": run.StartedAt, "turn_id": run.TurnID,
	}
	if run.ResolvedModel != "" {
		v["resolved_model"] = run.ResolvedModel
	}
	if run.Provider != "" {
		v["provider"] = run.Provider
	}
	if run.ErrorCode != "" {
		v["error_code"] = run.ErrorCode
	}
	if run.CompletedAt != nil {
		v["completed_at"] = run.CompletedAt
	}
	return v
}

// handleCancelRun: POST /v1/agent/runs/{run_id}/cancel
//
// Idempotent: cancelling a terminal run returns its final state; cancelling
// a live run propagates upstream (local registry or cross-instance control
// channel). Always authenticated + tenant-scoped via GetRun.
func (a *API) handleCancelRun(w http.ResponseWriter, r *http.Request) {
	idn := auth.FromIdentity(r.Context())
	if idn == nil {
		writeError(w, r, domain.ErrUnauthorized(nil))
		return
	}
	run, derr := a.runs.CancelRun(r.Context(), idn, r.PathValue("run_id"))
	if derr != nil {
		writeError(w, r, derr)
		return
	}
	writeOK(w, runView(run))
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

var _ = strconv.Itoa
