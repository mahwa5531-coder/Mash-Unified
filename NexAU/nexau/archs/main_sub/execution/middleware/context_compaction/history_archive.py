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

"""History archive writer for context compaction.

RFC-0021: context compaction sandbox

"" +  boundary  append 
``transcript.jsonl``. Agent  ``read_file`` / ``search_file_content`` . 

: 

- ** append-only**: ``{sandbox_tmp}/.nexau_history_archive/<namespace>/transcript.jsonl``
- ****, type:
    -  ``Message`` ( id/role/content/...)
    - boundary : ``{"_boundary": {round, compacted_at, ...}}``
- **Resume**:  transcript  boundary round,  = max+1
- **exception**: sandbox  / failure, exception (failure)

: agent  ``search_file_content`` grep transcript.jsonl 
,  round ; append-only . 
"""

from __future__ import annotations

import base64 as _b64
import hashlib
import json
import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, cast

from nexau.archs.sandbox.base_sandbox import BaseSandbox, SandboxStatus
from nexau.core.messages import ImageBlock, Message, Role, TextBlock, ToolResultBlock

logger = logging.getLogger(__name__)

ARCHIVE_SUBDIR = ".nexau_history_archive"
"""sandbox  (RFC-0021). 

 config:  ``"../foo"`` class,
defaultvalue,  use case . 
"""

TRANSCRIPT_FILENAME = "transcript.jsonl"
IMAGES_SUBDIR = "images"
ARCHIVED_IMAGE_URL_PREFIX = "file:"
BOUNDARY_KEY = "_boundary"
PREVIEW_MAX_CHARS = 300
_SAFE_ARCHIVE_COMPONENT_RE = re.compile(r"[^A-Za-z0-9_.-]+")

# mime → ; .bin
_MIME_EXT: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/bmp": "bmp",
    "image/tiff": "tiff",
}


def _ext_from_mime(mime: str) -> str:
    return _MIME_EXT.get(mime.lower(), "bin")


def _safe_archive_component(value: Any) -> str:
    """Return a filesystem-safe, human-readable namespace component."""
    if value is None:
        return ""
    safe = _SAFE_ARCHIVE_COMPONENT_RE.sub("_", str(value)).strip("._-")
    return safe[:64]


def _archive_namespace(*, agent_state: Any, sandbox: BaseSandbox) -> str:
    """Build a stable per-agent namespace for temp history archives.

    ``sandbox_id`` is often absent for local sandboxes, and multiple agents may
    share the same work_dir, so the namespace combines a readable label with a
    short hash of the sandbox/agent identity.
    """
    agent_id = agent_state.agent_id if hasattr(agent_state, "agent_id") else None
    sandbox_id = sandbox.sandbox_id
    work_dir = str(sandbox.work_dir) if sandbox.work_dir else ""
    seed = "\0".join(
        [
            sandbox.__class__.__name__,
            str(agent_id or ""),
            str(sandbox_id or ""),
            work_dir,
        ]
    )
    digest = hashlib.sha256(seed.encode("utf-8", errors="replace")).hexdigest()[:12]
    label = "sandbox"
    for raw_label in (agent_id, sandbox_id):
        if raw_label is None:
            continue
        safe_label = _safe_archive_component(raw_label)
        if safe_label:
            label = safe_label
            break
    return f"{label}-{digest}"


@dataclass(frozen=True)
class BoundaryRecord:
    """RFC-0021:  boundary ,  transcript.jsonl 
    ``{"_boundary": {...}}`` 。"""

    round: int
    compacted_at: str
    agent_id: str | None
    run_id: str | None
    trigger_reason: str
    strategy: str
    tokens_before: int | None
    tokens_after: int | None
    removed_message_count: int
    first_message_id: str
    last_message_id: str
    summary_message_id: str | None
    preview: str
    extracted_images: int = 0

    def to_line_dict(self) -> dict[str, Any]:
        return {
            BOUNDARY_KEY: {
                "round": self.round,
                "compacted_at": self.compacted_at,
                "agent_id": self.agent_id,
                "run_id": self.run_id,
                "trigger_reason": self.trigger_reason,
                "strategy": self.strategy,
                "tokens_before": self.tokens_before,
                "tokens_after": self.tokens_after,
                "removed_message_count": self.removed_message_count,
                "first_message_id": self.first_message_id,
                "last_message_id": self.last_message_id,
                "summary_message_id": self.summary_message_id,
                "preview": self.preview,
                "extracted_images": self.extracted_images,
            }
        }


