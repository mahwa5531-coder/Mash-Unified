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

"""Sensitive-word middleware.

RFC-0027: sensitive wordsmiddleware

: ``before_model``, ``after_model`` . 
 ``input_action`` / ``output_action``, 
 ``ContentBlockedEvent``  ( ``RunErrorEvent`` ) . 

 (``OnHitAction``): 

- ``terminate``:  ``force_stop_reason=ERROR_OCCURRED``,  ``refusal_template``
  / assistant, executor  run error. RFC-0027
,  (/). 
- ``mask`` (default):  ``mask_template`` (default ``***``),
  assistant, run .  fallback,
  sensitive words. 
  ``mask_template="[<{category}>]"``. 
- ``soft_reject``:  ``soft_refusal_template`` / assistant
, force_stop_reason=``SUCCESS``. run completed (error), 
  ``terminal_reason``, . **input **
   history sensitive words mask ,  user  history 
   (: ). "
   LLM ". 

configuration: . 

package,  Aho-Corasick . 
"""

from __future__ import annotations

import logging
from collections import deque
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import TYPE_CHECKING, Literal

from nexau.archs.llm.llm_aggregators.events import ContentBlockedEvent
from nexau.archs.main_sub.execution.hooks import (
    AfterModelHookInput,
    BeforeModelHookInput,
    HookResult,
    Middleware,
)
from nexau.archs.main_sub.execution.stop_reason import AgentStopReason
from nexau.core.messages import Message, Role, TextBlock, ToolResultBlock

if TYPE_CHECKING:
    from nexau.archs.main_sub.agent_state import AgentState

logger = logging.getLogger(__name__)


class OnHitAction(str, Enum):
    """RFC-0027 follow-up: sensitive words. 

    module docstring . 
    """

    TERMINATE = "terminate"
    MASK = "mask"
    SOFT_REJECT = "soft_reject"


# default terminate / soft_reject ( konsheng/Sensitive-lexicon class)
_DEFAULT_REFUSAL_TEMPLATE = (
    "⚠️ 抱歉：{source}包含「{category}」类别的敏感词（例如 {hits}），"
    "由于安全策略，当前对话被中止。\n\n"
    "请修改内容后重新提问，感谢您的理解与配合。"
)

# default soft_reject ( terminate, "error")
_DEFAULT_SOFT_REFUSAL_TEMPLATE = "不好意思, {source}有些不便回答, 我们跳过这个话题吧。"

# default mask:, LLM .
# class, ``mask_template="[<{category}>]"``;
# , ``mask_template="*{length}*"`` class.
_DEFAULT_MASK_TEMPLATE = "***"

# default: + tool result (RFC-0027 A: tool result) .
# TOOL ToolResultBlock, scan_messages ( _extract_scan_text) .
_DEFAULT_SCAN_ROLES: frozenset[Role] = frozenset({Role.USER, Role.FRAMEWORK, Role.SYSTEM, Role.TOOL})


# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SensitiveHit:
    """A single sensitive-word match.

    RFC-0027: sensitive words
    """

    word: str
    category: str
    start: int
    end: int


def _empty_hit_list() -> list[SensitiveHit]:
    return []


@dataclass
class SensitiveScanResult:
    """All hits for a scanned text payload.

    RFC-0027: 
    """

    hits: list[SensitiveHit] = field(default_factory=_empty_hit_list)

    @property
    def matched(self) -> bool:
        return bool(self.hits)

    @property
    def categories(self) -> list[str]:
        seen: dict[str, None] = {}
        for hit in self.hits:
            seen.setdefault(hit.category, None)
        return list(seen.keys())

    @property
    def words(self) -> list[str]:
        seen: dict[str, None] = {}
        for hit in self.hits:
            seen.setdefault(hit.word, None)
        return list(seen.keys())


class SensitiveContentBlockedError(RuntimeError):
    """Raised internally when a sensitive hit is found.

    RFC-0027: middlewareexception
    """

    def __init__(self, source: str, scan_result: SensitiveScanResult) -> None:
        super().__init__(f"sensitive content blocked: source={source} hits={scan_result.words}")
        self.source = source
        self.scan_result = scan_result


# ---------------------------------------------------------------------------
# Aho-Corasick ( Python, )
# ---------------------------------------------------------------------------


