# Case Studies

This directory is NexAU's lesson-learned index. It's NOT a design doc or
RFC replacement — it captures **"we hit this here, future readers
encountering similar signals should grep this directory first"**.

## When to add a case study

When the work involves any of:

- **** — root cause is ≥3 layers removed from initial symptom
- **** — discovered an existing test that was passing without
  actually constraining behavior
- **xfail / skip ** — a flaky marker turning out to mask a real bug
- **** — validated a new debugging / verification technique
  reusable next time
- **Trade-off ** — made a call that will affect later PRs (split
  strategy, contract layer, test file structure)
- **** — corrected a systematically-stale assumption (e.g.
  "this provider routes through X" → no longer true)

## When NOT

- Routine bugfix (root cause direct, fix obvious — `git log` is enough)
- Pure refactor (no lesson)
- One-off temporary debugging
- Documentation revision
- Decisions already captured in an RFC main body (RFCs are "design";
  case studies are "journey")

## How to add

1. File path: `docs/development/case-studies/YYYY-MM-DD-<short-slug>.md`
2. Append a one-line entry to the [Index](#index) below
   (≤ 150 chars)
3. Don't put case study content into `CLAUDE.md`, RFC main bodies, or
   `README.md` — the index is grep-friendly and shouldn't pollute
   auto-loaded context

## How to consume

In any future conversation, when you encounter a signal that smells
similar to anything in the Index, `grep -r "<keyword>" docs/development/case-studies/`
first and reuse the methodology rather than re-derive it.

## Index

- [2026-05-02-aggregator-parity-harness.md](2026-05-02-aggregator-parity-harness.md) — Two parallel LLM stream aggregators (Set A SSE / Set B persist) silently drift; built parity harness, found 3 production bugs + 2 infra bugs that all match industry-wide pathologies (vLLM, koog, Spring AI, LiteLLM).
- [2026-05-04-live-test-economics.md](2026-05-04-live-test-economics.md) — Live LLM test  + cache  + per-PR/nightly  +  + Lark ； PR #519  81  live test " PR "。
- [2026-05-09-step-3.5-flash-pathologies.md](2026-05-09-step-3.5-flash-pathologies.md) — step-3.5-flash  bug ： reasoning  + build()  reasoning-only +  context  reasoning XML tool call（100% ，bisect  8-msg ，4  prompt workaround ）。
- [2026-05-14-live-test-env-var-convention.md](2026-05-14-live-test-env-var-convention.md) —  `NEXAU_LIVE_*`  `LIVE_ANTHROPIC_*`， CI  skip 8  live  + "CI  key"。 grep 。
- [2026-05-14-pyright-private-name-recurring-trap.md](2026-05-14-pyright-private-name-recurring-trap.md) —  PR  2  pyright `reportPrivateUsage`： import  helper。 ruff/mypy 、pyright ； `uv run pyright path/...py` 。