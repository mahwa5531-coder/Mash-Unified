// Spec §3 (Authentication Test Matrix) and §4 (Authorization Test Matrix).
//
// Every rejection must happen BEFORE Bifrost is contacted, and the tenant ID
// is never taken from the client.
package validation

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/auth"
	"github.com/nexau-cloud/nexau-api/internal/streaming"
)

// TestV03_AuthMatrix drives the full authentication matrix against a live
// stack and verifies (a) correct status/code per case and (b) Bifrost is
// never called for rejected authentication.
func TestV03_AuthMatrix(t *testing.T) {
	cases := []struct {
		name   string
		auth   func(s *stack) string // full Authorization header value
		status int
		code   string
		noCall bool
	}{
		{
			name:   "valid access token proceeds",
			auth:   func(s *stack) string { return "Bearer " + s.tokenFor("usr_1", "ten_A") },
			status: http.StatusOK, code: "", noCall: false,
		},
		{
			name:   "expired token",
			auth:   func(s *stack) string { return "Bearer " + expiredToken(t, s) },
			status: http.StatusUnauthorized, code: "TOKEN_EXPIRED", noCall: true,
		},
		{
			name:   "invalid token (wrong signature)",
			auth:   func(s *stack) string { return "Bearer " + wrongSignerToken(t, s) },
			status: http.StatusUnauthorized, code: "UNAUTHORIZED", noCall: true,
		},
		{
			name:   "malformed token",
			auth:   func(s *stack) string { return "Bearer not-a-jwt-at-all" },
			status: http.StatusUnauthorized, code: "UNAUTHORIZED", noCall: true,
		},
		{
			name:   "empty bearer value",
			auth:   func(s *stack) string { return "Bearer " },
			status: http.StatusUnauthorized, code: "UNAUTHORIZED", noCall: true,
		},
		{
			name:   "wrong token type (Basic)",
			auth:   func(s *stack) string { return "Basic dXNyXzE6cGFzc3dvcmQ=" },
			status: http.StatusUnauthorized, code: "UNAUTHORIZED", noCall: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := newStackDefault(t)
			s.bifrost.setScript(standardScript()...)
			sess := s.sessionFor("auth", "ten_A", "usr_1")

			resp, err := postRunAuth(s, 0, tc.auth(s), sess, runBody("openai/gpt-4o", "ping", true))
			if err != nil {
				t.Fatalf("post: %v", err)
			}

			if tc.code == "" {
				// Valid: expect SSE events.
				events := readSSE(t, resp, streaming.EventRunFinished, 10*time.Second)
				if len(events) == 0 {
					t.Fatal("valid token: no events streamed")
				}
				if s.bifrost.count() == 0 {
					t.Fatal("valid token: Bifrost never called")
				}
				return
			}

			eb := decodeErr(t, resp)
			if resp.StatusCode != tc.status {
				t.Fatalf("status=%d want=%d (%s)", resp.StatusCode, tc.status, eb.Error.Code)
			}
			if eb.Error.Code != tc.code {
				t.Fatalf("code=%q want=%q", eb.Error.Code, tc.code)
			}
			if tc.noCall && s.bifrost.count() != 0 {
				t.Fatalf("rejected auth reached Bifrost: %d upstream calls", s.bifrost.count())
			}
		})
	}
}

// TestV03_MissingAuthorizationHeader: no header at all.
func TestV03_MissingAuthorizationHeader(t *testing.T) {
	s := newStackDefault(t)
	sess := s.sessionFor("auth", "ten_A", "usr_1")

	resp, err := http.Post(s.replicas[0].url+"/v1/agent/sessions/"+sess+"/runs", "application/json", strings.NewReader(runBody("openai/gpt-4o", "x", true)))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	eb := decodeErr(t, resp)
	if resp.StatusCode != http.StatusUnauthorized || eb.Error.Code != "UNAUTHORIZED" {
		t.Fatalf("got %d/%s", resp.StatusCode, eb.Error.Code)
	}
	if s.bifrost.count() != 0 {
		t.Fatal("missing header reached Bifrost")
	}
}

