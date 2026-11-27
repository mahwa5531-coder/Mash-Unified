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

"""Account lifecycle unit: login handshake, DPAPI vault persistence, switching, and logout."""

from __future__ import annotations

import html
import logging
from typing import Any

import httpx
from fastapi import HTTPException
from nexau.archs.platform.crypto_vault import (
    _IN_MEMORY_AUTH_META,
    clear_vault,
    get_auth_metadata,
    load_secure_vault,
    save_secure_vault,
)
from pydantic import BaseModel

from app.client import MAShClient
from app.services.auth_tokens import set_active_memory_tokens, token_expires_at

logger = logging.getLogger(__name__)


class LoginPayload(BaseModel):
    code: str | None = None  # Desktop exchange code: mcode_<64hex>
    email: str | None = None
    name: str | None = None
    plan: str | None = None
    api_key: str | None = None
    access_token: str | None = None
    refresh_token: str | None = None
    id_token: str | None = None
    expires_at: int | None = None
    credits_remaining: int | None = None


class SwitchAccountPayload(BaseModel):
    email: str
    name: str | None = None
    api_key: str | None = None
    access_token: str | None = None
    refresh_token: str | None = None
    plan: str | None = None


def _activate_and_save_account(
    *,
    email: str,
    name: str,
    plan: str | None,
    credits_remaining: int | None,
    accounts: dict[str, Any],
    refresh_token: str | None,
    api_key: str | None,
    access_token: str | None,
    id_token: str | None,
    expires_at: int | None,
    authenticated: bool,
    meta_accounts: list[dict[str, Any]],
) -> None:
    """Shared session activation + DPAPI vault persistence for login and account switch."""
    set_active_memory_tokens(email, access_token, id_token=id_token, expires_at=expires_at)
    _IN_MEMORY_AUTH_META.setdefault("account_profiles", {})[email] = {
        "email": email,
        "name": name,
        "plan": plan,
        "credits_remaining": credits_remaining,
    }

    secrets: dict[str, Any] = {
        "active_account": email,
        "refresh_token": refresh_token,
        "accounts": accounts,
    }
    if api_key:
        secrets["api_key"] = api_key

    save_secure_vault(
        secrets,
        {
            "authenticated": authenticated,
            "email": email,
            "name": name,
            "plan": plan,
            "credits_remaining": credits_remaining,
            "accounts": meta_accounts,
        },
    )


async def login_account(payload: LoginPayload) -> dict[str, Any]:
    """Authenticate via direct credentials or single-use desktop exchange code."""
    vault = load_secure_vault() or {}
    meta = get_auth_metadata()
    exchange_data: dict[str, Any] = {}

    if payload.code:
        try:
            exchange_data = await MAShClient().exchange_desktop_code(payload.code)
            user_info = exchange_data.get("user", {})
            payload.access_token = exchange_data.get("access_token")
            payload.refresh_token = exchange_data.get("refresh_token")
            payload.expires_at = token_expires_at(exchange_data)
            payload.email = user_info.get("email") or payload.email
            payload.name = user_info.get("display_name") or payload.name or "User"
            logger.info("Successfully exchanged mcode with Cloud API for %s", payload.email)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 400 and meta.get("authenticated"):
                logger.info("mcode already consumed; desktop already authenticated.")
                return {
                    "success": True,
                    "authenticated": True,
                    "email": meta.get("email"),
                    "accounts": meta.get("accounts", []),
                }
            logger.error("Cloud exchange failed: %s %s", exc.response.status_code, exc.response.text)
            raise HTTPException(
                status_code=exc.response.status_code,
                detail=f"Cloud exchange failed: {exc.response.text}",
            )
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("Failed to connect to Cloud API for desktop exchange: %s", exc)
            raise HTTPException(status_code=502, detail=f"Cannot reach Cloud API: {exc}")

    if not payload.email:
        raise HTTPException(status_code=422, detail="Email is required for authentication.")

    accounts = vault.get("accounts", {})
    existing_acc = accounts.get(payload.email) or {}
    exchange_user = exchange_data.get("user") if isinstance(exchange_data.get("user"), dict) else None

    if payload.code and exchange_user:
        effective_plan = exchange_user.get("plan")
        effective_credits = exchange_user.get("credits_remaining")
    elif existing_acc.get("plan"):
        effective_plan = existing_acc["plan"]
        effective_credits = existing_acc.get("credits_remaining")
    else:
        effective_plan = payload.plan
        effective_credits = payload.credits_remaining

    resolved_name = payload.name or (exchange_user.get("display_name") if exchange_user else None) or "User"

    acc_disk: dict[str, Any] = {
        "email": payload.email,
        "name": resolved_name,
        "plan": effective_plan,
        "refresh_token": payload.refresh_token,
        "credits_remaining": effective_credits,
    }
    if payload.api_key:
        acc_disk["api_key"] = payload.api_key
    accounts[payload.email] = acc_disk

    meta_accounts = meta.get("accounts", [])
    if isinstance(meta_accounts, list):
        meta_accounts = [a for a in meta_accounts if isinstance(a, dict) and a.get("email") != payload.email]
    else:
        meta_accounts = []
    meta_accounts.append({
        "email": payload.email,
        "name": resolved_name,
        "plan": effective_plan,
        "credits_remaining": effective_credits,
    })

    is_authenticated = bool(
        payload.access_token
        or payload.api_key
        or payload.refresh_token
        or exchange_data.get("access_token")
    )

    _activate_and_save_account(
        email=payload.email,
        name=resolved_name,
        plan=effective_plan,
        credits_remaining=effective_credits,
        accounts=accounts,
        refresh_token=payload.refresh_token,
        api_key=payload.api_key,
        access_token=payload.access_token,
        id_token=payload.id_token,
        expires_at=payload.expires_at,
        authenticated=is_authenticated,
        meta_accounts=meta_accounts,
    )
    return {"success": True, "authenticated": is_authenticated, "email": payload.email, "accounts": meta_accounts}


