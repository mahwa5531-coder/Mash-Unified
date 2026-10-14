# Mandatory Feature-Change Coverage Gate for the Desktop Agent Application

## Purpose

The baseline and branch-expansion catalogues are NOT a promise of complete coverage. This policy makes the test inventory evolve whenever the repository changes. It applies to every new feature, modified feature, bug fix, refactor with behavior risk, tool addition, event/schema change, UI control, viewer, agent mode, and storage operation.

The test agent must not assume that existing scenario IDs cover a feature just because the feature belongs to an existing category.

## 1. Required living artefacts

Maintain these artefacts in the actual application repository, following its established conventions:

- `qa/FEATURE_INVENTORY.yaml`: machine-readable features, screens, controls, modes, tools, event types, storage entities, file renderers, API/client boundaries, permissions, and state transitions.
- `qa/FEATURE_TEST_MAP.csv`: maps every feature/control/operation to scenario IDs, automation level, owner, priority, and status.
- `qa/STATE_TRANSITIONS.md`: actual runtime, session, project, task, tool, streaming, card, and viewer state transitions.
- `qa/FEATURE_CHANGE_IMPACT.md`: updated on each feature-relevant change.
- `qa/coverage/`: automated coverage or inventory snapshots where appropriate.

Do not create duplicate artefacts if equivalent maintained files already exist; extend the existing source of truth.

## 2. On every code change

Before declaring a change complete or release-ready:

1. Inspect the Git diff against the relevant base branch or previous revision. If Git metadata is unavailable, inspect changed files and ask for the intended change scope only if required; proceed with repository analysis meanwhile.
2. Classify every changed file into one or more areas: frontend/UI, navigation/state, composer/input, cards/actions, agent/runtime, tools, event/streaming protocol, persistence/storage/migrations, filesystem/artifacts, viewer/rendering, API/network/auth, settings/configuration, security/permissions, packaging/updater, or test infrastructure.
3. Trace the changed symbols to their callers, callees, UI entry points, state stores, events, storage writes, filesystem effects, and downstream rendering.
4. Identify existing scenarios affected by the change and new scenarios required. A refactor still needs regression coverage if behavior or interfaces might change.
5. Add or update the feature inventory and feature-to-test map.
6. Implement tests before marking the change complete. Do not substitute a list of proposed tests for executed tests.
7. Run the new tests, impacted tests, and the appropriate regression suite. Run packaged-app tests for changes that can behave differently in the packaged build.
8. Report exactly what was mapped, added, executed, passed, failed, flaky, blocked, and not run.

## 3. Mandatory branch template for each new or materially changed feature

Adapt applicability to the actual feature. For each applicable dimension below, create a named scenario or explicitly document why it does not apply:

### A. Normal behavior
- Minimum valid use.
- Typical use.
- Repeated normal use.
- User-visible success result.
- Correct underlying state/runtime/storage/filesystem effect.

### B. Input and validation
- Empty, missing, malformed, unsupported, and invalid input.
- Boundary values and unusually large input.
- Unicode, whitespace, long names, and special characters where meaningful.
- Validation feedback and focus behavior.

### C. UI and interaction
- Entry through every UI path that exposes the feature.
- Button/menu/card states: visible, enabled, disabled, loading, success, error.
- Keyboard and accessibility interaction.
- Double-click, rapid repeat, duplicate submission, and re-entry.
- Navigation away and back while the operation is pending.

### D. Agent/runtime/tool integration
- Correct prompt/input and context delivered.
- Correct task/session/project IDs and correlation of events.
- Tool success, tool error, invalid arguments, missing tool, timeout, cancellation, and late result where applicable.
- Sequential and parallel interactions where supported.
- Correct final answer, intermediate cards/events, and tool-result rendering.

### E. Networking and external dependencies
- Slow dependency, unavailable dependency, disconnect, timeout, rate limiting, authorization failure, server error, and recovery where applicable.
- Ambiguous outcome: the request might have reached the server even if the client did not receive its response.
- Retry idempotency and duplicate-side-effect prevention.

### F. State and persistence
- Create/read/update/delete as applicable.
- State retained after navigation, session switch, and app restart where promised.
- Failure during a write or transition.
- Concurrent update, stale result, and deleted/renamed parent object.
- No cross-session/project contamination, orphaned records, or unrelated data loss.

### G. Recovery and reversibility
- Cancel, undo, revert, retry, dismiss, reopen, and resume only where the product implements them.
- Verify both visible state and underlying persisted/filesystem state.
- Confirm that irreversible actions are not falsely presented as reversible.

