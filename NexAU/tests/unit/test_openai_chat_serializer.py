from typing import Any, cast

from nexau.core.messages import ImageBlock, Message, ReasoningBlock, Role, TextBlock, ToolResultBlock, ToolUseBlock
from nexau.core.serializers.openai_chat import serialize_ump_to_openai_chat_payload


def test_openai_chat_serializer_emits_reasoning_and_tool_calls() -> None:
    msgs = [
        Message.user("hello"),
        Message(
            role=Role.ASSISTANT,
            content=[
                ReasoningBlock(text="reasoning text", signature="sig_1", redacted_data="blob_1"),
                TextBlock(text="done"),
                ToolUseBlock(id="call_1", name="weather", input={"city": "Paris"}),
            ],
            metadata={"response_items": [{"type": "message", "id": "m1"}]},
        ),
    ]

    assert serialize_ump_to_openai_chat_payload(msgs) == [
        {"role": "user", "content": "hello"},
        {
            "role": "assistant",
            "content": "done",
            "response_items": [{"type": "message", "id": "m1"}],
            "reasoning_content": "reasoning text",
            "reasoning_signature": "sig_1",
            "reasoning_redacted_data": "blob_1",
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "weather", "arguments": '{"city": "Paris"}'},
                },
            ],
        },
    ]


def test_openai_chat_serializer_echoes_reasoning_details_from_metadata() -> None:
    """OpenRouter-style `reasoning_details` must flow from Message.metadata to the outgoing
    assistant entry verbatim — any rewrite would break multi-turn reasoning context.
    """
    details = [
        {
            "type": "reasoning.text",
            "text": "line A",
            "id": "r1",
            "signature": None,
            "format": "anthropic-claude-v1",
            "index": 0,
        },
        {
            "type": "reasoning.summary",
            "summary": "line B",
            "id": "r2",
            "format": "anthropic-claude-v1",
            "index": 1,
        },
    ]
    msgs = [
        Message(
            role=Role.ASSISTANT,
            content=[TextBlock(text="answer")],
            metadata={"reasoning_details": details},
        ),
    ]

    serialized = serialize_ump_to_openai_chat_payload(msgs)

    assert serialized == [
        {
            "role": "assistant",
            "content": "answer",
            "reasoning_details": details,
        },
    ]


def test_openai_chat_serializer_matches_legacy_tool_image_injection_policy() -> None:
    msgs = [
        Message.user("show tool result"),
        Message(
            role=Role.TOOL,
            content=[
                ToolResultBlock(
                    tool_use_id="call_1",
                    content=[TextBlock(text="Here"), ImageBlock(url="https://example.com/a.jpg", detail="high")],
                ),
            ],
            metadata={"tool_name": "image_lookup"},
        ),
    ]

    serialized = serialize_ump_to_openai_chat_payload(msgs, tool_image_policy="inject_user_message")
    assert serialized == [
        {"role": "user", "content": "show tool result"},
        {"role": "tool", "tool_call_id": "call_1", "content": "Here<image>", "name": "image_lookup"},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Images returned by tool call call_1:"},
                {"type": "image_url", "image_url": {"url": "https://example.com/a.jpg", "detail": "high"}},
            ],
            "name": "image_lookup",
        },
    ]

    injected_user = next(m for m in serialized if m.get("role") == "user" and isinstance(m.get("content"), list))
    parts = cast(list[dict[str, Any]], injected_user["content"])
    assert any(p.get("type") == "image_url" for p in parts)


def test_openai_chat_serializer_matches_legacy_tool_image_embed_policy() -> None:
    msgs = [
        Message(
            role=Role.TOOL,
            content=[
                ToolResultBlock(
                    tool_use_id="call_1",
                    content=[TextBlock(text="Here"), ImageBlock(url="https://example.com/a.jpg", detail="high")],
                ),
            ],
        ),
    ]

    serialized = serialize_ump_to_openai_chat_payload(msgs, tool_image_policy="embed_in_tool_message")
    assert serialized == [
        {
            "role": "tool",
            "tool_call_id": "call_1",
            "content": [
                {"type": "text", "text": "Here"},
                {"type": "image_url", "image_url": {"url": "https://example.com/a.jpg", "detail": "high"}},
            ],
        },
    ]


def test_openai_chat_serializer_prunes_past_turn_tool_images() -> None:
    # Turn 1: user asks, tool returns image (in-flight turn)
    turn1_msgs = [
        Message.user("View page 1"),
        Message(
            role=Role.TOOL,
            content=[
                ToolResultBlock(
                    tool_use_id="call_1",
                    content=[TextBlock(text="Page 1: "), ImageBlock(base64="AAAA", mime_type="image/jpeg")],
                ),
            ],
            metadata={"tool_name": "view_file"},
        ),
    ]
    res1 = serialize_ump_to_openai_chat_payload(turn1_msgs)
    assert any(m.get("role") == "user" and isinstance(m.get("content"), list) for m in res1)

    # Turn 2: assistant replied, user asked next question
    turn2_msgs = turn1_msgs + [
        Message(role=Role.ASSISTANT, content=[TextBlock(text="Page 1 shows revenue was $100.")]),
        Message.user("What about expenses?"),
    ]
    res2 = serialize_ump_to_openai_chat_payload(turn2_msgs)
    # In turn 2: turn 1's tool image must be pruned to avoid re-transmitting heavy base64
    tool_msg = next(m for m in res2 if m.get("role") == "tool")
    assert "[Visual tool output from call call_1 analyzed in turn above]" in tool_msg["content"]
    # No extra injected user image message for call_1
    assert not any(
        m.get("role") == "user" and isinstance(m.get("content"), list) and any(p.get("type") == "image_url" for p in m["content"])
        for m in res2
    )

def test_openai_chat_serializer_prunes_past_turn_user_images() -> None:
    # Turn 1: user uploads an image
    turn1_msgs = [
        Message(
            role=Role.USER,
            content=[TextBlock(text="Inspect this receipt:"), ImageBlock(base64="RAW_RECEIPT_B64", mime_type="image/png")],
        ),
        Message(role=Role.ASSISTANT, content=[TextBlock(text="Receipt total is $42.")]),
    ]
    # In Turn 1 (before next user question), user image is preserved
    res1 = serialize_ump_to_openai_chat_payload(turn1_msgs)
    user_msg_1 = res1[0]
    assert any(p.get("type") == "image_url" for p in user_msg_1["content"])

    # Turn 2: user asks a follow-up
    turn2_msgs = turn1_msgs + [Message.user("Was there tax?")]
    res2 = serialize_ump_to_openai_chat_payload(turn2_msgs)
    user_msg_turn1_in_res2 = res2[0]
    # Image in turn 1 must be pruned to text placeholder
    assert not any(p.get("type") == "image_url" for p in user_msg_turn1_in_res2["content"])
    assert any("[User-uploaded image from previous turn analyzed above]" in p.get("text", "") for p in user_msg_turn1_in_res2["content"])

