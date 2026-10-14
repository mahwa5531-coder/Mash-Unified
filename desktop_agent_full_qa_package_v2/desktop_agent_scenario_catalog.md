# Desktop Agent Application — Step-by-Step End-to-End Scenario Catalogue

**Purpose:** A test catalogue for a chat-based, agentic desktop application. It uses interaction patterns seen in agentic desktop products such as OpenAI Codex and Google Antigravity as reference points, but every test must be mapped to the features actually present in this repository.

**Important:** Do not assume a feature exists just because it appears in a reference product. Mark each scenario `APPLICABLE`, `NOT APPLICABLE` (with repository evidence), `BLOCKED`, or `NOT RUN`. Do not count missing, blocked, or unrun tests as passed.

## How to use this catalogue

1. Discover the app's actual screens, controls, modes, cards, runtime states, supported tools, file formats, storage locations, and event protocol.
2. Map every scenario below to the real UI labels and implementation paths. Add discovered scenarios that are not listed here.
3. For each test, capture: preconditions, exact UI actions, visible result, runtime/API effect, persisted effect, negative assertions, logs/screenshots/traces, and status.
4. Run deterministic tests with mocked model responses and controlled tool implementations first. Run real desktop UI tests in an isolated profile. Use a real API/model only for explicitly approved smoke tests.
5. Every failed path must be followed by a recovery test. Preserve first-failure evidence; retries do not erase a flaky result.
6. Parallelize code analysis and isolated suites. Do not let multiple workers control the same live desktop window or mutate the same database/workspace at the same time.

## Required result labels

- `PASS`: test executed and all expected assertions passed.
- `FAIL`: product behavior violated an assertion.
- `FLAKY`: outcome varied across identical controlled runs.
- `BLOCKED`: could not execute because a required capability or environment was unavailable.
- `NOT RUN`: planned but not executed.
- `N/A`: feature is absent by design, backed by repository evidence.

## Scenario record format

For every scenario, the agent must record: **ID; feature/control; priority; preconditions; exact steps; expected UI; expected runtime/API/storage effects; negative assertions; evidence; result; bug ID.**

Priority guide: **P0** release-critical/data-integrity/security; **P1** core task journey; **P2** significant secondary behavior; **P3** lower-risk polish/edge cases.

---

# A. Install, startup, and application shell

### APP-001 — First launch with an empty profile (P1)
**Steps**
1. Start the packaged app using a fresh isolated Windows profile and empty app data.
2. Observe splash/loading state, initialization, default workspace, empty sidebar, main chat area, and right pane.
3. Wait for startup to settle without clicking anything.
4. Close normally and relaunch.
**Expected:** App reaches a usable state; no blank/overlapping panes, stale loading spinner, duplicate startup windows, or unhandled error. Fresh-state copy and actions are coherent. The second launch remains healthy.

### APP-002 — Normal warm launch (P1)
1. Create a test project/session and one completed conversation.
2. Close the app normally.
3. Relaunch and inspect the project/session list and last-viewed layout.
**Expected:** State is restored according to the product's persistence contract; no duplicate sessions/messages or accidental new project.

### APP-003 — Startup with local runtime not ready (P1)
1. In an isolated test environment, prevent the local runtime/service from becoming ready.
2. Launch the app.
3. Observe the loading/error card, retry action, diagnostics, and enabled/disabled controls.
4. Restore the runtime and activate the supported retry/reconnect action.
**Expected:** The app explains the blocked dependency; does not pretend it is ready or spin indefinitely; recovery works without relaunch if supported.

### APP-004 — Startup when API/internet is unavailable (P1)
1. Launch with the network disabled or the test API unreachable.
2. Inspect local history, project navigation, file viewer, draft composer, and task submission.
3. Submit a test prompt and observe the result.
4. Restore network and use the displayed recovery path.
**Expected:** Local capabilities follow the documented offline contract; remote execution does not falsely succeed; drafts/history are not silently lost; retry behavior is clear and does not duplicate the request.

### APP-005 — Initialization fails halfway (P1)
1. Inject a controlled initialization failure after one component loads.
2. Observe which panes/actions remain available.
3. Retry or restart using the supported recovery path.
**Expected:** Partial initialization is clearly represented; no corrupted profile or duplicated initialization handlers after recovery.

### APP-006 — Minimize, restore, maximize, resize (P2)
1. Open a long conversation and a file viewer.
2. Minimize and restore; maximize and restore; resize repeatedly to supported window sizes.
3. Repeat while a response is streaming.
**Expected:** No lost task, incorrect pane ownership, clipped essential controls, unintended reset of scroll/content, or stuck overlay.

### APP-007 — Close window during idle/stream/tool execution (P1)
1. Repeat the test with the app idle, streaming output, and executing a controlled long-running tool.
2. Close the window each time and inspect any confirmation/keep-running behavior.
3. Relaunch and inspect task/session state.
**Expected:** Behavior matches the product contract; no silent data corruption or falsely completed task; user is not misled about work continuing or stopping.

### APP-008 — Double launch / rapid reopen (P2)
1. Launch the app twice rapidly or reopen it from its shortcut/tray if supported.
2. Observe whether a second process/window opens or the existing instance is focused.
**Expected:** Behavior is intentional; no duplicate event listeners, lock conflicts, or two windows racing over the same session state.

### APP-009 — App data directory missing or unwritable (P1)
1. In a disposable profile, make the configured data directory unavailable or read-only.
2. Launch and attempt to create a session.
3. Restore permissions and retry.
**Expected:** Clear storage error; no false success; recovery leaves a consistent state.

### APP-010 — Update/install/rollback lifecycle (P1, if shipped)
1. Install build A in an isolated VM/profile.
2. Create project, session, and artifact.
3. Upgrade to build B; launch and verify data migration.
4. Simulate update failure only in a safe installer test environment; verify rollback/recovery.
**Expected:** Update does not erase user data or leave an unlaunchable app. If no updater exists, record N/A.

---

# B. Projects and workspace management

### PROJ-001 — Create project using a valid empty folder (P1)
1. Click the actual project-creation control.
2. Select a unique empty folder.
3. Confirm the action.
4. Inspect project list, selected project, main pane, and project path.
**Expected:** Exactly one project appears and becomes active if that is the documented behavior; the stored path and visible project agree.

### PROJ-002 — Create project using a populated folder (P1)
1. Select a disposable folder containing nested folders and mixed file types.
2. Create/open it as a project.
3. Expand the file tree and open several files.
**Expected:** Files are represented correctly; no unexpected move, deletion, or modification of existing files.

### PROJ-003 — Cancel project creation (P2)
1. Open the project chooser/create flow.
2. Cancel the folder picker or confirmation.
3. Inspect project list and active selection.
**Expected:** No project is created and the previous context remains intact.

### PROJ-004 — Invalid/nonexistent project path (P1)
1. Attempt to add a path that does not exist or is inaccessible.
2. Observe validation and any error card.
3. Correct the path and retry.
**Expected:** Action is rejected clearly; no ghost project entry; retry succeeds after correction.

### PROJ-005 — Add the same project twice (P2)
1. Add a folder as a project.
2. Repeat the operation using the same canonical path and then a path spelling that resolves to the same location.
**Expected:** Product's duplicate policy is enforced consistently; no duplicate project identity or confusing sidebar entries.

### PROJ-006 — Project with Unicode, spaces, long path (P2)
1. Create test folders containing spaces, non-Latin characters, and long but supported paths.
2. Add them as projects and open files inside them.
**Expected:** Correct display and filesystem access; no encoding/path truncation bug.

### PROJ-007 — Switch projects with an active task (P1)
1. Start a controlled task in project A.
2. Switch to project B and inspect status indicators.
3. Return to project A.
**Expected:** Task state remains attached to A; B does not show A's messages/tool calls/artifacts; switching does not cancel work unless explicitly specified.

### PROJ-008 — Rename project (P2, if supported)
1. Rename a project through the actual UI.
2. Verify sidebar, active heading, persisted metadata, recent lists, and restart behavior.
**Expected:** One consistent new name; underlying folder is not renamed unless the feature explicitly does that.

### PROJ-009 — Remove/delete project (P1, if supported)
1. Create a project with a session and a synthetic artifact.
2. Activate the project's remove/delete operation.
3. Inspect the confirmation text and scope.
4. Cancel; verify nothing changed.
5. Repeat and confirm deletion/removal.
6. Inspect filesystem, other projects, and session history.
**Expected:** Distinguish “remove from app” from “delete files from disk.” The action must communicate scope, obey confirmation policy, and never delete unrelated data.

