import os
from typing import Annotated
from fastapi import Depends
from sqlalchemy.ext.asyncio import create_async_engine
from nexau.archs.session.orm import DatabaseEngine, LoopSafeDatabaseEngine, SQLDatabaseEngine
from nexau.archs.session.session_manager import SessionManager

_engine: LoopSafeDatabaseEngine | None = None
_session_manager: SessionManager | None = None


from sqlalchemy import event

def init_engine(db_url: str) -> LoopSafeDatabaseEngine:
    global _engine
    connect_args = {}
    if "sqlite" in db_url:
        connect_args["check_same_thread"] = False
        connect_args["timeout"] = 30

    async_engine = create_async_engine(db_url, connect_args=connect_args)

    if "sqlite" in db_url:
        # ponytail: configure SQLite WAL mode, fast commits, and concurrency pragmas
        @event.listens_for(async_engine.sync_engine, "connect")
        def set_sqlite_pragma(dbapi_connection, connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode = WAL;")
            cursor.execute("PRAGMA synchronous = NORMAL;")
            cursor.execute("PRAGMA busy_timeout = 15000;")
            cursor.execute("PRAGMA cache_size = -64000;")
            cursor.close()

    sql_engine = SQLDatabaseEngine(async_engine)
    _engine = LoopSafeDatabaseEngine(sql_engine)
    return _engine


from fastapi import Depends, Request

def get_engine(request: Request = None) -> LoopSafeDatabaseEngine:
    if request is not None and hasattr(request, "app") and hasattr(request.app.state, "engine") and request.app.state.engine:
        return request.app.state.engine
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