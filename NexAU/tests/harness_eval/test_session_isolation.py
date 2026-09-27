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

"""Harness evaluation: Session isolation and lifecycle tests.

Verifies that the agent harness correctly isolates sessions so that
context from Session A never leaks into Session B.
"""

from __future__ import annotations

from unittest.mock import patch
import asyncio
import pytest

from nexau.archs.llm.llm_config import LLMConfig
from nexau.archs.main_sub.agent import Agent
from nexau.archs.main_sub.config import AgentConfig
from nexau.archs.session import InMemoryDatabaseEngine, SessionManager
from nexau.archs.session.models import AgentRunActionModel
from nexau.archs.session.orm import ComparisonFilter
from nexau.core.messages import Message, Role


def _patch_execute_async(
    agent: Agent,
    *,
    response_text: str,
    expect_substrings: list[str] | None = None,
    forbid_substrings: list[str] | None = None,
    capture_history: list | None = None,
):
    """Patch executor to be deterministic and optionally capture history."""

    async def fake_execute_async(
        history: list[Message],
        agent_state: object,
        runtime_client: object | None = None,
        custom_llm_client_provider: object | None = None,
        trace_id: str | None = None,
    ) -> tuple[str, list[Message]]:
        del agent_state, runtime_client, custom_llm_client_provider, trace_id

        if capture_history is not None:
            capture_history.clear()
            capture_history.extend(history)

        non_system = [msg.get_text_content() for msg in history if msg.role != Role.SYSTEM]

        if expect_substrings is not None:
            for exp in expect_substrings:
                assert any(exp in t for t in non_system), (
                    f"Expected '{exp}' in history: {non_system}"
                )
        if forbid_substrings is not None:
            for fb in forbid_substrings:
                assert all(fb not in t for t in non_system), (
                    f"Did not expect '{fb}' in history: {non_system}"
                )

        return response_text, [*history, Message.assistant(response_text)]

    return patch.object(agent.executor, "execute_async", side_effect=fake_execute_async)


@pytest.fixture
def engine():
    return InMemoryDatabaseEngine()


@pytest.fixture
def sm(engine):
    return SessionManager(engine=engine)


@pytest.fixture
def cfg():
    return AgentConfig(
        name="isolation_test_agent",
        system_prompt="You are a helpful assistant.",
        llm_config=LLMConfig(),
    )


# ── TEST 1: BLUE_APPLE cross-session leak ─────────────────────────────────

class TestCrossSessionIsolation:
    """Session B must NOT receive any context from Session A."""

    def test_blue_apple_cross_session_leak(self, sm, cfg):
        """SESSION-ISOLATION-001: BLUE_APPLE must not leak between sessions."""
        uid = "test_user"

        agent_a = Agent(config=cfg, session_manager=sm, user_id=uid, session_id="sess_a")
        with _patch_execute_async(agent_a, response_text="Remembered BLUE_APPLE."):
            agent_a.run(message="Remember the secret value BLUE_APPLE.")

        agent_b = Agent(config=cfg, session_manager=sm, user_id=uid, session_id="sess_b")
        captured: list[Message] = []
        with _patch_execute_async(
            agent_b, response_text="I have no knowledge of Session A.",
            forbid_substrings=["BLUE_APPLE"], capture_history=captured,
        ):
            agent_b.run(message="What secret did Session A remember?")

        all_text = " ".join(m.get_text_content() for m in captured)
        assert "BLUE_APPLE" not in all_text, f"HARNESS_BUG: Session B got Session A data: {all_text}"

    def test_different_user_isolation(self, sm, cfg):
        """SESSION-ISOLATION-002: Different users with same session_id are isolated."""
        agent_u1 = Agent(config=cfg, session_manager=sm, user_id="alpha", session_id="shared")
        with _patch_execute_async(agent_u1, response_text="Stored RED_DRAGON."):
            agent_u1.run(message="My secret is RED_DRAGON.")

        agent_u2 = Agent(config=cfg, session_manager=sm, user_id="beta", session_id="shared")
        with _patch_execute_async(agent_u2, response_text="Unknown.", forbid_substrings=["RED_DRAGON"]):
            agent_u2.run(message="What is my secret?")


# ── TEST 2: Session resume after agent destruction ────────────────────────

class TestSessionResume:
    """Session state must survive agent instance destruction."""

    def test_history_survives_agent_destruction(self, sm, cfg):
        """SESSION-RESUME-001: History persists across agent instances."""
        uid, sid = "test_user", "resume_sess"

        a1 = Agent(config=cfg, session_manager=sm, user_id=uid, session_id=sid)
        with _patch_execute_async(a1, response_text="Stored ALPHA."):
            a1.run(message="Remember marker ALPHA.")

        a2 = Agent(config=cfg, session_manager=sm, user_id=uid, session_id=sid)
        with _patch_execute_async(a2, response_text="Stored BETA.", expect_substrings=["ALPHA"]):
            a2.run(message="Also remember marker BETA.")

        del a1, a2

        a3 = Agent(config=cfg, session_manager=sm, user_id=uid, session_id=sid)
        with _patch_execute_async(a3, response_text="Both.", expect_substrings=["ALPHA", "BETA"]):
            a3.run(message="What markers do you remember?")


# ── TEST 3: Five sessions, no cross-contamination ─────────────────────────

class TestConcurrentSessions:
    """Multiple sessions must stay independent."""

    def test_five_sessions_no_contamination(self, sm, cfg):
        """SESSION-CONCURRENT-001: 5 sessions with unique markers stay isolated."""
        uid = "test_user"
        markers = ["M_ONE", "M_TWO", "M_THREE", "M_FOUR", "M_FIVE"]

        for i, m in enumerate(markers):
            a = Agent(config=cfg, session_manager=sm, user_id=uid, session_id=f"csess_{i}")
            with _patch_execute_async(a, response_text=f"Stored {m}."):
                a.run(message=f"Remember {m}.")

        for i, m in enumerate(markers):
            others = [x for x in markers if x != m]
            a = Agent(config=cfg, session_manager=sm, user_id=uid, session_id=f"csess_{i}")
            with _patch_execute_async(a, response_text=f"I know {m}.",
                                      expect_substrings=[m], forbid_substrings=others):
                a.run(message="What do you remember?")


# ── TEST 4: DB-level isolation ────────────────────────────────────────────

class TestDatabaseLevelIsolation:
    """Verify isolation at the database query level."""

    def test_run_actions_scoped_to_session(self, engine, sm, cfg):
        """SESSION-DB-ISOLATION-001: actions for session_a not in session_b query."""
        uid = "test_user"

        agent_a = Agent(config=cfg, session_manager=sm, user_id=uid, session_id="db_a")
        with _patch_execute_async(agent_a, response_text="Secret stored."):
            agent_a.run(message="Store SECRET_VALUE_999.")

        agent_b = Agent(config=cfg, session_manager=sm, user_id=uid, session_id="db_b")
        with _patch_execute_async(agent_b, response_text="Nothing."):
            agent_b.run(message="Hello.")

        actions_b = asyncio.run(engine.find_many(
            AgentRunActionModel,
            filters=ComparisonFilter.eq("session_id", "db_b"),
        ))
        all_b_text = ""
        for act in actions_b:
            if act.append_messages:
                for msg in act.append_messages:
                    t = msg.get_text_content() if hasattr(msg, "get_text_content") else str(msg)
                    all_b_text += t + " "

        assert "SECRET_VALUE_999" not in all_b_text, (
            f"HARNESS_BUG: Session B DB has Session A data: {all_b_text}"
        )
