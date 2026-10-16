import os
import shutil

import pytest
from app.main import app
from fastapi.testclient import TestClient
from nexau.archs.llm.llm_config import LLMConfig
from nexau.archs.platform.crypto_vault import clear_vault


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c

def test_llm_config_initialization_without_keys():
    """Verify LLMConfig does not crash on boot without API keys (Defect C3 root fix)."""
    # Clear any active env keys
    orig_env = {k: os.environ.pop(k, None) for k in ["OPENAI_API_KEY", "LLM_API_KEY", "API_KEY", "ANTHROPIC_API_KEY"]}
    try:
        config = LLMConfig(model="mash-audit-v1", base_url="https://api.mash.ai/v1")
        assert config.api_key == "bearer-pending-auth"
    finally:
        for k, v in orig_env.items():
            if v is not None:
                os.environ[k] = v

def test_auth_me_unauthenticated_fails_closed(client):
    """Verify /api/auth/me returns authenticated: False without hardcoded mock credentials."""
    # Ensure clean unauthenticated state
    clear_vault()

    res = client.get("/api/auth/me")
    assert res.status_code == 200
    data = res.json()
    assert data["authenticated"] is False
    assert "email" not in data or data["email"] is None
    assert "auditor@mash.local" not in str(data)
    assert 999999 not in data.values()

def test_create_quick_project_sanitizes_and_succeeds(client):
    """Verify create_quick_project sanitizes illegal Windows characters and creates folder safely."""
    illegal_name = 'Audit:Project*With<Illegal>Chars'
    res = client.post("/api/projects/quick", json={"name": illegal_name, "user_id": "test_user"})
    assert res.status_code == 200
    project = res.json()
    assert "id" in project
    assert ":" not in project["name"]
    assert "<" not in project["name"]
    assert ">" not in project["name"]
    assert "*" not in project["name"]
    assert os.path.exists(project["local_folder_path"])

    # Clean up created directory
    shutil.rmtree(project["local_folder_path"], ignore_errors=True)

def test_delete_project_is_idempotent(client):
    """Verify workspace deletion succeeds cleanly and is idempotent (no 404 error on repeat delete)."""
    # 1. Create a quick project
    res = client.post("/api/projects/quick", json={"name": "TempToDelete", "user_id": "test_user"})
    assert res.status_code == 200
    proj_id = res.json()["id"]

    # 2. First delete call -> succeeds
    del1 = client.delete(f"/api/projects/{proj_id}")
    assert del1.status_code == 200
    assert del1.json()["status"] == "success"

    # 3. Second delete call -> succeeds idempotently without 404
    del2 = client.delete(f"/api/projects/{proj_id}")
    assert del2.status_code == 200
    assert del2.json()["status"] == "success"
    assert "already removed" in del2.json()["message"]


@pytest.mark.anyio
async def test_vault_on_disk_contains_no_access_token_or_id_token():
    """Verify auth.vault on disk contains no plaintext or DPAPI-decrypted access_token or id_token."""
    from app.routers.auth import LoginPayload, handle_login
    from nexau.archs.platform.crypto_vault import (
        VAULT_FILE,
        _IN_MEMORY_AUTH_META,
        clear_vault,
        load_secure_vault,
    )

    clear_vault()
    payload = LoginPayload(
        email="hardened.auditor@mash.local",
        name="Hardened Auditor",
        plan="enterprise",
        access_token="secret_ephemeral_access_token_123",
        refresh_token="nxr_persistent_refresh_token_456",
        id_token="secret_ephemeral_id_token_789",
        expires_at=1900000000,
        credits_remaining=1000,
    )
    await handle_login(payload)

    # 1. Assert disk file exists
    assert VAULT_FILE.exists()
    raw_disk_bytes = VAULT_FILE.read_bytes()

    # 2. Check raw disk bytes for plaintext token leakage
    assert b"secret_ephemeral_access_token_123" not in raw_disk_bytes
    assert b"secret_ephemeral_id_token_789" not in raw_disk_bytes
    assert b'"access_token"' not in raw_disk_bytes
    assert b'"id_token"' not in raw_disk_bytes

    # 3. Decrypt and check vault structure
    decrypted = load_secure_vault()
    assert decrypted is not None
    assert "access_token" not in decrypted
    assert "id_token" not in decrypted
    assert "expires_at" not in decrypted
    assert decrypted.get("refresh_token") == "nxr_persistent_refresh_token_456"
    assert decrypted.get("active_account") == "hardened.auditor@mash.local"

    # Verify nested account is also sanitized on disk
    accounts = decrypted.get("accounts", {})
    account = accounts.get("hardened.auditor@mash.local", {})
    assert "access_token" not in account
    assert "id_token" not in account
    assert "expires_at" not in account
    assert account.get("refresh_token") == "nxr_persistent_refresh_token_456"

    # 4. Verify in-memory state holds active ephemeral credentials
    assert _IN_MEMORY_AUTH_META.get("access_token") == "secret_ephemeral_access_token_123"
    assert _IN_MEMORY_AUTH_META.get("id_token") == "secret_ephemeral_id_token_789"
    assert _IN_MEMORY_AUTH_META.get("expires_at") == 1900000000

    clear_vault()


