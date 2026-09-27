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

"""Run NexAU Building Team directly without HTTP transport.

RFC-0002:  AgentTeam（ HTTP）

Uses AgentTeam.run_streaming() to run the leader + teammates
and prints streaming events to the console.

Usage:
    python examples/nexau_building_team/start.py "Build a TODO app"
    python examples/nexau_building_team/start.py  # interactive prompt
"""

from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path

from nexau.archs.llm.llm_aggregators.events import (
    RunErrorEvent,
    RunFinishedEvent,
    TextMessageContentEvent,
    ToolCallEndEvent,
    ToolCallStartEvent,
)
from nexau.archs.main_sub.config import AgentConfig
from nexau.archs.main_sub.team.agent_team import AgentTeam
from nexau.archs.session.orm import InMemoryDatabaseEngine
from nexau.archs.session.session_manager import SessionManager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SCRIPT_DIR = Path(__file__).parent


# ANSI colors for distinguishing agents in terminal output
COLORS: dict[str, str] = {
    "leader": "\033[1;34m",  # bold blue
    "rfc_writer": "\033[1;33m",  # bold yellow
    "builder": "\033[1;32m",  # bold green
    "user": "\033[1;35m",  # bold magenta
}
RESET = "\033[0m"


async def main(message: str) -> None:
    """Run the building team with streaming output.

    RFC-0002:  AgentTeam 

    Steps:
    1.  agent 
    2.  AgentTeam 
    3.  run_streaming() 
    """
    # 1.  agent 
    leader_config = AgentConfig.from_yaml(SCRIPT_DIR / "leader_agent.yaml")
    rfc_writer_config = AgentConfig.from_yaml(SCRIPT_DIR / "rfc_writer_agent.yaml")
    builder_config = AgentConfig.from_yaml(SCRIPT_DIR / "builder_agent.yaml")

    # 2.  engine、session manager、team
    engine = InMemoryDatabaseEngine()
    session_manager = SessionManager(engine=engine)

    team = AgentTeam(
        leader_config=leader_config,
        candidates={
            "rfc_writer": rfc_writer_config,
            "builder": builder_config,
        },
        engine=engine,
        session_manager=session_manager,
        user_id="local_user",
        session_id="local_session",
    )

    # 3. 
    logger.info("Starting team run (streaming)...")
    current_agent: str | None = None

    async for envelope in team.run_streaming(message=message):
        event = envelope.event
        role = envelope.role_name or "unknown"
        color = COLORS.get(role, "")

        #  agent 
        if envelope.agent_id != current_agent:
            current_agent = envelope.agent_id
            print(f"\n{color}[{role}:{current_agent}]{RESET}", end=" ", flush=True)

        # （ isinstance ）
        if isinstance(event, TextMessageContentEvent):
            print(event.delta, end="", flush=True)
        elif isinstance(event, RunFinishedEvent):
            print(f"\n{color}  ✓ run finished{RESET}", flush=True)
        elif isinstance(event, RunErrorEvent):
            print(f"\n{color}  ✗ error: {event.message}{RESET}", flush=True)
        elif isinstance(event, ToolCallStartEvent):
            print(f"\n{color}  → tool: {event.tool_call_name}{RESET}", end="", flush=True)
        elif isinstance(event, ToolCallEndEvent):
            print(" (done)", end="", flush=True)

    print("\n\nTeam run completed.")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        user_message = " ".join(sys.argv[1:])
    else:
        user_message = input("Enter your request: ").strip()
        if not user_message:
            print("No message provided.")
            sys.exit(1)

    asyncio.run(main(user_message))