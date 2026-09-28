# Frontend Architecture Audit — Before Refactor

> Baseline captured on branch `refactor/frontend-architecture` at commit `677c139`.
> Verified baseline: `tsc --noEmit` PASS · `next build` PASS · 3/3 test suites PASS
> (test_right_sidebar_logic.cjs, tests/test_chat_scenarios.mjs, tests/fuzz_session_store.ts)
> Pre-existing lint: 208 problems (122 errors) — unchanged by this refactor unless noted.

## 1. Current structure (13,205 lines / 44 files)

```
src/
├── app/            page.tsx (400) — composition root + window chrome + 17 useState
├── components/
│   ├── (root)      ChatCanvas, ConversationHistory, ErrorBoundary, PlanApprovalModal†,
│   │               RightSidebar, SafeFileViewer, SettingsModal, Sidebar
│   ├── auth/       DesktopSignInView
│   ├── chat/       ArtifactCard, ChatComposer, FilesChangedDrawer, MermaidRenderer,
│   │               QuotaBanner, ScrollToBottomButton, TaskWorkLogAccordion
│   ├── common/     Blockquote, FileIcon, UniverExcelViewer, UniverExcelViewerInner
│   ├── messages/   AssistantMessage, CalloutBlockquote, CodeBlock, TableContainer, UserMessage
│   └── ui/         10 shadcn primitives
├── hooks/          useChatStream (store + hook), useIsDarkMode, useScrollToBottom
├── lib/            artifactExtraction, turns, types, utils(cn)
└── utils/          apiClient (god module), parseTranscript (types-only, misleading name)
```
† = dead code

## 2. Size hotspots (8 files ≥ 500 lines = 53% of codebase)

| File | Lines | Mixed responsibilities |
|---|---:|---|
| components/RightSidebar.tsx | 1,285 | fetch + poll + SSE + tab memory + resize math + 3 view modes + file-type dispatch |
| hooks/useChatStream.ts | 1,182 | module-level store + transport wiring + state machine + title generation + queue policy + pagination |
| components/Sidebar.tsx | 1,101 | polling + optimistic mutations + folder-picker chain + context-menu geometry + localStorage |
| components/chat/TaskWorkLogAccordion.tsx | 1,074 | timeline + 7 tool-row renderers + command console + (disabled) group cards |
| utils/apiClient.ts | 1,028 | transport + 8 endpoint domains + DTO types + SSE parser + LRU cache + 2 formatter families |
| components/SettingsModal.tsx | 852 | theme engine + project CRUD + account + nested confirm |
| components/messages/AssistantMessage.tsx | 775 | markdown config + badge/pill lexing + lightbox + error policy + artifact ordering |
| components/SafeFileViewer.tsx | 551 | file-type dispatch + toolbar + markdown/code/raw/image/excel render paths |

## 3. Architectural problems found

1. **No feature boundaries.** Chat code lives in 3 folders (root, `chat/`, `messages/`); viewer code in 3 (root, `common/`); nothing marks ownership.
2. **God module `apiClient.ts`.** Every domain's endpoints, DTOs, the SSE stream parser, an LRU file cache, `formatRelativeTime`, and 100 lines of title-casing heuristics in one file that 12 modules import — several only for `BASE_URL` or a type.
3. **Store hidden in a hook file.** `sessionStore` (multi-session runtime state, LRU-25) is exported from `useChatStream.ts`; `page.tsx` and `Sidebar` import it from there. State layer is invisible.
4. **Lying filename.** `utils/parseTranscript.ts` contains only types; the actual parser is `lib/turns.ts`. Both shapes flow through messages (`Step` vs `ExecutionStep` duality).
5. **Dead code.** `PlanApprovalModal` (never mounted), `approvePlan`, `fetchWorkspaceTree`, `loginUser`, `fetchUploads` (duplicate of `fetchSessionUploads`), `clearSessionQueue`, `showTasksBar` state. All verified zero callers.
6. **Shared renderers misplaced.** `CodeBlock`, `TableContainer`, `CalloutBlockquote` live under `messages/` but are also used by the viewer (`SafeFileViewer`).
7. **Dependency-direction violations.** `lib/artifactExtraction` imports `BASE_URL` from `utils/apiClient` (lib → utils/api layer); feature components import raw API functions directly.
8. **Mixed import styles.** `@/` aliases and `../` relatives used inconsistently, sometimes in the same file.

