// Package auth — 2026-09-19 security-audit regression suite.
//
// Every test here pins one confirmed audit finding to a permanent regression
// test, using the audit's own reproduction steps:
//
//	finding 2 (HIGH): LogMailer wrote live reset links into the log;
//	finding 3 (HIGH): OAuth auto-linked onto attacker-seeded unverified
//	                  accounts (pre-hijacking);
//	needs-validation: SMTP path continued in cleartext when the relay did
//	                  not offer STARTTLS.
//
// The rate-limiter member finding (4) is covered in internal/agent and
// validation; the compose/Dockerfile secret finding (1) is a repository
// hygiene fix (no committed secret left to test against — config loading of
// the secret-file variant is covered in internal/config).
package auth

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/domain"
)

// ---- finding 2: LogMailer -------------------------------------------------------

// captureLog redirects slog's default logger into a buffer (the production
// LogMailer logs through slog's default) and returns the restore function.
func captureLog(t *testing.T) (*bytes.Buffer, func()) {
	t.Helper()
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	return &buf, func() { slog.SetDefault(prev) }
}

// TestAudit_LogMailerNeverLogsCredentialLink pins the audit's exact probe:
// the default (zero-value) LogMailer records a password-reset event WITHOUT
// the link — a log reader must not be able to extract a live token and take
// over the account.
func TestAudit_LogMailerNeverLogsCredentialLink(t *testing.T) {
	link := "https://app.example.test/reset-password?token=SGVsbG8.aGVsbG8"

	buf, restore := captureLog(t)
	defer restore()

	m := LogMailer{} // zero value: the committed dev default
	if err := m.SendPasswordReset(context.Background(), "victim@example.test", link); err != nil {
		t.Fatalf("send: %v", err)
	}

	out := buf.String()
	if !strings.Contains(out, "password_reset") {
		t.Fatalf("event metadata missing: %q", out)
	}
	if strings.Contains(out, "SGVsbG8") || strings.Contains(out, link) {
		t.Fatalf("CREDENTIAL LEAK: reset link/token present in log output: %q", out)
	}
	if strings.Contains(out, "token=") {
		t.Fatalf("credential-shaped query present in log output: %q", out)
	}
}

// TestAudit_LogMailerOptInLinkLogging: the dev-only NEXAU_MAIL_LOG_LINKS=true
// path DOES include the link (local convenience), and says so.
func TestAudit_LogMailerOptInLinkLogging(t *testing.T) {
	link := "https://app.example.test/reset-password?token=abc.def"

	buf, restore := captureLog(t)
	defer restore()

	m := LogMailer{LogLinks: true}
	if err := m.SendVerification(context.Background(), "dev@localhost", link); err != nil {
		t.Fatalf("send: %v", err)
	}
	if !strings.Contains(buf.String(), link) {
		t.Fatalf("opt-in link logging missing: %q", buf.String())
	}
	if !strings.Contains(buf.String(), `"link_logged":true`) {
		t.Fatalf("opt-in flag not recorded: %q", buf.String())
	}
}

// ---- finding 3: OAuth pre-hijacking --------------------------------------------

// TestAudit_OAuthPreHijackUnverifiedSeedRefused reproduces the audit's
// account takeover: an attacker registers the victim's email (password set by
// the attacker, never verified), then the victim signs in with Google.
// Before the fix, the Google identity auto-linked onto the seeded account and
// the attacker's password kept working — a persistent ATO. Now the link is
// refused with OAUTH_ACCOUNT_UNVERIFIED and the account is untouched.
func TestAudit_OAuthPreHijackUnverifiedSeedRefused(t *testing.T) {
	env := newOAuthTestEnv(t)

	// Attacker seed: local password account on the victim's email, unverified.
	env.oauth.byEmail["victim@example.test"] = &domain.User{
		ID: "usr_seed", Email: "victim@example.test", DisplayName: "Victim",
		Status: "active", AuthProvider: "local", EmailVerified: false,
	}

	u, _, err := env.runOAuth(t, "google-sub-victim", "victim@example.test")

	var de *domain.Error
	if !errors.As(err, &de) || de.Code != "OAUTH_ACCOUNT_UNVERIFIED" {
		t.Fatalf("want OAUTH_ACCOUNT_UNVERIFIED, got %v", err)
	}
	if u != nil {
		t.Fatalf("no user must be returned on refusal, got %+v", u)
	}

	// The seeded account must be UNTOUCHED: still local, still unverified,
	// no Google subject bound.
	seeded := env.oauth.byEmail["victim@example.test"]
	if seeded.AuthProvider != "local" || seeded.EmailVerified || env.oauth.subByUser["usr_seed"] != "" {
		t.Fatalf("attacker-seeded account was mutated: %+v sub=%q", seeded, env.oauth.subByUser["usr_seed"])
	}
	if _, linked := env.oauth.bySub["google-sub-victim"]; linked {
		t.Fatal("google subject must not be bound by a refused link")
	}
}

