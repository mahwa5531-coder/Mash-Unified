# Copyright (c) Mash. All rights reserved.
"""Statutory audit and platform tools for Mash (canonical exports from NexAU)."""

from nexau.archs.tool.builtin import (
    audit_skill_tool,
    view_file,
    replace_file_content,
    search_file_content,
    duckduckgo_search,
)

__all__ = [
    "audit_skill_tool",
    "view_file",
    "replace_file_content",
    "search_file_content",
    "duckduckgo_search",
]
