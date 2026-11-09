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

"""Harness evaluation: Multimodal visual pruning, wire token budget, and persistence fidelity.

Verifies that the agent harness strictly enforces the active-turn wire sliding window:
- Active turn delivers full-resolution Base64 visual payloads to the vision LLM.
- Completed past turns strip heavy Base64 and emit compact text references.
- Underlying database persistence maintains 100% full-fidelity audit history.
"""

from __future__ import annotations

import pytest
from datetime import UTC, datetime

from nexau.archs.session import InMemoryDatabaseEngine, SessionManager
from nexau.archs.session.models import AgentRunActionModel, SessionModel
from nexau.archs.session.orm import ComparisonFilter
from nexau.core.messages import ImageBlock, Message, Role, TextBlock, ToolResultBlock
from nexau.core.serializers.openai_chat import serialize_ump_to_openai_chat_payload
from nexau.archs.tool.builtin.file_tools.view_file import view_file


# ── TEST 1: Tool visual output pruning across turns ──────────────────────

class TestToolVisualPruningAcrossTurns:
    """Tool visual results must be active in current turn and pruned in past turns."""

    def test_active_turn_tool_image_transmitted(self):
        """MULTIMODAL-PRUNE-001: Active in-flight turn transmits full Base64 image parts."""
        turn1_msgs = [
            Message.user("Please analyze page 1 of Audit_Deliverables/sample.pdf"),
            Message(
                role=Role.TOOL,
                content=[
                    ToolResultBlock(
                        tool_use_id="call_view_pdf_1",
                        content=[
                            TextBlock(text="[PDF Document: sample.pdf (10 pages)]\n--- Page 1 (Visual Scanned Rendering) ---"),
                            ImageBlock(base64="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", mime_type="image/png"),
                        ],
                    )
                ],
                metadata={"tool_name": "view_file"},
            ),
        ]
        payload = serialize_ump_to_openai_chat_payload(turn1_msgs)

        # Wire payload must carry the image_url part for the vision model
        has_image = any(
            m.get("role") == "user"
            and isinstance(m.get("content"), list)
            and any(p.get("type") == "image_url" for p in m["content"])
            for m in payload
        )
        assert has_image, "HARNESS_BUG: Active turn tool image was not emitted to wire payload"

    def test_past_turn_tool_image_pruned(self):
        """MULTIMODAL-PRUNE-002: Completed turn tool image is pruned to text reference."""
        turn1_msgs = [
            Message.user("Please analyze page 1 of Audit_Deliverables/sample.pdf"),
            Message(
                role=Role.TOOL,
                content=[
                    ToolResultBlock(
                        tool_use_id="call_view_pdf_1",
                        content=[
                            TextBlock(text="[PDF Document: sample.pdf (10 pages)]\n--- Page 1 (Visual Scanned Rendering) ---"),
                            ImageBlock(base64="HEAVY_BASE64_BYTES_40KB", mime_type="image/png"),
                        ],
                    )
                ],
                metadata={"tool_name": "view_file"},
            ),
            Message.assistant("Page 1 shows net profit of $4.2M."),
            Message.user("What were the operating expenses?"),
        ]
        payload = serialize_ump_to_openai_chat_payload(turn1_msgs)

        # In Turn 2: Turn 1's tool image MUST NOT be sent as image_url on the wire
        has_image = any(
            isinstance(m.get("content"), list)
            and any(p.get("type") == "image_url" for p in m["content"])
            for m in payload
        )
        assert not has_image, "HARNESS_BUG: Past turn image was re-sent in Turn 2 payload"

        # The tool message must retain the textual metadata and the pruned reference
        tool_msg = next(m for m in payload if m.get("role") == "tool")
        assert "[PDF Document: sample.pdf" in tool_msg["content"]
        assert "[Visual tool output from call call_view_pdf_1 analyzed in turn above]" in tool_msg["content"]

    def test_turn_10_reinspection_transmits_fresh_image(self):
        """MULTIMODAL-PRUNE-003: Re-inspection at Turn 10 sends fresh image while keeping Turn 1 pruned."""
        history: list[Message] = [
            # Turn 1
            Message.user("Check PDF page 1"),
            Message(
                role=Role.TOOL,
                content=[ToolResultBlock(tool_use_id="call_1", content=[TextBlock(text="Page 1: "), ImageBlock(base64="PAGE1_B64", mime_type="image/png")])],
            ),
            Message.assistant("Page 1 reviewed."),
        ]
        # Intermediary turns 2 to 9 (text only discussion)
        for t in range(2, 10):
            history.append(Message.user(f"Question for turn {t}"))
            history.append(Message.assistant(f"Answer for turn {t}"))

        # Turn 10: User asks for page 5 re-inspection
        history.extend([
            Message.user("Now inspect page 5 footnote"),
            Message(
                role=Role.TOOL,
                content=[ToolResultBlock(tool_use_id="call_page_5", content=[TextBlock(text="Page 5: "), ImageBlock(base64="PAGE5_B64", mime_type="image/png")])],
            ),
        ])

        payload = serialize_ump_to_openai_chat_payload(history)

        # 1. Turn 1 tool result (index < last_user_idx) must be pruned
        turn1_tool = next(m for m in payload if m.get("role") == "tool" and m.get("tool_call_id") == "call_1")
        assert "[Visual tool output from call call_1 analyzed in turn above]" in turn1_tool["content"]

        # 2. Turn 10 tool result (active turn) MUST transmit the page 5 image_url
        has_page5_img = any(
            m.get("role") == "user"
            and isinstance(m.get("content"), list)
            and any(p.get("type") == "image_url" for p in m["content"])
            for m in payload
        )
        assert has_page5_img, "HARNESS_BUG: Turn 10 fresh re-inspection image was omitted from active turn"


