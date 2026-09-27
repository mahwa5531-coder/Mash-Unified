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

"""Team HTTP endpoints.

RFC-0002: AgentTeam HTTP API

Provides endpoints for team lifecycle management, task operations,
and multi-agent SSE streaming.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncGenerator, Callable
from dataclasses import asdict

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from nexau.archs.main_sub.context_value import ContextValue
from nexau.archs.main_sub.team.sse.envelope import TeamStreamEnvelope
from nexau.archs.transports.http.team_registry import TeamRegistry

logger = logging.getLogger(__name__)


# --- Request/Response Models ---


class TeamRunRequest(BaseModel):
    """Request to run the team."""

    user_id: str
    session_id: str
    message: str
    variables: ContextValue | None = None


class TeamStreamEnvelopeResponse(BaseModel):
    """SSE event wrapper."""

    type: str = "team_event"  # team_event | complete | error
    envelope: dict[str, object] | None = None  # Serialized TeamStreamEnvelope
    session_id: str
    error: str | None = None


class CreateTaskRequest(BaseModel):
    """Request to create a task."""

    user_id: str
    session_id: str
    title: str
    description: str = ""
    priority: int = 0
    dependencies: list[str] = []


class ClaimTaskRequest(BaseModel):
    """Request to claim a task."""

    user_id: str
    session_id: str
    task_id: str
    assignee_agent_id: str | None = None


class UpdateTaskRequest(BaseModel):
    """Request to update a task."""

    status: str
    result_summary: str | None = None


class SendMessageRequest(BaseModel):
    """Request to send an intra-team message."""

    user_id: str
    session_id: str
    from_agent_id: str
    to_agent_id: str | None = None
    content: str


class UserMessageRequest(BaseModel):
    """Request to enqueue a user message to an agent during streaming."""

    user_id: str
    session_id: str
    content: str
    to_agent_id: str = "leader"


class StopTeamRequest(BaseModel):
    """Request to stop all agents in a team."""

    user_id: str
    session_id: str


# --- Router Factory ---


def create_team_router(
    registry: TeamRegistry,
    on_stream_event: Callable[[str, str, dict[str, object]], None] | None = None,
    get_history: Callable[[str, str, int], list[dict[str, object]]] | None = None,
    count_events: Callable[[str, str], int] | None = None,
) -> APIRouter:
    """Create team router with registry dependency.

    RFC-0002:  team  ( TeamRegistry) 

    Args:
        registry: TeamRegistry instance for managing team lifecycle.
        on_stream_event: Optional callback(user_id, session_id, envelope_dict) for event persistence.
        get_history: Optional callback(user_id, session_id, after) returning stored envelopes.
        count_events: Optional callback(user_id, session_id) returning total event count.

    Returns:
        Configured APIRouter with all team endpoints.
    """
    router = APIRouter(prefix="/team", tags=["team"])

    # RFC-0002: Team SSE
    # RFC-0014: running enqueue + subscribe
    @router.post("/stream")
    async def team_stream(request: TeamRunRequest) -> StreamingResponse:
        """Run team with SSE streaming output.

        RFC-0002: Team SSE 
        RFC-0014: running

         team,  enqueue  leader  subscribe 
        SSE,  run()  leader lock . 
        """
        team = registry.get_or_create(request.user_id, request.session_id)

        # RFC-0014: team, enqueue + subscribe
        if team.is_running:
            logger.info(
                "Team already running for (%s, %s), redirecting to enqueue + subscribe",
                request.user_id,
                request.session_id,
            )
            team.enqueue_user_message("leader", request.message)

            # subscribe SSE
            current_cursor = 0
            if count_events is not None:
                current_cursor = count_events(request.user_id, request.session_id)

            async def subscribe_generator() -> AsyncGenerator[str, None]:
                cursor = current_cursor
                try:
                    while True:
                        if get_history is not None:
                            new_events = get_history(request.user_id, request.session_id, cursor)
                            for event in new_events:
                                resp = TeamStreamEnvelopeResponse(
                                    type="team_event",
                                    envelope=event,
                                    session_id=request.session_id,
                                )
                                yield f"data: {resp.model_dump_json()}\n\n"
                                cursor += 1

                        active_team = registry.get(request.user_id, request.session_id)
                        if active_team is None or not active_team.is_running:
                            if get_history is not None:
                                for event in get_history(request.user_id, request.session_id, cursor):
                                    resp = TeamStreamEnvelopeResponse(
                                        type="team_event",
                                        envelope=event,
                                        session_id=request.session_id,
                                    )
                                    yield f"data: {resp.model_dump_json()}\n\n"
                            break

                        await asyncio.sleep(0.1)
                except Exception as exc:
                    logger.error("Team subscribe (redirected) error: %s", exc)
                    err_resp = TeamStreamEnvelopeResponse(
                        type="error",
                        session_id=request.session_id,
                        error=str(exc),
                    )
                    yield f"data: {err_resp.model_dump_json()}\n\n"
                    return

                yield f"data: {TeamStreamEnvelopeResponse(type='complete', session_id=request.session_id).model_dump_json()}\n\n"

            return StreamingResponse(
                subscribe_generator(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "X-Accel-Buffering": "no",
                },
            )

        # per-request on_envelope
        def _on_envelope(envelope: TeamStreamEnvelope) -> None:
            if on_stream_event is not None:
                on_stream_event(
                    request.user_id,
                    request.session_id,
                    envelope.model_dump(),
                )

        envelope_cb = _on_envelope if on_stream_event is not None else None

        # ( on_complete, SSE )
        team.set_on_complete(lambda: registry.remove(request.user_id, request.session_id))

        async def event_generator() -> AsyncGenerator[str, None]:
            try:
                async for envelope in team.run_streaming(request.message, on_envelope=envelope_cb, variables=request.variables):
                    response = TeamStreamEnvelopeResponse(
                        type="team_event",
                        envelope=envelope.model_dump(),
                        session_id=request.session_id,
                    )
                    yield f"data: {response.model_dump_json()}\n\n"
            except Exception as exc:
                logger.error("Team stream error: %s", exc)
                error_response = TeamStreamEnvelopeResponse(
                    type="error",
                    session_id=request.session_id,
                    error=str(exc),
                )
                yield f"data: {error_response.model_dump_json()}\n\n"
                return

            complete = TeamStreamEnvelopeResponse(
                type="complete",
                session_id=request.session_id,
            )
            yield f"data: {complete.model_dump_json()}\n\n"

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    # RFC-0002: Team
    @router.post("/query")
    async def team_query(request: TeamRunRequest) -> dict[str, str]:
        """Run team synchronously.

        RFC-0002: Team 
        """
        team = registry.get_or_create(request.user_id, request.session_id)
        try:
            result = await team.run(request.message, variables=request.variables)
            return {"session_id": request.session_id, "result": result}
        finally:
            registry.remove(request.user_id, request.session_id)

    # RFC-0002: Teammates
    @router.get("/teammates")
    async def list_teammates(
        user_id: str = Query(...),
        session_id: str = Query(...),
    ) -> list[dict[str, str]]:
        """List all teammates and their status.

        RFC-0002:  Teammates
        """
        team = registry.get(user_id, session_id)
        if team is None:
            return []
        infos = team.get_teammate_info()
        return [asdict(info) for info in infos]

    # RFC-0002:
    @router.get("/tasks")
    async def list_tasks(
        user_id: str = Query(...),
        session_id: str = Query(...),
        status: str | None = Query(default=None),
    ) -> list[dict[str, object]]:

        """List tasks on the shared task board.

        RFC-0002: 
        """
        team = registry.get_or_create(user_id, session_id)
        try:
            await team.initialize()
            tasks = await team.task_board.list_tasks(status=status)
        except (RuntimeError, ValueError):
            return []
        return [asdict(t) for t in tasks]

    # RFC-0002:
    @router.post("/tasks")
    async def create_task(request: CreateTaskRequest) -> dict[str, object]:
        """Create a new task.

        RFC-0002: 
        """
        team = registry.get_or_create(request.user_id, request.session_id)
        await team.initialize()
        task = await team.task_board.create_task(
            title=request.title,
            description=request.description,
            priority=request.priority,
            dependencies=request.dependencies,
            created_by="api",
        )
        return asdict(task)

    # RFC-0002:
    @router.post("/tasks/claim")
    async def claim_task(request: ClaimTaskRequest) -> dict[str, object]:
        """Claim a task.

        RFC-0002: 
        """
        team = registry.get_or_create(request.user_id, request.session_id)
        await team.initialize()
        assignee = request.assignee_agent_id or "api"
        try:
            await team.task_board.claim_task(
                task_id=request.task_id,
                assignee_agent_id=assignee,
            )
        except Exception as exc:
            raise HTTPException(status_code=409, detail=str(exc))
        return {"task_id": request.task_id, "status": "claimed", "assignee_agent_id": assignee}

    # RFC-0002:
    @router.patch("/tasks/{task_id}")
    async def update_task(
        task_id: str,
        request: UpdateTaskRequest,
        user_id: str = Query(...),
        session_id: str = Query(...),
    ) -> dict[str, object]:
        """Update task status.

        RFC-0002: 
        """
        team = registry.get_or_create(user_id, session_id)
        await team.initialize()
        await team.task_board.update_status(
            task_id=task_id,
            status=request.status,
            result_summary=request.result_summary,
        )
        return {"task_id": task_id, "status": request.status}

    # RFC-0002:
    @router.post("/message")
    async def send_message(request: SendMessageRequest) -> dict[str, str]:
        """Send an intra-team message.

        RFC-0002: 
        """
        team = registry.get_or_create(request.user_id, request.session_id)
        await team.initialize()
        if request.to_agent_id is not None:
            msg = await team.message_bus.send(
                from_agent_id=request.from_agent_id,
                to_agent_id=request.to_agent_id,
                content=request.content,
            )
            return {"message_id": msg.message_id, "status": "sent"}
        else:
            msg = await team.message_bus.broadcast(
                from_agent_id=request.from_agent_id,
                content=request.content,
            )
            return {"message_id": msg.message_id, "status": "broadcast"}

    # RFC-0002: (stream agent )
    @router.post("/user-message")
    async def user_message(request: UserMessageRequest) -> dict[str, str]:
        """Enqueue a user message to an agent during streaming.

        RFC-0002: 

         stream,  agent  user, 
         enqueue_message  agent  team_mode . 
        """
        team = registry.get(request.user_id, request.session_id)
        if team is None:
            raise HTTPException(status_code=404, detail="No active team for this session")
        team.enqueue_user_message(request.to_agent_id, request.content)
        return {"status": "enqueued", "to_agent_id": request.to_agent_id}

    # RFC-0002: Team
    @router.post("/stop")
    async def stop_team(request: StopTeamRequest) -> dict[str, str]:
        """Force-stop all agents in a team.

        RFC-0002:  Team

         Stop,  leader  teammate . 
        """
        team = registry.get(request.user_id, request.session_id)
        if team is None:
            return {"status": "no_active_team"}
        await team.stop_all()
        return {"status": "stopped"}

    # RFC-0002: Team
    @router.get("/status")
    async def team_status(
        user_id: str = Query(...),
        session_id: str = Query(...),
    ) -> dict[str, object]:
        """Check whether a team is currently running.

        RFC-0002:  Team 

        interface SSE . 
        """
        team = registry.get(user_id, session_id)
        return {
            "running": team is not None and team.is_running,
            "session_id": session_id,
        }

    # RFC-0002: SSE
    @router.get("/subscribe")
    async def team_subscribe(
        user_id: str = Query(...),
        session_id: str = Query(...),
        after: int = Query(default=0),
    ) -> StreamingResponse:
        """Subscribe to new team events from EventStore (for reconnection after refresh).

        RFC-0002:  SSE 

        interface EventStore, 
        `after`  N . 
        """

        async def event_generator() -> AsyncGenerator[str, None]:
            cursor = after
            try:
                while True:
                    # 1.
                    if get_history is not None:
                        new_events = get_history(user_id, session_id, cursor)
                        for event in new_events:
                            response = TeamStreamEnvelopeResponse(
                                type="team_event",
                                envelope=event,
                                session_id=session_id,
                            )
                            yield f"data: {response.model_dump_json()}\n\n"
                            cursor += 1

                    # 2. team
                    team = registry.get(user_id, session_id)
                    if team is None or not team.is_running:
                        if get_history is not None:
                            for event in get_history(user_id, session_id, cursor):
                                response = TeamStreamEnvelopeResponse(
                                    type="team_event",
                                    envelope=event,
                                    session_id=session_id,
                                )
                                yield f"data: {response.model_dump_json()}\n\n"
                        break

                    await asyncio.sleep(0.1)
            except Exception as exc:
                logger.error("Team subscribe error: %s", exc)
                yield f"data: {TeamStreamEnvelopeResponse(type='error', session_id=session_id, error=str(exc)).model_dump_json()}\n\n"
                return

            yield f"data: {TeamStreamEnvelopeResponse(type='complete', session_id=session_id).model_dump_json()}\n\n"

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    return router