class _AhoCorasick:
    """Minimal Aho-Corasick automaton for multi-pattern Chinese/English matching.

    RFC-0027: 

    -  dict  children,  Unicode
    -  pattern  ``category``, 
    -  O(Σ|patterns|),  O(|text| + matches)
    """

    __slots__ = ("_children", "_fail", "_output", "_built")

    def __init__(self) -> None:
        # 0
        self._children: list[dict[str, int]] = [{}]
        # fail:
        self._fail: list[int] = [0]
        # (word, category) list
        self._output: list[list[tuple[str, str]]] = [[]]
        self._built = False

    def add(self, word: str, category: str) -> None:
        # 1., fail
        if self._built:
            raise RuntimeError("cannot add patterns after build()")
        if not word:
            return

        # 2. trie /
        node = 0
        for ch in word:
            nxt = self._children[node].get(ch)
            if nxt is None:
                self._children.append({})
                self._fail.append(0)
                self._output.append([])
                nxt = len(self._children) - 1
                self._children[node][ch] = nxt
            node = nxt

        # 3. (word, category)
        self._output[node].append((word, category))

    def build(self) -> None:
        """Compute fail links via BFS. Must be called before scan()."""
        if self._built:
            return

        # 1. fail
        queue: deque[int] = deque()
        for child in self._children[0].values():
            self._fail[child] = 0
            queue.append(child)

        # 2. BFS: u, children
        while queue:
            u = queue.popleft()
            for ch, v in self._children[u].items():
                # fail
                f = self._fail[u]
                while f != 0 and ch not in self._children[f]:
                    f = self._fail[f]
                candidate = self._children[f].get(ch, 0)
                # (v fail)
                self._fail[v] = candidate if candidate != v else 0
                self._output[v].extend(self._output[self._fail[v]])
                queue.append(v)

        self._built = True

    def scan(self, text: str) -> list[SensitiveHit]:
        """Scan text and return all hits."""
        if not self._built:
            raise RuntimeError("AhoCorasick.scan() called before build()")
        if not text:
            return []

        hits: list[SensitiveHit] = []
        node = 0
        for i, ch in enumerate(text):
            # 1. fail
            while node and ch not in self._children[node]:
                node = self._fail[node]
            node = self._children[node].get(ch, 0)

            # 2.
            if self._output[node]:
                for word, category in self._output[node]:
                    end = i + 1
                    hits.append(SensitiveHit(word=word, category=category, start=end - len(word), end=end))
        return hits


# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------


def _casefold_lower(text: str) -> str:
    """Length-preserving lowercase for case-insensitive matching.

    RFC-0027: ``str.lower()``  Unicode **** -- 
     ``"İ"`` (U+0130) ``.lower()`` → ``"i̇"`` (``i`` + U+0307, 
    2 ) . sensitive words mask  lower  AC  offset ****, class
, offset, mask  --  L  ``İ`` (L=) 
     mask,  LLM  history. 

     **1:1**:  ``ch.lower()``, 
, AC offset . function, . 
    """
    out: list[str] = []
    for ch in text:
        low = ch.lower()
        out.append(low if len(low) == 1 else ch)
    return "".join(out)


# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------


def _load_words_from_file(path: Path) -> Iterable[str]:
    """Yield non-empty, non-comment lines from a UTF-8 lexicon file."""
    raw = path.read_text("utf-8", errors="replace")
    for line in raw.splitlines():
        word = line.strip()
        if not word or word.startswith("#"):
            continue
        yield word


def _load_lexicon(
    *,
    lexicon_dir: Path | None,
    lexicon_file: Path | None,
    lexicon_words: Iterable[str] | None,
    extra_words: Iterable[str] | None,
    case_sensitive: bool,
) -> dict[str, str]:
    """Aggregate all sources into a {word: category} mapping."""
    out: dict[str, str] = {}

    def _normalize(word: str) -> str:
        return word if case_sensitive else _casefold_lower(word)

    def _put(word: str, category: str) -> None:
        norm = _normalize(word.strip())
        if norm:
            # class
            out[norm] = category

    # 1. (, class "explicit")
    if lexicon_words is not None:
        for w in lexicon_words:
            _put(w, "explicit")

    # 2.
    if lexicon_file is not None:
        category = lexicon_file.stem
        for w in _load_words_from_file(lexicon_file):
            _put(w, category)

    # 3. ( *.txt, category)
    if lexicon_dir is not None:
        if not lexicon_dir.is_dir():
            raise FileNotFoundError(f"SensitiveWordMiddleware lexicon_dir is not a directory: {lexicon_dir}")
        for child in sorted(lexicon_dir.glob("*.txt")):
            category = child.stem
            for w in _load_words_from_file(child):
                _put(w, category)

    # 4. (sensitive words, "extra" class)
    if extra_words is not None:
        for w in extra_words:
            _put(w, "extra")

    return out


