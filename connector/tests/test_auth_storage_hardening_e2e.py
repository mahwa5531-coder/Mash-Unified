# Copyright (c) Nex-AGI. All rights reserved.
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Comprehensive Opaque-Box E2E Test Suite for Mash Auth Hardening,
Credential Isolation & Storage Standardization.

Covers Tiers 1–4 across:
- Tier 1: Core Feature Coverage
- Tier 2: Boundary & Corner Cases
- Tier 3: Cross-Feature Interactions
- Tier 4: Real-World Workload Scenarios
"""

from __future__ import annotations

import concurrent.futures
import ctypes
import ctypes.wintypes
import json
import os
import shutil
import sys
import time
from pathlib import Path
from typing import Any

import pytest
from app.client import MAShClient
from app.main import app
from app.routers.auth import ensure_valid_token
from fastapi.testclient import TestClient
from nexau.archs.platform.app_config import AppConfig
from nexau.archs.platform.crypto_vault import (
    _IN_MEMORY_AUTH_META,
    clear_vault,
    get_auth_metadata,
    load_secure_vault,
    save_secure_vault,
)
from nexau.archs.platform.path_helpers import (
    get_database_path,
    get_mash_home,
    get_nexau_home,
    get_session_brain_dir,
)
from nexau.archs.session.agent_run_action_service import (
    AgentRunActionService,
    redact_data_structure,
    redact_sensitive_content,
)
from nexau.archs.session import AgentRunActionKey, AgentRunActionModel
from nexau.archs.session.models.session import SessionModel
from nexau.archs.session.orm import InMemoryDatabaseEngine
from nexau.core.messages import Message, Role, TextBlock, ToolResultBlock, ToolUseBlock

# ──────────────────────────────────────────────────────────────────────────────
# Helper Utilities & Fixtures
# ──────────────────────────────────────────────────────────────────────────────

class DATA_BLOB(ctypes.Structure):
    _fields_ = [
        ("cbData", ctypes.wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_char)),
    ]


def _encrypt_legacy_blob(raw_data: bytes) -> bytes:
    """Helper to generate a DPAPI-encrypted blob for testing legacy unhardened vaults."""
    if sys.platform == "win32":
        blob_in = DATA_BLOB(
            len(raw_data),
            ctypes.cast(ctypes.create_string_buffer(raw_data), ctypes.POINTER(ctypes.c_char)),
        )
        blob_out = DATA_BLOB()
        if ctypes.windll.crypt32.CryptProtectData(
            ctypes.byref(blob_in), "NexAU_Vault", None, None, None, 0, ctypes.byref(blob_out)
        ):
            cb_data = int(blob_out.cbData)
            pb_data = blob_out.pbData
            buffer = ctypes.string_at(pb_data, cb_data)
            ctypes.windll.kernel32.LocalFree(pb_data)
            return buffer
        raise RuntimeError("DPAPI CryptProtectData failed in test helper.")
    return raw_data


@pytest.fixture
def mock_mash_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Hermetic test environment isolating ~/.mash and ~/.nexau under tmp_path."""
    home_dir = tmp_path / "user_home"
    home_dir.mkdir(parents=True, exist_ok=True)
    mash_dir = home_dir / ".mash"
    nexau_dir = home_dir / ".nexau"

    monkeypatch.setenv("USERPROFILE", str(home_dir))
    monkeypatch.setenv("HOME", str(home_dir))
    monkeypatch.setattr(Path, "home", lambda: home_dir)

    import nexau.archs.platform.path_helpers as ph
    monkeypatch.setattr(ph, "get_mash_home", lambda: mash_dir)
    monkeypatch.setattr(ph, "get_nexau_home", lambda: mash_dir)

    import nexau.archs.platform.crypto_vault as cv
    monkeypatch.setattr(cv, "VAULT_FILE", mash_dir / "auth.vault")

    _IN_MEMORY_AUTH_META.clear()
    clear_vault()

    yield {
        "home": home_dir,
        "mash": mash_dir,
        "nexau": nexau_dir,
        "vault_file": mash_dir / "auth.vault",
        "legacy_vault_file": nexau_dir / "auth.vault",
    }

    _IN_MEMORY_AUTH_META.clear()
    clear_vault()


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


