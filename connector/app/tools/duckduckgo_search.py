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


def _format_citations(results: list[dict[str, Any]]) -> str:
    """Format search results into clean, readable citations."""
    lines: list[str] = []
    for idx, item in enumerate(results, 1):
        title = item.get("title", "Untitled").strip()
        url = item.get("href", item.get("url", "")).strip()
        snippet = item.get("body", item.get("snippet", "")).strip().replace("\n", " ")
        if len(snippet) > 350:
            snippet = snippet[:350] + "..."
        lines.append(f"[{idx}] {title} ({url})\n    {snippet}")
    return "\n\n".join(lines) if lines else "No relevant web results found."


def duckduckgo_web_search(
    query: str,
    domain: str | None = None,
    num_results: int = 4,
    **kwargs: Any,
) -> dict[str, Any]:
    """Search the web using DuckDuckGo with domain prioritization and clean citations.
    
    Args:
        query: Search query string.
        domain: Optional domain to restrict the search (e.g., 'arxiv.org', 'github.com').
        num_results: Maximum results to return (default: 4).
    """
    if not query or not query.strip():
        return {
            "content": "The 'query' parameter cannot be empty.",
            "returnDisplay": "Error: Empty search query.",
            "error": {"message": "The 'query' parameter cannot be empty.", "type": "INVALID_QUERY"},
        }

    search_query = query.strip()
    if DDGS is None:
        return {
            "content": "Web search is unavailable: 'ddgs' package is not installed.",
            "returnDisplay": "Web search unavailable.",
            "error": {"message": "Neither 'ddgs' nor 'duckduckgo_search' is installed.", "type": "DEPENDENCY_MISSING"},
            "sources": [],
        }

    if domain and domain.strip() and f"site:{domain.strip()}" not in search_query:
        search_query = f"site:{domain.strip()} {search_query}"

    max_count = max(1, min(int(num_results or 4), 20))

    try:
        raw_results = DDGS().text(search_query, max_results=max_count) or []
        formatted_sources = [
            {
                "title": r.get("title", "Untitled"),
                "url": r.get("href", r.get("url", "")),
                "snippet": r.get("body", r.get("snippet", "")),
            }
            for r in raw_results
        ]
        citation_text = _format_citations(formatted_sources)

        return {
            "content": f'Web search results for "{query}":\n\n{citation_text}',
            "returnDisplay": f'Search results for "{query}" returned ({len(formatted_sources)} results).',
            "sources": formatted_sources,
        }
    except Exception as e:
        logger.warning("DuckDuckGo search error for query '%s': %s", query, e)
        return {
            "content": f"Web search could not be completed: {e}",
            "returnDisplay": "Web search encountered an error.",
            "error": {"message": str(e), "type": "WEB_SEARCH_FAILED"},
            "sources": [],
        }


web_search = duckduckgo_web_search
google_web_search = duckduckgo_web_search
duckduckgo_search = duckduckgo_web_search
