"""
Comprehensive Security, Workspace Containment & Cross-Session Isolation Suite:
1. Cross-Session Brain Directory Containment (Zero data leaks between sessions)
2. Path Traversal & Escape Prevention (Relative, mixed slashes, and absolute escapes)
3. Direct Brain File Access without Session Authorization
4. Legitimate Intra-Session Access & Workspace Boundaries
5. NTFS Case-Insensitivity & Windows Path Canonicalization
6. Workspace Directory Escape Guard (Boundary enforcement on registered project paths)
"""

import sys
from pathlib import Path
import httpx
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
from app.main import app, lifespan


@pytest.mark.anyio
async def test_cross_session_isolation_and_workspace_containment(tmp_path):
    # Setup two mock session brain directories inside .mash/brain
    mock_brain_root = Path.home() / ".mash" / "brain"
    session_a_id = f"test_session_a_{tmp_path.name}"
    session_b_id = f"test_session_b_{tmp_path.name}"

    dir_a = mock_brain_root / session_a_id / ".user_uploaded"
    dir_b = mock_brain_root / session_b_id / ".user_uploaded"
    dir_a.mkdir(parents=True, exist_ok=True)
    dir_b.mkdir(parents=True, exist_ok=True)

    secret_file_a = dir_a / "client_tax_return.txt"
    secret_file_a.write_text("CONFIDENTIAL TAX RECORD FOR SESSION A: $4,500,000", encoding="utf-8")

    secret_file_b = dir_b / "session_b_notes.txt"
    secret_file_b.write_text("SESSION B INTERNAL WORKING PAPER", encoding="utf-8")

    # Setup isolated project workspace
    ws_dir = tmp_path / "authorized_project"
    ws_dir.mkdir(parents=True, exist_ok=True)
    ws_file = ws_dir / "project_spec.py"
    ws_file.write_text("PROJECT_SPEC = 'v1.0'", encoding="utf-8")

    outside_dir = tmp_path / "forbidden_outside"
    outside_dir.mkdir(parents=True, exist_ok=True)
    outside_secret = outside_dir / "outside_credentials.env"
    outside_secret.write_text("DATABASE_PASSWORD=super_secret_outside", encoding="utf-8")

    try:
        async with lifespan(app):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
                # Register authorized workspace
                proj_res = await client.post("/api/projects", json={
                    "user_id": "containment_tester",
                    "name": "Containment Test Project",
                    "local_folder_path": str(ws_dir)
                })
                assert proj_res.status_code == 200

                # -------------------------------------------------------------
                # 1. Intra-session access: Session A requesting its own file -> 200 OK
                # -------------------------------------------------------------
                res_legit = await client.get("/files/content", params={
                    "path": f".user_uploaded/{secret_file_a.name}",
                    "session_id": session_a_id,
                })
                assert res_legit.status_code == 200
                assert "CONFIDENTIAL TAX RECORD" in res_legit.json().get("content", "")

                # -------------------------------------------------------------
                # 2. Cross-session relative path traversal -> MUST FAIL (403 or 404)
                # -------------------------------------------------------------
                res_traversal = await client.get("/files/content", params={
                    "path": f"../{session_a_id}/.user_uploaded/{secret_file_a.name}",
                    "session_id": session_b_id,
                })
                assert res_traversal.status_code in (403, 404)
                if res_traversal.status_code == 200:
                    pytest.fail("CRITICAL: Session B leaked Session A's confidential file via relative traversal!")

                # -------------------------------------------------------------
                # 3. Mixed slashes traversal: ..\\..\\session_a -> MUST FAIL
                # -------------------------------------------------------------
                res_mixed = await client.get("/files/content", params={
                    "path": f"..\\{session_a_id}\\.user_uploaded\\{secret_file_a.name}",
                    "session_id": session_b_id,
                })
                assert res_mixed.status_code in (403, 404)

                # -------------------------------------------------------------
                # 4. Cross-session direct absolute path -> MUST BE 403 FORBIDDEN
                # -------------------------------------------------------------
                res_abs_cross = await client.get("/files/content", params={
                    "path": str(secret_file_a),
                    "session_id": session_b_id,
                })
                assert res_abs_cross.status_code == 403
                assert "Cross-session file access is strictly forbidden" in res_abs_cross.json().get("detail", "")

                # -------------------------------------------------------------
                # 5. Direct brain path without session_id -> MUST BE 403 FORBIDDEN
                # -------------------------------------------------------------
                res_no_session = await client.get("/files/content", params={
                    "path": str(secret_file_a),
                })
                assert res_no_session.status_code == 403
                assert "without session authorization is forbidden" in res_no_session.json().get("detail", "")

                # -------------------------------------------------------------
                # 6. NTFS Case Insensitivity Verification:
                #    Legitimate session can access file regardless of case
                # -------------------------------------------------------------
                res_upper_sess = await client.get("/files/content", params={
                    "path": f".user_uploaded/{secret_file_a.name}",
                    "session_id": session_a_id.upper(),
                })
                assert res_upper_sess.status_code in (200, 403)
                # If session_id casing validation allows it on Windows, must match content
                if res_upper_sess.status_code == 200:
                    assert "CONFIDENTIAL TAX RECORD" in res_upper_sess.json().get("content", "")

                # -------------------------------------------------------------
                # 7. Workspace Boundary Containment:
                #    Accessing file inside authorized workspace -> 200 OK
                # -------------------------------------------------------------
                res_ws_legit = await client.get("/files/content", params={"path": str(ws_file)})
                assert res_ws_legit.status_code == 200
                assert "PROJECT_SPEC = 'v1.0'" in res_ws_legit.json().get("content", "")

                # -------------------------------------------------------------
                # 8. Workspace Directory Escape Attempt:
                #    Escaping workspace boundary via .. to access forbidden_outside -> 403
                # -------------------------------------------------------------
                res_outside = await client.get("/files/content", params={"path": str(outside_secret)})
                assert res_outside.status_code == 403
                assert "Access denied" in res_outside.json().get("detail", "")

                # -------------------------------------------------------------
                # 9. Out of bounds OS system directory escape -> MUST BE 403
                # -------------------------------------------------------------
                res_sys_escape = await client.get("/files/content", params={
                    "path": "C:/Windows/System32/drivers/etc/hosts",
                    "session_id": session_a_id,
                })
                assert res_sys_escape.status_code == 403

    finally:
        # Cleanup mock test files
        try:
            if secret_file_a.exists():
                secret_file_a.unlink()
            if secret_file_b.exists():
                secret_file_b.unlink()
            dir_a.rmdir()
            dir_b.rmdir()
            (mock_brain_root / session_a_id).rmdir()
            (mock_brain_root / session_b_id).rmdir()
        except Exception:
            pass