### PROJ-010 — Remove project during active task (P1)
1. Start a task in a disposable project.
2. Attempt project removal while running.
3. Observe block/confirm/wait behavior.
4. Complete or cancel the task and repeat removal.
**Expected:** No orphaned execution writing into an unexpected path; behavior follows documented policy.

### PROJ-011 — Reopen missing or moved project (P1)
1. Add a project; close the app.
2. Move or rename the test folder externally while the app is closed.
3. Relaunch and select the stale project entry.
**Expected:** Clear missing-path state and a safe relink/remove option if implemented; no crash or fabricated file listing.

### PROJ-012 — Multi-folder project (P2, if supported)
1. Add a workspace with multiple root folders.
2. Expand each root, open files, and create an artifact in the intended root.
**Expected:** Roots remain distinguishable; operations use the correct root; no cross-root path confusion.

---

# C. Sessions and conversation history

### SESS-001 — Create first session from empty state (P1)
1. Launch with no sessions.
2. Click the actual new-session action.
3. Inspect sidebar selection, title, composer, and empty-state actions.
**Expected:** Exactly one session is created/initialized according to the app's model; composer is usable and session identity is stable.

### SESS-002 — Create session with an existing session selected (P1)
1. Create session A and send a synthetic message.
2. Click New Session.
3. Verify session B starts with the expected empty context.
4. Return to A and verify its message remains.
**Expected:** No accidental inheritance or mixing of conversation history.

### SESS-003 — Create many sessions quickly (P2)
1. Activate New Session repeatedly, including rapid double-clicks.
2. Count created sessions and inspect selection order.
**Expected:** Behavior is deterministic; duplicate sessions are not created from one intended action unless that is the explicit behavior.

### SESS-004 — Rename session (P2, if supported)
1. Rename a session to a normal title.
2. Rename to blank/whitespace, long text, Unicode, and a duplicate title.
3. Restart and inspect.
**Expected:** Validation and duplicate-title handling are consistent; internal IDs remain stable when only labels change.

### SESS-005 — Switch sessions while idle (P1)
1. Create sessions A, B, and C with unique messages.
2. Switch A → B → C → A.
**Expected:** Correct history, title, task state, draft policy, and selected row each time.

### SESS-006 — Switch sessions during streaming (P1)
1. Start a long, controlled response in A.
2. Switch to B while output continues.
3. Send a task in B if supported.
4. Return to A.
**Expected:** Events route to correct sessions; scroll and streaming indicators are correct; no text leaks across threads.

### SESS-007 — Switch sessions during tool execution (P1)
1. Start a task in A that pauses inside a mock tool.
2. Switch to B, perform a separate action, then return to A.
**Expected:** Tool status is preserved; no duplicate dispatch from navigation; results attach to A.

### SESS-008 — Archive/hide session (P2, if supported)
1. Archive a session using its row menu.
2. Verify it disappears from the active list but remains discoverable under the appropriate archived view.
3. Restore/unarchive it if supported.
**Expected:** Archiving is not mistaken for permanent deletion; history remains intact.

### SESS-009 — Delete session (P1, if supported)
1. Create a session with a message and artifact.
2. Select Delete from the session menu.
3. Check confirmation wording and affected scope.
4. Cancel and verify state is unchanged.
5. Confirm and verify it disappears from the active list.
6. Restart and check whether deletion persisted.
**Expected:** Correct session is removed; project/files are not unexpectedly deleted; irreversibility is clearly communicated where applicable.

### SESS-010 — Delete/archive active session during execution (P1)
1. Start a controlled active task.
2. Attempt archive/delete on that session.
3. Follow the available cancel/confirm flow.
4. Inspect runtime state and any late response.
**Expected:** No hidden task continues producing confusing orphaned output; policy is explicit and state is consistent.

### SESS-011 — Empty/failed session title generation (P2, if titles are generated)
1. Create a session and immediately close/reopen or interrupt the first request.
2. Inspect the title fallback and subsequent title generation.
**Expected:** No empty, duplicated, raw prompt overflow, or stale title behavior beyond the defined contract.

### SESS-012 — Search/filter sessions (P2, if supported)
1. Create sessions with unique, similar, Unicode, and long titles.
2. Search exact match, partial match, no match, and clear query.
3. Navigate results by keyboard and mouse.
**Expected:** Correct result set and focus; clearing search restores the expected list.

### SESS-013 — Context isolation across sessions (P0)
1. In A, provide a unique synthetic marker such as `ALPHA-SESSION-7391`.
2. In B, ask a task whose answer must only use B's supplied context.
3. Inspect rendered result, model request fixture/context log, tool inputs, and artifacts.
**Expected:** No accidental transfer of A's private prompt/files into B, unless an explicit shared-project/context feature is active and visible.

### SESS-014 — Session list with many entries (P2)
1. Generate enough sessions to require sidebar scrolling/virtualization.
2. Scroll, select entries near the top/bottom, search if supported, and resize sidebar.
**Expected:** Correct row identity and selection; no wrong-session click due to virtualization or stale index.

---

# D. Composer, inputs, attachments, and queued messages

### INPUT-001 — Basic single-line prompt (P1)
1. Type a short prompt.
2. Submit using the primary send button.
3. Repeat using Enter if that is the documented shortcut.
**Expected:** Exactly one user message and one execution; composer clears or retains text according to the defined UX.

### INPUT-002 — Multiline prompt (P1)
1. Type several lines.
2. Insert newlines using the documented shortcut.
3. Submit through the intended action.
**Expected:** Newline behavior is correct; Enter does not unexpectedly submit in multiline mode.

### INPUT-003 — Blank and whitespace-only prompt (P2)
1. Attempt to submit an empty prompt.
2. Repeat with spaces, tabs, and newline-only content.
**Expected:** Invalid submissions are blocked or handled according to policy; no empty task is created accidentally.

### INPUT-004 — Very long prompt (P2)
1. Paste a prompt near the supported limit, then one exceeding it.
2. Inspect editor responsiveness, truncation/validation, and error display.
**Expected:** No freeze or silent content truncation; any limit is communicated clearly.

### INPUT-005 — Unicode and special characters (P2)
1. Enter Indic text, accented characters, emoji, RTL text, quotes, backslashes, and punctuation.
2. Submit and compare exact input with the stored/rendered message.
**Expected:** Encoding and text direction are handled acceptably; no corrupted characters.

### INPUT-006 — Paste large text/code/table (P2)
1. Copy synthetic multiline text and tabular content to clipboard.
2. Paste into the composer and scroll/edit before sending.
**Expected:** Paste completes without freezing; boundaries and line breaks are preserved.

### INPUT-007 — Edit unsent draft (P1)
1. Type a prompt.
2. Select all, replace text, move cursor, edit middle, and undo/redo text edits if supported.
3. Navigate away and back.
**Expected:** Exact draft state follows the documented draft-persistence policy; no unintended submission.

### INPUT-008 — Draft isolation per session (P1)
1. Type an unsent draft in A.
2. Switch to B and type a different draft.
3. Switch repeatedly between A and B.
**Expected:** Drafts are isolated or cleared consistently according to product specification; one draft never silently replaces another.

### INPUT-009 — Double-click Send / press Enter repeatedly (P1)
1. Prepare a prompt with deterministic response.
2. Double-click Send or press the shortcut rapidly.
3. Count user messages, execution IDs, and tool calls.
**Expected:** Duplicate submission is prevented or the UI clearly creates distinct tasks; one intended submission never silently dispatches twice.

### INPUT-010 — Send while busy (P1)
1. Start a task and wait for the running state.
2. Type a second prompt.
3. Try to submit it.
**Expected:** The product follows a clear policy: queue, reject, or start a separate run. UI, runtime, and persisted state agree.

### INPUT-011 — Queued message card lifecycle (P1, if supported)
1. Start a long task.
2. Submit one or more follow-up messages while it runs.
3. Inspect the queued-message card/count/order.
4. Edit, remove, cancel, or reorder only if these actions exist.
5. Let the active task finish and observe queue draining.
**Expected:** Each queued message runs exactly once, in a defined order; card count, text, and execution state remain synchronized after success/failure/cancellation.

### INPUT-012 — Attachment or file pill lifecycle (P1, if supported)
1. Attach a valid supported file by each available method (picker, drag-drop, paste, or file reference).
2. Inspect filename/type/size pill and preview if present.
3. Remove it, attach a second file, and submit.
**Expected:** Correct file is sent; removal removes the attachment; no stale hidden attachment remains.

### INPUT-013 — Invalid/unreadable/oversized attachment (P1, if supported)
1. Attach unsupported, corrupt, inaccessible, and oversized synthetic files.
2. Observe validation, progress, cancellation, and error cards.
3. Retry with valid input.
**Expected:** Clear failure; no false attachment success; app remains usable.

