// §45 — 2026-09-19 security-audit end-to-end regressions.
//
// Every confirmed HIGH finding and the MEDIUM clusters, reproduced through
// the REAL router, middleware, Redis limiter and metering pipeline — the
// audit's own reproduction steps turned into permanent tests:
//
//	§45.1  finding 4 (HIGH): fixed X-Request-Id must NOT defeat per-user RPM
//	        quotas (audit: 20/20 billable runs under a 5/min plan).
//	§45.2  cluster B: plan monthly-token quota enforced at run creation
//	        (advertised in /v1/me, now binding).
//	§45.3  cluster B: fallback models must respect the restricted allowlist.
//	§45.4  finding 3 (HIGH): OAuth pre-hijacking — Google sign-in on an
//	        attacker-seeded unverified account is refused; the mailbox owner
//	        takes the account back via password reset and THEN links.
//	§45.5  cluster B: a WS connection dies shortly after logout (the token
//	        behind it is blacklisted), and the same token is dead on HTTP.
//	§45.6  cluster A: the previously-unthrottled unauthenticated surfaces
//	        (refresh, verify-email, oauth-begin) enforce per-IP budgets.
package validation

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
)

// ---- §45.1 — pinned X-Request-Id vs RPM quota -------------------------------

// TestV45_PinnedRequestIDCannotDefeatRPM: the audit's exact attack — every
// request carries the SAME X-Request-Id header under a 5/min identity — must
// still be throttled to 5 admitted + 6th rejected, with zero upstream work
// for the rejected call.
func TestV45_PinnedRequestIDCannotDefeatRPM(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(standardScript()...)
	sess := s.sessionFor("v45rid", "ten_L", "usr_lowrpm")
	tok := s.tokenFor("usr_lowrpm", "ten_L")

	hdrs := map[string]string{"X-Request-Id": "attacker-fixed-value-1234567890"}
	var ok, limited int
	for i := 1; i <= 6; i++ {
		resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", fmt.Sprintf("attack %d", i), false), hdrs)
		if err != nil {
			t.Fatalf("post %d: %v", i, err)
		}
		if resp.StatusCode == http.StatusOK {
			resp.Body.Close()
			ok++
		} else {
			eb := decodeErr(t, resp)
			if resp.StatusCode != http.StatusTooManyRequests || eb.Error.Code != "RATE_LIMITED" {
				t.Fatalf("request %d: %d/%s, want 429/RATE_LIMITED", i, resp.StatusCode, eb.Error.Code)
			}
			limited++
		}
	}
	if ok != 5 || limited != 1 {
		t.Fatalf("PINNED X-Request-Id bypassed the quota: allowed=%d limited=%d, want 5/1", ok, limited)
	}
	if n := s.bifrost.count(); n != 5 {
		t.Fatalf("upstream calls=%d, want 5 (the rejected request must not forward)", n)
	}
	vm(t, "sec45_pinned_request_id_blocked", 1)
}

// ---- §45.2 — plan monthly token quota -----------------------------------------

