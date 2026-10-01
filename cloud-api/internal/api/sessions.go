package api

import (
	"net/http"

	"github.com/nexau-cloud/nexau-api/internal/agent"
	"github.com/nexau-cloud/nexau-api/internal/auth"
	"github.com/nexau-cloud/nexau-api/internal/domain"
)

// handleCreateSession: POST /v1/agent/sessions
func (a *API) handleCreateSession(w http.ResponseWriter, r *http.Request) {
	idn := auth.FromIdentity(r.Context())
	if idn == nil {
		writeError(w, r, domain.ErrUnauthorized(nil))
		return
	}
	var in agent.CreateSessionInput
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, r, domain.ErrValidation("invalid session payload"))
		return
	}
	sess, derr := a.sessions.Create(r.Context(), idn, in)
	if derr != nil {
		writeError(w, r, derr)
		return
	}
	writeJSON(w, http.StatusCreated, sess)
}

// handleGetSession: GET /v1/agent/sessions/{session_id}
func (a *API) handleGetSession(w http.ResponseWriter, r *http.Request) {
	idn := auth.FromIdentity(r.Context())
	if idn == nil {
		writeError(w, r, domain.ErrUnauthorized(nil))
		return
	}
	sess, derr := a.sessions.Get(r.Context(), idn, r.PathValue("session_id"))
	if derr != nil {
		writeError(w, r, derr)
		return
	}
	writeOK(w, sess)
}

// handleCloseSession: DELETE /v1/agent/sessions/{session_id}
func (a *API) handleCloseSession(w http.ResponseWriter, r *http.Request) {
	idn := auth.FromIdentity(r.Context())
	if idn == nil {
		writeError(w, r, domain.ErrUnauthorized(nil))
		return
	}
	if derr := a.sessions.Close(r.Context(), idn, r.PathValue("session_id")); derr != nil {
		writeError(w, r, derr)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
