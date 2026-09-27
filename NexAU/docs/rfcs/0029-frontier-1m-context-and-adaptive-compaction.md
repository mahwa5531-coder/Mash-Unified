# RFC-0029: Frontier 1M+ Context Support, Adaptive Compaction & Output Token Decoupling

## Metadata
- **RFC ID**: 0029
- **Title**: Frontier 1M+ Context Support, Adaptive Compaction & Output Token Decoupling
- **Status**: Proposed
- **Authors**: Systems Architecture Team
- **Created**: 2026-09-05

---

## 1. Executive Summary & Problem Statement

In end-to-end evaluation, testers frequently report that agents appear "worse", produce "hollow" answers, or fail to complete multi-step software auditing and refactoring tasks. In practice, users routinely misattribute this failure to the underlying LLM or the model testing pool (e.g. Gemini 2.5/3.8, Claude 3.7, DeepSeek-V4).

Forensic investigation reveals that the model and testing pools are functioning correctly. The degradation is caused by **four compounding framework-level bottlenecks** inside NexAU's execution loop:

1. **Catastrophic Context Amnesia via `keep_iterations=2`**: `ToolResultCompaction` aggressively overwrites tool outputs older than 2 iterations with `"Tool call result has been compacted"`. If an agent reads a 500-line codebase in Turn 1, by Turn 3 the actual source code is permanently erased from memory. When generating the final answer, the LLM is starved of context and forced to write vague, shallow summaries.
2. **Artificial 128k Context Clamp in `AgentConfigBase`**: `AgentConfigBase.max_context_tokens` hardcodes a `128000` default. On 1,000,000-token models (Gemini 2.5/3.8, DeepSeek-V4, Qwen 3.8, GLM-5.3, Muse Spark 1.3), this truncates 87% of available memory.
3. **Induced "Token Panic" Warnings**: `RoundAndTokenReminderMiddleware` injects aggressive warnings (`"⚠️ WARNING: Token usage is approaching the limit... provide a conclusive response and avoid making additional tool calls"`) when approaching the artificial 128k limit, causing models to abort multi-step exploration prematurely.
4. **Gemini REST Thought Suppression & Shared Output Cap**: In Google Gemini REST v1beta, reasoning tokens and text output share a single `maxOutputTokens` pool. A default 8k cap with 8k `thinkingBudget` leaves near-zero tokens for the response text. Additionally, without `"includeThoughts": True`, Google silently drops reasoning tokens from the stream.

---

## 2. Empirical Verification & Comparison

Analysis of production agent session data stored locally on disk demonstrates the vast disparity between frontier agent capabilities and NexAU's default constraints:

| Metric | Production Reference (Antigravity Engine) | NexAU Legacy Defaults | NexAU RFC-0029 Standard |
| :--- | :--- | :--- | :--- |
| **Logged Session Steps** | **23,703 steps** (`transcript_full.jsonl`: 54.5 MB) | Erased after 2 tool iterations | 100+ steps per task run |
| **Steps Between Compactions** | **5,400+ steps** | **2 iterations** | Adaptive (75% context threshold) |
| **Active Context Window** | **1,000,000 to 2,000,000 tokens** | **128,000 tokens** | **1,000,000 tokens** |
| **Tool Result Pruning** | Byte-offset truncation only for >50k chunks | Overwrites text after iteration 2 | Preserves 20–50 iterations in RAM |
| **Max Output Tokens** | **65,536 – 131,072 tokens** | **8,192 tokens** | **65,536 – 131,072 tokens** |

---

## 3. Required Architectural Changes

### A. Context Compaction Strategy Modernization
* In `compact_tool_result.py`, raise the default `keep_iterations` from `2` to `20` (or `keep_user_rounds=10`).
* In `middleware.py`, ensure `ToolResultCompaction` strictly respects `TokenThresholdTrigger(threshold=0.75)`. Tool results must remain **100% unabridged** while context usage is below 75% of `max_context_tokens` (750k tokens on a 1M model).

### B. Dynamic Model Context Inheritance
* Update `AgentConfigBase` to dynamically inherit `max_context_tokens` from the selected model registry rather than falling back to a static `128000`.
* Default `max_context_tokens` for 2026 frontier models (Gemini 2.5/3.8, DeepSeek-V4, Qwen 3.8, GLM-5.3, Muse Spark 1.3) must be set to `1000000`.

### C. De-escalate Reminder Middleware Warnings
* In `round_and_token_reminder.py`, modify `_build_token_limit_hint` so panic warnings are only emitted when remaining tokens are genuinely critical:
  ```python
  warning_threshold = min(15000, int(max_tokens * 0.10)) if max_tokens > 0 else 15000
  ```

### D. Native Reasoning & Thinking Protocol Alignment
* In `llm_caller.py`:
  1. For `gemini_rest`: Always inject `"includeThoughts": True` into `generationConfig.thinkingConfig` whenever `thinkingBudget > 0`.
  2. For `openai_chat_completion`: Normalize `delta.reasoning_content` (DeepSeek-V4, Qwen 3.8, GLM-5.3, Grok-4.6) directly into `ThinkingTextMessageContentEvent`.
  3. Decouple `max_tokens` (`maxOutputTokens`) to a default of `65536` so thinking deliberation does not cannibalize visible answer space.

---

## 4. Impact & Verification

Applying these adjustments in `nexau_ui_backend/main.py`:
1. Completely resolves the "hollow answer" defect: agents maintain persistent visibility across 20+ file reads, grep searches, and terminal executions.
2. Unlocks live thinking streams (3,000+ tokens of step-by-step reasoning per tool step).
3. Eliminates false "token limit approaching" interruptions during multi-turn tasks.