// TestV45_MonthlyTokenQuotaEnforced: the plan's monthly token quota binds at
// run creation. The standard script meters 60 tokens per run; a 100-token
// quota admits two runs (the second begins inside the quota — 60 < 100 at
// gate time) and rejects the third with PLAN_QUOTA_EXCEEDED once 120 are on
// the books. Runs that begin inside the quota always finish.
func TestV45_MonthlyTokenQuotaEnforced(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(standardScript()...)
	sess := s.sessionFor("v45q", "ten_Q", "usr_quota")
	tok := s.tokenFor("usr_quota", "ten_Q")

	run := func(i int) (int, string) {
		resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", fmt.Sprintf("q %d", i), false), nil)
		if err != nil {
			t.Fatalf("post %d: %v", i, err)
		}
		defer resp.Body.Close()
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
		eb := errBody{}
		_ = json.Unmarshal(raw, &eb)
		return resp.StatusCode, eb.Error.Code
	}
	// Runs 1 and 2: admitted (60, then 120 on the books; the gate checks
	// the PRE-run state — 60 < 100 at run 2's gate — so it finishes).
	if code, ec := run(1); code != http.StatusOK {
		t.Fatalf("run 1: %d/%s, want 200 (fresh quota)", code, ec)
	}
	waitFor(t, 5*time.Second, func() bool { return s.usage.total().InputTokens > 0 })
	if code, ec := run(2); code != http.StatusOK {
		t.Fatalf("run 2: %d/%s, want 200 (60 < 100 at gate time)", code, ec)
	}
	waitFor(t, 5*time.Second, func() bool {
		tt := s.usage.total()
		return tt.InputTokens+tt.OutputTokens >= 120
	})

	// Run 3: rejected — the quota is exhausted.
	code, ec := run(3)
	if code != http.StatusTooManyRequests || ec != "PLAN_QUOTA_EXCEEDED" {
		t.Fatalf("run 3: %d/%s, want 429/PLAN_QUOTA_EXCEEDED", code, ec)
	}
	// The rejected run created no billable work.
	if n := s.bifrost.count(); n != 2 {
		t.Fatalf("upstream calls=%d, want exactly 2 (quota rejection must precede the call)", n)
	}

	// A different tenant with no quota is unaffected (gate is per-plan).
	sessA := s.sessionFor("v45qa", "ten_A", "usr_1")
	if code, ec := run2(s, 0, s.tokenFor("usr_1", "ten_A"), sessA); code != http.StatusOK {
		t.Fatalf("unquota'd tenant: %d/%s, want 200", code, ec)
	}
	vm(t, "sec45_quota_enforced", 1)
}

