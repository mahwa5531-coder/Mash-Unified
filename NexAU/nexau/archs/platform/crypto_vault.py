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
JSON_META_FILE = get_nexau_home() / "auth_meta.json"


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

    if meta_dict is not None:
        JSON_META_FILE.parent.mkdir(parents=True, exist_ok=True)
        JSON_META_FILE.write_text(json.dumps(meta_dict, indent=2), encoding="utf-8")


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
    """Returns non-sensitive metadata (email, name, plan) for instant UI rendering."""
    if not JSON_META_FILE.exists():
        return {"authenticated": False}
    try:
        data = json.loads(JSON_META_FILE.read_text(encoding="utf-8"))
        return {"authenticated": True, **data}
    except Exception:
        return {"authenticated": False}


def clear_vault() -> None:
    """Wipes all local credentials and metadata on logout."""
    if VAULT_FILE.exists():
        try:
            VAULT_FILE.unlink()
        except Exception:
            pass
    if JSON_META_FILE.exists():
        try:
            JSON_META_FILE.unlink()
        except Exception:
            pass