async def switch_active_account(payload: SwitchAccountPayload) -> dict[str, Any]:
    """Switch active session account credentials with zero token bleed."""
    vault = load_secure_vault() or {}
    meta = get_auth_metadata()
    accounts = vault.get("accounts", {})
    target = accounts.get(payload.email, {})

    if payload.refresh_token:
        target["refresh_token"] = payload.refresh_token
    target["email"] = payload.email
    accounts[payload.email] = target

    acc_tokens = _IN_MEMORY_AUTH_META.get("account_tokens", {}).get(payload.email, {})
    active_access = acc_tokens.get("access_token") or payload.access_token
    active_id = acc_tokens.get("id_token") if acc_tokens.get("access_token") else None
    active_exp = acc_tokens.get("expires_at") if acc_tokens.get("access_token") else None

    api_key = payload.api_key or target.get("api_key")
    has_creds = bool(active_access or target.get("refresh_token") or payload.refresh_token or api_key)

    target_prof = _IN_MEMORY_AUTH_META.get("account_profiles", {}).get(payload.email, {})
    resolved_name = payload.name or target_prof.get("name") or target.get("name") or "User"
    resolved_plan = payload.plan or target_prof.get("plan") or target.get("plan")
    resolved_credits = (
        target_prof.get("credits_remaining")
        if target_prof.get("credits_remaining") is not None
        else target.get("credits_remaining")
    )

    _activate_and_save_account(
        email=payload.email,
        name=resolved_name,
        plan=resolved_plan,
        credits_remaining=resolved_credits,
        accounts=accounts,
        refresh_token=target.get("refresh_token"),
        api_key=api_key,
        access_token=active_access,
        id_token=active_id,
        expires_at=active_exp,
        authenticated=has_creds,
        meta_accounts=meta.get("accounts", []),
    )
    return {
        "success": True,
        "active_email": payload.email,
        "name": resolved_name,
        "plan": resolved_plan,
        "credits_remaining": resolved_credits,
        "accounts": meta.get("accounts", []),
    }


async def logout_account() -> dict[str, Any]:
    """Clear local DPAPI vault and revoke cloud session if reachable."""
    vault = load_secure_vault() or {}
    refresh_token = vault.get("refresh_token")
    access_token = _IN_MEMORY_AUTH_META.get("access_token")
    if refresh_token:
        try:
            await MAShClient().logout(refresh_token, access_token=access_token)
        except Exception as exc:
            logger.debug("Cloud session revocation skipped or offline: %s", exc)
    clear_vault()
    return {"success": True, "authenticated": False}


def render_callback_html(success: bool, error_message: str = "") -> str:
    """Render the minimal browser loopback HTML confirmation page."""
    if success:
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
                <script>setTimeout(() => { window.close(); }, 1200);</script>
            </div>
        </body>
        </html>
        """
    safe_err = html.escape(error_message)
    return f"""
    <!DOCTYPE html>
    <html>
    <head><title>Sign In Error</title></head>
    <body style="background:#0a0a0c;color:#f87171;font-family:sans-serif;padding:40px;text-align:center;">
        <h2>Authentication Failed</h2>
        <p style="color:#aaa;">{safe_err}</p>
    </body>
    </html>
    """
