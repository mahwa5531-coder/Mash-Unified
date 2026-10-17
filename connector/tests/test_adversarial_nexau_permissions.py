"""Adversarial stress test suite for native NexAU tool permissions and approval flow.

Empirically tests:
1. Tool shallow copying & immutability: apply_permission_mode_to_tools across
   'turbo', 'review', and 'default' modes without mutating original instances.
2. Native SessionManager delegation: init_session_permissions calls
   init_permission_rules_from_config and executes ZERO raw eng.delete(PermissionRuleModel, ...) queries.
3. Preemptive steering: handle_preemptive_steer marks undecided pending calls
   as 'deny' with user prompt feedback, preventing PendingPermissionsError.
4. Approval resolution & permanent rule persistence: 'allow' / 'always_allow'
   saves permanent user rules in SQLite permission_rules table and updates session.
5. Fuzzy tool call ID matching: exact raw ID, run_-prefixed target ID, run_-prefixed
   pending key, and single-item default (None / empty string).
"""

from __future__ import annotations

import ast
import copy
from datetime import UTC, datetime
from pathlib import Path
import sys
from types import SimpleNamespace
from typing import Any
import uuid

import pytest

# Ensure connector and NexAU are importable
CONNECTOR_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = CONNECTOR_DIR.parent
if str(CONNECTOR_DIR) not in sys.path:
    sys.path.insert(0, str(CONNECTOR_DIR))
if str(PROJECT_ROOT / "NexAU") not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT / "NexAU"))

from app.dependencies import get_engine, get_session_manager
from app.main import app, lifespan
from app.services.chat_permissions import (
    SENSITIVE_TOOLS,
    apply_permission_mode_to_tools,
    get_session_permission_mode,
    handle_preemptive_steer,
    has_pending_undecided_tool_calls,
    init_session_permissions,
    resolve_tool_approval,
)
from nexau.archs.main_sub.config.schema import ToolConfigEntry
from nexau.archs.session.models import SessionModel
from nexau.archs.session.models.permission_rule import PermissionRuleModel
from nexau.archs.session.orm import AndFilter, ComparisonFilter


# ==============================================================================
# 1. Tool Shallow Copying & Immutability Verification
# ==============================================================================

class CustomMockTool:
    def __init__(self, name: str, permissions: dict[str, Any] | None = None, extra_field: str = "keep"):
        self.name = name
        self.permissions = permissions
        self.extra_field = extra_field


def _build_test_tools() -> list[Any]:
    return [
        ToolConfigEntry(
            name="run_shell_command",
            yaml_path="/dummy/run_shell_command.tool.yaml",
            permissions={"allow": ["echo hello"], "deny": ["rm *"]},
        ),
        ToolConfigEntry(
            name="write_file",
            yaml_path="/dummy/write_file.tool.yaml",
            permissions={"allow": ["safe.txt"], "deny": []},
        ),
        ToolConfigEntry(
            name="read_file",
            yaml_path="/dummy/read_file.tool.yaml",
            permissions={"allow": ["read.txt"], "deny": []},
        ),
        CustomMockTool(
            name="web_fetch",
            permissions={"allow": ["https://safe.test"], "deny": ["https://malicious.test"]},
            extra_field="sensitive_mock",
        ),
        CustomMockTool(
            name="search_files",
            permissions={"allow": ["src/*"], "deny": []},
            extra_field="readonly_mock",
        ),
    ]


def test_tool_shallow_copying_turbo_mode():
    """Verify turbo mode applies allow-all without mutating original tool instances."""
    original_tools = _build_test_tools()
    orig_snapshots = [
        {"name": t.name, "perms": copy.deepcopy(getattr(t, "permissions", None))}
        for t in original_tools
    ]

    configured = apply_permission_mode_to_tools(original_tools, "turbo")

    # Assert new list
    assert configured is not original_tools
    assert len(configured) == len(original_tools)

    # Assert each item is a distinct instance
    for i, (orig, cloned) in enumerate(zip(original_tools, configured, strict=True)):
        assert cloned is not orig, f"Tool {orig.name} was not cloned!"
        assert cloned.permissions == {"allow": ["**"], "deny": []}
        # Original tool permissions MUST NOT be mutated
        assert orig.permissions == orig_snapshots[i]["perms"], (
            f"Original tool {orig.name} was mutated: expected {orig_snapshots[i]['perms']}, got {orig.permissions}"
        )


