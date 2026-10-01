package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/auth"
	"github.com/nexau-cloud/nexau-api/internal/domain"
)

// handleUsage: GET /v1/usage?from=RFC3339&to=RFC3339&by_model=true
//
// Tenant-scoped aggregation over authoritative usage_records (never
// client-reported counts). Window defaults to the trailing 30 days.
func (a *API) handleUsage(w http.ResponseWriter, r *http.Request) {
	idn := auth.FromIdentity(r.Context())
	if idn == nil {
		writeError(w, r, domain.ErrUnauthorized(nil))
		return
	}

	now := time.Now().UTC()
	to := now
	from := now.AddDate(0, 0, -30)
	if v := r.URL.Query().Get("from"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			writeError(w, r, domain.ErrValidation("from must be RFC3339"))
			return
		}
		from = t.UTC()
	}
	if v := r.URL.Query().Get("to"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			writeError(w, r, domain.ErrValidation("to must be RFC3339"))
			return
		}
		to = t.UTC()
	}
	if !from.Before(to) {
		writeError(w, r, domain.ErrValidation("from must precede to"))
		return
	}
	if to.Sub(from) > 366*24*time.Hour {
		writeError(w, r, domain.ErrValidation("usage windows are limited to 366 days"))
		return
	}

	summary, err := a.usage.Summary(r.Context(), idn.Tenant.ID, from, to)
	if err != nil {
		writeError(w, r, domain.AsError(mapUsageErr(err)))
		return
	}

	resp := map[string]any{
		"tenant_id":          summary.TenantID,
		"from":               summary.From,
		"to":                 summary.To,
		"calls":              summary.Calls,
		"input_tokens":       summary.InputTokens,
		"output_tokens":      summary.OutputTokens,
		"total_tokens":       summary.TotalTokens,
		"reasoning_tokens":   summary.ReasoningTokens,
		"cache_read_tokens":  summary.CacheReadTokens,
		"cache_write_tokens": summary.CacheWriteTokens,
		"total_cost":         summary.TotalCost,
	}

	if r.URL.Query().Get("by_model") == "true" {
		byModel, err := a.usage.ByModel(r.Context(), idn.Tenant.ID, from, to)
		if err != nil {
			writeError(w, r, domain.AsError(mapUsageErr(err)))
			return
		}
		resp["by_model"] = byModel
	}

	writeOK(w, resp)
}

func mapUsageErr(err error) *domain.Error {
	return domain.AsError(err)
}

var _ = strconv.Itoa