# ──────────────────────────────────────────────────────────────────────────────
# TIER 1: CORE FEATURE COVERAGE
# ──────────────────────────────────────────────────────────────────────────────

def test_tier1_vault_in_memory_isolation(mock_mash_env):
    """Tier 1: Verify access_token and id_token are kept purely in RAM and NEVER persisted on disk."""
    vault_file: Path = mock_mash_env["vault_file"]

    secrets = {
        "access_token": "secret_access_token_super_secret_123",
        "id_token": "secret_id_token_super_secret_456",
        "expires_at": int(time.time()) + 3600,
        "refresh_token": "persistent_refresh_token_789",
        "api_key": "user_byok_api_key_000",
        "active_account": "auditor@mash.local",
    }

    meta = {
        "authenticated": True,
        "email": "auditor@mash.local",
        "name": "Mash Auditor",
        "plan": "enterprise",
    }

    save_secure_vault(secrets, meta)

    # 1. Inspect raw disk bytes
    assert vault_file.exists(), "auth.vault was not created on disk."
    raw_disk_bytes = vault_file.read_bytes()
    assert b"access_token" not in raw_disk_bytes, "access_token key leaked into raw disk bytes!"
    assert b"id_token" not in raw_disk_bytes, "id_token key leaked into raw disk bytes!"
    assert b"secret_access_token" not in raw_disk_bytes, "access_token payload leaked into raw disk bytes!"
    assert b"secret_id_token" not in raw_disk_bytes, "id_token payload leaked into raw disk bytes!"

    # 2. Inspect decrypted vault payload
    decrypted = load_secure_vault()
    assert decrypted is not None
    assert "access_token" not in decrypted, "access_token was persisted in decrypted vault!"
    assert "id_token" not in decrypted, "id_token was persisted in decrypted vault!"
    assert "expires_at" not in decrypted, "expires_at was persisted in decrypted vault!"
    assert decrypted["refresh_token"] == "persistent_refresh_token_789"
    assert decrypted["api_key"] == "user_byok_api_key_000"

    # 3. Assert tokens are strictly in memory
    assert _IN_MEMORY_AUTH_META.get("access_token") == "secret_access_token_super_secret_123"
    assert _IN_MEMORY_AUTH_META.get("id_token") == "secret_id_token_super_secret_456"
    assert _IN_MEMORY_AUTH_META.get("email") == "auditor@mash.local"


def test_tier1_dpapi_refresh_token_persistence(mock_mash_env):
    """Tier 1: Verify refresh_token and api_key are persisted under OS DPAPI protection."""
    vault_file: Path = mock_mash_env["vault_file"]

    payload = {
        "refresh_token": "dpapi_protected_refresh_999",
        "api_key": "dpapi_protected_api_key_888",
    }
    save_secure_vault(payload)

    raw_bytes = vault_file.read_bytes()
    assert len(raw_bytes) > 0

    if sys.platform == "win32":
        # On Windows, assert DPAPI ciphertext does not match plain JSON
        with pytest.raises(Exception):
            json.loads(raw_bytes.decode("utf-8"))

    # Decrypting via load_secure_vault recovers secrets intact
    recovered = load_secure_vault()
    assert recovered is not None
    assert recovered["refresh_token"] == "dpapi_protected_refresh_999"
    assert recovered["api_key"] == "dpapi_protected_api_key_888"


