-- 0008 dynamic token accounting: the normalization table + window quotas.
--
-- Two operator-controlled dials, both hot-changeable via SQL (no restart, no
-- redeploy — the API process picks changes up within its cache TTL):
--
--   1. Plan window quotas live in plans.limits JSONB:
--        window_5h_tokens     — rolling 5-hour normalized-token budget
--        window_weekly_tokens — rolling 7-day normalized-token budget
--      This migration also converts pre-existing rows from the retired
--      monthly_token_quota key. Fresh installs already seed the new keys via
--      000007; the UPDATE below is idempotent (same values as 000007) and
--      makes both paths converge on identical state.
--
--   2. Token normalization weights live in token_normalization (one row per
--      model, '*' = the default rule): how raw provider usage is converted
--      into the quota currency. Metering stores BOTH the raw provider numbers
--      and the normalized numbers on every llm_calls row, so accounting is
--      always reconstructible — even after weights change later.
--
-- Normalization formula (weights are per-model, all default 1.0):
--   normalized_input  = max(0, round(prompt_tokens * input_weight)
--                            - round(cache_read_tokens  * cached_read_weight)
--                            - round(cache_write_tokens * cached_write_weight))
--   normalized_output = round(completion_tokens * output_weight)
--   normalized_total  = normalized_input + normalized_output

CREATE TABLE IF NOT EXISTS token_normalization (
    model               TEXT PRIMARY KEY,   -- exact "provider/model", "provider/*" pattern, or '*' (default)
    input_weight        NUMERIC(9,6) NOT NULL DEFAULT 1.0
                        CHECK (input_weight >= 0),
    cached_read_weight  NUMERIC(9,6) NOT NULL DEFAULT 1.0
                        CHECK (cached_read_weight >= 0),
    cached_write_weight NUMERIC(9,6) NOT NULL DEFAULT 1.0
                        CHECK (cached_write_weight >= 0),
    output_weight       NUMERIC(9,6) NOT NULL DEFAULT 1.0
                        CHECK (output_weight >= 0),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE token_normalization IS
    'Per-model token-accounting weights (the quota currency). ''*'' is the default rule; exact keys beat "provider/*" patterns, patterns beat ''*''. Hot-changeable: UPDATE takes effect within the API cache TTL.';

-- The default rule — nothing else is required for the identity accounting
-- (cached tokens free, everything else 1:1).
INSERT INTO token_normalization (model) VALUES ('*')
ON CONFLICT (model) DO NOTHING;

-- Raw provider usage audit columns on llm_calls (backfilled 0): with weights
-- other than 1.0 the raw numbers are no longer derivable from the normalized
-- ones, so both are stored per row.
ALTER TABLE llm_calls
    ADD COLUMN IF NOT EXISTS raw_prompt_tokens     BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS raw_completion_tokens BIGINT NOT NULL DEFAULT 0;

-- Plan quota keys: retire monthly_token_quota, ensure both window keys.
-- Idempotent and value-safe: it (re)sets exactly the 000007 seed values, so
-- fresh installs (000007 already seeded the keys) and upgraded installs
-- (monthly-era rows) converge on identical state.
UPDATE plans SET
    limits = (limits - 'monthly_token_quota') || jsonb_build_object(
        'window_5h_tokens',     CASE code WHEN 'free' THEN 60000  ELSE 2000000  END,
        'window_weekly_tokens', CASE code WHEN 'free' THEN 250000 ELSE 10000000 END
    ),
    updated_at = now()
WHERE is_public
  AND NOT (limits ? 'window_5h_tokens' AND limits ? 'window_weekly_tokens');
