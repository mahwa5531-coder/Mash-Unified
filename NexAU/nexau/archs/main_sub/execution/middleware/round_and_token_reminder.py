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

"""Middleware that injects iteration/token reminders before each model call."""

from __future__ import annotations

import logging

from nexau.core.messages import Message, Role, TextBlock

from ...utils.token_counter import TokenCounter
from ..hooks import BeforeModelHookInput, HookResult, Middleware

logger = logging.getLogger(__name__)


class RoundAndTokenReminderMiddleware(Middleware):
    """Injects iteration and optional token budget hints before model calls."""

    def __init__(
        self,
        *,
        max_context_tokens: int | None = None,
        desired_max_tokens: int = 16384,
        enable_routine_reminders: bool = True,
        enable_iteration_warnings: bool = True,
        token_counter: TokenCounter | None = None,
    ) -> None:
        """Configure the reminder middleware.

        Args:
            max_context_tokens: Context window size; if None, inherited dynamically from AgentConfig.
            desired_max_tokens: Preferred response size for token hint messaging.
            enable_routine_reminders: When False, suppress routine iteration/token
                counter spam on normal turns.
            enable_iteration_warnings: When False, completely silence iteration limit countdown warnings.
            token_counter: Optional shared TokenCounter instance to reuse.
        """
        self.max_context_tokens = max_context_tokens
        self.desired_max_tokens = desired_max_tokens
        self.enable_routine_reminders = enable_routine_reminders
        self.enable_iteration_warnings = enable_iteration_warnings
        self.token_counter = token_counter or TokenCounter()

    def set_llm_runtime(
        self,
        llm_config: Any,
        openai_client: Any = None,
        *,
        session_id: str | None = None,
        global_storage: Any | None = None,
        max_context_tokens: int | None = None,
    ) -> None:
        """Inject agent-level runtime context window when not explicitly configured."""
        if self.max_context_tokens is None and max_context_tokens is not None:
            self.max_context_tokens = max_context_tokens
            logger.info(
                "[RoundAndTokenReminderMiddleware] Inherited max_context_tokens=%d from agent config",
                max_context_tokens,
            )

    def before_model(self, hook_input: BeforeModelHookInput) -> HookResult:  # type: ignore[override]
        """Append iteration (and optional token) hints prior to model invocation."""

        # Check for user mid-flight steering messages queued during execution
        steering_messages: list[str] = []
        try:
            sess_id = None
            if hook_input.agent_state:
                ctx = getattr(hook_input.agent_state, "context", None)
                if ctx is not None:
                    inner_ctx = getattr(ctx, "context", None)
                    if isinstance(inner_ctx, dict):
                        sess_id = inner_ctx.get("session_id")
                    elif isinstance(ctx, dict):
                        sess_id = ctx.get("session_id")
                    else:
                        sess_id = getattr(ctx, "session_id", None)
                if not sess_id and hasattr(hook_input.agent_state, "session_id"):
                    sess_id = hook_input.agent_state.session_id
                if not sess_id and hasattr(hook_input.agent_state, "global_storage"):
                    sess_id = hook_input.agent_state.global_storage.get("session_id")

            from nexau.archs.session.steering import pop_steering_messages, _STEERING_MAILBOXES, _LOCK
            if sess_id:
                steering_messages = pop_steering_messages(str(sess_id))

            # Fallback: check all mailboxes if sess_id wasn't an exact key
            if not steering_messages:
                with _LOCK:
                    for mbox_key, mbox_msgs in list(_STEERING_MAILBOXES.items()):
                        if mbox_msgs and (not sess_id or sess_id in mbox_key or mbox_key in str(sess_id)):
                            steering_messages.extend(mbox_msgs)
                            mbox_msgs.clear()
                            break
            if steering_messages:
                logger.info("[RoundAndTokenReminderMiddleware] Injected %d mid-flight steering message(s) for session %s", len(steering_messages), sess_id)
        except Exception as e:
            logger.debug("[RoundAndTokenReminderMiddleware] Steering check error: %s", e)

        # If no assistant messages yet and no steering, skip adding hints to avoid front-loading noise.
        has_assistant = any(msg.role == Role.ASSISTANT for msg in hook_input.messages)
        if not has_assistant and not steering_messages:
            return HookResult.no_changes()

        steering_blocks = [
            Message(
                role=Role.USER,
                content=[TextBlock(text=f"<USER_STEERING>\n[USER MID-FLIGHT INSTRUCTION]: {s_msg}\nAdapt your current plan and respond to this instruction immediately.\n</USER_STEERING>")]
            )
            for s_msg in steering_messages
        ]

        if not has_assistant:
            return HookResult.with_modifications(messages=[*hook_input.messages, *steering_blocks])

        remaining_iterations = hook_input.max_iterations - hook_input.current_iteration
        current_tokens = self._count_tokens(hook_input)
        remaining_tokens = max((self.max_context_tokens or 0) - current_tokens, 0)
        warning_threshold = min(3 * self.desired_max_tokens, max(1, int((self.max_context_tokens or 0) * 0.20))) if (self.max_context_tokens or 0) > 0 else 3 * self.desired_max_tokens

        has_finite_limit = hook_input.max_iterations is not None and hook_input.max_iterations > 0
        is_iter_urgent = has_finite_limit and (remaining_iterations <= 1) and self.enable_iteration_warnings
        is_token_urgent = (remaining_tokens < warning_threshold) and (self.max_context_tokens is not None and self.max_context_tokens > 0)
        is_urgent = is_iter_urgent or is_token_urgent

        # On routine turns without urgent conditions, suppress reminder noise unless explicitly enabled
        if not self.enable_routine_reminders and not is_urgent:
            if steering_blocks:
                return HookResult.with_modifications(messages=[*hook_input.messages, *steering_blocks])
            return HookResult.no_changes()

        hints = []
        if (self.enable_routine_reminders or is_iter_urgent) and has_finite_limit and self.enable_iteration_warnings:
            hints.append(self._build_iteration_hint(
                hook_input.current_iteration,
                hook_input.max_iterations,
                remaining_iterations,
            ))

        if self.enable_routine_reminders or is_token_urgent:
            hints.append(self._build_token_limit_hint(
                current_prompt_tokens=current_tokens,
                max_tokens=self.max_context_tokens or 0,
                remaining_tokens=remaining_tokens,
                desired_max_tokens=self.desired_max_tokens,
            ))

        hint_content = "\n\n".join(hints)
        framework_message = [Message(role=Role.FRAMEWORK, content=[TextBlock(text=hint_content)])] if hint_content else []

        updated_messages = [
            *hook_input.messages,
            *steering_blocks,
            *framework_message,
        ]

        logger.info("[RoundAndTokenReminderMiddleware] Added iteration/token hint message (steering: %d)", len(steering_messages))
        return HookResult.with_modifications(messages=updated_messages)

    def _count_tokens(self, hook_input: BeforeModelHookInput) -> int:
        """Count tokens for the current prompt using configured token counter."""

        try:
            return self.token_counter.count_tokens(hook_input.messages)
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.warning("[RoundAndTokenReminderMiddleware] Token counting failed: %s", exc)
            return 0

    def _remaining_tokens(self, hook_input: BeforeModelHookInput) -> int:
        """Compute remaining tokens based on the configured context window."""

        return max(self.max_context_tokens - self._count_tokens(hook_input), 0)

    @staticmethod
    def _build_iteration_hint(
        current_iteration: int,
        max_iterations: int,
        remaining_iterations: int,
    ) -> str:
        """Build progress hint if enabled."""
        if not max_iterations or max_iterations <= 0:
            return f"🔄 iteration {current_iteration} - Continue if more tool calls are needed."
        if remaining_iterations <= 1:
            return (
                f"⚠️ WARNING: This is iteration {current_iteration}/{max_iterations}. "
                f"You have only {remaining_iterations} iteration(s) remaining. "
                f"Please conclude your current steps and deliver your final findings."
            )
        if remaining_iterations <= 3:
            return (
                f"🔄 Iteration {current_iteration}/{max_iterations} - {remaining_iterations} iterations remaining. "
                f"Please be mindful of the remaining steps and work towards a conclusion."
            )
        return (
            f"🔄 Iteration {current_iteration}/{max_iterations} - Continue your response if you have more to say, "
            f"or if you need to make additional tool calls or sub-agent calls."
        )

    @staticmethod
    def _build_token_limit_hint(
        current_prompt_tokens: int,
        max_tokens: int,
        remaining_tokens: int,
        desired_max_tokens: int,
    ) -> str:
        """Replicate executor token limit hint messaging."""

        # ponytail: prevent false-alarm token panic on Turn 1 when 3*desired_max_tokens > max_tokens.
        # Warn when remaining budget drops below 20% of total window or below 3*desired_max_tokens (whichever is smaller).
        warning_threshold = min(3 * desired_max_tokens, max(1, int(max_tokens * 0.20))) if max_tokens > 0 else 3 * desired_max_tokens
        if remaining_tokens < warning_threshold:
            return (
                f"⚠️ WARNING: Token usage is approaching the limit {current_prompt_tokens}/{max_tokens}."
                f" You have only {remaining_tokens} tokens left."
                f" Please provide your findings within the available context budget."
            )
        return (
            f"🔄 Token Usage: {current_prompt_tokens}/{max_tokens} in the current prompt - {remaining_tokens} tokens left."
            f" Continue your response if you have more to say, or if you need to make additional tool calls or sub-agent calls."
        )