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

"""In-memory tracer for tests and local debugging."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from nexau.archs.tracer.core import BaseTracer, Span, SpanType


class InMemoryTracer(BaseTracer):
    """Tracer that records spans locally with bounded memory retention."""

    DEFAULT_MAX_SPANS = 500
    MAX_OUTPUT_STRING_CHARS = 4000

    def __init__(self, max_spans: int = DEFAULT_MAX_SPANS) -> None:
        self.max_spans = max_spans
        self.spans: dict[str, Span] = {}
        self.children: dict[str, list[str]] = {}
        self.root_spans: list[str] = []

    def _evict_oldest_if_needed(self) -> None:
        """Evict oldest root spans and their descendants if capacity is exceeded."""
        while len(self.spans) > self.max_spans and self.root_spans:
            oldest_root_id = self.root_spans.pop(0)
            self._recursive_evict(oldest_root_id)

    def _recursive_evict(self, span_id: str) -> None:
        """Recursively remove a span and its children from memory."""
        child_ids = self.children.pop(span_id, [])
        for cid in child_ids:
            self._recursive_evict(cid)
        self.spans.pop(span_id, None)

    @classmethod
    def _sanitize_payload(cls, data: Any) -> Any:
        """Cap excessively large strings in trace payloads to avoid memory bloat."""
        if isinstance(data, str):
            if len(data) > cls.MAX_OUTPUT_STRING_CHARS:
                return data[: cls.MAX_OUTPUT_STRING_CHARS] + f"... [truncated {len(data)} chars for memory efficiency]"
            return data
        if isinstance(data, dict):
            return {k: cls._sanitize_payload(v) for k, v in data.items()}
        if isinstance(data, list):
            return [cls._sanitize_payload(v) for v in data]
        return data

    def start_span(
        self,
        name: str,
        span_type: SpanType,
        inputs: dict[str, Any] | None = None,
        parent_span: Span | None = None,
        attributes: dict[str, Any] | None = None,
    ) -> Span:
        self._evict_oldest_if_needed()

        span_id = str(uuid.uuid4())
        now = datetime.now().timestamp()
        parent_id = None
        if parent_span is not None:
            parent_id = str(parent_span.vendor_obj) if parent_span.vendor_obj else parent_span.id

        sanitized_inputs = self._sanitize_payload(inputs) if inputs else {}

        span = Span(
            id=span_id,
            name=name,
            type=span_type,
            parent_id=parent_id,
            start_time=now,
            inputs=sanitized_inputs or {},
            attributes=attributes or {},
            vendor_obj=span_id,
        )

        self.spans[span_id] = span
        if parent_id is None:
            self.root_spans.append(span_id)
        else:
            self.children.setdefault(parent_id, []).append(span_id)

        return span

    def end_span(
        self,
        span: Span,
        outputs: Any = None,
        error: Exception | None = None,
        attributes: dict[str, Any] | None = None,
    ) -> None:
        stored_span = self.spans.get(span.id) or self.spans.get(str(span.vendor_obj), span)
        stored_span.end_time = datetime.now().timestamp()

        if outputs is not None:
            sanitized = self._sanitize_payload(outputs)
            stored_span.outputs = sanitized if isinstance(sanitized, dict) else {"result": sanitized}

        if error is not None:
            stored_span.error = str(error)

        if attributes:
            stored_span.attributes = {**stored_span.attributes, **attributes}

    def flush(self) -> None:  # pragma: no cover - kept for interface parity
        return

    def shutdown(self) -> None:  # pragma: no cover - kept for interface parity
        return

    def dump_traces(self) -> list[dict[str, Any]]:
        """Return all recorded traces preserving span nesting."""

        def span_to_dict(span: Span) -> dict[str, Any]:
            return {
                "id": span.id,
                "name": span.name,
                "type": span.type.value,
                "parent_id": span.parent_id,
                "start_time": span.start_time,
                "end_time": span.end_time,
                "duration_ms": span.duration_ms(),
                "inputs": span.inputs,
                "outputs": span.outputs,
                "attributes": span.attributes,
                "error": span.error,
                "children": [span_to_dict(self.spans[child_id]) for child_id in self.children.get(span.id, [])],
            }

        return [span_to_dict(self.spans[root_id]) for root_id in self.root_spans]