### INPUT-014 — Attachment changes while submission begins (P1)
1. Attach a file.
2. Rapidly remove/replace it as submission is clicked or triggered.
3. Inspect submitted payload and resulting UI.
**Expected:** The execution uses one well-defined attachment set; no race where the UI shows one file but the runtime receives another.

### INPUT-015 — Composer focus and keyboard shortcuts (P2)
1. Focus the composer using mouse and shortcut.
2. Switch focus to sidebar, card, or viewer; then use the shortcut to return.
3. Verify Enter, newline, Escape, copy/paste, select-all, undo/redo, and navigation shortcuts where implemented.
**Expected:** Shortcuts act on the focused control only; global shortcuts do not unexpectedly trigger the viewer/composer simultaneously.

---

# E. Agent modes, cards, approvals, and task steering

For each card type, test appearance, content, all visible buttons, keyboard activation, loading/disabled states, duplicate activation, dismiss/close behavior, state persistence, and recovery after a failure. Only apply scenarios to card types that exist in the product.

### CARD-001 — Planning mode produces plan/review artifact (P1, if supported)
1. Start a task using the planning mode.
2. Wait for a plan/artifact card.
3. Expand it, scroll it, inspect sections, and switch away/back.
4. Submit feedback or inline comments if supported.
5. Approve/continue, reject/revise, or cancel using the actual actions.
**Expected:** Plan content belongs to the correct task; review decision changes the execution state exactly once; feedback reaches the agent context.

### CARD-002 — Fast/direct execution mode (P1, if supported)
1. Start a small task in the direct/fast mode.
2. Verify whether planning/review cards are intentionally skipped.
3. Compare the execution path and final artifact with expected mode policy.
**Expected:** Correct mode is shown and respected; mode switching does not leak from another session.

### CARD-003 — Change mode between sessions (P1, if model/mode selection exists)
1. Set session A to mode/model X.
2. Switch to B and select mode/model Y.
3. Return to A and inspect the selector and next request metadata.
**Expected:** Mode/model is session-specific or global exactly as specified; stale labels cannot misrepresent the model actually used.

### CARD-004 — Approval/permission card: approve (P1, if supported)
1. Configure a safe mock operation that requires approval.
2. Start a task that reaches the approval boundary.
3. Inspect operation details, scope, and approve/reject controls.
4. Approve once.
**Expected:** Only the described operation proceeds; the card updates, and the runtime records the decision.

### CARD-005 — Approval/permission card: reject (P1)
1. Repeat CARD-004.
2. Reject the operation.
3. Observe whether the agent explains, stops, or chooses a safe alternative.
**Expected:** Rejected operation does not execute; UI clearly shows the outcome.

### CARD-006 — Approval card double-click/race (P0)
1. Reach a permission card.
2. Double-click Approve, click Approve and then Reject rapidly, or submit duplicate keyboard activation.
3. Inspect actual tool invocation count and audit events.
**Expected:** One unambiguous decision wins; privileged operation cannot run twice or after a rejection.

### CARD-007 — Approval card while switching sessions (P1)
1. Open a pending approval in session A.
2. Switch to B and interact with a different card if available.
3. Return to A and approve/reject.
**Expected:** Decision applies to the correct pending operation and session; card identity does not change under the pointer.

### CARD-008 — Clarification/question card (P2, if supported)
1. Start a task whose deterministic agent fixture requests clarification.
2. Submit a valid answer; repeat with blank, long, and cancelled answer.
3. Resume execution.
**Expected:** Answer is attached to the waiting task; cancelling does not silently submit; resumption is coherent.

### CARD-009 — Tool-call card expands/collapses (P2, if visible)
1. Trigger a safe tool call.
2. Expand the tool card and inspect tool name, arguments or redacted summary, status, timing, and output.
3. Collapse it, navigate away/back, and inspect again.
**Expected:** No wrong result association; card state is stable; secrets are not exposed.

### CARD-010 — Tool-call card success and failure (P1)
1. Trigger a successful tool call and verify status/output.
2. Repeat with a controlled tool error and timeout.
3. Use Retry if available; otherwise submit a recovery task.
**Expected:** Success/error status is accurate; retry does not duplicate destructive side effects; old errors are not relabelled as success.

### CARD-011 — Artifact/file-created card (P1, if supported)
1. Request creation of a synthetic file.
2. Wait for the artifact card.
3. Test Open, Reveal in folder, Download, Copy path, or other buttons only if present.
4. Verify actual file path and content.
**Expected:** Each action targets the correct artifact and reports failures honestly.

### CARD-012 — Diff/change-review card (P1, if supported)
1. Use a disposable workspace and trigger a file change.
2. Open the diff card and inspect changed file names, added/removed lines, and summary.
3. Accept/reject or provide feedback using available controls.
4. Reopen the file and verify disk contents.
**Expected:** Review decision and on-disk change agree; no hidden unrelated file edits.

### CARD-013 — Error/retry card (P1)
1. Trigger an API, runtime, or tool failure.
2. Inspect error title/detail and available buttons.
3. Activate Retry once; repeat rapid double activation.
4. Inspect execution IDs and final response.
**Expected:** Retry has clear scope, does not duplicate the original execution accidentally, and does not remove the original diagnostic history.

### CARD-014 — Connection-status banner/card (P1, if supported)
1. Start with a healthy connection.
2. Disable connectivity during a task.
3. Observe offline indicator, disabled actions, and recovery controls.
4. Restore connectivity.
**Expected:** Status accurately tracks connectivity; reconnecting does not imply the failed task completed.

### CARD-015 — Card action while card is loading/updating (P1)
1. Trigger a card whose contents are still loading.
2. Activate visible actions at the earliest valid moment and during a state change.
**Expected:** Buttons are disabled or safe while invalid; no race, duplicate action, or stale result.

### CARD-016 — Card dismissal versus task cancellation (P1)
1. Trigger a long-running task card.
2. Close/collapse/dismiss the card without pressing Cancel, if the UI allows it.
3. Observe whether the task continues.
4. Then explicitly cancel the task and compare.
**Expected:** Hiding a card is not accidentally treated as cancellation, unless explicitly designed and communicated.

### CARD-017 — Agent asks a question while other task is running (P2)
1. Run two isolated sessions if supported.
2. Trigger a clarification request in one and normal progress in the other.
3. Answer the correct card.
**Expected:** Correct thread resumes; other task remains unaffected.

### CARD-018 — Long card contents and nested controls (P2)
1. Produce long plan/tool/artifact/error content with several buttons.
2. Scroll within the card, resize window, and interact with its footer controls.
**Expected:** Important controls remain reachable; scrolling does not accidentally activate actions.

---

# F. Undo, redo, rewind, reject, and recovery semantics

**Do not treat these as one operation.** Separate composer text undo, message editing, conversation rewind, artifact/file revert, diff rejection, and deletion. If the app has no such feature, record N/A rather than inventing it.

### UNDO-001 — Undo text in unsent composer (P2, if supported)
1. Enter a draft and perform multiple edits.
2. Use Ctrl+Z and redo shortcut if supported.
3. Submit only after confirming the final text.
**Expected:** Only draft edits are changed; no chat history or filesystem file is reverted.

### UNDO-002 — Undo/redo boundary (P2)
1. Type a draft, undo all changes, then attempt another undo.
2. Redo all changes, then attempt another redo.
**Expected:** No crash or unrelated state change at undo-stack boundaries.

### UNDO-003 — Edit/resubmit prior user prompt (P1, if supported)
1. Send a prompt and obtain a response.
2. Edit the previous prompt and resubmit.
3. Compare visible history and new execution semantics.
**Expected:** Product clearly represents whether this creates a new branch, replaces later turns, or appends a revision; no stale response is presented as the new result.

### UNDO-004 — Rewind conversation to an earlier checkpoint (P1, if supported)
1. Run a multi-turn synthetic conversation with identifiable checkpoints.
2. Invoke rewind/undo on an earlier turn.
3. Inspect confirmation, affected messages, running tasks, and visible history.
4. Confirm the operation in a disposable session.
**Expected:** Exactly the defined range is reverted; unrelated sessions remain untouched.

### UNDO-005 — Conversation-only undo versus filesystem revert (P0, if both concepts exist)
1. Generate a file change and a conversation response.
2. Invoke conversation-only undo.
3. Verify message history changes according to contract while disk files remain unchanged.
4. Separately test full revert and verify intended files are restored.
**Expected:** The two scopes are never confused or represented by an ambiguous button label.

