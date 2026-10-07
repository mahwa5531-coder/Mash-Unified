package api

import (
	"net/http"
	"time"

	"github.com/mash-cloud/mash-api/internal/auth"
	"github.com/mash-cloud/mash-api/internal/domain"
	"github.com/mash-cloud/mash-api/internal/llm"
)

// handleMe: GET /v1/me — the resolved identity (server-authoritative, never
// client-supplied) including effective plan, limits, model entitlements and
// the live quota position (the same rolling-window computation the LLM-call
// gate uses — the desktop's usage bar can never diverge from enforcement).
func (a *API) handleMe(w http.ResponseWriter, r *http.Request) {
	idn := auth.FromIdentity(r.Context())
	if idn == nil {
		writeError(w, r, domain.ErrUnauthorized(nil))
		return
	}
	writeOK(w, a.meView(r, idn))
}

func (a *API) meView(r *http.Request, idn *auth.Identity) map[string]any {
	view := map[string]any{
		"user": map[string]any{
			"id": idn.User.ID, "email": idn.User.Email, "display_name": idn.User.DisplayName,
			"avatar_url": idn.User.AvatarURL, "status": idn.User.Status,
			"is_platform_admin": idn.User.IsPlatformAdmin,
			"email_verified":    idn.User.EmailVerified,
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
			"concurrent_requests_user":   idn.Limits.ConcurrentRequestsUser,
			"concurrent_requests_tenant": idn.Limits.ConcurrentRequestsTenant,
			"max_request_bytes":          idn.Limits.MaxRequestBytes,
			"window_5h_tokens":           idn.Limits.Window5hTokens,
			"window_weekly_tokens":       idn.Limits.WindowWeeklyTokens,
		},
		"models":     idn.Models,
		"restricted": idn.Restricted,
	}

	// Plan identity ("Free"/"Pro"): zero value only when no effective
	// subscription exists — still rendered, so the desktop can label state.
	view["plan"] = map[string]any{
		"id": idn.Plan.ID, "code": idn.Plan.Code, "name": idn.Plan.Name,
	}

	// Quota position: authoritative rolling-window normalized-token usage
	// (the exact sums the enforcement gate reads) PLUS the in-flight
	// reservation the gate holds against — the desktop bar renders the
	// same effective position enforcement uses, never a divergent one.
	// Computed here — NOT in the per-request identity resolver — so the
	// hot path stays quota-query-free; /v1/me is called at app start and
	// after calls, not per request.
	if (idn.Limits.Window5hTokens > 0 || idn.Limits.WindowWeeklyTokens > 0) && a.usage != nil {
		pos, err := a.usage.WindowUsage(r.Context(), idn.Tenant.ID)
		if err == nil {
			var reserved5h, reservedWeekly int64
			if a.reservationActive() {
				reserved5h = a.lim.Reserved(r.Context(), llm.ReservationKey5h(idn.Tenant.ID))
				reservedWeekly = a.lim.Reserved(r.Context(), llm.ReservationKeyWeekly(idn.Tenant.ID))
			}
			var windows []map[string]any
			if q := idn.Limits.Window5hTokens; q > 0 {
				windows = append(windows, a.windowView(r, idn, "5h", q, pos.Used5h, reserved5h, 5*time.Hour))
			}
			if q := idn.Limits.WindowWeeklyTokens; q > 0 {
				windows = append(windows, a.windowView(r, idn, "weekly", q, pos.UsedWeekly, reservedWeekly, 7*24*time.Hour))
			}
			view["quota"] = map[string]any{
				"currency": "normalized_tokens",
				"windows":  windows,
			}
		}
		// Query failure: omit the quota block entirely (degraded, not
		// wrong) — /v1/me must never fail because usage aggregation
		// hiccuped.
	}
	return view
}

// reservationActive reports whether the in-flight window reservation is
// enabled and wired (display parity with the gate's soft dimension).
func (a *API) reservationActive() bool {
	return a.proxy != nil && a.proxy.Reserve.Enabled && a.lim != nil
}

// windowView renders one window's customer-facing position. used is the
// completed-usage truth (llm_calls); reserved is the in-flight claim the gate
// holds against. The percent uses the EFFECTIVE position (used+reserved) so
// the bar shows 100% exactly when the gate rejects — including the
// reservation-pressure case, where the window is not exhausted but its
// remaining budget is claimed by running calls (retry shortly, no resets_at
// is published — the claim releases in seconds, not at window expiry).
// resets_at is present only when the completed usage itself binds.
func (a *API) windowView(r *http.Request, idn *auth.Identity, window string, quota, used, reserved int64, d time.Duration) map[string]any {
	effective := used + reserved
	percent := int64(0)
	if quota > 0 {
		percent = effective * 100 / quota
		if percent > 100 {
			percent = 100
		}
	}
	v := map[string]any{
		"window":          window,
		"used_tokens":     used,
		"reserved_tokens": reserved,
		"quota_tokens":    quota,
		"used_percent":    percent,
		"resets_at":       nil,
	}
	if used >= quota && a.usage != nil {
		if t, err := a.usage.WindowRecovery(r.Context(), idn.Tenant.ID, d, quota, used); err == nil && t != nil {
			v["resets_at"] = t.UTC()
		}
	}
	return v
}

// handleClientConfig: GET /v1/config — what the desktop needs to integrate:
// the LLM endpoint, limits and stream semantics. No secrets ever cross this
// line.
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
			"llm":    "POST /v1/chat/completions (OpenAI-compatible; model = \"provider/model\"; SSE when stream=true)",
			"events": "OpenAI chat-completions chunks, forwarded verbatim",
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
			"heartbeat_s":    int(a.cfg.StreamHeartbeatInterval.Seconds()),
			"terminal_event": "data: [DONE]",
		},
		"models":      models,
		"restricted":  idn.Restricted,
		"server_time": time.Now().UTC(),
	})
}
