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
			"responses": "POST /v1/responses",
			"compat":    "POST /v1/agent/chat/completions",
			"cancel":    "POST /v1/agent/chat/completions/cancel",
			"models":    "GET /v1/models",
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
		},
		"models":      models,
		"restricted":  idn.Restricted,
		"server_time": time.Now().UTC(),
	})
}

// handleModels: GET /v1/models
func (a *API) handleModels(w http.ResponseWriter, r *http.Request) {
	idn := auth.FromIdentity(r.Context())
	if idn == nil {
		writeError(w, r, domain.ErrUnauthorized(nil))
		return
	}
	models := []map[string]any{
		{
			"id":          "mash-agent",
			"object":      "model",
			"name":        "MASh Agent",
			"description": "Default multi-turn auditor agent model",
			"capabilities": map[string]any{
				"streaming": true,
				"tools":     true,
				"vision":    true,
			},
		},
	}
	for _, m := range idn.Models {
		if m != "" && m != "mash-agent" {
			models = append(models, map[string]any{
				"id":     m,
				"object": "model",
				"name":   m,
				"capabilities": map[string]any{
					"streaming": true,
					"tools":     true,
				},
			})
		}
	}
	writeOK(w, map[string]any{
		"object": "list",
		"data":   models,
	})
}

// handleMePlan: GET /v1/me/plan
func (a *API) handleMePlan(w http.ResponseWriter, r *http.Request) {
	idn := auth.FromIdentity(r.Context())
	if idn == nil {
		writeError(w, r, domain.ErrUnauthorized(nil))
		return
	}
	writeOK(w, map[string]any{
		"status": idn.SubscriptionStatus,
		"limits": idn.Limits,
		"models": idn.Models,
	})
}

// handleMeUsage: GET /v1/me/usage
func (a *API) handleMeUsage(w http.ResponseWriter, r *http.Request) {
	idn := auth.FromIdentity(r.Context())
	if idn == nil {
		writeError(w, r, domain.ErrUnauthorized(nil))
		return
	}
	now := time.Now().UTC()
	var usedTokens int64
	if a.usage != nil {
		if tokens, err := a.usage.MonthToDateTokens(r.Context(), idn.Tenant.ID); err == nil {
			usedTokens = tokens
		}
	}
	quota := idn.Limits.MonthlyTokenQuota
	usedPercent := 0.0
	if quota > 0 {
		usedPercent = float64(usedTokens) / float64(quota) * 100
		if usedPercent > 100 {
			usedPercent = 100
		}
	}
	writeOK(w, map[string]any{
		"user_id":           idn.User.ID,
		"tenant_id":         idn.Tenant.ID,
		"period":            now.Format("2006-01"),
		"used_tokens":       usedTokens,
		"quota_tokens":      quota,
		"used_percent":      usedPercent,
		"remaining_percent": 100.0 - usedPercent,
	})
}