// TestV03_RevokedSession: blacklisted jti is rejected before Bifrost.
func TestV03_RevokedSession(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(standardScript()...)
	sess := s.sessionFor("auth", "ten_A", "usr_1")

	tok := s.tokenWithJTI("usr_1", "ten_A", "jti_revoked_1")

	// Before revocation: works.
	resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "x", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	events := readSSE(t, resp, streaming.EventRunFinished, 10*time.Second)
	if len(events) == 0 {
		t.Fatal("pre-revocation run failed")
	}

	// Revoke the session (server-side blacklist).
	if err := s.rdb.Set(context.Background(), "auth:blacklist:jti_revoked_1", "1", time.Hour).Err(); err != nil {
		t.Fatalf("blacklist: %v", err)
	}

	s.bifrost.reset()
	resp, err = s.postRun(0, tok, sess, runBody("openai/gpt-4o", "x", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	eb := decodeErr(t, resp)
	if resp.StatusCode != http.StatusUnauthorized || eb.Error.Code != "TOKEN_REVOKED" {
		t.Fatalf("revoked token: got %d/%s", resp.StatusCode, eb.Error.Code)
	}
	if s.bifrost.count() != 0 {
		t.Fatal("revoked token reached Bifrost")
	}
}

// TestV03_DisabledUser: suspended user rejected before Bifrost.
func TestV03_DisabledUser(t *testing.T) {
	s := newStackDefault(t)
	// The auth middleware gate returns a deliberately generic FORBIDDEN (no
	// account-state probing); the specific reason lives in server logs only.
	s.ids.mutate("usr_susp", "ten_A", func(id *auth.Identity) { id.User.Status = "suspended" })
	sess := s.sessionFor("auth", "ten_A", "usr_susp")

	resp, err := s.postRun(0, s.tokenFor("usr_susp", "ten_A"), sess, runBody("openai/gpt-4o", "x", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	eb := decodeErr(t, resp)
	if resp.StatusCode != http.StatusForbidden || eb.Error.Code != "FORBIDDEN" {
		t.Fatalf("suspended user: got %d/%s", resp.StatusCode, eb.Error.Code)
	}
	if s.bifrost.count() != 0 {
		t.Fatal("suspended user reached Bifrost")
	}
}

// TestV03_DisabledTenant: suspended tenant rejected before Bifrost.
func TestV03_DisabledTenant(t *testing.T) {
	s := newStackDefault(t)
	s.ids.mutate("usr_tsusp", "ten_S", func(id *auth.Identity) { id.Tenant.Status = "suspended" })
	sess := s.sessionFor("auth", "ten_S", "usr_tsusp")

	resp, err := s.postRun(0, s.tokenFor("usr_tsusp", "ten_S"), sess, runBody("openai/gpt-4o", "x", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	eb := decodeErr(t, resp)
	if resp.StatusCode != http.StatusForbidden || eb.Error.Code != "FORBIDDEN" {
		t.Fatalf("suspended tenant: got %d/%s (middleware returns generic FORBIDDEN; state never probed)", resp.StatusCode, eb.Error.Code)
	}
	if s.bifrost.count() != 0 {
		t.Fatal("suspended tenant reached Bifrost")
	}
}

// TestV04_AuthzMatrix: session ownership, cross-user, cross-tenant,
// subscription state, model entitlement.
func TestV04_AuthzMatrix(t *testing.T) {
	t.Run("user accessing own session", func(t *testing.T) {
		s := newStackDefault(t)
		s.bifrost.setScript(standardScript()...)
		sess := s.sessionFor("own", "ten_A", "usr_1")
		resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "x", true), nil)
		if err != nil {
			t.Fatalf("post: %v", err)
		}
		events := readSSE(t, resp, streaming.EventRunFinished, 10*time.Second)
		if len(events) == 0 {
			t.Fatal("own session run failed")
		}
	})

	t.Run("user accessing another user's session (same tenant)", func(t *testing.T) {
		s := newStackDefault(t)
		sess := s.sessionFor("foreign", "ten_A", "usr_x") // owned by usr_x
		resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "x", true), nil)
		if err != nil {
			t.Fatalf("post: %v", err)
		}
		eb := decodeErr(t, resp)
		if resp.StatusCode != http.StatusNotFound || eb.Error.Code != "NOT_FOUND" {
			t.Fatalf("cross-user session: got %d/%s", resp.StatusCode, eb.Error.Code)
		}
		if s.bifrost.count() != 0 {
			t.Fatal("cross-user session reached Bifrost")
		}
	})

	t.Run("user accessing another tenant's session", func(t *testing.T) {
		s := newStackDefault(t)
		sess := s.sessionFor("foreign", "ten_B", "usr_b1")
		resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "x", true), nil)
		if err != nil {
			t.Fatalf("post: %v", err)
		}
		eb := decodeErr(t, resp)
		if resp.StatusCode != http.StatusNotFound || eb.Error.Code != "NOT_FOUND" {
			t.Fatalf("cross-tenant session: got %d/%s", resp.StatusCode, eb.Error.Code)
		}
		if s.bifrost.count() != 0 {
			t.Fatal("cross-tenant session reached Bifrost")
		}
	})

	t.Run("canceled subscription", func(t *testing.T) {
		s := newStackDefault(t)
		sess := s.sessionFor("nosub", "ten_N", "usr_nosub")
		resp, err := s.postRun(0, s.tokenFor("usr_nosub", "ten_N"), sess, runBody("openai/gpt-4o", "x", true), nil)
		if err != nil {
			t.Fatalf("post: %v", err)
		}
		eb := decodeErr(t, resp)
		if resp.StatusCode != http.StatusForbidden || eb.Error.Code != "SUBSCRIPTION_INACTIVE" {
			t.Fatalf("inactive subscription: got %d/%s", resp.StatusCode, eb.Error.Code)
		}
		if s.bifrost.count() != 0 {
			t.Fatal("inactive subscription reached Bifrost")
		}
	})

	t.Run("past_due subscription grace period allows traffic", func(t *testing.T) {
		s := newStackDefault(t)
		s.bifrost.setScript(standardScript()...)
		sess := s.sessionFor("pastdue", "ten_P", "usr_pastdue")
		resp, err := s.postRun(0, s.tokenFor("usr_pastdue", "ten_P"), sess, runBody("openai/gpt-4o", "x", true), nil)
		if err != nil {
			t.Fatalf("post: %v", err)
		}
		events := readSSE(t, resp, streaming.EventRunFinished, 10*time.Second)
		if len(events) == 0 {
			t.Fatal("past_due (grace) run failed — spec: allow + meter")
		}
	})

	t.Run("disallowed model (allowlist)", func(t *testing.T) {
		s := newStackDefault(t)
		sess := s.sessionFor("restr", "ten_R", "usr_restr")
		resp, err := s.postRun(0, s.tokenFor("usr_restr", "ten_R"), sess, runBody("google/gemini-2", "x", true), nil)
		if err != nil {
			t.Fatalf("post: %v", err)
		}
		eb := decodeErr(t, resp)
		if resp.StatusCode != http.StatusForbidden || eb.Error.Code != "MODEL_NOT_ENTITLED" {
			t.Fatalf("disallowed model: got %d/%s", resp.StatusCode, eb.Error.Code)
		}
		if s.bifrost.count() != 0 {
			t.Fatal("disallowed model reached Bifrost")
		}
	})

	t.Run("allowlist pattern and exact match accepted", func(t *testing.T) {
		s := newStackDefault(t)
		s.bifrost.setScript(standardScript()...)
		sess := s.sessionFor("restr", "ten_R", "usr_restr")
		for _, m := range []string{"openai/gpt-4o", "anthropic/claude-4-sonnet"} {
			resp, err := s.postRun(0, s.tokenFor("usr_restr", "ten_R"), sess, runBody(m, "x", true), nil)
			if err != nil {
				t.Fatalf("post %s: %v", m, err)
			}
			events := readSSE(t, resp, streaming.EventRunFinished, 10*time.Second)
			if len(events) == 0 {
				t.Fatalf("entitled model %s rejected", m)
			}
		}
	})
}