@pytest.mark.anyio
async def test_tier1_cold_boot_recovery(mock_mash_env, monkeypatch):
    """Tier 1: Verify Connector restart exchanges vaulted refresh_token for active in-memory tokens."""
    vault_file: Path = mock_mash_env["vault_file"]

    # Seed DPAPI vault with only refresh_token
    save_secure_vault({
        "refresh_token": "valid_cold_boot_refresh_token",
        "active_account": "user@mash.local",
    })

    # Simulate Cold Boot: RAM is completely purged
    _IN_MEMORY_AUTH_META.clear()
    assert _IN_MEMORY_AUTH_META.get("access_token") is None

    # Mock Cloud API token refresh endpoint
    async def mock_refresh(self, refresh_tok: str) -> dict[str, Any]:
        assert refresh_tok == "valid_cold_boot_refresh_token"
        return {
            "access_token": "newly_minted_memory_access_token_111",
            "refresh_token": "rotated_sliding_refresh_token_222",
            "expires_in": 3600,
            "id_token": "newly_minted_id_token_333",
            "credits_remaining": 750,
        }

    monkeypatch.setattr(MAShClient, "refresh_access_token", mock_refresh)

    # Trigger cold boot recovery
    active_token = await ensure_valid_token(force_refresh=True)

    assert active_token == "newly_minted_memory_access_token_111"
    assert _IN_MEMORY_AUTH_META["access_token"] == "newly_minted_memory_access_token_111"
    assert _IN_MEMORY_AUTH_META["id_token"] == "newly_minted_id_token_333"

    # Disk vault must STILL NOT contain any access token
    raw_bytes = vault_file.read_bytes()
    assert b"access_token" not in raw_bytes
    assert b"newly_minted_memory_access_token" not in raw_bytes

    # Disk vault must have rotated refresh token
    vault_on_disk = load_secure_vault()
    assert vault_on_disk["refresh_token"] == "rotated_sliding_refresh_token_222"


def test_tier1_legacy_vault_migration(mock_mash_env):
    """Tier 1: Verify legacy vaults containing access_token are automatically migrated and rewritten."""
    vault_file: Path = mock_mash_env["vault_file"]
    vault_file.parent.mkdir(parents=True, exist_ok=True)

    # Craft legacy vault containing unhardened access_token and id_token
    legacy_payload = {
        "access_token": "legacy_leaked_access_token_999",
        "id_token": "legacy_leaked_id_token_888",
        "expires_at": int(time.time()) + 1800,
        "refresh_token": "legacy_refresh_token_777",
        "active_account": "migrated_user@mash.local",
        "accounts": {
            "migrated_user@mash.local": {
                "email": "migrated_user@mash.local",
                "access_token": "account_leaked_token_666",
                "refresh_token": "account_refresh_token_555",
            }
        },
    }

    raw_legacy = json.dumps(legacy_payload).encode("utf-8")
    encrypted_blob = _encrypt_legacy_blob(raw_legacy)
    vault_file.write_bytes(encrypted_blob)

    # First access triggers automatic detection, RAM promotion, and disk rewrite
    migrated_vault = load_secure_vault()
    assert migrated_vault is not None

    # Disk payload must be sanitized immediately
    raw_disk_after = vault_file.read_bytes()
    assert b"legacy_leaked_access_token" not in raw_disk_after
    assert b"account_leaked_token" not in raw_disk_after
    assert b"access_token" not in raw_disk_after

    # Decrypted structure must not retain access_token
    assert "access_token" not in migrated_vault
    assert "id_token" not in migrated_vault
    assert "access_token" not in migrated_vault["accounts"]["migrated_user@mash.local"]

    # Active session maintained in RAM
    assert _IN_MEMORY_AUTH_META.get("access_token") == "legacy_leaked_access_token_999"
    assert _IN_MEMORY_AUTH_META.get("id_token") == "legacy_leaked_id_token_888"


def test_tier1_frontend_token_elimination():
    """Tier 1: Statically verify frontend codebase has completely eliminated bearer token persistence."""
    root_dir = Path(__file__).resolve().parent.parent.parent

    client_file = root_dir / "frontend" / "src" / "services" / "client.ts"
    auth_file = root_dir / "frontend" / "src" / "services" / "auth.ts"
    stream_file = root_dir / "frontend" / "src" / "services" / "stream.ts"

    assert client_file.exists()
    assert auth_file.exists()
    assert stream_file.exists()

    client_code = client_file.read_text(encoding="utf-8")
    auth_code = auth_file.read_text(encoding="utf-8")
    stream_code = stream_file.read_text(encoding="utf-8")

    # 1. getStoredAccessToken must be purged
    assert "getStoredAccessToken" not in client_code
    assert "getStoredAccessToken" not in stream_code

    # 2. localStorage.setItem for access token must be eliminated
    assert "localStorage.setItem('nexau_access_token'" not in auth_code
    assert 'localStorage.setItem("nexau_access_token"' not in auth_code

    # 3. Defensive purge on client load must be present
    assert "localStorage.removeItem('nexau_access_token')" in client_code or \
           'localStorage.removeItem("nexau_access_token")' in client_code

    # 4. Stream requests must not inject Authorization header
    assert 'headers["Authorization"]' not in stream_code and "headers['Authorization']" not in stream_code