# ---------------------------------------------------------------------------
# middleware
# ---------------------------------------------------------------------------


class SensitiveWordMiddleware(Middleware):
    """Block LLM input/output containing words from a sensitive lexicon.

    RFC-0027: sensitive wordsmiddleware

     (configuration: )::

        from nexau.archs.main_sub.execution.middleware.sensitive_word import (
            SensitiveWordMiddleware,
        )

        agent_config.middlewares.append(SensitiveWordMiddleware(lexicon_dir="/opt/nexau/sensitive_lexicon"))

    Args:
        lexicon_dir:  ``.txt`` class, 
            .  ``lexicon_file`` / ``lexicon_words`` configuration. 
        lexicon_file: class. 
        lexicon_words:  "explicit" class. 
        extra_words: sensitive words,  "extra" class. 
        case_sensitive: . ; sensitive words ``False``. 
        block_input:  LLM  (``scan_roles``, default// + tool result) . 
        block_output:  LLM . 
        input_action:  (``OnHitAction``), default ``mask`` (). 
             RFC-0027  ``"terminate"``. 
        output_action: default ``mask`` (). 
        refusal_template: ``terminate``,  ``{source}`` /
            ``{category}`` / ``{hits}`` . 
        soft_refusal_template: ``soft_reject``, 
            ``refusal_template``. 
        mask_template: ``mask``,  ``{category}`` /
            ``{word}`` / ``{length}`` () . default ``"***"`` (
, ). class,  ``"[<{category}>]"``;
,  ``"*{length}*"`` class. 
        scan_roles:  ``Role`` set; default USER/FRAMEWORK/SYSTEM/TOOL (tool result) . 
        raise_on_block: True  ``SensitiveContentBlockedError``; 
            default False, " action ". 
    """

    source_id = "sensitive_word_middleware"

    def __init__(
        self,
        *,
        lexicon_dir: Path | str | None = None,
        lexicon_file: Path | str | None = None,
        lexicon_words: Iterable[str] | None = None,
        extra_words: Iterable[str] | None = None,
        case_sensitive: bool = False,
        block_input: bool = True,
        block_output: bool = True,
        input_action: OnHitAction | str = OnHitAction.MASK,
        output_action: OnHitAction | str = OnHitAction.MASK,
        refusal_template: str = _DEFAULT_REFUSAL_TEMPLATE,
        soft_refusal_template: str = _DEFAULT_SOFT_REFUSAL_TEMPLATE,
        mask_template: str = _DEFAULT_MASK_TEMPLATE,
        scan_roles: Iterable[Role] | None = None,
        raise_on_block: bool = False,
    ) -> None:
        if lexicon_dir is None and lexicon_file is None and lexicon_words is None:
            raise ValueError(
                "SensitiveWordMiddleware requires an explicit lexicon_dir, lexicon_file, "
                "or lexicon_words; no default sensitive lexicon is bundled."
            )

        # 1.
        norm_dir = Path(lexicon_dir) if lexicon_dir is not None else None
        norm_file = Path(lexicon_file) if lexicon_file is not None else None

        # 2.
        words = _load_lexicon(
            lexicon_dir=norm_dir,
            lexicon_file=norm_file,
            lexicon_words=lexicon_words,
            extra_words=extra_words,
            case_sensitive=case_sensitive,
        )

        # 3. AC
        automaton = _AhoCorasick()
        for word, category in words.items():
            automaton.add(word, category)
        automaton.build()

        # 4.
        self._automaton = automaton
        self._lexicon_size = len(words)
        self._case_sensitive = case_sensitive
        self._block_input = block_input
        self._block_output = block_output
        self._input_action = OnHitAction(input_action) if not isinstance(input_action, OnHitAction) else input_action
        self._output_action = OnHitAction(output_action) if not isinstance(output_action, OnHitAction) else output_action
        self._refusal_template = refusal_template
        self._soft_refusal_template = soft_refusal_template
        self._mask_template = mask_template
        self._scan_roles: frozenset[Role] = frozenset(scan_roles) if scan_roles is not None else _DEFAULT_SCAN_ROLES
        self._raise_on_block = raise_on_block
        # RFC-0027: executor ( ContentBlockedEvent) .
        self._event_emitter: Callable[[object], None] | None = None

        logger.info(
            "[SensitiveWordMiddleware] loaded %d words; block_input=%s/%s block_output=%s/%s case_sensitive=%s",
            self._lexicon_size,
            block_input,
            self._input_action.value,
            block_output,
            self._output_action.value,
            case_sensitive,
        )

    # ------------------------------------------------------------------
    # interface
    # ------------------------------------------------------------------

    @property
    def lexicon_size(self) -> int:
        return self._lexicon_size

    def scan_text(self, text: str) -> SensitiveScanResult:
        """Scan a raw string and return all hits.

        RFC-0027:  ( / ) 
        """
        if not text or self._lexicon_size == 0:
            return SensitiveScanResult()
        haystack = text if self._case_sensitive else _casefold_lower(text)
        return SensitiveScanResult(hits=self._automaton.scan(haystack))

    @staticmethod
    def _extract_scan_text(msg: Message) -> str:
        """Extract scannable text from a message, including tool-result blocks.

        RFC-0027: ``Message.get_text_content()``  TextBlock; tool result
        ``ToolResultBlock.content``  (str  TextBlock/ImageBlock list),, 
         ``Role.TOOL`` . 
        """
        parts: list[str] = [msg.get_text_content()]
        for block in msg.content:
            if isinstance(block, ToolResultBlock):
                content = block.content
                if isinstance(content, str):
                    parts.append(content)
                else:
                    parts.extend(p.text for p in content if isinstance(p, TextBlock))
        return "".join(parts)

    def scan_messages(self, messages: list[Message]) -> SensitiveScanResult:
        """Scan all messages whose role is in ``scan_roles``.

        RFC-0027: list
        """
        if self._lexicon_size == 0:
            return SensitiveScanResult()

        aggregated_hits: list[SensitiveHit] = []
        offset = 0
        for msg in messages:
            if msg.role not in self._scan_roles:
                continue
            text = self._extract_scan_text(msg)
            if not text:
                continue
            for hit in self.scan_text(text).hits:
                aggregated_hits.append(
                    SensitiveHit(
                        word=hit.word,
                        category=hit.category,
                        start=offset + hit.start,
                        end=offset + hit.end,
                    )
                )
            offset += len(text) + 1  # +1 

        return SensitiveScanResult(hits=aggregated_hits)

    # ------------------------------------------------------------------
    # Mask
    # ------------------------------------------------------------------

    def _format_placeholder(self, hit: SensitiveHit) -> str:
        """Render mask_template for a single hit; ignore unknown placeholders."""
        try:
            return self._mask_template.format(
                category=hit.category,
                word=hit.word,
                length=len(hit.word),
            )
        except (KeyError, IndexError):
            # mask_template ( "***") → format
            return self._mask_template

    def _mask_text(self, text: str) -> tuple[str, SensitiveScanResult]:
        """Scan ``text`` and return (masked_text, scan_result).

        AC  ``(start, end)``,  offset . case_sensitive=False
         scan  haystack;:func:`_casefold_lower` (**** 1:1), 
         offset,  text  ``[start:end]`` . 
         (:  ``str.lower()`` -- ``"İ"``  offset,  mask. ) 
        """
        result = self.scan_text(text)
        if not result.matched:
            return text, result
        # hit (e.g. "" "") -, mask
        # start / end, package hit
        sorted_hits = sorted(result.hits, key=lambda h: (h.start, -h.end))
        merged: list[SensitiveHit] = []
        for hit in sorted_hits:
            if merged and hit.start < merged[-1].end:
                if hit.end > merged[-1].end:
                    # ; word
                    # mask_template {word}/{length}
                    merged[-1] = SensitiveHit(
                        word=text[merged[-1].start : hit.end],
                        category=merged[-1].category,
                        start=merged[-1].start,
                        end=hit.end,
                    )
                continue
            merged.append(hit)
        out = text
        for hit in reversed(merged):
            out = out[: hit.start] + self._format_placeholder(hit) + out[hit.end :]
        return out, result

    def _mask_message(self, msg: Message) -> Message | None:
        """Return a new Message with sensitive content masked; None if no change."""
        from nexau.core.messages import DiscriminatedBlock, ToolResultContentBlock

        any_changed = False
        new_blocks: list[DiscriminatedBlock] = []
        for block in msg.content:
            if isinstance(block, TextBlock):
                masked, result = self._mask_text(block.text)
                if result.matched:
                    any_changed = True
                    new_blocks.append(TextBlock(id=block.id, text=masked))
                else:
                    new_blocks.append(block)
            elif isinstance(block, ToolResultBlock):
                content = block.content
                if isinstance(content, str):
                    masked, result = self._mask_text(content)
                    if result.matched:
                        any_changed = True
                        new_blocks.append(
                            ToolResultBlock(
                                tool_use_id=block.tool_use_id,
                                content=masked,
                                is_error=block.is_error,
                                raw_output=block.raw_output,
                            )
                        )
                    else:
                        new_blocks.append(block)
                else:
                    sub_blocks: list[ToolResultContentBlock] = []
                    sub_changed = False
                    for inner in content:
                        if isinstance(inner, TextBlock):
                            masked, result = self._mask_text(inner.text)
                            if result.matched:
                                sub_changed = True
                                sub_blocks.append(TextBlock(id=inner.id, text=masked))
                            else:
                                sub_blocks.append(inner)
                        else:
                            sub_blocks.append(inner)
                    if sub_changed:
                        any_changed = True
                        new_blocks.append(
                            ToolResultBlock(
                                tool_use_id=block.tool_use_id,
                                content=sub_blocks,
                                is_error=block.is_error,
                                raw_output=block.raw_output,
                            )
                        )
                    else:
                        new_blocks.append(block)
            else:
                new_blocks.append(block)
        if not any_changed:
            return None
        return Message(
            id=msg.id,
            role=msg.role,
            content=new_blocks,
            metadata=msg.metadata,
            created_at=msg.created_at,
        )

    # ------------------------------------------------------------------
    # Hook: before_model, after_model
    # ------------------------------------------------------------------

    def before_model(self, hook_input: BeforeModelHookInput) -> HookResult:  # type: ignore[override]
        """Scan input messages before the LLM call; act per ``input_action`` on hit.

        RFC-0027: 

        terminate:  force_stop_reason=ERROR_OCCURRED + . 
        mask: sensitive words messages, run . 
        soft_reject:  + force_stop_reason=SUCCESS (completederror),
             mask history . 
        """
        if not self._block_input or self._lexicon_size == 0:
            return HookResult.no_changes()

        result = self.scan_messages(list(hook_input.messages))
        if not result.matched:
            return HookResult.no_changes()

        if self._raise_on_block:
            raise SensitiveContentBlockedError(source="input", scan_result=result)

        # 1. (audit action )
        notice = self._build_notice(source="input", scan_result=result, action=self._input_action)
        self._emit_blocked(agent_state=hook_input.agent_state, source="input", scan_result=result, message=notice)

        # 2. action
        action = self._input_action
        if action == OnHitAction.MASK:
            new_messages = [self._mask_message(m) or m for m in hook_input.messages]
            return HookResult(messages=new_messages)

        if action == OnHitAction.TERMINATE:
            new_messages = list(hook_input.messages)
            new_messages.append(Message(role=Role.ASSISTANT, content=[TextBlock(text=notice)]))
            return HookResult(messages=new_messages, force_stop_reason=AgentStopReason.ERROR_OCCURRED)

        # SOFT_REJECT: LLM + ; terminal_reason=SUCCESS error.
        # mask sensitive words, history
        # sensitive words soft_reject "".: .
        new_messages = [self._mask_message(m) or m for m in hook_input.messages]
        new_messages.append(Message(role=Role.ASSISTANT, content=[TextBlock(text=notice)]))
        return HookResult(messages=new_messages, force_stop_reason=AgentStopReason.SUCCESS)

    def after_model(self, hook_input: AfterModelHookInput) -> HookResult:  # type: ignore[override]
        """Scan visible model output after the LLM call; act per ``output_action`` on hit.

        RFC-0027: 

         (``original_response``),  reasoning. 
        terminate:  assistant  + force_stop_reason=ERROR_OCCURRED. 
        mask:  assistant  mask, run . 
        soft_reject:  assistant  + force_stop_reason=SUCCESS. 
        """
        if not self._block_output or self._lexicon_size == 0:
            return HookResult.no_changes()

        text = hook_input.original_response or ""
        result = self.scan_text(text)
        if not result.matched:
            return HookResult.no_changes()

        if self._raise_on_block:
            raise SensitiveContentBlockedError(source="output", scan_result=result)

        notice = self._build_notice(source="output", scan_result=result, action=self._output_action)
        self._emit_blocked(agent_state=hook_input.agent_state, source="output", scan_result=result, message=notice)

        action = self._output_action
        messages = list(hook_input.messages)

        if action == OnHitAction.MASK:
            # assistant mask (executor assistant )
            if messages and messages[-1].role == Role.ASSISTANT:
                masked = self._mask_message(messages[-1]) or messages[-1]
                messages[-1] = masked
            return HookResult(messages=messages)

        # TERMINATE / SOFT_REJECT notice assistant, stop reason
        replacement_msg = Message(role=Role.ASSISTANT, content=[TextBlock(text=notice)])
        if messages and messages[-1].role == Role.ASSISTANT:
            messages[-1] = replacement_msg
        else:
            messages.append(replacement_msg)
        stop_reason = AgentStopReason.ERROR_OCCURRED if action == OnHitAction.TERMINATE else AgentStopReason.SUCCESS
        return HookResult(messages=messages, force_stop_reason=stop_reason)

    # ------------------------------------------------------------------
    # ------------------------------------------------------------------

    def _build_notice(
        self,
        *,
        source: str,
        scan_result: SensitiveScanResult,
        action: OnHitAction,
    ) -> str:
        """Render the user-visible notice for a hit. Template depends on ``action``.

        terminate → refusal_template ()
        soft_reject → soft_refusal_template ()
        mask → soft_refusal_template (,  message )
        """
        # 1. / class preview
        hits_preview = ", ".join(scan_result.words[:5])
        if len(scan_result.words) > 5:
            hits_preview += f" … (+{len(scan_result.words) - 5} more)"
        category_preview = "/".join(scan_result.categories[:3]) or "unknown"

        # 2.
        logger.warning(
            "[SensitiveWordMiddleware] HIT source=%s action=%s categories=%s hits=[%s]",
            source,
            action.value,
            category_preview,
            hits_preview,
        )

        # 3.
        if action == OnHitAction.TERMINATE:
            template = self._refusal_template
        else:
            template = self._soft_refusal_template

        return template.format(
            source="用户输入" if source == "input" else "模型输出",
            category=category_preview,
            hits=hits_preview,
        )

    # ------------------------------------------------------------------
    # ------------------------------------------------------------------

    def set_event_emitter(self, emitter: Callable[[object], None]) -> None:
        """Receive the unified event emitter from the executor.

        RFC-0027: executor  _wire_middleware_event_emitters 
         ( on_event,  AgentEventsMiddleware) . 
        """
        self._event_emitter = emitter

    def _emit_blocked(
        self,
        *,
        agent_state: AgentState,
        source: Literal["input", "output"],
        scan_result: SensitiveScanResult,
        message: str,
    ) -> None:
        """Emit a dedicated ContentBlockedEvent when content is blocked.

        RFC-0027:  (/class/) . 
         ``RunErrorEvent`` ;  ``ERROR_OCCURRED``. 
         emitter (middleware) . 
        """
        if self._event_emitter is None:
            return
        self._event_emitter(
            ContentBlockedEvent(
                run_id=agent_state.run_id,
                source=source,
                categories=scan_result.categories,
                words=scan_result.words,
                message=message,
            )
        )


__all__ = [
    "OnHitAction",
    "SensitiveContentBlockedError",
    "SensitiveHit",
    "SensitiveScanResult",
    "SensitiveWordMiddleware",
]