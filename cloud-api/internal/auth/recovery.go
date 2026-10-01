package auth

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"log/slog"
	"net"
	"net/smtp"
	"strings"
	"time"
)

// Split-token construction (Paragonie, "Untangling the Forget-Me-Knot"):
// the token the user carries is "selector.verifier", both base64url.
//   - selector: 16 random bytes — indexed lookup key (DB-friendly);
//   - verifier: 32 random bytes — stored ONLY as sha256 hex (HashToken).
//
// Lookup and verification collapse into one atomic statement on
// (selector, token_hash): probing selectors reveals nothing, and a DB leak
// yields hashes, not tokens.
const (
	splitSelectorBytes = 16
	splitVerifierBytes = 32
)

// newSplitToken returns (raw, selector, verifierHash) where raw is what the
// user receives. The raw verifier never touches storage.
func newSplitToken() (raw, selector, verifierHash string) {
	sb := make([]byte, splitSelectorBytes)
	vb := make([]byte, splitVerifierBytes)
	if _, err := rand.Read(sb); err != nil {
		panic("auth: crypto/rand unavailable: " + err.Error())
	}
	if _, err := rand.Read(vb); err != nil {
		panic("auth: crypto/rand unavailable: " + err.Error())
	}
	selector = base64.RawURLEncoding.EncodeToString(sb)
	verifier := base64.RawURLEncoding.EncodeToString(vb)
	return selector + "." + verifier, selector, HashToken(verifier)
}

// parseSplitToken splits "selector.verifier"; malformed input yields ok=false.
func parseSplitToken(raw string) (selector, verifier string, ok bool) {
	i := strings.IndexByte(raw, '.')
	if i <= 0 || i == len(raw)-1 || len(raw) > 512 {
		return "", "", false
	}
	// Exactly one separator; verifiers/selectors are base64url (no dots).
	if strings.ContainsRune(raw[i+1:], '.') {
		return "", "", false
	}
	return raw[:i], raw[i+1:], true
}

// ---- mailer -------------------------------------------------------------------
//
// Transactional email is behind a narrow interface: dev/test deployments use
// LogMailer (metadata-only events in the structured log — no SMTP dependency
// in the sandbox), production uses SMTPMailer (stdlib net/smtp, AUTH + TLS).
// Swap in SES/SendGrid/Postmark by implementing the same methods.

// Mailer sends the account emails. Errors are logged by the caller and
// never fail the HTTP request (the user still gets a generic 202 — sending
// email must not become an account-existence oracle).
type Mailer interface {
	SendVerification(ctx context.Context, to, link string) error
	SendPasswordReset(ctx context.Context, to, link string) error
	// SendOAuthLinked notifies the account owner that a Google identity
	// was linked to their existing password account (anti-pre-hijacking
	// control: the owner of an unauthorized link learns about it —
	// 2026-09-19 audit, finding 3). Best-effort, never fails the sign-in.
	SendOAuthLinked(ctx context.Context, to string) error
}

// LogMailer records mail events as metadata ONLY (dev default).
//
// SECURITY (2026-09-19 audit, finding 2): a reset link is a single-use login
// credential — it is never written to the log by default. A committed default
// that logged live credentials turned every dev-shaped deployment (log mode)
// into a token leak via log aggregation. The link is included ONLY when the
// deployment explicitly opts in via NEXAU_MAIL_LOG_LINKS=true (local
// development convenience); the redaction deny-list independently redacts
// any "link"-shaped attribute regardless.
type LogMailer struct {
	LogLinks bool // dev-only: include the credential link in the event (default false)
}

func (m LogMailer) SendVerification(ctx context.Context, to, link string) error {
	m.event(ctx, "verification", to, link)
	return nil
}

func (m LogMailer) SendPasswordReset(ctx context.Context, to, link string) error {
	m.event(ctx, "password_reset", to, link)
	return nil
}

func (m LogMailer) SendOAuthLinked(ctx context.Context, to string) error {
	m.event(ctx, "oauth_linked", to, "")
	return nil
}

func (m LogMailer) event(ctx context.Context, kind, to, link string) {
	attrs := []any{"kind", kind, "to", to, "link_logged", m.LogLinks}
	if m.LogLinks && link != "" {
		attrs = append(attrs, "link", link)
	}
	slog.InfoContext(ctx, "mail: event", attrs...)
}

// SMTPMailer delivers via a classical SMTP relay. TLS is MANDATORY in both
// modes (2026-09-19 audit, needs-validation finding — reset links are
// credentials and never cross a plaintext hop):
//   - SSL=true  → implicit TLS on connect (port 465);
//   - SSL=false → STARTTLS REQUIRED (port 587): a relay that does not
//     offer the upgrade is rejected, never silently continued in cleartext.
type SMTPMailer struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string // envelope + From header
	SSL      bool   // true: implicit TLS on connect; false: mandatory STARTTLS
}

