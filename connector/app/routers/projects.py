import os
from pathlib import Path
from typing import Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.dependencies import DatabaseEngineDep
from app.models.project import ProjectModel
from nexau.archs.session.orm import ComparisonFilter

router = APIRouter(prefix="/api/projects", tags=["projects"])


class CreateProjectRequest(BaseModel):
    user_id: str = "default_user"
    name: str
    local_folder_path: str


class QuickProjectRequest(BaseModel):
    user_id: str = "default_user"
    name: str


@router.post("/quick")
async def create_quick_project(request: QuickProjectRequest, engine: DatabaseEngineDep):
    clean_name = request.name.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Project name cannot be empty")
    
    docs_dir = Path.home() / "Documents"
    docs_dir.mkdir(parents=True, exist_ok=True)
    target_dir = docs_dir / clean_name
    target_dir.mkdir(parents=True, exist_ok=True)
    
    from app.paths import scaffold_workspace_storage
    scaffold_workspace_storage(target_dir)
    
    normalized_path = os.path.normpath(str(target_dir)).replace("\\", "/")
    
    all_projects = await engine.find_many(ProjectModel)
    for p in all_projects:
        if p.name.strip().lower() == clean_name.lower():
            p.local_folder_path = normalized_path
            p.user_id = request.user_id
            await engine.update(p)
            return p
            
    project = ProjectModel(user_id=request.user_id, name=clean_name, local_folder_path=normalized_path)
    await engine.create(project)
    return project


