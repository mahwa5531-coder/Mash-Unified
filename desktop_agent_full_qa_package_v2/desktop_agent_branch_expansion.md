# Desktop Agent Application — Branch Expansion Catalogue

This supplement deepens the 187-scenario baseline with explicit follow-on branches for sessions, projects, composer/input, connectivity, cards, undo/revert, runtime/events, viewers/artifacts, and high-risk combinations. All scenarios start as `NOT RUN`; actual feature applicability must be resolved from repository/UI evidence.

**Supplemental scenario count: 200.** The baseline and supplement are additive; avoid duplicate tests by mapping overlapping IDs to existing implementations while preserving unique coverage branches.

## Execution contract

For each scenario, capture expected UI state, runtime/API/tool effect, persisted state, filesystem side effects, and negative assertions. Use deterministic fixtures and isolated profiles. Do not execute destructive tests against user data. Feature-specific tests must be marked `N/A` only with evidence that the feature is absent; use `BLOCKED` for missing environment/automation capability.

## Scenario records

### Sessions

#### BR-SES-001 — Create session from empty state (P1)
**Applicability:** VERIFY SESSION FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Launch with a fresh profile and no sessions.
2. Activate New Session once.
3. Inspect selected row, session ID, composer, empty-state content, and persisted record.

**Expected UI:** Exactly one usable session is selected; no fabricated prior messages.

**Expected runtime/storage:** One session identity is persisted once; no model call is sent before the user submits.

**Must not happen:** No duplicate session records or unsolicited execution.

---

#### BR-SES-002 — Create session by rapid double-click (P1)
**Applicability:** VERIFY SESSION FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. With the session list visible, double-click New Session with minimal interval.
2. Compare the visible row count with persisted session IDs.
3. Repeat using the associated keyboard shortcut if present.

**Expected UI:** Result matches the documented single-activation semantics.

**Expected runtime/storage:** Session creation is idempotent or each explicit action produces a distinct session; event audit is consistent.

**Must not happen:** No invisible session records or duplicated IDs.

---

#### BR-SES-003 — Create session when storage write fails (P1)
**Applicability:** VERIFY SESSION FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Inject a controlled persistence failure for session creation.
2. Activate New Session.
3. Restore storage and use the supported retry/recovery path.

**Expected UI:** Clear error or recoverable state; no fake selected session.

**Expected runtime/storage:** No committed session is claimed unless persistence succeeded; retry creates one valid record.

**Must not happen:** No half-created row that reappears after restart.

---

#### BR-SES-004 — Create session with no active project (P1)
**Applicability:** VERIFY SESSION FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Start with no project selected.
2. Activate New Session.
3. Submit a harmless prompt only if the UI permits this state.

**Expected UI:** App follows its actual contract: requests project selection or allows a project-independent session.

**Expected runtime/storage:** Session/project association is valid and explicit.

**Must not happen:** No null-path tool execution or hidden default project.

---

#### BR-SES-005 — Create session during a streaming task (P1)
**Applicability:** VERIFY SESSION FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Start a deterministic long response in session A.
2. Create session B while A streams.
3. Inspect both rows, chat panes, and runtime event associations.

**Expected UI:** B becomes selected according to policy while A shows accurate running status.

**Expected runtime/storage:** A events persist under A; B has independent identity and context.

**Must not happen:** No A token appears in B.

---

#### BR-SES-006 — Create session while approval is pending (P1)
**Applicability:** VERIFY SESSION FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Start a task in A that pauses at a safe mock approval.
2. Create session B without answering A approval.
3. Return to A and inspect the pending card.

**Expected UI:** Pending approval remains visible and actionable in A.

**Expected runtime/storage:** Approval ID remains bound to A and original execution.

**Must not happen:** Creating B must not approve, reject, or cancel A implicitly.

---

#### BR-SES-007 — Create many sessions until sidebar scrolls (P2)
**Applicability:** VERIFY SESSION FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Create enough sessions to exceed the visible list viewport.
2. Scroll to first, middle, and last items.
3. Select entries after resizing the sidebar.

**Expected UI:** Rows and selected highlighting match session identity.

**Expected runtime/storage:** All sessions remain individually addressable.

**Must not happen:** No virtualized-row index mix-up or skipped records.

---

#### BR-SES-008 — Switch from A to B while A streams (P0)
**Applicability:** VERIFY SESSION FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Start a streaming task in A with unique marker A-ONLY-481.
2. Switch to B and send marker B-ONLY-926.
3. Return to A after both have emitted output.

**Expected UI:** Each chat shows only its own result and running/completed status.

**Expected runtime/storage:** Every event carries the correct session/execution ID.

**Must not happen:** No cross-session content, card, tool status, or artifact leakage.

---

#### BR-SES-009 — Switch session while a tool is waiting (P1)
**Applicability:** VERIFY SESSION FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Pause A inside a deterministic long-running mock tool.
2. Switch to B, perform a read-only task, then return to A.

**Expected UI:** A shows waiting/running state; B remains responsive.

**Expected runtime/storage:** Tool invocation is not redispatched due to navigation.

**Must not happen:** No duplicate side effect or incorrect spinner.

---

#### BR-SES-010 — Switch away with unsent draft (P1)
**Applicability:** VERIFY SESSION FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Enter a unique unsent draft in A.
2. Switch to B and enter a different draft.
3. Switch A → B → A and inspect both composers.

**Expected UI:** Drafts follow the actual persistence policy consistently.

**Expected runtime/storage:** Draft storage keys, if present, are session-specific.

**Must not happen:** No draft submitted accidentally or copied into the wrong session.

---

#### BR-SES-011 — Rename session to whitespace (P2)
**Applicability:** VERIFY SESSION FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Open the actual rename action.
2. Replace title with spaces, tabs, and newlines.
3. Submit.

**Expected UI:** Input is rejected or normalized according to product policy with clear feedback.

**Expected runtime/storage:** Existing title and ID remain consistent if rejected.

**Must not happen:** No blank/ghost label or unintended rename.

---

#### BR-SES-012 — Rename session to long Unicode title (P2)
**Applicability:** VERIFY SESSION FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Rename a test session using long Unicode and Indic characters near the limit.
2. Resize the sidebar and restart.

**Expected UI:** Text truncates visually without corrupting saved title or control hitboxes.

**Expected runtime/storage:** Stable session identity and exact stored title within supported limits.

**Must not happen:** No malformed encoding or wrong row selection.

---

#### BR-SES-013 — Rename two sessions to identical titles (P2)
**Applicability:** VERIFY SESSION FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Create sessions A and B with distinct markers.
2. Give both the same display title.
3. Switch between them and inspect the active session.

**Expected UI:** The UI keeps both rows distinguishable by interaction/selection despite equal labels.

**Expected runtime/storage:** IDs and messages remain separate.

**Must not happen:** No identity keyed only by title.

---

#### BR-SES-014 — Delete non-active session (P1)
**Applicability:** VERIFY SESSION FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Create A and B; select A.
2. Delete B using its row menu and confirm if requested.
3. Inspect A and restart.

**Expected UI:** A stays selected and unchanged; B disappears according to delete policy.

**Expected runtime/storage:** Only B record/associated state is changed.

**Must not happen:** No deletion of active A or shared project files.

---

#### BR-SES-015 — Cancel session deletion (P1)
**Applicability:** VERIFY SESSION FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Open Delete for a session containing a test message.
2. Inspect confirmation wording and target identity.
3. Cancel and inspect row, history, and storage.

**Expected UI:** Dialog closes; selected list/history remain unchanged.

**Expected runtime/storage:** No delete operation is emitted/committed.

**Must not happen:** No message or artifact is removed.

---

#### BR-SES-016 — Confirm session deletion (P1)
**Applicability:** VERIFY SESSION FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Delete a disposable session and confirm.
2. Inspect list, search results, persisted records, and any linked artifacts.
3. Restart and verify deletion policy.

**Expected UI:** Deleted session is no longer available from normal navigation, subject to documented archive/trash policy.

**Expected runtime/storage:** Delete/soft-delete transaction is consistent.

**Must not happen:** No unrelated project/session deletion.

---

#### BR-SES-017 — Delete session during streaming (P0)
**Applicability:** VERIFY SESSION FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Start a long response in A.
2. Attempt delete using the available policy.
3. Complete/cancel the confirmation path, then deliver late mock events.

**Expected UI:** The app blocks, confirms, or explicitly handles deletion during active execution.

**Expected runtime/storage:** Execution termination/detachment follows contract; late events are handled safely.

**Must not happen:** No zombie session, unbounded task, or recreated deleted row.

---

#### BR-SES-018 — Delete session during tool side effect (P0)
**Applicability:** VERIFY SESSION FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Start a tool that writes only to a disposable test file.
2. Attempt to delete the associated session while tool is paused before write.
3. Proceed using the actual UI policy and verify file plus stored state.

**Expected UI:** UI accurately communicates allowed/blocked behavior.

**Expected runtime/storage:** Operation/session state and file side effect agree.

**Must not happen:** No hidden write into a deleted or wrong workspace.

---

#### BR-SES-019 — Delete session with pending approval (P1)
**Applicability:** VERIFY SESSION FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Make session A wait at an approval card.
2. Attempt deletion and test cancel and confirm branches.
3. Inspect whether pending tool can still execute.

**Expected UI:** Confirmation explains relevant state if needed; pending card cannot be acted on under a stale identity.

**Expected runtime/storage:** Approval decision is invalidated or preserved exactly as documented.

**Must not happen:** No execution after a confirmed rejection/deletion unless policy explicitly says otherwise.

---

#### BR-SES-020 — Late completion after session deletion (P0)
**Applicability:** VERIFY SESSION FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Start a deterministic task and arrange a late completion event.
2. Delete the session using the supported path.
3. Deliver the delayed completion event.

**Expected UI:** Deleted session does not silently return or display stale content as current.

**Expected runtime/storage:** Late event is ignored, quarantined, or stored under explicit tombstone policy.

**Must not happen:** No resurrection or cross-session injection.

---

#### BR-SES-021 — Delete last visible session (P2)
**Applicability:** VERIFY SESSION FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Create one session only.
2. Delete/archive it using the real action.
3. Inspect the empty-state and composer availability.

**Expected UI:** A coherent empty state appears; next action is obvious.

**Expected runtime/storage:** No invalid active-session pointer.

**Must not happen:** No hidden selected ID referencing deleted data.

---

#### BR-SES-022 — Search sessions: exact, partial, no match (P2)
**Applicability:** VERIFY SESSION FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Create sessions with distinct names and markers.
2. Search exact and partial names, then a guaranteed no-match query.
3. Clear search and open the intended row.

**Expected UI:** Results and empty-search state are correct; clearing restores expected list.

**Expected runtime/storage:** Search does not mutate session records.

**Must not happen:** No wrong selection caused by stale filtered indices.

---

#### BR-SES-023 — Archive then restore session (P2)
**Applicability:** VERIFY SESSION FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Archive a disposable session if supported.
2. Search normal/archived views.
3. Restore/unarchive and reopen.

**Expected UI:** Archive differs from permanent deletion and the row reappears in the expected location.

**Expected runtime/storage:** History and artifacts remain intact.

**Must not happen:** No data loss during archive/restore.

---

#### BR-SES-024 — Restart after create/rename/delete (P1)
**Applicability:** VERIFY SESSION FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Create session A, rename it, add a message, and delete session B.
2. Restart the app.
3. Compare visible state with the persisted store.

**Expected UI:** UI reflects the committed operations only.

**Expected runtime/storage:** Session records, titles, messages, and deletions remain consistent.

