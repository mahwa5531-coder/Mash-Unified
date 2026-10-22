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

import logging
import os
import time
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from nexau.archs.platform.app_config import AppConfig
from nexau.archs.platform.crypto_vault import (
    _IN_MEMORY_AUTH_META,
    clear_vault,
    get_auth_metadata,
    load_secure_vault,
    save_secure_vault,
)
from pydantic import BaseModel

from app.client import MAShClient

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _token_expires_at(data: dict[str, Any]) -> int:
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


async def ensure_valid_token(force_refresh: bool = False) -> str | None:
    """Ensures a valid access_token is available with sliding refresh token rotation.

    1. If access_token is valid with >= 5 mins remaining before expires_at (and not force_refresh), returns it.
    2. If expired, expiring soon, or force_refresh=True, uses the 30-day refresh_token to contact the Cloud
       Gateway at /v1/auth/refresh, updating _IN_MEMORY_AUTH_META with the newly issued access_token
       and saving rotated refresh_token in the vault.
    3. Fallback: returns in-memory access_token, api_key, or env LLM_API_KEY.
    """
    if os.getenv("MASH_BYPASS_AUTH", "").lower() in ("true", "1", "yes"):
        dev_token = _IN_MEMORY_AUTH_META.get("access_token") or os.getenv("LLM_API_KEY") or os.getenv("MASH_API_KEY") or os.getenv("OPENAI_API_KEY") or "dev-bypass-token"
        _IN_MEMORY_AUTH_META["access_token"] = dev_token
        _IN_MEMORY_AUTH_META["authenticated"] = True
        return dev_token

    access_token = _IN_MEMORY_AUTH_META.get("access_token")
    expires_at = _IN_MEMORY_AUTH_META.get("expires_at") or 0
    now = int(time.time())

    # 1. Valid access token with at least 5 minutes remaining
    if not force_refresh and access_token and now < (expires_at - 300):
        return access_token

    vault = load_secure_vault() or {}
    refresh_token = vault.get("refresh_token")

    # 2. Expired or expiring soon: rotate using sliding refresh_token via centralized MAShClient
    if refresh_token:
        try:
            client = MAShClient()
            data = await client.refresh_access_token(refresh_token)
            new_access = data.get("access_token")
            if new_access:
                exp = _token_expires_at(data)
                _IN_MEMORY_AUTH_META["access_token"] = new_access
                _IN_MEMORY_AUTH_META["expires_at"] = exp
                _IN_MEMORY_AUTH_META["authenticated"] = True
                if "id_token" in data:
                    _IN_MEMORY_AUTH_META["id_token"] = data["id_token"]

                active_acc = vault.get("active_account")
                if active_acc:
                    acc_t = _IN_MEMORY_AUTH_META.setdefault("account_tokens", {}).setdefault(active_acc, {})
                    acc_t["access_token"] = new_access
                    acc_t["expires_at"] = exp
                    if "id_token" in data:
                        acc_t["id_token"] = data["id_token"]

                vault["refresh_token"] = data.get("refresh_token", refresh_token)
                vault.pop("access_token", None)
                vault.pop("id_token", None)
                vault.pop("expires_at", None)

                meta = get_auth_metadata()
                meta["authenticated"] = True
                if "credits_remaining" in data:
                    meta["credits_remaining"] = data["credits_remaining"]
                save_secure_vault(vault, meta)
                logger.info("Successfully rotated access token via refresh token.")
                return new_access
        except Exception as e:
            logger.warning("Cloud gateway token refresh failed: %s", e)
            is_auth_error = False
            if isinstance(e, httpx.HTTPStatusError):
                status = e.response.status_code
                resp_text = e.response.text.lower()
                if status in (400, 401, 403) or "invalid_grant" in resp_text or "expired" in resp_text or "invalid" in resp_text:
                    is_auth_error = True
            elif "401" in str(e) or "invalid_grant" in str(e).lower() or "expired" in str(e).lower():
                is_auth_error = True

            if is_auth_error:
                _IN_MEMORY_AUTH_META.clear()
                _IN_MEMORY_AUTH_META["authenticated"] = False
                vault.pop("refresh_token", None)
                active_acc = vault.get("active_account")
                if active_acc and isinstance(vault.get("accounts"), dict) and active_acc in vault["accounts"]:
                    vault["accounts"][active_acc].pop("refresh_token", None)
                elif active_acc and isinstance(vault.get("accounts"), list):
                    for acc in vault["accounts"]:
                        if isinstance(acc, dict) and acc.get("email") == active_acc:
                            acc.pop("refresh_token", None)
                save_secure_vault(vault, {"authenticated": False})
                return None

    live_token = _IN_MEMORY_AUTH_META.get("access_token") or (vault.get("api_key") if vault else None) or os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not live_token and not (vault and vault.get("refresh_token")):
        _IN_MEMORY_AUTH_META["authenticated"] = False
    return live_token


