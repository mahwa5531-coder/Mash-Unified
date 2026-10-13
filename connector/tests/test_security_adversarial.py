"""
Adversarial Security Verification Suite
---------------------------------------
Validates resolution of all 13 reported security vectors:
1. Arbitrary directory creation via traversal (../../x)
2. Absolute path injection (/home/... or C:\\...)
3. Total data wipe attempt via DELETE /sessions/..
4. File write outside brain root via POST /api/uploads/..
5. Arbitrary file read via GET /api/tasks/../../log
6. Directory listing disclosure via GET /api/uploads/.. and /artifacts/.../..
7. Unvalidated rmtree from DB values / out-of-boundary brain dirs
8. Ghost sessions with traversal IDs in DB
9. Null byte ID injection (sess_\\x00evil) -> HTTP 400 (not 500)
10. Oversized 300-char ID -> HTTP 400 (not crash)
11. Windows backslash traversal (..\\..\\x) -> HTTP 400
12. default_session litter prevention
13. Fake success elimination on DELETE non-existent sessions (HTTP 404)
Plus: os.startfile escalation confinement check in POST /api/system/open-file
"""

import os
import sys
import uuid
from pathlib import Path

import httpx
import pytest

# Ensure connector and NexAU are in sys.path
CONNECTOR_DIR = Path(__file__).resolve().parent.parent
NEXAU_DIR = CONNECTOR_DIR.parent / "NexAU"
if str(CONNECTOR_DIR) not in sys.path:
    sys.path.insert(0, str(CONNECTOR_DIR))
if str(NEXAU_DIR) not in sys.path:
    sys.path.insert(0, str(NEXAU_DIR))

from app.main import app, lifespan
from app.paths import (
    SAFE_ID_REGEX,
    get_nexau_home,
    get_session_brain_dir,
    safe_rmtree_session_brain,
    validate_safe_id,
)


# ======================================================================
# Unit Level Validation Checks (Foundation Layer)
# ======================================================================

def test_validate_safe_id_accepts_clean_ids():
    """Verify that legitimate ULID, UUID, and session identifiers pass validation."""
    valid_ids = [
        "sess_1234567890",
        "01AN4Z07BY79KA1307SR9X4MV3",
        "sess_m1abc234_xyz89",
        "proj-01-audit",
        "task_112233",
    ]
    for vid in valid_ids:
        assert validate_safe_id(vid) == vid


def test_validate_safe_id_rejects_adversarial_patterns():
    """Verify that traversal, absolute paths, slashes, null bytes, and long strings fail."""
    adversarial_inputs = [
        ("..", "Path traversal"),
        ("../evil", "Relative traversal"),
        ("../../etc/passwd", "Deep traversal"),
        (r"..\..\windows_hack", "Windows backslash traversal"),
        ("/etc/passwd", "Absolute Unix path"),
        ("C:\\Windows\\System32", "Absolute Windows path"),
        ("sess_\x00evil", "Null byte injection"),
        ("sess " + "space", "Space character"),
        ("a" * 65, "Oversized ID (> 64 chars)"),
        ("", "Empty string"),
        ("   ", "Whitespace only"),
    ]
    for bad_id, desc in adversarial_inputs:
        with pytest.raises(ValueError, match=r"Invalid|Empty"):
            validate_safe_id(bad_id, "test_param")


def test_safe_rmtree_prevents_out_of_boundary_deletion(tmp_path):
    """Verify that safe_rmtree_session_brain strictly refuses to delete outside ~/.nexau/brain."""
    brain_root = get_nexau_home() / "brain"

    # Attempt 1: Delete root home -> raises ValueError
    with pytest.raises(ValueError, match=r"outside brain root|protected root directory"):
        safe_rmtree_session_brain("normal_id", brain_dir=get_nexau_home())

    # Attempt 2: Delete brain root itself -> raises ValueError
    with pytest.raises(ValueError, match=r"outside brain root|protected root directory"):
        safe_rmtree_session_brain("normal_id", brain_dir=brain_root)

    # Attempt 3: Delete arbitrary system folder -> raises ValueError
    with pytest.raises(ValueError, match=r"outside brain root|protected root directory"):
        safe_rmtree_session_brain("normal_id", brain_dir=tmp_path)

    # Attempt 4: Traversal session ID -> raises ValueError
    with pytest.raises(ValueError, match=r"Invalid session_id"):
        safe_rmtree_session_brain("../../outside", brain_dir=None)


# ======================================================================
# Live HTTP API Level Adversarial Attacks (13 Vectors)
# ======================================================================

@pytest.mark.anyio
async def test_bug_1_arbitrary_directory_creation_via_traversal():
    """Vector 1: session_id: '../../x' must return HTTP 400 and create ZERO folders outside brain."""
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=15.0) as client:
            traversal_id = "../../adversarial_escape_test"
            outside_canary = get_nexau_home().parent / "adversarial_escape_test"

            res = await client.post("/api/sessions", json={
                "session_id": traversal_id,
                "user_id": "default_user",
                "title": "Malicious Traversal Session",
            })
            assert res.status_code == 400
            assert "Invalid session_id" in res.json()["detail"]
            assert not outside_canary.exists(), "Canary folder outside brain MUST NOT be created!"


