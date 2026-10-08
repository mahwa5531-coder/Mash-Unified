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


class DATA_BLOB(ctypes.Structure):
    _fields_ = [
        ("cbData", ctypes.wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_char)),
    ]


def _is_windows() -> bool:
    return sys.platform == "win32"


def save_secure_vault(secrets_dict: dict[str, Any], meta_dict: dict[str, Any] | None = None) -> None:
    """Encrypts secret credentials using Windows DPAPI and saves to ~/.nexau/auth.vault."""
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

    # Update in-memory state in RAM only — zero unencrypted JSON files on disk
    if meta_dict is not None:
        _IN_MEMORY_AUTH_META.clear()
        _IN_MEMORY_AUTH_META.update(meta_dict)

    # Clean up legacy disk metadata if present
    legacy_meta = get_nexau_home() / "auth_meta.json"
    if legacy_meta.exists():
        try:
            legacy_meta.unlink()
        except Exception:
            pass


def load_secure_vault() -> dict[str, Any] | None:
    """Decrypts and returns secrets from ~/.nexau/auth.vault using Windows DPAPI."""
    if not VAULT_FILE.exists():
        return None

    ciphertext = VAULT_FILE.read_bytes()
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
                return json.loads(buffer.decode("utf-8"))
            except Exception as e:
                logger.error("Failed to parse decrypted vault JSON: %s", e)
                return None
        else:
            logger.warning("Windows DPAPI CryptUnprotectData failed. Vault may be from another user/machine.")
            return None
    else:
        try:
            return json.loads(ciphertext.decode("utf-8"))
        except Exception:
            return None


def get_auth_metadata() -> dict[str, Any]:
    """Returns non-sensitive metadata (email, name, plan) from in-memory session state."""
    if _IN_MEMORY_AUTH_META.get("authenticated") or _IN_MEMORY_AUTH_META.get("email"):
        return _IN_MEMORY_AUTH_META.copy()

    # Cold boot fallback: check if DPAPI vault has an active account without touching disk JSON
    vault = load_secure_vault()
    if vault and vault.get("active_account"):
        acc_email = vault.get("active_account")
        acc_info = (vault.get("accounts") or {}).get(acc_email) or {}
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
                for acc in (vault.get("accounts") or {}).values()
                if isinstance(acc, dict) and acc.get("email")
            ] if isinstance(vault.get("accounts"), dict) else [],
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
    legacy_meta = get_nexau_home() / "auth_meta.json"
    if legacy_meta.exists():
        try:
            legacy_meta.unlink()
        except Exception:
            pass