async def sync_user_account_state(token: str | None = None) -> dict[str, Any] | None:
    """Syncs authoritative user identity, plan, models, and rolling quotas from Cloud API /v1/me.

    ponytail: Single entrypoint to sync cloud quota windows into local metadata.
    """
    if not token:
        token = await ensure_valid_token()
    if not token:
        return None

    try:
        client = MAShClient()
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

        if "subscription_status" in data:
            meta["subscription_status"] = data["subscription_status"]
        if "models" in data:
            meta["models"] = data["models"]
        if "limits" in data:
            meta["limits"] = data["limits"]
        if "quota" in data:
            quota_data = data["quota"]
            if isinstance(quota_data, dict) and "windows" in quota_data and isinstance(quota_data["windows"], list):
                for win in quota_data["windows"]:
                    if isinstance(win, dict):
                        # ponytail: normalize quota percent between cloud API (used_percent) and UI (percent)
                        if "percent" not in win and "used_percent" in win:
                            win["percent"] = win["used_percent"]
                        elif "used_percent" not in win and "percent" in win:
                            win["used_percent"] = win["percent"]
            meta["quota"] = quota_data

        # Also fetch live usage from /v1/usage if available
        try:
            usage_data = await client.get_usage(token)
            if usage_data:
                meta["usage"] = usage_data
        except Exception as ue:
            logger.debug("Cloud /v1/usage sync skipped: %s", ue)

        vault = load_secure_vault() or {}
        save_secure_vault(vault, meta)
        return data
    except Exception as e:
        logger.debug("Cloud /v1/me sync skipped or offline: %s", e)
        return None


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
    plan: str | None = None


@router.get("/config")
async def get_auth_config() -> dict[str, Any]:
    """Returns dynamic cloud gateway and auth settings to frontend."""
    config = AppConfig.load()
    cloud_url = (
        os.getenv("CLOUD_GATEWAY_URL")
        or os.getenv("GATEWAY_URL")
        or config.model.gateway_url
        or "https://api.mash.ai"
    ).rstrip("/")
    mash_env = os.getenv("MASH_ENV", "production").lower()
    auth_required = os.getenv("MASH_AUTH_REQUIRED", "").lower() in ("true", "1", "yes") or mash_env == "production"
    return {
        "gateway_url": cloud_url,
        "auth_required": auth_required,
        "env": mash_env,
    }


@router.get("/me")
async def get_current_user_auth() -> dict[str, Any]:
    if os.getenv("MASH_BYPASS_AUTH", "").lower() in ("true", "1", "yes"):
        return {
            "authenticated": True,
            "email": "user@mash.local",
            "name": "Local User",
            "plan": "pro",
            "subscription_status": "active",
            "quota": {"windows": [{"window": "weekly", "percent": 0}]},
            "usage": {"used_tokens": 0, "remaining_percent": 100},
        }

    meta = get_auth_metadata()
    vault = load_secure_vault()

    if not meta.get("authenticated") or vault is None or not meta.get("email"):
        return {
            "authenticated": False,
        }

    # Ensure live valid token exists; if absent, attempt to acquire or validate one
    live_token = _IN_MEMORY_AUTH_META.get("access_token") or (vault.get("api_key") if vault else None)
    if not live_token:
        live_token = await ensure_valid_token()
        meta = get_auth_metadata()

    # If still no valid token could be produced, fail closed to unauthenticated
    if not live_token or not meta.get("authenticated"):
        if not (vault and vault.get("refresh_token")):
            _IN_MEMORY_AUTH_META["authenticated"] = False
        return {
            "authenticated": False,
        }

    token = _IN_MEMORY_AUTH_META.get("access_token")
    # Proactively sync rolling quota position if not present
    if token and not meta.get("quota"):
        await sync_user_account_state(token)
        meta = get_auth_metadata()

    return {
        "authenticated": True,
        "email": meta.get("email"),
        "name": meta.get("name") or "User",
        "plan": meta.get("plan", "pro"),
        "subscription_status": meta.get("subscription_status", "active"),
        "quota": meta.get("quota"),
        "usage": meta.get("usage"),
        "limits": meta.get("limits"),
        "models": meta.get("models", []),
        "credits_remaining": meta.get("credits_remaining", 500),
        "accounts": meta.get("accounts", []),
        "has_access_token": bool(_IN_MEMORY_AUTH_META.get("access_token") or (vault and vault.get("api_key"))),
    }


@router.post("/sync")
async def sync_auth_state() -> dict[str, Any]:
    """Explicitly triggers sync with Cloud API /v1/me to refresh rolling quota and plan."""
    data = await sync_user_account_state()
    return {"status": "ok" if data else "offline", "data": data}


