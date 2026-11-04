import pytest
from app.main import app, lifespan
from app.dependencies import get_engine
from app.services.chat_streamer import PermissionModePayload
from app.services.chat_session_prep import ensure_project_and_context
from nexau.archs.session.models import SessionModel
from nexau.archs.session.orm import ComparisonFilter

def test_d4_permission_mode_payload():
    """Verify D4: PermissionModePayload accepts both 'mode' and 'permission_mode'."""
    p1 = PermissionModePayload(mode="turbo")
    assert p1.resolved_mode() == "turbo"

    p2 = PermissionModePayload(permission_mode="review")
    assert p2.resolved_mode() == "review"

    p3 = PermissionModePayload(mode="default", permission_mode="default")
    assert p3.resolved_mode() == "default"

    with pytest.raises(ValueError):
        p_empty = PermissionModePayload()
        p_empty.resolved_mode()

@pytest.mark.anyio
async def test_f6_deep_link_context_preservation():
    """Verify F-6/D5: Stored workspace binding is not overwritten when client sends 'No Repo'."""
    async with lifespan(app):
        eng = get_engine()
        assert eng is not None
        sid = "sess_deep_link_test_99"

        # Create an established session with valid workspace
        init_ctx = {
            "title": "AlphaWS Audit",
            "custom_title": "AlphaWS Audit",
            "workspace_uri": "C:/Projects/AlphaWS",
            "working_directory": "C:/Projects/AlphaWS",
            "project_id": "proj_alpha",
            "section": "workspace",
            "permission_mode": "review",
        }
        existing = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", sid))
        if existing:
            await eng.delete(SessionModel, filters=ComparisonFilter.eq("session_id", sid))

        session = SessionModel(session_id=sid, user_id="user_test", context=init_ctx)
        await eng.create(session)

        # Client connects via deep-link or degraded state with 'No Repo' and missing project_id
        incoming_context = {
            "workspace_uri": "No Repo",
            "working_directory": "No Repo",
            "project_id": "null",
            "_raw_message": "Please review controls.",
        }

        await ensure_project_and_context(
            eng=eng,
            user_id="user_test",
            sid=sid,
            resolved_context=incoming_context,
            workspace_target="No Repo",
            sse_server=None,
        )

        # Assert incoming_context recovered the established workspace binding
        assert incoming_context["workspace_uri"] == "C:/Projects/AlphaWS"
        assert incoming_context["working_directory"] == "C:/Projects/AlphaWS"
        assert incoming_context["project_id"] == "proj_alpha"
        assert incoming_context["title"] == "AlphaWS Audit"
        assert incoming_context["section"] == "workspace"

        # Assert database session context was NOT corrupted
        updated_session = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", sid))
        assert updated_session.context["workspace_uri"] == "C:/Projects/AlphaWS"
        assert updated_session.context["working_directory"] == "C:/Projects/AlphaWS"
        assert updated_session.context["project_id"] == "proj_alpha"

        # Clean up
        await eng.delete(SessionModel, filters=ComparisonFilter.eq("session_id", sid))
