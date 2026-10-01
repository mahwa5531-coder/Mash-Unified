// wshandler adapts the WebSocket transport protocol to the agent service.
// Transport concerns (frames, pumps, close codes) stay in internal/streaming;
// business decisions (validation, authorization, metering) stay here — the
// boundary the spec §9 demands.
//
// Protocol (ARCHITECTURE §4.4):
//
//	C→S {"type":"run.create","request":{…}}  → creates + streams a run
//	C→S {"type":"run.cancel","run_id":"…"}   → cancellation anywhere
//	C→S {"type":"resume","run_id":"…","last_sequence":N}
//	C→S {"type":"ack","run_id":"…","sequence":N}
//	C→S {"type":"ping"}                       → {"type":"pong"}
package agent

import (
	"context"
	"encoding/json"

	"github.com/nexau-cloud/nexau-api/internal/auth"
	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/streaming"
)

// WSHandler implements streaming.ProtocolHandler.
type WSHandler struct {
	svc      *Service
	sessions *SessionService
	idn      *auth.Identity
	session  string
}

func NewWSHandler(svc *Service, sessions *SessionService, idn *auth.Identity, sessionID string) *WSHandler {
	return &WSHandler{svc: svc, sessions: sessions, idn: idn, session: sessionID}
}

// HandleMessage dispatches one decoded client frame.
func (h *WSHandler) HandleMessage(ctx context.Context, conn *streaming.Connection, msg streaming.ClientMessage) {
	switch msg.Type {
	case "run.create":
		h.runCreate(conn, msg.Request)
	case "run.cancel":
		h.runCancel(conn, msg.RunID)
	case "resume":
		h.resume(conn, msg.RunID, msg.LastSequence)
	case "ack":
		// Acknowledgement: reserved for future flow control. Runs are durable
		// in the bounded replay buffer; acks are advisory only.
	default:
		// Unknown types are rejected by the transport; reaching here is a bug.
		h.errFrame(conn, "UNKNOWN_FRAME", "Unsupported frame.")
	}
}

// runCreate validates + starts a run whose sink is the WS connection. The
// producer runs detached; its lifecycle is bound to this connection: if the
// connection ends, the run is cancelled (disconnect propagation, spec §20).
func (h *WSHandler) runCreate(conn *streaming.Connection, raw json.RawMessage) {
	if len(raw) == 0 {
		h.errFrame(conn, "INVALID_REQUEST", "run.create requires a request body.")
		return
	}
	req := &RunRequest{}
	if err := json.Unmarshal(raw, req); err != nil {
		h.errFrame(conn, "INVALID_REQUEST", "The run request body is malformed.")
		return
	}
	req.Stream = true // runs created over WS always stream

	// WS runs are not tied to the HTTP request: setup deadline via a fresh
	// context; the producer gets its own (cancellable) run context.
	resp, handle, derr := h.svc.CreateRun(context.Background(), h.idn, h.session, req)
	if derr != nil {
		h.errFrameWithCode(conn, derr)
		return
	}
	if resp != nil && handle == nil {
		// Idempotent replay of a prior run state: report it.
		_ = conn.SendControl(map[string]any{
			"type": "run.replay", "run": resp.Run,
		})
		return
	}
	if handle == nil {
		// Service contract violation (resp-or-handle): report, never
		// panic the connection goroutine on a nil handle.
		h.errFrame(conn, "INTERNAL", "Run creation returned no handle.")
		return
	}

	// Bind the run's lifecycle to this connection.
	conn.OnClose(func() {
		handle.Cancel(NewCancelCause(CancelDisconnect, h.idn.User.ID))
	})

	go h.svc.ProduceStream(h.idn, handle, req, conn)
}

