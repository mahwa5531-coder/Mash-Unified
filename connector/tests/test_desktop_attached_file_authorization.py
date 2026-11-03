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
            # Pre-check: Without session attachment, external file must be blocked with 403 Forbidden
            invalidate_roots_cache()
            res_before = await client.get(f"/files/content?path={external_file}")
            assert res_before.status_code == 403, f"Expected 403 before attachment, got {res_before.status_code}"
            assert "outside authorized workspace" in res_before.json()["detail"]

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

            # Check unauthorized file is STILL blocked
            unauthorized_file = Path(temp_dir) / f"random_unauthorized_file_{test_run_id}.txt"
            unauthorized_file.write_text("Secret", encoding="utf-8")
            res_unauth = await client.get(f"/files/content?path={unauthorized_file}")
            assert res_unauth.status_code == 403

            # Clean up
            try:
                await engine.delete_one(SessionModel, filters=ComparisonFilter.eq("session_id", session_id))
                external_file.unlink(missing_ok=True)
                unauthorized_file.unlink(missing_ok=True)
            except Exception:
                pass
