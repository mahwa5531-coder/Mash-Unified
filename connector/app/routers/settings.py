# Copyright (c) Nex-AGI. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Settings Router for NexAU UI Backend.

Manages application configurations, model preferences, and trusted directories.
"""

from __future__ import annotations

import logging
from typing import Any
from fastapi import APIRouter
from nexau.archs.platform.app_config import AppConfig

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("")
async def get_settings() -> dict[str, Any]:
    """Returns the current application settings."""
    config = AppConfig.load()
    return config.model_dump()


@router.post("")
async def update_settings(updated: AppConfig) -> dict[str, Any]:
    """Updates and persists application settings."""
    updated.save()
    return {"status": "success", "settings": updated.model_dump()}