### UNDO-006 — Confirm Undo dialog cancel/confirm (P1)
1. Create multiple synthetic file changes.
2. Start a revert/undo that presents a confirmation dialog.
3. Cancel and verify every file/message is unchanged.
4. Repeat and confirm; compare exact changed paths and file hashes.
**Expected:** Cancel is non-destructive; confirm affects only the declared scope.

### UNDO-007 — Undo while another task is active (P1)
1. Start a task in session A.
2. Attempt rewind/revert on A or another session while the task is running.
3. Inspect blocking/confirmation behavior and late events.
**Expected:** Active execution and rollback policy are explicit; stale output does not resurrect reverted content.

### UNDO-008 — Reject selected artifact/diff changes (P1, if supported)
1. Generate changes to multiple files.
2. Reject one file/change and accept another using available controls.
3. Inspect disk and review status.
**Expected:** Decisions apply to the intended files; other changes remain intact.

### UNDO-009 — Accept/reject all with mixed statuses (P1, if supported)
1. Create multiple actionable changes with one already reviewed.
2. Activate Accept All or Reject All.
3. Inspect confirmation, final status, and file contents.
**Expected:** Bulk operation scope is clear; already-finalized or unrelated items are not mishandled.

### UNDO-010 — Undo after external file modification (P1)
1. Generate a change in a disposable file.
2. Modify the same file externally before reverting.
3. Invoke the revert flow.
**Expected:** Conflict is detected or handled according to an explicit safe policy; newer unrelated edits are not silently destroyed.

### UNDO-011 — Undo/revert when file no longer exists (P2)
1. Generate a file-change record.
2. Remove or rename the file externally in the test workspace.
3. Invoke revert.
**Expected:** Clear missing-file outcome; no accidental deletion of a replacement file at a reused path.

### UNDO-012 — Reopen old conversation after revert (P1)
1. Create a conversation that changes a file.
2. Revert the change.
3. Close and reopen the old conversation.
**Expected:** Merely reopening history does not reapply obsolete edits or resurrect stale UI state.

---

# G. Streaming, runtime states, timeouts, and cancellation

### RUN-001 — Basic successful run (P0)
1. Create a session and send a deterministic prompt.
2. Observe start, progress, tool steps if any, final response, and completion state.
3. Inspect stored event order and execution ID.
**Expected:** One coherent run; final status is persisted; no orphan loading indicator.

### RUN-002 — Empty/short response (P1)
1. Return an empty response and then a one-token response using fixtures.
2. Inspect completion/error behavior.
**Expected:** Empty output is handled according to contract and is not confused with a stream that is still running.

### RUN-003 — Incremental text chunks (P1)
1. Stream text split into single characters, words, Markdown tokens, and UTF-8 boundaries.
2. Inspect intermediate and final render.
**Expected:** No missing, duplicated, or corrupted content; render remains responsive.

### RUN-004 — Multiple events in one transport chunk (P1)
1. Supply multiple protocol events in one read/chunk.
2. Verify parser emits all events in the correct order.
**Expected:** No lost or merged events.

### RUN-005 — One event split across multiple transport chunks (P1)
1. Split an event payload at arbitrary positions, including inside UTF-8/multibyte text where the implementation requires it.
2. Continue streaming the rest.
**Expected:** Parser reconstructs valid events and text correctly.

### RUN-006 — Tool events interleaved with text deltas (P1)
1. Stream text → tool start → tool result → more text → completion.
2. Inspect visible ordering and tool-card state.
**Expected:** Correct sequence and association; final answer does not swallow or duplicate tool results.

### RUN-007 — Unknown/malformed/duplicate event (P1)
1. Inject an unknown event type, malformed payload, and duplicate event separately.
2. Continue with healthy events after each injection where the protocol permits.
**Expected:** Robust handling with diagnostic logs; no cross-session corruption or fatal UI crash.

### RUN-008 — User cancels before first token (P1)
1. Start a run with delayed first response.
2. Cancel immediately.
3. Release the delayed response.
**Expected:** Cancel semantics are honored; late output cannot unexpectedly mark task completed.

### RUN-009 — Cancel during text streaming (P1)
1. Stream several chunks.
2. Cancel during output.
3. Inject a late chunk and terminal event.
**Expected:** UI state and persisted final status follow the cancellation contract; late events do not append after a terminal cancellation improperly.

### RUN-010 — Cancel during tool execution (P0)
1. Start a task with a controllable blocking tool.
2. Cancel while the tool is running.
3. Observe tool cancellation, partial side effects, and task status.
**Expected:** Tool stops when cancellation is supported; otherwise the UI clearly communicates the limit. No false “cancelled” claim if side effects continue.

### RUN-011 — Runtime exception (P0)
1. Inject an exception before first output, then another after partial output.
2. Inspect error card, logs, persistence, and subsequent run.
**Expected:** Failure is visible; prior partial output remains properly labelled; later tasks can still run.

### RUN-012 — Model/API timeout (P1)
1. Delay the mock API beyond the configured timeout.
2. Observe timeout UI and Retry action.
3. Retry with a healthy response.
**Expected:** The original timed-out request is not mistaken for a successful result; retry identity and user-visible status are clear.

### RUN-013 — Idle stream exceeds 45 seconds (P1)
1. Start a run that emits initial progress, then remains silent for more than 45 seconds in a controlled test.
2. Observe UI, local backend, proxy/client timeout logs, task state, and network connection.
3. Send heartbeat/progress events if the protocol supports them and repeat.
4. Repeat with a stream that continues producing output beyond that duration.
**Expected:** Identify which boundary enforces the timeout. No false completion, indefinite spinner, or lost session state. The result follows a documented timeout/heartbeat/retry contract.

### RUN-014 — Disconnect during stream then reconnect (P0)
1. Stream partial output.
2. Disable network or stop the test server.
3. Wait for the client to declare failure/timeout.
4. Restore connectivity and use the supported retry/resume path.
5. Compare message text, tool call count, and execution state.
**Expected:** No duplicate tool side effects or repeated final message; original outcome is represented accurately.

### RUN-015 — API returns 401/403/408/429/5xx (P1)
1. Configure the test API to return each applicable status independently.
2. Inspect error text, retry policy, and reauthentication behavior where applicable.
3. Repeat with a healthy response.
**Expected:** Different classes are handled appropriately; retries respect server guidance and do not loop uncontrollably.

### RUN-016 — Response finishes but completion event is missing (P1)
1. Deliver text chunks but omit the terminal event.
2. Advance the controlled timeout.
3. Observe whether the run remains running, times out, or is reconciled.
**Expected:** Defined recovery; no false “completed” state based only on receiving text.

### RUN-017 — Completion arrives twice (P1)
1. Deliver a valid completion event twice.
2. Inspect message content, token/count metadata, task status, and UI indicators.
**Expected:** Terminal transition is idempotent; no duplicate answer or duplicated billing/state accounting in the test boundary.

### RUN-018 — Process dies during run (P0)
1. Begin a controlled task and stop the local agent process unexpectedly in an isolated test environment.
2. Inspect UI handling.
3. Restart the process/app and inspect session/task status.
**Expected:** Interrupted execution is identified as interrupted/unknown rather than falsely successful; recovery is available where supported.

### RUN-019 — Backpressure and large tool output (P1)
1. Return a large deterministic tool output and a rapid event stream.
2. Observe UI responsiveness, memory, and event processing.
**Expected:** UI remains responsive; content isn't silently dropped; any truncation or size limit is explicit.

### RUN-020 — Retry while original request still active (P1)
1. Start a task that appears stalled but remains active.
2. Attempt Retry or submit another prompt.
3. Inspect whether the original request is cancelled, allowed to finish, or duplicated.
**Expected:** Retry semantics are clear and idempotency is preserved.

---

# H. Internet, authentication, and API availability

### NET-001 — Internet lost while app is idle (P1)
1. With completed sessions loaded, disconnect internet.
2. Navigate local history and open local files.
3. Attempt a remote agent request.
**Expected:** Local functions remain available when architecturally possible; remote operation reports unavailability; no misleading success.

### NET-002 — Internet lost while typing (P2)
1. Disconnect network while a draft is in the composer.
2. Continue typing and navigate to another session.
3. Reconnect.
**Expected:** Draft follows the documented persistence policy and is not silently erased or auto-submitted unexpectedly.

### NET-003 — Internet lost immediately after Send (P1)
1. Submit a request and cut connectivity at controlled timing points: before dispatch, after dispatch but before acknowledgment, and after acknowledgment.
2. Reconnect and inspect run status.
**Expected:** App can distinguish never-sent, accepted-but-unknown, and active/failed requests where possible; it avoids blind duplicate execution.

