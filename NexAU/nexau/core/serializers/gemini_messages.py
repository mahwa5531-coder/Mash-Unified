"""Gemini REST request payload serializers.

RFC-0014: UMP  Provider Payload 

Provides serializer helpers for converting UMP messages into Gemini REST
``contents`` / ``systemInstruction`` payloads.
"""

from __future__ import annotations

from typing import Any, cast

from nexau.core.messages import ImageBlock, Message, ReasoningBlock, Role, TextBlock, ToolResultBlock, ToolUseBlock
from nexau.core.serializers.user_projection import project_user_shaped_messages


def serialize_ump_to_gemini_messages_payload(
    messages: list[Message],
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """Convert UMP messages into Gemini REST payloads.

    RFC-0014: Gemini provider payload serializer
    """

    gemini_contents: list[dict[str, Any]] = []
    system_parts: list[dict[str, Any]] = []
    last_tool_call_id_to_name: dict[str, str] = {}
    last_model_function_names: list[str] = []
    tool_result_index = 0

    def _append_function_response(
        func_name: str,
        content: str,
        extra_parts: list[dict[str, Any]] | None = None,
    ) -> None:
        response_part = {"functionResponse": {"name": func_name, "response": {"result": content or "OK"}}}
        parts_to_add = [response_part]
        if extra_parts:
            parts_to_add.extend(extra_parts)

        if gemini_contents and gemini_contents[-1]["role"] == Role.USER.value:
            existing_parts = cast(list[dict[str, Any]], gemini_contents[-1].get("parts", []))
            if any("functionResponse" in part for part in existing_parts):
                existing_parts.extend(parts_to_add)
                return
        gemini_contents.append({"role": Role.USER.value, "parts": parts_to_add})

    projections = list(project_user_shaped_messages(messages))
    total_projections = len(projections)
    for proj_idx, projection in enumerate(projections):
        is_older_turn = proj_idx < total_projections - 2
        message = projection.message
        if message.role == Role.SYSTEM:
            for block in message.content:
                if isinstance(block, TextBlock) and block.text:
                    system_parts.append({"text": block.text})
            continue

        if message.role == Role.USER:
            user_parts: list[dict[str, Any]] = []
            for block in message.content:
                if isinstance(block, TextBlock) and block.text:
                    user_parts.append({"text": block.text})
                elif isinstance(block, ImageBlock):
                    # RFC-0014: ImageBlock → Gemini inline_data / file_data
                    if block.base64:
                        user_parts.append(
                            {
                                "inline_data": {"mime_type": block.mime_type, "data": block.base64},
                            }
                        )
                    elif block.url:
                        user_parts.append({"file_data": {"file_uri": block.url}})
            if projection.contains_framework and gemini_contents and gemini_contents[-1]["role"] == Role.USER.value:
                previous_parts = cast(list[dict[str, Any]], gemini_contents[-1].get("parts", []))
                if any("functionResponse" in part for part in previous_parts):
                    # Gemini requires user/model alternation. Keep the tool
                    # response first and append the framework instruction to
                    # the same provider USER turn.
                    previous_parts.extend(user_parts)
                    continue
            gemini_contents.append({"role": Role.USER.value, "parts": user_parts})
            continue

        if message.role == Role.ASSISTANT:
            assistant_parts: list[dict[str, Any]] = []
            thought_signature = message.metadata.get("thought_signature")
            attached_thought_signature = False
            last_model_function_names = []
            tool_result_index = 0
            has_tool_use = any(isinstance(block, ToolUseBlock) for block in message.content)

            for block in message.content:
                if isinstance(block, ReasoningBlock) and block.text:
                    reasoning_part: dict[str, Any] = {"text": block.text, "thought": True}
                    if not has_tool_use and not attached_thought_signature and isinstance(thought_signature, str) and thought_signature:
                        reasoning_part["thoughtSignature"] = thought_signature
                        attached_thought_signature = True
                    assistant_parts.append(reasoning_part)
                elif isinstance(block, TextBlock) and block.text:
                    assistant_parts.append({"text": block.text})
                elif isinstance(block, ToolUseBlock):
                    function_call_part: dict[str, Any] = {
                        "functionCall": {"name": block.name, "args": block.input},
                    }
                    if not attached_thought_signature and isinstance(thought_signature, str) and thought_signature:
                        function_call_part["thoughtSignature"] = thought_signature
                        attached_thought_signature = True
                    assistant_parts.append(function_call_part)
                    last_model_function_names.append(block.name)
                    last_tool_call_id_to_name[block.id] = block.name

            if not attached_thought_signature and isinstance(thought_signature, str) and thought_signature and assistant_parts:
                assistant_parts[0]["thoughtSignature"] = thought_signature

            gemini_contents.append({"role": "model", "parts": assistant_parts})
            continue

        if message.role == Role.TOOL:
            for block in message.content:
                if not isinstance(block, ToolResultBlock):
                    continue

                func_name = last_tool_call_id_to_name.get(block.tool_use_id)
                if func_name is None and tool_result_index < len(last_model_function_names):
                    func_name = last_model_function_names[tool_result_index] or None
                tool_result_index += 1
                if func_name is None:
                    metadata_name = message.metadata.get("tool_name")
                    if isinstance(metadata_name, str) and metadata_name:
                        func_name = metadata_name
                if func_name is None:
                    raise ValueError(
                        f"Function name is required for tool result messages (tool_use_id={block.tool_use_id})",
                    )

                extra_parts: list[dict[str, Any]] = []
                if isinstance(block.content, list):
                    response_text = "".join(part.text for part in block.content if isinstance(part, TextBlock))
                    for part in block.content:
                        if isinstance(part, ImageBlock):
                            if part.base64:
                                extra_parts.append({
                                    "inlineData": {
                                        "mimeType": part.mime_type or "image/jpeg",
                                        "data": part.base64,
                                    }
                                })
                            elif part.url:
                                extra_parts.append({"fileData": {"fileUri": part.url}})
                else:
                    response_text = block.content
                _append_function_response(func_name, response_text, extra_parts=extra_parts)

    system_instruction = {"parts": system_parts} if system_parts else None
    return gemini_contents, system_instruction