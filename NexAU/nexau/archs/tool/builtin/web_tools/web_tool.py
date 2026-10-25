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
            # ponytail: Silently fall through when optional external parser credentials are not set
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


# Global instances
_html_parser: HtmlParser | None = None


def _extract_markdown_from_html(content: str) -> tuple[str, str]:
    """Convert HTML to clean structured Markdown without external dependencies beyond bs4."""
    # ponytail: Priority ladder:
    # 1. Trafilatura (if available) for precision article extraction
    # 2. Native bs4 element-to-markdown transformation (zero extra dependencies, always installed)
    text = ""
    title = ""

    try:
        import trafilatura

        extracted = trafilatura.extract(content, output_format="markdown")
        if extracted and extracted.strip():
            text = extracted.strip()
    except Exception:
        pass

    if not text:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(content, "html.parser")
        title = soup.title.string.strip() if soup.title and soup.title.string else ""

        for tag in soup(["script", "style", "noscript", "svg", "iframe"]):
            tag.decompose()

        for h in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6"]):
            level = int(h.name[1])
            h.replace_with(f"\n\n{'#' * level} {h.get_text().strip()}\n\n")

        for p in soup.find_all("p"):
            p.replace_with(f"\n\n{p.get_text().strip()}\n\n")

        for li in soup.find_all("li"):
            li.replace_with(f"\n- {li.get_text().strip()}\n")

        for a in soup.find_all("a"):
            href = a.get("href", "")
            a_text = a.get_text().strip()
            if href and a_text:
                a.replace_with(f"[{a_text}]({href})")

        lines = [line.strip() for line in soup.get_text().splitlines()]
        text = "\n".join(line for line in lines if line)
    else:
        try:
            from bs4 import BeautifulSoup

            soup = BeautifulSoup(content[:4096], "html.parser")
            title = soup.title.string.strip() if soup.title and soup.title.string else ""
        except Exception:
            pass

    return text, title


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

    # Direct HTTP request with redirect following & modern browser user agent
    try:
        user_agent = (
            "MashDesktop/1.0 (Mozilla/5.0 Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36; +https://mash.app)"
        )
        headers = {
            "User-Agent": user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        }

        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            response = client.get(url, headers=headers)
            response.raise_for_status()

        content = response.text
        content_type = response.headers.get("content-type", "")

        result: dict[str, Any] = {
            "status": "success",
            "url": str(response.url),
            "status_code": response.status_code,
            "content_type": content_type,
            "content_length": len(content),
            "method": "direct_http",
        }

        # Extract markdown if content is HTML
        if "html" in content_type.lower():
            try:
                text, title = _extract_markdown_from_html(content)

                # Cap extracted markdown at 32KB to prevent context bloat
                MAX_CAP = 32 * 1024
                text_bytes = text.encode("utf-8")
                if len(text_bytes) > MAX_CAP:
                    text = text_bytes[:MAX_CAP].decode("utf-8", errors="ignore") + "\n\n... [Content truncated at 32KB to prevent context bloat.]"
                    result["text_truncated"] = True

                result["extracted_text"] = text
                result["title"] = title

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
