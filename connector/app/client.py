# Copyright (c) Nex-AGI. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Centralized MASh Cloud API Client for Desktop Connector.

Provides a unified, resilient interface for Authentication, Account/Quota state,
and OpenAI-compatible LLM routing against the MASh Cloud API.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from typing import Any
from urllib.parse import urlparse

import httpx
from nexau.archs.platform.app_config import AppConfig

logger = logging.getLogger(__name__)


def _validate_cloud_gateway_url(url: str) -> str:
    """Require HTTPS for cloud gateway URLs in frozen production builds unless explicitly opted out."""
    cleaned = url.rstrip("/")
    parsed = urlparse(cleaned)
    if (
        getattr(sys, "frozen", False)
        and os.getenv("MASH_ALLOW_INSECURE_GATEWAY", "").lower() not in ("1", "true", "yes")
        and parsed.scheme != "https"
    ):
        raise ValueError(f"Insecure cloud gateway URL blocked in production build: {cleaned}")
    return cleaned


def resolve_cloud_gateway_url() -> str:
    """Resolve the MASH Cloud gateway base URL from env, saved config, or default."""
    config = AppConfig.load()
    raw = (
        os.getenv("MASH_API_BASE_URL")
        or os.getenv("CLOUD_GATEWAY_URL")
        or os.getenv("GATEWAY_URL")
        or config.model.gateway_url
        or "https://api.mash.ai"
    )
    return _validate_cloud_gateway_url(raw)


class MAShClient:
    """Centralized client for all desktop-to-cloud communications.

    Single source of truth for cloud network calls. Prevents scattered
    httpx/requests logic across the codebase.
    """

    def __init__(self, base_url: str | None = None, timeout: float = 30.0):
        self.base_url = _validate_cloud_gateway_url(base_url) if base_url else resolve_cloud_gateway_url()
        self.timeout = httpx.Timeout(connect=5.0, read=timeout, write=10.0, pool=10.0)

    def _client(self, timeout: httpx.Timeout | float | None = None) -> httpx.AsyncClient:
        """Disable redirect following so bearer/refresh tokens can never leak off-origin."""
        return httpx.AsyncClient(timeout=timeout or self.timeout, follow_redirects=False)

    # --- Authentication Lifecycle ---

    async def exchange_desktop_code(
        self, code: str, device_name: str = "MASH Desktop"
    ) -> dict[str, Any]:
        """Exchanges single-use mcode from browser OAuth for access + refresh token pair."""
        async with self._client() as client:
            resp = await client.post(
                f"{self.base_url}/v1/auth/desktop/exchange",
                json={
                    "code": code,
                    "device_name": device_name,
                    "platform": "windows",
                },
                headers={"Content-Type": "application/json", "Accept": "application/json"},
            )
            resp.raise_for_status()
            return resp.json()

    async def refresh_access_token(self, refresh_token: str) -> dict[str, Any]:
        """Rotates expired access token using the 30-day sliding refresh token."""
        async with self._client() as client:
            resp = await client.post(
                f"{self.base_url}/v1/auth/refresh",
                json={"refresh_token": refresh_token},
                headers={"Content-Type": "application/json", "Accept": "application/json"},
            )
            # Fallback to legacy path if old gateway version
            if resp.status_code == 404:
                resp = await client.post(
                    f"{self.base_url}/api/auth/refresh",
                    json={"refresh_token": refresh_token},
                    headers={"Content-Type": "application/json", "Accept": "application/json"},
                )
            resp.raise_for_status()
            return resp.json()

    async def logout(self, refresh_token: str, access_token: str | None = None) -> bool:
        """Revokes active refresh token on cloud."""
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if access_token:
            headers["Authorization"] = f"Bearer {access_token}"
        try:
            async with self._client(timeout=5.0) as client:
                resp = await client.post(
                    f"{self.base_url}/v1/auth/logout",
                    json={"refresh_token": refresh_token},
                    headers=headers,
                )
                return resp.status_code == 200
        except Exception as e:
            logger.debug("Cloud logout call failed: %s", e)
            return False

    # --- Account & Quota State ---

    async def get_me(self, access_token: str) -> dict[str, Any]:
        """Fetches authoritative user identity, plan, models, and rolling-window quota position."""
        for idx, delay in enumerate((0.5, 1.5, None)):
            try:
                async with self._client() as client:
                    resp = await client.get(
                        f"{self.base_url}/v1/me",
                        headers={
                            "Authorization": f"Bearer {access_token}",
                            "Accept": "application/json",
                        },
                    )
                    resp.raise_for_status()
                    return resp.json()
            except (httpx.ConnectTimeout, httpx.ConnectError):
                if delay is None:
                    raise
                logger.debug("Cloud /v1/me connect error (attempt %d), retrying in %.1fs", idx + 1, delay)
                await asyncio.sleep(delay)
        raise RuntimeError("Unreachable get_me retry loop")

    async def get_usage(self, access_token: str) -> dict[str, Any]:
        """Fetches live token usage and percentage against quota from cloud."""
        async with self._client() as client:
            resp = await client.get(
                f"{self.base_url}/v1/usage",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/json",
                },
            )
            resp.raise_for_status()
            return resp.json()

    async def get_config(self, access_token: str | None = None) -> dict[str, Any]:
        """Fetches client integration configuration from cloud."""
        headers: dict[str, str] = {"Accept": "application/json"}
        if access_token:
            headers["Authorization"] = f"Bearer {access_token}"
        async with self._client(timeout=5.0) as client:
            resp = await client.get(f"{self.base_url}/v1/config", headers=headers)
            resp.raise_for_status()
            return resp.json()