### H. Performance, scale, security
- Repeated use and memory/resource stability.
- Large inputs or collections where relevant.
- Permission boundaries, unsafe content, and sensitive-data logging where relevant.
- Test only applicable risks, with a documented rationale for omissions.

### I. Regression
- Existing related workflows still pass.
- Feature behaves correctly alongside other active sessions/tasks.
- Packaged-build and migration compatibility are verified if the change affects those areas.

## 4. Special generation rules by changed code type

- **New frontend component/control:** inventory every interactive state and action; test semantics, accessibility, loading/empty/error states, validation, repeated interaction, navigation away/back, and the effect on state/runtime. Every action button must be linked to an assertion.
- **New card type or card action:** discover all variants and all buttons/menu items; test action enabled/disabled rules, success/error states, duplicate activation, stale card state, session association, and rendering of long/partial/malformed content.
- **New agent mode or runtime state:** add valid and invalid state transitions, event ordering, cancellation, tool calls, retries, late events, finalization, and persistence tests.
- **New tool:** derive tests from its real schema and implementation; validate success, invalid/missing arguments, permissions, side effects, errors, timeouts, cancellation, repetition, concurrency, and output handling.
- **New event or stream message:** test parsing across arbitrary chunk boundaries, empty/malformed payloads, unknown event types, duplicates, order/correlation, interruption, reconnection, and UI rendering.
- **New session/project operation:** test success, duplicates, conflict, invalid target, active-task behavior, parent-child effects, restart persistence, failure recovery, and data isolation.
- **New file format/viewer:** test valid, empty, corrupt, oversized, inaccessible, missing, renamed, replaced, and Unicode-path cases; verify content, responsiveness, close/reopen, and packaged dependencies.
- **New API/client behavior:** test the actual client contract and relevant HTTP/network failures with deterministic fixtures; verify timeouts, request cancellation, idempotency, auth expiry, and error mapping.
- **New database field/table/migration:** test fresh install, upgrade from the prior supported schema, data preservation, interrupted migration recovery, and rollback strategy where available.
- **New shortcut/menu action:** test focus contexts, conflicts, accessibility, disabled states, repeated input, and the correct targeted object.
- **New packaging/configuration/updater behavior:** test clean installation, upgrade, interrupted update, startup, data preservation, and recovery in an isolated environment.

## 5. Inventory completeness checks

The test agent must compare all available sources of truth, not rely on a single scan:

- UI/accessibility tree and rendered interaction inventory.
- Frontend routes, components, event handlers, and state stores.
- Backend/runtime entry points and state machines.
- Registered tool names, schemas, handlers, and permission rules.
- Event types and message schemas.
- API/client endpoints and error mappings.
- Persisted entities, migrations, and filesystem operations.
- File viewer/renderer registrations and feature flags/configuration.
- User-facing settings, shortcuts, cards, and context menus.

Reconcile differences. Source-defined controls that are unreachable, and visible controls that cannot be mapped to implementation, must be reported as findings.

Static code scanning alone cannot establish runtime behavior; screenshots alone cannot establish backend side effects. Use both code-path inspection and executed assertions.

## 6. Required coverage gates

Do not report a feature as fully covered unless:

1. Its inventory entry exists and points to the actual implementation.
2. Its normal path has an executed passing test.
3. All relevant failure and boundary branches have tests or documented, evidence-backed non-applicability reasons.
4. UI actions are linked to visible-effect and underlying-effect assertions.
5. State/persistence behavior has been tested where applicable.
6. Impacted regression tests have executed.
7. Test results distinguish PASS, FAIL, FLAKY, BLOCKED, NOT RUN, and N/A.

A release/build must not silently pass when a changed feature has no test mapping. Make CI fail or require an explicit, reviewed waiver for missing feature coverage. Waivers must state the reason, owner, risk, and expiration/review point; they must never be silently generated by the same agent that introduced the code.

## 7. Future-feature prompt for the coding agent

Add this instruction to every development task that implements a new feature:

"Before finishing, inspect the complete feature change and update the QA inventory and feature-to-test map. Enumerate every new or changed control, operation, state, event, tool, persistence effect, file effect, and error path. Add executable tests for the happy path, invalid/boundary inputs, repeated action, relevant concurrency, dependency failure, cancellation/recovery, persistence, and related regression. Run the tests. Report any untested dimension as BLOCKED, NOT RUN, or an evidence-backed N/A. Do not claim that new functionality is covered by the existing catalogue unless you have mapped and executed the relevant tests."

## 8. Honest limit

No finite scenario list can automatically anticipate every future bug or every possible combination. This gate makes newly introduced features visible and forces test coverage to grow with the code, while state-transition testing, combinatorial testing, fault injection, exploratory testing, and real packaged-app runs cover interactions that static inventories cannot predict.