def test_tool_shallow_copying_review_mode():
    """Verify review mode applies ask-all without mutating original tool instances."""
    original_tools = _build_test_tools()
    orig_snapshots = [
        {"name": t.name, "perms": copy.deepcopy(getattr(t, "permissions", None))}
        for t in original_tools
    ]

    configured = apply_permission_mode_to_tools(original_tools, "review")

    assert configured is not original_tools
    for i, (orig, cloned) in enumerate(zip(original_tools, configured, strict=True)):
        assert cloned is not orig
        assert cloned.permissions == {"allow": [], "deny": []}
        assert orig.permissions == orig_snapshots[i]["perms"]


def test_tool_shallow_copying_default_mode():
    """Verify default mode discriminates sensitive vs read-only tools without mutation."""
    original_tools = _build_test_tools()
    orig_snapshots = [
        {"name": t.name, "perms": copy.deepcopy(getattr(t, "permissions", None))}
        for t in original_tools
    ]

    configured = apply_permission_mode_to_tools(original_tools, "default")

    assert configured is not original_tools
    for i, (orig, cloned) in enumerate(zip(original_tools, configured, strict=True)):
        assert cloned is not orig
        assert orig.permissions == orig_snapshots[i]["perms"]

        if orig.name in SENSITIVE_TOOLS:
            assert cloned.permissions == {"allow": [], "deny": []}, f"Sensitive tool {orig.name} not gated"
        else:
            assert cloned.permissions == {"allow": ["**"], "deny": []}, f"Safe tool {orig.name} not auto-allowed"


@pytest.mark.parametrize("mode_variant", ["  TURBO  ", "TuRbO", "REVIEW", "  Default  ", None, "", "unknown_mode"])
def test_tool_shallow_copying_mode_edge_cases(mode_variant: str | None):
    """Verify whitespace, casing, None, and unknown modes fail-safe to valid permission mappings."""
    original_tools = _build_test_tools()
    orig_perms_before = [copy.deepcopy(t.permissions) for t in original_tools]

    configured = apply_permission_mode_to_tools(original_tools, mode_variant)

    assert len(configured) == len(original_tools)
    for orig, cloned, perms_before in zip(original_tools, configured, orig_perms_before, strict=True):
        assert cloned is not orig
        assert orig.permissions == perms_before

        clean = (mode_variant or "default").strip().lower()
        if clean == "turbo":
            assert cloned.permissions == {"allow": ["**"], "deny": []}
        elif clean == "review":
            assert cloned.permissions == {"allow": [], "deny": []}
        else:
            if orig.name in SENSITIVE_TOOLS:
                assert cloned.permissions == {"allow": [], "deny": []}
            else:
                assert cloned.permissions == {"allow": ["**"], "deny": []}


def test_tool_shallow_copying_empty_list():
    """Verify empty list edge case."""
    assert apply_permission_mode_to_tools([], "turbo") == []
    assert apply_permission_mode_to_tools(None, "default") == []


# ==============================================================================
# 2. Native SessionManager Delegation & Zero Raw Deletes
# ==============================================================================

def test_static_code_audit_zero_raw_permission_deletes():
    """Verify that chat.py and chat_permissions.py contain zero PermissionRuleModel deletes or imports."""
    services_file = CONNECTOR_DIR / "app" / "services" / "chat_permissions.py"
    router_file = CONNECTOR_DIR / "app" / "routers" / "chat.py"

    for target in [services_file, router_file]:
        code = target.read_text(encoding="utf-8")
        parsed = ast.parse(code, filename=str(target))

        # Check imports: PermissionRuleModel must NEVER be imported
        for node in ast.walk(parsed):
            if isinstance(node, ast.ImportFrom):
                for alias in node.names:
                    assert alias.name != "PermissionRuleModel", (
                        f"Forbidden import of PermissionRuleModel in {target.name}:{node.lineno}"
                    )
            elif isinstance(node, ast.Name):
                assert node.id != "PermissionRuleModel", (
                    f"Forbidden reference to PermissionRuleModel in {target.name}:{node.lineno}"
                )

        assert "delete_many" not in code
        assert "eng.delete(PermissionRuleModel" not in code
        assert "engine.delete(PermissionRuleModel" not in code


