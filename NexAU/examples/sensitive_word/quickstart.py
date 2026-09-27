# Copyright (c) Nex-AGI. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0

"""SensitiveWordMiddleware quick start (RFC-0027).

 ``sensitive_word_agent.yaml``  agent，
 / 。

::

    export LLM_MODEL=nex-agi/Nex-N2-Pro
    export LLM_BASE_URL=https://your-gateway/v1      #  /v1
    export LLM_API_KEY=sk-...
    export LLM_API_TYPE=openai_chat_completion
    # ：trace  Langfuse
    export LANGFUSE_PUBLIC_KEY=pk-lf-...
    export LANGFUSE_SECRET_KEY=sk-lf-...
    export LANGFUSE_HOST=https://your-langfuse

    python examples/sensitive_word/quickstart.py
"""

from __future__ import annotations

from pathlib import Path

from nexau import Agent, AgentConfig

_CONFIG = Path(__file__).resolve().parent / "sensitive_word_agent.yaml"

_CASES = [
    "",       # （:）→ 
    "",     #  → 
]


def main() -> None:
    config = AgentConfig.from_yaml(_CONFIG)
    for msg in _CASES:
        print(f"\n{'=' * 60}\n: {msg}")
        resp = Agent(config=config).run(message=msg)
        blocked = "" in resp
        print(f"{'🛑 ' if blocked else '✅ '}: {resp[:120]}")


if __name__ == "__main__":
    main()