**Must not happen:** No resurrection, duplication, or lost committed update.

---

#### BR-SES-025 — Session title update races with streamed title (P2)
**Applicability:** VERIFY SESSION FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Start a run where automatic title generation is enabled, if supported.
2. Manually rename during title generation.
3. Deliver late automatic title result.

**Expected UI:** The documented precedence policy is followed.

**Expected runtime/storage:** Title update is version-checked or otherwise resolved consistently.

**Must not happen:** Late auto-title must not silently overwrite an explicit rename unless designed to do so.

---

### Projects

#### BR-PROJ-001 — Create project from valid empty folder (P1)
**Applicability:** VERIFY PROJECT FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Choose New Project/Open Project and select a disposable empty folder.
2. Confirm.
3. Inspect project identity/path and persistent store.

**Expected UI:** One project row appears and active state is clear.

**Expected runtime/storage:** Canonical folder path and project identity are saved.

**Must not happen:** No folder content is created or moved without an explicit action.

---

#### BR-PROJ-002 — Cancel folder picker (P2)
**Applicability:** VERIFY PROJECT FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Open project chooser.
2. Cancel picker without selecting a folder.
3. Inspect active project/list.

**Expected UI:** Chooser closes without misleading success.

**Expected runtime/storage:** No project record created.

**Must not happen:** No change to current project.

---

#### BR-PROJ-003 — Select nonexistent path (P1)
**Applicability:** VERIFY PROJECT FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Use a disposable fixture or test hook to provide a path that no longer exists.
2. Confirm project creation/open.
3. Restore a valid path and retry.

**Expected UI:** Clear validation error and recovery path.

**Expected runtime/storage:** Invalid project is not marked healthy/active.

**Must not happen:** No ghost project or fabricated tree.

---

#### BR-PROJ-004 — Select inaccessible/read-protected folder (P1)
**Applicability:** VERIFY PROJECT FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Select a test folder whose permissions deny required access.
2. Try to open/list it.
3. Restore access and retry.

**Expected UI:** Permission error is clear; unrelated app features remain responsive.

**Expected runtime/storage:** No cached content falsely appears current.

**Must not happen:** No permission bypass or silent partial import.

---

#### BR-PROJ-005 — Add duplicate canonical project path (P1)
**Applicability:** VERIFY PROJECT FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Add a folder as a project.
2. Add the same path again using a different path spelling that normalizes to the same location.

**Expected UI:** Duplicate policy is consistent and understandable.

**Expected runtime/storage:** Identity uses canonicalization appropriate to the platform.

**Must not happen:** No accidental duplicate project entries or divergent IDs for one root.

---

#### BR-PROJ-006 — Add path containing spaces and Unicode (P2)
**Applicability:** VERIFY PROJECT FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Create a test path with spaces and Unicode.
2. Add it, open a nested file, and create a harmless artifact.

**Expected UI:** Labels and paths remain legible and usable.

**Expected runtime/storage:** Correct absolute path is used by file operations.

**Must not happen:** No encoding/path truncation.

---

#### BR-PROJ-007 — Switch projects during active tool (P0)
**Applicability:** VERIFY PROJECT FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Start a paused write tool in project A.
2. Switch to project B.
3. Resume the tool and inspect the destination.

**Expected UI:** Active task ownership remains explicit in the UI.

**Expected runtime/storage:** Tool retains intended A workspace, not the newly selected B root.

**Must not happen:** No cross-project write.

---

#### BR-PROJ-008 — Remove project and cancel confirmation (P1)
**Applicability:** VERIFY PROJECT FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Open Remove/Delete Project on disposable project A.
2. Read the dialog scope and cancel.
3. Inspect filesystem and project list.

**Expected UI:** Project remains available.

**Expected runtime/storage:** No record or filesystem mutation.

**Must not happen:** No path deletion on cancel.

---

#### BR-PROJ-009 — Remove project from app versus delete disk contents (P0)
**Applicability:** VERIFY PROJECT FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Create project with sentinel file and generated artifact.
2. Open removal dialog and record exact wording.
3. Confirm the operation in an isolated test fixture.
4. Inspect disk, app index, and other projects.

**Expected UI:** UI wording accurately describes effect.

**Expected runtime/storage:** Filesystem side effects match the explicit contract.

**Must not happen:** Never delete disk contents when only “remove from app” was promised.

---

#### BR-PROJ-010 — Delete project while task is running (P0)
**Applicability:** VERIFY PROJECT FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Start a task that pauses before writing to a test file.
2. Attempt project removal.
3. Follow supported confirm/block/cancel behavior.
4. Resume or cancel task and inspect results.

**Expected UI:** State and risk are communicated; no confusing active context.

**Expected runtime/storage:** Task lifecycle and project record remain consistent.

**Must not happen:** No orphaned or misdirected file write.

---

#### BR-PROJ-011 — Project folder moved while app closed (P1)
**Applicability:** VERIFY PROJECT FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Create project and close app.
2. Move its test folder externally.
3. Relaunch and select stale entry.
4. Relink or remove using supported controls.

**Expected UI:** Missing-folder state is shown and recoverable.

**Expected runtime/storage:** Stored path updates only after successful relink.

**Must not happen:** No silent mapping to another similarly named folder.

---

#### BR-PROJ-012 — Project path becomes read-only mid-run (P1)
**Applicability:** VERIFY PROJECT FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Begin a deterministic artifact write in a writable disposable project.
2. Change permissions before the write.
3. Observe failure and restore permissions.
4. Retry or rerun.

**Expected UI:** Clear write failure; no false success card.

**Expected runtime/storage:** Partial output is detected and recovery is consistent.

**Must not happen:** No corrupted final artifact labelled complete.

---

#### BR-PROJ-013 — Create project while disk/storage is unavailable (P1)
**Applicability:** VERIFY PROJECT FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Inject local metadata storage failure.
2. Create a project.
3. Restore storage and retry.

**Expected UI:** UI does not claim creation completed prematurely.

**Expected runtime/storage:** Metadata and root path are committed atomically or repaired.

**Must not happen:** No partial list/store disagreement.

---

#### BR-PROJ-014 — Delete project with open viewer (P1)
**Applicability:** VERIFY PROJECT FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Open a file from project A in the right viewer.
2. Remove A using supported policy.
3. Observe viewer and reopen attempts.

**Expected UI:** Viewer closes or shows a stale/missing-file state correctly.

**Expected runtime/storage:** Viewer reference does not silently remap.

**Must not happen:** No crash or stale edits written to a different project.

---

#### BR-PROJ-015 — Delete project while another project selected (P1)
**Applicability:** VERIFY PROJECT FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Create projects A and B, select B.
2. Delete/remove A.
3. Verify B and its session.

**Expected UI:** B stays selected and unchanged.

**Expected runtime/storage:** Only A's metadata and explicitly scoped content change.

**Must not happen:** No destructive index/path mix-up.

---

#### BR-PROJ-016 — Project symlink or junction escapes workspace (P0)
**Applicability:** VERIFY PROJECT FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Create a test project with a symlink/junction pointing outside the allowed root where supported.
2. Use a synthetic tool request to access it.
3. Inspect enforcement and logs.

**Expected UI:** Blocked operation returns a clear error.

**Expected runtime/storage:** Path authorization uses resolved paths according to policy.

**Must not happen:** No out-of-workspace access.

---

#### BR-PROJ-017 — Project folder is renamed while app remains open (P1)
**Applicability:** VERIFY PROJECT FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Open project A and verify file tree.
2. Rename the test folder externally.
3. Refresh/navigate and attempt an operation.

**Expected UI:** Missing-path state is clear.

**Expected runtime/storage:** Runtime does not write to a fallback directory.

**Must not happen:** No silent operation against a stale path.

---

#### BR-PROJ-018 — Project creation and switching race (P1)
**Applicability:** VERIFY PROJECT FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Trigger project creation, then switch active selection before the chooser/creation callback completes.
2. Allow callback to complete.
3. Inspect selected project and persisted mapping.

**Expected UI:** Final selection follows a deterministic policy.

**Expected runtime/storage:** Late callback is associated with its request ID.

**Must not happen:** Stale chooser result does not override a newer user choice.

---

#### BR-PROJ-019 — Project contains many nested files (P2)
**Applicability:** VERIFY PROJECT FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Populate a disposable root with nested folders and mixed supported file types.
2. Expand/collapse, search if supported, and open files near the bottom.

**Expected UI:** Tree remains navigable; loading states and counts remain consistent.

**Expected runtime/storage:** No accidental file modifications during indexing.

**Must not happen:** No wrong row due to virtualized tree.

---

#### BR-PROJ-020 — Project has very long filename and path (P2)
**Applicability:** VERIFY PROJECT FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Populate long but supported names/path lengths.
2. Select, open, copy path, and create an artifact nearby.

**Expected UI:** Text may truncate visually but controls remain usable.

**Expected runtime/storage:** Underlying path remains exact.

**Must not happen:** No path truncation passed to tools.

---

### Composer

#### BR-INP-001 — Submit blank input (P1)
**Applicability:** VERIFY COMPOSER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Leave composer empty.
2. Activate Send by mouse and keyboard.

**Expected UI:** Send is disabled or validation is explicit.

**Expected runtime/storage:** No user message or execution created.

**Must not happen:** No empty model/tool request.

---

#### BR-INP-002 — Submit whitespace-only input (P2)
**Applicability:** VERIFY COMPOSER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Enter spaces/tabs/newlines only.
2. Activate Send.

**Expected UI:** Behavior matches validation contract.

**Expected runtime/storage:** No empty or normalized duplicate run unless deliberately supported.

**Must not happen:** No hidden blank task.

---

#### BR-INP-003 — Enter versus Shift+Enter behavior (P1)
**Applicability:** VERIFY COMPOSER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Type two lines using Enter and Shift+Enter according to actual shortcut mapping.
2. Observe draft before submission.
3. Submit using the primary button.

**Expected UI:** Only documented key submits; line breaks are preserved.

**Expected runtime/storage:** Single execution with exact intended message.

**Must not happen:** No accidental mid-draft submission.

---

#### BR-INP-004 — Send same prompt with rapid double click (P0)
**Applicability:** VERIFY COMPOSER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Type a unique synthetic prompt.
2. Double-click Send rapidly.
3. Compare message IDs, run IDs, and mock model call count.

**Expected UI:** Pending/completed state is understandable.

**Expected runtime/storage:** Idempotency or intentionally separate actions are consistent.

**Must not happen:** No duplicate execution for a single intended submission.

---

#### BR-INP-005 — Send while run already active (P1)
**Applicability:** VERIFY COMPOSER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Start a paused active run.
2. Type a second prompt.
3. Attempt send and inspect queue/disable/separate-run behavior.

**Expected UI:** Queue, reject, or separate-run policy is clearly reflected.

**Expected runtime/storage:** Execution order and IDs match UI.

**Must not happen:** No message silently lost or run unintentionally forked.

---

#### BR-INP-006 — Edit draft after failed submission (P1)
**Applicability:** VERIFY COMPOSER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Disconnect test API before submit.
2. Submit a unique prompt.
3. Edit the draft/error card according to available recovery UI, then reconnect.

**Expected UI:** Original input is retained or restoration is possible per design.

**Expected runtime/storage:** Retry sends the intended payload exactly once.

**Must not happen:** No loss or accidental double send.

---

#### BR-INP-007 — Draft per-session persistence (P1)
**Applicability:** VERIFY COMPOSER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Type unique drafts in A and B without sending.
2. Switch between them several times.
3. Restart if draft persistence is promised.