// runCancel relays cancellation (may target a run on another instance).
func (h *WSHandler) runCancel(conn *streaming.Connection, runID string) {
	if runID == "" {
		h.errFrame(conn, "INVALID_REQUEST", "run.cancel requires run_id.")
		return
	}
	run, derr := h.svc.CancelRun(context.Background(), h.idn, runID)
	if derr != nil {
		h.errFrameWithCode(conn, derr)
		return
	}
	_ = conn.SendControl(map[string]any{
		"type": "run.cancel.ok", "run_id": runID, "status": run.Status,
	})
}

// resume replays buffered events after the client's last acknowledged
// sequence, then attaches live delivery (subscribe-first, replay-merge).
func (h *WSHandler) resume(conn *streaming.Connection, runID string, lastSequence int64) {
	if runID == "" {
		h.errFrame(conn, "INVALID_REQUEST", "resume requires run_id.")
		return
	}
	run, derr := h.svc.GetRun(context.Background(), h.idn, runID)
	if derr != nil {
		h.errFrameWithCode(conn, derr)
		return
	}

	// Subscribe live FIRST (gapless merge), then replay, then forward live
	// events with sequence > replayed maximum.
	live, err := h.svc.SubscribeLive(context.Background(), h.session)
	if err != nil {
		// No live leg: replay-only, still correct for terminal runs.
		live = nil
	}

	events, last, covered, rerr := h.svc.BusReplay(context.Background(), runID, lastSequence, 0)
	if rerr != nil {
		h.errFrameWithCode(conn, domain.AsError(rerr))
		if live != nil {
			live.Close()
		}
		return
	}
	if !covered {
		_ = conn.SendControl(map[string]any{
			"type": "RESUME_MISSED", "run_id": runID,
			"message": "The replay buffer no longer covers the requested sequence.",
			"status":  run.Status,
		})
		if live != nil {
			live.Close()
		}
		return
	}

	for _, env := range events {
		if env.RunID == runID {
			if err := conn.SendEvent(env); err != nil {
				if live != nil {
					live.Close()
				}
				return
			}
		}
	}
	_ = last

	_ = conn.SendControl(map[string]any{
		"type": "RESUME_OK", "run_id": runID, "replayed": len(events),
		"status": run.Status, "last_sequence": lastSequence,
	})

	if run.Terminal() || live == nil {
		if live != nil {
			live.Close()
		}
		return
	}

	// Forward live events for this run, deduped by sequence.
	go func() {
		defer live.Close()
		for {
			select {
			case <-conn.ClosedSignal():
				return
			case ev, ok := <-live.C:
				if !ok {
					return
				}
				env, err := streaming.DecodeEnvelope(ev.Blob)
				if err != nil || env.RunID != runID || env.Sequence <= last {
					continue
				}
				if env.Sequence == last+1 {
					last = env.Sequence
					if err := conn.SendEvent(env); err != nil {
						return
					}
				} else if env.Sequence > last+1 {
					// Gap: refill from the durable buffer.
					fill, _, ok2, _ := h.svc.BusReplay(context.Background(), runID, last, 0)
					if !ok2 {
						_ = conn.SendControl(map[string]any{
							"type": "RESUME_MISSED", "run_id": runID,
						})
						return
					}
					for _, f := range fill {
						if f.RunID == runID && f.Sequence > last {
							last = f.Sequence
							if err := conn.SendEvent(f); err != nil {
								return
							}
						}
					}
				}
			}
		}
	}()
}

// errFrame sends a safe error control frame.
func (h *WSHandler) errFrame(conn *streaming.Connection, code, message string) {
	_ = conn.SendControl(map[string]any{"type": "error", "code": code, "message": message})
}

// errFrameWithCode maps a domain error onto a control frame.
func (h *WSHandler) errFrameWithCode(conn *streaming.Connection, de *domain.Error) {
	if de == nil {
		de = domain.ErrInternal(nil)
	}
	body := map[string]any{"type": "error", "code": de.Code, "message": de.Message}
	if len(de.Details) > 0 {
		body["details"] = de.Details
	}
	_ = conn.SendControl(body)
}
