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

"""Web-related tools for searching and fetching web content."""

import hashlib
import logging
import os
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# Maximum content length for web tools to prevent overwhelming responses
MAX_WEB_CONTENT_LENGTH = 64 * 1024  # 64KB





class HtmlParser:
    """HTML parser for web content extraction."""

    def __init__(self):
        self.base_url: str | None = os.getenv("BP_HTML_PARSER_URL")
        self.api_key: str | None = os.getenv("BP_HTML_PARSER_API_KEY")
        self.secret: str | None = os.getenv("BP_HTML_PARSER_SECRET")

    def parse(self, url: str) -> tuple[bool, str]:
        if not self.base_url or not self.api_key or not self.secret:
            logger.warning("HTML parser configuration is incomplete; skipping parser request")
            return False, ""

        timestamp = str(int(time.time()))
        headers = {
            "X-API-KEY": self.api_key,
            "X-TIMESTAMP": timestamp,
            "X-SIGNATURE": (
                hashlib.sha256(
                    (self.api_key + timestamp + self.secret).encode(),
                ).hexdigest()
            ),
        }
        try:
            with httpx.Client() as client:
                response = client.post(
                    self.base_url,
                    json={"url": url},
                    headers=headers,
                    timeout=30,
                )
        except Exception as e:
            logger.warning(f"Failed to parser {url} with error: {e}")
            return False, ""
        if response.status_code == 200:
            response_data = response.json()
            page_content = response_data.get("content", "")
            return True, page_content
        else:
            logger.warning(
                f"Failed to parser {url} with status code {response.status_code}",
            )
            return False, ""


class DuckDuckGoSearch:
    """Free, zero-config search using DuckDuckGo (ddgs)."""

    def search(self, query: str, num_results: int = 4, search_type: str = "search", **kwargs) -> list[dict[str, Any]]:
        from ddgs import DDGS
        try:
            with DDGS() as ddgs:
                if search_type == "news":
                    raw = list(ddgs.news(query, max_results=num_results))
                else:
                    raw = list(ddgs.text(query, max_results=num_results))
                return [
                    {
                        "title": r.get("title", "Untitled"),
                        "link": r.get("href", r.get("url", "")),
                        "snippet": r.get("body", ""),
                    }
                    for r in raw
                ]
        except Exception as e:
            logger.warning(f"DuckDuckGo search error for '{query}': {e}")
            clean_q = query.replace('"', '').replace("'", "").strip()
            if clean_q != query:
                try:
                    with DDGS() as ddgs:
                        if search_type == "news":
                            raw = list(ddgs.news(clean_q, max_results=num_results))
                        else:
                            raw = list(ddgs.text(clean_q, max_results=num_results))
                        return [
                            {
                                "title": r.get("title", "Untitled"),
                                "link": r.get("href", r.get("url", "")),
                                "snippet": r.get("body", ""),
                            }
                            for r in raw
                        ]
                except Exception:
                    pass
            return []


# Global instances
_html_parser: HtmlParser | None = None


def web_search(
    query: str,
    num_results: int = 10,
    search_type: str = "search",
    proxy_url: str | None = None,
) -> dict[str, Any]:
    """Search the web using DuckDuckGo (free, zero-config)."""
    try:
        ddg = DuckDuckGoSearch()
        results = ddg.search(query, num_results=num_results, search_type=search_type)

        if isinstance(results, str):
            return {
                "status": "error",
                "error": results,
                "query": query,
                "search_type": search_type,
            }
        else:
            return {
                "status": "success",
                "query": query,
                "search_type": search_type,
                "results": results,
                "total_results": len(results),
            }

    except Exception as e:
        return {
            "status": "error",
            "error": str(e),
            "query": query,
            "search_type": search_type,
        }


