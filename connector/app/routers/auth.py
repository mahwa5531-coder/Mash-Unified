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

"""Auth Router for NexAU UI Backend.

Handles local authentication state, DPAPI credential storage, and account switching.
"""

import os
import time
import logging
from typing import Any
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from nexau.archs.platform.crypto_vault import (
    save_secure_vault,
    load_secure_vault,
    get_auth_metadata,
    clear_vault,
)
from nexau.archs.platform.app_config import AppConfig

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


async def ensure_valid_token() -> str | None:
    """Ensures a valid access_token is available with sliding refresh token rotation.
    
    1. If access_token is valid with >= 5 mins remaining before expires_at, returns it.
    2. If expired or expiring soon, uses the 30-day refresh_token to contact the Cloud
       Gateway at /api/auth/refresh, updating the vault with the newly issued access_token
       and refreshed expiration window.
    3. Fallback: returns decrypted access_token, api_key, or env LLM_API_KEY.
    """
    vault = load_secure_vault() or {}
    access_token = vault.get("access_token")
    refresh_token = vault.get("refresh_token")
    expires_at = vault.get("expires_at") or 0
    now = int(time.time())

    # 1. Valid access token with at least 5 minutes remaining
    if access_token and now < (expires_at - 300):
        return access_token

    # 2. Expired or expiring soon: rotate using sliding refresh_token
    if refresh_token:
        config = AppConfig.load()
        gateway_url = config.model.gateway_url or os.getenv("GATEWAY_URL") or os.getenv("OPENAI_BASE_URL")
        if gateway_url:
            clean_url = gateway_url.rstrip("/")
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    # Try /v1/auth/refresh (Cloud API standard) with fallback to /api/auth/refresh
                    resp = await client.post(
                        f"{clean_url}/v1/auth/refresh",
                        json={"refresh_token": refresh_token},
                        headers={"Content-Type": "application/json"},
                    )
                    if resp.status_code == 404:
                        resp = await client.post(
                            f"{clean_url}/api/auth/refresh",
                            json={"refresh_token": refresh_token},
                            headers={"Content-Type": "application/json"},
                        )

                    if resp.status_code == 200:
                        data = resp.json()
                        new_access = data.get("access_token")
                        if new_access:
                            vault["access_token"] = new_access
                            vault["refresh_token"] = data.get("refresh_token", refresh_token)
                            vault["expires_at"] = data.get("expires_at") or (now + 3600)
                            meta = get_auth_metadata()
                            if "credits_remaining" in data:
                                meta["credits_remaining"] = data["credits_remaining"]
                            save_secure_vault(vault, meta)
                            logger.info("Successfully rotated access token via refresh token.")
                            return new_access
                    else:
                        logger.warning(
                            "Cloud token refresh returned status %s: %s",
                            resp.status_code,
                            resp.text,
                        )
            except Exception as e:
                logger.error("Failed to connect to cloud gateway for token refresh: %s", e)

    return access_token or vault.get("api_key") or os.getenv("LLM_API_KEY")


class LoginPayload(BaseModel):
    code: str | None = None  # Desktop exchange code: mcode_<64hex>
    email: str | None = None
    name: str = "Auditor"
    plan: str = "pro"
    api_key: str | None = None
    access_token: str | None = None
    refresh_token: str | None = None
    id_token: str | None = None
    expires_at: int | None = None
    credits_remaining: int = 500


class SwitchAccountPayload(BaseModel):
    email: str
    name: str | None = None
    api_key: str | None = None
    access_token: str | None = None
    refresh_token: str | None = None
    plan: str = "pro"


@router.get("/me")
async def get_current_user_auth() -> dict[str, Any]:
    """Returns the current active user authentication state and metadata."""
    meta = get_auth_metadata()
    vault = load_secure_vault()
    if meta.get("authenticated") and vault is not None:
        return {
            "authenticated": True,
            "email": meta.get("email"),
            "name": meta.get("name"),
            "plan": meta.get("plan", "pro"),
            "credits_remaining": meta.get("credits_remaining", 500),
            "accounts": meta.get("accounts", []),
            "has_access_token": bool(vault.get("access_token") or vault.get("api_key")),
        }
    
    # ponytail: Return local authenticated auditor profile when not connected to cloud auth
    return {
        "authenticated": True,
        "email": meta.get("email") or "auditor@mash.local",
        "name": meta.get("name") or "Audit Lead",
        "plan": meta.get("plan", "enterprise"),
        "credits_remaining": meta.get("credits_remaining", 999999),
        "accounts": meta.get("accounts", []),
        "has_access_token": True,
    }


