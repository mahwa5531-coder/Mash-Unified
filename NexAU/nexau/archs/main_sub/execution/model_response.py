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

"""Normalized representation of model responses and tool calls."""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, cast

from json_repair import repair_json

from nexau.core.usage import TokenUsage, UsageConverterRegistry, fallback_normalize_usage

if TYPE_CHECKING:
    from nexau.core.messages import Message

JsonDict = dict[str, Any]


def _empty_json_dict() -> JsonDict:
    return {}


def _empty_tool_call_list() -> list[ModelToolCall]:
    return []


def _empty_json_dict_list() -> list[JsonDict]:
    return []


def _empty_int_list() -> list[int]:
    return []


def _item_get(item: object, key: str, default: Any = None) -> Any:
    """Best-effort attribute/dict access helper for SDK objects."""

    if isinstance(item, Mapping):
        mapping_item = cast(Mapping[str, Any], item)
        return mapping_item.get(key, default)

    if hasattr(item, key):
        return getattr(item, key)

    return default


def _to_serializable_dict(payload: Any) -> dict[str, Any]:
    """Attempt to coerce SDK payloads into simple dicts for parsing."""

    if isinstance(payload, dict):
        return cast(JsonDict, payload)

    # Prefer model_dump if available (pydantic models)
    model_dump = getattr(payload, "model_dump", None)
    if callable(model_dump):
        try:
            # See `nexau.archs.main_sub.execution.llm_caller._to_serializable_dict`:
            # some SDK models can trigger Pydantic's serializer warnings during dump.
            try:
                return cast(dict[str, Any], model_dump(mode="json", warnings=False))
            except TypeError:
                try:
                    return cast(dict[str, Any], model_dump(warnings=False))
                except TypeError:
                    return cast(dict[str, Any], model_dump())
        except Exception:  # pragma: no cover - fallback
            pass

    # Fallback to attribute introspection (best-effort, non-recursive)
    result: JsonDict = {}
    for attr in dir(payload):  # pragma: no cover - defensive
        if attr.startswith("_"):
            continue
        try:
            value = getattr(payload, attr)
        except Exception:
            continue
        if callable(value):
            continue
        result[attr] = value
    return result


def _coerce_usage(usage: Any) -> dict[str, Any] | None:
    """Best-effort conversion of SDK usage payloads (or mocks) into a dict."""

    if usage is None:
        return None

    if isinstance(usage, Mapping):
        try:
            return dict(cast(Mapping[str, Any], usage))
        except Exception:
            # Fall back to a looser conversion path below
            pass

    if isinstance(usage, dict):  # type: ignore[redundant-expr]
        return cast(dict[str, Any], usage)

    try:
        return _to_serializable_dict(usage)
    except Exception:
        return None


def _normalize_usage(usage: dict[str, Any] | None, api_type: str | None = None) -> TokenUsage:
    """Normalize provider-specific usage payloads into TokenUsage."""
    usage = _coerce_usage(usage)
    if usage is None:
        return TokenUsage()

    if api_type is not None:
        converter = UsageConverterRegistry.get(api_type)
        if converter is not None:
            return converter.convert(dict(usage))

    return fallback_normalize_usage(dict(usage))


