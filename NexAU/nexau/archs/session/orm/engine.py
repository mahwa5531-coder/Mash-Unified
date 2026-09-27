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

"""Database engine abstract base class."""

from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from typing import TypeVar

from sqlmodel import SQLModel

from .filters import AndFilter, ComparisonFilter, Filter

T = TypeVar("T", bound=SQLModel)


def get_table_name(model_class: type[SQLModel]) -> str:
    """Get table name from a SQLModel class."""
    return str(model_class.__tablename__)  # type: ignore[attr-defined]


def get_pk_fields(model_class: type[SQLModel]) -> list[str]:
    """Get primary key field names from a SQLModel class."""
    return [name for name, info in model_class.model_fields.items() if getattr(info, "primary_key", False) is True]


class DatabaseEngine(ABC):
    """Abstract database engine for multi-backend storage."""

    @abstractmethod
    async def setup_models(self, model_classes: list[type[SQLModel]]) -> None:
        """Setup storage for the given model classes."""

    @abstractmethod
    async def find_first(
        self,
        model_class: type[T],
        *,
        filters: Filter,
    ) -> T | None:
        """Find the first record matching filters."""

    @abstractmethod
    async def find_many(
        self,
        model_class: type[T],
        *,
        filters: Filter | None = None,
        limit: int | None = None,
        offset: int | None = None,
        order_by: str | tuple[str, ...] | None = None,
    ) -> list[T]:
        """Find all records matching filters."""

    @abstractmethod
    async def create(self, model: T) -> T:
        """Create a new record. Returns the created record."""

    @abstractmethod
    async def create_many(self, models: list[T]) -> list[T]:
        """Create multiple records. Returns the created records."""

    @abstractmethod
    async def update(self, model: T) -> T:
        """Update a record by primary key. Returns the updated record."""

    @abstractmethod
    async def delete(
        self,
        model_class: type[T],
        *,
        filters: Filter,
    ) -> int:
        """Delete records matching filters. Returns count of deleted records."""

    @abstractmethod
    async def count(
        self,
        model_class: type[T],
        *,
        filters: Filter | None = None,
    ) -> int:
        """Count records matching filters."""

    async def upsert(self, model: T) -> tuple[T, bool]:
        """Create or update a record. Returns (model, created)."""
        model_class = type(model)
        pk_fields = [name for name, info in model_class.model_fields.items() if getattr(info, "primary_key", False) is True]

        # Build filter using Filter DSL
        pk_filters = [ComparisonFilter.eq(field, getattr(model, field)) for field in pk_fields]

        # Use AndFilter for multiple primary key fields, or single ComparisonFilter
        if len(pk_filters) == 1:
            filter_expr: Filter = pk_filters[0]
        else:
            filter_expr = AndFilter(filters=pk_filters)

        existing = await self.find_first(model_class, filters=filter_expr)
        if existing is not None:
            return await self.update(model), False
        return await self.create(model), True

    async def get_or_create(self, model: T) -> tuple[T, bool]:
        """Get or create a record. Returns (model, created)."""
        model_class = type(model)
        pk_fields = [name for name, info in model_class.model_fields.items() if getattr(info, "primary_key", False) is True]

        # Build filter using Filter DSL
        pk_filters = [ComparisonFilter.eq(field, getattr(model, field)) for field in pk_fields]

        # Use AndFilter for multiple primary key fields, or single ComparisonFilter
        if len(pk_filters) == 1:
            filter_expr: Filter = pk_filters[0]
        else:
            filter_expr = AndFilter(filters=pk_filters)

        existing = await self.find_first(model_class, filters=filter_expr)
        if existing is not None:
            return existing, False
        return await self.create(model), True


_BRIDGE_TIMEOUT_SECONDS: float = 60.0
"""Timeout for cross-loop bridge calls (future.result).

timeout.  worker  run_coroutine_threadsafe
 owner loop,  future.result(timeout=...) . 
 loop, worker  TimeoutError pending. 
"""


