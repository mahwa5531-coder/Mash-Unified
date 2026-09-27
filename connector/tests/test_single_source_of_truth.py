"""Self-check verification for single source of truth in LLM config & context window propagation."""

import os
from pathlib import Path
import pytest

from nexau import AgentConfig, Agent
from nexau.archs.main_sub.utils.common import load_yaml_text_with_vars
from nexau.archs.main_sub.execution.middleware.context_compaction import ContextCompactionMiddleware
from nexau.archs.main_sub.execution.middleware.round_and_token_reminder import RoundAndTokenReminderMiddleware


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
    manifest_path = Path(__file__).resolve().parent.parent.parent / "NexAU" / "nexau" / "agents" / "main_agent.yaml"
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
    manifest_path = Path(__file__).resolve().parent.parent.parent / "NexAU" / "nexau" / "agents" / "main_agent.yaml"
    cfg = AgentConfig.from_yaml(manifest_path)
    cfg.max_context_tokens = 256000

    agent = Agent(config=cfg)

    compaction_mw = next(m for m in agent.executor.middleware_manager.middlewares if isinstance(m, ContextCompactionMiddleware))
    reminder_mw = next(m for m in agent.executor.middleware_manager.middlewares if isinstance(m, RoundAndTokenReminderMiddleware))

    assert compaction_mw.max_context_tokens == 256000
    assert reminder_mw.max_context_tokens == 256000