@router.get("/callback", response_class=HTMLResponse)
async def handle_browser_callback(code: str):
    """Handles browser loopback redirect after cloud Google OAuth."""
    payload = LoginPayload(code=code)
    try:
        await handle_login(payload)
        return """
        <!DOCTYPE html>
        <html>
        <head>
            <title>MASH Desktop - Signed In</title>
            <style>
                body { background: #0a0a0c; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
                .card { background: #161618; border: 1px solid rgba(255,255,255,0.1); padding: 32px 48px; border-radius: 16px; box-shadow: 0 16px 32px rgba(0,0,0,0.4); max-width: 400px; }
                h2 { margin: 0 0 8px; font-size: 20px; font-weight: 600; }
                p { color: #888; font-size: 14px; margin: 0 0 12px; }
            </style>
        </head>
        <body>
            <div class="card">
                <div style="font-size: 40px; margin-bottom: 16px; color: #10b981;">✓</div>
                <h2>Authentication Successful</h2>
                <p>Your desktop app has been unlocked. You may close this tab and return to MASH.</p>
                <script>
                    setTimeout(() => { window.close(); }, 1200);
                </script>
            </div>
        </body>
        </html>
        """
    except Exception as e:
        logger.error("Callback error: %s", e)
        return f"""
        <!DOCTYPE html>
        <html>
        <head><title>Sign In Error</title></head>
        <body style="background:#0a0a0c;color:#f87171;font-family:sans-serif;padding:40px;text-align:center;">
            <h2>Authentication Failed</h2>
            <p style="color:#aaa;">{str(e)}</p>
        </body>
        </html>
        """


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
        try:
            client = MAShClient()
            data = await client.exchange_desktop_code(payload.code)
            now = int(time.time())
            user_info = data.get("user", {})
            payload.access_token = data.get("access_token")
            payload.refresh_token = data.get("refresh_token")
            payload.expires_at = _token_expires_at(data)
            payload.email = user_info.get("email") or payload.email
            payload.name = user_info.get("display_name") or payload.name or "User"
            logger.info("Successfully exchanged mcode with Cloud API for %s", payload.email)
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 400 and meta.get("authenticated"):
                # Other channel won the dual-channel race; desktop is already authenticated
                logger.info("mcode already consumed; desktop already authenticated.")
                return {
                    "success": True,
                    "authenticated": True,
                    "email": meta.get("email"),
                    "accounts": meta.get("accounts", []),
                }
            logger.error("Cloud exchange failed: %s %s", e.response.status_code, e.response.text)
            raise HTTPException(status_code=e.response.status_code, detail=f"Cloud exchange failed: {e.response.text}")
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
        effective_plan = payload.plan or "free"
        effective_credits = payload.credits_remaining if payload.credits_remaining is not None else 100

    # Populate in-memory access and id tokens strictly in RAM
    if payload.access_token:
        _IN_MEMORY_AUTH_META["access_token"] = payload.access_token
    if payload.id_token:
        _IN_MEMORY_AUTH_META["id_token"] = payload.id_token
    if payload.expires_at:
        _IN_MEMORY_AUTH_META["expires_at"] = payload.expires_at

    _IN_MEMORY_AUTH_META.setdefault("account_tokens", {})[payload.email] = {
        "access_token": payload.access_token,
        "id_token": payload.id_token,
        "expires_at": payload.expires_at,
    }

    accounts[payload.email] = {
        "email": payload.email,
        "name": payload.name,
        "plan": effective_plan,
        "api_key": payload.api_key,
        "refresh_token": payload.refresh_token,
        "credits_remaining": effective_credits,
    }

    secrets = {
        "active_account": payload.email,
        "api_key": payload.api_key,
        "refresh_token": payload.refresh_token,
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
    if payload.refresh_token:
        target["refresh_token"] = payload.refresh_token
    if payload.name:
        target["name"] = payload.name
    if payload.plan:
        target["plan"] = payload.plan
    target["email"] = payload.email

    accounts[payload.email] = target

    # Update in-memory auth state for target account
    acc_tokens = _IN_MEMORY_AUTH_META.setdefault("account_tokens", {}).get(payload.email, {})
    if payload.access_token:
        acc_tokens["access_token"] = payload.access_token
    _IN_MEMORY_AUTH_META["account_tokens"][payload.email] = acc_tokens

    if acc_tokens.get("access_token"):
        _IN_MEMORY_AUTH_META["access_token"] = acc_tokens["access_token"]
        _IN_MEMORY_AUTH_META["id_token"] = acc_tokens.get("id_token")
        _IN_MEMORY_AUTH_META["expires_at"] = acc_tokens.get("expires_at")
    elif payload.access_token:
        _IN_MEMORY_AUTH_META["access_token"] = payload.access_token
    else:
        _IN_MEMORY_AUTH_META.pop("access_token", None)
        _IN_MEMORY_AUTH_META.pop("id_token", None)
        _IN_MEMORY_AUTH_META.pop("expires_at", None)

    secrets = {
        "active_account": payload.email,
        "api_key": target.get("api_key"),
        "refresh_token": target.get("refresh_token"),
        "accounts": accounts,
    }

    has_creds = bool(
        acc_tokens.get("access_token")
        or payload.access_token
        or target.get("api_key")
        or target.get("refresh_token")
        or payload.api_key
        or payload.refresh_token
    )
    meta["authenticated"] = has_creds
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
    access_token = _IN_MEMORY_AUTH_META.get("access_token") or vault.get("access_token")

    # Best-effort cloud session revocation in background
    if refresh_token or access_token:
        config = AppConfig.load()
        gateway_url = (
            os.getenv("CLOUD_GATEWAY_URL")
            or os.getenv("GATEWAY_URL")
            or os.getenv("NEXAU_CLOUD_API_URL")
            or config.model.gateway_url
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

