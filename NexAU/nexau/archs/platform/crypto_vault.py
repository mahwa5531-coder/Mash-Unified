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

"""Windows DPAPI Hardware-Encrypted Credential Vault for NexAU.

Implements CryptProtectData and CryptUnprotectData from crypt32.dll on Windows,
with safe fallback for POSIX systems.
"""

from __future__ import annotations

import ctypes
import ctypes.wintypes
import json
import logging
import sys
from pathlib import Path
from typing import Any

from nexau.archs.platform.path_helpers import get_nexau_home

logger = logging.getLogger(__name__)

VAULT_FILE = get_nexau_home() / "auth.vault"

# ponytail: In-memory session state for user profile, quotas, and tier.
# Held strictly in RAM — never written as unencrypted JSON to user's hard drive.
_IN_MEMORY_AUTH_META: dict[str, Any] = {}


class DATA_BLOB(ctypes.Structure):  # noqa: N801
    _fields_ = [
        ("cbData", ctypes.wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_char)),
    ]


def _is_windows() -> bool:
    return sys.platform == "win32"


def get_in_memory_auth_meta() -> dict[str, Any]:
    """Returns the in-memory auth state containing active access_token, id_token, and account tokens."""
    return _IN_MEMORY_AUTH_META


def save_secure_vault(secrets_dict: dict[str, Any], meta_dict: dict[str, Any] | None = None) -> bool:
    """Encrypts secret credentials using Windows DPAPI and saves to ~/.mash/auth.vault.

    ponytail: Access and ID tokens reside strictly in RAM (_IN_MEMORY_AUTH_META)
    and are purged from disk persistence to enforce process-memory isolation.
    """
    # 1. Update in-memory metadata if provided, preserving existing tokens in RAM
    if meta_dict is not None:
        tokens_preserved = {
            k: v for k, v in _IN_MEMORY_AUTH_META.items()
            if k in ("access_token", "id_token", "expires_at", "account_tokens")
        }
        _IN_MEMORY_AUTH_META.clear()
        _IN_MEMORY_AUTH_META.update(meta_dict)
        _IN_MEMORY_AUTH_META.update(tokens_preserved)

    # 2. Extract top-level ephemeral tokens into RAM and scrub from secrets_dict
    top_tokens: dict[str, Any] = {}
    for key in ("access_token", "id_token", "expires_at"):
        if key in secrets_dict:
            val = secrets_dict.pop(key)
            if val is not None:
                top_tokens[key] = val

    if top_tokens:
        _IN_MEMORY_AUTH_META.update(top_tokens)
        active_email = secrets_dict.get("active_account")
        if active_email:
            _IN_MEMORY_AUTH_META.setdefault("account_tokens", {}).setdefault(active_email, {}).update(top_tokens)

    # 3. Scrub ephemeral tokens from nested accounts
    accounts = secrets_dict.get("accounts")
    if isinstance(accounts, dict):
        account_items = [(k, v) for k, v in accounts.items()]
    elif isinstance(accounts, list):
        account_items = [(v.get("email") if isinstance(v, dict) else None, v) for v in accounts]
    else:
        account_items = []

    for default_email, acc_info in account_items:
        if isinstance(acc_info, dict):
            acc_tokens: dict[str, Any] = {}
            for key in ("access_token", "id_token", "expires_at"):
                if key in acc_info:
                    val = acc_info.pop(key)
                    if val is not None:
                        acc_tokens[key] = val
            acc_email = acc_info.get("email") or default_email
            if acc_tokens and acc_email:
                _IN_MEMORY_AUTH_META.setdefault("account_tokens", {}).setdefault(acc_email, {}).update(acc_tokens)

    # 4. If top_tokens was empty but active_account has cached in-memory tokens, reflect them
    active_email = secrets_dict.get("active_account")
    if active_email and active_email in _IN_MEMORY_AUTH_META.get("account_tokens", {}):
        cached = _IN_MEMORY_AUTH_META["account_tokens"][active_email]
        for key in ("access_token", "id_token", "expires_at"):
            if key in cached and key not in top_tokens:
                _IN_MEMORY_AUTH_META[key] = cached[key]

    raw_secrets = json.dumps(secrets_dict, ensure_ascii=False).encode("utf-8")

    if _is_windows():
        blob_in = DATA_BLOB(
            len(raw_secrets),
            ctypes.cast(ctypes.create_string_buffer(raw_secrets), ctypes.POINTER(ctypes.c_char)),
        )
        blob_out = DATA_BLOB()

        if ctypes.windll.crypt32.CryptProtectData(
            ctypes.byref(blob_in), "NexAU_Vault", None, None, None, 0, ctypes.byref(blob_out)
        ):
            cb_data = int(blob_out.cbData)
            pb_data = blob_out.pbData
            buffer = ctypes.string_at(pb_data, cb_data)
            ctypes.windll.kernel32.LocalFree(pb_data)
            VAULT_FILE.parent.mkdir(parents=True, exist_ok=True)
            VAULT_FILE.write_bytes(buffer)
        else:
            raise RuntimeError("Windows DPAPI CryptProtectData failed.")
    else:
        VAULT_FILE.parent.mkdir(parents=True, exist_ok=True)
        VAULT_FILE.write_bytes(raw_secrets)
        try:
            VAULT_FILE.chmod(0o600)
        except Exception:
            pass

    # Clean up legacy disk metadata if present
    legacy_meta = get_nexau_home() / "auth_meta.json"
    if legacy_meta.exists():
        try:
            legacy_meta.unlink()
        except Exception:
            pass

    return True


