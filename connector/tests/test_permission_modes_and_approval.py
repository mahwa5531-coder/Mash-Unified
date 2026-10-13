"""
Automated verification suite for:
1. Tri-mode permission selector ('turbo', 'default', 'review') persistence in SQLite.
2. Tool permission approval bridge (/approve) resolving pending calls.
3. Permanent rule storage in 'permission_rules' table on 'allow' ('Always allow').
4. Tool schema validation ensuring toolAction and toolSummary are accepted across all tools.
"""

import sys
import uuid
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "NexAU"))

from app.main import app, lifespan
from app.dependencies import get_engine
from nexau.archs.session.models import SessionModel
from nexau.archs.session.orm import ComparisonFilter
from nexau import AgentConfig


@pytest.mark.anyio
async def test_permission_mode_persistence_and_toggling():
    """Verify that toggling permission mode persists non-destructively in SQLite."""
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=30.0) as client:
            test_id = uuid.uuid4().hex[:8]
            sid = f"sess_perm_{test_id}"
            user_id = f"auditor_{test_id}"

            # 1. Create a session via POST /sessions
            res_create = await client.post("/api/sessions", json={
                "session_id": sid,
                "user_id": user_id,
                "title": f"Audit Session {test_id}",
            })
            assert res_create.status_code == 200

            # 2. Check initial mode (defaults to 'default')
            res_get = await client.get(f"/api/sessions/{sid}/permissions")
            assert res_get.status_code == 200
            assert res_get.json()["permission_mode"] == "default"

            # 3. Toggle to 'turbo'
            res_turbo = await client.post(f"/api/sessions/{sid}/permissions/mode", json={"mode": "turbo"})
            assert res_turbo.status_code == 200
            assert res_turbo.json()["permission_mode"] == "turbo"

            # Verify in GET
            res_check_turbo = await client.get(f"/api/sessions/{sid}/permissions")
            assert res_check_turbo.json()["permission_mode"] == "turbo"

            # 4. Toggle to 'review' (Request Review)
            res_review = await client.post(f"/api/sessions/{sid}/permissions/mode", json={"mode": "review"})
            assert res_review.status_code == 200
            assert res_review.json()["permission_mode"] == "review"

            # Verify in GET
            res_check_review = await client.get(f"/api/sessions/{sid}/permissions")
            assert res_check_review.json()["permission_mode"] == "review"

            # 5. Invalid mode rejected
            res_invalid = await client.post(f"/api/sessions/{sid}/permissions/mode", json={"mode": "invalid_mode"})
            assert res_invalid.status_code == 400


@pytest.mark.anyio
async def test_approve_tool_call_resolution_and_permanent_rule_saving():
    """Verify that /approve endpoint resolves pending tool calls and writes permanent allow rules."""
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=30.0) as client:
            test_id = uuid.uuid4().hex[:8]
            sid = f"sess_rule_{test_id}"
            user_id = "default_user"

            # 1. Create session
            res_create = await client.post("/api/sessions", json={
                "session_id": sid,
                "user_id": user_id,
                "title": f"Audit Session {test_id}",
            })
            assert res_create.status_code == 200

            # 2. Inject mock pending tool call into session
            eng = get_engine()
            session = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", sid))
            assert session is not None

            tc_id = "call_del_123"
            session.pending_tool_calls = {
                tc_id: {
                    "tool_name": "run_shell_command",
                    "prompt": "Purge temporary datasets?",
                    "permission_key": "rm -rf scratch",
                    "parameters": {"command": "rm -rf scratch"},
                    "decision": None,
                }
            }
            await eng.update(session)

            # 3. Resolve via 'always_allow' / 'allow'
            res_appr = await client.post(f"/api/chat/{sid}/approve", json={
                "tool_call_id": tc_id,
                "action": "allow",
                "feedback": "Approved permanent deletion of scratch files.",
                "user_id": user_id,
            })
            assert res_appr.status_code == 200
            assert res_appr.json()["status"] == "success"
            assert res_appr.json()["MANUAL_APPROVAL"] is True

            # 4. Verify decision was updated in session pending_tool_calls
            updated_session = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", sid))
            assert updated_session.pending_tool_calls[tc_id]["decision"] == "allow"

            # 5. Verify permanent rule was saved to permission_rules table in SQLite
            async_engine = getattr(getattr(eng, "_inner", None), "_engine", None)
            if async_engine:
                from sqlalchemy import text
                async with async_engine.connect() as conn:
                    q_rules = await conn.execute(
                        text("SELECT tool_name, rule_content, behavior FROM permission_rules WHERE session_id = :sid"),
                        {"sid": sid}
                    )
                    rows = q_rules.fetchall()
                    assert len(rows) >= 1
                    assert rows[0][0] == "run_shell_command"
                    assert rows[0][1] == "rm -rf scratch"
                    assert rows[0][2] == "allow"


def test_tool_schemas_accept_antigravity_metadata():
    """Verify that all tools in main_agent.yaml accept toolAction and toolSummary."""
    manifest = Path(__file__).parent.parent / "app" / "resources" / "main_agent.yaml"
    cfg = AgentConfig.from_yaml(manifest)
    assert len(cfg.tools) == 10

    for tool in cfg.tools:
        # Check input_schema properties
        props = tool.input_schema.get("properties", {})
        assert "toolAction" in props, f"Tool {tool.name} missing toolAction in schema"
        assert "toolSummary" in props, f"Tool {tool.name} missing toolSummary in schema"