class HistoryArchiveWriter:
    """RFC-0021:  + boundary append  sandbox 
    transcript.jsonl. 

     sandbox  IO,  LocalSandbox / E2BSandbox . 
    """

    def __init__(
        self,
        *,
        sandbox: BaseSandbox,
        archive_dir: str,
        next_round: int = 1,
        total_archived: int = 0,
    ) -> None:
        self._sandbox: BaseSandbox = sandbox
        self._archive_dir = archive_dir
        self._transcript_path = sandbox.join_path(archive_dir, TRANSCRIPT_FILENAME)
        self._next_round = next_round
        self._total_archived = total_archived

    @classmethod
    def from_sandbox(
        cls,
        *,
        agent_state: Any,
    ) -> HistoryArchiveWriter | None:
        """ agent_state  writer; sandbox  None. 

         sandbox  ``ARCHIVE_SUBDIR``
        (``.nexau_history_archive``),  config - ;
        defaultvalue. 

        try :  sandbox  (get_sandbox / get_temp_dir / create_directory),
        "sandbox "" bug". ``_scan_transcript``  try, . 
        """
        if agent_state is None:
            return None
        get_sb = getattr(agent_state, "get_sandbox", None)  # noqa: B009 - duck-typing
        if not callable(get_sb):
            logger.debug("[HistoryArchiveWriter] agent_state has no get_sandbox; skip.")
            return None

        try:
            sandbox = get_sb()
            if not isinstance(sandbox, BaseSandbox):
                logger.debug("[HistoryArchiveWriter] Sandbox unavailable; skip archiving.")
                return None
            temp_dir = str(sandbox.get_temp_dir())
            if not temp_dir:
                logger.debug("[HistoryArchiveWriter] Empty sandbox temp_dir; skip archiving.")
                return None
            archive_dir = sandbox.join_path(
                temp_dir,
                ARCHIVE_SUBDIR,
                _archive_namespace(agent_state=agent_state, sandbox=sandbox),
            )
            sandbox.create_directory(archive_dir, parents=True)
        except Exception as exc:
            logger.warning("[HistoryArchiveWriter] sandbox setup failed: %s", exc)
            return None

        next_round, total_archived = cls._scan_transcript(sandbox, archive_dir)
        logger.info(
            "[HistoryArchiveWriter] Initialized at %s (next_round=%d, prior_archived=%d)",
            archive_dir,
            next_round,
            total_archived,
        )
        return cls(
            sandbox=sandbox,
            archive_dir=archive_dir,
            next_round=next_round,
            total_archived=total_archived,
        )

    @staticmethod
    def _scan_transcript(sandbox: BaseSandbox, archive_dir: str) -> tuple[int, int]:
        """ transcript.jsonl,  (next_round, total_archived)。"""
        path = sandbox.join_path(archive_dir, TRANSCRIPT_FILENAME)
        try:
            if not sandbox.file_exists(path):
                return 1, 0
            res = sandbox.read_file(path, encoding="utf-8", binary=False)
            if res.status != SandboxStatus.SUCCESS or not isinstance(res.content, str):
                return 1, 0
        except Exception as exc:
            logger.warning("[HistoryArchiveWriter] scan_transcript failed: %s", exc)
            return 1, 0

        max_round = 0
        total = 0
        for raw_line in res.content.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(obj, dict) and BOUNDARY_KEY in obj:
                obj_dict: dict[str, Any] = cast("dict[str, Any]", obj)
                b_raw = obj_dict[BOUNDARY_KEY]
                if isinstance(b_raw, dict):
                    bd: dict[str, Any] = cast("dict[str, Any]", b_raw)
                    r = bd.get("round")
                    if isinstance(r, int) and r > max_round:
                        max_round = r
                    removed = bd.get("removed_message_count")
                    if isinstance(removed, int):
                        total += removed
        return max_round + 1, total

    def write_round(
        self,
        *,
        removed: list[Message],
        tokens_before: int | None,
        tokens_after: int | None,
        trigger_reason: str,
        strategy_name: str,
        run_id: str | None,
        agent_id: str | None,
    ) -> BoundaryRecord | None:
        """:  removed  + boundary  append  transcript.jsonl. 

        base64 ImageBlock  ``images/{msg_id}-{idx}.{ext}`` ,
        transcript.jsonl  ``url=file:images/...``  ( transcript ). 
        URL ImageBlock . 

        failure None, exception  --  failure. 
        """
        if not removed:
            return None
        try:
            round_num = self._next_round

            # 1. base64: removed messages, dump
            processed, extracted_images = self._externalize_images(removed)

            # 2. boundary record
            preview = self._build_preview(removed)
            summary_id = self._find_summary_id(removed)
            record = BoundaryRecord(
                round=round_num,
                compacted_at=datetime.now(UTC).isoformat(),
                agent_id=agent_id,
                run_id=run_id,
                trigger_reason=trigger_reason,
                strategy=strategy_name,
                tokens_before=tokens_before,
                tokens_after=tokens_after,
                removed_message_count=len(removed),
                first_message_id=str(removed[0].id),
                last_message_id=str(removed[-1].id),
                summary_message_id=summary_id,
                preview=preview,
                extracted_images=extracted_images,
            )

            # 3.: removed messages + boundary
            new_lines: list[str] = [m.model_dump_json() for m in processed]
            new_lines.append(json.dumps(record.to_line_dict(), ensure_ascii=False))
            new_content = "\n".join(new_lines) + "\n"

            # 3. read+rewrite append (sandbox API append, )
            existing = ""
            try:
                if self._sandbox.file_exists(self._transcript_path):
                    res = self._sandbox.read_file(
                        self._transcript_path,
                        encoding="utf-8",
                        binary=False,
                    )
                    if res.status == SandboxStatus.SUCCESS and isinstance(res.content, str):
                        existing = res.content
                        if existing and not existing.endswith("\n"):
                            existing += "\n"
            except Exception as exc:
                logger.warning("[HistoryArchiveWriter] read transcript failed: %s", exc)

            self._sandbox.write_file(
                self._transcript_path,
                existing + new_content,
                create_directories=True,
            )

            self._next_round = round_num + 1
            self._total_archived += len(removed)
            logger.info(
                "[HistoryArchiveWriter] Round %d archived: %d messages -> %s",
                round_num,
                len(removed),
                TRANSCRIPT_FILENAME,
            )
            return record
        except Exception as exc:
            logger.warning("[HistoryArchiveWriter] write_round failed: %s", exc)
            return None

    @property
    def archive_dir(self) -> str:
        return self._archive_dir

    @property
    def archive_subdir_name(self) -> str:
        return ARCHIVE_SUBDIR

    @property
    def transcript_path(self) -> str:
        return self._transcript_path

    @property
    def total_rounds(self) -> int:
        return self._next_round - 1

    @property
    def total_archived(self) -> int:
        return self._total_archived

    def _externalize_images(self, removed: list[Message]) -> tuple[list[Message], int]:
        """ base64 ImageBlock  ``images/{msg_id}-{path}.{ext}`` ,
         (list, ). 

        :
        - **** ImageBlock (USER / ASSISTANT )
        - **** ImageBlock  ``ToolResultBlock.content``  (multimodal )

        -  ``ImageBlock.base64`` ; URL-only 
        - failure ( / decode error)  block  ()
        -  messages ( ``model_copy(update=...)`` ); 
          active context , value
        """

        def _has_b64_image(block: Any) -> bool:
            if isinstance(block, ImageBlock) and block.base64:
                return True
            if isinstance(block, ToolResultBlock) and isinstance(block.content, list):
                return any(isinstance(c, ImageBlock) and c.base64 for c in block.content)
            return False

        needs_processing = any(_has_b64_image(b) for msg in removed for b in msg.content)
        if not needs_processing:
            return removed, 0

        images_dir_abs = self._sandbox.join_path(self._archive_dir, IMAGES_SUBDIR)
        try:
            self._sandbox.create_directory(images_dir_abs, parents=True)
        except Exception as exc:
            logger.warning("[HistoryArchiveWriter] cannot create images dir: %s", exc)
            return removed, 0

        # nested function, mypy nonlocal
        extracted = 0

        def _externalize_one(msg_id: str, path_label: str, img: ImageBlock) -> ImageBlock:
            """ block; failure。"""
            nonlocal extracted
            ext = _ext_from_mime(img.mime_type)
            rel = f"{IMAGES_SUBDIR}/{msg_id}-{path_label}.{ext}"
            abs_path = self._sandbox.join_path(self._archive_dir, rel)
            try:
                img_bytes = _b64.b64decode(img.base64 or "")
                self._sandbox.write_file(
                    abs_path,
                    img_bytes,
                    binary=True,
                    create_directories=True,
                )
                extracted += 1
                return img.model_copy(
                    update={
                        "base64": None,
                        "url": f"{ARCHIVED_IMAGE_URL_PREFIX}{rel}",
                    }
                )
            except Exception as exc:
                logger.warning(
                    "[HistoryArchiveWriter] failed to externalize image (msg=%s, path=%s): %s",
                    msg_id,
                    path_label,
                    exc,
                )
                return img  # fallback:  block 

        result: list[Message] = []
        for msg in removed:
            if not any(_has_b64_image(b) for b in msg.content):
                result.append(msg)
                continue

            # block; block - message .
            new_content: list[Any] = []
            for idx, block in enumerate(msg.content):
                if isinstance(block, ImageBlock) and block.base64:
                    new_content.append(_externalize_one(str(msg.id), str(idx), block))
                elif (
                    isinstance(block, ToolResultBlock)
                    and isinstance(block.content, list)
                    and any(isinstance(c, ImageBlock) and c.base64 for c in block.content)
                ):
                    # tool result ImageBlock
                    new_inner: list[Any] = []
                    for jdx, inner in enumerate(block.content):
                        if isinstance(inner, ImageBlock) and inner.base64:
                            new_inner.append(_externalize_one(str(msg.id), f"{idx}-{jdx}", inner))
                        else:
                            new_inner.append(inner)
                    new_content.append(block.model_copy(update={"content": new_inner}))
                else:
                    new_content.append(block)

            # message (Pydantic update= instance
            # - deep=True, message )
            result.append(msg.model_copy(update={"content": new_content}))
        return result, extracted

    @staticmethod
    def _build_preview(removed: list[Message]) -> str:
        """ system/framework  preview。"""
        for msg in removed:
            if msg.role in (Role.SYSTEM, Role.FRAMEWORK):
                continue
            text = _extract_text_for_preview(msg)
            if text:
                return text[:PREVIEW_MAX_CHARS]
        return _extract_text_for_preview(removed[0])[:PREVIEW_MAX_CHARS]

    @staticmethod
    def _find_summary_id(removed: list[Message]) -> str | None:
        """package summary ,  id。"""
        for msg in removed:
            md = msg.metadata or {}
            if md.get("isSummary") is True or md.get("is_compacted") is True:
                return str(msg.id)
        return None


