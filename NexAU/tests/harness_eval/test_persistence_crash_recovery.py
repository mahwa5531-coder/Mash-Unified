# Copyright (c) Nex-AGI. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Harness evaluation: Database persistence and crash recovery tests.

Verifies that the harness persists state correctly across engine restarts
and handles partial failures without corruption.
"""

from __future__ import annotations

import asyncio
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import pytest

from nexau.archs.session import InMemoryDatabaseEngine, SessionManager
from nexau.archs.session.models import SessionModel, AgentRunActionModel
from nexau.archs.session.orm import ComparisonFilter, SQLDatabaseEngine, LoopSafeDatabaseEngine
from nexau.core.messages import Message


# ── TEST 1: Write-read roundtrip ──────────────────────────────────────────

class TestWriteReadRoundtrip:
    """Basic CRUD operations must be correct."""

    @pytest.mark.asyncio
    async def test_session_and_actions_roundtrip(self):
        """PERSISTENCE-001: Write session + 5 actions, read them back exactly."""
        engine = InMemoryDatabaseEngine()
        sm = SessionManager(engine=engine)
        await sm.setup_models()

        session = SessionModel(
            user_id="u1", session_id="s1",
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
            context={"project": "test"},
        )
        await engine.create(session)

        for i in range(5):
            action = AgentRunActionModel(
                action_id=f"act_{i}",
                user_id="u1", session_id="s1", agent_id="agent_1",
                run_id="run_1", root_run_id="run_1",
                agent_name="test_agent",
                created_at=datetime.now(timezone.utc),
                action_type="append",
                append_messages=[Message.user(f"Message {i}")],
            )
            await engine.create(action)

        # Read back
        sess = await engine.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", "s1"))
        assert sess is not None
        assert sess.user_id == "u1"
        assert sess.context == {"project": "test"}

        actions = await engine.find_many(
            AgentRunActionModel,
            filters=ComparisonFilter.eq("session_id", "s1"),
        )
        assert len(actions) == 5
        action_ids = sorted(a.action_id for a in actions)
        assert action_ids == [f"act_{i}" for i in range(5)]


# ── TEST 2: SQL restart simulation ────────────────────────────────────────

class TestSQLRestartPersistence:
    """Data must survive engine disposal and recreation (simulating restart)."""

    @pytest.mark.asyncio
    async def test_data_survives_engine_restart(self):
        """PERSISTENCE-002: Write to SQLite, dispose, reopen, verify data."""
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "test_restart.db"
            url = f"sqlite+aiosqlite:///{db_path}"

            # Phase 1: Write
            sql_eng1 = SQLDatabaseEngine.from_url(url)
            engine1 = LoopSafeDatabaseEngine(sql_eng1)
            sm1 = SessionManager(engine=engine1)
            await sm1.setup_models()

            session = SessionModel(
                user_id="u1", session_id="restart_s1",
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
                context={"marker": "RESTART_MARKER_42"},
            )
            await engine1.create(session)

            for i in range(3):
                act = AgentRunActionModel(
                    action_id=f"restart_act_{i}",
                    user_id="u1", session_id="restart_s1", agent_id="a1",
                    run_id="r1", root_run_id="r1", agent_name="test",
                    created_at=datetime.now(timezone.utc),
                    action_type="append",
                    append_messages=[Message.user(f"Turn {i}")],
                )
                await engine1.create(act)

            await sql_eng1._engine.dispose()

            # Phase 2: Reopen and verify
            sql_eng2 = SQLDatabaseEngine.from_url(url)
            engine2 = LoopSafeDatabaseEngine(sql_eng2)
            sm2 = SessionManager(engine=engine2)
            await sm2.setup_models()

            sess = await engine2.find_first(
                SessionModel, filters=ComparisonFilter.eq("session_id", "restart_s1")
            )
            assert sess is not None, "HARNESS_BUG: Session lost after restart"
            assert sess.context["marker"] == "RESTART_MARKER_42"

            acts = await engine2.find_many(
                AgentRunActionModel,
                filters=ComparisonFilter.eq("session_id", "restart_s1"),
            )
            assert len(acts) == 3, f"HARNESS_BUG: Expected 3 actions, got {len(acts)}"

            await sql_eng2._engine.dispose()


# ── TEST 3: Partial failure safety ────────────────────────────────────────

class TestPartialFailureSafety:
    """A failed write must not corrupt existing valid data."""

    @pytest.mark.asyncio
    async def test_failed_action_does_not_corrupt_session(self):
        """PERSISTENCE-003: Invalid action write must not corrupt existing session."""
        engine = InMemoryDatabaseEngine()
        sm = SessionManager(engine=engine)
        await sm.setup_models()

        # Create valid session
        session = SessionModel(
            user_id="u1", session_id="partial_s1",
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        await engine.create(session)

        # Attempt to create a duplicate session (should fail or be idempotent)
        try:
            dup = SessionModel(
                user_id="u1", session_id="partial_s1",
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            await engine.create(dup)
        except Exception:
            pass  # Expected

        # Verify original session is intact
        sess = await engine.find_first(
            SessionModel, filters=ComparisonFilter.eq("session_id", "partial_s1")
        )
        assert sess is not None, "HARNESS_BUG: Session corrupted after failed duplicate write"
        assert sess.user_id == "u1"


# ── TEST 4: Concurrent writes ─────────────────────────────────────────────

class TestConcurrentWrites:
    """Concurrent writes to the same session must all succeed."""

    @pytest.mark.asyncio
    async def test_concurrent_action_writes(self):
        """PERSISTENCE-004: 10 concurrent action writes all persist."""
        engine = InMemoryDatabaseEngine()
        sm = SessionManager(engine=engine)
        await sm.setup_models()

        session = SessionModel(
            user_id="u1", session_id="conc_s1",
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        await engine.create(session)

        async def write_action(idx: int):
            act = AgentRunActionModel(
                action_id=f"conc_act_{idx}",
                user_id="u1", session_id="conc_s1", agent_id="a1",
                run_id="r1", root_run_id="r1", agent_name="test",
                created_at=datetime.now(timezone.utc),
                action_type="append",
                append_messages=[Message.user(f"Concurrent msg {idx}")],
            )
            await engine.create(act)

        await asyncio.gather(*(write_action(i) for i in range(10)))

        actions = await engine.find_many(
            AgentRunActionModel,
            filters=ComparisonFilter.eq("session_id", "conc_s1"),
        )
        assert len(actions) == 10, f"Expected 10, got {len(actions)}"
        ids = sorted(a.action_id for a in actions)
        assert ids == [f"conc_act_{i}" for i in range(10)]
