# Copyright (c) Nex-AGI. All rights reserved.
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
# http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Team lifecycle manager.

RFC-0002: AgentTeam 

Manages leader + teammate agents, shared task board,
message bus, and concurrent execution.
"""

from __future__ import annotations

import asyncio
import copy
import logging
from collections.abc import AsyncGenerator, Callable
from concurrent.futures import Future
from typing import TYPE_CHECKING
from uuid import uuid4

from nexau.archs.llm.llm_aggregators.events import RunErrorEvent, TeamMessageEvent, UserMessageEvent
from nexau.archs.main_sub.agent import Agent
from nexau.archs.main_sub.context_value import ContextValue
from nexau.archs.main_sub.execution.middleware.agent_events_middleware import AgentEventsMiddleware
from nexau.archs.main_sub.team.message_bus import TeamMessageBus
from nexau.archs.main_sub.team.sse.multiplexer import TeamSSEMultiplexer
from nexau.archs.main_sub.team.state import AgentTeamState
from nexau.archs.main_sub.team.task_board import TaskBoard
from nexau.archs.main_sub.team.tools import get_leader_tools, get_teammate_tools
from nexau.archs.main_sub.team.types import MaxTeammatesError, TeammateInfo
from nexau.archs.main_sub.team.watchdog import TeammateWatchdog, WatchdogConfig
from nexau.archs.sandbox import (
    BaseSandbox,
    BaseSandboxManager,
    LocalSandboxConfig,
    LocalSandboxManager,
)
from nexau.archs.session.models.team import TeamModel
from nexau.archs.session.models.team_member import TeamMemberModel
from nexau.archs.session.models.team_message import TeamMessageModel
from nexau.archs.session.models.team_task import TeamTaskModel
from nexau.archs.session.models.team_task_lock import TeamTaskLockModel
from nexau.archs.session.orm import AndFilter, ComparisonFilter
from nexau.archs.session.task_lock_service import TaskLockService

if TYPE_CHECKING:
    from nexau.archs.main_sub.config import AgentConfig
    from nexau.archs.main_sub.team.sse.envelope import TeamStreamEnvelope
    from nexau.archs.session.orm import DatabaseEngine
    from nexau.archs.session.session_manager import SessionManager

logger = logging.getLogger(__name__)


def _safe_deepcopy_config(config: AgentConfig) -> AgentConfig:
    """Deepcopy AgentConfig while preserving unpicklable fields.

    RFC-0002:  AgentConfig

    package pickle object ( tracer, 
    middleware  OpenAI client  httpx  _thread.RLock, 
    hook package),  deepcopy . 
    """
    # 1. pickle
    saved = {
        "tracers": config.tracers,
        "resolved_tracer": config.resolved_tracer,
        "middlewares": config.middlewares,
        "after_model_hooks": config.after_model_hooks,
        "after_tool_hooks": config.after_tool_hooks,
        "before_model_hooks": config.before_model_hooks,
        "before_tool_hooks": config.before_tool_hooks,
    }

    # 2. pickle
    config.tracers = []
    config.resolved_tracer = None
    config.middlewares = None
    config.after_model_hooks = None
    config.after_tool_hooks = None
    config.before_model_hooks = None
    config.before_tool_hooks = None

    # 3. deepcopy
    copied = copy.deepcopy(config)

    # 4. config config
    for field, value in saved.items():
        setattr(config, field, value)
        setattr(copied, field, value)

    return copied


class AgentTeam:
    """Team lifecycle manager.

    RFC-0002: AgentTeam 

    Manages leader + teammate agents, shared task board,
    message bus, and concurrent execution.
    """

    def __init__(
        self,
        *,
        leader_config: AgentConfig,
        candidates: dict[str, AgentConfig],
        engine: DatabaseEngine,
        session_manager: SessionManager,
        user_id: str,
        session_id: str,
        max_teammates: int = 10,
    ) -> None:
        self._leader_config = leader_config
        self._candidates = candidates
        self._engine = engine
        self._session_manager = session_manager
        self._user_id = user_id
        self._team_session_id = session_id
        self.max_teammates = max_teammates

        # Generated on initialize
        self._team_id: str = ""
        self._leader_agent_id: str = ""
        self._task_board: TaskBoard | None = None
        self._message_bus: TeamMessageBus | None = None
        self._watchdog: TeammateWatchdog | None = None

        # Shared sandbox manager for all agents in the team
        self._shared_sandbox_manager: BaseSandboxManager[BaseSandbox] | None = None

        # Teammate tracking
        self._teammate_agents: dict[str, Agent] = {}
        self._teammate_futures: dict[str, Future[None]] = {}
        self._role_counters: dict[str, int] = {}
        self._errored_agents: set[str] = set()  # agent_ids that exited with error

        # Leader agent reference (set in run)
        self._leader_agent: Agent | None = None

        # Main event loop reference (set in run, used by spawn_teammate)
        self._loop: asyncio.AbstractEventLoop | None = None

        # SSE multiplexer (set in run when on_event is provided)
        self._multiplexer: TeamSSEMultiplexer | None = None

        # Run lifecycle tracking (for SSE reconnection support)
        self._is_running: bool = False
        self._on_run_complete: Callable[[], None] | None = None

        # Context variables for template rendering, runtime vars, and sandbox env
        self._variables: ContextValue | None = None

    @property
    def team_id(self) -> str:
        """Team identifier."""
        return self._team_id

    @property
    def leader_agent_id(self) -> str:
        """Leader agent identifier."""
        return self._leader_agent_id

    @property
    def task_board(self) -> TaskBoard:
        """Shared task board."""
        if self._task_board is None:
            raise RuntimeError("AgentTeam not initialized. Call initialize() first.")
        return self._task_board

    @property
    def message_bus(self) -> TeamMessageBus:
        """Team message bus."""
        if self._message_bus is None:
            raise RuntimeError("AgentTeam not initialized. Call initialize() first.")
        return self._message_bus

    @property
    def is_running(self) -> bool:
        """Whether the team is currently executing a run."""
        return self._is_running

    def set_on_complete(self, callback: Callable[[], None]) -> None:
        """Set callback invoked when the team run completes.

        Used by HTTP transport to clean up registry after run finishes,
        even if the SSE consumer has disconnected.
        """
        self._on_run_complete = callback

    async def initialize(self) -> None:
        """Initialize or restore team state.

        RFC-0002: 

        Steps:
        1. Setup database models
        2. Create or restore team record
        3. Create shared services (TaskBoard, MessageBus, Watchdog)
        4. Restore existing teammate counters

        Idempotent: safe to call multiple times.
        """
        if self._task_board is not None:
            return

        # 1.
        await self._engine.setup_models(
            [
                TeamModel,
                TeamMemberModel,
                TeamTaskModel,
                TeamTaskLockModel,
                TeamMessageModel,
            ]
        )

        # 2.
        self._team_id = f"team-{uuid4().hex[:8]}"
        self._leader_agent_id = "leader"

        existing = await self._engine.find_first(
            TeamModel,
            filters=AndFilter(
                filters=[
                    ComparisonFilter.eq("user_id", self._user_id),
                    ComparisonFilter.eq("session_id", self._team_session_id),
                ]
            ),
        )
        if existing is not None:
            self._team_id = existing.team_id
            self._leader_agent_id = existing.leader_agent_id
            logger.info(f"Restored team: {self._team_id}")
        else:
            team = TeamModel(
                user_id=self._user_id,
                session_id=self._team_session_id,
                team_id=self._team_id,
                leader_agent_id=self._leader_agent_id,
                candidates={k: v.name or k for k, v in self._candidates.items()},
                max_teammates=self.max_teammates,
            )
            await self._engine.create(team)
            logger.info(f"Created team: {self._team_id}")

        # 3.
        task_lock = TaskLockService(engine=self._engine)
        self._task_board = TaskBoard(
            engine=self._engine,
            task_lock_service=task_lock,
            user_id=self._user_id,
            session_id=self._team_session_id,
            team_id=self._team_id,
        )
        self._message_bus = TeamMessageBus(
            engine=self._engine,
            user_id=self._user_id,
            session_id=self._team_session_id,
            team_id=self._team_id,
        )
        self._message_bus.set_agent_delivery(
            deliver_message=self.send_message_to_agent,
            get_broadcast_recipients=lambda: [info.agent_id for info in self.get_teammate_info()],
        )
        self._watchdog = TeammateWatchdog(
            config=WatchdogConfig(),
            check_all_idle=self.is_all_idle,
            notify_leader=self.notify_leader,
        )

        # 4. teammate
        existing_members = await self._engine.find_many(
            TeamMemberModel,
            filters=AndFilter(
                filters=[
                    ComparisonFilter.eq("user_id", self._user_id),
                    ComparisonFilter.eq("session_id", self._team_session_id),
                    ComparisonFilter.eq("team_id", self._team_id),
                ]
            ),
        )
        for member in existing_members:
            if member.status != "stopped":
                current = self._role_counters.get(member.role_name, 0)
                self._role_counters[member.role_name] = current + 1

    async def spawn_teammate(self, role_name: str) -> str:
        """Spawn a new teammate instance and start it in forever-run mode.

        RFC-0002:  Teammate 

        Args:
            role_name: Role name from candidates dict.

        Returns:
            agent_id of the spawned teammate.

        Raises:
            MaxTeammatesError: If max_teammates limit reached.
            ValueError: If role_name not in candidates.
        """
        if len(self._teammate_agents) >= self.max_teammates:
            raise MaxTeammatesError(f"Max teammates limit reached ({self.max_teammates})")

        if role_name not in self._candidates:
            raise ValueError(f"Unknown role: {role_name}")

        # 1. ID
        count = self._role_counters.get(role_name, 0) + 1
        self._role_counters[role_name] = count
        agent_id = f"{role_name}-{count}"

        # 2. teammate session_id
        agent_session_id = f"{self._team_session_id}:{agent_id}"

        # 3. teammate ( session_id)
        member = TeamMemberModel(
            user_id=self._user_id,
            session_id=self._team_session_id,
            team_id=self._team_id,
            agent_id=agent_id,
            member_session_id=agent_session_id,
            role_name=role_name,
            status="idle",
        )
        await self._engine.create(member)

        # 4. team teammate system prompt (deepcopy config)
        # skills / middlewares object, teammate
        # candidate config, spawn.
        config = _safe_deepcopy_config(self._candidates[role_name])
        # teammate tools deepcopy config ( candidate config)
        config.tools = list(config.tools) + get_teammate_tools()
        teammate_lines: list[str] = []
        for aid, a in self._teammate_agents.items():
            future = self._teammate_futures.get(aid)
            status = "running" if future and not future.done() else "idle"
            name = a.config.name or aid
            teammate_lines.append(f"- `{aid}` (role={name}, status={status})")
        team_context = (
            "\n\n# Team Context\n\n"
            f"your_agent_id: {agent_id}\n"
            f"team_id: {self._team_id}\n"
            f"leader_agent_id: {self._leader_agent_id}\n\n"
            "Active teammates:\n"
            + ("\n".join(teammate_lines) if teammate_lines else "- (none yet)")
            + "\n\nUse `list_teammates` and `list_tasks` to get latest status."
        )
        if config.system_prompt:
            config.system_prompt_suffix = team_context
        else:
            config.system_prompt = team_context.lstrip()

        # 5a. SSE middleware ( multiplexer )
        if self._multiplexer is not None:
            handler = self._multiplexer.create_event_handler(agent_id=agent_id, role_name=role_name)
            mw = AgentEventsMiddleware(session_id=agent_session_id, on_event=handler)
            # list, candidate config middlewares
            # (_safe_deepcopy_config pickle )
            config.middlewares = [*(config.middlewares or []), mw]
            if config.llm_config:
                config.llm_config.stream = True

        # 6. teammate Agent ( session, team_state)
        # Agent.create async factory async context
        # sync Agent ( running event loop RuntimeError) .
        teammate_team_state = AgentTeamState(
            team=self,
            task_board=self.task_board,
            message_bus=self.message_bus,
            is_leader=False,
        )
        agent = await Agent.create(
            agent_id=agent_id,
            config=config,
            session_manager=self._session_manager,
            user_id=self._user_id,
            session_id=agent_session_id,
            is_root=False,
            team_state=teammate_team_state,
            sandbox_manager=self._shared_sandbox_manager,
            variables=self._variables,
        )
        self._teammate_agents[agent_id] = agent

        # 7. teammate
        # spawn_teammate async method, teammate
        # run_coroutine_threadsafe .
        if self._loop is None:
            raise RuntimeError("AgentTeam._loop not set. Call run() first.")
        teammate_future = asyncio.run_coroutine_threadsafe(
            self._run_teammate_forever(agent_id),
            self._loop,
        )
        self._teammate_futures[agent_id] = teammate_future

        logger.info(f"Spawned teammate: {agent_id} (role={role_name})")
        return agent_id

    async def remove_teammate(self, agent_id: str) -> None:
        """Remove a teammate instance.

        RFC-0002:  Teammate 

        Force-stops the agent's executor to break the forever-run loop,
        then cancels the asyncio.Task as safety net.
        """
        agent = self._teammate_agents.pop(agent_id, None)

        # 1. Force-stop executor
        if agent is not None:
            agent.executor.force_stop()

        # 2. cancel Future
        future = self._teammate_futures.pop(agent_id, None)
        if future is not None and not future.done():
            future.cancel()
            try:
                future.result(timeout=5)
            except (Exception,):
                pass

        # 3. DB
        member = await self._engine.find_first(
            TeamMemberModel,
            filters=AndFilter(
                filters=[
                    ComparisonFilter.eq("user_id", self._user_id),
                    ComparisonFilter.eq("session_id", self._team_session_id),
                    ComparisonFilter.eq("team_id", self._team_id),
                    ComparisonFilter.eq("agent_id", agent_id),
                ]
            ),
        )
        if member is not None:
            member.status = "stopped"
            await self._engine.update(member)

        # 4. watchdog
        if self._watchdog is not None:
            self._watchdog.unregister(agent_id)

        logger.info(f"Removed teammate: {agent_id}")

    def get_teammate_info(self) -> list[TeammateInfo]:
        """List all teammates and their status.

        RFC-0002:  Teammate list

         executor.is_idle,  future.done(). 
        executor  team_mode  tool call  idle, 
         future,  agent . 
        """
        results: list[TeammateInfo] = []
        for agent_id, agent in self._teammate_agents.items():
            future = self._teammate_futures.get(agent_id)
            # agent → error
            if agent_id in self._errored_agents:
                status = "error"
            # future executor idle → idle
            elif future is None or future.done() or agent.executor.is_idle:
                status = "idle"
            else:
                status = "running"
            results.append(
                TeammateInfo(
                    agent_id=agent_id,
                    role_name=agent.config.name or agent_id,
                    status=status,
                )
            )
        return results

    def enqueue_user_message(self, to_agent_id: str, content: str) -> None:
        """Enqueue a user message to a specific agent.

        RFC-0002:  agent 

         send_message_to_agent, method role=user, 
         stream  agent . 
        """
        msg = {"role": "user", "content": content}

        # 1. SSE
        if self._multiplexer is not None:
            self._multiplexer.emit(
                agent_id=to_agent_id,
                event=UserMessageEvent(to_agent_id=to_agent_id, content=content),
                role_name="user",
            )

        # 2. agent
        if to_agent_id == self._leader_agent_id:
            if self._leader_agent is not None:
                self._leader_agent.enqueue_message(msg)
                logger.info("Enqueued user message to leader")
            else:
                logger.warning("Cannot enqueue user message: leader agent not set")
        else:
            agent = self._teammate_agents.get(to_agent_id)
            if agent is not None:
                agent.enqueue_message(msg)
                logger.info(f"Enqueued user message to {to_agent_id}")

                # RFC-0002: teammate executor
                future = self._teammate_futures.get(to_agent_id)
                if future is not None and future.done() and self._loop is not None:
                    logger.info(f"Restarting exited teammate for user message: {to_agent_id}")
                    new_future = asyncio.run_coroutine_threadsafe(
                        self._run_teammate_forever(to_agent_id),
                        self._loop,
                    )
                    self._teammate_futures[to_agent_id] = new_future
            else:
                logger.warning(f"Cannot enqueue user message to unknown agent: {to_agent_id}")

    def send_message_to_agent(
        self,
        to_agent_id: str,
        content: str,
        from_agent_id: str,
    ) -> None:
        """Enqueue a message to a teammate or leader agent.

        RFC-0002:  teammate  leader 

         executor.enqueue_message, 
        executor  _message_available . 
        """
        enqueue_text = f"[Team Message from {from_agent_id}]: {content}"
        msg = {"role": "user", "content": enqueue_text}

        # 0. watchdog, leader
        if from_agent_id != "watchdog" and self._watchdog is not None:
            self._watchdog.reset_idle_notification()

        # 1. SSE
        if self._multiplexer is not None:
            self._multiplexer.emit(
                agent_id=to_agent_id,
                event=TeamMessageEvent(
                    from_agent_id=from_agent_id,
                    to_agent_id=to_agent_id,
                    content=content,
                ),
            )

        # 2. agent
        if to_agent_id == self._leader_agent_id:
            if self._leader_agent is not None:
                self._leader_agent.enqueue_message(msg)
                logger.info(f"Enqueued message to leader from {from_agent_id}")
            else:
                logger.warning("Cannot send message to leader: leader agent not set")
        else:
            agent = self._teammate_agents.get(to_agent_id)
            if agent is not None:
                agent.enqueue_message(msg)
                logger.info(f"Enqueued message to {to_agent_id} from {from_agent_id}")

                # 3. teammate executor (idle timeout)
                future = self._teammate_futures.get(to_agent_id)
                if future is not None and future.done() and self._loop is not None:
                    logger.info(f"Restarting exited teammate: {to_agent_id}")
                    new_future = asyncio.run_coroutine_threadsafe(
                        self._run_teammate_forever(to_agent_id),
                        self._loop,
                    )
                    self._teammate_futures[to_agent_id] = new_future
            else:
                logger.warning(f"Cannot send message to unknown agent: {to_agent_id}")

    def notify_leader(self, content: str, from_agent_id: str) -> None:
        """Send a notification message to the leader agent.

        RFC-0002:  leader agent

        completed, idle,  enqueue_message  leader. 
        """
        self.send_message_to_agent(
            to_agent_id=self._leader_agent_id,
            content=content,
            from_agent_id=from_agent_id,
        )

    def is_all_idle(self) -> bool:
        """Check if all agents (leader + teammates) are idle.

        RFC-0002:  agent 

        Returns True when leader and all teammates are in the executor's
        team_mode wait loop. Used by watchdog for deadlock detection.

        Note: agents waiting for user response (ask_user) are excluded -
        they are idle but not "stuck", so we should not wake the leader.
        """
        # 1. leader
        if self._leader_agent is not None:
            if not self._leader_agent.executor.is_idle:
                return False
            # leader
            if self._leader_agent.executor.is_waiting_for_user:
                return False
        else:
            return False  # leader, all-idle

        # 2. teammate
        for agent in self._teammate_agents.values():
            if not agent.executor.is_idle:
                return False
            # ask_user idle, agent
            if agent.executor.is_waiting_for_user:
                return False

        return True

    async def _run_teammate_forever(self, agent_id: str) -> None:
        """Run teammate in forever-run mode. Exits only on force_stop.

        RFC-0002:  Teammate Agent

        Agent  executor  team_mode, 
         force_stop() . 
        """
        agent = self._teammate_agents.get(agent_id)
        if agent is None:
            return

        # DB running, error
        await self._update_member_status(agent_id, "running")
        self._errored_agents.discard(agent_id)

        # watchdog
        if self._watchdog is not None:
            self._watchdog.register(agent_id)

        try:
            # RFC-0002: teammate idle
            await agent.run_async(message=[], variables=self._variables)
            logger.info(f"Teammate {agent_id} exited normally")
            await self._update_member_status(agent_id, "idle")
        except Exception as e:
            logger.error(f"Teammate {agent_id} exited with error: {e}")
            self._errored_agents.add(agent_id)
            # 1. SSE error stream
            if self._multiplexer is not None:
                role_name = agent.config.name or agent_id
                self._multiplexer.emit(
                    agent_id=agent_id,
                    event=RunErrorEvent(
                        run_id=agent_id,
                        message=str(e),
                    ),
                    role_name=role_name,
                )
            # 2. DB error ( idle)
            await self._update_member_status(agent_id, "error")
        finally:
            if self._watchdog is not None:
                self._watchdog.unregister(agent_id)

    async def stop_all_teammates(self) -> None:
        """Force-stop all running teammates.

        RFC-0002: running Teammate

         teammate  executor,  Future completed, 
        . DB  ( idle), 
         run()  _restore_teammates() . 
        """
        # 1. Force-stop teammate executor
        stopped_ids = list(self._teammate_agents.keys())
        for agent in self._teammate_agents.values():
            agent.executor.force_stop()

        # 2. Future completed
        for future in self._teammate_futures.values():
            if not future.done():
                try:
                    await asyncio.wait_for(asyncio.wrap_future(future), timeout=10)
                except (TimeoutError, asyncio.CancelledError, Exception):
                    future.cancel()

        # 3. DB idle, agent lock
        for agent_id in stopped_ids:
            await self._update_member_status(agent_id, "idle")
            teammate_session_id = f"{self._team_session_id}:{agent_id}"
            await self._session_manager.agent_lock.force_release(
                session_id=teammate_session_id,
                agent_id=agent_id,
            )

        # 4. (DB, run )
        self._teammate_agents.clear()
        self._teammate_futures.clear()

    async def _restore_teammates(self) -> None:
        """Restore previously spawned teammates from DB.

        RFC-0002:  spawn  teammate

         DB  stopped  teammate, 
         Agent . 
        Agent  session . 
        """
        existing_members = await self._engine.find_many(
            TeamMemberModel,
            filters=AndFilter(
                filters=[
                    ComparisonFilter.eq("user_id", self._user_id),
                    ComparisonFilter.eq("session_id", self._team_session_id),
                    ComparisonFilter.eq("team_id", self._team_id),
                ]
            ),
        )

        for member in existing_members:
            # teammate
            if member.status == "stopped":
                continue
            if member.agent_id in self._teammate_agents:
                continue

            role_name = member.role_name
            if role_name not in self._candidates:
                logger.warning(f"Cannot restore {member.agent_id}: unknown role {role_name}")
                continue

            agent_id = member.agent_id
            agent_session_id = member.member_session_id

            # 1. config team (deepcopy candidate config)
            config = _safe_deepcopy_config(self._candidates[role_name])
            # teammate tools deepcopy config ( candidate config)
            config.tools = list(config.tools) + get_teammate_tools()
            team_context = (
                "\n\n# Team Context\n\n"
                f"your_agent_id: {agent_id}\n"
                f"team_id: {self._team_id}\n"
                f"leader_agent_id: {self._leader_agent_id}\n\n"
                "Use `list_teammates` and `list_tasks` to get latest status."
            )
            if config.system_prompt:
                config.system_prompt_suffix = team_context
            else:
                config.system_prompt = team_context.lstrip()

            # 2. SSE middleware ( multiplexer )
            if self._multiplexer is not None:
                handler = self._multiplexer.create_event_handler(agent_id=agent_id, role_name=role_name)
                mw = AgentEventsMiddleware(session_id=agent_session_id, on_event=handler)
                # list, candidate config middlewares
                config.middlewares = [*(config.middlewares or []), mw]
                if config.llm_config:
                    config.llm_config.stream = True

            # 3. Agent (session )
            # Agent.create async factory async context
            # sync Agent ( running event loop RuntimeError) .
            teammate_team_state = AgentTeamState(
                team=self,
                task_board=self.task_board,
                message_bus=self.message_bus,
                is_leader=False,
            )
            agent = await Agent.create(
                agent_id=agent_id,
                config=config,
                session_manager=self._session_manager,
                user_id=self._user_id,
                session_id=agent_session_id,
                is_root=False,
                team_state=teammate_team_state,
                sandbox_manager=self._shared_sandbox_manager,
                variables=self._variables,
            )
            self._teammate_agents[agent_id] = agent

            # 4.
            if self._loop is None:
                raise RuntimeError("AgentTeam._loop not set. Call run() first.")
            teammate_future = asyncio.run_coroutine_threadsafe(
                self._run_teammate_forever(agent_id),
                self._loop,
            )
            self._teammate_futures[agent_id] = teammate_future

            logger.info(f"Restored teammate: {agent_id} (role={role_name})")

    async def stop_all(self) -> None:
        """Force-stop the leader and all running teammates.

        RFC-0002:  Team

         Stop method,  leader  teammate . 
         leader  agent lock,  run . 
        """
        # 1. leader
        if self._leader_agent is not None:
            self._leader_agent.executor.force_stop()

        # 2. teammates
        await self.stop_all_teammates()

        # 3. leader lock ( run_async )
        leader_session_id = f"{self._team_session_id}:leader"
        await self._session_manager.agent_lock.force_release(
            session_id=leader_session_id,
            agent_id=self._leader_agent_id,
        )

        # 4. watchdog
        if self._watchdog is not None:
            self._watchdog.stop()

    async def _update_member_status(self, agent_id: str, status: str) -> None:
        """Update teammate member status in DB.

        RFC-0002:  Teammate 
        """
        try:
            member = await self._engine.find_first(
                TeamMemberModel,
                filters=AndFilter(
                    filters=[
                        ComparisonFilter.eq("user_id", self._user_id),
                        ComparisonFilter.eq("session_id", self._team_session_id),
                        ComparisonFilter.eq("team_id", self._team_id),
                        ComparisonFilter.eq("agent_id", agent_id),
                    ]
                ),
            )
            if member is not None:
                member.status = status
                await self._engine.update(member)
        except Exception as e:
            logger.warning(f"Failed to update member status for {agent_id}: {e}")

    async def run(
        self,
        message: str,
        variables: ContextValue | None = None,
    ) -> str:
        """Run the team with the leader agent in forever-run mode.

        RFC-0002:  () 
        RFC-0014: 

        Leader agent  team_mode,  finish_team stop tool. 
        Teammate agents  spawn_teammate, . 
         enqueue_message . 

        SSE  self._multiplexer: 
        -  self._multiplexer  ( run_streaming() ), 
           leader  teammate  AgentEventsMiddleware. 
        -  self._multiplexer  None, middleware. 

        Args:
            message: User message to send to the leader.
            variables: Optional ContextValue with structured runtime parameters
                (template vars for Jinja2 rendering, runtime_vars, sandbox_env).
                Applied to leader and all teammates.

        Returns:
            Leader agent response string.

        Raises:
            RuntimeError: If team is already running (concurrent call protection).
        """
        # RFC-0014: run, leader lock
        if self._is_running:
            raise RuntimeError("Team is already running. Use enqueue_user_message() for follow-up messages.")

        await self.initialize()

        # , spawn_teammate
        self._loop = asyncio.get_running_loop()
        self._is_running = True

        # variables, leader spawn teammate
        if variables is not None:
            self._variables = variables

        # 1. watchdog
        watchdog_task: asyncio.Task[None] | None = None
        if self._watchdog is not None:
            watchdog_task = asyncio.create_task(self._watchdog.run())

        try:
            # 2. candidate leader system prompt (deepcopy config)
            leader_config = _safe_deepcopy_config(self._leader_config)
            # team tools deepcopy leader config ( config)
            leader_config.tools = list(leader_config.tools) + get_leader_tools()
            candidate_lines = [f"- `{name}`: {cfg.description or cfg.name or name}" for name, cfg in self._candidates.items()]
            team_context = (
                "\n\n# Team Context\n\n"
                f"team_id: {self._team_id}\n"
                f"max_teammates: {self.max_teammates}\n\n"
                "Available candidate roles for `spawn_teammate`:\n"
                + "\n".join(candidate_lines)
                + "\n\nYou MUST call `finish_team` when done."
                + "\nFor simple messages that don't need team work,"
                + " first output a text reply to the user, then call `finish_team`."
                + "\nIMPORTANT: Always output a text response BEFORE calling `finish_team`."
                + " The `finish_team` summary is internal only and will NOT be shown to the user."
            )
            if leader_config.system_prompt:
                leader_config.system_prompt_suffix = team_context
            else:
                leader_config.system_prompt = team_context.lstrip()

            # 3. finish_team stop tool
            if leader_config.stop_tools is None:
                leader_config.stop_tools = set()
            leader_config.stop_tools.add("finish_team")

            # 3a. SSE middleware ( multiplexer )
            leader_session_id = f"{self._team_session_id}:leader"
            if self._multiplexer is not None:
                leader_handler = self._multiplexer.create_event_handler(agent_id=self._leader_agent_id, role_name="leader")
                leader_mw = AgentEventsMiddleware(session_id=leader_session_id, on_event=leader_handler)
                # list, leader config middlewares
                leader_config.middlewares = [*(leader_config.middlewares or []), leader_mw]
                if leader_config.llm_config:
                    leader_config.llm_config.stream = True

            # 4. sandbox manager ( agent sandbox )
            if self._shared_sandbox_manager is None:
                leader_sandbox_config = leader_config.sandbox_config
                if leader_sandbox_config is None:
                    leader_sandbox_config = LocalSandboxConfig()
                self._shared_sandbox_manager = LocalSandboxManager(
                    work_dir=leader_sandbox_config.work_dir,
                )
                self._shared_sandbox_manager.prepare_session_context(
                    session_manager=self._session_manager,
                    user_id=self._user_id,
                    session_id=self._team_session_id,
                    sandbox_config=leader_sandbox_config,
                )

            # 5. team_state leader agent ( session)
            # Agent.create async factory async context
            # sync Agent ( running event loop RuntimeError) .
            leader_team_state = AgentTeamState(
                team=self,
                task_board=self.task_board,
                message_bus=self.message_bus,
                is_leader=True,
            )
            leader = await Agent.create(
                agent_id=self._leader_agent_id,
                config=leader_config,
                session_manager=self._session_manager,
                user_id=self._user_id,
                session_id=leader_session_id,
                team_state=leader_team_state,
                sandbox_manager=self._shared_sandbox_manager,
            )
            self._leader_agent = leader

            # RFC-0002: leader executor teammate
            # teammate nudge, _wait_for_messages.
            leader.executor.has_active_teammates = lambda: len(self._teammate_agents) > 0

            # 5. spawn teammate ( DB, Agent )
            await self._restore_teammates()

            # 6. SSE
            if self._multiplexer is not None:
                self._multiplexer.emit(
                    agent_id=self._leader_agent_id,
                    event=UserMessageEvent(to_agent_id=self._leader_agent_id, content=message),
                    role_name="user",
                )

            # 7. Leader team_mode, finish_team
            raw = await leader.run_async(message=message, variables=self._variables)
            result = raw[0] if isinstance(raw, tuple) else raw

            return result
        finally:
            # 8. watchdog, teammate
            if watchdog_task is not None:
                watchdog_task.cancel()
                try:
                    await watchdog_task
                except asyncio.CancelledError:
                    pass

            # 9. Leader, teammate
            await self.stop_all_teammates()

            # 9a. sandbox
            if self._shared_sandbox_manager is not None:
                self._shared_sandbox_manager.on_run_complete()
                leader_sandbox_cfg = self._leader_config.sandbox_config
                status_after_run = leader_sandbox_cfg.status_after_run if leader_sandbox_cfg else "stop"
                if status_after_run == "pause":
                    self._shared_sandbox_manager.pause_no_wait()
                elif status_after_run == "stop":
                    self._shared_sandbox_manager.stop()

            # 10. SSE multiplexer
            if self._multiplexer is not None:
                self._multiplexer.close()
                self._multiplexer = None

            # 11., completed ( SSE )
            self._is_running = False
            if self._on_run_complete is not None:
                try:
                    self._on_run_complete()
                except Exception:
                    logger.warning("on_run_complete callback failed", exc_info=True)

    async def run_streaming(
        self,
        message: str,
        on_envelope: Callable[[TeamStreamEnvelope], None] | None = None,
        variables: ContextValue | None = None,
    ) -> AsyncGenerator[TeamStreamEnvelope, None]:
        """Run team with SSE streaming output.

        RFC-0002: Team SSE 

         TeamSSEMultiplexer,  team, 
         async generator  TeamStreamEnvelope . 

        Args:
            message: User message to send to the leader.
            on_envelope: Optional callback invoked for each envelope (e.g. for persistence).
            variables: Optional ContextValue with structured runtime parameters
                (template vars for Jinja2 rendering, runtime_vars, sandbox_env).
                Applied to leader and all teammates.

        Yields:
            TeamStreamEnvelope events from all agents.
        """
        # 1. team_id
        await self.initialize()

        # 2. multiplexer self (run self._multiplexer)
        multiplexer = TeamSSEMultiplexer(team_id=self._team_id, on_envelope=on_envelope)
        self._multiplexer = multiplexer

        # 3. team (run self._multiplexer middleware)
        run_task: asyncio.Task[str] = asyncio.create_task(self.run(message, variables=variables))

        try:
            # 4. envelope
            async for envelope in multiplexer.stream():
                yield envelope

            # 5. run_task completed, exception
            await run_task
        except Exception:
            multiplexer.close()
            raise
        finally:
            # 6. SSE cancel run_task, team
            # on_envelope EventStore
            # /team/subscribe .
            # run finally multiplexer on_run_complete.
            pass