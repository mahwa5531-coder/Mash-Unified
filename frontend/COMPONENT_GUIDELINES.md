# MASh Frontend — Component Guidelines

Short, practical rules. Architecture rationale lives in `ARCHITECTURE.md`.

## Where does new code go?

| You are writing… | It goes in… |
|---|---|
| A shadcn-style primitive | `components/ui/` |
| App-wide chrome (headers, bars, frames) | `components/layout/` |
| A content renderer (code, tables, diagrams, files) | `components/renderers/` |
| Anything only one feature renders | `features/<feature>/components/` |
| A hook only that feature uses | `features/<feature>/hooks/` |
| A hook useful anywhere (theme, media, etc.) | `hooks/` |
| Backend calls | `services/<domain>.ts` — never in a component |
| Pure data transformation | `features/<feature>/utils/` if feature-specific, `utils/` if generic |
| A shared domain type | `types/` — if genuinely shared; otherwise co-locate with the feature/service that owns it |
| State several components of ONE feature share | `features/<feature>/state/` |

## When to create a component

Extract a component when:
- the same JSX appears in 2+ places, or
- a file mixes >1 responsibility AND the boundary is a prop-friendly seam, or
- a block needs its own memo/lifecycle isolation.

Do NOT extract when the only motivation is "the file is long". Split by responsibility, not line count. A 300-line pure JSX block with one job is fine.

## Reuse before creation

Before writing a new component, search:
```
rg "<Name|concept" src/components src/features
```
If a similar concept exists, extend it with a variant prop instead of forking it. If you fork it anyway, leave a comment explaining why the concepts differ.

## Container/view split (the pattern used in this codebase)

Big feature screens follow this shape:
- **Container** (e.g. `RightSidebar.tsx`, `Sidebar.tsx`, `TaskWorkLogAccordion.tsx`) — owns state, effects, services calls, and handlers; renders almost no JSX itself.
- **View components** (e.g. `ViewerHeader`, `ExplorerPanel`, `SessionItemRow`, `TimelineRow`) — receive state + handlers as props and render. Prop names mirror the container's identifiers so the JSX stays identical to the original.

When decomposing, keep ALL logic in the container and move ONLY JSX. This is how this refactor preserved behavior byte-for-byte.

## Naming

- Components: `PascalCase.tsx` matching the default/named export
- Hooks: `useThing.ts`
- Pure utils: `camelCase.ts`
- Types: `PascalCase`, co-located with their owner unless shared
- No `Helpers.ts`, `Misc.ts`, `Common.ts`, `Thing2.tsx`
- Feature barrels are always `index.ts` and export ONLY the public API

## Import rules

1. Always use the `@/` alias for cross-file imports — no `../../..` chains.
2. Cross-feature imports go through the feature barrel: `from '@/features/chat'`, never `from '@/features/chat/components/...'`.
3. Components never import `services` inside render loops; effects/hooks only.
4. `components/renderers` and `components/ui` must not import features or services.

## Adding a service function

```ts
// services/sessions.ts
export async function fetchX(sessionId: string): Promise<X | null> {
  try {
    const res = await safeFetch(`${BASE_URL}/x/${sessionId}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
```
Follow the existing conventions: `safeFetch`, graceful `null`/`[]` fallbacks, typed returns, no UI concerns.

## Performance rules (agentic app — streams get large)

- Never do O(N) work per streamed token; buffer and flush on animation frames (see `useChatStream`).
- Memoize derived collections (`useMemo`) — see `groupedTimeline`, `filteredArtifacts`.
- Do not spread large arrays in render unless the original did.
- Keep the WeakMap artifact cache pattern when adding per-message derivations.

## Before you merge

```
npx tsc --noEmit        # types
npm run lint            # no NEW violations vs master
npm run build           # production build
node test_right_sidebar_logic.cjs && node tests/test_chat_scenarios.mjs && bun tests/fuzz_session_store.ts
```
And for UI changes: screenshot before/after and compare (see `mash-screenshots/` in the repo root for the baseline gallery).
