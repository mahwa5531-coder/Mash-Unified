-- 0011 model economics: the launch model lineup.
--
-- Two operator dials, both already hot-changeable via SQL (docs/
-- MODELS-AND-PRICING.md has the full analysis):
--
--   1. token_normalization rows for the recommended October-2026 lineup,
--      PRICE-PROPORTIONAL: weights are normalized-token rupee-cost equals
--      provider price ÷ $0.10 per 1M. With this table, 1,000,000 normalized
--      tokens cost ~$0.10 (~₹10 at USD/INR ~96) in upstream spend on EVERY
--      model in the lineup — margins stop depending on which model users
--      pick. Premium models simply burn the window budget faster.
--
--      Basis: 1 normalized token = 1 gpt-6-luna INPUT token ($0.10/1M).
--        weight = model_price_per_1M / $0.10   (input, output, cached separately)
--
--   2. Free plan is restricted to the two cheap+fast models (Luna, Flash);
--      Pro stays unrestricted (frontier access is the Pro upsell).
--
-- Prices verified 2026-10-07 (promo windows noted inline; UPDATE the row when
-- a promo ends — the API picks it up within NEXAU_NORM_CACHE_TTL, ~30s).

-- Widen the weight columns first: NUMERIC(9,6) caps at 999.999999, and a
-- premium model priced ≥100× the $0.10 basis (e.g. Opus-class output at
-- ~$100/1M → weight 1000) overflows. NUMERIC(12,6) leaves headroom to
-- ~1,000,000× the basis — enough for any future ultra-premium tier.
ALTER TABLE token_normalization
    ALTER COLUMN input_weight        TYPE NUMERIC(12,6),
    ALTER COLUMN cached_read_weight  TYPE NUMERIC(12,6),
    ALTER COLUMN cached_write_weight TYPE NUMERIC(12,6),
    ALTER COLUMN output_weight       TYPE NUMERIC(12,6);

INSERT INTO token_normalization (model, input_weight, cached_read_weight, cached_write_weight, output_weight) VALUES
    -- OpenAI GPT-6 Luna: $0.10 in / $0.50 out / ~$0.01 cached. The cheapest
    -- frontier-lab model (Sep-2026 50% cut), ~1M context, fast. Free-tier
    -- default workhorse.
    ('openai/gpt-6-luna',            1.0,  0.10, 1.25,   5.0),
    -- Google Gemini 3.8 Flash: $0.75 in / $3.75 out (intro pricing through
    -- 2026-12-31; revisit then). Balanced fallback for the Free tier.
    ('google/gemini-3.8-flash',      7.5,  0.75, 7.50,  37.5),
    -- Anthropic Claude Sonnet 5.5: $2 in / $10 out / $0.20 cache reads.
    -- Near-Opus reasoning, best tool-calling/agentic reliability, prompt
    -- caching is where audit workloads (re-read workpapers) win big.
    -- THE frontier pick for audit judgment at a permanent (non-promo) price.
    ('anthropic/claude-sonnet-5.5', 20.0,  2.00, 25.0, 100.0),
    -- OpenAI GPT-6.1 Sol: $2 in / $10 out, cached $0.20 (promo through
    -- 2026-11-21; afterwards $4/$20 → UPDATE to 40/4/200 when it flips).
    ('openai/gpt-6.1-sol',          20.0,  2.00, 25.0, 100.0),
    -- Google Gemini 4 Argon: $2 in / $10 out, cached 95% off (promo; the
    -- 95% cache discount makes cached_read ~$0.10 → weight 1.0). Leads
    -- several agentic benchmarks; keep cache reads cheap for doc-heavy work.
    ('google/gemini-4-argon',       20.0,  1.00, 25.0, 100.0),
    -- Anthropic Claude Opus 5.5: premium tier (~$20 in / ~$100 out /
    -- ~$2 cache). Only worth it for the hardest judgment calls; listed so
    -- tenants that unlock it are metered honestly.
    ('anthropic/claude-opus-5.5',  200.0, 20.00, 250.0, 1000.0)
ON CONFLICT (model) DO UPDATE
    SET input_weight        = EXCLUDED.input_weight,
        cached_read_weight  = EXCLUDED.cached_read_weight,
        cached_write_weight = EXCLUDED.cached_write_weight,
        output_weight       = EXCLUDED.output_weight,
        is_active           = TRUE,
        updated_at          = now();

-- Free plan: cheap+fast models only (the frontier is the Pro upsell).
-- Exact keys and patterns both work (proxy.go modelAllowed); patterns keep
-- minor model-name suffixes from breaking entitlement.
UPDATE plans SET
    models     = '["openai/gpt-6-luna", "openai/gpt-6-luna-*", "google/gemini-3.8-flash", "google/gemini-3.8-flash-*"]'::jsonb,
    updated_at = now()
WHERE code = 'free' AND is_public;

-- Pro plan: unrestricted frontier access (models '[]'), windows unchanged
-- (2M/5h burst, 10M/week — ≈ $1/week worst-case upstream spend at the
-- normalized basis; see docs/MODELS-AND-PRICING.md §4 for the margin math).
UPDATE plans SET
    models     = '[]'::jsonb,
    updated_at = now()
WHERE code = 'pro' AND is_public;