@pytest.mark.anyio
async def test_init_session_permissions_delegates_to_sm_native():
    """Verify init_session_permissions directly calls sm.init_permission_rules_from_config with 0 engine deletes."""
    class EngineSpy:
        def __init__(self):
            self.delete_calls = []

        async def delete(self, model: Any, filters: Any = None):
            self.delete_calls.append((model, filters))

    class MockSessionManager:
        def __init__(self, engine_spy: EngineSpy):
            self.engine_spy = engine_spy
            self.delegated_calls = []

        async def init_permission_rules_from_config(self, *, user_id: str, session_id: str, tools: list[Any]):
            self.delegated_calls.append({
                "user_id": user_id,
                "session_id": session_id,
                "tools": tools,
            })

    engine_spy = EngineSpy()
    mock_sm = MockSessionManager(engine_spy)
    test_tools = _build_test_tools()

    await init_session_permissions(
        sm=mock_sm,
        user_id="auditor_user",
        session_id="sess_native_test",
        tools=test_tools,
        mode="turbo",
    )

    # 1. Assert exactly 1 delegated call occurred
    assert len(mock_sm.delegated_calls) == 1
    call = mock_sm.delegated_calls[0]
    assert call["user_id"] == "auditor_user"
    assert call["session_id"] == "sess_native_test"
    assert len(call["tools"]) == len(test_tools)
    assert all(t.permissions == {"allow": ["**"], "deny": []} for t in call["tools"])

    # 2. Assert zero raw database engine delete calls
    assert len(engine_spy.delete_calls) == 0


