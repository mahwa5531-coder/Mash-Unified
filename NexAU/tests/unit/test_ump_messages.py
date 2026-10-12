import logging
from typing import Any

from _pytest.logging import LogCaptureFixture

from nexau.core.messages import Message, Role, TextBlock, ToolResultBlock, ToolUseBlock
from nexau.core.serializers.openai_chat import (
    messages_from_legacy_openai_chat,
    serialize_ump_to_openai_chat_payload,
)


def test_framework_role_survives_public_dict_history_round_trip() -> None:
    """Canonical FRAMEWORK JSON must not be downgraded to a real USER."""

    original = Message(
        role=Role.FRAMEWORK,
        content=[TextBlock(text="iteration reminder")],
    )
    wire_message = original.model_dump(mode="json")

    normalized = messages_from_legacy_openai_chat([wire_message])
    lowercase = messages_from_legacy_openai_chat([{"role": "framework", "content": "lowercase reminder"}])

    assert normalized[0].role == Role.FRAMEWORK
    assert normalized[0].get_text_content() == "iteration reminder"
    assert lowercase[0].role == Role.FRAMEWORK
    assert lowercase[0].get_text_content() == "lowercase reminder"


def test_legacy_roundtrip_text_only() -> None:
    legacy: list[dict[str, Any]] = [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello"},
        {"role": "assistant", "content": "Hi there!"},
    ]

    ump = messages_from_legacy_openai_chat(legacy)
    assert [m.role for m in ump] == [Role.SYSTEM, Role.USER, Role.ASSISTANT]
    assert ump[1].get_text_content() == "Hello"

    payload = serialize_ump_to_openai_chat_payload(ump)
    assert payload == legacy


def test_legacy_roundtrip_tool_call_and_result() -> None:
    legacy: list[dict[str, Any]] = [
        {"role": "user", "content": "What is 2+2? Use the calculator tool."},
        {
            "role": "assistant",
            "content": "Calling tool.",
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "calculator", "arguments": '{"expr":"2+2"}'},
                },
            ],
        },
        {"role": "tool", "tool_call_id": "call_1", "content": "4"},
        {"role": "assistant", "content": "Answer: 4"},
    ]

    ump = messages_from_legacy_openai_chat(legacy)
    assert ump[1].role == Role.ASSISTANT
    assert any(
        isinstance(b, ToolUseBlock) and b.id == "call_1" and b.name == "calculator" and b.input.get("expr") == "2+2" for b in ump[1].content
    )

    assert ump[2].role == Role.TOOL
    assert any(isinstance(b, ToolResultBlock) and b.tool_use_id == "call_1" and b.content == "4" for b in ump[2].content)

    payload = serialize_ump_to_openai_chat_payload(ump)
    assert payload == legacy


def test_legacy_roundtrip_preserves_reasoning_details() -> None:
    """OpenRouter `reasoning_details` must survive legacy → UMP → OpenAI-chat roundtrip
    unchanged, so multi-turn reasoning context reaches the provider untouched.
    """
    details = [
        {
            "type": "reasoning.text",
            "text": "Let me think...",
            "id": "r1",
            "signature": None,
            "format": "anthropic-claude-v1",
            "index": 0,
        },
        {
            "type": "reasoning.summary",
            "summary": "Decomposed the problem",
            "id": "r2",
            "format": "anthropic-claude-v1",
            "index": 1,
        },
    ]
    legacy: list[dict[str, Any]] = [
        {"role": "user", "content": "Solve it."},
        {
            "role": "assistant",
            "content": "Answer.",
            "reasoning_details": details,
        },
    ]

    ump = messages_from_legacy_openai_chat(legacy)
    assert ump[1].metadata["reasoning_details"] == details

    payload = serialize_ump_to_openai_chat_payload(ump)
    assert payload == legacy


def test_legacy_roundtrip_preserves_empty_reasoning_content() -> None:
    """DeepSeek requires explicit blank reasoning_content to survive history replay."""

    legacy: list[dict[str, Any]] = [
        {"role": "user", "content": "Use a tool."},
        {
            "role": "assistant",
            "content": "",
            "reasoning_content": "",
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "calculator", "arguments": '{"expr":"2+2"}'},
                },
            ],
        },
        {"role": "tool", "tool_call_id": "call_1", "content": "4"},
    ]

    ump = messages_from_legacy_openai_chat(legacy)
    payload = serialize_ump_to_openai_chat_payload(ump)

    assert payload == legacy


def test_legacy_structured_content_list_is_preserved_as_text_blocks() -> None:
    legacy: list[dict[str, Any]] = [
        {"role": "user", "content": [{"type": "text", "text": "a"}, {"type": "text", "text": "b"}]},
        {"role": "assistant", "content": [{"type": "output_text", "text": "c"}]},
    ]

    ump = messages_from_legacy_openai_chat(legacy)
    assert [type(b) for b in ump[0].content] == [TextBlock, TextBlock]
    assert ump[0].get_text_content() == "ab"

    payload = serialize_ump_to_openai_chat_payload(ump)
    assert payload == [
        {"role": "user", "content": "ab"},
        {"role": "assistant", "content": "c"},
    ]


def test_legacy_roundtrip_structured_content_with_image_url() -> None:
    legacy: list[dict[str, Any]] = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "see"},
                {"type": "image_url", "image_url": {"url": "https://example.com/a.png"}},
                {"type": "text", "text": "ok"},
            ],
        },
    ]

    ump = messages_from_legacy_openai_chat(legacy)
    assert ump[0].role == Role.USER
    assert [b.type for b in ump[0].content] == ["text", "image", "text"]

    payload = serialize_ump_to_openai_chat_payload(ump)
    assert payload == legacy


def test_injected_tool_image_user_message_is_merged_back_into_tool_result() -> None:
    """If legacy history used Chat Completions image workaround, reconstruct a multimodal ToolResultBlock."""

    ump_msgs = messages_from_legacy_openai_chat(
        [
            {
                "role": "assistant",
                "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "file_read", "arguments": "{}"}}],
            },
            {"role": "tool", "tool_call_id": "call_1", "content": "Here is the image: <image>"},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Images returned by tool call call_1:"},
                    {"type": "image_url", "image_url": {"url": "https://example.com/a.png"}},
                ],
            },
        ]
    )

    # The injected user image message should be dropped, and its image should be attached to the tool result.
    tool_msg = next(m for m in ump_msgs if m.role == Role.TOOL)
    tr = next(b for b in tool_msg.content if isinstance(b, ToolResultBlock))
    assert tr.tool_use_id == "call_1"
    assert isinstance(tr.content, list)
    assert any(getattr(p, "type", None) == "image" for p in tr.content)


def test_unknown_role_logs_warning_and_coerces_to_user(caplog: LogCaptureFixture) -> None:
    legacy: list[dict[str, Any]] = [{"role": "developer", "content": "hi"}]

    with caplog.at_level(logging.WARNING):
        ump = messages_from_legacy_openai_chat(legacy)

    assert ump[0].role == Role.USER
    assert any("Unknown role" in rec.getMessage() and "coercing to user" in rec.getMessage() for rec in caplog.records)
