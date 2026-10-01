package agent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/auth"
	"github.com/nexau-cloud/nexau-api/internal/bifrost"
	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/observability"
	"github.com/nexau-cloud/nexau-api/internal/reqctx"
)

// RawSink forwards upstream SSE payloads verbatim (the OpenAI-compatible
// surface: the existing NexAU LLMConfig client sees plain chat-completions
// chunks, zero desktop changes). One method per frame class.
type RawSink interface {
	// SendChunk forwards one SSE data payload (without the data:/[DONE]
	// framing — the transport writes framing).
	SendChunk(raw []byte) error
	// SendError delivers an in-band OpenAI-style error object once the
	// response has started streaming: standard OpenAI SDKs surface it as a
	// failure instead of a silent empty completion (audit finding 8).
	SendError(errType, code, message string) error
	// Started reports whether any byte has been forwarded to the client.
	Started() bool
}

// ProduceRaw streams a run with raw chunk pass-through: validation,
// entitlement, metering, rate limiting and lifecycle are fully enforced (it
// goes through CreateRun like every run); only the event mapping differs.
// Usage is still extracted from the final chunk for authoritative billing.
//
// Error contract (audit finding 8): a non-nil return means the UPSTREAM
// failed. Callers use Started() to pick the response shape — nothing flowed
// yet → real HTTP error; bytes already flowed → the in-band error event was
// emitted here and the caller closes the stream.
func (s *Service) ProduceRaw(idn *auth.Identity, handle *StreamHandle, req *RunRequest, sink RawSink) *domain.Error {
	defer handle.Finish()
	ctx := handle.ctx
	run := handle.Run

	bctx := bifrost.WithIdleTimeout(ctx, s.timing.IdleTimeout)
	bctx, durCancel := context.WithTimeout(bctx, s.timing.MaxDuration)
	defer durCancel()

	reader, err := s.bifrost.CompletionStream(bctx, req.ToBifrost())
	if err != nil {
		de := domain.AsError(err)
		s.finalize(ctx, idn, run, req, outcomeData{status: domain.RunFailed, errCode: de.Code})
		return de // pre-stream: caller answers with a real HTTP error
	}
	defer reader.Close()
	_ = s.runs.SetFirstEvent(ctx, run.TenantID, run.ID)

	var usage *domain.TokenUsage
	var model, provider string
	var latency int64
	forwarded := false

	for {
		chunk, raw, done, err := reader.Next()
		if err != nil {
			reason, by, cancelled := CauseInfo(ctx)
			if cancelled {
				status := domain.RunCancelled
				if reason == CancelDisconnect {
					status = domain.RunDisconnected
				}
				s.finalize(ctx, idn, run, req, outcomeData{
					status: status, cancelReason: reason, cancelBy: byOr(by, "system"),
					model: model, provider: provider, usage: usage, latencyMS: latency,
				})
				return nil // client gone: nothing left to report
			}
			de := domain.AsError(err)
			if forwarded && sink != nil {
				// Mid-stream failure: 200 + stream headers are already on the
				// wire and cannot be taken back. Emit the in-band OpenAI-style
				// error event so SDKs observe the failure instead of parsing
				// an empty successful completion.
				_ = sink.SendError(de.Code, de.Code, safeMessage(de))
			}
			s.finalize(ctx, idn, run, req, outcomeData{status: domain.RunFailed, errCode: de.Code})
			return de
		}
		if done {
			s.finalize(ctx, idn, run, req, outcomeData{
				status: domain.RunCompleted, model: model, provider: provider,
				usage: usage, latencyMS: latency,
			})
			return nil
		}
		if chunk != nil {
			if chunk.Usage != nil {
				usage = NormalizeUsage(chunk.Usage)
			}
			if chunk.Model != "" {
				model = chunk.Model
			}
			if chunk.ExtraFields != nil {
				if chunk.ExtraFields.Provider != "" {
					provider = chunk.ExtraFields.Provider
				}
				if chunk.ExtraFields.ModelDeployment != "" {
					model = chunk.ExtraFields.ModelDeployment
				} else if chunk.ExtraFields.ResolvedModelUsed != "" {
					model = chunk.ExtraFields.ResolvedModelUsed
				}
				if chunk.ExtraFields.Latency > 0 {
					latency = chunk.ExtraFields.Latency
				}
			}
		}
		if len(raw) > 0 {
			if err := sink.SendChunk(raw); err != nil {
				// Client gone: abort upstream, finalize as disconnected.
				handle.Cancel(NewCancelCause(CancelDisconnect, idn.User.ID))
				s.finalize(ctx, idn, run, req, outcomeData{
					status: domain.RunDisconnected, cancelReason: CancelDisconnect,
					cancelBy: idn.User.ID, model: model, provider: provider, usage: usage, latencyMS: latency,
				})
				return nil
			}
			forwarded = true
			if s.m != nil {
				s.m.EventsForwarded.Add(ctx, 1, observability.Attr("type", "raw_chunk"))
			}
		}
	}
}

// ImplicitSessionID derives the deterministic compat-surface session id for
// one user within a tenant. Stable across requests; created lazily.
func ImplicitSessionID(tenantID, userID string) string {
	h := sha256Hex([]byte("compat:" + tenantID + ":" + userID))
	return "sess_compat_" + h
}

// EnsureCompatSession creates the implicit session row when absent. Idempotent:
// concurrent creation collapses via the unique index.
func (s *Service) EnsureCompatSession(ctx context.Context, idn *auth.Identity) (string, *domain.Error) {
	sid := ImplicitSessionID(idn.Tenant.ID, idn.User.ID)
	sess, err := s.sessions.Get(ctx, idn.Tenant.ID, sid)
	if err != nil {
		return "", storeMap(err)
	}
	if sess != nil && sess.UserID == idn.User.ID && sess.Status == domain.SessionActive {
		return sid, nil
	}
	if sess != nil && sess.Status != domain.SessionActive {
		// Reactivate by creating a fresh implicit session generation.
		sid = sid + "_" + time.Now().UTC().Format("20060102150405")
	}
	newSess := &domain.Session{
		ID:        sid,
		TenantID:  idn.Tenant.ID,
		UserID:    idn.User.ID,
		Status:    domain.SessionActive,
		ExpiresAt: nil,
	}
	if err := s.sessions.Create(ctx, newSess); err != nil {
		if isUnique(err) {
			return sid, nil // raced with another request: already created
		}
		return "", storeMap(err)
	}
	observability.LogInfo("agent: implicit compat session created",
		"session_id", sid, "request_id", reqctx.RequestID(ctx))
	return sid, nil
}

func sha256Hex(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])[:26]
}
