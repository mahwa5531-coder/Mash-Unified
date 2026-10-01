// 2026-09-19 security audit — configuration-boundary regressions.
//
//	finding 1 (HIGH, runtime half): the HS256 secret must arrive via env or
//	  secret FILE at runtime — never a committed default, never an image.
//	needs-validation: emailed links must target an https origin (loopback
//	  dev exempt), and smtp mode must not run without a link destination.
package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// setBaseEnv installs the minimal valid deployment environment.
func setBaseEnv(t *testing.T) {
	t.Helper()
	t.Setenv("NEXAU_DATABASE_URL", "postgres://u:p@localhost:5432/nexau?sslmode=require")
	t.Setenv("NEXAU_REDIS_URL", "redis://localhost:6379/0")
	t.Setenv("NEXAU_BIFROST_URL", "http://localhost:8081")
	t.Setenv("NEXAU_AUTH_MODE", "local")
	t.Setenv("NEXAU_AUTH_HS256_SECRET", strings.Repeat("s", 48))
}

// TestAudit_SecretRequiredInLocalMode: no env secret, no file → hard failure.
// This is the runtime twin of the compose.yaml fail-fast (the committed
// default secret is gone; forgetting to inject is a deployment blocker).
func TestAudit_SecretRequiredInLocalMode(t *testing.T) {
	setBaseEnv(t)
	t.Setenv("NEXAU_AUTH_HS256_SECRET", "")
	if _, err := Load(); err == nil {
		t.Fatal("local mode without any HS256 secret must be rejected")
	} else if !strings.Contains(err.Error(), "HS256_SECRET") {
		t.Fatalf("error must name the missing secret: %v", err)
	}
}

// TestAudit_SecretFileOverridesEnv: NEXAU_AUTH_HS256_SECRET_FILE wins over
// the env var (secret-manager mounts are the production channel).
func TestAudit_SecretFileOverridesEnv(t *testing.T) {
	setBaseEnv(t)
	fileSecret := strings.Repeat("f", 64)
	path := filepath.Join(t.TempDir(), "hs256")
	if err := os.WriteFile(path, []byte(fileSecret+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("NEXAU_AUTH_HS256_SECRET", "")
	t.Setenv("NEXAU_AUTH_HS256_SECRET_FILE", path)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("secret-file load must succeed: %v", err)
	}
	if cfg.Auth.HS256Secret != fileSecret {
		t.Fatalf("secret file content not loaded (trailing whitespace trimmed): %q", cfg.Auth.HS256Secret)
	}
}

// TestAudit_SecretFileTooShortRejected: a short secret from a file still hits
// the ≥32-byte validation (no weaker path through the file channel).
func TestAudit_SecretFileTooShortRejected(t *testing.T) {
	setBaseEnv(t)
	path := filepath.Join(t.TempDir(), "hs256-short")
	if err := os.WriteFile(path, []byte("too-short"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("NEXAU_AUTH_HS256_SECRET", "")
	t.Setenv("NEXAU_AUTH_HS256_SECRET_FILE", path)

	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "≥32 bytes") {
		t.Fatalf("short file secret must be rejected by length validation: %v", err)
	}
}

// TestAudit_AppBaseURLSchemeMatrix: emailed-link destination security.
func TestAudit_AppBaseURLSchemeMatrix(t *testing.T) {
	cases := []struct {
		name string
		url  string
		ok   bool
	}{
		{"https production", "https://app.nexau.cloud", true},
		{"https with path", "https://app.nexau.cloud/", true},
		{"http loopback dev", "http://localhost:3000", true},
		{"http 127.0.0.1 dev", "http://127.0.0.1:5173", true},
		{"http routable blocked", "http://app.nexau.cloud", false},
		{"http private-ip blocked", "http://10.0.0.5", false},
		{"ftp scheme blocked", "ftp://app.nexau.cloud", false},
		{"javascript blocked", "javascript:alert(1)", false},
		{"empty host blocked", "https://", false},
	}
	for _, c := range cases {
		if err := validateSecureBaseURL(c.url); (err == nil) != c.ok {
			t.Fatalf("%s: url=%q err=%v wantOk=%v", c.name, c.url, err, c.ok)
		}
	}
}

// TestAudit_SMTPModeRequiresAppBaseURL: with signup enabled, smtp mail
// without a website destination is a misconfiguration (reset links would
// carry token:// pseudo-URIs).
func TestAudit_SMTPModeRequiresAppBaseURL(t *testing.T) {
	setBaseEnv(t)
	t.Setenv("NEXAU_MAIL_MODE", "smtp")
	t.Setenv("NEXAU_SMTP_HOST", "smtp.example.test")
	t.Setenv("NEXAU_MAIL_FROM", "no-reply@example.test")
	t.Setenv("NEXAU_APP_BASE_URL", "")

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "NEXAU_APP_BASE_URL") {
		t.Fatalf("smtp mode without AppBaseURL must be rejected: %v", err)
	}
}

// TestAudit_SMTPModeWithHTTPSBaseURLValid: the full valid production shape.
func TestAudit_SMTPModeWithHTTPSBaseURLValid(t *testing.T) {
	setBaseEnv(t)
	t.Setenv("NEXAU_MAIL_MODE", "smtp")
	t.Setenv("NEXAU_SMTP_HOST", "smtp.example.test")
	t.Setenv("NEXAU_MAIL_FROM", "no-reply@example.test")
	t.Setenv("NEXAU_APP_BASE_URL", "https://app.nexau.cloud")

	if _, err := Load(); err != nil {
		t.Fatalf("valid smtp configuration must load: %v", err)
	}
}

// TestAudit_HTTPAppBaseURLRejectedAtLoad: the scheme check fires through
// Load() (not just the helper) — plaintext link bases never reach runtime.
func TestAudit_HTTPAppBaseURLRejectedAtLoad(t *testing.T) {
	setBaseEnv(t)
	t.Setenv("NEXAU_APP_BASE_URL", "http://app.nexau.cloud")

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "https") {
		t.Fatalf("http AppBaseURL must be rejected at load: %v", err)
	}
}

// TestAudit_UnverifiedRetentionBounds: purge retention must be ≥1h (or the
// default applies).
func TestAudit_UnverifiedRetentionBounds(t *testing.T) {
	setBaseEnv(t)
	t.Setenv("NEXAU_AUTH_UNVERIFIED_RETENTION", "10s")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "UNVERIFIED_RETENTION") {
		t.Fatalf("sub-hour retention must be rejected: %v", err)
	}

	setBaseEnv(t)
	t.Setenv("NEXAU_AUTH_UNVERIFIED_RETENTION", "24h")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("valid retention must load: %v", err)
	}
	if cfg.Auth.UnverifiedRetention != 24*60*60*1e9 { // ns
		t.Fatalf("retention not applied: %v", cfg.Auth.UnverifiedRetention)
	}
}