def test_legacy_vault_auto_migration_scrubs_access_token():
    """Verify legacy auth.vault with access_token is automatically scrubbed and resaved upon load."""
    import ctypes
    import json
    import sys
    from nexau.archs.platform.crypto_vault import (
        DATA_BLOB,
        VAULT_FILE,
        _IN_MEMORY_AUTH_META,
        clear_vault,
        load_secure_vault,
    )

    clear_vault()
    legacy_payload = {
        "active_account": "legacy.user@mash.local",
        "access_token": "legacy_jwt_access_to_be_scrubbed",
        "id_token": "legacy_jwt_id_to_be_scrubbed",
        "refresh_token": "nxr_legacy_keep_refresh",
        "expires_at": 1800000000,
        "accounts": {
            "legacy.user@mash.local": {
                "email": "legacy.user@mash.local",
                "name": "Legacy User",
                "access_token": "legacy_jwt_access_to_be_scrubbed",
                "id_token": "legacy_jwt_id_to_be_scrubbed",
                "refresh_token": "nxr_legacy_keep_refresh",
                "expires_at": 1800000000,
                "plan": "pro",
            }
        },
    }

    raw = json.dumps(legacy_payload).encode("utf-8")
    VAULT_FILE.parent.mkdir(parents=True, exist_ok=True)
    if sys.platform == "win32":
        blob_in = DATA_BLOB(
            len(raw),
            ctypes.cast(ctypes.create_string_buffer(raw), ctypes.POINTER(ctypes.c_char)),
        )
        blob_out = DATA_BLOB()
        assert ctypes.windll.crypt32.CryptProtectData(
            ctypes.byref(blob_in), "NexAU_Vault", None, None, None, 0, ctypes.byref(blob_out)
        )
        cb_data = int(blob_out.cbData)
        pb_data = blob_out.pbData
        buffer = ctypes.string_at(pb_data, cb_data)
        ctypes.windll.kernel32.LocalFree(pb_data)
        VAULT_FILE.write_bytes(buffer)
    else:
        VAULT_FILE.write_bytes(raw)

    # Pre-condition: RAM is clean
    _IN_MEMORY_AUTH_META.clear()
    assert _IN_MEMORY_AUTH_META.get("access_token") is None

    # Load triggers automatic scrubbing and resaving
    migrated = load_secure_vault()
    assert migrated is not None

    # Assert returned dict and memory have transitioned
    assert "access_token" not in migrated
    assert "id_token" not in migrated
    assert "expires_at" not in migrated
    assert migrated.get("refresh_token") == "nxr_legacy_keep_refresh"
    assert _IN_MEMORY_AUTH_META.get("access_token") == "legacy_jwt_access_to_be_scrubbed"
    assert _IN_MEMORY_AUTH_META.get("id_token") == "legacy_jwt_id_to_be_scrubbed"

    # Verify disk vault was rewritten and is now free of access_token
    reloaded = load_secure_vault()
    assert reloaded is not None
    assert "access_token" not in reloaded
    assert "id_token" not in reloaded
    assert "access_token" not in reloaded.get("accounts", {}).get("legacy.user@mash.local", {})

    clear_vault()