def _extract_text_for_preview(msg: Message) -> str:
    """ Message  preview。"""
    parts: list[str] = []
    for block in msg.content:
        if isinstance(block, TextBlock):
            parts.append(block.text)
        elif isinstance(block, ToolResultBlock):
            if isinstance(block.content, str):
                parts.append(block.content)
    return " ".join(p.strip() for p in parts if p).strip()


def build_archive_hint(
    *,
    total_archived: int,
    total_rounds: int,
    latest_round: int,
    archive_dir: str,
    transcript_path: str,
) -> str:
    """RFC-0021:  (). 

     agent  transcript.jsonl,  search_file_content / read_file . 
     writer  sandbox  transcript . 

    ** hint **  --  .  TextBlock 
,  ``\\n\\n`` ;, . 
    """
    return (
        f"📁 [Archive] {total_archived} earlier message(s) archived across "
        f"{total_rounds} compaction round(s) (latest: round {latest_round}).\n"
        f"To recall earlier conversation, use your file tools on `{transcript_path}`:\n"
        f"  • `search_file_content` with dir_path `{archive_dir}` to grep for keywords "
        f"(each matched line is a serialized Message)\n"
        f"  • `read_file` on `{transcript_path}` for full chronological view\n"
        f'  • Boundary lines `{{"{BOUNDARY_KEY}": ...}}` mark each compaction round'
    )