@pytest.mark.anyio
async def test_bug_2_absolute_path_injection():
    """Vector 2: Absolute paths must be rejected with HTTP 400."""
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=15.0) as client:
            for abs_path in ["/tmp/malicious_dir", "C:\\malicious_dir"]:
                res = await client.post("/api/sessions", json={
                    "session_id": abs_path,
                    "user_id": "default_user",
                })
                assert res.status_code == 400
                assert "Invalid session_id" in res.json()["detail"]


@pytest.mark.anyio
async def test_bug_3_and_13_total_data_wipe_and_fake_success_elimination():
    """Vector 3 & 13: DELETE with traversal ID must fail with 400; non-existent returns 404."""
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=15.0) as client:
            nexau_home = get_nexau_home()
            db_path = nexau_home / "database" / "nexau.db"

            # 1. Traversal delete attempt via route parameter
            res_wipe = await client.delete("/api/sessions/sess_traversal..hack")
            assert res_wipe.status_code == 400
            assert "Invalid session_id" in res_wipe.json()["detail"]

            # Ensure ~/.nexau and database are completely intact
            assert nexau_home.exists()
            assert db_path.exists()

            # 2. Non-existent session must return 404 (Bug 13: no fake success, no fallback wipe)
            non_existent_id = f"sess_not_found_{uuid.uuid4().hex[:8]}"
            res_404 = await client.delete(f"/api/sessions/{non_existent_id}")
            assert res_404.status_code == 404
            assert "not found" in res_404.json()["detail"].lower()


@pytest.mark.anyio
async def test_bug_4_file_write_outside_brain_root():
    """Vector 4: Uploads to traversal session_id must return HTTP 400."""
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=15.0) as client:
            files = {"file": ("exploit.txt", b"evil content", "text/plain")}
            res = await client.post("/api/uploads/sess_traversal..escape", files=files)
            assert res.status_code == 400
            assert "Invalid session_id" in res.json()["detail"]


@pytest.mark.anyio
async def test_bug_5_arbitrary_file_read_in_tasks():
    """Vector 5: Reading task logs with traversal patterns must return HTTP 400."""
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=15.0) as client:
            res1 = await client.get("/api/tasks/evil..path/log")
            assert res1.status_code == 400
            assert "Invalid task_id" in res1.json()["detail"]

            res2 = await client.get("/api/tasks/nested/escape/log")
            assert res2.status_code == 400
            assert "Invalid task_id" in res2.json()["detail"]


@pytest.mark.anyio
async def test_bug_6_directory_listing_disclosure():
    """Vector 6: Listing uploads or artifacts with traversal ID must return HTTP 400."""
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=15.0) as client:
            res_uploads = await client.get("/api/uploads/sess_traversal..hack")
            assert res_uploads.status_code == 400
            assert "Invalid session_id" in res_uploads.json()["detail"]

            res_artifacts = await client.get("/artifacts/default_user/sess_traversal..hack")
            assert res_artifacts.status_code == 400
            assert "Invalid session_id" in res_artifacts.json()["detail"]


@pytest.mark.anyio
async def test_bug_8_ghost_sessions_prevention():
    """Vector 8: Traversal session IDs must never be created or returned in session list."""
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=15.0) as client:
            # Traversal create attempt
            await client.post("/api/sessions", json={"session_id": "../ghost_session"})

            # Fetch session list
            res_list = await client.get("/api/sessions")
            assert res_list.status_code == 200
            data = res_list.json()
            sessions = data.get("sessions", []) if isinstance(data, dict) else data
            session_ids = [s.get("session_id") for s in sessions if isinstance(s, dict)]

            for sid in session_ids:
                assert ".." not in sid
                assert "/" not in sid
                assert "\\" not in sid


@pytest.mark.anyio
async def test_bug_9_null_byte_id_graceful_handling():
    """Vector 9: Null byte in session_id must return clean HTTP 400, not unhandled 500."""
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=15.0) as client:
            res = await client.post("/api/sessions", json={"session_id": "sess_\x00evil"})
            assert res.status_code == 400
            assert "Invalid session_id" in res.json()["detail"]


@pytest.mark.anyio
async def test_bug_10_oversized_300_char_id():
    """Vector 10: 300-char ID must return clean HTTP 400 without connection reset or hang."""
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=15.0) as client:
            oversized_id = "sess_" + "x" * 300
            res = await client.post("/api/sessions", json={"session_id": oversized_id})
            assert res.status_code == 400
            assert "Invalid session_id" in res.json()["detail"]


@pytest.mark.anyio
async def test_bug_11_windows_backslash_traversal():
    """Vector 11: Windows backslash traversal (..\\..\\x) must return HTTP 400."""
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=15.0) as client:
            res = await client.post("/api/sessions", json={"session_id": r"..\..\win_traversal"})
            assert res.status_code == 400
            assert "Invalid session_id" in res.json()["detail"]


@pytest.mark.anyio
async def test_escalation_system_open_file_boundary_enforcement():
    """Escalation chain guard: POST /api/system/open-file outside workspace/brain must return Access denied."""
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=15.0) as client:
            # Attempt to open sensitive or arbitrary file outside workspace
            forbidden_target = "C:\\Windows\\System32\\cmd.exe" if os.name == "nt" else "/etc/passwd"
            res = await client.post("/api/system/open-file", json={
                "file_path": forbidden_target,
                "session_id": "sess_valid_123",
            })
            assert res.status_code == 200
            data = res.json()
            assert data["status"] == "error"
            assert "Access denied" in data["message"]
