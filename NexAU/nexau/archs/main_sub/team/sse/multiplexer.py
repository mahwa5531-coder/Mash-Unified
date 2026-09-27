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

"""Team SSE multiplexer.

RFC-0002:  Agent event aggregator

# Thread Safety

asyncio.Queue is NOT thread-safe.  Tool implementations (async def) run
inside ``asyncio.run()`` on ThreadPoolExecutor workers, which means
``send_message_to_agent`` / ``enqueue_user_message`` can call ``emit()``
from a non-event-loop thread.  A plain ``put_nowait`` from such a thread
silently fails to wake the ``stream()`` coroutine waiting on ``get()``,
causing TEAM_MESSAGE / USER_MESSAGE events to be lost from the live SSE
stream (they still persist via ``on_envelope``, hence visible after
browser refresh).

We solve this by capturing the owning event loop at construction time and
using ``loop.call_soon_threadsafe`` whenever the caller is on a different
thread.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncGenerator, Callable

from nexau.archs.llm.llm_aggregators.events import Event

from .envelope import TeamStreamEnvelope

logger = logging.getLogger(__name__)


class TeamSSEMultiplexer:
    """Multiplexes events from multiple agents into a single SSE stream.

    RFC-0002:  Agent event aggregator

     agent  create_event_handler, 
     asyncio.Queue,  stream() . 

     ``_put`` . 
    """

    def __init__(
        self,
        *,
        team_id: str,
        on_envelope: Callable[[TeamStreamEnvelope], None] | None = None,
    ) -> None:
        self._team_id = team_id
        self._queue: asyncio.Queue[TeamStreamEnvelope | None] = asyncio.Queue()
        self._on_envelope = on_envelope

        try:
            self._loop: asyncio.AbstractEventLoop | None = asyncio.get_running_loop()
        except RuntimeError:
            self._loop = None

    # ------------------------------------------------------------------
    # ------------------------------------------------------------------

    def _put(self, item: TeamStreamEnvelope | None) -> None:
        """Thread-safe put into the async queue.

         ( ThreadPoolExecutor  tool
         asyncio.run() ),  call_soon_threadsafe . 
         owner loop,  put_nowait () . 
        """
        loop = self._loop
        if loop is None or loop.is_closed():
            # owner loop loop -
            self._queue.put_nowait(item)
            return

        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None

        if running is loop:
            self._queue.put_nowait(item)
        else:
            try:
                loop.call_soon_threadsafe(self._queue.put_nowait, item)
            except RuntimeError:
                # loop
                logger.warning("TeamSSEMultiplexer: owner loop closed during _put, using fallback")
                self._queue.put_nowait(item)

    # ------------------------------------------------------------------

    def create_event_handler(self, agent_id: str, role_name: str) -> Callable[[Event], None]:
        """Create an on_event callback for a specific agent.

        RFC-0002:  agent 

        functionpackage TeamStreamEnvelope . 
        """

        def handler(event: Event) -> None:
            envelope = TeamStreamEnvelope(
                team_id=self._team_id,
                agent_id=agent_id,
                role_name=role_name,
                event=event,
            )
            if self._on_envelope is not None:
                self._on_envelope(envelope)
            self._put(envelope)

        return handler

    def emit(self, agent_id: str, event: Event, *, role_name: str | None = None) -> None:
        """Emit a custom event to the SSE stream.

        RFC-0002:  SSE  (, Agent ) 
        """
        envelope = TeamStreamEnvelope(
            team_id=self._team_id,
            agent_id=agent_id,
            role_name=role_name,
            event=event,
        )
        if self._on_envelope is not None:
            self._on_envelope(envelope)
        self._put(envelope)

    async def stream(self) -> AsyncGenerator[TeamStreamEnvelope, None]:
        """Yield envelopes as they arrive from any agent.

        RFC-0002:  agent 

         None value. 
        """
        while True:
            envelope = await self._queue.get()
            if envelope is None:
                break
            yield envelope

    def close(self) -> None:
        """Signal end of stream.

        RFC-0002: 

         None value,  stream() . 
        close(),  put_nowait. 
        """
        self._put(None)