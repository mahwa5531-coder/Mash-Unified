-- 0004 devices & refresh tokens (rotation with reuse detection)

CREATE TABLE IF NOT EXISTS devices (
    id            TEXT PRIMARY KEY,                     -- dev_<ulid>
    user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name          TEXT NOT NULL DEFAULT 'unknown device',
    platform      TEXT NOT NULL DEFAULT 'unknown',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_devices_user ON devices (user_id);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id           TEXT PRIMARY KEY,                      -- rt_<ulid> (public id)
    user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    tenant_id    TEXT REFERENCES tenants (id) ON DELETE CASCADE,  -- active tenant context
    device_id    TEXT REFERENCES devices (id) ON DELETE SET NULL,
    family_id    TEXT NOT NULL,                         -- rotation family; reuse detection revokes family
    token_hash   TEXT NOT NULL UNIQUE,                  -- SHA-256 of opaque secret, never the secret
    expires_at   TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    used_at      TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ,
    revoked_reason TEXT,                                -- 'rotation' | 'reuse' | 'logout' | 'admin'
    replaced_by  TEXT REFERENCES refresh_tokens (id),
    user_agent   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_refresh_tokens_user   ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS ix_refresh_tokens_family ON refresh_tokens (family_id);

COMMENT ON TABLE refresh_tokens IS 'Opaque server-issued refresh tokens. Hash-only storage; family-based reuse detection (RFC 6819 §5.2.2.3).';
