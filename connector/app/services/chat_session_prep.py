# Copyright (c) Mash. All rights reserved.
"""Session scaffolding and preparation service for Mash Desktop Connector.

Provides workspace/session storage scaffolding, null project normalization,
project model auto-lookup/creation, non-destructive title resolution,
and sandbox/model configuration.
"""

from __future__ import annotations

import copy
import logging
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from nexau.archs.sandbox.base_sandbox import LocalSandboxConfig
from nexau.archs.session.models import SessionModel
from nexau.archs.session.orm import ComparisonFilter

from app.models.project import ProjectModel
from app.paths import (
    resolve_deliverables_dir,
    resolve_sandbox_work_dir,
    scaffold_session_storage,
    scaffold_workspace_storage,
)
from app.services.session_transcript import generate_clean_session_title

logger = logging.getLogger(__name__)

__all__ = [
    "normalize_project_id",
    "ensure_project_and_context",
    "setup_sandbox_and_model",
]


def normalize_project_id(raw_id: Any) -> str | None:
    """Normalize string representations of null ('null', 'undefined', 'none', '') to None."""
    # ponytail: stdlib string check handles JS null/undefined strings at boundary
    if raw_id is None:
        return None
    val = str(raw_id).strip()
    return None if val.lower() in ("null", "undefined", "none", "") else val


async def ensure_project_and_context(
    eng: Any,
    user_id: str,
    sid: str,
    resolved_context: dict[str, Any],
    workspace_target: str,
    sse_server: Any = None,
) -> None:
    """App-specific prep: auto-create project, scaffold storage, enrich context.

    NexAU handles session creation itself via SessionManager._get_or_create_session().
    This function prepares the context dict and pre-creates/updates session metadata.
    """
    project_id = normalize_project_id(resolved_context.get("project_id"))
    resolved_context["project_id"] = project_id

    # Scaffold brain/scratch dirs
    brain_path = scaffold_session_storage(sid, project_id)
    resolved_context.update({
        "brain_directory": str(brain_path),
        "scratch_directory": str(brain_path / "scratch"),
        "cache_directory": str(brain_path / "cache"),
        "session_id": sid,
    })
    if not resolved_context.get("working_directory"):
        resolved_context["working_directory"] = workspace_target

    if workspace_target and workspace_target != "No Repo" and os.path.exists(workspace_target):
        try:
            scaffold_workspace_storage(workspace_target)
        except Exception:
            pass

    if not eng:
        return

    # Auto-create ProjectModel from workspace path (app-specific, NexAU has no project concept)
    try:
        if workspace_target and workspace_target != "No Repo":
            target_path = str(Path(workspace_target).resolve()) if os.path.exists(workspace_target) else None
            existing_proj = (
                await eng.find_first(ProjectModel, filters=ComparisonFilter.eq("local_folder_path", target_path))
                if target_path else None
            )
            if not existing_proj:
                existing_proj = await eng.find_first(
                    ProjectModel, filters=ComparisonFilter.eq("name", workspace_target)
                )
            if not existing_proj and target_path:
                existing_proj = ProjectModel(
                    user_id=user_id, name=Path(target_path).name, local_folder_path=target_path
                )
                await eng.create(existing_proj)

            if existing_proj:
                project_id = existing_proj.id
                brain_path = scaffold_session_storage(sid, project_id)
                resolved_context.update({
                    "project_id": project_id,
                    "workspace_uri": existing_proj.name,
                    "working_directory": existing_proj.local_folder_path,
                    "brain_directory": str(brain_path),
                    "scratch_directory": str(brain_path / "scratch"),
                    "cache_directory": str(brain_path / "cache"),
                })
    except Exception as e:
        logger.warning("Project auto-create error: %s", e)

    # ponytail: NexAU's _get_or_create_session creates a bare SessionModel with no context.
    # The sidebar needs title, workspace_uri, section, last_user_view_time etc.
    # We pre-create/update the session with app-specific metadata so NexAU reuses it.
    try:
        session = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", sid))
        now_utc = datetime.now(UTC)
        now_iso = now_utc.isoformat()
        if not session:
            clean_title = generate_clean_session_title(resolved_context.get("_raw_message", ""), sid)
            title_val = (
                resolved_context.get("title")
                or resolved_context.get("custom_title")
                or clean_title
                or "New Conversation"
            )
            resolved_context["title"] = resolved_context["custom_title"] = title_val
            if "section" not in resolved_context:
                resolved_context["section"] = "workspace" if workspace_target != "No Repo" else "conversation"
            resolved_context["last_user_view_time"] = now_iso

            init_context = {
                "title": title_val, "custom_title": title_val,
                "workspace_uri": resolved_context.get("workspace_uri", workspace_target),
                "working_directory": resolved_context["working_directory"],
                "section": resolved_context.get("section"),
                "project_id": resolved_context.get("project_id"),
                "brain_directory": resolved_context["brain_directory"],
                "scratch_directory": resolved_context["scratch_directory"],
                "permission_mode": resolved_context.get("permission_mode", "default"),
                "updated_at": now_iso,
                "last_user_view_time": now_iso,
            }
            sm = getattr(sse_server, "_session_manager", None) if sse_server else None
            if sm:
                _, session = await sm.register_agent(
                    user_id=user_id, session_id=sid, agent_name="nexau_main_auditor", is_root=True
                )
                session.created_at, session.updated_at, session.context = now_utc, now_utc, init_context
                await sm._update_session(session)
            else:
                session = SessionModel(
                    session_id=sid, user_id=user_id,
                    created_at=now_utc, updated_at=now_utc,
                    context=init_context,
                )
                await eng.create(session)
        else:
            session.updated_at = now_utc
            ctx = dict(session.context or {})
            ctx["updated_at"] = ctx["last_user_view_time"] = now_iso
            resolved_context["last_user_view_time"] = now_iso

            is_placeholder = (
                not ctx.get("title")
                or ctx.get("title") in ("New Session", "New Conversation", "Untitled Session", "New Chat")
                or str(ctx.get("title", "")).startswith("Session sess_")
            )
            if is_placeholder:
                clean_title = generate_clean_session_title(resolved_context.get("_raw_message", ""), sid)
                if clean_title and clean_title not in ("New Conversation", "New Session", "Untitled Session"):
                    ctx["title"] = ctx["custom_title"] = clean_title

            # Preserve existing custom/persisted title from session across turns (D5)
            title_val = ctx.get("custom_title") or ctx.get("title") or "New Conversation"
            resolved_context["title"] = resolved_context["custom_title"] = title_val
            ctx["permission_mode"] = resolved_context.get("permission_mode") or ctx.get("permission_mode") or "default"
            session.context = ctx
            await eng.update(session)

            # Merge stored keys we don't already have
            for k, v in ctx.items():
                resolved_context.setdefault(k, v)
    except Exception as e:
        logger.warning("Session context enrichment error: %s", e)


