package api

import (
	"net/http"
	"time"

	"github.com/mash-cloud/mash-api/internal/domain"
)

// handleLiveness: GET /health/live — process is up. Deliberately cheap:
// never touches PostgreSQL, Redis or Bifrost (a dependency blip must not
// get the pod killed by a liveness probe, spec §33).
func (a *API) handleLiveness(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok", "time": time.Now().UTC(),
	})
}

// handleReadiness: GET /health/ready — dependencies answer within budget.
// PostgreSQL and Redis are checked; Bifrost health is included only when
// configured (its absence does not make the API unready to serve auth,
// sessions or replay — LLM availability is not a liveness concern).
func (a *API) handleReadiness(w http.ResponseWriter, r *http.Request) {
	type dep struct {
		Name    string `json:"name"`
		OK      bool   `json:"ok"`
		Latency int64  `json:"latency_ms"`
	}
	var deps []dep
	status := http.StatusOK

	if a.pg != nil {
		start := time.Now()
		err := a.pg.Health(r.Context())
		deps = append(deps, dep{Name: "postgres", OK: err == nil, Latency: msSince(start)})
		if err != nil {
			status = http.StatusServiceUnavailable
		}
	}
	if a.redis != nil {
		start := time.Now()
		err := a.redis.Health(r.Context())
		deps = append(deps, dep{Name: "redis", OK: err == nil, Latency: msSince(start)})
		if err != nil {
			status = http.StatusServiceUnavailable
		}
	}
	if a.bifrost != nil && a.cfg.Bifrost.HealthURL != "" {
		start := time.Now()
		err := a.bifrost.Health(r.Context())
		deps = append(deps, dep{Name: "bifrost", OK: err == nil, Latency: msSince(start)})
		// Bifrost health affects serving readiness only when nothing else
		// failed: an LLM-gateway blip must not block auth/session traffic,
		// but it IS reported.
	}

	// Circuit-breaker state is informational: it never gates readiness
	// (matching the soft Bifrost posture above — auth, sessions and replay
	// must keep serving while the LLM path fast-fails).
	body := map[string]any{"status": "ok", "dependencies": deps, "time": time.Now().UTC()}
	if a.bifrost != nil {
		body["bifrost_circuit"] = a.bifrost.CircuitState()
	}
	if status != http.StatusOK {
		body["status"] = "unavailable"
	}
	writeJSON(w, status, body)
}

func msSince(t time.Time) int64 { return time.Since(t).Milliseconds() }

var _ = domain.ErrInternal // keep import shape stable for future codes