// TestAudit_OAuthLinkVerifiedAccountSucceedsAndNotifies: a VERIFIED password
// account still links (the legitimate flow), and the owner is notified —
// closing the audit's "victim never notified" gap.
func TestAudit_OAuthLinkVerifiedAccountSucceedsAndNotifies(t *testing.T) {
	env := newOAuthTestEnv(t)
	mail := &captureMailer{}
	env.svc.Mail = mail

	env.oauth.byEmail["real@example.test"] = &domain.User{
		ID: "usr_real", Email: "real@example.test", DisplayName: "Real",
		Status: "active", AuthProvider: "local", EmailVerified: true,
	}
	env.tenants.byUser["usr_real"] = []memTenant{{tenantID: "ten_real", role: "owner"}}

	u, _, err := env.runOAuth(t, "google-sub-real", "real@example.test")
	if err != nil {
		t.Fatalf("verified link must succeed: %v", err)
	}
	if u == nil || u.AuthProvider != "google" {
		t.Fatalf("link did not complete: %+v", u)
	}
	if len(mail.linkedNotices) != 1 || mail.linkedNotices[0] != "real@example.test" {
		t.Fatalf("owner notification missing: %+v", mail.linkedNotices)
	}
}

// TestAudit_OAuthLoginAndProvisionUnaffected: case 1 (known subject) and
// case 3 (fresh provision) behave exactly as before the gate.
func TestAudit_OAuthLoginAndProvisionUnaffected(t *testing.T) {
	env := newOAuthTestEnv(t)

	// Case 3: nobody known → provision.
	u1, _, err := env.runOAuth(t, "google-sub-a", "fresh@example.test")
	if err != nil || u1 == nil || u1.AuthProvider != "google" {
		t.Fatalf("provision broken: %v %+v", err, u1)
	}
	// Case 1: same subject again → login.
	u2, _, err := env.runOAuth(t, "google-sub-a", "fresh@example.test")
	if err != nil || u2 == nil || u2.ID != u1.ID {
		t.Fatalf("login broken: %v %+v", err, u2)
	}
}

// TestAudit_ResetPasswordFlipsVerified: consuming a password-reset token
// proves mailbox control and flips email_verified — the escape hatch that
// lets the legitimate owner of an unverified seeded account take it over.
func TestAudit_ResetPasswordFlipsVerified(t *testing.T) {
	fx := newSignupFixture(t) // from signup_test.go: users + recovery + mail

	if _, err := fx.svc.Register(context.Background(), "hijack@example.test", "attacker-password", "", "1.2.3.4", "ua"); err != nil {
		t.Fatalf("register: %v", err)
	}
	u, err := fx.users.ByEmail(context.Background(), "hijack@example.test")
	if err != nil || u == nil {
		t.Fatalf("seeded user missing: %v", err)
	}
	if u.EmailVerified {
		t.Fatal("precondition: freshly registered account must be unverified")
	}

	if err := fx.svc.ForgotPassword(context.Background(), "hijack@example.test", "1.2.3.4", "test"); err != nil {
		t.Fatalf("forgot: %v", err)
	}
	fx.mail.mu.Lock()
	resets := len(fx.mail.resets)
	fx.mail.mu.Unlock()
	if resets == 0 {
		t.Fatal("no reset mail captured")
	}
	token := tokenFromLink(fx.mail.resets[resets-1])
	if token == "" {
		t.Fatalf("cannot extract token from link")
	}

	if err := fx.svc.ResetPassword(context.Background(), token, "BrandNewPassword1!"); err != nil {
		t.Fatalf("reset: %v", err)
	}
	after, err := fx.users.ByID(context.Background(), u.ID)
	if err != nil || after == nil {
		t.Fatalf("user gone: %v", err)
	}
	if !after.EmailVerified {
		t.Fatal("password reset must flip email_verified (mailbox control proven)")
	}
}

// ---- needs-validation: SMTP mandatory TLS ---------------------------------------

// TestAudit_SMTPRefusesCleartextRelay: a relay that does NOT offer STARTTLS
// is refused before any credential or message byte is sent (the audit's
// cleartext-reset-link delivery path).
func TestAudit_SMTPRefusesCleartextRelay(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Skipf("no loopback listener: %v", err)
	}
	defer ln.Close()

	var sawEnvelope bool
	var mu sync.Mutex
	done := make(chan struct{})
	defer close(done)
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				r := bufio.NewReader(c)
				_, _ = c.Write([]byte("220 plaintext-relay\r\n"))
				for {
					line, err := r.ReadString('\n')
					if err != nil {
						return
					}
					cmd := strings.ToUpper(strings.TrimSpace(line))
					switch {
					case strings.HasPrefix(cmd, "EHLO"):
						// NO STARTTLS advertised — the misconfigured relay.
						_, _ = c.Write([]byte("250-plaintext-relay\r\n250 OK\r\n"))
					case strings.HasPrefix(cmd, "MAIL"), strings.HasPrefix(cmd, "RCPT"):
						mu.Lock()
						sawEnvelope = true
						mu.Unlock()
						_, _ = c.Write([]byte("250 OK\r\n"))
					default:
						_, _ = c.Write([]byte("250 OK\r\n"))
					}
				}
			}(conn)
		}
	}()

	addr := ln.Addr().String()
	host, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatalf("split: %v", err)
	}
	var port int
	for _, c := range portStr {
		port = port*10 + int(c-'0')
	}

	m := SMTPMailer{Host: host, Port: port, From: "no-reply@example.test", SSL: false}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err = m.SendPasswordReset(ctx, "victim@example.test", "https://app.example.test/reset?token=x.y")
	if err == nil {
		t.Fatal("cleartext relay must be refused")
	}
	if !strings.Contains(err.Error(), "STARTTLS") {
		t.Fatalf("refusal must name the missing STARTTLS extension, got: %v", err)
	}
	mu.Lock()
	sent := sawEnvelope
	mu.Unlock()
	if sent {
		t.Fatal("message envelope must never be sent to a cleartext relay")
	}
}
