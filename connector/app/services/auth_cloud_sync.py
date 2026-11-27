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

"""Cloud sync unit: /v1/me profile & quota sync, /v1/usage, and dynamic auth config."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx
from fastapi import HTTPException
from nexau.archs.platform.crypto_vault import (
    _IN_MEMORY_AUTH_META,
    get_auth_metadata,
    load_secure_vault,
    save_secure_vault,
)

from app.client import MAShClient, resolve_cloud_gateway_url
from app.services.auth_tokens import ensure_valid_token, is_bypass_enabled

logger = logging.getLogger(__name__)

DEFAULT_WEBSITE_URL = "https://mahwa5531-coder.github.io/mash-website"


def get_auth_config_data() -> dict[str, Any]:
    """Return cloud gateway, website links, and auth enforcement config."""
    cloud_url = resolve_cloud_gateway_url()
    mash_env = os.getenv("MASH_ENV", "production").lower()
    auth_required = os.getenv("MASH_AUTH_REQUIRED", "").lower() in ("true", "1", "yes") or mash_env == "production"
    website_url = (
        os.getenv("MASH_WEBSITE_URL")
        or os.getenv("NEXT_PUBLIC_WEBSITE_URL")
        or DEFAULT_WEBSITE_URL
    ).rstrip("/")
    pricing_url = (
        os.getenv("MASH_WEBSITE_PRICING_URL")
        or os.getenv("NEXAU_WEBSITE_PRICING_URL")
        or f"{website_url}/pricing"
    ).rstrip("/")
    return {
        "gateway_url": cloud_url,
        "auth_required": auth_required,
        "env": mash_env,
        "website_url": website_url,
        "pricing_url": pricing_url,
    }


async def sync_user_account_state(token: str | None = None) -> dict[str, Any] | None:
    """Sync authoritative user identity, plan, models, and rolling quotas from Cloud /v1/me."""
    if not token:
        token = await ensure_valid_token()
    if not token:
        return None

    try:
        client = MAShClient()
        try:
            data = await client.get_me(token)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code != 401:
                raise
            refreshed = await ensure_valid_token(force_refresh=True)
            # Do not resend the same expired token if refresh fell back offline.
            if not refreshed or _IN_MEMORY_AUTH_META.get("offline") or refreshed == token:
                return None
            token = refreshed
            data = await client.get_me(token)

        meta = get_auth_metadata()
        user_info = data.get("user")
        if isinstance(user_info, dict):
            if user_info.get("email"):
                meta["email"] = user_info["email"]
            if user_info.get("display_name"):
                meta["name"] = user_info["display_name"]

        plan_info = data.get("plan")
        if isinstance(plan_info, dict) and plan_info.get("code"):
            meta["plan"] = plan_info["code"]
        elif isinstance(plan_info, str):
            meta["plan"] = plan_info

        for field in ("subscription_status", "models", "limits"):
            if field in data:
                meta[field] = data[field]

        if "quota" in data:
            quota_data = data["quota"]
            if isinstance(quota_data, dict) and isinstance(quota_data.get("windows"), list):
                for win in quota_data["windows"]:
                    if isinstance(win, dict):
                        if "percent" not in win and "used_percent" in win:
                            win["percent"] = win["used_percent"]
                        elif "used_percent" not in win and "percent" in win:
                            win["used_percent"] = win["percent"]
            meta["quota"] = quota_data

        try:
            usage_data = await client.get_usage(token)
            if usage_data:
                meta["usage"] = usage_data
        except Exception as ue:
            logger.debug("Cloud /v1/usage sync skipped: %s", ue)

        vault = load_secure_vault() or {}
        save_secure_vault(vault, meta)
        return data
    except httpx.HTTPStatusError as exc:
        logger.warning("Cloud /v1/me returned HTTP %s: %s", exc.response.status_code, exc)
        return None
    except Exception as exc:
        logger.debug("Cloud /v1/me sync skipped or timed out: %s", exc)
        return None


async def get_current_user_state(fresh: bool = False) -> dict[str, Any]:
    """Resolve local + optional cloud-synced session state for /api/auth/me."""
    if is_bypass_enabled():
        token = await ensure_valid_token()
        return {
            "authenticated": True,
            "email": "auditor@mash.local",
            "name": "Dev Auditor",
            "plan": "pro",
            "subscription_status": "active",
            "credits_remaining": 999999,
            "accounts": [{
                "email": "auditor@mash.local",
                "name": "Dev Auditor",
                "plan": "pro",
                "credits_remaining": 999999,
            }],
            "has_access_token": bool(token),
        }

    meta = get_auth_metadata()
    vault = load_secure_vault()

    if not meta.get("authenticated") or vault is None or not meta.get("email"):
        if not (vault and vault.get("refresh_token") and vault.get("active_account")):
            return {"authenticated": False}

    live_token = _IN_MEMORY_AUTH_META.get("access_token")
    if not live_token:
        live_token = await ensure_valid_token()
        meta = get_auth_metadata()

    if not live_token or not meta.get("authenticated"):
        if _IN_MEMORY_AUTH_META.get("offline") and vault and vault.get("refresh_token"):
            offline_res: dict[str, Any] = {"authenticated": False, "offline": True}
            offline_email = meta.get("email") or vault.get("active_account")
            if offline_email:
                offline_res["email"] = offline_email
            if meta.get("name"):
                offline_res["name"] = meta["name"]
            if meta.get("plan"):
                offline_res["plan"] = meta["plan"]
            return offline_res
        return {"authenticated": False}

    if fresh or not meta.get("quota"):
        await sync_user_account_state()
        meta = get_auth_metadata()
        if not meta.get("authenticated"):
            return {"authenticated": False, "auth_expired": True}

    return {
        "authenticated": True,
        "email": meta.get("email"),
        "name": meta.get("name") or "User",
        "plan": meta.get("plan"),
        "subscription_status": meta.get("subscription_status"),
        "quota": meta.get("quota"),
        "usage": meta.get("usage"),
        "limits": meta.get("limits"),
        "models": meta.get("models", []),
        "credits_remaining": meta.get("credits_remaining"),
        "accounts": meta.get("accounts", []),
        "has_access_token": bool(_IN_MEMORY_AUTH_META.get("access_token")),
    }


async def sync_auth_status() -> dict[str, Any]:
    """Trigger /v1/me sync and report status for /api/auth/sync."""
    data = await sync_user_account_state()
    if data:
        return {"status": "ok", "data": data}
    if not get_auth_metadata().get("authenticated"):
        return {"status": "auth_expired", "data": None}
    return {"status": "offline", "data": None}


async def manual_token_refresh() -> dict[str, Any]:
    """Trigger access token rotation using the stored sliding refresh token."""
    token = await ensure_valid_token()
    if not token:
        raise HTTPException(status_code=401, detail="Session expired. Please log in again.")
    meta = get_auth_metadata()
    return {
        "success": True,
        "authenticated": True,
        "email": meta.get("email"),
        "credits_remaining": meta.get("credits_remaining"),
    }