def setup_sandbox_and_model(
    effective_agent_config: Any,
    resolved_context: dict[str, Any],
    live_token: str | None = None,
) -> Any:
    """Resolve sandbox directories and dynamic LLM credentials into config."""
    # ponytail: Bind deliverables and sandbox work_dir into context and agent config
    target_work_dir = resolve_sandbox_work_dir(
        resolved_context.get("working_directory"),
        resolved_context.get("scratch_directory"),
        resolved_context.get("brain_directory"),
    )
    resolved_context["outputs_directory"] = str(
        resolve_deliverables_dir(
            resolved_context.get("working_directory"),
            resolved_context.get("brain_directory"),
        )
    )

    if effective_agent_config is None:
        return None

    llm_cfg = getattr(effective_agent_config, "llm_config", None)
    if llm_cfg:
        env_model = os.getenv("MASH_MODEL") or os.getenv("LLM_MODEL") or os.getenv("OPENAI_MODEL")
        target_model = (
            env_model
            if (not llm_cfg.model or llm_cfg.model == "mash/auto") and env_model
            else (llm_cfg.model or "mash/auto")
        )
        api_key = live_token or llm_cfg.api_key or os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY") or ""
        if llm_cfg.api_key != api_key or llm_cfg.model != target_model:
            new_llm = copy.copy(llm_cfg)
            new_llm.api_key, new_llm.model = api_key, target_model
            if hasattr(effective_agent_config, "model_copy"):
                effective_agent_config = effective_agent_config.model_copy(update={"llm_config": new_llm})
            else:
                effective_agent_config.llm_config = new_llm

    cur_sb = getattr(effective_agent_config, "sandbox_config", None)
    new_sb = (
        cur_sb.model_copy(update={"work_dir": target_work_dir})
        if cur_sb and hasattr(cur_sb, "model_copy")
        else LocalSandboxConfig(work_dir=target_work_dir)
    )
    if hasattr(effective_agent_config, "model_copy"):
        return effective_agent_config.model_copy(update={"sandbox_config": new_sb})
    effective_agent_config.sandbox_config = new_sb
    return effective_agent_config