// smtpDialTimeout bounds connection establishment so a black-holed relay
// cannot pin the (bounded) send goroutine indefinitely.
const smtpDialTimeout = 10 * time.Second

func (m SMTPMailer) send(ctx context.Context, to, subject, body string) error {
	addr := fmt.Sprintf("%s:%d", m.Host, m.Port)

	var auth smtp.Auth
	if m.Username != "" {
		auth = smtp.PlainAuth("", m.Username, m.Password, m.Host)
	}

	msg := strings.Join([]string{
		"From: " + m.From,
		"To: " + to,
		"Subject: " + subject,
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"",
		body,
	}, "\r\n")

	// net/smtp has no context support; bound it so a dead relay cannot pin a
	// request (sends run on the caller's goroutine with a short budget).
	done := make(chan error, 1)
	go func() {
		// Poison-pill containment (2026-09-18 audit): detached goroutine
		// — a panic in the mail stack must surface as an error, not a
		// process crash (mail is always best-effort).
		defer func() {
			if rec := recover(); rec != nil {
				done <- fmt.Errorf("mail sender panic contained: %v", rec)
			}
		}()
		if m.SSL {
			// Implicit TLS (port 465): dial TLS, then speak SMTP over it.
			done <- m.sendSSL(addr, auth, to, msg)
			return
		}
		// STARTTLS (port 587): the upgrade is REQUIRED, not opportunistic.
		done <- m.sendSTARTTLS(addr, auth, to, msg)
	}()

	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

// sendSTARTTLS dials, demands the STARTTLS extension and upgrades before any
// credential or message byte leaves the process. A relay without STARTTLS is
// a configuration error, reported as such.
func (m SMTPMailer) sendSTARTTLS(addr string, auth smtp.Auth, to, msg string) error {
	conn, err := net.DialTimeout("tcp", addr, smtpDialTimeout)
	if err != nil {
		return err
	}
	defer conn.Close()

	c, err := smtp.NewClient(conn, m.Host)
	if err != nil {
		return err
	}
	defer c.Close()

	if ok, _ := c.Extension("STARTTLS"); !ok {
		return fmt.Errorf("smtp: relay %s does not offer STARTTLS; refusing to send over cleartext", addr)
	}
	if err := c.StartTLS(&tls.Config{ServerName: m.Host, MinVersion: tls.VersionTLS12}); err != nil {
		return fmt.Errorf("smtp: STARTTLS upgrade failed: %w", err)
	}
	return m.deliver(c, auth, to, msg)
}

func (m SMTPMailer) sendSSL(addr string, auth smtp.Auth, to, msg string) error {
	conn, err := tls.DialWithDialer(&net.Dialer{Timeout: smtpDialTimeout}, "tcp", addr,
		&tls.Config{ServerName: m.Host, MinVersion: tls.VersionTLS12})
	if err != nil {
		return err
	}
	defer conn.Close()

	c, err := smtp.NewClient(conn, m.Host)
	if err != nil {
		return err
	}
	defer c.Close()
	return m.deliver(c, auth, to, msg)
}

// deliver runs the post-transport SMTP conversation (AUTH, envelope, data).
func (m SMTPMailer) deliver(c *smtp.Client, auth smtp.Auth, to, msg string) error {
	if auth != nil {
		if ok, _ := c.Extension("AUTH"); ok {
			if err := c.Auth(auth); err != nil {
				return err
			}
		}
	}
	if err := c.Mail(m.From); err != nil {
		return err
	}
	if err := c.Rcpt(to); err != nil {
		return err
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write([]byte(msg)); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return c.Quit()
}

func (m SMTPMailer) SendVerification(ctx context.Context, to, link string) error {
	return m.send(ctx, to, "Verify your NexaU account",
		"Welcome to NexaU!\r\n\r\nVerify your email address:\r\n\r\n"+link+
			"\r\n\r\nThis link is single-use and expires soon. If you did not create an account, ignore this email.")
}

func (m SMTPMailer) SendPasswordReset(ctx context.Context, to, link string) error {
	return m.send(ctx, to, "Reset your NexaU password",
		"Reset your NexaU password:\r\n\r\n"+link+
			"\r\n\r\nThis link is single-use and expires soon. If you did not request a reset, ignore this email.")
}

func (m SMTPMailer) SendOAuthLinked(ctx context.Context, to string) error {
	return m.send(ctx, to, "A Google sign-in was linked to your account",
		"A Google identity was just linked to your NexaU account (same email address).\r\n"+
			"If this was you, no action is needed. If you did NOT expect this, change your password immediately —\r\n"+
			"the change revokes every active session.")
}
