from datetime import datetime, timezone
from uuid import uuid4
from sqlmodel import Field, SQLModel


class ProjectModel(SQLModel, table=True):
    """Local physical folders mapped as Projects."""
    __tablename__ = "projects"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    user_id: str
    name: str
    local_folder_path: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))