// TestV04_ForgedTenantIDNotTrusted: client-supplied tenant_id / session_id in
// the body must never override the token-derived identity. The wire schema
// has no tenant field at all; a body session_id is ignored in favor of the
// path parameter — verified end-to-end.
func TestV04_ForgedTenantIDNotTrusted(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(standardScript()...)
	own := s.sessionFor("trust", "ten_A", "usr_1")
	foreign := s.sessionFor("foreign", "ten_B", "usr_b1")

	// Body claims a foreign session_id; the PATH decides.
	body := `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}],"stream":true,"session_id":"` + foreign + `"}`
	resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), own, body, nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	events := readSSE(t, resp, streaming.EventRunFinished, 10*time.Second)
	if len(events) == 0 {
		t.Fatal("run on own path session failed despite forged body session_id")
	}
	for _, e := range events {
		if e.env.SessionID != own {
			t.Fatalf("event session_id=%q, want own %q (body field must not redirect)", e.env.SessionID, own)
		}
	}

	// The upstream request must not carry any client tenant claim.
	up := s.bifrost.lastBody()
	if strings.Contains(up, `"tid"`) || strings.Contains(up, `"tenant`) {
		t.Fatalf("tenant claim leaked upstream: %s", up)
	}
}

// --- helpers ----------------------------------------------------------------

// postRunAuth issues a run request with a raw Authorization header value.
func postRunAuth(s *stack, i int, authHeader, sessionID, body string) (*http.Response, error) {
	req, err := http.NewRequest(http.MethodPost, s.replicas[i].url+"/v1/agent/sessions/"+sessionID+"/runs", strings.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", authHeader)
	req.Header.Set("Content-Type", "application/json")
	return http.DefaultClient.Do(req)
}

func expiredToken(t *testing.T, s *stack) string {
	t.Helper()
	tok, err := s.signer.Sign("usr_1", "ten_A", "member", "", "jti_exp", time.Now().Add(-2*time.Hour))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return tok
}

func wrongSignerToken(t *testing.T, s *stack) string {
	t.Helper()
	evil := auth.NewLocalSigner("ffffffffffffffffffffffffffffffffffffffffffff", s.cfg.Auth.Issuer, s.cfg.Auth.Audience, 0, time.Hour)
	tok, err := evil.Sign("usr_1", "ten_A", "member", "", "jti_evil", time.Now())
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return tok
}

// readAllBody drains a response body as string (for small JSON responses).
func readAllBody(t *testing.T, resp *http.Response) string {
	t.Helper()
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return ""
	}
	return string(b)
}