## 4. Canonical component inventory (duplicates & reuse)

| Concept | Current copies | Canonical location (target) | Reusable? |
|---|---:|---|---|
| FileIcon | 1 (used by chat/artifacts/viewer) | components/renderers/FileIcon | Yes — keep |
| CodeBlock | 1 (chat + viewer) | components/renderers/CodeBlock | Yes — keep |
| TableContainer | 1 (chat + viewer) | components/renderers/TableContainer | Yes — keep |
| CalloutBlockquote + Blockquote | 2 files (wrapper + base) | components/renderers/ (both) | Yes — keep pair |
| "file pill" chips | inline in TaskWorkLog + AssistantMessage + FilesChangedDrawer | assess in Phase G — visually different variants; consolidate only if genuinely same concept | TBD |
| Session relative-time label | 1 helper (formatRelativeTime) | utils/formatting | Yes |
| Session title derivation | 1 heuristic block | utils/sessionTitle | Yes |

## 5. Dangerous areas (behavior-preservation watchlist)

- `useChatStream` rAF-batched flush + visibilitychange handling — perf-critical, do not re-order.
- Race-condition handling: history fetch landing mid-stream (prepend behind in-flight turns).
- Background session completion → `hasUnread` marking + auto-dispatch of queued messages (100 ms setTimeout chain).
- Undo semantics: local slice + remote `/undo` DELETE.
- Two scroll thresholds (80px hook vs 20px useScrollToBottom) — inconsistent but EXISTING behavior; preserve as-is.
- Sticky user-message header occlusion bug — known bug, do NOT fix here (no behavior changes).
- Univer/Mermaid dynamic-import unmount warnings — latent, preserve as-is.
- localStorage key prefixes (`nexau_*` vs `mash_*`) — preserve exactly.

## 6. Target architecture

See `../ARCHITECTURE.md` (written at refactor completion). Summary:

```
src/
├── app/                  routes only (thin page.tsx)
├── components/
│   ├── ui/               shadcn primitives
│   ├── layout/           WindowTitleBar, ChatToolbar
│   └── renderers/        shared content renderers (Blockquote, CalloutBlockquote,
│                         CodeBlock, FileIcon, MermaidRenderer, TableContainer)
├── features/
│   ├── auth/components/DesktopSignInView
│   ├── chat/{components,components/messages,hooks,state,utils}
│   ├── artifacts/{components,utils}
│   ├── sessions/components
│   ├── settings/components
│   └── viewer/components
├── services/             client, auth, sessions, stream, files, tasks, artifacts, projects
├── hooks/                useIsDarkMode (app-generic only)
├── lib/                  cn()
├── types/                chat.ts, artifacts.ts (domain models)
└── utils/                formatting, sessionTitle (pure functions)
```

Dependency direction: `app → features → (services | components | types | utils) → lib`. Features never import each other's internals — only via feature barrel (`index.ts`); the one sanctioned cross-feature edge is chat → artifacts (chat renders artifact cards).

## 7. Phase plan & verification gates

| Phase | Content | Gate |
|---|---|---|
| A | Folder moves + import normalization + dead-code deletion | tsc + build + 3 test suites |
| B | apiClient → services/* + utils/{formatting,sessionTitle} + types/* | same |
| C | sessionStore extraction out of useChatStream | same |
| D | WindowTitleBar + ChatToolbar extraction from page.tsx | same |
| E | RightSidebar decomposition | same |
| F | Sidebar decomposition | same |
| G | TaskWorkLogAccordion decomposition + pill assessment | same |
| H | Docs: ARCHITECTURE.md, COMPONENT_GUIDELINES.md, README | — |
| I | Runtime parity: mock backend + screenshots vs `mash-screenshots/` baseline | visual parity |

Every phase is a separate commit. No phase proceeds until the previous gate passes.