@pytest.mark.anyio
async def test_cold_boot_token_restoration_via_refresh_token():
    """Verify application cold boot exchanges vaulted refresh_token for in-memory access_token."""
    from unittest.mock import patch
    import httpx
    import respx
    from app.routers.auth import ensure_valid_token
    from nexau.archs.platform.crypto_vault import (
        _IN_MEMORY_AUTH_META,
        clear_vault,
        load_secure_vault,
        save_secure_vault,
    )

    clear_vault()

    # Simulate vault saved from prior session with only refresh_token
    save_secure_vault(
        {
            "active_account": "coldboot.auditor@mash.local",
            "refresh_token": "nxr_coldboot_valid_refresh_token",
            "accounts": {
                "coldboot.auditor@mash.local": {
                    "email": "coldboot.auditor@mash.local",
                    "refresh_token": "nxr_coldboot_valid_refresh_token",
                    "plan": "enterprise",
                }
            },
        },
        meta_dict={"authenticated": True, "email": "coldboot.auditor@mash.local"},
    )

    # Cold boot condition: in-memory state is empty (simulating process restart)
    _IN_MEMORY_AUTH_META.pop("access_token", None)
    _IN_MEMORY_AUTH_META.pop("id_token", None)
    _IN_MEMORY_AUTH_META.pop("expires_at", None)
    assert _IN_MEMORY_AUTH_META.get("access_token") is None

    cloud_url = "https://api.mash.ai"
    async with respx.mock(base_url=cloud_url) as respx_mock:
        respx_mock.post("/v1/auth/refresh").mock(
            return_value=httpx.Response(
                200,
                json={
                    "access_token": "jwt_coldboot_restored_access_token",
                    "refresh_token": "nxr_coldboot_rotated_refresh_token",
                    "id_token": "jwt_coldboot_restored_id_token",
                    "expires_in": 3600,
                },
            )
        )

        with patch.dict(os.environ, {"CLOUD_GATEWAY_URL": cloud_url}):
            restored_token = await ensure_valid_token()
            assert restored_token == "jwt_coldboot_restored_access_token"

            # Assert token is now live in RAM
            assert _IN_MEMORY_AUTH_META.get("access_token") == "jwt_coldboot_restored_access_token"
            assert _IN_MEMORY_AUTH_META.get("id_token") == "jwt_coldboot_restored_id_token"

            # Assert disk vault still contains 0 access tokens and has rotated refresh token
            vault = load_secure_vault()
            assert vault is not None
            assert "access_token" not in vault
            assert "id_token" not in vault
            assert vault["refresh_token"] == "nxr_coldboot_rotated_refresh_token"

    clear_vault()


