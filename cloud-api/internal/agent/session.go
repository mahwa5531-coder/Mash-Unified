// session.go: cloud-side agent session lifecycle. Sessions are authorization
// and attribution boundaries only — the desktop owns all agent state (spec
// §26). Creating a session is cheap (one row) and never blocks streaming.
package agent

import (
	"context"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/auth"
	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/ids"
)

// SessionService manages session metadata.
type SessionService struct {
	store   SessionsStore
	idleTTL time.Duration
}

func NewSessionService(store SessionsStore, idleTTL time.Duration) *SessionService {
	if idleTTL <= 0 {
		idleTTL = 24 * time.Hour
	}
	return &SessionService{store: store, idleTTL: idleTTL}
}

// CreateSessionInput is the client payload.
type CreateSessionInput struct {
	Metadata map[string]any `json:"metadata,omitempty"`
}

// SessionInfo is the client-visible session shape.
type SessionInfo struct {
	ID         string         `json:"id"`
	TenantID   string         `json:"tenant_id"`
	UserID     string         `json:"user_id"`
	Status     string         `json:"status"`
	Metadata   map[string]any `json:"metadata,omitempty"`
	CreatedAt  time.Time      `json:"created_at"`
	LastSeenAt time.Time      `json:"last_seen_at"`
	ExpiresAt  *time.Time     `json:"expires_at,omitempty"`
}

func infoOf(s *domain.Session, meta map[string]any) *SessionInfo {
	return &SessionInfo{
		ID: s.ID, TenantID: s.TenantID, UserID: s.UserID, Status: s.Status,
		Metadata: meta, CreatedAt: s.CreatedAt, LastSeenAt: s.LastSeenAt, ExpiresAt: s.ExpiresAt,
	}
}

// Create opens a session (idempotent metadata: labels only, never content).
func (s *SessionService) Create(ctx context.Context, idn *auth.Identity, in CreateSessionInput) (*SessionInfo, *domain.Error) {
	if len(in.Metadata) > 16 {
		return nil, domain.ErrValidation("metadata supports at most 16 keys")
	}
	for k, v := range in.Metadata {
		if len(k) > 64 {
			return nil, domain.ErrValidation("metadata keys must be ≤64 chars")
		}
		if str, ok := v.(string); ok && len(str) > 256 {
			return nil, domain.ErrValidation("metadata string values must be ≤256 chars")
		}
		if _, complex := v.(map[string]any); complex {
			return nil, domain.ErrValidation("metadata values must be scalar")
		}
		if _, complex := v.([]any); complex {
			return nil, domain.ErrValidation("metadata values must be scalar")
		}
	}
	meta := in.Metadata
	if meta == nil {
		meta = map[string]any{}
	}

	sess := &domain.Session{
		ID:        ids.SessionID(),
		TenantID:  idn.Tenant.ID,
		UserID:    idn.User.ID,
		Status:    domain.SessionActive,
		Metadata:  meta,
		ExpiresAt: ptrTime(time.Now().UTC().Add(s.idleTTL)),
	}
	if err := s.store.Create(ctx, sess); err != nil {
		return nil, mapDBErr(err)
	}
	return infoOf(sess, sess.Metadata), nil
}

// Get resolves a session tenant+user-scoped.
func (s *SessionService) Get(ctx context.Context, idn *auth.Identity, sessionID string) (*SessionInfo, *domain.Error) {
	sess, err := s.store.Get(ctx, idn.Tenant.ID, sessionID)
	if err != nil {
		return nil, mapDBErr(err)
	}
	if sess == nil || sess.UserID != idn.User.ID {
		return nil, domain.ErrSessionNotFound()
	}
	return infoOf(sess, sess.Metadata), nil
}

// Close ends a session; runs in it are unaffected (their own lifecycle rules).
func (s *SessionService) Close(ctx context.Context, idn *auth.Identity, sessionID string) *domain.Error {
	if err := s.store.Close(ctx, idn.Tenant.ID, sessionID); err != nil {
		if de, ok := err.(*domain.Error); ok {
			return de // repo already classified (session not found)
		}
		return storeMap(err)
	}
	return nil
}

// Touch refreshes liveness and slides the idle deadline (called on WS attach
// and run creation).
func (s *SessionService) Touch(ctx context.Context, tenantID, sessionID string) {
	_ = s.store.TouchSession(ctx, tenantID, sessionID, s.idleTTL)
}

func mapDBErr(err error) *domain.Error { return storeMap(err) }
