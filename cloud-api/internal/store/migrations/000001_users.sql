-- MASh Cloud API schema — 0001 tenants & users
-- PostgreSQL 14+. All timestamps are TIMESTAMPTZ (UTC), stored via pgx.
--
-- Identity model: Google is the ONLY identity provider. The users table stores
-- exactly what Google's OIDC ID token gives us (sub → external_subject, email,
-- email_verified, name → display_name, picture → avatar_url) plus our own
-- bookkeeping (status, admin flag, timestamps). There is no password_hash and
-- no local credential of any kind.

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
    id                TEXT PRIMARY KEY,                  -- usr_<ulid>
    email             TEXT NOT NULL,
    display_name      TEXT NOT NULL DEFAULT '',          -- Google `name` claim
    avatar_url        TEXT NOT NULL DEFAULT '',          -- Google `picture` claim
    status            TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'suspended', 'deleted')),
    is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE,
    auth_provider     TEXT NOT NULL DEFAULT 'google',
    external_subject  TEXT NOT NULL,                     -- Google `sub` claim (identity anchor)
    email_verified    BOOLEAN NOT NULL DEFAULT TRUE,     -- Google email_verified claim
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at     TIMESTAMPTZ
);
-- Case-insensitive uniqueness without requiring the citext extension.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower ON users (lower(email));
-- One Google identity per user; the identity anchor is (provider, sub), never email.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_external_subject
    ON users (auth_provider, external_subject);

COMMENT ON TABLE users IS 'MASh identities. Google OAuth only: external_subject is the immutable identity anchor (Google sub); email is display/billing metadata that may change at Google.';