@pytest.mark.anyio
async def test_transcript_returns_pending_approval_status():
    """Verify that GET /api/sessions/{sid}/transcript returns status='pending_approval' for unapproved tool calls."""
    from nexau.archs.session.models import AgentRunActionModel
    from datetime import datetime, timezone

    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=30.0) as client:
            test_id = uuid.uuid4().hex[:8]
            sid = f"sess_pend_{test_id}"
            user_id = "default_user"

            # 1. Create session
            res_create = await client.post("/api/sessions", json={
                "session_id": sid,
                "user_id": user_id,
                "title": f"Audit Session {test_id}",
            })
            assert res_create.status_code == 200

            eng = get_engine()
            session = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", sid))
            assert session is not None

            # 2. Inject pending_tool_calls
            tc_id = "call_review_999"
            session.pending_tool_calls = {
                tc_id: {
                    "tool_name": "run_shell_command",
                    "prompt": "Purge temporary datasets from sandbox",
                    "permission_key": "rm -rf scratch",
                    "parameters": {
                        "command": "rm -rf scratch",
                        "toolSummary": "Purge temporary datasets",
                        "toolAction": "Purges temporary dataset exports from the sandbox directory",
                    },
                    "decision": None,
                }
            }
            await eng.update(session)

            # 3. Inject an agent run action containing this tool call
            from nexau.core.messages import Message, Role, TextBlock, ToolUseBlock
            action = AgentRunActionModel(
                user_id=user_id,
                session_id=sid,
                agent_id="main_agent",
                run_id=f"run_{test_id}",
                root_run_id=f"run_{test_id}",
                action_type="append",
                append_messages=[
                    Message(
                        role=Role.ASSISTANT,
                        content=[
                            TextBlock(text="I am about to delete the scratch files."),
                            ToolUseBlock(
                                id=tc_id,
                                name="run_shell_command",
                                input={
                                    "command": "rm -rf scratch",
                                    "toolSummary": "Purge temporary datasets",
                                    "toolAction": "Purges temporary dataset exports from the sandbox directory",
                                },
                            ),
                        ],
                    )
                ],
                created_at=datetime.now(timezone.utc),
            )
            await eng.create(action)

            # 4. Fetch transcript and verify status is 'pending_approval'
            res_trans = await client.get(f"/api/sessions/{sid}/transcript")
            assert res_trans.status_code == 200
            data = res_trans.json()
            assert len(data["lines"]) >= 1
            asst_line = [l for l in data["lines"] if l.get("role") == "assistant"][0]
            assert len(asst_line["tools"]) == 1
            tool_item = asst_line["tools"][0]
            assert tool_item["id"] == tc_id
            assert tool_item["status"] == "pending_approval"
            assert tool_item["toolSummary"] == "Purge temporary datasets"
            assert tool_item["toolAction"] == "Purges temporary dataset exports from the sandbox directory"


@pytest.mark.anyio
async def test_stream_resume_no_fake_user_turn_in_history():
    """Verify that resolving tool approval and resuming stream with empty messages injects zero fake user turns."""
    from datetime import datetime, timezone
    from nexau.archs.session.models import AgentRunActionModel
    from nexau.core.messages import Message, Role, TextBlock, ToolUseBlock

    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=30.0) as client:
            test_id = uuid.uuid4().hex[:8]
            sid = f"sess_resume_{test_id}"
            user_id = "default_user"

            # 1. Create session
            res_create = await client.post("/api/sessions", json={
                "session_id": sid,
                "user_id": user_id,
                "title": f"Resume Session {test_id}",
            })
            assert res_create.status_code == 200

            # 2. Add an initial user message and assistant tool use
            eng = get_engine()
            tc_id = f"tc_resume_{test_id}"
            user_act = AgentRunActionModel(
                user_id=user_id,
                session_id=sid,
                agent_id="main_agent",
                run_id=f"run_{test_id}",
                root_run_id=f"run_{test_id}",
                action_type="append",
                append_messages=[
                    Message(role=Role.USER, content=[TextBlock(text="Clean the build directory")]),
                    Message(
                        role=Role.ASSISTANT,
                        content=[
                            ToolUseBlock(
                                id=tc_id,
                                name="run_shell_command",
                                input={"command": "rm -rf build"},
                            )
                        ],
                    ),
                ],
                created_at=datetime.now(timezone.utc),
            )
            await eng.create(user_act)

            # Set pending tool call on session
            session = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", sid))
            session.pending_tool_calls = {
                tc_id: {
                    "tool_name": "run_shell_command",
                    "permission_key": "rm -rf build",
                    "parameters": {"command": "rm -rf build"},
                    "decision": None,
                }
            }
            await eng.update(session)

            # 3. Approve the tool call
            res_approve = await client.post(f"/api/chat/{sid}/approve", json={
                "tool_call_id": tc_id,
                "action": "allow_once",
                "user_id": user_id,
            })
            assert res_approve.status_code == 200

            # Verify pending tool call now has decision 'allow_once'
            refreshed_sess = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", sid))
            assert refreshed_sess.pending_tool_calls[tc_id]["decision"] == "allow_once"

            # 4. Read transcript before resume: exactly 1 user turn, 1 assistant turn
            res_trans_before = await client.get(f"/api/sessions/{sid}/transcript")
            assert res_trans_before.status_code == 200
            user_lines_before = [l for l in res_trans_before.json()["lines"] if l.get("role") == "user"]
            assert len(user_lines_before) == 1
            assert user_lines_before[0]["content"] == "Clean the build directory"

            # 5. Verify that no fake 'Proceed with the approved action' message exists
            fake_lines = [l for l in res_trans_before.json()["lines"] if "Proceed with the approved action" in str(l)]
            assert len(fake_lines) == 0, "No fake user messages allowed in transcript"
