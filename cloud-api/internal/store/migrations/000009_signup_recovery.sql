-- 0009 signup & account recovery (email verification + password reset)
--
-- Research-grounded design:
--   * OWASP Forgot Password Cheat Sheet: single-use, short-lived, hashed tokens;
--     generic responses; revoke sessions on reset.
--   * Paragonie "Untangling the Forget-Me-Knot" (split tokens): the token the
--     user carries is selector.verifier; only sha256(verifier) is stored, the
--     selector is the indexed lookup key. A database leak yields selectors +
--     hashes — not usable tokens.
--   * Newest-wins: issuing a new token for a purpose supersedes (consumes) all
--     previous unused tokens of the same purpose for that user.

-- Grandfathering: operator/SQL-created users are treated as verified; the
-- public signup endpoint is the ONLY path that creates unverified users.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT TRUE;
COMMENT ON COLUMN users.email_verified IS
    'Local-mode email verification state. Default true grandfather-creates trusted (operator) users; POST /v1/auth/register inserts false explicitly.';

CREATE TABLE IF NOT EXISTS auth_recovery_tokens (
    id          TEXT PRIMARY KEY,                     -- art_<ulid>
    user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    purpose     TEXT NOT NULL
                CHECK (purpose IN ('verify_email', 'password_reset')),
    selector    TEXT NOT NULL,                        -- lookup half of the split token
    token_hash  TEXT NOT NULL,                        -- sha256(verifier half), hex
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,                          -- NULL = live; set on consume or supersede
    request_ip  TEXT,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Split-token lookup path: consume statements filter on selector (indexed)
-- AND token_hash equality in one atomic UPDATE.
CREATE UNIQUE INDEX IF NOT EXISTS uq_recovery_selector ON auth_recovery_tokens (selector);
CREATE INDEX IF NOT EXISTS ix_recovery_user_purpose_live
    ON auth_recovery_tokens (user_id, purpose) WHERE used_at IS NULL;

COMMENT ON TABLE auth_recovery_tokens IS
    'Single-use recovery tokens (email verification, password reset). Split-token storage: selector indexes the lookup, sha256(verifier) is stored hash-only. Issuing a new token of a purpose supersedes unused ones (newest-wins).';

-- Default plan referenced by signup (idempotent seed; operator can retune it).
-- 2026-09-23 fix: the RPM keys were "requests_per_minute" but the limits
-- loader (domain.Limits json tags) expects "requests_per_minute_user"/
-- "requests_per_minute_tenant" — plan RPM silently never applied (real-PG
-- E2E finding F8). NOTE for existing deployments: ON CONFLICT DO NOTHING
-- will not re-seed; operators must UPDATE plans SET limits accordingly.
INSERT INTO plans (id, code, name, limits, models, is_public)
VALUES (
    'pln_free', 'free', 'Free',
    '{"requests_per_minute_user": 60, "requests_per_minute_tenant": 240, "concurrent_runs_per_user": 3, "concurrent_runs_per_tenant": 6}'::jsonb,
    '[]'::jsonb,
    TRUE
) ON CONFLICT (id) DO NOTHING;