### NET-004 — Network flaps repeatedly (P1)
1. Alternate connected/disconnected state during a controlled task several times.
2. Inspect connection banners, retries, logs, and execution count.
**Expected:** Bounded retries; no alert flicker or uncontrolled retry storm; task outcome remains coherent.

### NET-005 — Slow network / high latency (P1)
1. Add controlled latency and limited bandwidth.
2. Submit task, open sidebar, and inspect streaming and button state.
**Expected:** Progress feedback remains usable; users can cancel; no arbitrary timeout shorter than the documented contract.

### NET-006 — DNS/TLS/connect failure (P1)
1. Simulate endpoint resolution failure, TLS failure, and connection refusal separately in the test environment.
2. Inspect error classification and retry behavior.
**Expected:** Safe, understandable errors; credentials and provider secrets are not included in logs.

### NET-007 — Access token expires during idle and during active task (P1)
1. Expire the test access token while idle; attempt a request.
2. Repeat while a run is active.
3. Trigger refresh/re-auth according to product flow.
**Expected:** Session restoration works; active run is not silently duplicated; user is told what action is required.

### NET-008 — Refresh token invalid/revoked (P1)
1. Revoke/invalid the test refresh token.
2. Launch or continue the app.
3. Inspect sign-in flow and local data behavior.
**Expected:** Re-authentication is required; local data is handled according to policy; no infinite refresh loop.

### NET-009 — API returns rate limit/quota exhausted (P1)
1. Simulate 429/quota exhaustion.
2. Inspect user-facing message, countdown/reset hints if available, and Retry behavior.
3. Restore quota in the mock and retry.
**Expected:** No aggressive retry storm; task and draft state remain comprehensible.

### NET-010 — Server returns malformed JSON or incompatible schema (P1)
1. Return malformed payload or a missing required field from the test API.
2. Observe error state and logs.
3. Restore valid schema.
**Expected:** Validation fails safely; malformed data does not corrupt history or crash the app.

### NET-011 — API reachable but model provider unavailable (P1)
1. Keep API healthy while simulating gateway/provider timeout or error.
2. Observe which layer displays the status and retry control.
**Expected:** UI distinguishes provider/runtime failure from a local UI failure when diagnostic detail is available; recovery works.

### NET-012 — Reconnect while app is backgrounded (P2)
1. Start a task, minimize the app, disconnect/reconnect the network, and restore the window.
**Expected:** Current task status is synchronized; no duplicate notifications or stale connection indicator.

---

# I. Chat rendering and message-level actions

### CHAT-001 — Markdown structure (P1)
1. Render headings, nested lists, quotes, bold/italic, links, and horizontal rules.
2. Scroll and switch away/back.
**Expected:** Correct semantic structure and readable layout; no content loss.

### CHAT-002 — Code blocks and syntax highlighting (P1)
1. Render inline code and fenced blocks in multiple supported languages.
2. Test long lines, empty blocks, incomplete fences, and code containing HTML-like text.
3. Use Copy if available.
**Expected:** Correct language/rendering; copy returns expected text; content is not executed.

### CHAT-003 — Tables and wide tables (P1)
1. Render small, empty, nested-looking, very wide, and large tables.
2. Resize the window and scroll horizontally/vertically.
**Expected:** Table remains legible and contained; no entire-app overflow or frozen scrolling.

### CHAT-004 — Equations/math rendering (P2, if supported)
1. Render inline and block formulas, invalid delimiters, and long equations.
2. Switch viewer and return.
**Expected:** Valid formulas render; malformed formulas fail gracefully and preserve the text.

### CHAT-005 — Links and file references (P1)
1. Render a valid URL, a dangerous/nonstandard scheme, a local file reference, and a missing path.
2. Activate each link.
**Expected:** Only permitted destinations open; missing files show an error; no implicit execution of local commands.

### CHAT-006 — Image message/preview (P2, if supported)
1. Render valid image, corrupt image, large image, SVG, and unsupported format as applicable.
2. Open/close preview; copy/save if those actions exist.
**Expected:** Correct asset displayed; errors do not break chat; unsafe SVG/script content is not executed.

### CHAT-007 — Tool cards mixed with Markdown (P1)
1. Render assistant text before and after one or more tool cards.
2. Expand/collapse cards and scroll.
**Expected:** Content order and identity remain stable.

### CHAT-008 — Message copy action (P2, if supported)
1. Copy user, assistant, code, table, and tool-result messages.
2. Paste into a plain text editor and compare expected clipboard representation.
**Expected:** Correct content copied; no hidden internal metadata or unrelated messages.

### CHAT-009 — Very long conversation rendering (P1)
1. Create a conversation with hundreds/thousands of synthetic messages within test limits.
2. Scroll to top/bottom, search if available, and jump between session items.
**Expected:** Stable message order, acceptable responsiveness, no repeated or missing messages due to virtualization.

### CHAT-010 — Partial response followed by error (P1)
1. Stream a partial answer then inject a failure.
2. Inspect final message labeling, Retry action, and conversation history after restart.
**Expected:** Partial content is not represented as a full successful answer.

---

# J. Right sidebar, file viewer, and artifacts

### VIEW-001 — Open and close right pane (P2)
1. Open/close each supported pane and tab.
2. Repeat while streaming and while a modal/card is visible.
**Expected:** Correct focus, content, and active-session association; no stuck overlay.

### VIEW-002 — Switch files rapidly (P1)
1. Open file A, then B, then C quickly.
2. Delay A's load so it finishes after C.
**Expected:** Final visible file is C; late results cannot overwrite the selected viewer.

### VIEW-003 — Open all supported file types (P1)
1. Discover the complete extension list from the repository.
2. For each extension, open a valid fixture from the sidebar and a message/artifact link if supported.
3. Compare path, type indicator, content, and open action.
**Expected:** Every supported renderer works and routes to the correct viewer; unsupported types show a fallback rather than raw broken content.

### VIEW-004 — Empty, corrupt, truncated file (P1)
1. Open one empty, one corrupt, and one truncated fixture per applicable format.
2. Inspect error/fallback UI and close/reopen.
**Expected:** Failure is contained to the file viewer; no app crash or stale previous-file content shown as the new file.

### VIEW-005 — File deleted or replaced while open (P1)
1. Open a test file.
2. Modify, replace, rename, and delete it externally, one case at a time.
3. Refresh/reopen the viewer.
**Expected:** Updated content is shown or a clear missing/conflict status; no false display of stale data as current.

### VIEW-006 — Large text/code/data file (P1)
1. Open fixtures at multiple sizes, including the largest supported target.
2. Scroll randomly, search if supported, and switch files.
3. Measure responsiveness and memory.
**Expected:** No freeze or unbounded memory growth; if size limit exists, it is explicit.

### VIEW-007 — PDF viewer (P2, if supported)
1. Open valid multi-page, one-page, corrupt, scanned/image-based, and large PDF fixtures.
2. Change page/zoom and navigate away/back.
**Expected:** Pages and controls behave correctly; corrupt files fail safely. Do not assume OCR is supported unless implemented.

### VIEW-008 — DOCX viewer (P2, if supported)
1. Open documents with headings, tables, images, and long text.
2. Open an invalid DOCX with a mismatched extension.
**Expected:** Readable output or documented fallback; no silent truncation presented as complete.

### VIEW-009 — XLSX workbook view (P1, if supported)
1. Open a workbook with multiple sheets, formulas, blanks, dates, Unicode, and large data.
2. Switch sheets and scroll to edge rows/columns.
3. Open corrupt and password-protected fixtures where applicable.
**Expected:** Correct sheet and cell association; no row/column misalignment; unsupported encryption is explained.

### VIEW-010 — CSV viewer (P1, if supported)
1. Open CSVs with quoted commas, embedded newlines, empty fields, various encodings, large row counts, and malformed rows.
2. Sort/filter only if supported.
**Expected:** Columns parse consistently; errors are reported honestly; large supported files remain usable.

### VIEW-011 — JSON viewer (P2, if supported)
1. Open valid nested JSON, empty object/array, huge JSON, malformed JSON, and JSONL if supported.
2. Expand/collapse nodes and copy values if supported.
**Expected:** Structure and errors are clear; no confusion between JSON and JSONL.

### VIEW-012 — Image viewer (P2, if supported)
1. Open supported image formats at small and large sizes.
2. Zoom, pan, rotate, copy/save where available, and reopen.
**Expected:** Correct image, dimensions, focus, and action targets.

### VIEW-013 — Artifact created but not found (P1)
1. Trigger a mocked tool that reports an artifact path that does not exist.
2. Open the artifact card.
**Expected:** UI reports the mismatch rather than displaying an old artifact with the same name.