**Expected UI:** Each draft follows documented persistence semantics.

**Expected runtime/storage:** Storage keys are isolated by session.

**Must not happen:** Draft content cannot migrate across sessions.

---

#### BR-INP-008 — Large prompt at configured limit (P1)
**Applicability:** VERIFY COMPOSER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Generate prompt at the documented size limit.
2. Submit via normal UI.
3. Repeat just above the limit.

**Expected UI:** Valid content is accepted; oversized content yields clear validation.

**Expected runtime/storage:** Accepted payload length matches editor content.

**Must not happen:** No silent truncation or UI freeze.

---

#### BR-INP-009 — Unicode and bidirectional content (P2)
**Applicability:** VERIFY COMPOSER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Enter mixed Indic text, emoji, RTL strings, quotes, backslashes, and combining marks.
2. Submit and inspect rendered and persisted text.

**Expected UI:** Text is legible and content boundaries remain stable.

**Expected runtime/storage:** Stored text matches submitted content.

**Must not happen:** No corruption or accidental markup execution.

---

#### BR-INP-010 — Paste large multi-line/table content (P2)
**Applicability:** VERIFY COMPOSER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Paste a synthetic large multiline table.
2. Edit a middle cell/line and move cursor.
3. Submit and compare exact payload.

**Expected UI:** Composer remains responsive and selection/cursor behaves correctly.

**Expected runtime/storage:** Exact intended content reaches runtime.

**Must not happen:** No dropped lines or extra submit.

---

#### BR-INP-011 — Undo/redo composer edits (P2)
**Applicability:** VERIFY COMPOSER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Type text, replace a section, undo once, redo once, then undo to empty.
2. Attempt undo again at stack boundary.

**Expected UI:** Editor text tracks undo/redo stack.

**Expected runtime/storage:** No task is submitted as a side effect.

**Must not happen:** No undo leaks into conversation/file state.

---

#### BR-INP-012 — Attachment removed at submit boundary (P1)
**Applicability:** VERIFY COMPOSER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Attach synthetic file A.
2. Rapidly remove A and submit; repeat with replacement B.
3. Inspect actual runtime attachment list.

**Expected UI:** Visible attachment state matches the submission outcome.

**Expected runtime/storage:** Payload references exactly the submitted attachments.

**Must not happen:** Removed file is not secretly sent.

---

#### BR-INP-013 — Attachment becomes unreadable before execution (P1)
**Applicability:** VERIFY COMPOSER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Attach an accessible synthetic file.
2. Revoke access or remove file before submission is consumed.
3. Observe execution and recovery.

**Expected UI:** Action fails clearly or handles a stable snapshot as designed.

**Expected runtime/storage:** No false “read successfully” claim.

**Must not happen:** No unintended read from another path.

---

#### BR-INP-014 — Message retry after uncertain network result (P0)
**Applicability:** VERIFY COMPOSER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Submit a unique request and simulate connection loss after server acceptance but before UI acknowledgement.
2. Reconnect and inspect task history before retrying.
3. Use the supported recovery action.

**Expected UI:** UI indicates uncertain/pending outcome rather than claiming definite failure if outcome is unknown.

**Expected runtime/storage:** Request IDs/idempotency prevent unintended duplicate work where designed.

**Must not happen:** Do not blindly execute a potentially already accepted request twice.

---

#### BR-INP-015 — Edit/resend an earlier user message (P1)
**Applicability:** VERIFY COMPOSER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Use an earlier message edit/resend action if implemented.
2. Edit it and inspect subsequent history.
3. Cancel the edit and compare state.

**Expected UI:** History and changed-turn behavior match product contract.

**Expected runtime/storage:** Execution lineage or version history is consistent.

**Must not happen:** No unrelated later message silently disappears.

---

#### BR-INP-016 — Copy message while it streams (P2)
**Applicability:** VERIFY COMPOSER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Start streaming a long answer.
2. Copy the current message during streaming.
3. Compare clipboard with currently rendered text.

**Expected UI:** Copy behavior is deterministic and clipboard contains the intended portion.

**Expected runtime/storage:** No mutation of run state.

**Must not happen:** No tool output or neighboring message mixed into clipboard.

---

#### BR-INP-017 — Submit during app focus loss (P2)
**Applicability:** VERIFY COMPOSER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Compose a message.
2. Alt-tab/minimize and restore.
3. Submit by mouse and keyboard.

**Expected UI:** Draft/focus state behaves consistently.

**Expected runtime/storage:** One execution created.

**Must not happen:** No global shortcut fires twice.

---

#### BR-INP-018 — Composer disabled/error state recovery (P1)
**Applicability:** VERIFY COMPOSER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Cause API/runtime initialization failure.
2. Inspect composer controls.
3. Restore dependency and use Retry/Send as supported.

**Expected UI:** Disabled/enabled transitions match readiness.

**Expected runtime/storage:** One healthy request after recovery.

**Must not happen:** No stale disabled state or false-ready state.

---

### Connectivity

#### BR-NET-001 — Network lost before user presses Send (P1)
**Applicability:** VERIFY API/NETWORK PATH. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Disconnect only the test network/API.
2. Attempt submission.
3. Restore connection and retry.

**Expected UI:** Offline state and available actions are explicit.

**Expected runtime/storage:** No request reached server before submission.

**Must not happen:** No false completed card.

---

#### BR-NET-002 — Network lost after click before request acknowledgement (P0)
**Applicability:** VERIFY API/NETWORK PATH. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Use a controllable proxy to drop the connection after dispatch but before acknowledgement.
2. Observe pending/error state.
3. Reconnect and reconcile task status before retry.

**Expected UI:** UI represents uncertain outcome safely.

**Expected runtime/storage:** Request ID/idempotency or status lookup avoids duplicate side effects where possible.

**Must not happen:** No blind duplicate run.

---

#### BR-NET-003 — Network lost after server accepts request (P0)
**Applicability:** VERIFY API/NETWORK PATH. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Mock server records accepted request, then drops response before client acknowledgement.
2. Reconnect and inspect existing task/status.
3. Attempt recovery.

**Expected UI:** Task is shown pending/reconciling when possible.

**Expected runtime/storage:** Accepted server task is reused/reconciled.

**Must not happen:** No second execution solely because acknowledgement was lost.

---

#### BR-NET-004 — Network lost before first stream delta (P1)
**Applicability:** VERIFY API/NETWORK PATH. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Server accepts request but stream connection fails before text arrives.
2. Inspect error card and retry/reconnect.

**Expected UI:** No indefinite spinner; uncertainty is explicit.

**Expected runtime/storage:** Server task state is checked/reconciled according to client contract.

**Must not happen:** No empty success message.

---

#### BR-NET-005 — Network lost mid-stream (P0)
**Applicability:** VERIFY API/NETWORK PATH. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Stream unique marker and partial output.
2. Cut connection.
3. Inspect partial response, retry, and persisted state.

**Expected UI:** Partial vs final output is visibly distinguished.

**Expected runtime/storage:** Incomplete run is recorded as interrupted/failed or resumable as designed.

**Must not happen:** Partial answer not mislabeled complete.

---

#### BR-NET-006 — Network lost during tool dispatch (P0)
**Applicability:** VERIFY API/NETWORK PATH. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Pause a tool dispatch at the API/runtime boundary.
2. Drop connection after dispatch begins.
3. Reconnect and inspect tool invocation identity/result.

**Expected UI:** Tool status shows unresolved/error appropriately.

**Expected runtime/storage:** Dispatch deduplication or status reconciliation is correct.

**Must not happen:** No duplicate non-idempotent tool invocation.

---

#### BR-NET-007 — Network lost while tool performs side effect (P0)
**Applicability:** VERIFY API/NETWORK PATH. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Use a safe mock write tool that records an invocation count.
2. Drop connection after side effect but before result returns.
3. Reconnect and invoke recovery.

**Expected UI:** UI distinguishes unknown result from definite no-op where possible.

**Expected runtime/storage:** Result reconciliation verifies existing side effect.

**Must not happen:** No repeated write/operation causing duplicated side effects.

---

#### BR-NET-008 — Network lost after final response before persistence confirmation (P0)
**Applicability:** VERIFY API/NETWORK PATH. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Allow runtime to finish.
2. Fail the persistence acknowledgement path.
3. Restart/reconnect and inspect history.

**Expected UI:** Completion status is not misleading.

**Expected runtime/storage:** Durability semantics are followed and repair/retry is possible.

**Must not happen:** No success badge for a response that is not committed if commit is required.

---

#### BR-NET-009 — Connection flaps repeatedly (P1)
**Applicability:** VERIFY API/NETWORK PATH. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Toggle test connectivity several times during one deterministic run.
2. Observe each transition and then restore stable connectivity.

**Expected UI:** Status indicator does not flicker into contradictory states or hide a lasting failure.

**Expected runtime/storage:** Bounded reconnect logic; one active task identity.

**Must not happen:** No retry storm, duplicate task, or listener leak.

---

#### BR-NET-010 — Slow network with progress events (P2)
**Applicability:** VERIFY API/NETWORK PATH. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Throttle the test connection and emit progress within contract.
2. Run a long response.
3. Observe timeout and progress behavior.

**Expected UI:** UI remains responsive; progress shows meaningful activity.

**Expected runtime/storage:** Timeouts measure correct boundary and heartbeat policy.

**Must not happen:** Active healthy stream not killed by an unrelated idle timer.

---

#### BR-NET-011 — Slow network with no progress (P1)
**Applicability:** VERIFY API/NETWORK PATH. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Throttle connection and withhold all bytes past configured threshold.
2. Observe timeout handling and action controls.
3. Restore network and recover.

**Expected UI:** Defined timeout appears; UI does not spin indefinitely.

**Expected runtime/storage:** Cancellation/timeout state is persisted accurately.

**Must not happen:** Late response cannot overwrite a newer retry incorrectly.

---

#### BR-NET-012 — Reconnect while minimized (P2)
**Applicability:** VERIFY API/NETWORK PATH. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Start task; minimize app; disconnect/reconnect test network.
2. Restore window.
3. Inspect task and connection state.

**Expected UI:** Status reconciles immediately or within documented polling interval.

**Expected runtime/storage:** No duplicate listeners/notifications.

**Must not happen:** Background reconnect must not cause second dispatch.

---

#### BR-NET-013 — API works but LLM gateway fails (P1)
**Applicability:** VERIFY API/NETWORK PATH. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Keep test API responsive but inject gateway/provider timeout.
2. Run a task and inspect error details.
3. Restore gateway and recover.

**Expected UI:** Failure is reported as runtime/provider error when diagnostics allow.

**Expected runtime/storage:** Retry uses correct request/session context.

**Must not happen:** No false claim that offline UI caused the failure.

---

#### BR-NET-014 — 401 access token during active run (P1)
**Applicability:** VERIFY API/NETWORK PATH. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Inject 401 during a run.
2. Exercise token-refresh path.
3. Inspect run reconciliation.

**Expected UI:** Sign-in/retry guidance is accurate.

**Expected runtime/storage:** Refresh occurs once according to policy; request identity is handled correctly.

**Must not happen:** No infinite refresh loop or duplicate execution.

---

#### BR-NET-015 — 403 authorization failure (P1)
**Applicability:** VERIFY API/NETWORK PATH. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Use a test identity without permission for one operation.
2. Attempt operation, then use an authorized test identity if available.

**Expected UI:** Permission error differs from network error.

**Expected runtime/storage:** No unauthorized side effect.

**Must not happen:** No automatic retry that bypasses permission denial.

---