@router.post("/login")
@router.post("/callback")
async def handle_login(payload: LoginPayload) -> dict[str, Any]:
    """Stores credentials securely in Windows DPAPI vault with multi-account support.
    
    Supports:
    1. Direct local login (email, name, plan, tokens).
    2. Cloud desktop exchange handshake (code: mcode_<64hex> via loopback from web).
    """
    config = AppConfig.load()
    vault = load_secure_vault() or {}
    meta = get_auth_metadata()

    # If single-use exchange code received from browser loopback
    if payload.code:
        cloud_url = (
            config.model.gateway_url
            or os.getenv("GATEWAY_URL")
            or os.getenv("NEXAU_CLOUD_API_URL")
            or "https://api.mash.ai"
        ).rstrip("/")
        
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    f"{cloud_url}/v1/auth/desktop/exchange",
                    json={
                        "code": payload.code,
                        "device_name": "MASH Desktop",
                        "platform": "windows",
                    },
                    headers={"Content-Type": "application/json"},
                )
                
                if resp.status_code == 200:
                    data = resp.json()
                    now = int(time.time())
                    user_info = data.get("user", {})
                    payload.access_token = data.get("access_token")
                    payload.refresh_token = data.get("refresh_token")
                    payload.expires_at = now + data.get("expires_in", 3600)
                    payload.email = user_info.get("email", payload.email or "auditor@mash.ai")
                    payload.name = user_info.get("display_name", payload.name or "Auditor")
                    logger.info("Successfully exchanged mcode with Cloud API for %s", payload.email)
                elif resp.status_code == 400 and meta.get("authenticated"):
                    # Other channel won the dual-channel race; desktop is already authenticated
                    logger.info("mcode already consumed; desktop already authenticated.")
                    return {
                        "success": True,
                        "authenticated": True,
                        "email": meta.get("email"),
                        "accounts": meta.get("accounts", []),
                    }
                else:
                    logger.error("Cloud exchange failed: %s %s", resp.status_code, resp.text)
                    raise HTTPException(status_code=resp.status_code, detail=f"Cloud exchange failed: {resp.text}")
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Failed to connect to Cloud API for desktop exchange: %s", e)
            raise HTTPException(status_code=502, detail=f"Cannot reach Cloud API: {e}")

    if not payload.email:
        raise HTTPException(status_code=422, detail="Email is required for authentication.")

    accounts = vault.get("accounts", {})
    existing_acc = accounts.get(payload.email) or {}

    # Determine authoritative plan & credits:
    # Cloud OAuth exchange is authoritative. For direct local login without cloud verification,
    # default to "free" tier unless an existing verified plan is already recorded.
    if payload.code and 'data' in locals() and data.get("user"):
        effective_plan = data.get("user", {}).get("plan", "pro")
        effective_credits = data.get("user", {}).get("credits_remaining", 500)
    elif existing_acc.get("plan"):
        effective_plan = existing_acc["plan"]
        effective_credits = existing_acc.get("credits_remaining", 100)
    else:
        effective_plan = "free"
        effective_credits = 100

    accounts[payload.email] = {
        "email": payload.email,
        "name": payload.name,
        "plan": effective_plan,
        "api_key": payload.api_key,
        "access_token": payload.access_token,
        "refresh_token": payload.refresh_token,
        "id_token": payload.id_token,
        "expires_at": payload.expires_at,
        "credits_remaining": effective_credits,
    }

    secrets = {
        "active_account": payload.email,
        "api_key": payload.api_key,
        "access_token": payload.access_token,
        "refresh_token": payload.refresh_token,
        "id_token": payload.id_token,
        "expires_at": payload.expires_at,
        "accounts": accounts,
    }

    meta_accounts = meta.get("accounts", [])
    if isinstance(meta_accounts, list):
        meta_accounts = [a for a in meta_accounts if isinstance(a, dict) and a.get("email") != payload.email]
    else:
        meta_accounts = []
    meta_accounts.append({
        "email": payload.email,
        "name": payload.name,
        "plan": effective_plan,
        "credits_remaining": effective_credits,
    })

    meta_dict = {
        "authenticated": True,
        "email": payload.email,
        "name": payload.name,
        "plan": effective_plan,
        "credits_remaining": effective_credits,
        "accounts": meta_accounts,
    }

    save_secure_vault(secrets, meta_dict)

    # Also update AppConfig user profile
    config = AppConfig.load()
    config.user.email = payload.email
    config.user.name = payload.name
    config.user.plan = payload.plan
    config.user.credits_remaining = payload.credits_remaining
    config.save()

    return {"success": True, "authenticated": True, "email": payload.email, "accounts": meta_accounts}


