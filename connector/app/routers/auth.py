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

Thin HTTP adapter delegating to focused feature units:
- app.services.auth_tokens (15m RAM JWTs + 30d DPAPI refresh token rotation)
- app.services.auth_accounts (login handshake, vault activation, switching, logout)
- app.services.auth_cloud_sync (/v1/me + /v1/usage sync, /me, and /config)
"""

import logging
from typing import Any

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from app.services.auth_accounts import (
    LoginPayload,
    SwitchAccountPayload,
    login_account,
    logout_account,
    render_callback_html,
    switch_active_account,
)
from app.services.auth_cloud_sync import (
    get_auth_config_data,
    get_current_user_state,
    manual_token_refresh,
    sync_auth_status,
    sync_user_account_state,
)
from app.services.auth_tokens import ensure_valid_token, token_expires_at as _token_expires_at

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/config")
async def get_auth_config() -> dict[str, Any]:
    """Returns dynamic cloud gateway, website links, and auth settings to frontend."""
    return get_auth_config_data()


@router.get("/me")
async def get_current_user_auth(fresh: bool = False) -> dict[str, Any]:
    return await get_current_user_state(fresh=fresh)


@router.post("/sync")
async def sync_auth_state() -> dict[str, Any]:
    """Explicitly triggers sync with Cloud API /v1/me to refresh rolling quota and plan."""
    return await sync_auth_status()


@router.get("/callback", response_class=HTMLResponse)
async def handle_browser_callback(code: str) -> str:
    """Handles browser loopback redirect after cloud Google OAuth."""
    try:
        await login_account(LoginPayload(code=code))
        return render_callback_html(success=True)
    except Exception as exc:
        logger.error("Callback error: %s", exc)
        return render_callback_html(success=False, error_message=str(exc))


@router.post("/login")
@router.post("/callback")
async def handle_login(payload: LoginPayload) -> dict[str, Any]:
    """Stores credentials securely in Windows DPAPI vault with multi-account support."""
    return await login_account(payload)


@router.post("/switch")
async def handle_account_switch(payload: SwitchAccountPayload) -> dict[str, Any]:
    """Switches active session account credentials with zero token bleed."""
    return await switch_active_account(payload)


@router.post("/logout")
async def handle_logout() -> dict[str, Any]:
    """Clears local secure vault on logout and revokes cloud session if present."""
    return await logout_account()


@router.post("/refresh")
async def handle_manual_refresh() -> dict[str, Any]:
    """Triggers access token rotation using stored sliding refresh_token."""
    return await manual_token_refresh()


__all__ = [
    "LoginPayload",
    "SwitchAccountPayload",
    "_token_expires_at",
    "ensure_valid_token",
    "sync_user_account_state",
    "get_auth_config",
    "get_current_user_auth",
    "sync_auth_state",
    "handle_browser_callback",
    "handle_login",
    "handle_account_switch",
    "handle_logout",
    "handle_manual_refresh",
    "router",
]