#### BR-NET-016 — 429 quota/rate limiting (P1)
**Applicability:** VERIFY API/NETWORK PATH. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Mock 429 with and without Retry-After.
2. Inspect controls and timing.
3. Restore quota and retry.

**Expected UI:** Useful, accurate limit message; retry available under policy.

**Expected runtime/storage:** Backoff is bounded and honors server guidance if implemented.

**Must not happen:** No aggressive retry storm or duplicate task.

---

#### BR-NET-017 — Proxy/gateway returns 502/503/504 (P1)
**Applicability:** VERIFY API/NETWORK PATH. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Inject each relevant server status separately.
2. Observe UI and logs.
3. Restore healthy response and retry.

**Expected UI:** Error class and recovery stay coherent.

**Expected runtime/storage:** Retries follow bounded policy.

**Must not happen:** No status misclassified as successful empty response.

---

#### BR-NET-018 — Malformed response payload (P1)
**Applicability:** VERIFY API/NETWORK PATH. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Return malformed JSON or a missing required field.
2. Trigger the operation.
3. Restore valid payload.

**Expected UI:** Controlled error is presented.

**Expected runtime/storage:** Schema rejection occurs before invalid state is persisted.

**Must not happen:** No app crash or corrupt session record.

---

#### BR-NET-019 — DNS/TLS/connection setup failure (P1)
**Applicability:** VERIFY API/NETWORK PATH. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Use an isolated test endpoint configured to fail at DNS/TLS/connection stage.
2. Attempt request.
3. Restore valid endpoint.

**Expected UI:** Connection diagnostic is useful without secrets.

**Expected runtime/storage:** No unauthorized fallback endpoint.

**Must not happen:** Credentials are not leaked to a different host.

---

#### BR-NET-020 — Internet returns but local runtime remains dead (P1)
**Applicability:** VERIFY API/NETWORK PATH. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Stop the test local runtime while disconnected.
2. Restore internet only.
3. Try request and then restore runtime.

**Expected UI:** UI distinguishes unresolved local runtime.

**Expected runtime/storage:** No request enters a nonexistent runtime or is marked complete.

**Must not happen:** Network-online indicator is not treated as full readiness.

---

#### BR-NET-021 — Internet remains up but API auth service fails (P1)
**Applicability:** VERIFY API/NETWORK PATH. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Keep generic internet available but fail the auth/API endpoint.
2. Attempt operation.
3. Restore test service.

**Expected UI:** App displays service/auth issue instead of generic offline if distinguishable.

**Expected runtime/storage:** No stale authorization assumptions.

**Must not happen:** No sensitive data sent while auth unresolved.

---

#### BR-NET-022 — Task reconnect policy after user cancellation (P1)
**Applicability:** VERIFY API/NETWORK PATH. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Start a task, disconnect, press Cancel, then reconnect.
2. Inspect remote/runtime task status and history.

**Expected UI:** Cancelled state remains clear.

**Expected runtime/storage:** Cancellation is propagated/reconciled where supported.

**Must not happen:** Reconnect does not restart the cancelled task.

---

#### BR-NET-023 — Late stream after reconnect and retry (P0)
**Applicability:** VERIFY API/NETWORK PATH. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Make run A lose connection; initiate documented recovery or retry as permitted.
2. Deliver late events from A after run B has begun.
3. Inspect final messages and IDs.

**Expected UI:** Only correct run appears under the intended message.

**Expected runtime/storage:** Run ID/version filters stale event streams.

**Must not happen:** No interleaving or duplicate completion.

---

#### BR-NET-024 — Offline local file browsing (P2)
**Applicability:** VERIFY API/NETWORK PATH. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Disable internet while keeping local filesystem accessible.
2. Browse project and open local files.
3. Attempt a remote agent task.

**Expected UI:** Local functions work if intended to be offline-capable; remote actions show proper offline state.

**Expected runtime/storage:** Local read does not unnecessarily depend on remote API.

**Must not happen:** No false remote execution success.

---

#### BR-NET-025 — Network loss during sign-out (P1)
**Applicability:** VERIFY API/NETWORK PATH. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Begin sign-out with test identity.
2. Drop network during server token invalidation.
3. Relaunch/reconnect and verify local auth state.

**Expected UI:** UI reports incomplete sign-out if the server state is unknown, per contract.

**Expected runtime/storage:** Local credential clearing and server revocation behavior follow security policy.

**Must not happen:** No sensitive session assumed valid merely because request failed.

---

### Cards

#### BR-CARD-001 — Card inventory sweep: every discovered card type (P0)
**Applicability:** DISCOVER CARD TYPES; INSTANTIATE FOR EACH ACTUAL TYPE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Inspect source and rendered UI to enumerate distinct card types and variants.
2. Trigger each type with a deterministic fixture.
3. Record title/body/status/controls/labels/IDs and lifecycle.

**Expected UI:** Actual visible variants and states are inventoried; no undocumented variant is skipped.

**Expected runtime/storage:** Each card maps to correct event/task/session ID.

**Must not happen:** Do not assume all reference-product card types exist.

---

#### BR-CARD-002 — Each card button: happy path (P1)
**Applicability:** DISCOVER CARD TYPES; INSTANTIATE FOR EACH ACTUAL TYPE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. For every discovered card type, enumerate every visible button/menu action.
2. Trigger the card in a valid state and activate each action separately.
3. Assert visible change plus actual runtime/storage/filesystem effect.

**Expected UI:** Button gives the result described by its label.

**Expected runtime/storage:** One intended state transition/action is recorded.

**Must not happen:** Clickability alone is not pass evidence.

---

#### BR-CARD-003 — Each card button: disabled/precondition path (P1)
**Applicability:** DISCOVER CARD TYPES; INSTANTIATE FOR EACH ACTUAL TYPE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Reach states where action prerequisites are absent or the card is terminal.
2. Check each button's enabled/disabled state.
3. Attempt keyboard and mouse activation where feasible.

**Expected UI:** Ineligible action is disabled or rejected clearly.

**Expected runtime/storage:** No invalid action reaches runtime.

**Must not happen:** No hidden action can bypass UI preconditions unless backend rejects it.

---

#### BR-CARD-004 — Each card button: double-click/race (P0)
**Applicability:** DISCOVER CARD TYPES; INSTANTIATE FOR EACH ACTUAL TYPE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Reach each high-risk action card.
2. Double-click primary action or activate conflicting actions rapidly.
3. Inspect command count and terminal state.

**Expected UI:** One unambiguous outcome is shown.

**Expected runtime/storage:** Server/runtime decision is idempotent or conflict-checked.

**Must not happen:** No double approval, repeated tool, duplicate retry, or double revert.

---

#### BR-CARD-005 — Card arrives after switching sessions (P0)
**Applicability:** DISCOVER CARD TYPES; INSTANTIATE FOR EACH ACTUAL TYPE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Start a card-producing task in A.
2. Switch to B before card arrival.
3. Allow card to arrive and return to A.

**Expected UI:** Card appears only in intended conversation or explicit global task area.

**Expected runtime/storage:** Card retains original session/run identity.

**Must not happen:** No card rendered as part of B.

---

#### BR-CARD-006 — Card arrives after its run was cancelled (P0)
**Applicability:** DISCOVER CARD TYPES; INSTANTIATE FOR EACH ACTUAL TYPE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Start a card-producing run.
2. Cancel it before card event arrives.
3. Deliver a late card event using controlled fixture.

**Expected UI:** Cancelled run remains terminal or shows a documented late-artifact state.

**Expected runtime/storage:** Late event is validated against run state.

**Must not happen:** No cancelled run silently reopens.

---

#### BR-CARD-007 — Card loading skeleton/error transition (P1)
**Applicability:** DISCOVER CARD TYPES; INSTANTIATE FOR EACH ACTUAL TYPE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Trigger card whose details load asynchronously.
2. Inject delayed response, then an error.
3. Retry/reopen after restoring service.

**Expected UI:** Loading resolves into success/error without stuck skeleton.

**Expected runtime/storage:** State sequence is ordered and persisted correctly.

**Must not happen:** No simultaneous contradictory loading/success states.

---

#### BR-CARD-008 — Card close/dismiss versus cancel (P1)
**Applicability:** DISCOVER CARD TYPES; INSTANTIATE FOR EACH ACTUAL TYPE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Open a long-running card.
2. Dismiss/collapse/close it without using Cancel if UI permits.
3. Inspect task state.
4. Repeat using explicit Cancel.

**Expected UI:** Dismiss and cancel have distinct, clearly communicated semantics.

**Expected runtime/storage:** Only explicit task cancellation changes execution state unless design says otherwise.

**Must not happen:** Closing card must not unintentionally cancel work.

---

#### BR-CARD-009 — Card status progression (P1)
**Applicability:** DISCOVER CARD TYPES; INSTANTIATE FOR EACH ACTUAL TYPE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Trigger a card that passes through pending, running, and terminal states.
2. Capture each transition and event sequence.

**Expected UI:** Visible label/icon/buttons match each state.

**Expected runtime/storage:** Monotonic valid state transitions are enforced.

**Must not happen:** No terminal state regresses due to late event.

---

#### BR-CARD-010 — Card content updates while expanded (P2)
**Applicability:** DISCOVER CARD TYPES; INSTANTIATE FOR EACH ACTUAL TYPE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Expand a card with dynamic progress/output.
2. Deliver multiple updates while scrolling.
3. Collapse/expand again.

**Expected UI:** Expansion and scroll are stable; latest content is visible.

**Expected runtime/storage:** Updates bind to same card identity.

**Must not happen:** No jump to unrelated card or lost button hit-target.

---

#### BR-CARD-011 — Long card with footer buttons (P2)
**Applicability:** DISCOVER CARD TYPES; INSTANTIATE FOR EACH ACTUAL TYPE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Provide long details/output in a card.
2. Scroll card and viewport independently.
3. Activate first and last footer buttons.

**Expected UI:** Controls remain visible/reachable and do not overlap content.

**Expected runtime/storage:** Correct action invoked for targeted card.

**Must not happen:** No scroll bubbling that causes wrong card action.

---

#### BR-CARD-012 — Card copied or referenced in another session (P2)
**Applicability:** DISCOVER CARD TYPES; INSTANTIATE FOR EACH ACTUAL TYPE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Use any supported copy/share/reference action.
2. Switch to target session and inspect provenance.
3. Act on the referenced card if allowed.

**Expected UI:** Copied reference clearly identifies whether it is a snapshot or live item.

**Expected runtime/storage:** Identity/provenance remains unambiguous.

**Must not happen:** Action must not target original item accidentally.

---

#### BR-CARD-013 — Card stale after app restart (P1)
**Applicability:** DISCOVER CARD TYPES; INSTANTIATE FOR EACH ACTUAL TYPE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Persist a pending/running card and close/restart under controlled conditions.
2. Reopen session.
3. Compare displayed state with runtime/status source.

**Expected UI:** Stale card state is reconciled or explicitly marked unknown.

**Expected runtime/storage:** Persisted state reconciles with actual execution status.

**Must not happen:** No pending approval appears actionable if its request expired.

---

#### BR-CARD-014 — Error card retry action (P0)
**Applicability:** DISCOVER CARD TYPES; INSTANTIATE FOR EACH ACTUAL TYPE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Trigger failure card for a deterministic task.
2. Inspect error category and retry affordance.
3. Retry once; then cause a second failure.

**Expected UI:** Retry state and subsequent result are accurately rendered.

**Expected runtime/storage:** Retry uses correct input and attempt lineage.

**Must not happen:** Previous failed attempt is not overwritten as if it succeeded.