@router.post("/switch")
async def handle_account_switch(payload: SwitchAccountPayload) -> dict[str, Any]:
    """Switches active session account credentials with zero token bleed."""
    vault = load_secure_vault() or {}
    meta = get_auth_metadata()
    accounts = vault.get("accounts", {})

    target = accounts.get(payload.email, {})

    if payload.api_key:
        target["api_key"] = payload.api_key
    if payload.access_token:
        target["access_token"] = payload.access_token
    if payload.refresh_token:
        target["refresh_token"] = payload.refresh_token
    if payload.name:
        target["name"] = payload.name
    if payload.plan:
        target["plan"] = payload.plan
    target["email"] = payload.email

    accounts[payload.email] = target

    secrets = {
        "active_account": payload.email,
        "api_key": target.get("api_key"),
        "access_token": target.get("access_token"),
        "refresh_token": target.get("refresh_token"),
        "id_token": target.get("id_token"),
        "expires_at": target.get("expires_at"),
        "accounts": accounts,
    }

    meta["email"] = payload.email
    meta["name"] = target.get("name", meta.get("name", "Auditor"))
    meta["plan"] = target.get("plan", meta.get("plan", "pro"))
    meta["credits_remaining"] = target.get("credits_remaining", meta.get("credits_remaining", 500))

    save_secure_vault(secrets, meta)

    config = AppConfig.load()
    config.user.email = payload.email
    config.user.name = meta["name"]
    config.user.plan = meta["plan"]
    config.user.credits_remaining = meta["credits_remaining"]
    config.save()

    return {
        "success": True,
        "active_email": payload.email,
        "name": meta["name"],
        "plan": meta["plan"],
        "credits_remaining": meta["credits_remaining"],
        "accounts": meta.get("accounts", []),
    }


@router.post("/logout")
async def handle_logout() -> dict[str, Any]:
    """Clears local secure vault on logout and revokes cloud session if present."""
    vault = load_secure_vault() or {}
    refresh_token = vault.get("refresh_token")
    access_token = vault.get("access_token")

    # Best-effort cloud session revocation in background
    if refresh_token or access_token:
        config = AppConfig.load()
        gateway_url = (
            config.model.gateway_url
            or os.getenv("GATEWAY_URL")
            or os.getenv("NEXAU_CLOUD_API_URL")
            or "https://api.mash.ai"
        ).rstrip("/")
        try:
            headers = {"Content-Type": "application/json"}
            if access_token:
                headers["Authorization"] = f"Bearer {access_token}"
            async with httpx.AsyncClient(timeout=3.0) as client:
                await client.post(
                    f"{gateway_url}/v1/auth/logout",
                    json={"refresh_token": refresh_token or ""},
                    headers=headers,
                )
        except Exception as e:
            logger.debug("Cloud session revocation skipped or offline: %s", e)

    clear_vault()
    config = AppConfig.load()
    config.user.email = None
    config.user.name = None
    config.save()
    return {"success": True, "authenticated": False}


@router.post("/refresh")
async def handle_manual_refresh() -> dict[str, Any]:
    """Triggers access token rotation using stored sliding refresh_token."""
    token = await ensure_valid_token()
    if not token:
        raise HTTPException(status_code=401, detail="Session expired. Please log in again.")
    meta = get_auth_metadata()
    return {
        "success": True,
        "authenticated": True,
        "email": meta.get("email"),
        "credits_remaining": meta.get("credits_remaining", 500),
    }