def test_tier1_storage_standardization_under_mash(mock_mash_env):
    """Tier 1: Verify user storage directory paths standardize under ~/.mash."""
    home_dir = mock_mash_env["home"]
    expected_mash = home_dir / ".mash"

    assert get_mash_home() == expected_mash
    assert get_nexau_home() == expected_mash

    db_path = get_database_path()
    assert db_path == expected_mash / "database" / "mash.db"

    brain_dir = get_session_brain_dir("test_session_123")
    assert brain_dir.is_relative_to(expected_mash / "brain")


def test_tier1_non_destructive_legacy_fallback(mock_mash_env):
    """Tier 1: Verify ~/.nexau data is migrated to ~/.mash without deleting original files."""
    home_dir = mock_mash_env["home"]
    legacy_dir = home_dir / ".nexau"
    legacy_db_file = legacy_dir / "database" / "nexau.db"
    legacy_db_file.parent.mkdir(parents=True, exist_ok=True)
    legacy_db_file.write_text("LEGACY_SQLITE_HEADER_CONTENT", encoding="utf-8")

    legacy_settings = legacy_dir / "settings.json"
    legacy_settings.write_text('{"theme": "cyberpunk", "model": "mash/fast"}', encoding="utf-8")

    # Call get_database_path to trigger auto-migration
    new_db = get_database_path()
    assert new_db.exists()
    assert new_db.read_text(encoding="utf-8") == "LEGACY_SQLITE_HEADER_CONTENT"

    # CRITICAL: Non-destructive verification -> original file must still exist
    assert legacy_db_file.exists(), "Legacy nexau.db was deleted instead of non-destructively copied!"

    # Settings fallback verification
    config = AppConfig.load()
    assert config is not None
    assert legacy_settings.exists(), "Legacy settings.json was deleted during fallback!"


def test_tier1_secret_redaction_transcripts_and_sqlite():
    """Tier 1: Verify sensitive credentials and tokens are redacted before persistence."""
    leaked_inputs = [
        ("curl -H 'Authorization: Bearer sk-ant-secret1234567890abcdef' https://api.mash.ai",
         "curl -H 'Authorization: Bearer [REDACTED]' https://api.mash.ai"),
        ("Using OpenAI key sk-123456789012345678901234567890 to query",
         "Using OpenAI key [REDACTED] to query"),
        ("Found Google token AIzaSyD-1234567890abcdefghijklmnopqrst",
         "Found Google token [REDACTED]"),
        ("Token ghp_1234567890abcdefghijklmnopqrstuvwxyz committed",
         "Token [REDACTED] committed"),
        ("Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDxgnv_32",
         "Bearer [REDACTED]"),
    ]

    for raw, expected in leaked_inputs:
        redacted = redact_sensitive_content(raw)
        assert redacted == expected, f"Failed redacting: {raw}"
        assert "sk-" not in redacted
        assert "AIza" not in redacted
        assert "ghp_" not in redacted


# ──────────────────────────────────────────────────────────────────────────────
# TIER 2: BOUNDARY & CORNER CASES
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_tier2_empty_and_missing_token_handling(mock_mash_env, monkeypatch, client):
    """Tier 2: Verify empty/missing token scenarios fail closed without crashes."""
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("API_KEY", raising=False)
    save_secure_vault({"refresh_token": "", "api_key": ""})

    token = await ensure_valid_token(force_refresh=True)
    assert token is None

    res = client.get("/api/auth/me")
    assert res.status_code == 200
    assert res.json()["authenticated"] is False