func run2(s *stack, i int, tok, sess string) (int, string) {
	resp, err := s.postRun(i, tok, sess, runBody("openai/gpt-4o", "no quota", false), nil)
	if err != nil {
		return 0, err.Error()
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	eb := errBody{}
	_ = json.Unmarshal(raw, &eb)
	return resp.StatusCode, eb.Error.Code
}

// ---- §45.3 — fallback entitlement ----------------------------------------------

// TestV45_FallbacksRespectRestrictedAllowlist: on a restricted identity, an
// off-allowlist PRIMARY model is rejected, and — the audit's actual bypass —
// an off-allowlist FALLBACK behind an entitled primary is rejected too.
func TestV45_FallbacksRespectRestrictedAllowlist(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(standardScript()...)
	sess := s.sessionFor("v45fb", "ten_R", "usr_restr")
	tok := s.tokenFor("usr_restr", "ten_R")

	post := func(body string) (int, string) {
		resp, err := s.postRun(0, tok, sess, body, nil)
		if err != nil {
			t.Fatalf("post: %v", err)
		}
		defer resp.Body.Close()
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
		eb := errBody{}
		_ = json.Unmarshal(raw, &eb)
		return resp.StatusCode, eb.Error.Code
	}

	// Control: entitled primary + entitled fallback → 200.
	okCode, _ := post(`{"model":"openai/gpt-4o","messages":[{"role":"user","content":"hi"}],"stream":false,"fallbacks":["anthropic/claude-3"]}`)
	if okCode != http.StatusOK {
		t.Fatalf("entitled fallback rejected: %d", okCode)
	}

	// The bypass: entitled primary, off-allowlist fallback → 403.
	code, ec := post(`{"model":"openai/gpt-4o","messages":[{"role":"user","content":"hi"}],"stream":false,"fallbacks":["meta/llama-3-70b"]}`)
	if code != http.StatusForbidden || ec != "MODEL_NOT_ENTITLED" {
		t.Fatalf("off-allowlist fallback: %d/%s, want 403/MODEL_NOT_ENTITLED", code, ec)
	}
	if n := s.bifrost.count(); n != 1 {
		t.Fatalf("upstream calls=%d, want 1 (the entitlement rejection must precede the call)", n)
	}
	vm(t, "sec45_fallback_entitlement", 1)
}

// ---- §45.4 — OAuth pre-hijacking through the real router ----------------------

// TestV45_OAuthPreHijackBlockedAndRecovered: the audit's full account-takeover
// chain, end to end: attacker seeds an unverified password account on the
// victim's email; the victim's Google sign-in is REFUSED (no auto-link); the
// victim proves mailbox control with a password reset (which flips
// email_verified); only then does Google link — and the attacker's original
// password no longer works.
func TestV45_OAuthPreHijackBlockedAndRecovered(t *testing.T) {
	s := newV42Stack(t, v42Opts{signup: true})

	// 1. The attacker registers the victim's email with their own password.
	code, out, _, _ := s.post(t, "/v1/auth/register", map[string]any{
		"email": "victim@example.test", "password": "attacker-password", "display_name": "Victim",
	}, "")
	if code != http.StatusCreated {
		t.Fatalf("attacker seed register: %d %v", code, out)
	}

	// 2. The victim signs in with Google → the auto-link is REFUSED.
	s.google.setClaims(func() jwt.MapClaims {
		return jwt.MapClaims{
			"iss": "https://accounts.google.com", "aud": "v42-client-id",
			"sub": "google-sub-victim", "email": "victim@example.test",
			"email_verified": true, "name": "Actual Victim",
			"iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix(),
		}
	})
	c := s.browser(t)
	resp, err := c.Get(s.apiBase + "/v1/auth/oauth/google")
	if err != nil {
		t.Fatalf("victim google sign-in: %v", err)
	}
	defer resp.Body.Close()
	if got := resp.Request.URL.Query().Get("error"); got != "OAUTH_ACCOUNT_UNVERIFIED" {
		t.Fatalf("pre-hijack gate: error=%q, want OAUTH_ACCOUNT_UNVERIFIED (final url %s)", got, resp.Request.URL)
	}

	// 3. The account is untouched: still a local password account, no
	//    Google subject bound, still unverified (the login gate keeps the
	//    attacker out too — EMAIL_NOT_VERIFIED — but that is the pre-
	//    existing hardening, not the link policy).
	s.users.mu.Lock()
	seeded := s.users.byEm["victim@example.test"]
	s.users.mu.Unlock()
	if seeded == nil || seeded.AuthProvider != "local" {
		t.Fatalf("refused link mutated the account: %+v", seeded)
	}
	if linked, has := s.oauth.subByUser[seeded.ID]; has || linked != "" {
		t.Fatalf("google subject bound by a refused link: %q", linked)
	}

	// 4. The victim resets the password — proving mailbox control — which
	//    also flips email_verified.
	fc, _, _, _ := s.post(t, "/v1/auth/password/forgot", map[string]any{
		"email": "victim@example.test",
	}, "")
	if fc != http.StatusAccepted {
		t.Fatalf("forgot: %d", fc)
	}
	s.mail.mu.Lock()
	resets := len(s.mail.resets)
	s.mail.mu.Unlock()
	if resets == 0 {
		t.Fatal("no reset mail captured")
	}
	token := tokenFromLink(s.mail.resets[resets-1])
	rc, ro, _, _ := s.post(t, "/v1/auth/password/reset", map[string]any{
		"token": token, "new_password": "victim-new-password",
	}, "")
	if rc != http.StatusOK {
		t.Fatalf("reset: %d %v", rc, ro)
	}

	// 5. NOW the victim's Google sign-in links and succeeds.
	c2 := s.browser(t)
	resp2, err := c2.Get(s.apiBase + "/v1/auth/oauth/google")
	if err != nil {
		t.Fatalf("victim google retry: %v", err)
	}
	defer resp2.Body.Close()
	grant := resp2.Request.URL.Query().Get("grant")
	if !strings.HasPrefix(grant, "wgrant_") {
		t.Fatalf("post-recovery google sign-in must link: error=%q url=%s",
			resp2.Request.URL.Query().Get("error"), resp2.Request.URL)
	}

	// 6. The attacker's password is dead: the reset replaced it.
	xc, _, _, _ := s.post(t, "/v1/auth/login", map[string]any{
		"email": "victim@example.test", "password": "attacker-password",
	}, "")
	if xc == http.StatusOK {
		t.Fatal("attacker's old password still works after the victim's reset — takeover not inverted")
	}
	vm(t, "sec45_pre_hijack_blocked", 1)
}

// ---- §45.5 — WS connection vs logout -------------------------------------------

// TestV45_WSConnectionDiesAfterLogout: logout blacklists the access token's
// jti; the LIVE WebSocket is re-checked on the next heartbeat and closed
// with 1008, and the same token is refused on plain HTTP.
func TestV45_WSConnectionDiesAfterLogout(t *testing.T) {
	s := newStackDefault(t)
	sess := s.sessionFor("v45ws", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	conn, _, err := dialWS(t, s.replica(0).url, tok, sess)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	// Logout with the same bearer: blacklists this jti (Redis), revokes nothing else.
	req, _ := http.NewRequest(http.MethodPost, s.replica(0).url+"/v1/auth/logout", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	lresp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("logout: %v", err)
	}
	lresp.Body.Close()
	if lresp.StatusCode != http.StatusOK {
		t.Fatalf("logout: %d", lresp.StatusCode)
	}

	// HTTP is dead immediately.
	mresp, err := s.get(0, tok, "/v1/me")
	if err != nil {
		t.Fatalf("me: %v", err)
	}
	mresp.Body.Close()
	if mresp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("revoked token on HTTP: %d, want 401", mresp.StatusCode)
	}

	// The live WS dies on the next heartbeat tick (50 ms in the harness).
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	for {
		_, _, err := conn.ReadMessage()
		if err == nil {
			continue
		}
		ce, ok := err.(*websocket.CloseError)
		if !ok {
			t.Fatalf("ws closed with unexpected error: %v", err)
		}
		if ce.Code != websocket.ClosePolicyViolation {
			t.Fatalf("ws close code = %d, want 1008 (policy violation)", ce.Code)
		}
		break
	}
	vm(t, "sec45_ws_revocation", 1)
}

// ---- §45.6 — unauthenticated-surface throttles ---------------------------------

// TestV45_UnauthSurfacesThrottled: refresh, verify-email and oauth-begin —
// the audit's completely-unthrottled unauth surfaces (PG/Redis work per
// request) — now enforce per-IP budgets.
func TestV45_UnauthSurfacesThrottled(t *testing.T) {
	// --- refresh (standard stack, budget 3/15m) ---
	s := newStack(t, func() stackOpts {
		o := defaultOpts()
		o.refreshPerIP = 3
		return o
	}())
	var saw429 bool
	for i := 0; i < 4; i++ {
		resp, err := http.Post(s.replica(0).url+"/v1/auth/refresh",
			"application/json", strings.NewReader(`{"refresh_token":"nxr_garbage"}`))
		if err != nil {
			t.Fatalf("refresh %d: %v", i, err)
		}
		resp.Body.Close()
		if resp.StatusCode == http.StatusTooManyRequests {
			if i < 3 {
				t.Fatalf("refresh throttled early at %d", i)
			}
			saw429 = true
			break
		}
	}
	if !saw429 {
		t.Fatal("refresh flood never throttled (cluster A regression)")
	}

	// --- verify-email (signup stack, shared signup budget) ---
	sv := newV41Stack(t, 3, 0)
	saw429 = false
	for i := 0; i < 4; i++ {
		code, _, _ := sv.post(t, "/v1/auth/email/verify", map[string]any{"token": "garbage"})
		if code == http.StatusTooManyRequests {
			if i < 3 {
				t.Fatalf("verify-email throttled early at %d", i)
			}
			saw429 = true
			break
		}
	}
	if !saw429 {
		t.Fatal("verify-email flood never throttled (cluster A regression)")
	}

	// --- oauth-begin (oauth stack, budget 2/15m) ---
	so := newV42Stack(t, v42Opts{oauthPerIP: 2})
	// No redirect following: one begin hop = one counted request (the
	// callback shares the same per-IP bucket — following would double-count).
	noFollow := &http.Client{CheckRedirect: func(req *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	saw429 = false
	for i := 0; i < 3; i++ {
		resp, err := noFollow.Get(so.apiBase + "/v1/auth/oauth/google")
		if err != nil {
			t.Fatalf("begin %d: %v", i, err)
		}
		io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		resp.Body.Close()
		if resp.StatusCode == http.StatusTooManyRequests {
			if i < 2 {
				t.Fatalf("oauth-begin throttled early at %d", i)
			}
			saw429 = true
			break
		}
	}
	if !saw429 {
		t.Fatal("oauth-begin flood never throttled (cluster A regression)")
	}
	vm(t, "sec45_unauth_throttles", 1)
}
