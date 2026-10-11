# Model Lineup & Pricing Strategy — The Complete Analysis

> **Decision document for launch.** Researched 2026-10-07 against live
> provider pricing pages, benchmark leaderboards and the Indian CA-firm
> software market. Everything here is wired into the deployment through
> two hot-changeable dials: migration `000011_model_economics.sql`
> (normalization weights + Free-plan model list) and `plans.limits` /
> the plan-SKU catalog (migration 000012 made the commerce plans-only).
>
> **The one-line strategy:** sell **plan subscriptions only** (no credit
> packs — the subscription IS the wallet, its paid-through date IS the
> balance). Meter usage with *price-proportional normalized tokens* so
> margin never depends on which model a user picks. Price for Indian
> small/mid CA firms (₹ anchors, not $ anchors). Route every byte through
> no-training, zero-retention providers — audit confidentiality is a
> product feature, not a checkbox.

---

## 1. The launch model lineup (October 2026, verified prices)

| Role | Model | Input / Output / Cached per 1M | Why it is in the lineup |
|---|---|---|---|
| **Free-tier workhorse** | OpenAI **GPT-6 Luna** | **$0.10 / $0.50 / ~$0.01** | Cheapest frontier-lab model on the market after OpenAI's Sep-2026 50% cut (was $0.20/$1.20). ~1M-token context swallows whole ledger extracts. Fast — good interactive feel for agents. |
| **Free-tier balanced fallback** | Google **Gemini 3.8 Flash** | $0.75 / $3.75 (intro thru 2026-12-31) | Stable, mature Flash generation; strong multilingual (Hindi/vernacular audit docs); the safety net when Luna rate-limits. |
| **Frontier default for Pro** | Anthropic **Claude Sonnet 5.5** | **$2 / $10 / $0.20** | Released 2026-09-28. Near-Opus 5.5 reasoning at 1/5–1/10 of Opus price; ~30% cheaper *per task* than Sonnet 5; the industry reference for reliable **tool calling** and long agentic sessions. **The audit-judgment pick.** |
| **Frontier alternate** | Google **Gemini 4 Argon** | $2 / $10 (promo; 95% cache discount) | Leads 13/19 agentic benchmarks Google published vs GPT-6; the cache discount is ideal for re-reading the same workpapers. Promo price — re-price when it flips. |
| **Frontier alternate** | OpenAI **GPT-6.1 Sol** | $2 / $10 (promo thru 2026-11-21, then $4/$20) | Top-3 SWE-bench Verified (96%+ with the mini-agent harness). Strong at structured extraction + code. Promo ends soon — Sonnet 5.5 is the safer default. |
| **Ultra (optional unlock)** | Anthropic **Claude Opus 5.5** | ~$20 / ~$100 / ~$2 | The hardest judgment calls only. Metered at 200× weight so nobody drains the platform by accident. |
| **Coding specialist (optional, self-hosted route only)** | **Qwen3-Coder-480B** (Apache-2.0) | ≈$0.30–0.60 hosted | 69.6% SWE-bench Verified — best open-weights coder. For confidential data, serve via zero-retention hosting (DeepInfra/Bedrock/self-host) behind Bifrost — **never** the direct vendor API (§3). |

**Why Claude Sonnet 5.5 is THE audit pick.** Audit-agent work is
tool-calling-heavy (fetch ledger page → reconcile → write working paper →
query GST portal data → generate notes). Across 2026 agentic evaluations
and the SWE-bench Verified leaderboard (Claude Opus 5 at 97.0% — Sonnet
5.5 tracks Opus closely), Anthropic's models are the industry reference
for *multi-step tool use that doesn't derail*. Add prompt caching
($0.20/M reads): an audit agent re-reading the same workpaper set all day
pays the 2k-weight only on cache misses. That is the cheapest *frontier
intelligence per rupee* on the market at a **permanent** (non-promo) price.

**What we deliberately did NOT pick, and why:**

