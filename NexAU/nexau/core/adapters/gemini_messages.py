"""Gemini REST adapters built from neutral UMP messages.

RFC-0006: Gemini  structured adapter 

Gemini  ``contents`` / ``systemInstruction``, 
 structured tool calling  OpenAI . 
"""

from __future__ import annotations

from typing import Any

from nexau.core.adapters.base import LLMAdapter
from nexau.core.messages import Message
from nexau.core.serializers.gemini_messages import serialize_ump_to_gemini_messages_payload


class GeminiMessagesAdapter(LLMAdapter):
    """Convert UMP messages into Gemini REST payloads.

    RFC-0006: Gemini 

     UMP Message list,  Gemini REST 
    ``contents`` / ``systemInstruction``,  OpenAI message . 
    """

    def to_vendor_format(self, messages: list[Message]) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
        return serialize_ump_to_gemini_messages_payload(messages)

    def from_vendor_response(self, response: Any) -> Message:  # pragma: no cover - not wired yet
        raise NotImplementedError