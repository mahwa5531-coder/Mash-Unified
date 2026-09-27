"""Vendor adapters for converting UMP messages to provider payloads."""
# ponytail: Standardized on OpenAI-compatible gateway (Bifrost)

from .base import LLMAdapter  # noqa: F401  # pyright: ignore[reportUnusedImport]
from .legacy import messages_from_legacy_openai_chat  # noqa: F401  # pyright: ignore[reportUnusedImport]
from .openai_chat import OpenAIChatAdapter  # noqa: F401  # pyright: ignore[reportUnusedImport]

__all__ = [
    "LLMAdapter",
    "OpenAIChatAdapter",
    "messages_from_legacy_openai_chat",
]