def test_logout_unlinks_legacy_vault_and_prevents_session_resurrection(client, monkeypatch, tmp_path):
    """Verify logging out deletes both modern ~/.mash/auth.vault and legacy ~/.nexau/auth.vault,
    preventing logged-out session resurrection on subsequent loads or cold boots."""
    from pathlib import Path
    import nexau.archs.platform.crypto_vault as cv

    home = tmp_path / "legacy_user_home"
    nexau_dir = home / ".nexau"
    mash_dir = home / ".mash"
    nexau_dir.mkdir(parents=True, exist_ok=True)
    mash_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(Path, "home", lambda: home)

    # 1. Seed a legacy vault file in ~/.nexau/auth.vault
    legacy_vault_file = nexau_dir / "auth.vault"
    monkeypatch.setattr(cv, "VAULT_FILE", legacy_vault_file)
    cv.save_secure_vault({"refresh_token": "rt_legacy_123", "active_account": "user@legacy.com"})

    # Point VAULT_FILE to ~/.mash/auth.vault
    mash_vault_file = mash_dir / "auth.vault"
    monkeypatch.setattr(cv, "VAULT_FILE", mash_vault_file)

    # 2. Initial load migrates legacy credentials to mash
    v1 = cv.load_secure_vault()
    assert v1 is not None
    assert v1.get("active_account") == "user@legacy.com"
    assert mash_vault_file.exists()

    # 3. User logs out via clear_vault()
    cv.clear_vault()

    # Both files must be unlinked
    assert not mash_vault_file.exists()
    assert not legacy_vault_file.exists()

    # 4. Subsequent load must NOT resurrect old session
    v2 = cv.load_secure_vault()
    assert v2 is None, f"Expected None after logout, got {v2}"
    meta = cv.get_auth_metadata()
    assert meta.get("authenticated") is False

    # 5. Also verify via HTTP POST /api/auth/logout endpoint
    # Re-seed legacy file
    monkeypatch.setattr(cv, "VAULT_FILE", legacy_vault_file)
    cv.save_secure_vault({"refresh_token": "rt_legacy_456", "active_account": "user2@legacy.com"})
    monkeypatch.setattr(cv, "VAULT_FILE", mash_vault_file)
    assert cv.load_secure_vault() is not None

    res = client.post("/api/auth/logout")
    assert res.status_code == 200
    assert res.json().get("success") is True
    assert not mash_vault_file.exists()
    assert not legacy_vault_file.exists()

    res_me = client.get("/api/auth/me")
    assert res_me.status_code == 200
    assert res_me.json().get("authenticated") is False


@pytest.mark.parametrize("corrupt_val", [
    12345,
    "primitive_string_value",
    ["array", "of", "items"],
    None,
])
def test_load_secure_vault_handles_non_dict_json(corrupt_val, monkeypatch, tmp_path):
    """Verify load_secure_vault gracefully returns None when decrypted payload is not a dict."""
    import ctypes
    import json
    import sys
    from pathlib import Path
    import nexau.archs.platform.crypto_vault as cv
    from nexau.archs.platform.crypto_vault import DATA_BLOB

    home = tmp_path / "nondict_home"
    mash_dir = home / ".mash"
    mash_dir.mkdir(parents=True, exist_ok=True)
    vault_file = mash_dir / "auth.vault"

    monkeypatch.setattr(Path, "home", lambda: home)
    monkeypatch.setattr(cv, "VAULT_FILE", vault_file)

    raw_json = json.dumps(corrupt_val).encode("utf-8")
    if sys.platform == "win32":
        blob_in = DATA_BLOB(
            len(raw_json),
            ctypes.cast(ctypes.create_string_buffer(raw_json), ctypes.POINTER(ctypes.c_char)),
        )
        blob_out = DATA_BLOB()
        assert ctypes.windll.crypt32.CryptProtectData(
            ctypes.byref(blob_in), "NexAU_Vault", None, None, None, 0, ctypes.byref(blob_out)
        )
        cb_data = int(blob_out.cbData)
        pb_data = blob_out.pbData
        enc_blob = ctypes.string_at(pb_data, cb_data)
        ctypes.windll.kernel32.LocalFree(pb_data)
        vault_file.write_bytes(enc_blob)
    else:
        vault_file.write_bytes(raw_json)

    res = cv.load_secure_vault()
    assert res is None