| Model | Price | Why not |
|---|---|---|
| DeepSeek V4-Flash | $0.09/$0.28 — cheapest listed API | **Vendor trains on API inputs/outputs even on the paid tier.** Dealbreaker for audit client data (§3). Fine for personal/non-confidential use via a ZDR gateway, not for our default route. |
| Qwen / GLM direct APIs (Alibaba, Zhipu) | $0.10–$1.40/M | Same training-on-data posture as DeepSeek by default. Use only behind zero-retention hosting. |
| Claude Fable 5 / GPT-6 Astra | $20+ / 1M in | Ultra-creative tier; audit work doesn't need it, and the economics for an SMB-focused platform don't close. |
| Llama 4 Scout | $0.08/$0.30 | Cheap, but tool-calling reliability trails the frontier for agentic audit work; no SLA-backed ZDR story. |

---

## 2. The normalization system: one rupee price for every model

The `token_normalization` table (migration 0008, seeded by 000011) is the
economic equalizer. Weights are **price-proportional**:

```
weight(model, kind) = model_price_per_1M(kind) ÷ $0.10
```

so one normalized token always maps to **one GPT-6-Luna-input-equivalent of
upstream spend**:

> **1,000,000 normalized tokens ≈ $0.10 ≈ ₹10 of upstream cost — on ANY
> model in the lineup.** A Claude Sonnet 5.5 input token just costs 20
> normalized tokens (weight 20), its output 100 (weight 100), while cached
> reads cost 2.

Seeded rows (000011):

| model | input | cached_read | output | Effect |
|---|---|---|---|---|
| `openai/gpt-6-luna` | 1.0 | 0.10 | 5.0 | baseline |
| `google/gemini-3.8-flash` | 7.5 | 0.75 | 37.5 | Free fallback |
| `anthropic/claude-sonnet-5.5` | 20 | 2.0 | 100 | Frontier default |
| `openai/gpt-6.1-sol` | 20 | 2.0 | 100 | promo price; **UPDATE to 40/4/200 on 2026-11-22** |
| `google/gemini-4-argon` | 20 | 1.0 | 100 | promo price; re-price when promo ends |
| `anthropic/claude-opus-5.5` | 200 | 20 | 1000 | ultra tier |

Hot-change: `UPDATE token_normalization SET output_weight = … WHERE model = …`
— picked up within `NEXAU_NORM_CACHE_TTL` (~30s), no restart, no redeploy.
**Operator rule: every model you enable in Bifrost gets a row here.** An
unlisted model falls to the `*` default (1:1:1) and is effectively
under-metered — fine for cheap models, wrong for expensive ones.

### 2.1 What a real audit task costs (worked examples)

| Workload | Raw tokens (in/cache/out) | Model | Normalized | Upstream cost |
|---|---|---|---|---|
| Light: GST recon question | 8k / 2k / 1.5k | GPT-6 Luna | 8k + 1.5k×5 − 2k×0.1 ≈ **15k** | **$0.0015 ≈ ₹0.15** |
| Typical: vendor-match agent, 10 tool calls | 40k / 30k / 4k | Sonnet 5.5 | (40k−30k)×20 + 30k×2 + 4k×100 ≈ **1.0M** | **$0.10 ≈ ₹10** |
| Heavy: full vouching run over a workpaper set | 120k / 100k / 12k | Sonnet 5.5 | 20k×20 + 100k×2 + 12k×100 ≈ **1.8M** | **$0.18 ≈ ₹18** |
| Same heavy run uncached (first pass) | 120k / 0 / 12k | Sonnet 5.5 | 120k×20 + 12k×100 = **3.6M** | $0.36 ≈ ₹35 |

Caching is why Claude wins the frontier slot for audit: after the first
pass, 80%+ of input tokens are cache reads at 1/10th the weight.

---

## 3. Data retention & confidentiality — the audit-firm requirement

**Our cloud layer stores zero client content.** `llm_calls` (migration 0005)
records tokens, cost, latency, model, status — **never prompts, completions,
or transcripts**. Agent state and transcripts live only on the auditor's
desktop. Payloads transit our proxy and are not persisted. This is verifiable
in the schema, not just the marketing.

**Upstream providers — the no-training / ZDR matrix (Oct 2026):**

