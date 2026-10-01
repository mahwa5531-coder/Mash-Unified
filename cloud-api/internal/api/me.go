package api

import (
	"net/http"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/auth"
	"github.com/nexau-cloud/nexau-api/internal/domain"
)

// handleMe: GET /v1/me — the resolved identity (server-authoritative, never
// client-supplied) including effective limits and model entitlements.
func (a *API) handleMe(w http.ResponseWriter, r *http.Request) {
	idn := auth.FromIdentity(r.Context())
	if idn == nil {
		writeError(w, r, domain.ErrUnauthorized(nil))
		return
	}
	writeOK(w, meView(idn))
}

func meView(idn *auth.Identity) map[string]any {
	return map[string]any{
		"user": map[string]any{
			"id": idn.User.ID, "email": idn.User.Email, "display_name": idn.User.DisplayName,
			"status": idn.User.Status, "is_platform_admin": idn.User.IsPlatformAdmin,
			"email_verified": idn.User.EmailVerified,
		},
		"tenant": map[string]any{
			"id": idn.Tenant.ID, "slug": idn.Tenant.Slug, "name": idn.Tenant.Name, "status": idn.Tenant.Status,
		},
		"membership": map[string]any{
			"role": idn.Membership.Role, "status": idn.Membership.Status,
		},
		"subscription_status": idn.SubscriptionStatus,
		"limits": map[string]any{
			"requests_per_minute_user":   idn.Limits.RequestsPerMinuteUser,
			"requests_per_minute_tenant": idn.Limits.RequestsPerMinuteTenant,
			"concurrent_runs_user":       idn.Limits.ConcurrentRunsUser,
			"concurrent_runs_tenant":     idn.Limits.ConcurrentRunsTenant,
			"max_request_bytes":          idn.Limits.MaxRequestBytes,
			"monthly_token_quota":        idn.Limits.MonthlyTokenQuota,
		},
		"models":     idn.Models,
		"restricted": idn.Restricted,
	}
}

// handleClientConfig: GET /v1/config — what the desktop needs to integrate:
// endpoints, limits and stream semantics. No secrets ever cross this line.
func (a *API) handleClientConfig(w http.ResponseWriter, r *http.Request) {
	idn := auth.FromIdentity(r.Context())
	if idn == nil {
		writeError(w, r, domain.ErrUnauthorized(nil))
		return
	}
	models := idn.Models
	if !idn.Restricted {
		models = nil // unrestricted
	}
	writeOK(w, map[string]any{
		"version": "v1",
		"transports": map[string]any{
			"runs":   "POST /v1/agent/sessions/{session_id}/runs",
			"stream": "WS /v1/agent/sessions/{session_id}/stream",
			"compat": "POST /v1/agent/chat/completions",
			"cancel": "POST /v1/agent/runs/{run_id}/cancel",
			"events": "AG-UI envelope (event_id, run_id, sequence, type, data)",
		},
		"limits": map[string]any{
			"max_request_bytes": a.cfg.MaxBodyBytes,
			"max_messages":      a.cfg.MaxMessages,
			"max_tools":         a.cfg.MaxTools,
			"max_model_len":     a.cfg.MaxModelLen,
		},
		"stream": map[string]any{
			"idle_timeout_s": int(a.cfg.StreamIdleTimeout.Seconds()),
			"max_duration_s": int(a.cfg.StreamMaxDuration.Seconds()),
			"replay":         "resume{run_id, last_sequence} over the session WebSocket",
		},
		"heartbeat_interval_s": int(a.cfg.WSHeartbeatInterval.Seconds()),
		"models":               models,
		"restricted":           idn.Restricted,
		"server_time":          time.Now().UTC(),
	})
}