### VIEW-014 — Artifact overwritten/conflicting filename (P1)
1. Create an existing synthetic file.
2. Ask for an artifact with the same name.
3. Inspect overwrite/rename policy and any confirmation.
**Expected:** Existing data is protected according to policy; final target path is explicit.

### VIEW-015 — Generated XLSX verified independently (P1)
1. Prompt the agent to generate a workbook with specific sheet names, known values, and formulas.
2. Inspect the file on disk using an independent workbook parser.
3. Open the workbook externally where available.
4. Restart the app and locate/open it again.
**Expected:** Workbook is a real valid XLSX with the expected structure and usable contents; chat claims match the actual file.

### VIEW-016 — Reveal/Open externally/Copy path buttons (P2, if supported)
1. Use each file action on a normal path, a path with spaces/Unicode, and a missing file.
2. Inspect the target that opens or the clipboard value.
**Expected:** Correct file/path; failures are handled; no shell injection or unintended command execution.

---

# K. File tools and workspace side effects

### FILE-001 — Read a valid in-workspace file (P1)
1. Create a fixture with a known checksum/content.
2. Ask the agent to inspect it.
3. Inspect tool input/output and final response.
**Expected:** Agent receives correct file content and path; no unrequested modification occurs.

### FILE-002 — Write/create file (P1)
1. Ask the agent to create a small file at an allowed path.
2. Verify path, content, encoding, and checksum.
**Expected:** File exists exactly where stated; tool result agrees with disk.

### FILE-003 — Edit existing file (P1)
1. Create a file with sentinel lines at top, middle, and bottom.
2. Ask for a targeted edit.
3. Compare diff and full file contents.
**Expected:** Intended edits only; sentinel content is preserved.

### FILE-004 — Rename/move/delete file (P1, if tools support them)
1. Perform each operation only on disposable fixtures.
2. Inspect old and new paths, UI tree, and operation record.
3. Repeat with nonexistent path and permission error.
**Expected:** No accidental sibling deletion or duplicate stale tree node.

### FILE-005 — Path traversal / out-of-workspace request (P0)
1. In an isolated environment, request access to a synthetic file outside the permitted workspace.
2. Test `..`, absolute paths, symlink/junction paths, and encoded variants relevant to the platform.
**Expected:** Enforced workspace boundary; blocked access is logged safely; no sensitive path contents returned.

### FILE-006 — Tool output and file path with special characters (P2)
1. Use filenames containing spaces, Unicode, brackets, quotes, and long names.
2. Read/write/open/reveal the files.
**Expected:** Correct quoting and path resolution across UI/runtime/tool boundaries.

### FILE-007 — Tool writes partial file then fails (P1)
1. Use a controlled tool that writes part of a file then raises an error.
2. Inspect filesystem and artifact card.
3. Retry with a safe successful write.
**Expected:** Partial output is not marked final/successful; cleanup or recovery policy is applied consistently.

### FILE-008 — Concurrent tools write same target (P1)
1. Launch two controlled tasks attempting to write the same disposable target.
2. Vary completion order.
**Expected:** Conflict is prevented, serialized, or explicitly surfaced; no silent nondeterministic corruption.

---

# L. Parallel work, multi-session execution, and contention

### CONC-001 — Two independent sessions run concurrently (P1)
1. Start a slow task in A.
2. Switch to B and start a second task.
3. Let B finish first, then A.
4. Inspect chat, card states, files, and event IDs.
**Expected:** Complete isolation with correct completion ordering.

### CONC-002 — Three or more concurrent sessions (P2)
1. Start tasks in multiple sessions up to the configured limit.
2. Observe queueing, progress, controls, and status.
3. Exceed the configured limit safely.
**Expected:** Limit is respected and communicated; no session starves or gets another session's result.

### CONC-003 — Shared project, different sessions, same file (P1)
1. In two sessions under the same project, ask for conflicting changes to one disposable file.
2. Let operations overlap.
**Expected:** Conflict/detection policy is clear; last-writer-wins behavior must not occur silently unless explicitly intended and disclosed.

### CONC-004 — Parallel tool calls finish out of order (P1)
1. Mock three calls with controlled completion order 3 → 1 → 2.
2. Verify tool card ordering and final aggregation.
**Expected:** IDs and results remain mapped correctly; order in final response follows defined semantics.

### CONC-005 — One parallel tool fails while others succeed (P1)
1. Dispatch multiple independent calls.
2. Fail one, succeed others.
3. Inspect retry and aggregation behavior.
**Expected:** Partial success is explicit; successful results are preserved; failed call is not fabricated as successful.

### CONC-006 — Cancel one task while another continues (P1)
1. Start tasks in A and B.
2. Cancel A only.
3. Verify B remains active and completes.
**Expected:** Cancellation scope is strictly per task/session.

### CONC-007 — App close during multiple active tasks (P1)
1. Start two safe long-running tasks.
2. Close the app using the normal flow.
3. Relaunch and inspect both task states.
**Expected:** Each task's fate is recorded accurately; no cross-assigned result or hidden continuation.

### CONC-008 — Same button/action triggered in rapid sequence (P1)
1. Trigger create/send/retry/approve/open actions rapidly using UI and keyboard.
2. Inspect event/operation counts.
**Expected:** Debouncing/idempotency policy is respected; no duplicate harmful side effects.

### CONC-009 — Session switch during background completion notification (P2)
1. Start a task in A and switch to B before A finishes.
2. Let A finish while the app is focused on B.
3. Use the notification/card navigation if available.
**Expected:** Notification identifies A and navigates to A; active content in B is not overwritten.

### CONC-010 — Parallel subagent/task interface (P2, if supported)
1. Start a parent task that launches multiple workers/subagents.
2. Inspect each worker's status, output, failure, and parent aggregation.
3. Attempt cancellation/inspection and direct message if supported.
**Expected:** Worker identities and states are visible and accurate; one worker's failure does not corrupt unrelated output.

---

# M. Persistence, app restart, and data consistency

### PERSIST-001 — Verify message persistence (P0)
1. Send multiple known messages and complete a task.
2. Close/reopen the app.
3. Compare ordering, content, timestamps/metadata where applicable, and execution state.
**Expected:** No lost or duplicate messages.

### PERSIST-002 — Restart during stream (P1)
1. Begin a stream and wait for partial output.
2. Restart the app/process.
3. Reopen the session.
**Expected:** Clearly marked incomplete/interrupted state or supported resumption; no partial answer presented as complete.

### PERSIST-003 — Restart during tool execution (P0)
1. Pause a safe tool operation mid-flight.
2. Restart app/runtime.
3. Inspect execution status and side effects.
**Expected:** Recovery policy is consistent; no uncontrolled replay of non-idempotent tool effects.

### PERSIST-004 — Session/project deletion persists (P1)
1. Delete/remove test item as supported.
2. Restart the app.
3. Inspect active lists and stored metadata.
**Expected:** Deleted item does not reappear due to stale cache; unrelated items remain.

### PERSIST-005 — UI cache versus storage disagreement (P1)
1. Use controlled test hooks to cause a persistence write failure after UI state changes.
2. Observe whether the UI rolls back or reports unsaved state.
3. Relaunch and compare.
**Expected:** App never silently claims durable persistence when storage rejected it.

### PERSIST-006 — Corrupted/unsupported stored state (P1)
1. Corrupt only a disposable test database/state fixture.
2. Launch and inspect migration/recovery behavior.
**Expected:** App reports/rebuilds safely where supported; no destructive automatic reset without disclosure.

### PERSIST-007 — Migration from previous app version (P1, if applicable)
1. Seed old-version state from a safe fixture.
2. Launch the new version.
3. Verify records, files, and schema.
**Expected:** Migration is repeatable and does not duplicate records; failure leaves recoverable data.

### PERSIST-008 — Long conversation and large event history (P2)
1. Generate a lengthy history and event log.
2. Restart and load it repeatedly.
**Expected:** Complete history loads in correct order with acceptable responsiveness.

### PERSIST-009 — External file changed after persisted reference (P1)
1. Save an artifact reference in session history.
2. Change or remove file externally.
3. Reopen the session and click the reference.
**Expected:** Current file state/missing-file status is clear; stale content is not falsely represented as current.

### PERSIST-010 — Data cleanup boundaries (P0)
1. Create two projects and sessions with unique sentinel artifacts.
2. Delete one session, then one project according to supported operations.
3. Inspect every remaining project/session and disk path.
**Expected:** Cleanup is limited to the documented scope; unrelated data is not deleted.

---

# N. Search, navigation, settings, and preferences

### NAV-001 — Left sidebar collapse/expand (P2)
1. Toggle the sidebar repeatedly using mouse and shortcut if available.
2. Repeat while a task streams and when a long session list is scrolled.
**Expected:** No unintended task cancellation, selection loss, or repeated open/close from key repeat unless specified.

