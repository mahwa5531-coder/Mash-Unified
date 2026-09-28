# MASh Frontend — Architecture

> Valid architecture reference after the `refactor/frontend-architecture` branch.
> For the state before the refactor and the migration audit, see `docs/refactor-audit.md`.

## Top-level structure

```
frontend/src/
├── app/                      # Next.js App Router — routes only
│   ├── layout.tsx            # root layout + fonts
│   ├── page.tsx              # composition root: wires app state to features
│   └── globals.css           # design tokens (CSS variables, theme switching)
│
├── components/
│   ├── ui/                   # shadcn primitives (button, badge, tooltip, …)
│   ├── layout/               # app-wide chrome
│   │   ├── WindowTitleBar.tsx     # title bar + window controls
│   │   └── ChatToolbar.tsx        # row-2 toolbar + breadcrumb
│   └── renderers/            # shared content renderers (used by chat AND viewer)
│       ├── Blockquote.tsx / CalloutBlockquote.tsx
│       ├── CodeBlock.tsx / TableContainer.tsx
│       ├── FileIcon.tsx / MermaidRenderer.tsx
│   └── ErrorBoundary.tsx     # scoped error isolation
│
├── features/                 # feature-owned code — the heart of the architecture
│   ├── auth/       components/DesktopSignInView
│   ├── chat/
│   │   ├── components/       ChatCanvas, ChatComposer, QuotaBanner,
│   │   │                     ScrollToBottomButton, TaskWorkLogAccordion
│   │   │   ├── messages/     AssistantMessage, UserMessage
│   │   │   └── work-log/     TimelineRow, FilePill, toolTimeline (pure),
│   │   │                     types
│   │   ├── hooks/            useChatStream (orchestration), useScrollToBottom
│   │   ├── state/            sessionStore (multi-session runtime state, LRU-25)
│   │   ├── utils/            turns (transcript → turns parsing)
│   │   └── index.ts          PUBLIC API of the feature
│   ├── artifacts/  components/ (ArtifactCard, FilesChangedDrawer),
│   │               utils/extraction (detection from messages)
│   ├── sessions/   components/ (Sidebar, ConversationHistory, SessionItemRow,
│   │               SessionContextMenu, icons)
│   ├── settings/   components/SettingsModal
│   └── viewer/     components/ (RightSidebar container, SafeFileViewer,
│                   ViewerHeader, ExplorerPanel, EditorSubheader,
│                   TerminalViewer, ViewerEmptyState, CollapsibleSection,
│                   Univer viewer pair), utils/artifactPresentation, types
│
├── services/                 # ALL backend communication (no UI)
│   ├── client.ts             # BASE_URL + safeFetch transport
│   ├── auth.ts               # fetchAuthMe, logoutUser
│   ├── sessions.ts           # sessions, transcript, rename/delete, queue, uploads
│   ├── stream.ts             # streamQuery — SSE parser + event normalization
│   ├── files.ts              # LRU-cached file content, paged Excel
│   ├── tasks.ts              # background tasks, task logs
│   ├── artifacts.ts          # session artifacts
│   └── projects.ts           # projects, folders, directory browsing
│
├── hooks/                    # app-generic hooks (useIsDarkMode)
├── lib/                      # cn() class utility
├── types/                    # shared domain models
│   ├── chat.ts               # Message, ToolCall, SubTask, Step, Turn, …
│   └── artifacts.ts          # ArtifactItem, EditedFileItem
└── utils/                    # pure functions
    ├── formatting.ts         # formatRelativeTime
    └── sessionTitle.ts       # generateCleanSessionTitle, toTitleCase
```

## Feature boundaries

| Feature | Owns | Does NOT own |
|---|---|---|
| **chat** | streaming orchestration, message rendering, composer, work log, session runtime state | persistence (services), artifact cards (artifacts feature) |
| **artifacts** | artifact detection from messages, deliverable cards, edited-file drawer | viewing files (viewer feature) |
| **sessions** | sidebar navigation, session lists, context menu, history page | chat state (imports via `@/features/chat` barrel) |
| **viewer** | right panel: explorer, file/code/excel/terminal viewing, tabs | file fetching (services/files) |
| **settings** | settings modal, theme engine UI, project management UI | project API calls (services/projects) |
| **auth** | sign-in view | auth API (services/auth) |

## Dependency rules (enforced by convention)

```
app
 └─> features (via barrel index.ts ONLY)
       └─> services ─> types / lib
       └─> components/{ui,layout,renderers}
       └─> types / utils / hooks / lib
```

1. **Features never import each other's internals.** Cross-feature imports go through the feature's `index.ts`. The one sanctioned cross-feature edge is `chat → artifacts` (chat renders artifact cards).
2. **Services never import features or components.** They return typed data.
3. **`components/renderers` never import services or features** — they are pure presentation over content.
4. **`page.tsx` is a composition root**: it owns app-level UI state (selection, panel toggles, theme) and wires callbacks between features. It contains no rendering of feature internals.

## State architecture

| Layer | Location | Contents |
|---|---|---|
| App UI state | `app/page.tsx` | selected session, sidebar/panel toggles, theme, history mode |
| Feature runtime state | `features/chat/state/sessionStore.ts` | module-level multi-session store (messages, buffers, abort controllers, LRU-25 eviction, subscription listeners) |
| Feature local state | each container component | e.g. viewer tabs, sidebar folders, work-log expansion |
| Server data | `services/*` + feature effects | fetched via services, cached per feature need |

The session store is a deliberate module singleton: it survives component unmounts so switching sessions is 0ms and background streams keep writing into non-viewed sessions.

## Streaming architecture

```
services/stream.ts (streamQuery)     SSE transport + AG-UI event normalization
        │ onToken/onThought/onToolCall/onTasks/onError
        ▼
features/chat/hooks/useChatStream    rAF-batched flush into sessionStore
        │ chatMessages state
        ▼
ChatCanvas → buildTurns (utils/turns) → AssistantMessage → TaskWorkLogAccordion
```

There is exactly ONE interpretation of backend stream events (`services/stream.ts`). Nothing else parses SSE.

## How to add…

**A new feature** — create `features/<name>/{components,hooks,state,utils}/`, add `index.ts` with the public API, import it from `page.tsx`. Talk to backends only through a new `services/<name>.ts`.

**A new backend endpoint** — add the function to the owning service module (`services/sessions.ts` etc.). Never `fetch` directly from a component.

**A new content renderer** (e.g. PDF preview in chat) — add `components/renderers/PdfRenderer.tsx`, mount it from the content-type dispatch in `SafeFileViewer.tsx` and/or `AssistantMessage.tsx` markdown config. No other file changes.

**A new tool-call visualization** — extend `features/chat/components/work-log/toolTimeline.ts` (pure entry construction) and render the new entry type in `TimelineRow.tsx`.

**A new session-list action** — add the handler in `Sidebar.tsx` (container), pass it to `SessionContextMenu`/`SessionItemRow` as a prop.

## Testing

- `node test_right_sidebar_logic.cjs` — tab dedup/close/large-file logic
- `node tests/test_chat_scenarios.mjs` — chat rendering scenarios
- `bun tests/fuzz_session_store.ts` — property-based fuzzing of the session store + race conditions

All three must pass before any merge (`tsc --noEmit` and `next build` too).

## Known technical debt (intentionally NOT fixed in this refactor)

Documented in `docs/refactor-audit.md` §5 — the refactor changed structure, not behavior. Outstanding items include the sticky-header occlusion bug, light-mode chrome inconsistencies, disabled tool grouping, dual scroll thresholds, and the `showTasksBar` dead state.