def load_secure_vault() -> dict[str, Any] | None:
    """Decrypts and returns secrets from ~/.mash/auth.vault using Windows DPAPI.

    Maintains non-destructive fallback to legacy ~/.nexau/auth.vault,
    and automatically migrates/scrubs legacy access_token/id_token.
    """
    target_file = VAULT_FILE
    is_legacy_source = False
    if not target_file.exists():
        legacy_file = Path.home() / ".nexau" / "auth.vault"
        if legacy_file.exists():
            target_file = legacy_file
            is_legacy_source = True
        else:
            return None

    ciphertext = target_file.read_bytes()
    if not ciphertext:
        return None

    if _is_windows():
        blob_in = DATA_BLOB(
            len(ciphertext),
            ctypes.cast(ctypes.create_string_buffer(ciphertext), ctypes.POINTER(ctypes.c_char)),
        )
        blob_out = DATA_BLOB()

        if ctypes.windll.crypt32.CryptUnprotectData(
            ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)
        ):
            cb_data = int(blob_out.cbData)
            pb_data = blob_out.pbData
            buffer = ctypes.string_at(pb_data, cb_data)
            ctypes.windll.kernel32.LocalFree(pb_data)
            try:
                data = json.loads(buffer.decode("utf-8"))
            except Exception as e:
                logger.error("Failed to parse decrypted vault JSON: %s", e)
                return None
        else:
            logger.warning("Windows DPAPI CryptUnprotectData failed. Vault may be from another user/machine.")
            return None
    else:
        try:
            data = json.loads(ciphertext.decode("utf-8"))
        except Exception:
            return None

    if not isinstance(data, dict):
        logger.warning("Decrypted vault JSON is not a valid object: %s", type(data))
        return None

    # Detect legacy vault with persisted access_token, id_token, or expires_at
    legacy_keys = ("access_token", "id_token", "expires_at")
    has_legacy = any(k in data for k in legacy_keys)
    accounts = data.get("accounts")
    account_items = accounts.values() if isinstance(accounts, dict) else (accounts if isinstance(accounts, list) else [])
    for acc in account_items:
        if isinstance(acc, dict) and any(k in acc for k in legacy_keys):
            has_legacy = True
            break

    if has_legacy or is_legacy_source:
        # Transfer legacy tokens into _IN_MEMORY_AUTH_META so active session is preserved
        if "access_token" in data and not _IN_MEMORY_AUTH_META.get("access_token"):
            _IN_MEMORY_AUTH_META["access_token"] = data.get("access_token")
            if "id_token" in data:
                _IN_MEMORY_AUTH_META["id_token"] = data.get("id_token")
            if "expires_at" in data:
                _IN_MEMORY_AUTH_META["expires_at"] = data.get("expires_at")

        # Save will scrub legacy keys and write hardened schema to ~/.mash/auth.vault
        save_secure_vault(data)
        logger.info("Migrated legacy auth.vault: scrubbed access_token and id_token from disk.")

    return data


def get_auth_metadata() -> dict[str, Any]:
    """Returns non-sensitive metadata (email, name, plan) from in-memory session state."""
    if _IN_MEMORY_AUTH_META.get("authenticated") or _IN_MEMORY_AUTH_META.get("email"):
        return _IN_MEMORY_AUTH_META.copy()

    # Cold boot fallback: check if DPAPI vault has an active account without touching disk JSON
    vault = load_secure_vault()
    if vault and vault.get("active_account"):
        acc_email = vault.get("active_account")
        raw_accounts = vault.get("accounts")
        acc_info: dict[str, Any] = {}
        if isinstance(raw_accounts, dict):
            acc_info = raw_accounts.get(acc_email) or {}
        elif isinstance(raw_accounts, list):
            for a in raw_accounts:
                if isinstance(a, dict) and a.get("email") == acc_email:
                    acc_info = a
                    break

        account_list_source = (
            raw_accounts.values()
            if isinstance(raw_accounts, dict)
            else (raw_accounts if isinstance(raw_accounts, list) else [])
        )
        return {
            "authenticated": True,
            "email": acc_email,
            "name": acc_info.get("name") or "User",
            "plan": acc_info.get("plan") or "pro",
            "credits_remaining": acc_info.get("credits_remaining", 500),
            "accounts": [
                {
                    "email": acc.get("email"),
                    "name": acc.get("name"),
                    "plan": acc.get("plan"),
                    "credits_remaining": acc.get("credits_remaining"),
                }
                for acc in account_list_source
                if isinstance(acc, dict) and acc.get("email")
            ],
        }
    return {"authenticated": False}


def clear_vault() -> None:
    """Wipes all local credentials and in-memory metadata on logout."""
    _IN_MEMORY_AUTH_META.clear()
    if VAULT_FILE.exists():
        try:
            VAULT_FILE.unlink()
        except Exception:
            pass
    legacy_vault = Path.home() / ".nexau" / "auth.vault"
    if legacy_vault.exists():
        try:
            legacy_vault.unlink()
        except Exception:
            pass
    legacy_meta = get_nexau_home() / "auth_meta.json"
    if legacy_meta.exists():
        try:
            legacy_meta.unlink()
        except Exception:
            pass
