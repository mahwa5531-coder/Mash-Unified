# Copyright (c) Nex-AGI. All rights reserved.
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
# http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Application Configuration for NexAU Desktop.

Manages user preferences, active model selections, and trusted audit directories.
Persists to ~/.nexau/settings.json.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any
from pydantic import BaseModel, Field

from nexau.archs.platform.path_helpers import get_nexau_home

logger = logging.getLogger(__name__)


class UserProfile(BaseModel):
    email: str | None = None
    name: str | None = None
    plan: str = "pro"
    credits_remaining: int = 500


class ModelSettings(BaseModel):
    default_model: str = "gemini-3.5-flash-lite"
    fast_frontier_model: str = "deepseek-v4"
    reasoning_effort: str = "high"
    temperature: float = 0.2
    max_tokens: int = 4096
    gateway_url: str | None = None


class AppConfig(BaseModel):
    user: UserProfile = Field(default_factory=UserProfile)
    model: ModelSettings = Field(default_factory=ModelSettings)
    mcp_servers: dict[str, Any] = Field(default_factory=dict)
    trusted_folders: list[str] = Field(default_factory=list)
    theme: str = "dark"

    @classmethod
    def get_config_path(cls) -> Path:
        return get_nexau_home() / "settings.json"

    @classmethod
    def load(cls) -> "AppConfig":
        path = cls.get_config_path()
        if not path.exists():
            config = cls()
            config.save()
            return config
        try:
            return cls.model_validate_json(path.read_text(encoding="utf-8"))
        except Exception as e:
            logger.error("Failed to parse settings.json, returning default: %s", e)
            return cls()

    def save(self) -> None:
        path = self.get_config_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(self.model_dump_json(indent=2), encoding="utf-8")
