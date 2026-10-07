-- 0007 seed the v1 plan catalog: Free and Pro.
-- Limits keys mirror domain.PlanLimits JSON tags. Models '[]' = unrestricted.
--
-- Quota model: two rolling normalized-token windows (5-hour burst budget +
-- 7-day weekly budget) — no calendar-month quota. Values are seed defaults;
-- operators hot-change them via SQL (UPDATE plans SET limits = ...) and the
-- API picks the change up within its identity-cache TTL (~30s).

INSERT INTO plans (id, code, name, limits, models, is_public) VALUES
    ('pln_free', 'free', 'Free', $$
        {
          "requests_per_minute_user": 20,
          "requests_per_minute_tenant": 20,
          "concurrent_requests_per_user": 3,
          "concurrent_requests_per_tenant": 3,
          "max_request_bytes": 2097152,
          "window_5h_tokens": 60000,
          "window_weekly_tokens": 250000
        }$$::jsonb, '[]'::jsonb, TRUE),
    ('pln_pro', 'pro', 'Pro', $$
        {
          "requests_per_minute_user": 600,
          "requests_per_minute_tenant": 600,
          "concurrent_requests_per_user": 16,
          "concurrent_requests_per_tenant": 16,
          "max_request_bytes": 2097152,
          "window_5h_tokens": 2000000,
          "window_weekly_tokens": 10000000
        }$$::jsonb, '[]'::jsonb, TRUE)
ON CONFLICT (id) DO NOTHING;
