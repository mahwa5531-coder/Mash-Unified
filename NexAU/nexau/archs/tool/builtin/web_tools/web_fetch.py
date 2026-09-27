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
web_fetch - Wraps web_tool.web_read, output as gemini-cli format.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse
import httpx
import logging

from nexau.archs.permissions.helpers import check_url_permission
from nexau.archs.permissions.types import AskPermission, PermissionDenied

logger = logging.getLogger(__name__)

MAX_WEB_CONTENT_LENGTH = 64 * 1024  # 64KB


def web_read(
    url: str,
    timeout: int = 100,
    use_html_parser: bool = False,
) -> dict[str, Any]:
    """Fetch and read content from a web URL directly via HTTP without legacy parsers."""
    try:
        user_agent = "NexAU-Bot/1.0 (Mozilla/5.0 (Windows NT 10.0; Win64; x64))"
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

        if "html" in content_type.lower():
            try:
                from bs4 import BeautifulSoup
                import markdownify

                soup = BeautifulSoup(content, "html.parser")
                for tag in soup(["script", "style", "noscript", "svg"]):
                    tag.decompose()

                md_text = markdownify.markdownify(str(soup), heading_style="ATX")
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
            content_bytes = content.encode("utf-8")
            if len(content_bytes) > MAX_WEB_CONTENT_LENGTH:
                result["content"] = content_bytes[:MAX_WEB_CONTENT_LENGTH].decode("utf-8", errors="ignore") + "..."
                result["content_truncated"] = True
            else:
                result["content"] = content

        return result
    except httpx.TimeoutException:
        return {"status": "error", "error": f"Request timed out after {timeout} seconds", "url": url, "error_type": "timeout"}
    except httpx.HTTPStatusError as e:
        return {"status": "error", "error": f"HTTP {e.response.status_code}: {str(e)}", "url": url, "error_type": "http_error", "status_code": e.response.status_code}
    except Exception as e:
        return {"status": "error", "error": str(e), "error_type": type(e).__name__, "url": url}


_web_read = web_read

if TYPE_CHECKING:
    from nexau.archs.main_sub.framework_context import FrameworkContext


def _parse_url_from_prompt(text: str) -> tuple[list[str], list[str]]:
    """Extract valid http(s) URLs from prompt text."""
    tokens = text.split()
    valid_urls: list[str] = []
    errors: list[str] = []
    for token in tokens:
        if not token or "://" not in token:
            continue
        try:
            parsed = urlparse(token)
            if parsed.scheme in ("http", "https"):
                valid_urls.append(token)
            else:
                errors.append(f'Unsupported protocol: "{token}". Only http and https supported.')
        except Exception:
            errors.append(f'Malformed URL: "{token}".')
    return valid_urls, errors


def _convert_github_url(url: str) -> str:
    """Convert GitHub blob URL to raw URL."""
    if "github.com" in url and "/blob/" in url:
        return url.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/")
    return url


def web_fetch(
    prompt: str | None = None,
    url: str | None = None,
    timeout: int = 100,
    use_html_parser: bool = True,
    ctx: FrameworkContext | None = None,
) -> dict[str, Any]:
    """
    Fetch content using web_tool.web_read (HtmlParser + direct HTTP).
    Returns gemini-cli format: content, returnDisplay.
    """
    try:
        target_url: str | None = None
        prompt_text = prompt or ""

        if not url and not (prompt or "").strip():
            return {
                "content": "Prompt or URL is required and must be non-empty.",
                "returnDisplay": "Error: Empty prompt.",
                "error": {
                    "message": "Prompt or URL is required and must be non-empty.",
                    "type": "INVALID_PROMPT",
                },
            }

        if url and url.strip():
            target_url = url.strip()
        elif prompt and prompt.strip():
            valid_urls, errors = _parse_url_from_prompt(prompt)
            if errors:
                msg = "Error(s) in prompt URLs:\n- " + "\n- ".join(errors)
                return {
                    "content": msg,
                    "returnDisplay": "Error: Invalid URLs.",
                    "error": {"message": msg, "type": "INVALID_URL"},
                }
            if valid_urls:
                target_url = valid_urls[0]
                prompt_text = prompt

        # CC: permission check
        if ctx is not None and target_url:
            check_url_permission(ctx, target_url)

        if not target_url:
            return {
                "content": "No valid URL provided. Use 'url' or 'prompt' with http(s) URL.",
                "returnDisplay": "Error: No valid URL.",
                "error": {"message": "No valid URL.", "type": "NO_URLS_FOUND"},
            }

        target_url = _convert_github_url(target_url)

        raw = _web_read(
            url=target_url,
            timeout=timeout,
            use_html_parser=use_html_parser,
        )

        if raw.get("status") == "error":
            error_msg = raw.get("error", "Unknown error")
            return {
                "content": f"Error: {error_msg}",
                "returnDisplay": f"Error: {error_msg}",
                "error": {
                    "message": str(error_msg),
                    "type": raw.get("error_type", "WEB_FETCH_ERROR"),
                },
            }

        content = raw.get("content") or raw.get("extracted_text", "")
        if not content and "note" in raw:
            content = raw["note"]
        if not content:
            content = "(No content extracted)"

        req_note = ""
        if prompt_text and prompt_text.strip():
            preview = prompt_text[:80] + "..." if len(prompt_text) > 80 else prompt_text
            req_note = f' Please use it to respond to: "{preview}"'
        else:
            req_note = " Please use it to respond to the original request."

        llm_content = f"""Content fetched from {target_url}:

---
{content}
---

This content was fetched from the URL.{req_note}
"""

        return {
            "content": llm_content,
            "returnDisplay": f"Content for {target_url} processed.",
        }

    except (AskPermission, PermissionDenied):
        raise
    except Exception as e:
        full = str(url or prompt or "")
        url_preview = full[:50] + "..." if len(full) > 50 else full
        error_msg = f'Error processing web content for "{url_preview}": {str(e)}'
        return {
            "content": f"Error: {error_msg}",
            "returnDisplay": f"Error: {error_msg}",
            "error": {
                "message": error_msg,
                "type": "WEB_FETCH_PROCESSING_ERROR",
            },
        }