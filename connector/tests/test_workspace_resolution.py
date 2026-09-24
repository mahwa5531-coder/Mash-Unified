import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "NexAU"))

from app.models.project import ProjectModel
from app.workspace import resolve_workspace_directory


class ProjectEngine:
    def __init__(self, project: ProjectModel | None) -> None:
        self.project = project

    async def find_first(self, *_args, **_kwargs) -> ProjectModel | None:
        return self.project


@pytest.mark.anyio
async def test_workspace_resolution_uses_registered_project_not_client_path() -> None:
    trusted_path = Path(__file__).parent.parent
    project = ProjectModel(user_id="user", name="Trusted", local_folder_path=str(trusted_path))

    resolved = await resolve_workspace_directory(ProjectEngine(project), project.id)

    assert resolved == trusted_path.resolve()
