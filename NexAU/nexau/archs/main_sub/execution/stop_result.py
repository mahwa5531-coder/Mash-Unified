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

"""Stop result data model.

RFC-0001: Agent 

StopResult  agent.stop() value, 
package,  LLM . 
"""

from dataclasses import dataclass, field

from nexau.archs.main_sub.execution.stop_reason import AgentStopReason
from nexau.core.messages import Message


@dataclass
class StopResult:
    """Result returned by Agent.stop().

    RFC-0001: Agent 

    Attributes:
        messages: 
        stop_reason:  (USER_INTERRUPTED) 
        interrupted_at_iteration: 
        partial_response:  LLM  () 
    """

    messages: list[Message] = field(default_factory=lambda: list[Message]())
    stop_reason: AgentStopReason = AgentStopReason.USER_INTERRUPTED
    interrupted_at_iteration: int = 0
    partial_response: str | None = None