# MASh Frontend — Refactored Architecture

Next.js 16 + React 19 + Tailwind 4 chat workspace for the MASh statutory-audit agent.

> **About this folder** — the complete frontend after the behavior-preserving architecture
> refactor. Same UI, same behavior, cleaner structure: feature-based folders
> (`src/features/*`), split services (`src/services/*`), decomposed god files (largest
> container is now 659 lines, down from 1279), dead code removed.
>
> **Verification** — TypeScript 0 errors · production build PASS · all 3 test suites PASS ·
> visual parity confirmed on 6 before/after screens · full runtime QA against a scripted
> backend (streaming turns, artifacts, Univer viewer, error/cancel states, settings,
> light mode).
>
> **Original kept safe** — the untouched `frontend/` folder sits beside this one for
> comparison. This folder is a drop-in replacement: swap whenever ready. The git branch
> `refactor/frontend-architecture` carries the same content with the full phase-by-phase
> commit history (10 commits, incl. a final hygiene pass: dead `apiClient.ts` deleted,
> debug scripts removed, stale SSE comments corrected).

- **Architecture** — read [`ARCHITECTURE.md`](./ARCHITECTURE.md) first: folder map, feature boundaries, dependency rules, how to add things.
- **Conventions** — [`COMPONENT_GUIDELINES.md`](./COMPONENT_GUIDELINES.md): where new code goes, container/view split, naming, merge checklist.
- **Refactor audit** — [`docs/refactor-audit.md`](./docs/refactor-audit.md): the pre-refactor analysis and phase log.

## Run

```bash
npm install
npm run dev        # expects the connector backend on :8000 (NEXT_PUBLIC_API_URL to override)
```

## Verify (all must pass before merge)

```bash
npx tsc --noEmit
npm run build
node test_right_sidebar_logic.cjs
node tests/test_chat_scenarios.mjs
bun tests/fuzz_session_store.ts
```
