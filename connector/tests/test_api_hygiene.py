"""Unit tests for API Hygiene & Health fixes (B-07, B-11, B-12, B-13, B-14, B-15, B-16)."""

import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


# ==============================================================================
# B-07: Workspace Directory Guard
# ==============================================================================
def test_create_project_rejects_missing_directory_with_422(client, tmp_path):
    """Verify that create_project returns HTTP 422 if local_folder_path does not exist."""
    non_existent = tmp_path / "does_not_exist_workspace_dir_12345"
    assert not non_existent.exists()

    res = client.post("/api/projects", json={
        "name": "GuardedTestProject",
        "local_folder_path": str(non_existent),
        "user_id": "test_user",
    })
    assert res.status_code == 422
    data = res.json()
    assert "Workspace directory does not exist or is not a directory" in data.get("detail", "")
    assert not non_existent.exists()


def test_create_project_succeeds_with_existing_directory(client, tmp_path):
    """Verify that create_project succeeds with HTTP 200 when local_folder_path is a valid directory."""
    valid_dir = tmp_path / "valid_workspace_dir"
    valid_dir.mkdir(parents=True, exist_ok=True)

    res = client.post("/api/projects", json={
        "name": "ValidDirProject",
        "local_folder_path": str(valid_dir),
        "user_id": "test_user",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["name"] == "ValidDirProject"
    assert "id" in data


# ==============================================================================
# B-11: Empty Project Name Validation
# ==============================================================================
def test_create_project_rejects_empty_or_whitespace_name_with_400(client, tmp_path):
    """Verify that create_project rejects empty or whitespace-only names with HTTP 400 Bad Request."""
    valid_dir = tmp_path / "valid_dir_b11"
    valid_dir.mkdir(parents=True, exist_ok=True)

    # Completely empty string
    res_empty = client.post("/api/projects", json={
        "name": "",
        "local_folder_path": str(valid_dir),
        "user_id": "test_user",
    })
    assert res_empty.status_code == 400
    assert "cannot be empty" in res_empty.json().get("detail", "")

    # Whitespace only string
    res_spaces = client.post("/api/projects", json={
        "name": "    \t \n  ",
        "local_folder_path": str(valid_dir),
        "user_id": "test_user",
    })
    assert res_spaces.status_code == 400
    assert "cannot be empty" in res_spaces.json().get("detail", "")


# ==============================================================================
# B-12: Duplicate Project Names & Stripped Name Enforcement
# ==============================================================================
def test_create_project_enforces_case_insensitive_uniqueness(client, tmp_path):
    """Verify case-insensitive uniqueness returns the existing project and saves stripped names."""
    dir1 = tmp_path / "dir_unique_1"
    dir1.mkdir(parents=True, exist_ok=True)

    res1 = client.post("/api/projects", json={
        "name": "  UniqueAlphaProject  ",
        "local_folder_path": str(dir1),
        "user_id": "test_user",
    })
    assert res1.status_code == 200
    data1 = res1.json()
    assert data1["name"] == "UniqueAlphaProject"
    proj_id = data1["id"]

    # Re-post with different casing and whitespace
    dir2 = tmp_path / "dir_unique_2"
    dir2.mkdir(parents=True, exist_ok=True)
    res2 = client.post("/api/projects", json={
        "name": "uniquealphaproject",
        "local_folder_path": str(dir2),
        "user_id": "test_user",
    })
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["id"] == proj_id


# ==============================================================================
# B-13: Standardized Delete Contract (404 on Missing Project)
# ==============================================================================
def test_delete_project_missing_returns_404(client):
    """Verify that deleting a non-existent project returns HTTP 404 Not Found."""
    res = client.delete("/api/projects/non_existent_project_id_xyz_999")
    assert res.status_code == 404
    assert "not found" in res.json().get("detail", "").lower()


def test_delete_project_repeat_delete_returns_404(client, tmp_path):
    """Verify deleting an existing project succeeds (200) and repeated delete returns 404."""
    valid_dir = tmp_path / "dir_delete_test"
    valid_dir.mkdir(parents=True, exist_ok=True)

    create_res = client.post("/api/projects", json={
        "name": "ProjectToDelete",
        "local_folder_path": str(valid_dir),
        "user_id": "test_user",
    })
    assert create_res.status_code == 200
    proj_id = create_res.json()["id"]

    # First delete -> 200 OK
    del1 = client.delete(f"/api/projects/{proj_id}")
    assert del1.status_code == 200
    assert del1.json().get("status") == "success"

    # Second delete -> 404 Not Found
    del2 = client.delete(f"/api/projects/{proj_id}")
    assert del2.status_code == 404


# ==============================================================================
# B-14: /undo Body Requirement Optional Default
# ==============================================================================
def test_undo_session_without_body_succeeds(client):
    """Verify DELETE /sessions/{id}/undo and /api/sessions/{id}/undo succeed without request body."""
    # 1. Create a session
    sess_res = client.post("/api/sessions", json={"title": "UndoTestSession"})
    assert sess_res.status_code == 200
    session_id = sess_res.json()["session_id"]

    # 2. DELETE without body on /sessions/{session_id}/undo
    res1 = client.delete(f"/sessions/{session_id}/undo")
    assert res1.status_code == 200
    data1 = res1.json()
    assert data1.get("status") == "success"

    # 3. DELETE without body on /api/sessions/{session_id}/undo
    res2 = client.delete(f"/api/sessions/{session_id}/undo")
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2.get("status") == "success"


def test_undo_session_with_explicit_body_succeeds(client):
    """Verify DELETE /api/sessions/{id}/undo also succeeds when explicit JSON body is provided."""
    sess_res = client.post("/api/sessions", json={"title": "UndoWithBodySession"})
    assert sess_res.status_code == 200
    session_id = sess_res.json()["session_id"]

    res = client.request("DELETE", f"/api/sessions/{session_id}/undo", json={"from_turn": 0})
    assert res.status_code == 200
    assert res.json().get("status") == "success"


# ==============================================================================
# B-15: Tasks Kill Contradictory Status Fix
# ==============================================================================
def test_kill_task_dead_pid_never_returns_contradictory_status(client):
    """Verify that attempting to kill a dead PID returns success: False and status: 'failed' (never 'killed')."""
    dead_pid = 99999999
    res = client.post(f"/api/tasks/{dead_pid}/kill")
    assert res.status_code == 200
    data = res.json()
    assert data["pid"] == dead_pid
    assert data["success"] is False
    assert data["status"] == "failed"
    assert data["status"] != "killed"


# ==============================================================================
# B-16: Root /health Probe & Zero Doubled Routes
# ==============================================================================
def test_root_health_probe_returns_200(client):
    """Verify GET /health returns HTTP 200 OK with expected system health payload."""
    res = client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data == {"status": "ok", "service": "mash-backend"}


def test_api_health_endpoints_return_200(client):
    """Verify GET /api/health and /api/system/health both return 200 OK."""
    res1 = client.get("/api/health")
    assert res1.status_code == 200
    assert res1.json() == {"status": "ok", "service": "mash-backend"}

    res2 = client.get("/api/system/health")
    assert res2.status_code == 200
    assert res2.json() == {"status": "ok", "service": "mash-backend"}


def test_zero_doubled_api_routes():
    """Verify zero routes contain accidental '/api/api/' prefix doubling."""
    routes = [r.path for r in app.routes]
    doubled = [r for r in routes if "/api/api/" in r]
    assert len(doubled) == 0, f"Found doubled routes: {doubled}"
    assert "/health" in routes
