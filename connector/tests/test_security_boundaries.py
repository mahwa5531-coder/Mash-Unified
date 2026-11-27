# Copyright (c) Mash. All rights reserved.
"""Unit and contract tests for local sidecar IPC auth, production CORS, and cloud HTTPS guards."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.client import MAShClient, _validate_cloud_gateway_url
from app.main import app


def test_ipc_token_middleware_blocks_unauthenticated_local_calls(monkeypatch):
    """When MASH_IPC_TOKEN is active, local endpoints require matching X-Mash-Token."""
    monkeypatch.setenv("MASH_IPC_TOKEN", "test_secret_ipc_token_256bit")
    client = TestClient(app)

    # Protected routes reject missing or invalid token
    assert client.get("/api/auth/config").status_code == 403
    assert client.get("/api/auth/config", headers={"X-Mash-Token": "wrong"}).status_code == 403
    assert client.post("/api/system/open-file", json={"file_path": "foo.txt"}).status_code == 403

    # Exact token succeeds
    ok_res = client.get("/api/auth/config", headers={"X-Mash-Token": "test_secret_ipc_token_256bit"})
    assert ok_res.status_code == 200

    # Health probes & CORS preflight stay accessible
    assert client.get("/health").status_code == 200
    assert client.get("/api/health").status_code == 200
    opt_res = client.options(
        "/api/auth/config",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "x-mash-token",
        },
    )
    assert opt_res.status_code in (200, 204)


def test_ipc_token_middleware_allows_dev_when_unset(monkeypatch):
    """When MASH_IPC_TOKEN is unset (browser dev mode), local routes work without the header."""
    monkeypatch.delenv("MASH_IPC_TOKEN", raising=False)
    client = TestClient(app)
    assert client.get("/api/auth/config").status_code == 200


def test_cloud_gateway_requires_https_in_frozen_prod(monkeypatch):
    """Frozen production builds reject plaintext http:// cloud gateway overrides."""
    import sys

    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.delenv("MASH_ALLOW_INSECURE_GATEWAY", raising=False)

    with pytest.raises(ValueError, match="Insecure cloud gateway URL blocked"):
        _validate_cloud_gateway_url("http://api.mash.ai")

    assert _validate_cloud_gateway_url("https://api.mash.ai/") == "https://api.mash.ai"

    monkeypatch.setenv("MASH_ALLOW_INSECURE_GATEWAY", "1")
    assert _validate_cloud_gateway_url("http://127.0.0.1:9000/") == "http://127.0.0.1:9000"


@pytest.mark.anyio
async def test_mash_client_disables_redirects():
    """Outbound cloud requests must disable automatic redirect following so tokens never leak off-origin."""
    client = MAShClient(base_url="https://api.mash.ai")
    async with client._client() as async_client:
        assert async_client.follow_redirects is False
