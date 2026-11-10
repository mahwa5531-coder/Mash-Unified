"""Self-check verification for single source of truth in LLM config & context window propagation."""

from pathlib import Path

from nexau.archs.main_sub.execution.middleware.context_compaction import (
    ContextCompactionMiddleware,
)
from nexau.archs.main_sub.execution.middleware.round_and_token_reminder import (
    RoundAndTokenReminderMiddleware,
)
from nexau.archs.main_sub.utils.common import load_yaml_text_with_vars

from nexau import Agent, AgentConfig


def test_yaml_env_fallback_resolution():
    """Verify load_yaml_text_with_vars supports ${env.VAR:-default} fallback."""
    raw_yaml = """
    model: ${env.NON_EXISTENT_TEST_MODEL:-fallback/model-v1}
    max_tokens: ${env.NON_EXISTENT_TEST_TOKENS:-65536}
    """
    parsed = load_yaml_text_with_vars(raw_yaml, base_dir=Path("."))
    assert parsed["model"] == "fallback/model-v1"
    assert parsed["max_tokens"] == 65536


def test_yaml_env_override_resolution(monkeypatch):
    """Verify load_yaml_text_with_vars uses env variable over default."""
    monkeypatch.setenv("TEST_OVERRIDE_MODEL", "custom/fast-model")
    raw_yaml = """
    model: ${env.TEST_OVERRIDE_MODEL:-fallback/model-v1}
    """
    parsed = load_yaml_text_with_vars(raw_yaml, base_dir=Path("."))
    assert parsed["model"] == "custom/fast-model"


def test_main_agent_context_propagation():
    """Verify main_agent.yaml propagates single context window to all middlewares."""
    manifest_path = Path(__file__).resolve().parent.parent / "app" / "resources" / "main_agent.yaml"
    cfg = AgentConfig.from_yaml(manifest_path)

    # Context limit is cleanly parsed
    assert cfg.max_context_tokens > 0

    # Instantiate Agent and verify middlewares dynamically inherit the limit
    agent = Agent(config=cfg)

    compaction_mw = next(m for m in agent.executor.middleware_manager.middlewares if isinstance(m, ContextCompactionMiddleware))
    reminder_mw = next(m for m in agent.executor.middleware_manager.middlewares if isinstance(m, RoundAndTokenReminderMiddleware))

    assert compaction_mw.max_context_tokens == cfg.max_context_tokens
    assert reminder_mw.max_context_tokens == cfg.max_context_tokens


def test_dynamic_context_window_override():
    """Verify updating max_context_tokens on AgentConfig propagates to all middlewares."""
    manifest_path = Path(__file__).resolve().parent.parent / "app" / "resources" / "main_agent.yaml"
    cfg = AgentConfig.from_yaml(manifest_path)
    cfg.max_context_tokens = 256000

    agent = Agent(config=cfg)

    compaction_mw = next(m for m in agent.executor.middleware_manager.middlewares if isinstance(m, ContextCompactionMiddleware))
    reminder_mw = next(m for m in agent.executor.middleware_manager.middlewares if isinstance(m, RoundAndTokenReminderMiddleware))

    assert compaction_mw.max_context_tokens == 256000
    assert reminder_mw.max_context_tokens == 256000