# ── TEST 2: User image upload pruning across turns ───────────────────────

class TestUserImageUploadPruning:
    """User-uploaded composer images must prune on subsequent turns."""

    def test_user_upload_pruned_on_follow_up(self):
        """USER-IMAGE-PRUNE-001: User image Base64 pruned to placeholder; relative path preserved."""
        history = [
            Message(
                role=Role.USER,
                content=[
                    TextBlock(text="[Attached file: .user_uploaded/receipt.png]\nInspect this invoice:"),
                    ImageBlock(base64="RECEIPT_PIXEL_DATA_100KB", mime_type="image/png"),
                ],
            ),
            Message.assistant("The total is $540 with 10% tax."),
            Message.user("Who is the vendor named on it?"),
        ]
        payload = serialize_ump_to_openai_chat_payload(history)

        # Turn 1 user message on wire must NOT have image_url
        turn1_user = payload[0]
        assert not any(p.get("type") == "image_url" for p in turn1_user["content"])

        # File path and prompt remain intact
        assert any("[Attached file: .user_uploaded/receipt.png]" in p.get("text", "") for p in turn1_user["content"])
        assert any("[User-uploaded image from previous turn analyzed above]" in p.get("text", "") for p in turn1_user["content"])


# ── TEST 3: Database persistence fidelity invariant ─────────────────────

class TestPersistenceFidelityInvariant:
    """Wire pruning must never corrupt local database state."""

    @pytest.mark.anyio
    async def test_database_preserves_full_image_bytes(self):
        """PERSISTENCE-FIDELITY-001: SQLite / InMemory store retains 100% of image bytes."""
        engine = InMemoryDatabaseEngine()
        sm = SessionManager(engine=engine)
        await sm.setup_models()

        sid = "sess_fidelity_check"
        session = SessionModel(
            user_id="auditor_1", session_id=sid,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
            context={"project": "Audit2026"},
        )
        await engine.create(session)

        # Append action with raw ImageBlock
        action = AgentRunActionModel(
            action_id="act_img_1",
            user_id="auditor_1", session_id=sid, agent_id="agent_mash",
            run_id="run_1", root_run_id="run_1",
            agent_name="statutory_auditor",
            created_at=datetime.now(UTC),
            action_type="append",
            append_messages=[
                Message(
                    role=Role.TOOL,
                    content=[
                        ToolResultBlock(
                            tool_use_id="call_full_fidelity",
                            content=[
                                TextBlock(text="Rendered Page:"),
                                ImageBlock(base64="PERMANENT_RAW_AUDIT_PIXELS_VERIFIED", mime_type="image/png"),
                            ],
                        )
                    ],
                )
            ],
        )
        await engine.create(action)

        # Simulate wire serialization pass for turn 2 (pruning active)
        wire_messages = [
            action.append_messages[0],
            Message.assistant("Analysis done"),
            Message.user("Next turn"),
        ]
        wire_payload = serialize_ump_to_openai_chat_payload(wire_messages)

        # Wire payload is pruned
        tool_wire = next(m for m in wire_payload if m.get("role") == "tool")
        assert "PERMANENT_RAW_AUDIT_PIXELS_VERIFIED" not in str(tool_wire)

        # Read back from database
        read_actions = await engine.find_many(
            AgentRunActionModel,
            filters=ComparisonFilter.eq("session_id", sid),
        )
        assert len(read_actions) == 1
        stored_block = read_actions[0].append_messages[0].content[0]
        assert isinstance(stored_block, ToolResultBlock)
        img_part = next(p for p in stored_block.content if isinstance(p, ImageBlock))
        assert img_part.base64 == "PERMANENT_RAW_AUDIT_PIXELS_VERIFIED", (
            "HARNESS_BUG: Database was mutated by wire serialization; audit fidelity lost"
        )
