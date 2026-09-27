-- RFC-0019: 
-- ： IF NOT EXISTS，

CREATE TABLE IF NOT EXISTS permission_rules (
    user_id     TEXT NOT NULL,
    session_id  TEXT NOT NULL,
    tool_name   TEXT NOT NULL,
    rule_content TEXT NOT NULL,
    behavior    TEXT NOT NULL CHECK (behavior IN ('allow', 'deny')),
    source      TEXT NOT NULL CHECK (source IN ('config', 'user')),
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, session_id, tool_name, rule_content, behavior)
);

-- SQLite  ADD COLUMN IF NOT EXISTS， PRAGMA 。
--  Python ，：
-- ALTER TABLE sessions ADD COLUMN pending_tool_calls JSON DEFAULT NULL;