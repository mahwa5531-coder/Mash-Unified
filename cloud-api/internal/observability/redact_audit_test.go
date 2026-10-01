// 2026-09-19 security audit, finding 2 — defense-in-depth regression.
//
// The deny-list is the second layer under the LogMailer fix: ANY attribute
// named "link" is hard-redacted regardless of log level or caller, because
// every emailed recovery link carries a single-use credential inside it. The
// audit's probe extracted a live reset token from a log line whose "token"
// deny-list entry did not cover the "link" key that carried it.
//
// 2026-09-23 real-Postgres E2E amendment: the deny-list as shipped also
// redacted the link when the operator explicitly opted in via
// NEXAU_MAIL_LOG_LINKS, making that knob dead and log-mode signup
// unverifiable. redactAttr now takes an allow slice: operator RedactKeys
// stay supreme, allow releases ONLY the built-in deny-list, and nothing
// else changes.
package observability

import (
	"log/slog"
	"testing"
)

func TestAudit_RedactAttrDenyListCoversLink(t *testing.T) {
	for _, key := range []string{"link", "LINK", "Link"} {
		a := redactAttr(nil, nil, slog.String(key, "https://app.example.test/reset?token=x.y"))
		if a.Value.String() != "[REDACTED]" {
			t.Fatalf("key %q not redacted: %v", key, a.Value.String())
		}
	}
}

func TestAudit_RedactAttrDenyListCredentials(t *testing.T) {
	for _, key := range []string{
		"token", "access_token", "refresh_token", "authorization", "password",
		"secret", "cookie", "set-cookie", "bearer", "credential", "api_key",
	} {
		a := redactAttr(nil, nil, slog.String(key, "live-secret-value"))
		if a.Value.String() != "[REDACTED]" {
			t.Fatalf("key %q not redacted: %v", key, a.Value.String())
		}
	}
}

func TestAudit_RedactAttrPassThroughNonSensitive(t *testing.T) {
	// Operational metadata must survive redaction untouched.
	a := redactAttr(nil, nil, slog.String("request_id", "req_123abc"))
	if a.Value.String() != "req_123abc" {
		t.Fatalf("non-sensitive key wrongly redacted: %v", a.Value.String())
	}
	a = redactAttr(nil, nil, slog.String("status", "200"))
	if a.Value.String() != "200" {
		t.Fatalf("non-sensitive key wrongly redacted: %v", a.Value.String())
	}
}

func TestAudit_RedactAttrExtraKeys(t *testing.T) {
	a := redactAttr([]string{"tenant_settings"}, nil, slog.String("tenant_settings", `{"x":1}`))
	if a.Value.String() != "[REDACTED]" {
		t.Fatalf("configured extra key not redacted: %v", a.Value.String())
	}
}

// The MAIL_LOG_LINKS opt-in releases exactly the "link" key from the
// BUILT-IN deny-list — and nothing else, and never against operator
// RedactKeys (which remain supreme over the allow-list too).
func TestAudit_RedactAttrAllowListReleasesOnlyLink(t *testing.T) {
	allow := []string{"link"}

	a := redactAttr(nil, allow, slog.String("link", "http://localhost/verify?token=a.b"))
	if a.Value.String() != "http://localhost/verify?token=a.b" {
		t.Fatalf("allowed link wrongly redacted: %v", a.Value.String())
	}

	// Allow-list must NOT release any other deny-listed key.
	b := redactAttr(nil, allow, slog.String("token", "live-secret"))
	if b.Value.String() != "[REDACTED]" {
		t.Fatalf("allow-list leaked another deny-listed key: %v", b.Value.String())
	}

	// Operator RedactKeys stay supreme even for allowed keys.
	c := redactAttr([]string{"link"}, allow, slog.String("link", "http://x/y"))
	if c.Value.String() != "[REDACTED]" {
		t.Fatalf("operator key not supreme over allow-list: %v", c.Value.String())
	}
}