---

#### BR-CARD-015 — Connection card action matrix (P1)
**Applicability:** DISCOVER CARD TYPES; INSTANTIATE FOR EACH ACTUAL TYPE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Cause offline, reconnecting, authentication-required, and recovered states where supported.
2. Exercise Retry, Reconnect, Sign in, Dismiss, or equivalent controls individually.

**Expected UI:** Each action appears only in relevant states and updates feedback.

**Expected runtime/storage:** Correct endpoint/state transition is invoked.

**Must not happen:** No reconnect loops or dismissing a card falsely restores connectivity.

---

#### BR-CARD-016 — Approval card rejection branch (P0)
**Applicability:** DISCOVER CARD TYPES; INSTANTIATE FOR EACH ACTUAL TYPE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Raise a safe mock operation requiring approval.
2. Reject it.
3. Emit a delayed execution request for the same approval.

**Expected UI:** Card shows rejection/terminal status and explains outcome.

**Expected runtime/storage:** Backend/runtime refuses rejected operation.

**Must not happen:** No side effect executes after rejection.

---

#### BR-CARD-017 — Approval card approval branch (P0)
**Applicability:** DISCOVER CARD TYPES; INSTANTIATE FOR EACH ACTUAL TYPE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Raise a safe mock operation requiring approval.
2. Review operation details and approve once.
3. Verify the exact side effect and audit status.

**Expected UI:** Card changes to approved/running/completed as designed.

**Expected runtime/storage:** Only scoped operation proceeds.

**Must not happen:** No hidden extra operation is approved.

---

#### BR-CARD-018 — Diff/change-review card: reject and revise (P1)
**Applicability:** DISCOVER CARD TYPES; INSTANTIATE FOR EACH ACTUAL TYPE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Generate a synthetic change/diff.
2. Reject or request changes with feedback.
3. Generate revised diff and compare versions.

**Expected UI:** Rejected version remains distinguishable from revision.

**Expected runtime/storage:** Feedback maps to correct run and artifact version.

**Must not happen:** Old diff is not shown as final approved state.

---

#### BR-CARD-019 — Artifact card actions: open/reveal/copy (P1)
**Applicability:** DISCOVER CARD TYPES; INSTANTIATE FOR EACH ACTUAL TYPE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Generate a valid artifact.
2. Test every artifact card action individually: open, reveal, copy path, external open, etc. where present.
3. Verify result against filesystem and actual path.

**Expected UI:** Each action targets the displayed artifact.

**Expected runtime/storage:** No path substitution; file metadata matches result.

**Must not happen:** No false success if file is missing/unreadable.

---

#### BR-CARD-020 — Tool card: arguments and secret redaction (P0)
**Applicability:** DISCOVER CARD TYPES; INSTANTIATE FOR EACH ACTUAL TYPE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Trigger tools with harmless arguments plus synthetic canary secret.
2. Expand/collapse details and inspect logs/screenshots.

**Expected UI:** Useful arguments/output are visible according to privacy policy; secrets are masked.

**Expected runtime/storage:** Invocation details remain associated with correct tool ID.

**Must not happen:** No real/synthetic secret leakage to logs beyond expressly permitted test fixture.

---

#### BR-CARD-021 — Clarification card: submit answer once (P1)
**Applicability:** DISCOVER CARD TYPES; INSTANTIATE FOR EACH ACTUAL TYPE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Trigger a task that requires clarification.
2. Submit an answer; double-click submit and deliver duplicate answer event.

**Expected UI:** Card transitions out of waiting once.

**Expected runtime/storage:** Answer attaches to correct pending step.

**Must not happen:** No duplicate continuation or context insertion.

---

#### BR-CARD-022 — Card action during rapid session switch (P0)
**Applicability:** DISCOVER CARD TYPES; INSTANTIATE FOR EACH ACTUAL TYPE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Display visually similar cards in A and B.
2. Switch rapidly; activate an action by keyboard and mouse.
3. Inspect target card/action IDs.

**Expected UI:** Action clearly applies to currently focused/selected card.

**Expected runtime/storage:** Action uses immutable card/run ID, not a stale row index.

**Must not happen:** No cross-session approval/cancel/retry.

---

#### BR-CARD-023 — Card removal and history integrity (P2)
**Applicability:** DISCOVER CARD TYPES; INSTANTIATE FOR EACH ACTUAL TYPE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Dismiss a completed card if supported.
2. Reopen session and inspect message history/tool trace.

**Expected UI:** Dismissal behavior is consistent across views.

**Expected runtime/storage:** Underlying audit/history retained as intended.

**Must not happen:** UI hiding cannot destroy required execution history.

---

#### BR-CARD-024 — Card with unknown/unrecognized event subtype (P1)
**Applicability:** DISCOVER CARD TYPES; INSTANTIATE FOR EACH ACTUAL TYPE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Inject an unknown card/event subtype into a test stream.
2. Continue with a valid event afterwards.

**Expected UI:** Unknown item is safely represented or ignored with diagnostic; UI remains functional.

**Expected runtime/storage:** Parser preserves forward compatibility as designed.

**Must not happen:** No crash or corruption of subsequent messages.

---

### Undo and revert

#### BR-UNDO-001 — Composer text undo boundaries (P2)
**Applicability:** VERIFY UNDO/REVERT FEATURES; MARK N/A IF ABSENT. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Enter and edit text several times.
2. Undo until initial state, then undo again.
3. Redo to final state.

**Expected UI:** Text stack behaves normally.

**Expected runtime/storage:** No chat/runtime/filesystem change.

**Must not happen:** Undo must not accidentally revert a task.

---

#### BR-UNDO-002 — Undo after sending a message (P1)
**Applicability:** VERIFY UNDO/REVERT FEATURES; MARK N/A IF ABSENT. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Send a message and wait for it to be recorded.
2. Press Ctrl+Z while focus is on composer, then in any message editing surface.
3. Inspect conversation and execution.

**Expected UI:** Only documented undo scope is affected.

**Expected runtime/storage:** Sent message lifecycle remains consistent.

**Must not happen:** Generic undo must not silently retract a remote task.

---

#### BR-UNDO-003 — Edit earlier prompt and regenerate (P1)
**Applicability:** VERIFY UNDO/REVERT FEATURES; MARK N/A IF ABSENT. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Use edit/regenerate if available for a prior prompt.
2. Modify text and cancel once.
3. Repeat and submit edit.

**Expected UI:** Cancel preserves original; accepted edit displays correct lineage.

**Expected runtime/storage:** New execution/version relationship matches contract.

**Must not happen:** No unrelated subsequent history loss.

---

#### BR-UNDO-004 — Conversation rewind without filesystem revert (P0)
**Applicability:** VERIFY UNDO/REVERT FEATURES; MARK N/A IF ABSENT. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Run a task that changes a disposable test file.
2. Use any conversation-only rewind/undo action.
3. Compare file hash and conversation history.

**Expected UI:** UI states clearly what has been undone.

**Expected runtime/storage:** Filesystem stays unchanged if this operation only alters conversation.

**Must not happen:** No false claim that file changes were reversed.

---

#### BR-UNDO-005 — Filesystem revert without conversation deletion (P0)
**Applicability:** VERIFY UNDO/REVERT FEATURES; MARK N/A IF ABSENT. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Make an agent edit in a disposable workspace and preserve a baseline.
2. Use the actual file revert mechanism.
3. Inspect chat history, diff, and hash.

**Expected UI:** Revert result and scope are visible.

**Expected runtime/storage:** File returns to intended prior state.

**Must not happen:** Conversation history is not unexpectedly erased.

---

#### BR-UNDO-006 — Revert selected file only (P0)
**Applicability:** VERIFY UNDO/REVERT FEATURES; MARK N/A IF ABSENT. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Generate changes to files A and B.
2. Select revert for A only.
3. Compare hashes/diffs for both.

**Expected UI:** A is marked reverted; B remains clearly changed.

**Expected runtime/storage:** Only A is reverted.

**Must not happen:** No broader project reset.

---

#### BR-UNDO-007 — Revert all changes confirmation cancel (P0)
**Applicability:** VERIFY UNDO/REVERT FEATURES; MARK N/A IF ABSENT. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Create multiple disposable changed files.
2. Open global revert and inspect scope/warning.
3. Cancel.
4. Compare hashes.

**Expected UI:** No success message; dialog closes.

**Expected runtime/storage:** No file changes.

**Must not happen:** Cancel is truly non-destructive.

---

#### BR-UNDO-008 — Revert all changes confirmed (P0)
**Applicability:** VERIFY UNDO/REVERT FEATURES; MARK N/A IF ABSENT. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. On a fresh fixture only, create tracked changes.
2. Confirm revert and capture before/after manifests.

**Expected UI:** Result summary matches changed files.

**Expected runtime/storage:** All and only in-scope changes revert.

**Must not happen:** Untracked user files and outside-root files remain untouched per policy.

---

#### BR-UNDO-009 — Revert with external modification after agent change (P0)
**Applicability:** VERIFY UNDO/REVERT FEATURES; MARK N/A IF ABSENT. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Agent changes file A.
2. Manually add a distinct external edit to A.
3. Initiate revert.

**Expected UI:** Conflict detection or explicit overwrite warning occurs according to policy.

**Expected runtime/storage:** External edit is preserved or loss is explicitly authorized.

**Must not happen:** No silent destruction of user work.

---

#### BR-UNDO-010 — Revert while tool still writing (P0)
**Applicability:** VERIFY UNDO/REVERT FEATURES; MARK N/A IF ABSENT. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Pause a file-writing tool between partial write and finalization.
2. Attempt revert.
3. Resume or cancel tool.

**Expected UI:** UI blocks/coordinates operation or gives clear conflict handling.

**Expected runtime/storage:** Writes and revert are serialized or conflict-checked.

**Must not happen:** No race leaves corrupted or falsely reverted file.

---

#### BR-UNDO-011 — Undo/revert operation fails mid-way (P0)
**Applicability:** VERIFY UNDO/REVERT FEATURES; MARK N/A IF ABSENT. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Create several changed files in disposable workspace.
2. Inject failure after the first revert operation.
3. Inspect recovery status and files.

**Expected UI:** Partial failure is explicitly reported.

**Expected runtime/storage:** Transactional rollback or accurate partial-change manifest exists.

**Must not happen:** No “all reverted” message when only some files changed.

---

#### BR-UNDO-012 — Repeat revert twice (P1)
**Applicability:** VERIFY UNDO/REVERT FEATURES; MARK N/A IF ABSENT. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Revert a changed fixture once.
2. Repeat same revert.
3. Inspect results and file hashes.

**Expected UI:** Second action is a no-op or reports nothing to revert.

**Expected runtime/storage:** Idempotent final state.

**Must not happen:** No unrelated file changes.

---

#### BR-UNDO-013 — Undo after session switch (P1)
**Applicability:** VERIFY UNDO/REVERT FEATURES; MARK N/A IF ABSENT. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Create draft/edit state in A and separate state in B.
2. Switch focus and invoke undo.
3. Inspect both sessions and files.

**Expected UI:** Undo follows the focused control/item.

**Expected runtime/storage:** No state crosses session boundary.

**Must not happen:** No revert of A caused by focus in B.

---

#### BR-UNDO-014 — Revert and app restart (P1)
**Applicability:** VERIFY UNDO/REVERT FEATURES; MARK N/A IF ABSENT. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Revert a test artifact/file.
2. Restart app and reopen project/session.
3. Verify final file and history.

**Expected UI:** Persisted UI does not show stale unreverted state.

