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

"""Time-based trigger strategy for micro-compact.

micro-compact:  Message .  assistant  created_at
value (default 5,  Anthropic prompt cache  TTL) . 
Trigger,  messages . 
"""

import logging
from datetime import UTC, datetime, timedelta

from nexau.core.messages import Message, Role

logger = logging.getLogger(__name__)


class TimeBasedTrigger:
    """Trigger compaction when the gap since last assistant message exceeds a threshold.

    micro-compact:  messages  assistant  created_at, 
    .  gap_threshold_minutes . 
    """

    def __init__(self, gap_threshold_minutes: float = 5):
        """Initialize time-based trigger.

        Args:
            gap_threshold_minutes: Minutes since last assistant message to trigger compaction.
                Default: 5 (aligned with Anthropic prompt cache standard TTL).
        """
        self.gap_threshold = timedelta(minutes=gap_threshold_minutes)
        logger.info(
            "[TimeBasedTrigger] Initialized with gap_threshold: %d minutes",
            gap_threshold_minutes,
        )

    def should_compact(
        self,
        messages: list[Message],
        current_tokens: int,
        max_context_tokens: int,
    ) -> tuple[bool, str]:
        """Check if compaction should be triggered based on time gap.

        micro-compact:  messages  assistant  created_at, 
         now - created_at, value.  assistant  created_at  None . 
        """
        # 1. assistant
        last_assistant_created_at: datetime | None = None
        for msg in reversed(messages):
            if msg.role == Role.ASSISTANT:
                last_assistant_created_at = msg.created_at
                break

        # 2. assistant created_at None →
        if last_assistant_created_at is None:
            return False, ""

        # 3. timezone-aware
        now = datetime.now(UTC)
        if last_assistant_created_at.tzinfo is None:
            last_assistant_created_at = last_assistant_created_at.replace(tzinfo=UTC)

        gap = now - last_assistant_created_at
        if gap >= self.gap_threshold:
            gap_minutes = gap.total_seconds() / 60
            threshold_minutes = self.gap_threshold.total_seconds() / 60
            return (
                True,
                f"Time gap {gap_minutes:.1f}min >= threshold {threshold_minutes:.0f}min "
                f"(last assistant message at {last_assistant_created_at.isoformat()})",
            )

        return False, ""