@router.post("")
async def create_project(request: CreateProjectRequest, engine: DatabaseEngineDep):
    normalized_path = os.path.normpath(request.local_folder_path).replace("\\", "/")
    try:
        from app.paths import scaffold_workspace_storage
        scaffold_workspace_storage(normalized_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create directory: {e}")

    # Single source of truth: check if project already exists with same name
    all_projects = await engine.find_many(ProjectModel)
    for p in all_projects:
        if p.name.strip().lower() == request.name.strip().lower():
            p.local_folder_path = normalized_path
            p.user_id = request.user_id
            await engine.update(p)
            return p

    project = ProjectModel(user_id=request.user_id, name=request.name, local_folder_path=normalized_path)
    await engine.create(project)
    return project


@router.get("")
@router.get("/")
async def list_all_projects(engine: DatabaseEngineDep):
    from nexau.archs.session.models import SessionModel
    projects = await engine.find_many(ProjectModel)
    all_sessions = await engine.find_many(SessionModel)
    
    results = []
    seen_names = set()
    for p in reversed(projects):
        name_key = p.name.strip().lower()
        if name_key in seen_names:
            continue
        seen_names.add(name_key)
        
        count = 0
        norm_p_path = os.path.normpath(p.local_folder_path).replace("\\", "/").lower()
        for s in all_sessions:
            ctx = s.context or {}
            ws_uri = getattr(s, "workspace_uri", "") or ctx.get("workspace_uri", "")
            pid = ctx.get("project_id")
            norm_ws = os.path.normpath(ws_uri).replace("\\", "/").lower() if ws_uri else ""
            if (pid and (pid == p.id or pid.lower() == name_key)) or \
               (norm_ws and (norm_ws == norm_p_path or os.path.basename(norm_ws) == name_key or ws_uri == p.name)):
                count += 1
        
        p_dict = p.model_dump() if hasattr(p, "model_dump") else p.dict()
        p_dict["local_folder_path"] = os.path.normpath(p.local_folder_path).replace("\\", "/")
        p_dict["session_count"] = count
        results.append(p_dict)
    
    return {"projects": list(reversed(results))}


@router.get("/{user_id}")
async def list_projects(user_id: str, engine: DatabaseEngineDep):
    from nexau.archs.session.models import SessionModel
    projects = await engine.find_many(ProjectModel, filters=ComparisonFilter.eq("user_id", user_id))
    all_sessions = await engine.find_many(SessionModel)

    results = []
    seen_names = set()
    for p in reversed(projects):
        name_key = p.name.strip().lower()
        if name_key in seen_names:
            continue
        seen_names.add(name_key)

        count = 0
        norm_p_path = os.path.normpath(p.local_folder_path).replace("\\", "/").lower()
        for s in all_sessions:
            ctx = s.context or {}
            ws_uri = getattr(s, "workspace_uri", "") or ctx.get("workspace_uri", "")
            pid = ctx.get("project_id")
            norm_ws = os.path.normpath(ws_uri).replace("\\", "/").lower() if ws_uri else ""
            if (pid and (pid == p.id or pid.lower() == name_key)) or \
               (norm_ws and (norm_ws == norm_p_path or os.path.basename(norm_ws) == name_key or ws_uri == p.name)):
                count += 1

        p_dict = p.model_dump() if hasattr(p, "model_dump") else p.dict()
        p_dict["local_folder_path"] = os.path.normpath(p.local_folder_path).replace("\\", "/")
        p_dict["session_count"] = count
        results.append(p_dict)

    return {"projects": list(reversed(results))}


@router.delete("/{project_id}")
async def delete_project(project_id: str, engine: DatabaseEngineDep):
    import shutil
    from app.paths import get_nexau_home, get_session_brain_dir
    from nexau.archs.session.models import SessionModel, AgentRunActionModel

    # Find project by id OR name
    project = await engine.find_first(ProjectModel, filters=ComparisonFilter.eq("id", project_id))
    if not project:
        project = await engine.find_first(ProjectModel, filters=ComparisonFilter.eq("name", project_id))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    deleted_sessions_count = 0
    # 1. Find all sessions tied to this workspace and delete their data
    try:
        all_sessions = await engine.find_many(SessionModel)
        for s in all_sessions:
            ctx = s.context or {}
            ws_uri = getattr(s, "workspace_uri", "") or ctx.get("workspace_uri", "")
            pid = ctx.get("project_id")
            matches = (pid and (pid == project.id or pid == project.name)) or \
                      (ws_uri and (ws_uri == project.local_folder_path or ws_uri == project.name or os.path.basename(ws_uri.rstrip(r'\/')) == project.name))

            if matches:
                sid = s.session_id
                # Delete actions/transcripts from DB
                await engine.delete(AgentRunActionModel, filters=ComparisonFilter.eq("session_id", sid))
                # Delete session brain directory from ~/.nexau
                brain_dir = ctx.get("brain_directory") or str(get_session_brain_dir(sid, project.id))
                if brain_dir and os.path.exists(brain_dir):
                    shutil.rmtree(brain_dir, ignore_errors=True)
                # Delete session record from DB
                await engine.delete(SessionModel, filters=ComparisonFilter.eq("session_id", sid))
                deleted_sessions_count += 1
    except Exception as exc:
        pass

    # 2. Clean up project storage directory in .nexau (~/.nexau/projects/<project_id>/ and <name>/)
    for p_ident in [project.id, project.name]:
        proj_dir = get_nexau_home() / "projects" / p_ident
        if proj_dir.exists():
            shutil.rmtree(proj_dir, ignore_errors=True)

    # 3. Clean up .nexau directory inside the workspace folder if it exists (local code files preserved!)
    if project.local_folder_path and os.path.isdir(project.local_folder_path):
        local_nexau = os.path.join(project.local_folder_path, ".nexau")
        if os.path.exists(local_nexau):
            shutil.rmtree(local_nexau, ignore_errors=True)

    # 4. Delete the project record from DB (and any duplicates for this project name)
    await engine.delete(ProjectModel, filters=ComparisonFilter.eq("id", project.id))
    try:
        dupes = await engine.find_many(ProjectModel, filters=ComparisonFilter.eq("name", project.name))
        for d in dupes:
            await engine.delete(ProjectModel, filters=ComparisonFilter.eq("id", d.id))
    except Exception:
        pass

    return {
        "status": "success",
        "message": f"Project '{project.name}' deleted successfully with {deleted_sessions_count} sessions removed from .nexau and database.",
        "deleted_sessions_count": deleted_sessions_count,
        "deleted_project_id": project.id,
        "deleted_project_name": project.name,
    }