**Expected runtime/storage:** Filesystem and stored operation state agree.

**Must not happen:** No resurrection of old output.

---

#### BR-UNDO-015 — Revert denied by file permissions (P1)
**Applicability:** VERIFY UNDO/REVERT FEATURES; MARK N/A IF ABSENT. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Make test target read-only or otherwise unwritable.
2. Attempt revert.
3. Restore permission and retry.

**Expected UI:** Failure and retry state are clear.

**Expected runtime/storage:** No false commit marker.

**Must not happen:** No corruption from partial overwrite.

---

#### BR-UNDO-016 — Revert path validation (P0)
**Applicability:** VERIFY UNDO/REVERT FEATURES; MARK N/A IF ABSENT. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Supply a controlled invalid/outside-workspace target to the test boundary.
2. Attempt revert.
3. Verify target manifests before/after.

**Expected UI:** Operation is rejected.

**Expected runtime/storage:** Resolved path checks protect boundary.

**Must not happen:** No out-of-scope file change.

---

#### BR-UNDO-017 — Reject proposal versus revert applied change (P1)
**Applicability:** VERIFY UNDO/REVERT FEATURES; MARK N/A IF ABSENT. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Create one pending/unapplied proposal and one already-applied change.
2. Use reject on proposal; use revert on applied change.

**Expected UI:** UI names/actions distinguish these concepts.

**Expected runtime/storage:** Reject prevents apply; revert changes existing file state.

**Must not happen:** Reject is not treated as rollback and vice versa.

---

#### BR-UNDO-018 — Undo button disabled state (P2)
**Applicability:** VERIFY UNDO/REVERT FEATURES; MARK N/A IF ABSENT. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Inspect undo control with no undoable change, after one change, and after undoing everything.
2. Activate it in each state.

**Expected UI:** Enabled state matches undo stack.

**Expected runtime/storage:** No invalid operation submitted.

**Must not happen:** No disabled button fires via keyboard.

---

#### BR-UNDO-019 — Redo after branching edit (P2)
**Applicability:** VERIFY UNDO/REVERT FEATURES; MARK N/A IF ABSENT. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Make edit A, undo A, create different edit B, then try redo.

**Expected UI:** Redo stack follows normal editor semantics.

**Expected runtime/storage:** Only applicable draft/file change is redone.

**Must not happen:** Old branch A does not reappear unexpectedly.

---

#### BR-UNDO-020 — Undo/revert telemetry and audit details (P1)
**Applicability:** VERIFY UNDO/REVERT FEATURES; MARK N/A IF ABSENT. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Perform a permitted revert in test fixture.
2. Inspect operation history/audit logs.
3. Check actor, time, scope, outcome, and redacted data.

**Expected UI:** User-visible history accurately reflects operation.

**Expected runtime/storage:** Audit record identifies the correct target and outcome.

**Must not happen:** No sensitive payload leakage.

---

### Runtime

#### BR-RUN-001 — Task event sequence normal completion (P0)
**Applicability:** VERIFY RUNTIME/EVENT FEATURES. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Run deterministic task emitting start, progress, tool call/result, final delta, and completion.
2. Capture event order and UI timeline.

**Expected UI:** UI follows valid lifecycle without stuck working indicator.

**Expected runtime/storage:** Event sequence and persisted terminal status agree.

**Must not happen:** One completion per execution.

---

#### BR-RUN-002 — Completion arrives before delayed intermediate event (P0)
**Applicability:** VERIFY RUNTIME/EVENT FEATURES. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Inject completion event, then a stale progress/tool event for same run.
2. Inspect card/message state.

**Expected UI:** Completed state remains terminal or stale event is safely handled.

**Expected runtime/storage:** Monotonic transitions enforced.

**Must not happen:** No completed task returns to running.

---

#### BR-RUN-003 — Duplicate final event (P0)
**Applicability:** VERIFY RUNTIME/EVENT FEATURES. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Emit final/completed event twice for one run.
2. Inspect assistant messages, cards, and stored records.

**Expected UI:** One final answer/completion state.

**Expected runtime/storage:** Deduplication by run/event identity.

**Must not happen:** No duplicate final messages/artifacts.

---

#### BR-RUN-004 — Malformed event midway through stream (P1)
**Applicability:** VERIFY RUNTIME/EVENT FEATURES. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Send valid deltas, malformed event, then valid final event.
2. Inspect UI/log and recovery.

**Expected UI:** Malformed event is logged/handled without breaking all following events if protocol permits.

**Expected runtime/storage:** Parser state remains controlled.

**Must not happen:** No corruption or crash.

---

#### BR-RUN-005 — Unknown event type then valid event (P1)
**Applicability:** VERIFY RUNTIME/EVENT FEATURES. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Emit future/unknown event type between known events.
2. Continue stream.

**Expected UI:** Unknown type safely ignored or surfaced as diagnostic.

**Expected runtime/storage:** Known later events still processed.

**Must not happen:** No stream parser deadlock.

---

#### BR-RUN-006 — One parallel tool fails (P0)
**Applicability:** VERIFY RUNTIME/EVENT FEATURES. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Dispatch independent mock tools A/B/C.
2. Make B fail while A/C succeed.
3. Inspect final aggregation and artifact.

**Expected UI:** Partial result/failure is explicit.

**Expected runtime/storage:** Successes and failure remain individually tracked.

**Must not happen:** No aggregate success that hides essential failure.

---

#### BR-RUN-007 — Parallel tool results arrive out of order (P0)
**Applicability:** VERIFY RUNTIME/EVENT FEATURES. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Dispatch A/B/C with controlled completion order C/A/B.
2. Inspect cards, trace, and final synthesis.

**Expected UI:** Ordering follows IDs or clear timeline; no mismatched outputs.

**Expected runtime/storage:** Each response binds to invocation ID.

**Must not happen:** No result assigned by array position only.

---

#### BR-RUN-008 — Tool timeout followed by late success (P0)
**Applicability:** VERIFY RUNTIME/EVENT FEATURES. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Have a mock tool exceed its timeout, then return a late result.
2. Trigger recovery/new attempt.
3. Deliver old result after retry.

**Expected UI:** UI marks timeout and prevents stale card from replacing current state.

**Expected runtime/storage:** Attempt IDs separate outcomes.

**Must not happen:** No stale attempt overwrites successful retry.

---

#### BR-RUN-009 — Cancel while tool is queued but not started (P1)
**Applicability:** VERIFY RUNTIME/EVENT FEATURES. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Set concurrency limit low and queue a tool.
2. Cancel run before queued call begins.
3. Inspect queue and invocation count.

**Expected UI:** Task cancellation visible.

**Expected runtime/storage:** Queued call is removed/marked cancelled.

**Must not happen:** Tool does not start after cancellation.

---

#### BR-RUN-010 — Cancel after tool starts but before side effect (P0)
**Applicability:** VERIFY RUNTIME/EVENT FEATURES. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Pause mock tool before side effect.
2. Cancel task.
3. Release tool and observe cancellation token/result.

**Expected UI:** Cancellation semantics are accurate.

**Expected runtime/storage:** Tool cooperatively stops or outcome is marked uncertain.

**Must not happen:** No work continues invisibly beyond contract.

---

#### BR-RUN-011 — Cancel after side effect before result (P0)
**Applicability:** VERIFY RUNTIME/EVENT FEATURES. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Mock tool writes sentinel file then pauses before returning.
2. Cancel run.
3. Release tool and inspect file/state.

**Expected UI:** UI distinguishes task cancellation from rollback if side effect already occurred.

**Expected runtime/storage:** Side effect and status are reconciled.

**Must not happen:** No false claim that cancellation undid the write.

---

#### BR-RUN-012 — Retry running or successful task (P1)
**Applicability:** VERIFY RUNTIME/EVENT FEATURES. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Attempt Retry during running state, then on success state.
2. Inspect availability and resulting run IDs.

**Expected UI:** Retry available only when semantically valid or confirmation is clear.

**Expected runtime/storage:** Separate attempts are linked correctly.

**Must not happen:** No hidden parallel duplicate.

---

#### BR-RUN-013 — Runtime crash during stream (P0)
**Applicability:** VERIFY RUNTIME/EVENT FEATURES. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Begin streamed task with partial output.
2. Terminate only the test runtime process.
3. Observe UI, restart runtime, and recover if supported.

**Expected UI:** Error/status becomes visible; UI unblocks.

**Expected runtime/storage:** Persisted run marked interrupted or reconciled correctly.

**Must not happen:** Partial answer not marked complete.

---

#### BR-RUN-014 — Runtime ready while API is unavailable (P1)
**Applicability:** VERIFY RUNTIME/EVENT FEATURES. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Keep local runtime healthy; block cloud API.
2. Try local-only and remote actions separately.

**Expected UI:** Capabilities and failures reflect actual dependency path.

**Expected runtime/storage:** No unnecessary remote dependency for local features.

**Must not happen:** No fake agent success.

---

#### BR-RUN-015 — Two tasks share tool registry (P1)
**Applicability:** VERIFY RUNTIME/EVENT FEATURES. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Run tasks in A/B with distinct fixture tool names/arguments.
2. Complete in interleaved order.
3. Inspect execution registry and cleanup.

**Expected UI:** Each card/log belongs to correct task.

**Expected runtime/storage:** No mutable shared context leakage.

**Must not happen:** One task cannot call the other's pending tool.

---

#### BR-RUN-016 — Tool output exceeds renderer limit (P1)
**Applicability:** VERIFY RUNTIME/EVENT FEATURES. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Return very large output from a mock tool.
2. Inspect truncation/expand/download behavior.
3. Continue to final response.

**Expected UI:** UI remains responsive and communicates truncation if applied.

**Expected runtime/storage:** Full output persists or truncation policy is explicit.

**Must not happen:** No hang or silent data misrepresentation.

---

#### BR-RUN-017 — Tool returns invalid schema (P1)
**Applicability:** VERIFY RUNTIME/EVENT FEATURES. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Return missing fields/wrong types from a registered tool fixture.
2. Observe validation and recovery.

**Expected UI:** Controlled tool error displayed.

**Expected runtime/storage:** Invalid result rejected before corrupting task state.

**Must not happen:** No downstream tool receives malformed assumptions silently.

---

#### BR-RUN-018 — Task completes after app session changed (P0)
**Applicability:** VERIFY RUNTIME/EVENT FEATURES. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Start run A.
2. Switch to B and start run B.
3. Complete B then A.

**Expected UI:** Each completion updates correct history and visible status.

**Expected runtime/storage:** Run/session identifiers enforced.

**Must not happen:** No final output swaps threads.

---

#### BR-RUN-019 — Task starts after application reaches closing state (P1)
**Applicability:** VERIFY RUNTIME/EVENT FEATURES. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Begin app shutdown using supported path.
2. Race a queued user submission with shutdown.
3. Inspect run registry after relaunch.

**Expected UI:** Submission is disabled/rejected during shutdown or is safely persisted.

**Expected runtime/storage:** No orphaned untracked run.

**Must not happen:** No half-dispatched task without identity.

---

#### BR-RUN-020 — Execution status reconciliation after reconnect (P0)
**Applicability:** VERIFY RUNTIME/EVENT FEATURES. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Disconnect while task runs.
2. Set mock server state to completed, failed, or still-running before reconnect.
3. Reconnect and compare statuses across each case.

**Expected UI:** UI maps actual server status correctly.

**Expected runtime/storage:** Status query updates existing task identity.

**Must not happen:** No automatic restart of already completed work.

---

### Viewers and artifacts