def test_accounts_as_list_scrubs_tokens_and_prevents_disk_leak(monkeypatch, tmp_path):
    """Verify accounts formatted as a list of dicts are scrubbed and access_token is never saved to disk."""
    from pathlib import Path
    import nexau.archs.platform.crypto_vault as cv

    home = tmp_path / "list_accounts_home"
    mash_dir = home / ".mash"
    mash_dir.mkdir(parents=True, exist_ok=True)
    vault_file = mash_dir / "auth.vault"

    monkeypatch.setattr(Path, "home", lambda: home)
    monkeypatch.setattr(cv, "VAULT_FILE", vault_file)
    cv.clear_vault()

    payload = {
        "active_account": "user_list@mash.local",
        "accounts": [
            {
                "email": "user_list@mash.local",
                "name": "List User",
                "access_token": "secret_access_token_in_list",
                "id_token": "secret_id_token_in_list",
                "refresh_token": "valid_refresh_token_keep",
            }
        ],
    }

    ok = cv.save_secure_vault(payload)
    assert ok is True

    # 1. Verify in-memory state received the ephemeral tokens
    in_mem = cv.get_in_memory_auth_meta()
    assert (
        in_mem.get("account_tokens", {}).get("user_list@mash.local", {}).get("access_token")
        == "secret_access_token_in_list"
    )
    assert (
        in_mem.get("account_tokens", {}).get("user_list@mash.local", {}).get("id_token")
        == "secret_id_token_in_list"
    )

    # 2. Verify disk vault is sanitized
    raw_disk = vault_file.read_bytes()
    assert b"secret_access_token_in_list" not in raw_disk
    assert b"secret_id_token_in_list" not in raw_disk

    # 3. Verify load_secure_vault returns sanitized accounts
    decrypted = cv.load_secure_vault()
    assert decrypted is not None
    accounts = decrypted.get("accounts")
    assert isinstance(accounts, list)
    assert len(accounts) == 1
    assert "access_token" not in accounts[0]
    assert "id_token" not in accounts[0]
    assert accounts[0].get("refresh_token") == "valid_refresh_token_keep"

    cv.clear_vault()


@pytest.mark.anyio
async def test_cold_boot_expired_refresh_token_fails_closed(client, monkeypatch):
    """Verify cold-boot with expired refresh token marks auth False and purges dead token."""
    import httpx
    import nexau.archs.platform.crypto_vault as cv
    from app.client import MAShClient
    from app.routers.auth import ensure_valid_token

    cv.clear_vault()
    cv._IN_MEMORY_AUTH_META.clear()

    # Seed vault with an account and expired refresh token (30+ days of inactivity)
    cv.save_secure_vault({
        "active_account": "dormant_user@auditfirm.com",
        "refresh_token": "expired_rt_30d_plus",
        "accounts": {
            "dormant_user@auditfirm.com": {
                "email": "dormant_user@auditfirm.com",
                "name": "Dormant User",
                "plan": "pro",
                "refresh_token": "expired_rt_30d_plus",
            }
        }
    })

    # Simulate Cloud Gateway rejecting expired token with 401 Unauthorized / invalid_grant
    async def mock_failed_refresh(self, refresh_tok: str):
        req = httpx.Request("POST", "https://api.mash.ai/v1/auth/refresh")
        resp = httpx.Response(401, json={"detail": "invalid_grant: refresh token expired"}, request=req)
        raise httpx.HTTPStatusError("401 Unauthorized", request=req, response=resp)

    monkeypatch.setattr(MAShClient, "refresh_access_token", mock_failed_refresh)

    # 1. ensure_valid_token() fails closed and returns None
    token = await ensure_valid_token()
    assert token is None

    # 2. In-memory metadata and get_auth_metadata report unauthenticated
    meta = cv.get_auth_metadata()
    assert meta["authenticated"] is False

    # 3. /api/auth/me returns authenticated: False to frontend
    res = client.get("/api/auth/me")
    assert res.status_code == 200
    assert res.json()["authenticated"] is False

    # 4. Dead refresh token is scrubbed from disk vault
    vault = cv.load_secure_vault()
    assert vault is not None
    assert "refresh_token" not in vault
    acc = vault.get("accounts", {}).get("dormant_user@auditfirm.com", {})
    assert "refresh_token" not in acc

    cv.clear_vault()