def web_read(
    url: str,
    timeout: int = 100,
    use_html_parser: bool = True,
) -> dict[str, Any]:
    """
    Fetch and read content from a web URL.

    Args:
        url: URL to fetch
        timeout: Request timeout in seconds
        use_html_parser: Whether to use HTML parser service

    Returns:
        Dict containing web page content
    """
    global _html_parser

    # Try HTML parser service first if configured
    if use_html_parser:
        try:
            if _html_parser is None:
                _html_parser = HtmlParser()

            if all([_html_parser.base_url, _html_parser.api_key, _html_parser.secret]):
                success, content = _html_parser.parse(url)
                if success:
                    # Truncate content if too long (based on byte size)
                    truncated = False
                    content_bytes = content.encode("utf-8")
                    if len(content_bytes) > MAX_WEB_CONTENT_LENGTH:
                        content = content_bytes[:MAX_WEB_CONTENT_LENGTH].decode("utf-8", errors="ignore") + "..."
                        truncated = True
                    return {
                        "status": "success",
                        "url": url,
                        "content": content,
                        "content_truncated": truncated,
                        "method": "html_parser",
                    }
        except Exception as e:
            logger.warning(f"HTML parser failed for {url}: {e}")

    # Fallback to direct HTTP request
    try:
        user_agent = "NexAU-Bot/1.0 (https://github.com/nexau; nexau-agent@gmail.com) Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        headers = {
            "User-Agent": user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        }

        with httpx.Client(timeout=timeout) as client:
            response = client.get(url, headers=headers)
            response.raise_for_status()

        content = response.text
        content_type = response.headers.get("content-type", "")

        result: dict[str, Any] = {
            "status": "success",
            "url": url,
            "status_code": response.status_code,
            "content_type": content_type,
            "content_length": len(content),
            "method": "direct_http",
        }

        # Extract markdown if content is HTML (matching Antigravity read_url_content)
        if "html" in content_type.lower():
            try:
                from bs4 import BeautifulSoup
                import markdownify

                soup = BeautifulSoup(content, "html.parser")

                # Remove non-content elements
                for tag in soup(["script", "style", "noscript", "svg"]):
                    tag.decompose()

                # Convert HTML to clean structured markdown
                md_text = markdownify.markdownify(str(soup), heading_style="ATX")
                
                # Collapse excessive consecutive blank lines
                cleaned_lines = []
                prev_empty = False
                for line in md_text.splitlines():
                    stripped = line.strip()
                    if not stripped:
                        if not prev_empty:
                            cleaned_lines.append("")
                            prev_empty = True
                    else:
                        cleaned_lines.append(line)
                        prev_empty = False
                text = "\n".join(cleaned_lines).strip()

                # Cap extracted markdown at 32KB to prevent context bloat
                MAX_CAP = 32 * 1024
                text_bytes = text.encode("utf-8")
                if len(text_bytes) > MAX_CAP:
                    text = text_bytes[:MAX_CAP].decode("utf-8", errors="ignore") + "\n\n... [Content truncated at 32KB to prevent context bloat.]"
                    result["text_truncated"] = True

                result["extracted_text"] = text
                result["title"] = soup.title.string.strip() if soup.title and soup.title.string else ""

            except Exception as e:
                result["text_extraction_error"] = str(e)
        else:
            # Non-HTML (plain text, JSON, etc.): store raw content with truncation
            content_bytes = content.encode("utf-8")
            if len(content_bytes) > MAX_WEB_CONTENT_LENGTH:
                result["content"] = content_bytes[:MAX_WEB_CONTENT_LENGTH].decode("utf-8", errors="ignore") + "..."
                result["content_truncated"] = True
            else:
                result["content"] = content

        return result

    except httpx.TimeoutException:
        return {
            "status": "error",
            "error": f"Request timed out after {timeout} seconds",
            "url": url,
            "error_type": "timeout",
        }

    except httpx.HTTPStatusError as e:
        return {
            "status": "error",
            "error": f"HTTP {e.response.status_code}: {str(e)}",
            "url": url,
            "error_type": "http_error",
            "status_code": e.response.status_code,
        }

    except Exception as e:
        return {
            "status": "error",
            "error": str(e),
            "error_type": type(e).__name__,
            "url": url,
        }