#### BR-VIEW-001 — Viewer load A completes after selection changed to B (P0)
**Applicability:** VERIFY FILE FORMAT/VIEWER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Start a slow test load of file A.
2. Select file B before A finishes.
3. Let B and then A load callbacks complete.

**Expected UI:** B remains selected and displayed.

**Expected runtime/storage:** Async load completion checks current request identity.

**Must not happen:** Late A load cannot replace B.

---

#### BR-VIEW-002 — Open missing file from artifact card (P1)
**Applicability:** VERIFY FILE FORMAT/VIEWER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Create a card referencing a nonexistent path in fixture.
2. Click Open.
3. Create the file or choose recovery action.

**Expected UI:** Missing file error is clear and recoverable.

**Expected runtime/storage:** File existence is checked at open time.

**Must not happen:** No blank viewer falsely presented as content.

---

#### BR-VIEW-003 — Artifact exists but has zero bytes (P1)
**Applicability:** VERIFY FILE FORMAT/VIEWER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Generate or seed a zero-byte output.
2. Open its artifact card.
3. Retry generation.

**Expected UI:** Empty file is distinguished from loading error where appropriate.

**Expected runtime/storage:** Output validation matches file type/contract.

**Must not happen:** No claim of valid populated workbook/report.

---

#### BR-VIEW-004 — Artifact extension does not match file contents (P1)
**Applicability:** VERIFY FILE FORMAT/VIEWER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Seed JSON text with .xlsx extension and another mismatched extension.
2. Open each.

**Expected UI:** Viewer error explains invalid/corrupt format.

**Expected runtime/storage:** Parser failures are contained.

**Must not happen:** No crash or unsafe fallback execution.

---

#### BR-VIEW-005 — Viewer fails then valid file opens (P1)
**Applicability:** VERIFY FILE FORMAT/VIEWER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Open a corrupt file.
2. Close/error-dismiss viewer.
3. Open a valid different file.

**Expected UI:** Next viewer works normally after first failure.

**Expected runtime/storage:** Failed parser resources are cleaned up.

**Must not happen:** One broken file does not poison viewer state.

---

#### BR-VIEW-006 — Replace file contents externally while viewer open (P1)
**Applicability:** VERIFY FILE FORMAT/VIEWER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Open test file and record displayed content/hash.
2. Replace file externally with different content.
3. Refresh/reopen and compare.

**Expected UI:** Freshness/reload behavior is clear.

**Expected runtime/storage:** Cache invalidation matches policy.

**Must not happen:** Stale content is not silently represented as current if external changes are detected.

---

#### BR-VIEW-007 — Open same file from two sessions/projects (P1)
**Applicability:** VERIFY FILE FORMAT/VIEWER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Open similarly named files in two distinct roots.
2. Switch between references quickly.
3. Use copy path/open externally action.

**Expected UI:** Current root/path is always shown correctly.

**Expected runtime/storage:** File URIs are bound to full identity, not basename only.

**Must not happen:** No file mix-up by duplicate display name.

---

#### BR-VIEW-008 — XLSX file with formulas and multiple sheets (P1)
**Applicability:** VERIFY FILE FORMAT/VIEWER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Open a synthetic workbook with multiple sheets, formulas, blanks, and styled cells.
2. Switch sheets/scroll if supported.
3. Independently validate workbook contents.

**Expected UI:** Workbook tabs/data render within supported viewer functionality.

**Expected runtime/storage:** File remains unchanged merely by viewing.

**Must not happen:** No formula/text corruption or accidental save.

---

#### BR-VIEW-009 — CSV with millions of rows or oversized fixture (P1)
**Applicability:** VERIFY FILE FORMAT/VIEWER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Generate a representative large CSV in a disposable environment.
2. Open it and scroll/search if supported.
3. Record memory/latency and responsiveness.

**Expected UI:** Loading/progress is visible and UI stays responsive within measured target.

**Expected runtime/storage:** Virtualization/streaming path is used if intended.

**Must not happen:** No unbounded memory growth or application hang.

---

#### BR-VIEW-010 — PDF renderer with many pages (P2)
**Applicability:** VERIFY FILE FORMAT/VIEWER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Open a multi-page synthetic PDF.
2. Navigate first/middle/last pages and zoom/scroll where supported.
3. Close and reopen.

**Expected UI:** Page controls and visible page match state.

**Expected runtime/storage:** Renderer releases resources on close.

**Must not happen:** No content from prior PDF displayed.

---

#### BR-VIEW-011 — DOCX with tables and images (P2)
**Applicability:** VERIFY FILE FORMAT/VIEWER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Open a DOCX fixture with paragraphs, tables, and embedded images.
2. Inspect page/scroll behavior.
3. Open another DOCX after closing.

**Expected UI:** Supported content appears, unsupported elements degrade clearly.

**Expected runtime/storage:** Parser remains isolated by document.

**Must not happen:** No hang/crash on embedded objects.

---

#### BR-VIEW-012 — Image viewer orientation/large image (P2)
**Applicability:** VERIFY FILE FORMAT/VIEWER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Open small, large, transparent, and rotated-orientation images.
2. Resize pane and zoom if supported.

**Expected UI:** Image scales correctly and controls remain usable.

**Expected runtime/storage:** Correct file path/content used.

**Must not happen:** No excessive memory use from repeated open/close.

---

#### BR-VIEW-013 — Artifact overwritten while card is visible (P1)
**Applicability:** VERIFY FILE FORMAT/VIEWER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Generate version A of an artifact.
2. Regenerate same target as version B while its card/viewer is open.
3. Open card and inspect version/content.

**Expected UI:** Latest version versus prior version is clear.

**Expected runtime/storage:** File metadata/version/cache aligns.

**Must not happen:** Stale card cannot claim old version is new output.

---

#### BR-VIEW-014 — Artifact filename collision (P1)
**Applicability:** VERIFY FILE FORMAT/VIEWER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Run two tasks that request same filename in the same workspace.
2. Allow concurrent or sequential completion.
3. Inspect naming, card paths, and actual contents.

**Expected UI:** Collision handling/confirmation is explicit.

**Expected runtime/storage:** Writes do not overwrite unexpectedly.

**Must not happen:** No task card points to the other task output.

---

#### BR-VIEW-015 — Viewer copy path with Unicode/spaces (P2)
**Applicability:** VERIFY FILE FORMAT/VIEWER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Open file with complex path.
2. Activate Copy Path and paste into a test field.
3. Open externally if supported.

**Expected UI:** Clipboard path is accurate.

**Expected runtime/storage:** Resolved path points to intended file.

**Must not happen:** No quoting/truncation errors.

---

#### BR-VIEW-016 — Artifact path points outside current project (P0)
**Applicability:** VERIFY FILE FORMAT/VIEWER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Inject a controlled artifact reference outside workspace through test fixture.
2. Activate card actions.
3. Inspect policy enforcement.

**Expected UI:** Out-of-scope reference is blocked or clearly handled.

**Expected runtime/storage:** Path security checks apply at use time.

**Must not happen:** No unauthorized open/reveal/write.

---

#### BR-VIEW-017 — Close viewer while loading (P2)
**Applicability:** VERIFY FILE FORMAT/VIEWER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Start a deliberately slow viewer load.
2. Close viewer and open another file.
3. Let prior load finish late.

**Expected UI:** Closed viewer stays closed or retains only intended selected file.

**Expected runtime/storage:** Load cancellation or request-generation guard works.

**Must not happen:** Late callback cannot reopen stale content.

---

#### BR-VIEW-018 — Artifact action on a deleted file (P1)
**Applicability:** VERIFY FILE FORMAT/VIEWER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Create and display artifact card.
2. Delete file externally.
3. Try Open, Reveal, Copy Path, and retry actions.

**Expected UI:** Each action reports correct current file state.

**Expected runtime/storage:** File existence rechecked where appropriate.

**Must not happen:** No misleading success or stale file identity.

---

#### BR-VIEW-019 — Generated artifact valid enough to use (P0)
**Applicability:** VERIFY FILE FORMAT/VIEWER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Request synthetic artifact from deterministic agent.
2. Validate structure and meaningful contents with independent parser.
3. Open from UI and from disk.

**Expected UI:** UI and disk expose the same usable result.

**Expected runtime/storage:** Artifact finalized before success is committed.

**Must not happen:** File existence alone does not count as success.

---

#### BR-VIEW-020 — Viewer rendering while chat streams (P1)
**Applicability:** VERIFY FILE FORMAT/VIEWER FEATURE. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Open viewer for X.
2. Start task producing Y and switch X/other/Y while streaming.
3. Force late load completion.

**Expected UI:** Chat and viewer remain independently responsive.

**Expected runtime/storage:** Correct artifact/session identity retained.

**Must not happen:** No stream events hijack viewer selection.

---

### High-risk combinations

#### BR-COMB-001 — Streaming × network loss × session switch (P0)
**Applicability:** VERIFY ALL FEATURES IN COMBINATION. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Start task in A and wait for partial output.
2. Disconnect network and switch to B.
3. Reconnect while B is active; then return to A.

**Expected UI:** A shows accurate partial/recovered state; B remains isolated.

**Expected runtime/storage:** Events/status reconcile by run ID.

**Must not happen:** No stale output appears in B.

---

#### BR-COMB-002 — Approval pending × internet loss × double click (P0)
**Applicability:** VERIFY ALL FEATURES IN COMBINATION. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Raise approval card.
2. Disconnect connection.
3. Double-click approval action before and after reconnect.

**Expected UI:** Uncertain decision is indicated and reconciled.

**Expected runtime/storage:** One authorized decision and one operation maximum.

**Must not happen:** No offline approval shown as committed without confirmation.

---

#### BR-COMB-003 — Project deletion × active write × late tool result (P0)
**Applicability:** VERIFY ALL FEATURES IN COMBINATION. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Start a paused write into project A.
2. Start project removal.
3. Release delayed tool completion after chosen deletion branch.

**Expected UI:** UI consistently displays deletion/task outcome.

**Expected runtime/storage:** Target path and project identity are revalidated.

**Must not happen:** No write to unintended path or ghost project.

---

#### BR-COMB-004 — Undo × external edit × confirmation cancel (P0)
**Applicability:** VERIFY ALL FEATURES IN COMBINATION. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Agent modifies file A.
2. Externally edit A.
3. Open revert confirmation and cancel.
4. Compare file hash.

**Expected UI:** Conflict/cancel result is explicit.

**Expected runtime/storage:** No mutation on cancelled revert.

**Must not happen:** External edit preserved.

---

#### BR-COMB-005 — Auth expiry × uncertain dispatch × retry (P0)
**Applicability:** VERIFY ALL FEATURES IN COMBINATION. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Expire test token immediately after request dispatch.
2. Cause response acknowledgement to be lost.
3. Re-authenticate and recover task status.

**Expected UI:** UI prompts appropriately and reconciles uncertain task.

**Expected runtime/storage:** No duplicate execution following auth recovery.

**Must not happen:** No infinite refresh loop.

---

#### BR-COMB-006 — Viewer late load × rapid file switch × session switch (P0)
**Applicability:** VERIFY ALL FEATURES IN COMBINATION. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Begin slow viewer load in A.
2. Switch to file B, then session B.
3. Deliver A load completion.

**Expected UI:** Selected pane remains consistent with current session/file.

**Expected runtime/storage:** Load callback validates session and file generation.

**Must not happen:** No cross-session file leakage.

---

#### BR-COMB-007 — Parallel tools × one failure × artifact finalization (P0)
**Applicability:** VERIFY ALL FEATURES IN COMBINATION. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Dispatch three tools; fail one and delay another.
2. Let agent try to finalize artifact.
3. Release late tool result.

