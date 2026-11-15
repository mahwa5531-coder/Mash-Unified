# Unit test verifying Desktop Mode attached file authorization and workspace boundaries
import pytest
import os
import uuid
import tempfile
from pathlib import Path
import httpx
from nexau.archs.session.models import SessionModel
from nexau.archs.session.orm import ComparisonFilter
from app.main import app, lifespan
import app.dependencies as deps
from app.workspace import invalidate_roots_cache


@pytest.fixture(scope="module")
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_desktop_attached_file_authorization():
    # 1. Create a dummy external file outside Mash repo with unique filename per test run
    temp_dir = tempfile.gettempdir()
    test_run_id = uuid.uuid4().hex[:8]
    external_file = Path(temp_dir) / f"mash_test_desktop_audit_report_{test_run_id}.txt"
    external_file.write_text("Confidential Audit Findings FY26: Clean.", encoding="utf-8")

    session_id = f"test-desktop-auth-session-{test_run_id}"
    user_id = "default_user"

    async with lifespan(app):
        engine = deps.get_engine()
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            # Under desktop read model, local files accessible by host OS are readable directly
            invalidate_roots_cache()
            res_before = await client.get(f"/files/content?path={external_file}")
            assert res_before.status_code == 200, f"Expected 200 for local file, got {res_before.status_code}"
            assert "Confidential Audit Findings" in res_before.json()["content"]

            # Now create session with this attached file
            session = SessionModel(
                session_id=session_id,
                user_id=user_id,
                context={
                    "title": "Desktop Test",
                    "working_directory": "No Repo",
                    "attached_files": [str(external_file.resolve())],
                }
            )
            await engine.create(session)
            invalidate_roots_cache()

            # Check with session_id query param: must return 200 OK and file content
            res_session = await client.get(f"/files/content?path={external_file}&session_id={session_id}")
            assert res_session.status_code == 200, f"Expected 200 with session_id, got {res_session.status_code}: {res_session.text}"
            data = res_session.json()
            assert "Confidential Audit Findings" in data["content"]

            # Check dynamic roots authorization: even without session_id query param, known session attached files are authorized
            res_dynamic = await client.get(f"/files/content?path={external_file}")
            assert res_dynamic.status_code == 200, f"Expected 200 via dynamic roots, got {res_dynamic.status_code}"

            # Path traversal escaping roots is strictly blocked with 403 Forbidden
            res_traversal = await client.get("/files/content?path=../../etc/passwd")
            assert res_traversal.status_code == 403

            # Clean up
            try:
                await engine.delete_one(SessionModel, filters=ComparisonFilter.eq("session_id", session_id))
                external_file.unlink(missing_ok=True)
            except Exception:
                pass


@pytest.mark.anyio
async def test_r2_7a_poisoned_root_attachment_defense():
    """Verify R2-7a: poisoned attached_files with literal '/' or root drives cannot compromise allowed roots."""
    from app.workspace import get_allowed_file_roots
    poisoned_session_id = f"test-poisoned-session-{uuid.uuid4().hex[:8]}"
    async with lifespan(app):
        engine = deps.get_engine()
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            session = SessionModel(
                session_id=poisoned_session_id,
                user_id="attacker",
                context={
                    "title": "Poisoned Session",
                    "attached_files": ["/", "C:\\", "/etc/passwd", "C:\\Windows\\win.ini"],
                }
            )
            await engine.create(session)
            invalidate_roots_cache()

            # 1. R2-7a defense: dynamic workspace roots must NOT contain root drives or sensitive dirs
            allowed = await get_allowed_file_roots(engine)
            allowed_strings = [str(r).replace("\\", "/").rstrip("/") for r in allowed]
            assert "" not in allowed_strings
            assert "/" not in allowed_strings
            assert "C:" not in allowed_strings
            assert "/etc" not in allowed_strings

            # 2. Path traversal escaping is rejected with 403 Forbidden
            res_traversal = await client.get("/files/content?path=../../etc/passwd")
            assert res_traversal.status_code == 403

            # 3. Directory paths cannot be read as files (403 Forbidden)
            root_dir_path = "C:\\" if os.name == "nt" else "/"
            res_dir = await client.get(f"/files/content?path={root_dir_path}")
            assert res_dir.status_code == 403

            # 4. Under Desktop Read Model, non-existent files return 404 (not 403)
            res_missing = await client.get("/files/content?path=/nonexistent_system_file_123.txt")
            assert res_missing.status_code == 404

            # Clean up
            try:
                await engine.delete(SessionModel, filters=ComparisonFilter.eq("session_id", poisoned_session_id))
            except Exception:
                pass
            invalidate_roots_cache()
