// Configuration-boundary regressions (2026-09-19 security audit, trimmed to
// the Google-only surface on 2026-10-05):
//
//	finding 1 (HIGH, runtime half): the HS256 secret must arrive via env or
//	  secret FILE at runtime — never a committed default, never an image.
package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// setBaseEnv installs the minimal valid deployment environment.
func setBaseEnv(t *testing.T) {
	t.Helper()
	t.Setenv("NEXAU_DATABASE_URL", "postgres://u:p@localhost:5432/mash?sslmode=require")
	t.Setenv("NEXAU_REDIS_URL", "redis://localhost:6379/0")
	t.Setenv("NEXAU_BIFROST_URL", "http://localhost:8081")
	t.Setenv("NEXAU_AUTH_HS256_SECRET", strings.Repeat("s", 48))
}

// TestAudit_SecretRequired: no env secret, no file → hard failure.
func TestAudit_SecretRequired(t *testing.T) {
	setBaseEnv(t)
	t.Setenv("NEXAU_AUTH_HS256_SECRET", "")
	if _, err := Load(); err == nil {
		t.Fatal("without any HS256 secret the deployment must be rejected")
	} else if !strings.Contains(err.Error(), "HS256_SECRET") {
		t.Fatalf("error must name the missing secret: %v", err)
	}
}

// TestAudit_SecretFileOverridesEnv: NEXAU_AUTH_HS256_SECRET_FILE wins over the
// env var (secret-manager mounts are the production channel).
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

// TestAudit_GoogleOAuthRequiresWebSuccessURL: a fully-configured Google
// provider without a browser success destination is a misconfiguration.
func TestAudit_GoogleOAuthRequiresWebSuccessURL(t *testing.T) {
	setBaseEnv(t)
	t.Setenv("NEXAU_AUTH_GOOGLE_CLIENT_ID", "test.apps.googleusercontent.com")
	t.Setenv("NEXAU_AUTH_GOOGLE_CLIENT_SECRET", "test-secret")
	t.Setenv("NEXAU_AUTH_GOOGLE_REDIRECT_URL", "https://api.mash.cloud/v1/auth/oauth/google/callback")
	t.Setenv("NEXAU_AUTH_WEB_SUCCESS_URL", "")

	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "WEB_SUCCESS_URL") {
		t.Fatalf("google oauth without WebSuccessURL must be rejected: %v", err)
	}
}

// TestAudit_BaseEnvLoads: the minimal Google-only deployment shape boots.
func TestAudit_BaseEnvLoads(t *testing.T) {
	setBaseEnv(t)
	cfg, err := Load()
	if err != nil {
		t.Fatalf("base env must load: %v", err)
	}
	if cfg.Auth.GoogleClientID != "" {
		t.Fatal("google oauth must be unconfigured in the base env")
	}
	if cfg.Auth.RevocationCheck != true {
		t.Fatal("revocation checking must default on")
	}
}

// --- URL externalization (2026-10-06): every connection URL is env-driven and
// --- boot-validated, so test/staging repointing is a pure env change.

// TestConfig_URLShapeValidation: a scheme-less or host-less URL fails at boot
// naming the exact key — not at first request as a transport mystery.
func TestConfig_URLShapeValidation(t *testing.T) {
	cases := []struct{ key, val string }{
		{"NEXAU_AUTH_GOOGLE_TOKEN_URL", "oauth2.googleapis.com/token"},
		{"NEXAU_BIFROST_URL", "bifrost:8080"},
		{"NEXAU_RAZORPAY_API_BASE", "api.razorpay.com/v1"},
		{"NEXAU_AUTH_WEB_SUCCESS_URL", "not a url"},
	}
	for _, tc := range cases {
		t.Run(tc.key, func(t *testing.T) {
			setBaseEnv(t)
			t.Setenv(tc.key, tc.val)
			_, err := Load()
			if err == nil || !strings.Contains(err.Error(), tc.key) {
				t.Fatalf("%s=%q must be rejected naming the key: %v", tc.key, tc.val, err)
			}
		})
	}
}

// TestConfig_GoogleIssuerOverride: pointing the OAuth endpoints at a test
// server ALSO overrides the accepted issuers — the issuer allowlist is
// deployment config, never code.
func TestConfig_GoogleIssuerOverride(t *testing.T) {
	setBaseEnv(t)
	t.Setenv("NEXAU_AUTH_GOOGLE_ISSUERS", " https://oauth.test.mash.local , https://accounts.google.com ,")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("issuer override must load: %v", err)
	}
	want := []string{"https://oauth.test.mash.local", "https://accounts.google.com"}
	if len(cfg.Auth.GoogleIssuers) != len(want) {
		t.Fatalf("issuers = %v, want %v (trimmed, no empties)", cfg.Auth.GoogleIssuers, want)
	}
	for i := range want {
		if cfg.Auth.GoogleIssuers[i] != want[i] {
			t.Fatalf("issuers = %v, want %v", cfg.Auth.GoogleIssuers, want)
		}
	}
}

// TestConfig_GoogleIssuerDefaults: unset → Google's two documented forms.
func TestConfig_GoogleIssuerDefaults(t *testing.T) {
	setBaseEnv(t)
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.Auth.GoogleIssuers) != 2 ||
		cfg.Auth.GoogleIssuers[0] != "accounts.google.com" ||
		cfg.Auth.GoogleIssuers[1] != "https://accounts.google.com" {
		t.Fatalf("default issuers wrong: %v", cfg.Auth.GoogleIssuers)
	}
}

// TestConfig_QuotaReserveDefaultsAndValidation.
func TestConfig_QuotaReserveDefaultsAndValidation(t *testing.T) {
	setBaseEnv(t)
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.Quota.ReserveEnabled || cfg.Quota.ReserveMinTokens != 1024 ||
		cfg.Quota.ReserveMaxTokens != 32768 || cfg.Quota.ReserveTTL != 30*time.Minute {
		t.Fatalf("reserve defaults wrong: %+v", cfg.Quota)
	}

	// Max < Min is a deployment blocker.
	setBaseEnv(t)
	t.Setenv("NEXAU_QUOTA_RESERVE_MIN_TOKENS", "5000")
	t.Setenv("NEXAU_QUOTA_RESERVE_MAX_TOKENS", "1000")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "MAX_TOKENS") {
		t.Fatalf("max < min must be rejected: %v", err)
	}

	// TTL must exceed the stream max duration (crash backstop invariant).
	setBaseEnv(t)
	t.Setenv("NEXAU_QUOTA_RESERVE_TTL", "1m")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "RESERVE_TTL") {
		t.Fatalf("short TTL must be rejected: %v", err)
	}

	// Disabled skips the invariant checks.
	setBaseEnv(t)
	t.Setenv("NEXAU_QUOTA_RESERVE_ENABLED", "false")
	t.Setenv("NEXAU_QUOTA_RESERVE_MIN_TOKENS", "5000")
	t.Setenv("NEXAU_QUOTA_RESERVE_MAX_TOKENS", "1000")
	if _, err := Load(); err != nil {
		t.Fatalf("disabled reservation must not validate bounds: %v", err)
	}
}
