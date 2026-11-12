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

"""
DuckDuckGo web search builtin tool for NexAU / Mash.
Free, requires zero API keys, and works out-of-the-box.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

try:
    from ddgs import DDGS
except ImportError:
    try:
        from duckduckgo_search import DDGS  # type: ignore[no-redef]
    except ImportError:
        DDGS = None  # type: ignore[assignment]


def _format_citations(sources: list[dict[str, str]]) -> str:
    """Format normalized search sources into readable numbered citations."""
    lines = []
    for idx, src in enumerate(sources, 1):
        snippet = src["snippet"].replace("\n", " ")
        if len(snippet) > 350:
            snippet = snippet[:350] + "..."
        lines.append(f"[{idx}] {src['title']} ({src['url']})\n    {snippet}")
    return "\n\n".join(lines) if lines else "No relevant web results found."


def duckduckgo_web_search(
    query: str | None = None,
    domain: str | None = None,
    num_results: int | None = None,
    **kwargs: Any,
) -> dict[str, Any]:
    """Search the web using DuckDuckGo with optional domain restriction and citations.

    Args:
        query: Search query string.
        domain: Optional domain to restrict results (e.g., 'arxiv.org', 'github.com').
        num_results: Maximum number of results to return (clamped to 1..20, default 4).
    """
    raw_query = query if query is not None else (kwargs.get("Query") or kwargs.get("search_query") or kwargs.get("q") or "")
    clean_query = str(raw_query).strip()
    if not clean_query:
        return {
            "content": "The 'query' parameter cannot be empty.",
            "returnDisplay": "Error: Empty search query.",
            "error": {"message": "The 'query' parameter cannot be empty.", "type": "INVALID_QUERY"},
        }

    if DDGS is None:
        return {
            "content": "Web search is unavailable: 'ddgs' package is not installed.",
            "returnDisplay": "Web search unavailable.",
            "error": {"message": "Neither 'ddgs' nor 'duckduckgo_search' is installed.", "type": "DEPENDENCY_MISSING"},
            "sources": [],
        }

    raw_domain = domain if domain is not None else (kwargs.get("Domain") or kwargs.get("site") or "")
    clean_domain = str(raw_domain).strip()
    effective_query = (
        f"site:{clean_domain} {clean_query}"
        if clean_domain and f"site:{clean_domain}" not in clean_query
        else clean_query
    )

    raw_count = num_results if num_results is not None else (kwargs.get("limit") or kwargs.get("max_results") or 4)
    try:
        max_count = max(1, min(int(raw_count), 20))
    except (TypeError, ValueError):
        max_count = 4

    try:
        raw_results = list(DDGS().text(effective_query, max_results=max_count) or [])
        sources = [
            {
                "title": str(r.get("title") or "Untitled").strip(),
                "url": str(r.get("href") or r.get("url") or "").strip(),
                "snippet": str(r.get("body") or r.get("snippet") or "").strip(),
            }
            for r in raw_results
        ]
        citations = _format_citations(sources)

        return {
            "content": f'Web search results for "{clean_query}":\n\n{citations}',
            "returnDisplay": f'Search results for "{clean_query}" returned ({len(sources)} results).',
            "sources": sources,
        }
    except Exception as e:
        logger.warning("DuckDuckGo search error for query '%s': %s", clean_query, e)
        return {
            "content": f"Web search could not be completed: {e}",
            "returnDisplay": "Web search encountered an error.",
            "error": {"message": str(e), "type": "WEB_SEARCH_FAILED"},
            "sources": [],
        }


# Canonical aliases
web_search = duckduckgo_web_search
google_web_search = duckduckgo_web_search