@pytest.mark.anyio
async def test_tier2_expired_token_handling(mock_mash_env, monkeypatch):
    """Tier 2: Verify expired in-memory token automatically triggers sliding refresh."""
    # Place expired token in RAM
    _IN_MEMORY_AUTH_META["access_token"] = "expired_memory_token"
    _IN_MEMORY_AUTH_META["expires_at"] = int(time.time()) - 100

    save_secure_vault({"refresh_token": "valid_sliding_refresh"})

    async def mock_refresh(self, refresh_tok: str) -> dict[str, Any]:
        return {
            "access_token": "refreshed_live_token_777",
            "refresh_token": "rotated_refresh_888",
            "expires_in": 3600,
        }

    monkeypatch.setattr(MAShClient, "refresh_access_token", mock_refresh)

    token = await ensure_valid_token()
    assert token == "refreshed_live_token_777"
    assert _IN_MEMORY_AUTH_META["access_token"] == "refreshed_live_token_777"


def test_tier2_corrupt_legacy_vault_recovery(mock_mash_env):
    """Tier 2: Verify corrupt vault binary bytes fail safely to unauthenticated state."""
    vault_file: Path = mock_mash_env["vault_file"]
    vault_file.parent.mkdir(parents=True, exist_ok=True)
    vault_file.write_bytes(b"\x00\xff\xfe\x01\x88corrupt_binary_junk\xde\xad\xbe\xef")

    loaded = load_secure_vault()
    assert loaded is None

    meta = get_auth_metadata()
    assert meta["authenticated"] is False


def test_tier2_multiple_accounts_vault_isolation(mock_mash_env):
    """Tier 2: Verify multi-account vault structures strip access tokens across every account."""
    vault_file: Path = mock_mash_env["vault_file"]

    multi_account_payload = {
        "active_account": "user1@mash.local",
        "accounts": {
            "user1@mash.local": {
                "email": "user1@mash.local",
                "name": "User One",
                "access_token": "user1_ephemeral_access_token",
                "id_token": "user1_ephemeral_id_token",
                "refresh_token": "user1_persistent_refresh_token",
            },
            "user2@mash.local": {
                "email": "user2@mash.local",
                "name": "User Two",
                "access_token": "user2_ephemeral_access_token",
                "id_token": "user2_ephemeral_id_token",
                "refresh_token": "user2_persistent_refresh_token",
            },
        },
    }

    save_secure_vault(multi_account_payload)

    raw_bytes = vault_file.read_bytes()
    assert b"user1_ephemeral_access_token" not in raw_bytes
    assert b"user2_ephemeral_access_token" not in raw_bytes
    assert b"user1_ephemeral_id_token" not in raw_bytes
    assert b"user2_ephemeral_id_token" not in raw_bytes

    decrypted = load_secure_vault()
    for acc in decrypted["accounts"].values():
        assert "access_token" not in acc
        assert "id_token" not in acc
        assert "refresh_token" in acc


