-- 0002 memberships (tenant isolation backbone)

CREATE TABLE IF NOT EXISTS tenant_members (
    tenant_id   TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'member'
                CHECK (role IN ('owner', 'admin', 'member')),
    status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'suspended', 'removed')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS ix_tenant_members_user
    ON tenant_members (user_id) WHERE status = 'active';

COMMENT ON TABLE tenant_members IS 'Membership is the tenant isolation anchor: every tenant-scoped query joins through (tenant_id, user_id, status=active).';
