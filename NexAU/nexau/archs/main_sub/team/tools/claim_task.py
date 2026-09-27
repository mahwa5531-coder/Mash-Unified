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

"""claim_task tool - claim or assign a task from the task board.

RFC-0002: /
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from nexau.archs.main_sub.team.types import (
    ClaimTaskResult,
    TaskBlockedError,
    ToolError,
    require_team_state,
)
from nexau.archs.session.task_lock_service import LockConflictError

if TYPE_CHECKING:
    from nexau.archs.main_sub.agent_state import AgentState


async def claim_task(
    task_id: str,
    agent_state: AgentState,
    assignee_agent_id: str | None = None,
) -> ClaimTaskResult | ToolError:
    """Claim a task from the shared task board.

    RFC-0002: /

    - task_id  ( claim-next) 
    - assignee_agent_id  self-claim
    - assignee_agent_id  leader assignment ( caller  leader) 

    Teammate : list_tasks() →  task_id → claim_task(task_id)
     claim retry. 
    """
    ts = require_team_state(agent_state)
    caller_id = agent_state.agent_id
    actual_assignee = assignee_agent_id or caller_id

    # leader assignment
    if assignee_agent_id is not None and not ts.is_leader:
        return ToolError(
            error="Only leader can assign tasks to others",
            code="permission_denied",
        )

    # : teammate in_progress
    active_tasks = await ts.task_board.list_tasks(status="in_progress")
    existing = [t for t in active_tasks if t.assignee_agent_id == actual_assignee]
    if existing:
        current = existing[0]
        return ToolError(
            error=(
                f"{actual_assignee} already has an active task: "
                f"{current.task_id} ({current.title}). "
                "Finish or release it before claiming a new one."
            ),
            code="busy",
        )

    try:
        await ts.task_board.claim_task(
            task_id=task_id,
            assignee_agent_id=actual_assignee,
        )

        # leader assignment enqueue_message teammate
        if assignee_agent_id is not None:
            ts.team.send_message_to_agent(
                actual_assignee,
                f"Task assigned: {task_id}. Use list_tasks to see details and work on it.",
                agent_state.agent_id,
            )

        # deliverable_path
        task_info = await ts.task_board.get_task_info(task_id)

        return ClaimTaskResult(
            task_id=task_id,
            title=task_info.title,
            status="claimed",
            assignee_agent_id=actual_assignee,
            deliverable_path=task_info.deliverable_path,
        )
    except LockConflictError:
        return ToolError(
            error=f"Task {task_id} claim conflict, retry with another task",
            code="conflict",
        )
    except TaskBlockedError:
        return ToolError(
            error=f"Task {task_id} is blocked by unfinished dependencies",
            code="blocked",
        )