def test_tier2_missing_mash_directory_auto_creation(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Tier 2: Verify save_secure_vault auto-creates missing ~/.mash directory hierarchy."""
    clean_home = tmp_path / "brand_new_user_home"
    clean_mash = clean_home / ".mash"

    monkeypatch.setattr(Path, "home", lambda: clean_home)
    import nexau.archs.platform.crypto_vault as cv
    monkeypatch.setattr(cv, "VAULT_FILE", clean_mash / "auth.vault")

    assert not clean_mash.exists()
    save_secure_vault({"refresh_token": "auto_create_refresh_tok"})
    assert clean_mash.exists()
    assert (clean_mash / "auth.vault").exists()


def test_tier2_concurrent_vault_access(mock_mash_env):
    """Tier 2: Verify vault operations remain consistent under concurrent multi-threaded reads."""
    save_secure_vault({
        "refresh_token": "concurrent_test_refresh_token_valid",
        "api_key": "concurrent_test_api_key_valid",
        "active_account": "user@mash.local",
    })

    def reader_worker(idx: int):
        loaded = load_secure_vault()
        if not loaded:
            return False
        return (
            loaded.get("refresh_token") == "concurrent_test_refresh_token_valid"
            and loaded.get("api_key") == "concurrent_test_api_key_valid"
            and "access_token" not in loaded
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(reader_worker, i) for i in range(32)]
        results = [f.result() for f in concurrent.futures.as_completed(futures)]

    assert all(results), "Concurrent vault reads encountered race conditions or corruption!"


# ──────────────────────────────────────────────────────────────────────────────
# TIER 3: CROSS-FEATURE INTERACTIONS
# ──────────────────────────────────────────────────────────────────────────────

def test_tier3_account_switching_and_vault_migration(mock_mash_env):
    """Tier 3: Account switching on a legacy multi-account vault simultaneously scrubs disk and loads target RAM tokens."""
    vault_file: Path = mock_mash_env["vault_file"]
    vault_file.parent.mkdir(parents=True, exist_ok=True)

    legacy_payload = {
        "active_account": "user1@mash.local",
        "access_token": "user1_legacy_access",
        "refresh_token": "user1_legacy_refresh",
        "accounts": {
            "user1@mash.local": {
                "email": "user1@mash.local",
                "access_token": "user1_legacy_access",
                "refresh_token": "user1_legacy_refresh",
            },
            "user2@mash.local": {
                "email": "user2@mash.local",
                "access_token": "user2_legacy_access",
                "refresh_token": "user2_legacy_refresh",
            },
        },
    }

    vault_file.write_bytes(_encrypt_legacy_blob(json.dumps(legacy_payload).encode("utf-8")))

    # Initial load triggers migration
    vault = load_secure_vault()
    assert _IN_MEMORY_AUTH_META["access_token"] == "user1_legacy_access"

    # Simulate account switch to user2
    target_email = "user2@mash.local"
    vault["active_account"] = target_email
    save_secure_vault(vault)

    # Disk must be verified clean
    raw = vault_file.read_bytes()
    assert b"user1_legacy_access" not in raw
    assert b"user2_legacy_access" not in raw

    # In-memory must reflect switched account's tokens
    assert _IN_MEMORY_AUTH_META.get("account_tokens", {}).get(target_email, {}).get("access_token") == "user2_legacy_access"


@pytest.mark.anyio
async def test_tier3_startup_recovery_and_transcript_logging(mock_mash_env, monkeypatch, tmp_path):
    """Tier 3: Startup cold-boot recovery followed by action persistence asserts secrets redacted in transcripts."""
    save_secure_vault({"refresh_token": "boot_recovery_refresh_token"})
    _IN_MEMORY_AUTH_META.clear()

    live_token = "live_bearer_token_xyz_12345678901234567890"

    async def mock_refresh(self, r_tok: str):
        return {"access_token": live_token, "refresh_token": "rotated_boot_refresh", "expires_in": 3600}

    monkeypatch.setattr(MAShClient, "refresh_access_token", mock_refresh)

    restored = await ensure_valid_token(force_refresh=True)
    assert restored == live_token

    # Setup database and append an action containing the active token in a curl tool call
    engine = InMemoryDatabaseEngine()
    await engine.setup_models([AgentRunActionModel, SessionModel])

    session_id = "test_e2e_session_redaction"
    user_id = "test_user"
    key = AgentRunActionKey(user_id=user_id, session_id=session_id, agent_id="main")

    msg = Message(
        role=Role.ASSISTANT,
        content=[
            TextBlock(text=f"Executing curl command with token Bearer {live_token}"),
            ToolUseBlock(
                name="run_command",
                id="tool_1",
                input={"command": f"curl -H 'Authorization: Bearer {live_token}' http://api.mash.ai"},
            ),
            ToolResultBlock(
                tool_use_id="tool_1",
                content='{"status": "ok", "api_key": "sk-proj-1234567890abcdefghijkl"}',
            ),
        ],
    )

    service = AgentRunActionService(engine=engine)
    await service.persist_append(
        key=key,
        run_id="run_1",
        root_run_id="run_1",
        parent_run_id=None,
        agent_name="main_agent",
        messages=[msg],
    )

    # Query SQLite record
    records = await engine.find_many(AgentRunActionModel)
    assert len(records) >= 1
    persisted_actions = records[0].append_messages

    dumped = json.dumps([m.model_dump() if hasattr(m, "model_dump") else m for m in persisted_actions])
    assert live_token not in dumped, "Live bearer token leaked into SQLite agent_run_actions!"
    assert "sk-proj" not in dumped, "OpenAI API key leaked into SQLite agent_run_actions!"
    assert "[REDACTED]" in dumped, "Redacted sentinel missing from persisted SQLite record!"


def test_tier3_redaction_and_session_loading_roundtrip():
    """Tier 3: Ensure data structures with nested secrets are cleanly redacted on both write and read."""
    payload = {
        "session_id": "sid_123",
        "events": [
            {"command": "export OPENAI_API_KEY=sk-123456789012345678901234567890"},
            {"header": "Authorization: Bearer my_jwt_token_12345678901234567890"},
        ],
        "metadata": {
            "anthropic_key": "sk-ant-123456789012345678901234567890",
            "nested_list": ["Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"],
        },
    }

    sanitized = redact_data_structure(payload)
    dumped = json.dumps(sanitized)

    assert "sk-123" not in dumped
    assert "sk-ant" not in dumped
    assert "my_jwt_token" not in dumped
    assert "eyJhbGci" not in dumped
    assert "[REDACTED]" in dumped


# ──────────────────────────────────────────────────────────────────────────────
# TIER 4: REAL-WORLD WORKLOAD SCENARIOS
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_tier4_full_lifecycle_login_restart_chat_audit(mock_mash_env, monkeypatch):
    """Tier 4: Full lifecycle workload simulation:
    Login -> Restart -> Chat Query -> Raw Disk Bytes Audit -> SQLite Transcript Audit.
    Verifies 0 access tokens on disk and 0 secrets leaked across entire lifecycle.
    """
    vault_file: Path = mock_mash_env["vault_file"]
    login_access_token = "initial_login_access_token_1234567890"
    login_refresh_token = "initial_login_refresh_token_9876543210"

    # 1. Login Phase: Save credentials as received from OAuth flow
    save_secure_vault(
        secrets_dict={
            "access_token": login_access_token,
            "id_token": "initial_id_token_123",
            "refresh_token": login_refresh_token,
            "expires_at": int(time.time()) + 3600,
            "active_account": "developer@mash.local",
        },
        meta_dict={
            "authenticated": True,
            "email": "developer@mash.local",
            "name": "Lead Developer",
            "plan": "pro",
            "credits_remaining": 1000,
        },
    )

    # 2. Inspect Raw Disk Bytes Post-Login
    raw_disk_login = vault_file.read_bytes()
    assert b"access_token" not in raw_disk_login
    assert b"id_token" not in raw_disk_login
    assert login_access_token.encode("utf-8") not in raw_disk_login
    assert _IN_MEMORY_AUTH_META["access_token"] == login_access_token

    # 3. Restart Phase: Simulate complete application crash / cold restart
    _IN_MEMORY_AUTH_META.clear()
    assert _IN_MEMORY_AUTH_META.get("access_token") is None

    # Cold boot token exchange
    cold_boot_access_token = "cold_boot_recovered_access_token_00000"
    async def mock_refresh(self, r_tok: str):
        assert r_tok == login_refresh_token
        return {
            "access_token": cold_boot_access_token,
            "refresh_token": "second_generation_sliding_refresh_token",
            "expires_in": 3600,
        }

    monkeypatch.setattr(MAShClient, "refresh_access_token", mock_refresh)

    restored_token = await ensure_valid_token(force_refresh=True)
    assert restored_token == cold_boot_access_token
    assert _IN_MEMORY_AUTH_META["access_token"] == cold_boot_access_token

    # 4. Agent Execution Phase: Message with tool invocations emitting secrets
    engine = InMemoryDatabaseEngine()
    await engine.setup_models([AgentRunActionModel, SessionModel])

    key = AgentRunActionKey(user_id="developer", session_id="session_workload_audit", agent_id="main")
    chat_message = Message(
        role=Role.ASSISTANT,
        content=[
            TextBlock(text=f"Logged in successfully with active session. Using Bearer {cold_boot_access_token}."),
            ToolUseBlock(
                name="run_command",
                id="tool_query_1",
                input={"cmd": f"curl -H 'Authorization: Bearer {cold_boot_access_token}' https://gateway.mash.ai"},
            ),
            ToolResultBlock(
                tool_use_id="tool_query_1",
                content="API response: Authorization successful with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
            ),
        ],
    )

    service = AgentRunActionService(engine=engine)
    await service.persist_append(
        key=key,
        run_id="workload_run_1",
        root_run_id="workload_run_1",
        parent_run_id=None,
        agent_name="main_agent",
        messages=[chat_message],
    )

    # 5. Final Forensic Disk & Database Audit
    # A. Raw auth.vault bytes audit
    raw_disk_final = vault_file.read_bytes()
    assert b"access_token" not in raw_disk_final
    assert b"id_token" not in raw_disk_final
    assert cold_boot_access_token.encode("utf-8") not in raw_disk_final
    assert login_access_token.encode("utf-8") not in raw_disk_final

    # B. SQLite database audit
    actions = await engine.find_many(AgentRunActionModel)
    sqlite_dump = json.dumps([a.model_dump(mode="json") for a in actions], default=str)
    assert cold_boot_access_token not in sqlite_dump
    assert login_access_token not in sqlite_dump
    assert "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" not in sqlite_dump
    assert "[REDACTED]" in sqlite_dump


def test_tier4_legacy_upgrade_lifecycle(mock_mash_env):
    """Tier 4: Complete upgrade lifecycle from pre-existing ~/.nexau installation to ~/.mash.
    Validates zero data loss, non-destructive file preservation, and automatic schema hardening.
    """
    home = mock_mash_env["home"]
    legacy_dir = home / ".nexau"
    mash_dir = home / ".mash"

    # Step 1: Pre-populate legacy directory hierarchy
    legacy_db_file = legacy_dir / "database" / "nexau.db"
    legacy_db_file.parent.mkdir(parents=True, exist_ok=True)
    legacy_db_file.write_bytes(b"SQLite format 3\x00_LEGACY_PREEXISTING_DATABASE")

    legacy_vault_file = legacy_dir / "auth.vault"
    legacy_vault_data = {
        "access_token": "unhardened_legacy_access_token",
        "id_token": "unhardened_legacy_id_token",
        "refresh_token": "preservable_legacy_refresh_token",
        "active_account": "upgrading_user@mash.local",
    }
    legacy_vault_file.write_bytes(_encrypt_legacy_blob(json.dumps(legacy_vault_data).encode("utf-8")))

    legacy_settings_file = legacy_dir / "settings.json"
    legacy_settings_file.write_text('{"theme": "system", "auto_update": false}', encoding="utf-8")

    # Step 2: System Boot / Migration Trigger
    new_db = get_database_path()
    assert new_db.exists()
    assert b"SQLite format 3\x00_LEGACY_PREEXISTING_DATABASE" in new_db.read_bytes()

    # Step 3: Verify non-destructive preservation
    assert legacy_db_file.exists(), "Legacy database file was deleted!"
    assert legacy_vault_file.exists(), "Legacy vault file was deleted!"
    assert legacy_settings_file.exists(), "Legacy settings file was deleted!"

    # Step 4: Vault Load & Hardening on Boot
    vault = load_secure_vault()
    assert vault is not None
    assert vault["refresh_token"] == "preservable_legacy_refresh_token"
    assert "access_token" not in vault
    assert "id_token" not in vault

    # Step 5: Verify new ~/.mash/auth.vault was created in hardened format
    new_vault_file = mash_dir / "auth.vault"
    assert new_vault_file.exists()
    new_vault_bytes = new_vault_file.read_bytes()
    assert b"unhardened_legacy_access_token" not in new_vault_bytes
    assert b"access_token" not in new_vault_bytes

    # Step 6: Verify in-memory session continuity
    assert _IN_MEMORY_AUTH_META["access_token"] == "unhardened_legacy_access_token"