### NAV-002 — Right pane tab switching (P2)
1. Open each supported tab/viewer.
2. Switch repeatedly while content loads.
**Expected:** Correct tab title/content; stale load results do not replace active tab.

### NAV-003 — Global search/navigation (P2, if supported)
1. Search session, project, file, or message using exact, partial, case-varied, and no-match queries.
2. Open a result and return to the previous location.
**Expected:** Results identify the right destination and preserve context appropriately.

### NAV-004 — Context-menu dismissal (P2)
1. Open each context menu.
2. Dismiss with Escape, click outside, or choose an item.
3. Reopen via keyboard/right-click where supported.
**Expected:** Menus close predictably and do not leave invisible intercepting overlays.

### NAV-005 — Theme change (P3, if supported)
1. Switch light/dark/system theme.
2. Inspect chat, all card types, syntax highlighting, viewer, dialogs, disabled/loading states.
3. Restart.
**Expected:** Contrast and icons remain legible; preference persistence follows the contract.

### NAV-006 — Model/mode selection (P1, if supported)
1. Open the selector and inspect labels/options.
2. Select a valid option, submit task, and inspect request metadata.
3. Switch session and inspect selector state.
4. Simulate unavailable option.
**Expected:** UI label matches effective runtime configuration; unsupported selection is disabled or explained.

### NAV-007 — Permissions/autonomy settings (P1, if supported)
1. Set review-required mode.
2. Run a task requiring approval and verify a card appears.
3. Set sandbox/autonomous mode if available and repeat with safe fixtures.
4. Apply project-specific override if supported.
**Expected:** Actual execution permission matches visible settings; global/project precedence is consistent.

### NAV-008 — Settings persistence and invalid configuration (P1)
1. Change a benign setting and restart.
2. Provide an invalid setting through the intended configuration path in a test copy.
3. Open settings and recover.
**Expected:** Valid settings persist; invalid settings cause a clear warning/fallback instead of breaking unrelated preferences.

### NAV-009 — Keyboard navigation and focus after modal (P2)
1. Open modal, tab through controls, submit/cancel, and inspect focus return.
2. Repeat after an error card.
**Expected:** Focus is visible and returns to a logical control; no keyboard trap.

### NAV-010 — Notifications (P2, if supported)
1. Start a task and move focus away/minimize.
2. Complete, fail, and cancel tasks in separate runs.
3. Click each notification.
**Expected:** Notification type and destination match the task; no private prompt content leaked unnecessarily.

---

# O. Security, privacy, accessibility, and robustness

### SEC-001 — Secret redaction in logs (P0)
1. Use synthetic access/refresh tokens and secret-looking values in test fixtures.
2. Trigger success, error, retry, and exception logs.
3. Search captured local logs and screenshots.
**Expected:** Secrets are redacted; diagnostic artifacts do not leak credentials.

### SEC-002 — Untrusted Markdown/HTML rendering (P0)
1. Render script-like tags, event-handler attributes, `javascript:` links, SVG with active content, and unusual URL schemes as plain untrusted content.
2. Click relevant links in the controlled environment.
**Expected:** No script execution or unsafe navigation; content is escaped/sanitized according to policy.

### SEC-003 — Workspace boundary enforcement (P0)
1. Ask a file tool to access a synthetic external file through absolute, relative traversal, and symlink/junction paths.
2. Inspect tool response and logs.
**Expected:** Restricted access is denied; no outside content appears in UI or model input.

### SEC-004 — Sensitive information in screenshots/reports (P1)
1. Seed synthetic secrets and personal-looking data.
2. Force test failure to produce diagnostic screenshots/logs.
3. Inspect artifacts.
**Expected:** Evidence pipeline redacts sensitive fields where required.

### SEC-005 — Keyboard-only critical journey (P1)
1. Launch app and create project/session using keyboard only.
2. Send a task, inspect its status, open an artifact, and close it.
**Expected:** All critical controls reachable and operable without a mouse where accessibility is supported.

### SEC-006 — Scaling and small window (P2)
1. Test supported Windows display scaling levels and minimum window size.
2. Open lengthy cards, modal dialogs, and wide tables.
**Expected:** No critical buttons become unreachable; internal scrolling works.

### SEC-007 — Repeated open/close stress (P2)
1. Repeat session switching, viewer opening/closing, and panel toggling for a controlled number of cycles.
2. Record memory, event listeners/logs, and responsiveness.
**Expected:** No runaway memory growth, duplicate subscriptions, or progressively degrading UI.

### SEC-008 — Idle soak with active application (P2)
1. Leave app open idle under test instrumentation.
2. Periodically navigate and send controlled tasks.
3. Inspect memory and connection health.
**Expected:** No accumulating spinner, stale socket, or growing resource leak that violates the product's measured budget.

### SEC-009 — Large messages and files stress (P1)
1. Load maximum-supported synthetic inputs and outputs one at a time.
2. Measure peak memory, UI response, and recovery after close.
**Expected:** Documented supported sizes work; unsupported sizes fail clearly rather than crashing the whole app.

### SEC-010 — Error message quality (P2)
1. Trigger representative validation, network, runtime, file, permission, and persistence errors.
2. Confirm each error states what failed, what is safe to do next, and whether data/action may have been applied.
**Expected:** No misleading generic success or dangerous retry instruction when the operation's outcome is unknown.

---

# P. End-to-end golden journeys

These journeys link the component-level tests. Each action is a checkpoint, and each checkpoint must branch on success, failure, cancellation, timeout, and unexpected navigation wherever applicable.

### E2E-001 — Fresh install to completed artifact (P0)
1. Install/launch the packaged build in an isolated profile.
2. Create a project in a disposable directory.
3. Create a session.
4. Enter a task requesting a valid synthetic workbook or report.
5. Observe request submission and streaming state.
6. Observe each tool/approval/progress card that appears.
7. Approve only the safe intended actions if approval exists.
8. Wait for completion and inspect the final response.
9. Open the artifact card and inspect the file.
10. Verify path and contents independently.
11. Switch to another session and back.
12. Restart the app and open the artifact again.
**Expected:** Consistent session/task/artifact identities from input through persisted deliverable.

### E2E-002 — Complete journey with tool failure and recovery (P0)
1. Create project/session.
2. Submit a task whose first tool call is configured to fail.
3. Verify tool card, error state, and execution status.
4. Use Retry if supported, or provide a corrected/recovery instruction.
5. Verify retry count and tool side effects.
6. Confirm final artifact and history.
7. Restart and verify both failed attempt and recovery outcome are represented accurately.
**Expected:** Failure remains auditable and does not contaminate the successful result.

### E2E-003 — Internet outage at three checkpoints (P0)
1. Start a normal task and disconnect before dispatch acknowledgment.
2. Repeat with disconnection after partial streaming.
3. Repeat while a tool is running.
4. For each case, inspect UI card/banner, runtime logs, persisted task state, and user options.
5. Restore network and follow the supported recovery path.
6. Verify whether a new execution was started and whether the previous operation might have completed remotely.
**Expected:** No false success, no blind duplicate side effect, clear handling of uncertain request outcome.

### E2E-004 — Delete project/session under different conditions (P0)
1. Create project P with sessions A and B and unique sentinel artifacts.
2. Delete/archive A while idle.
3. Repeat with B streaming.
4. Attempt project removal while a task is active.
5. Cancel confirmation dialogs and verify no state changes.
6. Confirm the operation when policy allows it.
7. Restart and inspect disk, database, and sidebar.
**Expected:** The exact documented deletion scope is applied and unrelated data is preserved.

### E2E-005 — Review, reject, revise, approve artifact (P1, if supported)
1. Start a plan/review-mode task.
2. Inspect plan/diff/artifact card.
3. Add feedback/comment.
4. Reject or request revision.
5. Verify the agent incorporates feedback into a new proposal.
6. Approve the revised proposal.
7. Verify the final file and audit/history state.
**Expected:** Feedback maps to the right artifact/version; rejected versions are not mistaken for final approved output.

### E2E-006 — Multi-session concurrency (P0)
1. Create sessions A and B under supported projects.
2. Start a long tool task in A and a short task in B.
3. Switch panels/sessions during both runs.
4. Cancel A and let B finish.
5. Send a new prompt to A after cancellation.
6. Inspect all messages, cards, results, artifacts, and stored task IDs.
**Expected:** Complete task isolation and correct cancellation scope.