| Provider | Trains on API data? | Zero Data Retention (ZDR) | Notes for us |
|---|---|---|---|
| **OpenAI** (Luna, Sol) | **No** (API default) | Yes — ZDR for eligible API endpoints, formalized Aug-2026 | Default-safe; request ZDR for the account for belt-and-braces |
| **Anthropic** (Sonnet/Opus 5.5) | **No** (API default) | Yes — ZDR agreements, enterprise tier | Default-safe; the primary confidential-data route |
| **Google Gemini** (Flash, Argon) | **No** on paid tier | Yes — ZDR requestable per paid project (ai.google.dev/gemini-api/docs/zdr) | Use a paid project, file the ZDR request — one-time |
| DeepSeek (any) | **YES — trains even on paid API** | Only via third-party ZDR gateways | **Blocked for confidential work** |
| Qwen / GLM direct | Training by default | No (direct) / Yes (via DeepInfra-style ZDR hosts, Bedrock, self-host) | Open-weights models are fine **hosted** — the weights never see your data if the host is ZDR |

**Launch posture:** all three primary providers are no-training-by-default
with ZDR available. The optional Qwen3-Coder route must go through a
zero-retention host (DeepInfra's zero-retention policy, AWS Bedrock, or
self-hosted vLLM) behind Bifrost — Bifrost's provider config makes this a
routing decision, invisible to the desktop client.

**Indian compliance context:** as a platform processing client financial
data for CA firms, we are a *data processor* under the **DPDP Act 2023** —
the firm is the data fiduciary. Practically: (a) publish a retention policy
(we retain only metering facts — set an ops cron to prune `llm_calls` older
than the billing-audit window, e.g. 24 months); (b) sign a DPA with each
firm; (c) document the sub-processors (OpenAI/Anthropic/Google, ZDR mode);
(d) align with ICAI's AI-adoption guidance for members. The zero-content
schema is the strongest selling point in that story: *we could not leak
your working papers if we wanted to — we never have them.*

---

## 4. Plans — **subscriptions only** (the decision)

