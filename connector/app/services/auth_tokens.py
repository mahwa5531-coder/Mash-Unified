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

"""Token lifecycle unit: 15m RAM JWTs + 30d DPAPI sliding refresh token rotation."""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
import weakref
from typing import Any

import httpx
from nexau.archs.platform.crypto_vault import (
    _IN_MEMORY_AUTH_META,
    get_auth_metadata,
    load_secure_vault,
    save_secure_vault,
)

from app.client import MAShClient

logger = logging.getLogger(__name__)

_refresh_locks: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Lock] = weakref.WeakKeyDictionary()


def _get_refresh_lock() -> asyncio.Lock:
    """Return the single-flight refresh lock scoped to the active asyncio event loop."""
    loop = asyncio.get_running_loop()
    lock = _refresh_locks.get(loop)
    if lock is None:
        lock = asyncio.Lock()
        _refresh_locks[loop] = lock
    return lock


def is_bypass_enabled() -> bool:
    """Return True when local development auth bypass is active (never in frozen builds)."""
    return not getattr(sys, "frozen", False) and os.getenv("MASH_BYPASS_AUTH", "").lower() in ("true", "1", "yes")


def token_expires_at(data: dict[str, Any]) -> int:
    """Convert the OAuth response's relative expiry into a local Unix timestamp."""
    try:
        expires_in = int(data["expires_in"])
    except (KeyError, TypeError, ValueError):
        logger.warning("Token response is missing a valid expires_in; treating it as expiring now.")
        return int(time.time())

    if expires_in <= 0:
        logger.warning("Token response has a non-positive expires_in; treating it as expiring now.")
        return int(time.time())

    return int(time.time()) + expires_in


def set_active_memory_tokens(
    email: str | None,
    access_token: str | None,
    id_token: str | None = None,
    expires_at: int | None = None,
) -> None:
    """Store ephemeral JWTs strictly in RAM for the active account without token bleed."""
    if access_token:
        _IN_MEMORY_AUTH_META["access_token"] = access_token
        if id_token is not None:
            _IN_MEMORY_AUTH_META["id_token"] = id_token
        else:
            _IN_MEMORY_AUTH_META.pop("id_token", None)
        if expires_at is not None:
            _IN_MEMORY_AUTH_META["expires_at"] = expires_at
        else:
            _IN_MEMORY_AUTH_META.pop("expires_at", None)
    else:
        _IN_MEMORY_AUTH_META.pop("access_token", None)
        _IN_MEMORY_AUTH_META.pop("id_token", None)
        _IN_MEMORY_AUTH_META.pop("expires_at", None)

    if email:
        acc_t = _IN_MEMORY_AUTH_META.setdefault("account_tokens", {}).setdefault(email, {})
        if access_token:
            acc_t["access_token"] = access_token
        else:
            acc_t.pop("access_token", None)
        if id_token is not None:
            acc_t["id_token"] = id_token
        elif not access_token:
            acc_t.pop("id_token", None)
        if expires_at is not None:
            acc_t["expires_at"] = expires_at
        elif not access_token:
            acc_t.pop("expires_at", None)


def _clear_active_refresh_token(vault: dict[str, Any]) -> None:
    """Clear the active account's persisted refresh token on definitive auth rejection."""
    _IN_MEMORY_AUTH_META.clear()
    _IN_MEMORY_AUTH_META["authenticated"] = False
    vault.pop("refresh_token", None)
    active_acc = vault.get("active_account")
    accounts = vault.get("accounts")
    if active_acc and isinstance(accounts, dict) and active_acc in accounts:
        accounts[active_acc].pop("refresh_token", None)
    elif active_acc and isinstance(accounts, list):
        for acc in accounts:
            if isinstance(acc, dict) and acc.get("email") == active_acc:
                acc.pop("refresh_token", None)
    save_secure_vault(vault, {"authenticated": False})


def _is_definitive_refresh_rejection(exc: Exception) -> bool:
    """True only for terminal auth rejections; never wipe vault on 5xx or network faults."""
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in (400, 401, 403)
    msg = str(exc).lower()
    return "401" in msg or "invalid_grant" in msg or "expired" in msg


async def ensure_valid_token(force_refresh: bool = False) -> str | None:
    """Return a valid RAM access token, rotating the 30-day refresh token when needed."""
    if is_bypass_enabled():
        dev_token = (
            os.getenv("LLM_API_KEY")
            or os.getenv("OPENAI_API_KEY")
            or _IN_MEMORY_AUTH_META.get("access_token")
            or "dev-bypass-token"
        )
        _IN_MEMORY_AUTH_META["access_token"] = dev_token
        _IN_MEMORY_AUTH_META["authenticated"] = True
        return dev_token

    seen_access_token = _IN_MEMORY_AUTH_META.get("access_token")
    expires_at = _IN_MEMORY_AUTH_META.get("expires_at") or 0
    if not force_refresh and seen_access_token and int(time.time()) < (expires_at - 300):
        return seen_access_token

    async with _get_refresh_lock():
        # Double-check inside the lock: a concurrent caller may have just rotated the token.
        current_token = _IN_MEMORY_AUTH_META.get("access_token")
        expires_at = _IN_MEMORY_AUTH_META.get("expires_at") or 0
        if current_token and int(time.time()) < (expires_at - 300):
            if not force_refresh or current_token != seen_access_token:
                return current_token

        vault = load_secure_vault() or {}
        refresh_token = vault.get("refresh_token")

        if refresh_token:
            _IN_MEMORY_AUTH_META.pop("offline", None)
            try:
                data = await MAShClient().refresh_access_token(refresh_token)
                new_access = data.get("access_token")
                if new_access:
                    exp = token_expires_at(data)
                    set_active_memory_tokens(
                        vault.get("active_account"),
                        new_access,
                        id_token=data.get("id_token"),
                        expires_at=exp,
                    )
                    _IN_MEMORY_AUTH_META["authenticated"] = True

                    vault["refresh_token"] = data.get("refresh_token", refresh_token)
                    for ephemeral in ("access_token", "id_token", "expires_at"):
                        vault.pop(ephemeral, None)

                    meta = get_auth_metadata()
                    meta["authenticated"] = True
                    if "credits_remaining" in data:
                        meta["credits_remaining"] = data["credits_remaining"]
                    save_secure_vault(vault, meta)
                    logger.info("Successfully rotated access token via refresh token.")
                    return new_access
            except Exception as exc:
                logger.warning("Cloud gateway token refresh failed: %s", exc)
                if _is_definitive_refresh_rejection(exc):
                    _clear_active_refresh_token(vault)
                    return None
                _IN_MEMORY_AUTH_META["offline"] = True

        live_token = _IN_MEMORY_AUTH_META.get("access_token")
        if live_token and expires_at and int(time.time()) >= expires_at:
            # Never return an already-expired RAM JWT after offline refresh failure (sleep/wake).
            set_active_memory_tokens(vault.get("active_account"), None)
            live_token = None
        if not live_token and not (vault and vault.get("refresh_token")):
            _IN_MEMORY_AUTH_META["authenticated"] = False
        return live_token