@dataclass
class ModelToolCall:
    """Represents a tool call emitted by the model in a model-agnostic format."""

    call_id: str | None
    name: str
    arguments: JsonDict = field(default_factory=_empty_json_dict)
    raw_arguments: str | None = None
    call_type: str = "function"
    raw_call: Any = None

    @classmethod
    def from_openai(cls, call: Any) -> ModelToolCall:
        """Create a ModelToolCall from an OpenAI tool call payload."""
        if call is None:
            raise ValueError("call payload cannot be None")

        # Support both dict-style and attribute-style payloads
        call_id: str | None = None
        if isinstance(call, dict):
            call_dict = cast(JsonDict, call)
            raw_id: Any = call_dict.get("id")
            call_id = str(raw_id) if raw_id is not None else None
            call_type_raw: Any = call_dict.get("type")
            function: Any = call_dict.get("function")
        else:
            call_id_attr = getattr(call, "id", None)
            call_id = str(call_id_attr) if call_id_attr is not None else None
            call_type_raw = getattr(call, "type", "function")
            function = getattr(call, "function", None)

        call_type: str = str(call_type_raw) if call_type_raw else "function"

        if function is None:
            raise ValueError("OpenAI tool call payload missing function block")

        if isinstance(function, dict):
            func_dict = cast(JsonDict, function)
            name = func_dict.get("name")
            raw_arguments = func_dict.get("arguments")
        else:
            name = getattr(function, "name", None)
            raw_arguments = getattr(function, "arguments", None)

        if not name:
            raise ValueError("OpenAI tool call function block missing name")

        parsed_arguments: JsonDict = {}
        normalized_raw_arguments: str | None = None
        if isinstance(raw_arguments, str):
            raw_arguments_str = raw_arguments.strip()
            if raw_arguments_str:
                try:
                    good_json_string = repair_json(raw_arguments_str)
                    parsed = json.loads(good_json_string)
                    if isinstance(parsed, dict):
                        parsed_arguments = cast(JsonDict, parsed)
                    else:
                        parsed_arguments = {"_": parsed}
                except json.JSONDecodeError:
                    # Always keep a valid JSON object string in raw_arguments to avoid downstream tool-call validation failures.
                    parsed_arguments = {"raw_arguments": raw_arguments_str}
            normalized_raw_arguments = json.dumps(parsed_arguments, ensure_ascii=False)
        elif raw_arguments is not None:
            if isinstance(raw_arguments, dict):
                parsed_arguments = cast(JsonDict, raw_arguments)
                normalized_raw_arguments = json.dumps(parsed_arguments, ensure_ascii=False)
            else:
                parsed_arguments = {"raw_arguments": json.dumps(raw_arguments, ensure_ascii=False)}
                normalized_raw_arguments = json.dumps(parsed_arguments, ensure_ascii=False)
        return cls(
            call_id=call_id,
            name=name,
            arguments=parsed_arguments,
            raw_arguments=normalized_raw_arguments,
            call_type=call_type or "function",
            raw_call=call,
        )

    def to_openai_dict(self) -> dict[str, Any]:
        """Convert the tool call back to OpenAI-compatible dict."""
        function_body: dict[str, Any] = {"name": self.name}
        if self.raw_arguments is not None:
            function_body["arguments"] = self.raw_arguments
        else:
            function_body["arguments"] = json.dumps(self.arguments, ensure_ascii=False)
        return {
            "id": self.call_id,
            "type": self.call_type,
            "function": function_body,
        }