@pytest.mark.anyio
async def test_init_session_permissions_real_sqlite_persistence():
    """Verify init_session_permissions actually stores config rules in SQLite without delete errors."""
    async with lifespan(app):
        eng = get_engine()
        sm = get_session_manager()
        assert sm is not None and eng is not None

        test_id = uuid.uuid4().hex[:8]
        sid = f"sess_real_perm_{test_id}"
        uid = f"user_{test_id}"

        # Create session in SQLite
        sess = SessionModel(
            session_id=sid,
            user_id=uid,
            title=f"Native Perm Session {test_id}",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        await eng.create(sess)

        test_tools = [
            ToolConfigEntry(name="read_file", yaml_path="/read.yaml", permissions={"allow": ["**"], "deny": []}),
            ToolConfigEntry(name="run_shell_command", yaml_path="/sh.yaml", permissions={"allow": [], "deny": []}),
        ]

        # Call init_session_permissions
        await init_session_permissions(
            sm=sm,
            user_id=uid,
            session_id=sid,
            tools=test_tools,
            mode="turbo",
        )

        # Inspect SQLite table permission_rules
        rules = await eng.find_many(
            PermissionRuleModel,
            filters=AndFilter(filters=[
                ComparisonFilter.eq("user_id", uid),
                ComparisonFilter.eq("session_id", sid),
                ComparisonFilter.eq("source", "config"),
            ]),
        )
        assert len(rules) >= 2
        assert all(r.behavior == "allow" for r in rules)
        assert all(r.rule_content == "**" for r in rules)


# ==============================================================================
# 3. Preemptive Steering Stress Testing
# ==============================================================================

@pytest.mark.anyio
async def test_handle_preemptive_steer_auto_denies_undecided_calls():
    """Verify handle_preemptive_steer marks undecided calls as deny with prompt feedback."""
    class FakeSM:
        def __init__(self, pending: dict[str, Any]):
            self._pending = pending
            self.updated = False

        async def get_pending_tool_calls(self, *, user_id: str, session_id: str):
            return copy.deepcopy(self._pending)

        async def update_pending_tool_calls(self, *, user_id: str, session_id: str, pending_tool_calls: Any):
            self._pending = pending_tool_calls
            self.updated = True

    initial_pending = {
        "call_undecided_1": {
            "tool_name": "run_shell_command",
            "permission_key": "rm -rf build",
            "decision": None,
        },
        "call_already_allowed": {
            "tool_name": "read_file",
            "permission_key": "src/main.py",
            "decision": "allow",
            "feedback": "Preserve existing decision",
        },
        "call_undecided_2": {
            "tool_name": "write_file",
            "permission_key": "out.txt",
            "decision": None,
        },
    }

    fakesm = FakeSM(initial_pending)
    steer_prompt = "Never mind, do NOT build or write anything! Check git status."

    handled = await handle_preemptive_steer(
        sm=fakesm,
        user_id="steer_user",
        session_id="sess_steer_1",
        user_prompt=steer_prompt,
    )

    assert handled is True
    assert fakesm.updated is True
    updated = fakesm._pending

    # Undecided calls must be marked 'deny' with feedback
    assert updated["call_undecided_1"]["decision"] == "deny"
    assert steer_prompt in updated["call_undecided_1"]["feedback"]

    assert updated["call_undecided_2"]["decision"] == "deny"
    assert steer_prompt in updated["call_undecided_2"]["feedback"]

    # Pre-decided call MUST NOT be altered
    assert updated["call_already_allowed"]["decision"] == "allow"
    assert updated["call_already_allowed"]["feedback"] == "Preserve existing decision"


@pytest.mark.anyio
async def test_handle_preemptive_steer_no_op_when_all_decided():
    """Verify handle_preemptive_steer returns False when no calls are undecided."""
    class FakeSM:
        def __init__(self, pending: dict[str, Any]):
            self._pending = pending
            self.updated = False

        async def get_pending_tool_calls(self, *, user_id: str, session_id: str):
            return self._pending

        async def update_pending_tool_calls(self, *, user_id: str, session_id: str, pending_tool_calls: Any):
            self.updated = True

    initial_pending = {
        "call_1": {"decision": "allow"},
        "call_2": {"decision": "deny"},
    }

    fakesm = FakeSM(initial_pending)
    handled = await handle_preemptive_steer(
        sm=fakesm,
        user_id="steer_user",
        session_id="sess_steer_noop",
        user_prompt="Some user prompt",
    )

    assert handled is False
    assert fakesm.updated is False


@pytest.mark.anyio
@pytest.mark.parametrize("invalid_prompt", ["", "   ", "\t\n", None])
async def test_handle_preemptive_steer_blank_prompt_is_no_op(invalid_prompt: str | None):
    """Verify whitespace or empty steer prompts do not trigger auto-denial."""
    class FakeSM:
        async def get_pending_tool_calls(self, *, user_id: str, session_id: str):
            return {"call_1": {"decision": None}}

        async def update_pending_tool_calls(self, **kwargs):
            raise AssertionError("Should not be called")

    fakesm = FakeSM()
    handled = await handle_preemptive_steer(
        sm=fakesm,
        user_id="steer_user",
        session_id="sess_steer_blank",
        user_prompt=invalid_prompt,
    )
    assert handled is False


@pytest.mark.anyio
async def test_handle_preemptive_steer_exception_resilience():
    """Verify handle_preemptive_steer logs error and returns False if SM raises an exception."""
    class BrokenSM:
        async def get_pending_tool_calls(self, **kwargs):
            raise RuntimeError("Database disconnected")

    handled = await handle_preemptive_steer(
        sm=BrokenSM(),
        user_id="steer_user",
        session_id="sess_err",
        user_prompt="Some prompt",
    )
    assert handled is False


# ==============================================================================
# 4. Approval Resolution & Permanent Rule Persistence
# ==============================================================================

@pytest.mark.anyio
async def test_resolve_tool_approval_allow_writes_permanent_rule():
    """Verify 'allow' and 'always_allow' write permanent rule to SQLite and update pending_tool_calls."""
    async with lifespan(app):
        eng = get_engine()
        sm = get_session_manager()
        assert sm is not None and eng is not None

        test_id = uuid.uuid4().hex[:8]
        sid = f"sess_appr_perm_{test_id}"
        uid = f"auditor_{test_id}"

        # 1. Create session
        sess = SessionModel(
            session_id=sid,
            user_id=uid,
            title=f"Approval Test {test_id}",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
            pending_tool_calls={
                "call_shell_perm": {
                    "tool_name": "run_shell_command",
                    "permission_key": "pytest -v",
                    "decision": None,
                }
            },
        )
        await eng.create(sess)

        # 2. Resolve with action="always_allow"
        res = await resolve_tool_approval(
            sm=sm,
            user_id=uid,
            session_id=sid,
            tool_call_id="call_shell_perm",
            action="always_allow",
            feedback="Granted permanent access",
        )

        assert res["status"] == "success"
        assert res["MANUAL_APPROVAL"] is True
        assert res["action"] == "always_allow"
        assert res["tool_call_id"] == "call_shell_perm"

        # 3. Verify session pending_tool_calls updated
        refreshed_sess = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", sid))
        assert refreshed_sess.pending_tool_calls["call_shell_perm"]["decision"] == "allow"
        assert refreshed_sess.pending_tool_calls["call_shell_perm"]["feedback"] == "Granted permanent access"

        # 4. Verify permanent rule saved in SQLite permission_rules
        rules = await eng.find_many(
            PermissionRuleModel,
            filters=AndFilter(filters=[
                ComparisonFilter.eq("user_id", uid),
                ComparisonFilter.eq("session_id", sid),
                ComparisonFilter.eq("source", "user"),
                ComparisonFilter.eq("tool_name", "run_shell_command"),
            ]),
        )
        assert len(rules) == 1
        assert rules[0].rule_content == "pytest -v"
        assert rules[0].behavior == "allow"


@pytest.mark.anyio
@pytest.mark.parametrize("non_permanent_action,expected_decision", [
    ("allow_once", "allow_once"),
    ("proceed", "allow_once"),
    ("deny", "deny"),
    ("reject", "deny"),
])
async def test_resolve_tool_approval_non_permanent_actions_do_not_write_rules(
    non_permanent_action: str, expected_decision: str
):
    """Verify 'allow_once', 'proceed', 'deny', and 'reject' do NOT write permanent rules to SQLite."""
    async with lifespan(app):
        eng = get_engine()
        sm = get_session_manager()

        test_id = uuid.uuid4().hex[:8]
        sid = f"sess_appr_temp_{test_id}"
        uid = f"auditor_{test_id}"
        tc_id = f"tc_{test_id}"

        sess = SessionModel(
            session_id=sid,
            user_id=uid,
            title="Non-permanent Test",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
            pending_tool_calls={
                tc_id: {
                    "tool_name": "write_file",
                    "permission_key": "config.json",
                    "decision": None,
                }
            },
        )
        await eng.create(sess)

        res = await resolve_tool_approval(
            sm=sm,
            user_id=uid,
            session_id=sid,
            tool_call_id=tc_id,
            action=non_permanent_action,
        )

        assert res["status"] == "success"
        refreshed_sess = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", sid))
        assert refreshed_sess.pending_tool_calls[tc_id]["decision"] == expected_decision

        # ZERO user permission rules should exist in SQLite
        rules = await eng.find_many(
            PermissionRuleModel,
            filters=AndFilter(filters=[
                ComparisonFilter.eq("user_id", uid),
                ComparisonFilter.eq("session_id", sid),
                ComparisonFilter.eq("source", "user"),
            ]),
        )
        assert len(rules) == 0


# ==============================================================================
# 5. Fuzzy Tool Call ID Matching
# ==============================================================================

@pytest.mark.anyio
async def test_fuzzy_matching_exact_id():
    """Verify exact tool_call_id matches."""
    class FakeSM:
        def __init__(self):
            self.pending = {"call_exact_123": {"decision": None, "tool_name": "t"}}
        async def get_pending_tool_calls(self, **kwargs):
            return self.pending
        async def update_pending_tool_calls(self, pending_tool_calls, **kwargs):
            self.pending = pending_tool_calls

    sm = FakeSM()
    res = await resolve_tool_approval(sm, "u", "s", tool_call_id="call_exact_123", action="allow_once")
    assert res["tool_call_id"] == "call_exact_123"
    assert sm.pending["call_exact_123"]["decision"] == "allow_once"


@pytest.mark.anyio
async def test_fuzzy_matching_run_prefixed_target_id():
    """Verify target_tc_id with 'run_xyz_' prefix matches raw key in pending."""
    class FakeSM:
        def __init__(self):
            self.pending = {"call_target_999": {"decision": None, "tool_name": "t"}}
        async def get_pending_tool_calls(self, **kwargs):
            return self.pending
        async def update_pending_tool_calls(self, pending_tool_calls, **kwargs):
            self.pending = pending_tool_calls

    sm = FakeSM()
    # User / SSE sends prefixed ID: run_batch1_call_target_999
    res = await resolve_tool_approval(sm, "u", "s", tool_call_id="run_batch1_call_target_999", action="allow_once")
    assert res["tool_call_id"] == "call_target_999"
    assert sm.pending["call_target_999"]["decision"] == "allow_once"


@pytest.mark.anyio
async def test_fuzzy_matching_run_prefixed_pending_key():
    """Verify target_tc_id raw matches run_-prefixed key in pending."""
    class FakeSM:
        def __init__(self):
            self.pending = {"run_batch1_call_target_888": {"decision": None, "tool_name": "t"}}
        async def get_pending_tool_calls(self, **kwargs):
            return self.pending
        async def update_pending_tool_calls(self, pending_tool_calls, **kwargs):
            self.pending = pending_tool_calls

    sm = FakeSM()
    res = await resolve_tool_approval(sm, "u", "s", tool_call_id="call_target_888", action="allow_once")
    assert res["tool_call_id"] == "run_batch1_call_target_888"
    assert sm.pending["run_batch1_call_target_888"]["decision"] == "allow_once"


@pytest.mark.anyio
@pytest.mark.parametrize("omitted_id", [None, ""])
async def test_fuzzy_matching_single_item_default(omitted_id: str | None):
    """Verify omitted tool_call_id resolves to the single pending item when len(pending) == 1."""
    class FakeSM:
        def __init__(self):
            self.pending = {"call_only_one": {"decision": None, "tool_name": "t"}}
        async def get_pending_tool_calls(self, **kwargs):
            return self.pending
        async def update_pending_tool_calls(self, pending_tool_calls, **kwargs):
            self.pending = pending_tool_calls

    sm = FakeSM()
    res = await resolve_tool_approval(sm, "u", "s", tool_call_id=omitted_id, action="allow_once")
    assert res["tool_call_id"] == "call_only_one"
    assert sm.pending["call_only_one"]["decision"] == "allow_once"


@pytest.mark.anyio
async def test_fuzzy_matching_multiple_items_non_matching_id_is_safe():
    """Verify non-matching ID with multiple items does not corrupt pending items."""
    class FakeSM:
        def __init__(self):
            self.pending = {
                "call_1": {"decision": None, "tool_name": "t1"},
                "call_2": {"decision": None, "tool_name": "t2"},
            }
        async def get_pending_tool_calls(self, **kwargs):
            return self.pending
        async def update_pending_tool_calls(self, pending_tool_calls, **kwargs):
            self.pending = pending_tool_calls

    sm = FakeSM()
    res = await resolve_tool_approval(sm, "u", "s", tool_call_id="call_nonexistent", action="allow_once")
    assert res["tool_call_id"] == "call_nonexistent"
    # Neither call should be updated
    assert sm.pending["call_1"]["decision"] is None
    assert sm.pending["call_2"]["decision"] is None


@pytest.mark.anyio
async def test_resolve_tool_approval_empty_pending():
    """Verify empty pending returns clean success with detail message."""
    class FakeSM:
        async def get_pending_tool_calls(self, **kwargs):
            return {}

    sm = FakeSM()
    res = await resolve_tool_approval(sm, "u", "s", tool_call_id="call_1", action="allow_once")
    assert res["status"] == "success"
    assert res["detail"] == "No pending tool calls to resolve"


# ==============================================================================
# 6. Standalone Script Runner
# ==============================================================================

if __name__ == "__main__":
    sys.exit(pytest.main(["-v", "-s", __file__]))