### E2E-007 — Viewer switching during generation (P1)
1. Open artifact X.
2. Start a task that creates artifact Y.
3. While it is running, switch between X, another file, and Y when it becomes available.
4. Cause one file load to complete late.
5. Close and reopen the viewer.
**Expected:** The selected viewer never gets replaced by a stale load; files and task remain correctly associated.

### E2E-008 — Rollback with external edits (P0, if revert exists)
1. Let the agent change two files in a disposable project.
2. Manually modify one file externally.
3. Start a full or partial revert.
4. Inspect conflict warning and confirmation.
5. Cancel, then repeat with the safe documented action.
6. Compare hashes and diffs of both files.
**Expected:** External edits are protected or explicitly handled; intended rollback scope is accurate.

### E2E-009 — Long-running task and idle timeout (P1)
1. Start a deterministic task lasting several minutes.
2. Generate a short active stream, then an idle interval longer than the configured threshold.
3. Resume events, run a tool, stream more output, and complete.
4. Repeat with network disruption and reconnection.
5. Inspect all transitions and persisted state.
**Expected:** Long work survives within the defined contract or fails with a clear recoverable state; no hung UI.

### E2E-010 — UI stress during active run (P1)
1. Start a long-running task.
2. Rapidly collapse/expand sidebar, resize window, open/close right pane, scroll chat, and switch to another session.
3. Interact with a non-destructive card action.
4. Let task finish and verify result.
**Expected:** Layout activity does not alter runtime task identity or damage output.

### E2E-011 — Crash/restart and integrity (P0)
1. Create a session, messages, and a partially generated artifact.
2. Terminate the app/runtime at controlled points: idle, streaming, tool execution, artifact write.
3. Relaunch and inspect recovery UI.
4. Validate persisted state and files independently.
5. Submit a new healthy task.
**Expected:** No corrupted unrelated data; incomplete work clearly identified; app returns to usable state.

### E2E-012 — Full start-to-finish regression from packaged installer (P0)
1. Install the release candidate on a clean Windows test environment.
2. Sign in using test credentials if required.
3. Create project/session and perform a deterministic task.
4. Test one error/retry path and one cancellation path.
5. Open supported file formats and verify an output artifact.
6. Restart, sign out/in if supported, and verify intended persistence/session behavior.
7. Uninstall only in a disposable environment and verify the documented data-retention behavior.
**Expected:** Production-like packaged workflow works independently of development tooling.

---

# Q. Required branch expansion: make the catalogue grow from each step

The scenarios above are a baseline, not a claim that every combination is listed. The executing QA agent must expand them using this branching rule:

For **every user action** in every scenario, create applicable branches for:

1. **Normal success** — expected action completes.
2. **Validation failure** — input/path/state is invalid before work begins.
3. **Dependency failure** — runtime, tool, storage, or API fails during the action.
4. **Timeout/hang** — the action takes longer than its documented threshold.
5. **Cancellation** — user cancels at the earliest, middle, and latest meaningful points.
6. **Duplicate action** — double-click, repeated shortcut, retry, or repeated event.
7. **Navigation interruption** — user changes session/project/panel while action is pending.
8. **Lifecycle interruption** — app closes, restarts, crashes, or loses focus during action.
9. **Late/stale result** — previous operation finishes after the UI has changed state.
10. **Recovery** — restore the dependency and attempt the workflow again.

Do not blindly test all ten branches on every low-risk step. Use risk-based selection, but apply all relevant branches to project/session deletion, task dispatch, approval decisions, tool side effects, streaming terminal states, file writes, authentication, and persistence.

## Factor matrix for combinatorial generation

Generate pairwise combinations across these dimensions, where applicable:

- session state: empty / populated / active / failed / cancelled / archived / deleted;
- project state: valid / missing / inaccessible / removed / shared-folder / multiple-root;
- run state: idle / starting / streaming / waiting-for-input / approval-pending / tool-running / retrying / completed / failed / cancelled;
- connectivity: healthy / slow / disconnected-before-send / disconnected-after-ack / disconnected-mid-stream / reconnecting;
- input: empty / normal / multiline / Unicode / large / attachment / malformed;
- tool result: success / validation error / exception / timeout / partial side effect / late result / duplicate result;
- card state: absent / loading / pending / expanded / collapsed / action-in-progress / completed / failed / stale;
- viewer state: closed / loading / normal / large / unsupported / file-missing / file-replaced;
- persistence: healthy / write failure / stale cache / restart / crash / migration;
- navigation: same session / session switch / project switch / panel switch / window minimized / window closed;
- execution overlap: no overlap / second run same session / second run separate session / parallel tools / concurrent file write;
- user action: single click / double click / keyboard / rapid repeat / cancel / retry / undo / reject / approve.

Use pairwise coverage for broad interactions, then add high-risk three-way combinations such as:

- `streaming × network disconnect × session switch`;
- `tool side effect × cancel × late result`;
- `project deletion × active task × filesystem write`;
- `undo/revert × external file modification × confirmation cancel`;
- `auth expiry × retry × uncertain request outcome`;
- `viewer loading × rapid file switch × late load completion`;
- `parallel tools × one failure × final artifact generation`;
- `restart × partial artifact write × persisted completion status`.

Record why selected combinations are high-risk. Keep the generated test list deterministic and version-controlled.

---

# R. Agent execution prompt

Paste this instruction after giving the QA agent this catalogue and repository access:

> You are executing the desktop end-to-end scenario catalogue in `desktop_agent_scenario_catalog.md`. Do not merely summarize it. First inspect the repository, determine the actual implemented feature set, and map every scenario to real controls, runtime paths, event types, and storage behavior. For each scenario, produce exact executable steps and assertions. Add any missing scenario discovered from the UI or code. Mark absent features N/A with evidence; never assume that features from Codex or Antigravity exist in this product.
>
> Before testing, protect existing developer changes and create an isolated test profile, workspace, and database. Establish deterministic model/API/tool fixtures for repeatability. Identify the safest automation framework for the actual desktop shell. Inventory card types and their buttons by inspecting the rendered UI and source, then test each card's lifecycle and every action that is actually present.
>
> Execute the suites in risk order: baseline/startup, project/session CRUD, composer, card interactions, runtime/streaming/tools, internet/auth failures, viewer/artifacts, undo/revert, persistence/recovery, concurrency, accessibility/performance, and finally the packaged Windows build. Parallelize independent repository analysis and isolated test suites; coordinate tests that share a desktop window, database, port, or filesystem.
>
> At each step, assert visible UI state, actual runtime/API/tool effect, stored state, filesystem side effects, and negative effects that must not happen. Branch on success, validation failure, dependency failure, timeout, cancellation, duplicate action, navigation interruption, late result, and recovery wherever applicable. Pay particular attention to internet loss before dispatch acknowledgement, after acknowledgement, during streaming, and during tool execution; determine whether the request might already have executed before retrying.
>
> Preserve the first failure with logs, screenshots, traces, request/event IDs, and exact reproduction steps. Do not hide failures with retries or arbitrary sleeps. Distinguish product defects, test-harness defects, and blocked environmental capabilities. Fix product code only in isolated, minimal patches after recording the original defect, then rerun the original scenario and regression tests.
>
> Maintain `TEST_MATRIX.csv` as the source of truth with scenario ID, exact steps, expected UI, expected runtime/storage effects, priority, feature applicability, status, evidence path, and bug ID. Produce a consolidated report with counts and denominators for PASS, FAIL, FLAKY, BLOCKED, NOT RUN, and N/A. Do not report release readiness while a critical workflow, destructive operation, stream failure, persistence path, or packaged-build path remains unverified.
>
> Continue by expanding the catalogue from each action using the branching rules in Section Q. The objective is maximum evidence-backed coverage of the app's actual state space, not the largest raw number of tests. Execute every feasible test now and clearly identify any test that cannot be run in the current environment.

---

# S. Evidence and reporting checklist

For every failed or flaky test, save a folder such as `qa-results/<run-id>/<scenario-id>/` containing, when available:

- `steps.md` — exact action sequence and test data;
- `expected-vs-actual.md` — mismatch and severity;
- `screenshot-before.png` and `screenshot-after.png`;
- `app.log`, `runtime.log`, `api-mock.log`, and sanitized event trace;
- state/database snapshot or before/after checksum where safe;
- output artifact and independent validation result;
- environment/build/commit/test version;
- reproduction command and deterministic seed.

Never capture production secrets. Use synthetic prompts, files, tokens, and customer records.

## Release acceptance rule

A high test count is not release evidence by itself. Require all critical journeys to pass, no open P0 defects, no open P1 defects affecting a core journey, no known cross-session contamination or data-integrity defects, documented results for all destructive and connectivity failure paths, and actual packaged-build verification. Disclose untested and blocked scenarios explicitly.