@pytest.mark.anyio
async def test_cold_boot_vault_without_credentials_fails_closed(client, monkeypatch):
    """Verify cold-boot vault having active_account but no credentials reports authenticated: False."""
    import nexau.archs.platform.crypto_vault as cv
    from app.routers.auth import ensure_valid_token

    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("API_KEY", raising=False)

    cv.clear_vault()
    cv._IN_MEMORY_AUTH_META.clear()

    # Vault has active_account string, but no refresh_token and no api_key
    cv.save_secure_vault({
        "active_account": "no_creds@mash.local",
        "accounts": {
            "no_creds@mash.local": {
                "email": "no_creds@mash.local",
                "name": "No Creds",
                "plan": "free",
            }
        }
    })

    # 1. get_auth_metadata() immediately reports False
    meta = cv.get_auth_metadata()
    assert meta["authenticated"] is False

    # 2. ensure_valid_token() returns None
    token = await ensure_valid_token()
    assert token is None

    # 3. /api/auth/me returns authenticated: False
    res = client.get("/api/auth/me")
    assert res.status_code == 200
    assert res.json()["authenticated"] is False

    cv.clear_vault()


@pytest.mark.anyio
async def test_cold_boot_transient_offline_recovers_on_network_restore(client, monkeypatch):
    """Verify transient network offline on cold boot does not scrub vault and cleanly recovers when online."""
    import httpx
    import nexau.archs.platform.crypto_vault as cv
    from app.client import MAShClient
    from app.routers.auth import ensure_valid_token

    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("API_KEY", raising=False)

    cv.clear_vault()
    cv._IN_MEMORY_AUTH_META.clear()

    cv.save_secure_vault({
        "active_account": "offline_recovery@mash.local",
        "refresh_token": "valid_rt_offline_test",
        "accounts": {
            "offline_recovery@mash.local": {
                "email": "offline_recovery@mash.local",
                "name": "Offline Recovery User",
                "plan": "pro",
                "refresh_token": "valid_rt_offline_test",
            }
        }
    })

    # Step 1: Network is offline
    async def mock_offline(self, tok: str):
        raise httpx.ConnectError("Offline: connection refused")

    monkeypatch.setattr(MAShClient, "refresh_access_token", mock_offline)

    # 1. ensure_valid_token returns None
    tok = await ensure_valid_token()
    assert tok is None

    # 2. /api/auth/me fails closed while offline
    res1 = client.get("/api/auth/me")
    assert res1.status_code == 200
    assert res1.json()["authenticated"] is False

    # 3. Refresh token was NOT scrubbed from vault
    vault = cv.load_secure_vault()
    assert vault.get("refresh_token") == "valid_rt_offline_test"

    # Step 2: Network is restored
    async def mock_online(self, tok: str):
        return {
            "access_token": "fresh_recovered_jwt",
            "expires_in": 3600,
            "refresh_token": "valid_rt_offline_test",
        }

    monkeypatch.setattr(MAShClient, "refresh_access_token", mock_online)

    # 4. /api/auth/me recovers seamlessly and authenticates user
    res2 = client.get("/api/auth/me")
    assert res2.status_code == 200
    assert res2.json()["authenticated"] is True
    assert res2.json()["email"] == "offline_recovery@mash.local"

    cv.clear_vault()


@pytest.mark.anyio
async def test_account_switch_credential_validation(client, monkeypatch):
    """Verify switching between accounts updates auth state based on target credentials."""
    import nexau.archs.platform.crypto_vault as cv

    monkeypatch.delenv("LLM_API_KEY", raising=False)
    cv.clear_vault()
    cv._IN_MEMORY_AUTH_META.clear()

    cv.save_secure_vault({
        "active_account": "acc1@mash.local",
        "refresh_token": "rt_acc1",
        "accounts": {
            "acc1@mash.local": {
                "email": "acc1@mash.local",
                "refresh_token": "rt_acc1",
                "plan": "pro",
            },
            "acc2_no_creds@mash.local": {
                "email": "acc2_no_creds@mash.local",
                "plan": "free",
            }
        }
    }, meta_dict={"authenticated": True, "email": "acc1@mash.local"})

    # Switch to account with no credentials
    res = client.post("/api/auth/switch", json={"email": "acc2_no_creds@mash.local"})
    assert res.status_code == 200

    # /api/auth/me must report authenticated: False
    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["authenticated"] is False

    cv.clear_vault()