def test_main_agent_compactable_tools_and_micro_compact():
    """Verify compactable_tools and trigger threshold from main_agent.yaml protect mutations and compact observations."""
    from nexau.core.messages import Message, Role, TextBlock, ToolResultBlock, ToolUseBlock

    manifest_path = Path(__file__).resolve().parent.parent / "app" / "resources" / "main_agent.yaml"
    cfg = AgentConfig.from_yaml(manifest_path)
    agent = Agent(config=cfg)

    compaction_mw = next(m for m in agent.executor.middleware_manager.middlewares if isinstance(m, ContextCompactionMiddleware))
    strategy = compaction_mw.compaction_strategy
    trigger = compaction_mw.trigger_strategy

    # 1. Verify compactable_tools filter
    expected_compactable = {"audit_skill_tool", "search_file_content", "run_shell_command", "view_file", "web_search"}
    assert strategy.compactable_tools == frozenset(expected_compactable)
    assert "write_file" not in strategy.compactable_tools
    assert "replace_file_content" not in strategy.compactable_tools

    # 2. Verify trigger threshold is 0.75 (protects full 1M context, does NOT trigger on 17.6k tokens)
    assert trigger.threshold == 0.75
    should_compact, _ = trigger.should_compact([], current_tokens=17664, max_context_tokens=cfg.max_context_tokens)
    assert should_compact is False  # Preserves full 1M headroom without truncating context early
    # Triggers only when context truly approaches 75% limit (786k tokens)
    should_compact_75, reason = trigger.should_compact([], current_tokens=800000, max_context_tokens=cfg.max_context_tokens)
    assert should_compact_75 is True

    # 3. Verify execution: old audit_skill_tool gets compacted, but old write_file is preserved!
    messages = [
        Message(role=Role.SYSTEM, content=[TextBlock(text="System prompt")]),
        # Iteration 1 (old): calls audit_skill_tool and write_file
        Message(role=Role.USER, content=[TextBlock(text="Do statutory audit")]),
        Message(
            role=Role.ASSISTANT,
            content=[
                TextBlock(text="Invoking audit skill"),
                ToolUseBlock(id="call_skill", name="audit_skill_tool", input={}),
                ToolUseBlock(id="call_write", name="write_file", input={"path": "audit_memo.md", "content": "Memo text"}),
            ],
        ),
        Message(
            role=Role.TOOL,
            content=[
                ToolResultBlock(tool_use_id="call_skill", content="Statutory Audit Skill 6700 chars...", is_error=False),
                ToolResultBlock(tool_use_id="call_write", content="Successfully wrote audit_memo.md", is_error=False),
            ],
        ),
        # Iterations 2, 3, 4 (recent, protected by keep_iterations=3)
        Message(role=Role.USER, content=[TextBlock(text="Check balances")]),
        Message(
            role=Role.ASSISTANT,
            content=[
                ToolUseBlock(id="call_v1", name="view_file", input={"path": "ledger.xlsx"}),
            ],
        ),
        Message(role=Role.TOOL, content=[ToolResultBlock(tool_use_id="call_v1", content="ledger line 1", is_error=False)]),
        Message(role=Role.USER, content=[TextBlock(text="Check vouchers")]),
        Message(
            role=Role.ASSISTANT,
            content=[
                ToolUseBlock(id="call_v2", name="view_file", input={"path": "voucher.pdf"}),
            ],
        ),
        Message(role=Role.TOOL, content=[ToolResultBlock(tool_use_id="call_v2", content="voucher line 1", is_error=False)]),
        Message(role=Role.USER, content=[TextBlock(text="Synthesize findings")]),
        Message(
            role=Role.ASSISTANT,
            content=[
                ToolUseBlock(id="call_v3", name="view_file", input={"path": "notes.txt"}),
            ],
        ),
        Message(role=Role.TOOL, content=[ToolResultBlock(tool_use_id="call_v3", content="notes line 1", is_error=False)]),
    ]

    compacted = strategy.compact(messages)

    # Helper to find tool result block
    def get_result(msgs, tid):
        for m in msgs:
            if m.role == Role.TOOL:
                for b in m.content:
                    if isinstance(b, ToolResultBlock) and b.tool_use_id == tid:
                        return b
        return None

    # audit_skill_tool (old, compactable) -> compacted!
    assert get_result(compacted, "call_skill").content == "Tool call result has been compacted"

    # write_file (old, mutation) -> PRESERVED!
    assert get_result(compacted, "call_write").content == "Successfully wrote audit_memo.md"

    # Recent view_file calls (iterations 2, 3, 4) -> PRESERVED by keep_iterations=3!
    assert get_result(compacted, "call_v1").content == "ledger line 1"
    assert get_result(compacted, "call_v2").content == "voucher line 1"
    assert get_result(compacted, "call_v3").content == "notes line 1"

