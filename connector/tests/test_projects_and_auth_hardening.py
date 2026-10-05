import pytest
import os
import shutil
from pathlib import Path
from fastapi.testclient import TestClient
from nexau.archs.llm.llm_config import LLMConfig
from app.main import app, _build_agent_config
from app.models.project import ProjectModel
from nexau.archs.platform.crypto_vault import clear_vault, save_secure_vault

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