**Expected UI:** Card and artifact status reflect required dependencies.

**Expected runtime/storage:** Finalization waits or marks partial output appropriately.

**Must not happen:** No successful deliverable when a required tool failed.

---

#### BR-COMB-008 — Restart × partial artifact write × saved completion state (P0)
**Applicability:** VERIFY ALL FEATURES IN COMBINATION. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Pause write after partial bytes.
2. Force-close test app/runtime.
3. Relaunch and inspect history/file.

**Expected UI:** Incomplete output is marked incomplete or recoverable.

**Expected runtime/storage:** Atomic-write/recovery contract enforced.

**Must not happen:** Partial file not reported as completed artifact.

---

#### BR-COMB-009 — Double Send × timeout × retry (P0)
**Applicability:** VERIFY ALL FEATURES IN COMBINATION. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Send one prompt, drop acknowledgement, and double-click Retry.
2. Inspect task IDs and tool calls.

**Expected UI:** One coherent retry/pending state.

**Expected runtime/storage:** Idempotency/correlation controls duplicate requests.

**Must not happen:** No multiple executions from retry race.

---

#### BR-COMB-010 — Session deletion × offline state × relaunch (P1)
**Applicability:** VERIFY ALL FEATURES IN COMBINATION. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Disconnect network.
2. Delete a session under the actual local/offline policy.
3. Relaunch offline, then reconnect.

**Expected UI:** UI explains local versus cloud-backed deletion semantics.

**Expected runtime/storage:** Tombstone/sync behavior is consistent.

**Must not happen:** Deleted session does not reappear without documented conflict resolution.

---

#### BR-COMB-011 — Large output × pane resize × rapid scroll (P2)
**Applicability:** VERIFY ALL FEATURES IN COMBINATION. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Render large streamed text/table.
2. Resize window and repeatedly scroll chat/right viewer.
3. Switch sessions and return.

**Expected UI:** No major layout freeze or focus corruption.

**Expected runtime/storage:** Virtualization/render scheduling remains stable.

**Must not happen:** No content duplication or missed final delta.

---

#### BR-COMB-012 — Global shortcuts × modal × editor focus (P2)
**Applicability:** VERIFY ALL FEATURES IN COMBINATION. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Open modal and focus an input.
2. Press Escape, Enter, Ctrl+Z, Ctrl+A, and navigation shortcuts.
3. Repeat with composer and viewer focused.

**Expected UI:** Only expected focused control/action responds.

**Expected runtime/storage:** No unintended global operation.

**Must not happen:** Enter cannot approve/delete/send twice unexpectedly.

---

#### BR-COMB-013 — App minimize × auth expiry × background task (P1)
**Applicability:** VERIFY ALL FEATURES IN COMBINATION. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Start run and minimize app.
2. Expire test auth or force API 401.
3. Restore app and inspect status/re-auth UI.

**Expected UI:** Current state is reconciled and visible.

**Expected runtime/storage:** No lost events or duplicate run.

**Must not happen:** No silent auth loop.

---

#### BR-COMB-014 — Concurrent sessions writing same file (P0)
**Applicability:** VERIFY ALL FEATURES IN COMBINATION. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Start A and B with mock writes to same target.
2. Release writes in reverse order.
3. Inspect final file, both cards, and history.

**Expected UI:** Conflict/ordering is explicit.

**Expected runtime/storage:** Locking/versioning or conflict detection works.

**Must not happen:** No false assertion both tasks independently succeeded with expected content.

---

#### BR-COMB-015 — File missing × retry × stale artifact card (P1)
**Applicability:** VERIFY ALL FEATURES IN COMBINATION. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Create artifact, delete file externally, retry task that recreates it.
2. Deliver old and new artifact cards out of order.

**Expected UI:** Current card points to correct version/path.

**Expected runtime/storage:** Artifact version/run IDs disambiguate results.

**Must not happen:** Old missing artifact does not override new valid artifact.

---

#### BR-COMB-016 — Delete project × another session still reading it (P0)
**Applicability:** VERIFY ALL FEATURES IN COMBINATION. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Run read task in A, then request project removal while read is paused.
2. Follow safe product behavior and resume operation.

**Expected UI:** User sees block/confirmation or stable completion semantics.

**Expected runtime/storage:** Read operation and deletion are coordinated.

**Must not happen:** No use-after-delete or unrelated project fallback.

---

#### BR-COMB-017 — Card action × app shutdown (P1)
**Applicability:** VERIFY ALL FEATURES IN COMBINATION. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Open pending approval/retry card.
2. Trigger shutdown at the same time as action.
3. Relaunch and query operation status.

**Expected UI:** UI does not falsely claim a committed action if ambiguous.

**Expected runtime/storage:** Decision persists atomically or is reconciled.

**Must not happen:** No duplicate operation on restart.

---

#### BR-COMB-018 — Tool error × reconnect × retry × old late success (P0)
**Applicability:** VERIFY ALL FEATURES IN COMBINATION. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Cause timeout and expose retry.
2. Reconnect/retry successfully.
3. Deliver late success from old attempt.

**Expected UI:** Successful new run remains correct.

**Expected runtime/storage:** Attempt versioning suppresses stale result.

**Must not happen:** No stale success overrides retry lineage.

---

#### BR-COMB-019 — Malformed event × disconnect × restart (P1)
**Applicability:** VERIFY ALL FEATURES IN COMBINATION. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Inject malformed event, then disconnect stream.
2. Restart app and reconnect to history.
3. Continue with a new healthy task.

**Expected UI:** Error is contained; next task remains usable.

**Expected runtime/storage:** Parser/runtime state resets safely.

**Must not happen:** No corruption of unrelated sessions.

---

#### BR-COMB-020 — Session rename × auto-title late result × restart (P2)
**Applicability:** VERIFY ALL FEATURES IN COMBINATION. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Rename session during automatic title generation.
2. Deliver late generated title.
3. Restart and inspect persisted label.

**Expected UI:** Precedence policy is consistent.

**Expected runtime/storage:** Title version/intent retained.

**Must not happen:** Explicit user title not silently overwritten contrary to policy.

---

### Generated coverage requirements

#### BR-DISC-DISC-001 — Every discovered button gets success/error/duplicate coverage (P1)
**Applicability:** MANDATORY REPOSITORY-DERIVED EXPANSION. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Build a source + rendered UI inventory of all buttons and menu actions.
2. For each button, map effect and valid states.
3. Create one success test, one invalid/dependency failure test where relevant, and one duplicate-trigger test for state-changing actions.

**Expected UI:** Every real button maps to tests or a justified N/A.

**Expected runtime/storage:** All expected state/backend effects asserted.

**Must not happen:** No button considered covered merely because it was clicked.

---

#### BR-DISC-DISC-002 — Every discovered card type × every visible action (P0)
**Applicability:** MANDATORY REPOSITORY-DERIVED EXPANSION. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Enumerate actual card type and states from source and deterministic runtime traces.
2. For each button/action on each type, test enabled state, happy path, disabled/precondition path, duplicate/race, failure, and stale/late event as relevant.
3. Record generated child IDs in matrix.

**Expected UI:** Card labels, controls, and state-specific actions match actual runtime status.

**Expected runtime/storage:** Action targets the immutable card/run identity.

**Must not happen:** Do not assume Codex/Antigravity-specific card types exist.

---

#### BR-DISC-DISC-003 — Every registered tool × schema/error/side-effect matrix (P0)
**Applicability:** MANDATORY REPOSITORY-DERIVED EXPANSION. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Enumerate tool registry at runtime.
2. For each tool test valid minimum, representative valid, malformed args, exception/timeout, and side-effect verification where applicable.
3. Test cancellation and duplicate dispatch for state-changing tools.

**Expected UI:** Tool card and errors reflect actual outcomes.

**Expected runtime/storage:** Argument validation and result schema contract hold.

**Must not happen:** No untested registered tool hidden behind generic coverage.

---

#### BR-DISC-DISC-004 — Every file renderer × format fixture matrix (P1)
**Applicability:** MANDATORY REPOSITORY-DERIVED EXPANSION. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Enumerate extensions/renderer dispatch map.
2. For each supported extension open valid, empty, corrupt, large, missing, and changed-file fixtures as relevant.
3. Capture render result and independent content validation.

**Expected UI:** Viewer handles each supported format deliberately.

**Expected runtime/storage:** Renderer selected from trusted content/path policy.

**Must not happen:** No extension incorrectly counted as covered by another renderer.

---

#### BR-DISC-DISC-005 — Every operation × execution state matrix (P0)
**Applicability:** MANDATORY REPOSITORY-DERIVED EXPANSION. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Inventory all state-changing operations: create, rename, delete, cancel, retry, approve, reject, revert, open/write.
2. Attempt each in idle, active, terminal, and stale states where meaningful.
3. Assert allowed/disabled/rejected state.

**Expected UI:** Buttons and confirmations accurately reflect preconditions.

**Expected runtime/storage:** Invalid operation rejected at authoritative boundary.

**Must not happen:** UI disablement alone is not the only guard.

---

#### BR-DISC-DISC-006 — Every visible error card × recovery route (P1)
**Applicability:** MANDATORY REPOSITORY-DERIVED EXPANSION. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Use controlled faults to trigger each unique error-card type.
2. Exercise each visible retry/reconnect/sign-in/dismiss/details action.
3. Restore dependency and verify a healthy task after recovery.

**Expected UI:** Error text and controls match state.

**Expected runtime/storage:** Recovery reconnects to correct task/session.

**Must not happen:** Dismiss does not masquerade as recovery.

---

#### BR-DISC-DISC-007 — Every menu action via mouse and keyboard (P2)
**Applicability:** MANDATORY REPOSITORY-DERIVED EXPANSION. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Enumerate context menus, overflow menus, and dropdowns.
2. Execute each item with mouse and supported keyboard navigation.
3. Open menu then press Escape/click outside/switch window.

**Expected UI:** Menu opens, highlights, closes, and activates expected item.

**Expected runtime/storage:** No duplicate command from key event.

**Must not happen:** Focus and selected item are not stale.

---

#### BR-DISC-DISC-008 — Every persistent entity deletion boundary (P0)
**Applicability:** MANDATORY REPOSITORY-DERIVED EXPANSION. **Status:** NOT RUN.

**Preconditions:** Use isolated test profile, synthetic data, deterministic model/tool fixtures, and the actual UI.

**Steps**
1. Inventory deletion/remove/archive actions for projects, sessions, files, artifacts, and history.
2. For each, test cancel, confirm, active-use conflict, restart persistence, and external sentinel files.

**Expected UI:** Confirmation text matches actual scope.

**Expected runtime/storage:** Deletion transaction and cascade rules are verified.

**Must not happen:** No unrelated data loss.

---

## Mandatory dynamic expansion

The eight `BR-DISC-*` records are generators, not permission to stop at eight tests. The executing agent must instantiate child tests for every real control/card/tool/renderer/operation discovered in the repository. Use generated IDs such as `GEN-CARD-<TYPE>-<ACTION>-<BRANCH>` and `GEN-TOOL-<NAME>-<CASE>`, replace placeholders with real labels and source references, and put every child in the matrix. Keep the child set version-controlled and deterministic.

For every state-changing action, evaluate applicable branches: success, invalid precondition, dependency failure, timeout, duplicate trigger, cancellation, navigation interruption, lifecycle interruption, stale/late completion, and recovery. Apply the entire set to high-risk actions, and risk-based subsets to low-risk ones.