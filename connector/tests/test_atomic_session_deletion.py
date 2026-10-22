# Copyright (c) Mash. All rights reserved.
"""Tests for hardened atomic session deletion and brain cleanup across ~/.mash and ~/.nexau."""

import shutil
import tempfile
from pathlib import Path

import pytest
from app.main import app, lifespan
from app.paths import get_mash_home, get_nexau_home, safe_rmtree_session_brain
from app.services.session_lifecycle import create_new_session, delete_existing_session
from fastapi import HTTPException
import httpx
from nexau.archs.session.models import (
    AgentLockModel,
    AgentModel,
    AgentRunActionModel,
    PermissionRuleModel,
    SessionModel,
    TeamMemberModel,
    TeamMessageModel,
    TeamModel,
    TeamTaskLockModel,
    TeamTaskModel,
)
from nexau.archs.session.orm import ComparisonFilter
from sqlalchemy import text


@pytest.mark.anyio
async def test_safe_rmtree_session_brain_both_roots():
    """Verify safe_rmtree_session_brain supports both ~/.mash/brain/ and ~/.nexau/brain/ without ValueError."""
    sid = "test_rmtree_dual_root_sess"

    mash_brain = (get_mash_home() / "brain" / sid).resolve()
    nexau_brain = (Path.home() / ".nexau" / "brain" / sid).resolve()

    mash_brain.mkdir(parents=True, exist_ok=True)
    nexau_brain.mkdir(parents=True, exist_ok=True)
    (mash_brain / "mash_test.txt").write_text("mash data", encoding="utf-8")
    (nexau_brain / "nexau_test.txt").write_text("legacy nexau data", encoding="utf-8")

    assert mash_brain.exists()
    assert nexau_brain.exists()

    # Pass legacy brain_dir -> must delete without ValueError
    res = safe_rmtree_session_brain(sid, brain_dir=nexau_brain)
    assert res is True
    assert not nexau_brain.exists(), "Legacy nexau brain directory must be removed"
    assert not mash_brain.exists(), "Mash brain directory must also be removed"


@pytest.mark.anyio
async def test_safe_rmtree_session_brain_confinement_guards():
    """Verify confinement guards prevent deleting protected roots or paths outside brain roots."""
    sid = "test_confinement_sess"
    mash_home = get_mash_home().resolve()
    nexau_home = (Path.home() / ".nexau").resolve()
    mash_brain_root = (mash_home / "brain").resolve()
    nexau_brain_root = (nexau_home / "brain").resolve()

    with pytest.raises(ValueError, match=r"outside brain root|protected root directory"):
        safe_rmtree_session_brain(sid, brain_dir=mash_home)

    with pytest.raises(ValueError, match=r"outside brain root|protected root directory"):
        safe_rmtree_session_brain(sid, brain_dir=nexau_home)

    with pytest.raises(ValueError, match=r"outside brain root|protected root directory"):
        safe_rmtree_session_brain(sid, brain_dir=mash_brain_root)

    with pytest.raises(ValueError, match=r"outside brain root|protected root directory"):
        safe_rmtree_session_brain(sid, brain_dir=nexau_brain_root)

    with tempfile.TemporaryDirectory() as tmp:
        with pytest.raises(ValueError, match=r"outside brain root|protected root directory"):
            safe_rmtree_session_brain(sid, brain_dir=Path(tmp))


@pytest.mark.anyio
async def test_atomic_purge_all_tables_on_session_delete():
    """Verify that delete_existing_session purges all 10 SQLite tables in a single transaction."""
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=15.0) as client:
            res_create = await client.post("/sessions", json={"title": "Session For Atomic Delete"})
            assert res_create.status_code == 200
            sid = res_create.json()["session_id"]

            eng = app.state.engine
            async_eng = getattr(getattr(eng, "_inner", None), "_engine", None) or getattr(eng, "_engine", None)
            assert async_eng is not None

            # Seed data across tables using SQLModel models
            await eng.create(
                AgentRunActionModel(
                    action_id=f"act_{sid}",
                    session_id=sid,
                    user_id="default_user",
                    agent_id="root",
                    agent_name="main",
                    run_id=f"run_{sid}",
                    root_run_id=f"run_{sid}",
                    action_type="append",
                )
            )
            await eng.create(
                PermissionRuleModel(
                    session_id=sid,
                    user_id="default_user",
                    tool_name="shell",
                    rule_content="test",
                    behavior="allow",
                    source="config",
                )
            )
            await eng.create(
                AgentLockModel(
                    session_id=sid,
                    agent_id="root",
                    user_id="default_user",
                    holder_id=f"holder_{sid}",
                )
            )
            await eng.create(
                AgentModel(
                    session_id=sid,
                    user_id="default_user",
                    agent_id="root",
                    agent_name="main",
                )
            )
            await eng.create(
                TeamModel(
                    session_id=sid,
                    user_id="default_user",
                    team_id=f"team_{sid}",
                    leader_agent_id="root",
                )
            )
            await eng.create(
                TeamMemberModel(
                    session_id=sid,
                    user_id="default_user",
                    team_id=f"team_{sid}",
                    agent_id="root",
                    role_name="leader",
                )
            )
            await eng.create(
                TeamMessageModel(
                    session_id=sid,
                    user_id="default_user",
                    team_id=f"team_{sid}",
                    message_id=f"msg_{sid}",
                    from_agent_id="root",
                    to_agent_id="root",
                    content="hi",
                )
            )
            await eng.create(
                TeamTaskModel(
                    session_id=sid,
                    user_id="default_user",
                    team_id=f"team_{sid}",
                    task_id=f"t_{sid}",
                    title="sub",
                    status="pending",
                )
            )
            await eng.create(
                TeamTaskLockModel(
                    session_id=sid,
                    user_id="default_user",
                    team_id=f"team_{sid}",
                    task_id=f"t_{sid}",
                    holder_id="root",
                    acquired_at_ns=1000,
                    expires_at_ns=2000,
                )
            )

            # Verify rows exist
            tables = [
                "agent_run_actions",
                "permission_rules",
                "agent_locks",
                "agents",
                "teams",
                "team_members",
                "team_messages",
                "team_tasks",
                "team_task_locks",
                "sessions",
            ]
            async with async_eng.connect() as conn:
                for tbl in tables:
                    row_cnt = (await conn.execute(text(f"SELECT count(*) FROM {tbl} WHERE session_id = :sid"), {"sid": sid})).scalar()
                    assert row_cnt > 0, f"Table {tbl} must have rows seeded for session {sid}"

            # Execute atomic delete via DELETE /sessions/{sid}
            res_del = await client.delete(f"/sessions/{sid}")
            assert res_del.status_code == 200
            assert res_del.json()["status"] == "success"

            # Verify every table has 0 rows left for session_id
            async with async_eng.connect() as conn:
                for tbl in tables:
                    row_cnt = (await conn.execute(text(f"SELECT count(*) FROM {tbl} WHERE session_id = :sid"), {"sid": sid})).scalar()
                    assert row_cnt == 0, f"Table {tbl} must be purged to 0 rows after session delete"


@pytest.mark.anyio
async def test_delete_non_existent_session_404():
    """Verify deleting non-existent session returns 404."""
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=15.0) as client:
            res_del = await client.delete("/sessions/sess_doesnotexist999")
            assert res_del.status_code == 404