**No credit packs. No wallet. No per-token top-ups.** A purchase buys a
plan period; `subscriptions.current_period_end` IS the balance; expiry IS
the moment it passes (read-side, automatic — the tenant falls back to the
Free plan's limits + model allowlist with no sweeper, no grace period).

Two currencies, one enforcement path:
- **Plan windows** (`plans.limits`: rolling 5h + weekly normalized tokens,
  RPM, concurrency) — enforced at request admission (`llm/proxy.go`).
- **The subscription row** — what a purchase activates/extends; the
  identity resolver's FREE-PLAN DEFAULT means every tenant is Free until
  they buy Pro, and returns to Free the day Pro lapses.

### Free — ₹0 (the funnel; the default state of every tenant)

| Dial | Value | Reasoning |
|---|---|---|
| `window_5h_tokens` | **60,000** | ≈ ₹0.60 upstream cost per 5h worst case. Enough for 3–4 Luna agent sessions — a real taste of the product, not a demo toy. |
| `window_weekly_tokens` | **250,000** | ≈ ₹2.40/week → **cost cap ~₹10/month per free firm**. CAC-safe at any scale. |
| Models | **GPT-6 Luna + Gemini 3.8 Flash only** (enforced by the 000011 allowlist) | Frontier on free = margin death; cheap-and-good on free = the upgrade itch. |
| RPM / concurrent | 20 / 3 | Interactive use, not batch farming. |

Free-tier abuse ceiling: ₹10/month per firm — a rounding error, so no
anti-abuse heroics needed at launch.

### Pro — **₹1,999/month per firm** (launch: ₹1,499 ICAI-member; ₹19,999/year)

| Dial | Value | Reasoning |
|---|---|---|
| `window_5h_tokens` | **2,000,000** | ≈ 2 heavy Sonnet vouching runs per 5h — full audit-season crunch capacity, or ~130 Luna sessions. |
| `window_weekly_tokens` | **10,000,000** | The margin lock: worst-case upstream = **$1.00 ≈ ₹96/week → ₹416/month**, vs ₹1,999 price → **floor margin 4.8× even at 100% cap saturation** (real firms will sit at 15–30% of cap). |
| Models | Unrestricted (Sonnet 5.5, Argon, Sol; Opus by support ticket) | Frontier access *is* the Pro upsell. |
| RPM / concurrent | 600 / 16 | Firm-wide concurrent agents. |
| Purchase | SKUs: `plan_pro_1m` (₹1,999/30d), `plan_pro_1y` (₹19,999/365d, ~17% off) | Renewals stack periods — buy twice back-to-back, get 60 days; never lose paid days. |

**Pricing anchors (Indian market, researched Oct 2026):**

| Anchor | Price | Read-across |
|---|---|---|
| Suvit (Vyapar TaxOne) — CA automation, the category leader | **₹10,000/year/firm** (₹833/mo, unlimited use; 50% ICAI discount) | The price floor for "AI for CA firms" in India. Below this = commodity. |
| DataSnipper — international AI audit automation | ~$50–150/user/month (₹4,000–13,000) | The ceiling; enterprise-only in India. |
| Zoho-style professional SaaS per user | ₹500–1,500/user/month | The comfort band. |
| Our positioning | **₹1,999/firm/month** | ~2.4× Suvit — justified because we are the *LLM infrastructure* for their own agents (frontier-model access included), not a fixed automation tool. Still < ½ of any international alternative. |

Target segment: small/mid firms (1–20 partners) — price-sensitive, GST-era
digitized, Big-4 tools out of reach. ₹1,999/firm splits to ₹400/partner at a
5-partner firm — under the ₹500 psychological bar per person. The ICAI-member
₹1,499 launch price matches Suvit's post-discount territory while including
frontier-model usage. Annual ₹19,999 (~17% off) locks audit-season budget.

---

## 5. Unit economics summary (USD/INR ≈ 96, Oct 2026)

| Line | Number |
|---|---|
| Upstream cost of 1M normalized tokens (any model) | $0.10 ≈ ₹9.6 |
| Free tier worst-case cost | ₹10/firm/month |
| Pro worst-case cost (cap saturated) | ₹416/firm/month → margin ≥ 4.8× |
| Pro realistic cost (15–30% of cap) | ₹62–125/firm/month → margin 16–32× |
| Break-even firm count (₹50k/month infra) | ~30 Pro firms |

Sensitivity: if USD/INR moves to 105 (+9%), Pro worst-case cost → ₹455/mo —
margin still 4.4×. If Gemini/Argon promos end (+100% on those rows), only
their normalized weights change (SQL), not the user-facing price.

---

## 6. Bifrost wiring (what connects where)

```
NEXAU_BIFROST_URL=http://bifrost:8080
NEXAU_BIFROST_API_KEY=<one cloud-held key>

# compose.yaml bifrost service (already wired):
BIFROST_PROVIDER_KEYS_OPENAI=...      # Luna + Sol
BIFROST_PROVIDER_KEYS_ANTHROPIC=...   # Sonnet/Opus 5.5
BIFROST_PROVIDER_KEYS_GOOGLE=...      # Flash + Argon
```

Model ids the desktop requests: `openai/gpt-6-luna`,
`google/gemini-3.8-flash`, `anthropic/claude-sonnet-5.5`,
`google/gemini-4-argon`, `openai/gpt-6.1-sol`. Keep the normalization table
in sync with whatever ids your Bifrost build exposes (§2 operator rule).

---

## 7. Launch checklist (payments + models)

1. `NEXAU_PAYMENT_PROVIDER=phonepe` + merchant trio + redirect/callback URLs
   (docs/PAYMENT-GATEWAY.md §11) — payments ON.
2. Bifrost provider keys for the three launch providers (§6).
3. File Google's paid-tier ZDR request (one-time form).
4. Pro billing is self-serve: the Pro SKUs (`plan_pro_1m`, `plan_pro_1y`)
   ARE the checkout catalog — a firm pays, the subscription activates
   automatically (no operator step). ICAI-member pricing is a catalog
   override (`NEXAU_PAYMENT_CATALOG_JSON`) while the launch discount runs.
5. Optional: prune-`llm_calls` cron for the 24-month retention policy.
