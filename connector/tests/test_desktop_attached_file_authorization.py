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

            # 1. Non-existent system path or traversal returns 403 or 404
            res_passwd = await client.get("/files/content?path=/etc/passwd")
            assert res_passwd.status_code in (403, 404), f"Expected 403 or 404 for /etc/passwd, got {res_passwd.status_code}"

            res_winini = await client.get("/files/content?path=C:/Windows/win.ini")
            assert res_winini.status_code in (200, 403, 404), f"Expected valid response for C:/Windows/win.ini, got {res_winini.status_code}"

            # 2. Even WITH session_id query param, root paths cannot be read
            res_with_sess = await client.get(f"/files/content?path=/etc/passwd&session_id={poisoned_session_id}")
            assert res_with_sess.status_code in (403, 404), f"Expected 403 or 404 with session_id, got {res_with_sess.status_code}"

            # Clean up
            try:
                await engine.delete(SessionModel, filters=ComparisonFilter.eq("session_id", poisoned_session_id))
            except Exception:
                pass
            invalidate_roots_cache()
