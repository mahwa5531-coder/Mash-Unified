-- NexaU Cloud API schema — 0001 tenants & users
-- PostgreSQL 14+. All timestamps are TIMESTAMPTZ (UTC), stored via pgx.

CREATE TABLE IF NOT EXISTS tenants (
    id              TEXT PRIMARY KEY,                   -- ten_<ulid>
    slug            TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suspended', 'deleted')),
    settings        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id               TEXT PRIMARY KEY,                  -- usr_<ulid>
    email            TEXT NOT NULL,
    display_name     TEXT NOT NULL DEFAULT '',
    password_hash    TEXT,                              -- NULL when managed by external IdP
    status           TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'suspended', 'deleted')),
    is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE,
    auth_provider    TEXT NOT NULL DEFAULT 'local',     -- 'local' | '<idp name>'
    external_subject TEXT,                              -- sub claim when IdP-managed
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at    TIMESTAMPTZ
);
-- Case-insensitive uniqueness without requiring the citext extension.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower ON users (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_external_subject
    ON users (auth_provider, external_subject)
    WHERE external_subject IS NOT NULL;

COMMENT ON TABLE users IS 'NexaU identities. Email is the natural key; local password auth is optional (external IdP users have NULL password_hash).';
