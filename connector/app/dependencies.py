from typing import Annotated

from fastapi import Depends, Request
from nexau.archs.session.orm import LoopSafeDatabaseEngine, SQLDatabaseEngine
from nexau.archs.session.session_manager import SessionManager

_engine: LoopSafeDatabaseEngine | None = None
_session_manager: SessionManager | None = None


def init_engine(db_url: str) -> LoopSafeDatabaseEngine:
    global _engine
    sql_engine = SQLDatabaseEngine.from_url(db_url)
    _engine = LoopSafeDatabaseEngine(sql_engine)
    return _engine


def get_engine(request: Request = None) -> LoopSafeDatabaseEngine:
    if request is not None and hasattr(request, "app") and hasattr(request.app.state, "engine") and request.app.state.engine:
        return request.app.state.engine
    if _engine is not None:
        return _engine
    raise RuntimeError("Database engine not initialized")


def resolve_engine(engine: LoopSafeDatabaseEngine | None = None) -> LoopSafeDatabaseEngine:
    if engine is not None:
        return engine
    if _engine is not None:
        return _engine
    raise RuntimeError("Database engine not initialized")


def get_session_manager(request: Request = None) -> SessionManager:
    if request is not None and hasattr(request, "app") and hasattr(request.app.state, "session_manager") and request.app.state.session_manager:
        return request.app.state.session_manager
    if _session_manager is not None:
        return _session_manager
    raise RuntimeError("Session manager not initialized")


DatabaseEngineDep = Annotated[LoopSafeDatabaseEngine, Depends(get_engine)]
SessionManagerDep = Annotated[SessionManager, Depends(get_session_manager)]