@dataclass
class ModelResponse:
    """Normalized model response returned by LLMCaller."""

    content: str | None = None
    tool_calls: list[ModelToolCall] = field(default_factory=_empty_tool_call_list)
    role: str = "assistant"
    raw_message: Any = None
    response_items: list[JsonDict] = field(default_factory=_empty_json_dict_list)
    output_token_ids: list[int] = field(default_factory=_empty_int_list)
    reasoning_content: str | None = None
    """A description of the chain of thought used by a reasoning model while generating a response.

    Be sure to include these items in your input to the Responses API for subsequent turns of a
    conversation if you are manually managing context.
    """
    reasoning_details: list[JsonDict] | None = None
    """Structured reasoning details (OpenRouter wire format).

    Distinct from ``reasoning_content`` - OpenRouter requires the exact list of blocks
    (``reasoning.text`` / ``reasoning.summary`` / ``reasoning.encrypted`` ...) to be echoed
    back unmodified on subsequent turns, so we preserve it verbatim.
    """
    reasoning_signature: str | None = None
    """Optional signature for the reasoning content (used by Anthropic)."""
    reasoning_redacted_data: str | None = None
    """Optional encrypted data for redacted reasoning (used by Anthropic)."""
    thought_signature: str | None = None
    """Gemini-specific thought signature for preserving reasoning context across turns."""
    usage: TokenUsage = field(default_factory=TokenUsage)
    """Canonical token usage information for the model response."""

    def __post_init__(self) -> None:
        self.tool_calls = list(self.tool_calls)
        self.response_items = list(self.response_items)
        self.output_token_ids = [int(token) for token in self.output_token_ids]
        usage = cast(TokenUsage | None, self.usage)
        if usage is None:
            self.usage = TokenUsage()

    @classmethod
    def from_openai_message(cls, message: Any, usage: dict[str, Any] | None = None) -> ModelResponse:
        """Create a ModelResponse from an OpenAI chat completion message.

        Args:
            message: The message object from OpenAI response
            usage: Optional usage statistics from the response object
        """
        if message is None:
            raise ValueError("message cannot be None")

        message_dict: JsonDict | None = cast(JsonDict, message) if isinstance(message, dict) else None
        message_obj: Any = cast(Any, message)

        content = getattr(message_obj, "content", None)
        if content is None and message_dict is not None:
            content = message_dict.get("content")
        # openai-beta returns list of content parts; join if needed
        if isinstance(content, list):
            # Attempt to join textual content pieces
            content_list: list[Any] = cast(list[Any], content)
            text_parts: list[str] = []
            for part in content_list:
                if isinstance(part, dict):
                    part_dict = cast(dict[str, Any], part)
                    text_val = part_dict.get("text", "")
                    text_parts.append(text_val if isinstance(text_val, str) else str(text_val))
                else:
                    text_parts.append(str(part))
            content = "".join(text_parts)

        raw_tool_calls: list[Any] | None = getattr(message_obj, "tool_calls", None)
        if raw_tool_calls is None and message_dict is not None:
            tool_calls_value = message_dict.get("tool_calls")
            raw_tool_calls = cast(list[Any], tool_calls_value) if isinstance(tool_calls_value, list) else None

        tool_calls: list[ModelToolCall] = []
        if raw_tool_calls:
            for call in raw_tool_calls:
                try:
                    tool_calls.append(ModelToolCall.from_openai(call))
                except Exception:
                    # If parsing fails, create minimal placeholder
                    tool_calls.append(
                        ModelToolCall(
                            call_id=getattr(call, "id", None) if not isinstance(call, dict) else cast(dict[str, Any], call).get("id"),
                            name="unknown",
                            arguments={"raw_call": call},
                            raw_arguments=None,
                            call_type=getattr(call, "type", "function")
                            if not isinstance(call, dict)
                            else cast(dict[str, Any], call).get("type", "function"),
                            raw_call=call,
                        ),
                    )

        # Extract reasoning_content if available (e.g. DeepSeek / Qwen / vLLM style:
        # a single aggregated string of chain-of-thought). Falls back to the
        # bare ``reasoning`` key (Step / others), normalizing both wire shapes
        # to the same canonical slot.
        reasoning_content = None
        if hasattr(message_obj, "reasoning_content"):
            reasoning_content = getattr(message_obj, "reasoning_content")
        elif message_dict is not None and "reasoning_content" in message_dict:
            reasoning_content = message_dict["reasoning_content"]
        elif hasattr(message_obj, "reasoning"):
            reasoning_content = getattr(message_obj, "reasoning")
        elif message_dict is not None and "reasoning" in message_dict:
            reasoning_content = message_dict["reasoning"]

        # Extract reasoning_details verbatim (OpenRouter style: a list of structured blocks -
        # reasoning.text / reasoning.summary / reasoning.encrypted - that must be echoed back
        # unmodified on subsequent turns for multi-turn reasoning context). Keep the raw shape.
        reasoning_details_raw: Any = None
        if hasattr(message_obj, "reasoning_details"):
            reasoning_details_raw = getattr(message_obj, "reasoning_details")
        elif message_dict is not None and "reasoning_details" in message_dict:
            reasoning_details_raw = message_dict["reasoning_details"]
        reasoning_details: list[JsonDict] | None = None
        if isinstance(reasoning_details_raw, list):
            preserved: list[JsonDict] = []
            for entry in cast(list[Any], reasoning_details_raw):
                if isinstance(entry, dict):
                    preserved.append(dict(cast(dict[str, Any], entry)))
                else:
                    # Non-dict entries are uncommon; serialize defensively so we don't drop state.
                    preserved.append(_to_serializable_dict(entry))
            if preserved:
                reasoning_details = preserved

        # Extract usage information if available in the message itself
        message_usage: JsonDict | None = None
        if hasattr(message_obj, "usage"):
            message_usage = _to_serializable_dict(getattr(message_obj, "usage"))
        elif message_dict is not None and "usage" in message_dict:
            raw_usage: Any = message_dict.get("usage")
            message_usage = _to_serializable_dict(raw_usage) if raw_usage is not None else None

        # Prefer explicitly passed usage over message-embedded usage
        final_usage = usage if usage is not None else message_usage

        role = getattr(message_obj, "role", "assistant") if message_dict is None else message_dict.get("role", "assistant")
        return cls(
            content=content,
            tool_calls=tool_calls,
            role=role,
            raw_message=message,
            reasoning_content=reasoning_content if isinstance(reasoning_content, str) else None,
            reasoning_details=reasoning_details,
            usage=_normalize_usage(final_usage, "openai_chat_completion"),
        )

    def has_content(self) -> bool:
        return bool((self.content and self.content.strip()) or self.reasoning_content)

    def has_tool_calls(self) -> bool:
        return bool(self.tool_calls)

    def render_text(self) -> str:
        """Render the response as a human-readable string for logging."""
        parts: list[str] = []
        if self.reasoning_content:
            parts.append(f"[reasoning]\n{self.reasoning_content}")
        if self.has_content() and self.content:
            parts.append(self.content.strip())
        for call in self.tool_calls:
            try:
                arg_preview = json.dumps(call.arguments, ensure_ascii=False)
            except TypeError:
                arg_preview = str(call.arguments)
            parts.append(
                f"[tool_call id={call.call_id or 'unknown'} name={call.name} args={arg_preview}]",
            )
        return "\n".join(parts).strip()

    def to_message_dict(self) -> dict[str, Any]:
        """Convert response into chat completion message dict."""
        message: dict[str, Any] = {"role": self.role, "content": self.content or ""}
        if self.tool_calls:
            message["tool_calls"] = [call.to_openai_dict() for call in self.tool_calls]
        if self.response_items:
            message["response_items"] = self.response_items
        if self.reasoning_content is not None:
            message["reasoning_content"] = self.reasoning_content
        if self.reasoning_details:
            message["reasoning_details"] = self.reasoning_details
        if self.reasoning_signature:
            message["reasoning_signature"] = self.reasoning_signature
        if self.reasoning_redacted_data:
            message["reasoning_redacted_data"] = self.reasoning_redacted_data
        if self.thought_signature:
            # For Gemini thought signature passthrough
            message["thought_signature"] = self.thought_signature
        return message

    def to_ump_message(self) -> Message:
        """Convert response into a vendor-agnostic UMP `Message`."""

        from nexau.core.messages import Message, ReasoningBlock, Role, TextBlock, ToolUseBlock

        try:
            role = Role(self.role)
        except Exception:
            role = Role.ASSISTANT

        blocks: list[Any] = []

        # Insert reasoning block BEFORE text content (Anthropic requires thinking first)
        if self.reasoning_content is not None:
            blocks.append(
                ReasoningBlock(
                    text=self.reasoning_content,
                    signature=self.reasoning_signature,
                    redacted_data=self.reasoning_redacted_data,
                )
            )

        if self.content:
            blocks.append(TextBlock(text=self.content))

        for call in self.tool_calls:
            blocks.append(
                ToolUseBlock(
                    id=call.call_id or "tool_call",
                    name=call.name,
                    input=call.arguments,
                    raw_input=call.raw_arguments,
                ),
            )

        # micro-compact: created_at, TimeBasedTrigger
        from datetime import UTC, datetime

        msg = Message(role=role, content=blocks, created_at=datetime.now(UTC))
        msg.metadata["usage"] = self.usage.to_dict()
        if self.response_items:
            msg.metadata["response_items"] = self.response_items
        if self.reasoning_details:
            msg.metadata["reasoning_details"] = self.reasoning_details
        if self.thought_signature:
            msg.metadata["thought_signature"] = self.thought_signature
        return msg

    def __str__(self) -> str:  # pragma: no cover - convenience
        rendered = self.render_text()
        return rendered if rendered else ""