class LoopSafeDatabaseEngine(DatabaseEngine):
    """Transparent wrapper ensuring all DB operations run on the owner event loop.

    Cross-loop package,  loop-bound  async DB  (asyncpg, aiomysql) . 

     setup_models()  owner event loop.  DB 
    event loop  ( worker  asyncio.run()  loop), 
     run_coroutine_threadsafe  owner loop, completed. 

     worker,: 
    - worker  event loop 
    -  event loop 

     bridge  future.result(timeout=_BRIDGE_TIMEOUT_SECONDS), 
     loop  worker pending. 

     engine . 
    """

    def __init__(self, inner: DatabaseEngine) -> None:
        self._inner = inner
        self._owner_loop: asyncio.AbstractEventLoop | None = None

    def _get_bridge_loop(self) -> asyncio.AbstractEventLoop | None:
        """Return the owner loop if bridging is needed, else None.

        value None  owner loop, 
         run_coroutine_threadsafe . 

         owner loop .  owner loop 
         ( asyncio.run() ),, 
         loop . 
        """
        owner = self._owner_loop
        if owner is None:
            return None
        # owner loop
        if not owner.is_running():
            return None
        try:
            current = asyncio.get_running_loop()
        except RuntimeError:
            return None
        if current is owner:
            return None
        return owner

    # -- lifecycle -----------------------------------------------------------

    async def setup_models(self, model_classes: list[type[SQLModel]]) -> None:
        """Initialize models and capture the owner event loop."""
        # owner loop, .
        # _get_bridge_loop is_running .
        self._owner_loop = asyncio.get_running_loop()
        await self._inner.setup_models(model_classes)

    # -- CRUD with loop-safe bridging ----------------------------------------

    async def find_first(
        self,
        model_class: type[T],
        *,
        filters: Filter,
    ) -> T | None:
        bridge_loop = self._get_bridge_loop()
        if bridge_loop is not None:
            future = asyncio.run_coroutine_threadsafe(
                self._inner.find_first(model_class, filters=filters),
                bridge_loop,
            )
            return future.result(timeout=_BRIDGE_TIMEOUT_SECONDS)
        return await self._inner.find_first(model_class, filters=filters)

    async def find_many(
        self,
        model_class: type[T],
        *,
        filters: Filter | None = None,
        limit: int | None = None,
        offset: int | None = None,
        order_by: str | tuple[str, ...] | None = None,
    ) -> list[T]:
        bridge_loop = self._get_bridge_loop()
        if bridge_loop is not None:
            future = asyncio.run_coroutine_threadsafe(
                self._inner.find_many(
                    model_class,
                    filters=filters,
                    limit=limit,
                    offset=offset,
                    order_by=order_by,
                ),
                bridge_loop,
            )
            return future.result(timeout=_BRIDGE_TIMEOUT_SECONDS)
        return await self._inner.find_many(
            model_class,
            filters=filters,
            limit=limit,
            offset=offset,
            order_by=order_by,
        )

    async def create(self, model: T) -> T:
        bridge_loop = self._get_bridge_loop()
        if bridge_loop is not None:
            future = asyncio.run_coroutine_threadsafe(
                self._inner.create(model),
                bridge_loop,
            )
            return future.result(timeout=_BRIDGE_TIMEOUT_SECONDS)
        return await self._inner.create(model)

    async def create_many(self, models: list[T]) -> list[T]:
        bridge_loop = self._get_bridge_loop()
        if bridge_loop is not None:
            future = asyncio.run_coroutine_threadsafe(
                self._inner.create_many(models),
                bridge_loop,
            )
            return future.result(timeout=_BRIDGE_TIMEOUT_SECONDS)
        return await self._inner.create_many(models)

    async def update(self, model: T) -> T:
        bridge_loop = self._get_bridge_loop()
        if bridge_loop is not None:
            future = asyncio.run_coroutine_threadsafe(
                self._inner.update(model),
                bridge_loop,
            )
            return future.result(timeout=_BRIDGE_TIMEOUT_SECONDS)
        return await self._inner.update(model)

    async def delete(
        self,
        model_class: type[T],
        *,
        filters: Filter,
    ) -> int:
        bridge_loop = self._get_bridge_loop()
        if bridge_loop is not None:
            future = asyncio.run_coroutine_threadsafe(
                self._inner.delete(model_class, filters=filters),
                bridge_loop,
            )
            return future.result(timeout=_BRIDGE_TIMEOUT_SECONDS)
        return await self._inner.delete(model_class, filters=filters)

    async def count(
        self,
        model_class: type[T],
        *,
        filters: Filter | None = None,
    ) -> int:
        bridge_loop = self._get_bridge_loop()
        if bridge_loop is not None:
            future = asyncio.run_coroutine_threadsafe(
                self._inner.count(model_class, filters=filters),
                bridge_loop,
            )
            return future.result(timeout=_BRIDGE_TIMEOUT_SECONDS)
        return await self._inner.count(model_class, filters=filters)

    # -- compound operations (bridge as single unit for efficiency) -----------

    async def upsert(self, model: T) -> tuple[T, bool]:
        bridge_loop = self._get_bridge_loop()
        if bridge_loop is not None:
            future = asyncio.run_coroutine_threadsafe(
                self._inner.upsert(model),
                bridge_loop,
            )
            return future.result(timeout=_BRIDGE_TIMEOUT_SECONDS)
        return await self._inner.upsert(model)

    async def get_or_create(self, model: T) -> tuple[T, bool]:
        bridge_loop = self._get_bridge_loop()
        if bridge_loop is not None:
            future = asyncio.run_coroutine_threadsafe(
                self._inner.get_or_create(model),
                bridge_loop,
            )
            return future.result(timeout=_BRIDGE_TIMEOUT_SECONDS)
        return await self._inner.get_or_create(model)