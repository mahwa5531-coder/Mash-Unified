from typing import Any, cast

from nexau.core.adapters.legacy import messages_from_legacy_openai_chat
from nexau.core.messages import ImageBlock, Message, Role, TextBlock, ToolResultBlock
from nexau.core.serializers.openai_chat import serialize_ump_to_openai_chat_payload


def test_chat_completions_tool_result_images_are_injected_as_user_message() -> None:
    """Chat Completions tool messages support text only; images must be provided via user multimodal messages."""

    msgs = [
        Message.user("hi"),
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

    payload: list[dict[str, Any]] = serialize_ump_to_openai_chat_payload(msgs, tool_image_policy="inject_user_message")
    # Expect tool message contains only text (images replaced by placeholder)
    tool = next(m for m in payload if m.get("role") == "tool")
    assert tool["tool_call_id"] == "call_1"
    assert isinstance(tool["content"], str)
    assert "<image>" in tool["content"]

    # And an extra user message carries the actual image_url parts
    injected_user = next(m for m in payload if m.get("role") == "user" and isinstance(m.get("content"), list))
    parts = cast(list[dict[str, Any]], injected_user["content"])
    assert any(p.get("type") == "image_url" for p in parts)
    image_part = next(p for p in parts if p.get("type") == "image_url")
    assert image_part["image_url"]["url"] == "https://example.com/a.jpg"
    assert image_part["image_url"]["detail"] == "high"


def test_responses_policy_embeds_tool_result_images_in_tool_message_parts() -> None:
    """Responses input reconstruction may embed image_url parts inside the tool message content list."""

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

    payload: list[dict[str, Any]] = serialize_ump_to_openai_chat_payload(msgs, tool_image_policy="embed_in_tool_message")
    tool = next(m for m in payload if m.get("role") == "tool")
    tool_content = cast(list[dict[str, Any]], tool["content"])
    assert any(p.get("type") == "image_url" for p in tool_content)
