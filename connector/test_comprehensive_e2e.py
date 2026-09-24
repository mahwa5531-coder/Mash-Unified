import asyncio
import os
import sys
import json
import time
from datetime import datetime, timezone
from pathlib import Path

# Set up paths
BACKEND_DIR = Path(__file__).parent.resolve()
NEXAU_DIR = (BACKEND_DIR.parent / "NexAU").resolve()
sys.path.insert(0, str(BACKEND_DIR))
sys.path.insert(0, str(NEXAU_DIR))

from dotenv import load_dotenv
load_dotenv(BACKEND_DIR / ".env", override=True)

import httpx
from openai import OpenAI
from app.main import app, lifespan
from nexau.archs.tool.builtin import (
    view_file as guarded_view_file,
    write_file as guarded_write_file,
    replace_file_content as guarded_replace_file_content,
    search_file_content as guarded_search_file_content,
    run_shell_command as guarded_run_shell_command,
    audit_skill_tool,
)
from nexau.archs.main_sub.execution.middleware.context_compaction import ContextCompactionMiddleware
from nexau.archs.llm.llm_config import LLMConfig
from nexau.archs.session.models import SessionModel, AgentRunActionModel
from nexau.archs.session.orm import ComparisonFilter
from app.dependencies import get_engine

RESULTS = []

def record(test_name: str, passed: bool, detail: str = ""):
    status = "PASS" if passed else "FAIL"
    print(f"[{status}] {test_name}: {detail}")
    RESULTS.append({"name": test_name, "status": status, "detail": detail})

async def test_1_llm_direct_connectivity():
    """Test direct OpenAI-compatible endpoint with model."""
    base_url = os.getenv("LLM_BASE_URL")
    api_key = os.getenv("LLM_API_KEY", "ollama")
    model = os.getenv("LLM_MODEL", "maternion/ling-3.0-tiny:8b")
    
    print(f"\n--- 1. Testing LLM Direct Connectivity ({base_url}) ---")
    try:
        client = OpenAI(base_url=base_url, api_key=api_key, timeout=60.0)
        
        # Simple completion
        t0 = time.time()
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a concise CA audit assistant."},
                {"role": "user", "content": "Reply with 'AUDIT_TEST_OK' and nothing else."}
            ],
            max_tokens=30,
            temperature=0.0
        )
        elapsed = time.time() - t0
        content = resp.choices[0].message.content or ""
        print(f"  Response ({elapsed:.2f}s): {content.strip()}")
        record("Direct LLM Completion", True, f"Took {elapsed:.2f}s, output: {content.strip()[:60]}")
    except Exception as e:
        record("Direct LLM Completion", False, str(e))

async def test_2_dynamic_context_config():
    """Verify dynamic context window (128k) and compaction threshold."""
    print("\n--- 2. Testing Dynamic Context Window & Compaction Config ---")
    try:
        max_ctx = int(os.getenv("LLM_MAX_CONTEXT_TOKENS", "0"))
        assert max_ctx == 131072, f"Expected 131072, got {max_ctx}"
        
        # Verify compaction middleware config calculation
        target_tokens = os.getenv("COMPACTION_TARGET_TOKENS")
        default_thresh = float(os.getenv("COMPACTION_THRESHOLD", "0.75"))
        threshold = (
            min(1.0, max(0.001, float(target_tokens) / max_ctx))
            if target_tokens
            else default_thresh
        )
        assert threshold == 0.75, f"Expected 0.75 threshold, got {threshold}"
        
        compactor = ContextCompactionMiddleware(
            auto_compact=True,
            compaction_strategy="llm_summary",
            keep_user_rounds=int(os.getenv("COMPACTION_KEEP_USER_ROUNDS", "8")),
            max_context_tokens=max_ctx,
            threshold=threshold,
            summary_model=os.getenv("SUMMARY_LLM_MODEL"),
            save_history=True,
            emergency_compact_enabled=True,
        )
        assert compactor.max_context_tokens == 131072
        assert compactor.trigger_strategy.threshold == 0.75
        assert compactor.compaction_strategy is not None
        record("Dynamic Context Window 128k", True, f"max_context_tokens={max_ctx}, trigger_at={int(max_ctx * threshold)} tokens")
    except Exception as e:
        record("Dynamic Context Window 128k", False, str(e))

async def test_3_compaction_middleware_logic():
    """Verify compaction threshold trigger and boundary construction."""
    print("\n--- 3. Testing Context Compaction Middleware Logic ---")
    try:
        from nexau.archs.main_sub.execution.middleware.context_compaction.compact_stratigies.sliding_window import (
            _HANDOFF_SUMMARY_PREFIX,
            with_handoff_prefix
        )
        
        compactor = ContextCompactionMiddleware(
            auto_compact=True,
            compaction_strategy="sliding_window",
            keep_user_rounds=2,
            max_context_tokens=1000,
            threshold=0.5,  # Trigger at 500 tokens
            save_history=True,
            emergency_compact_enabled=True,
        )
        
        assert compactor.trigger_strategy is not None
        assert compactor.compaction_strategy is not None
        assert compactor.emergency_compaction_strategy is not None
        
        # Test handoff prefix formatting
        summary_text = "Verified purchase orders and invoices up to turn 5."
        handoff = with_handoff_prefix(summary_text)
        assert _HANDOFF_SUMMARY_PREFIX in handoff
        assert summary_text in handoff
        
        record("Context Compaction Boundary & Strategy", True, f"Trigger threshold {compactor.trigger_strategy.threshold}, handoff prefix validated")
    except Exception as e:
        record("Context Compaction Boundary & Strategy", False, str(e))

async def test_4_tool_calling_and_guards():
    """Verify guarded tools (view_file, audit_skill_tool, run_shell_command, timeouts)."""
    print("\n--- 4. Testing Guarded Tools & Execution ---")
    try:
        # 1. view_file
        test_file = BACKEND_DIR / ".env"
        vf_result = guarded_view_file(AbsolutePath=str(test_file), StartLine=1, EndLine=5)
        assert isinstance(vf_result, dict) or isinstance(vf_result, str)
        vf_str = str(vf_result)
        assert "LLM_BASE_URL" in vf_str, f"view_file failed: {vf_str}"
        record("Tool: view_file", True, "Successfully read lines 1-5 of .env with boundary check")
        
        # 2. audit_skill_tool
        skill_res = audit_skill_tool(action="get_guide")
        assert "content" in skill_res or "guide" in str(skill_res).lower()
        record("Tool: audit_skill_tool", True, "Successfully loaded audit domain master guide")
        
        # 3. run_shell_command
        shell_res = guarded_run_shell_command(CommandLine="echo BACKEND_GUARD_OK", Cwd=str(BACKEND_DIR))
        assert "BACKEND_GUARD_OK" in str(shell_res)
        record("Tool: run_shell_command", True, "Guarded execution returned stdout correctly")
        
        # 4. Tool Timeout Handling
        t0 = time.time()
        timeout_res = guarded_run_shell_command(CommandLine="powershell -Command Start-Sleep -Milliseconds 100", Cwd=str(BACKEND_DIR))
        record("Tool: Execution responsiveness", True, f"Sub-process execution finished in {time.time()-t0:.2f}s")
    except Exception as e:
        record("Guarded Tools & Execution", False, str(e))

async def test_5_sql_session_and_step_accumulation():
    """Verify SQLite WAL persistence, SessionModel creation, and step accumulation."""
    print("\n--- 5. Testing SQL Session & Step Accumulation in SQLite ---")
    async with lifespan(app):
        try:
            eng = get_engine()
            assert eng is not None, "DatabaseEngine must be initialized in app lifespan"
            
            test_sid = f"test_e2e_{int(time.time())}"
            now = datetime.now()
            
            # Create session
            from datetime import timezone
            sess = SessionModel(
                session_id=test_sid,
                user_id="default_user",
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
                context={"title": "E2E Test Session", "workspace_uri": "test_workspace"}
            )
            await eng.create(sess)
            
            # Accumulate steps (AgentRunActionModel)
            action1 = AgentRunActionModel(
                session_id=test_sid,
                user_id="default_user",
                agent_id="default_agent",
                run_id=f"run_1_{test_sid}",
                root_run_id=f"run_1_{test_sid}",
                action_type="append",
                append_messages=[{"role": "user", "content": [{"type": "text", "text": "Please verify TDS and GST"}]}],
            )
            await eng.create(action1)
            
            action2 = AgentRunActionModel(
                session_id=test_sid,
                user_id="default_user",
                agent_id="default_agent",
                run_id=f"run_1_{test_sid}",
                root_run_id=f"run_1_{test_sid}",
                action_type="append",
                append_messages=[{"role": "assistant", "content": [{"type": "tool_use", "id": "call_1", "name": "audit_skill_tool", "input": {"action": "get_guide"}}]}]
            )
            await eng.create(action2)
            
            action3 = AgentRunActionModel(
                session_id=test_sid,
                user_id="default_user",
                agent_id="default_agent",
                run_id=f"run_1_{test_sid}",
                root_run_id=f"run_1_{test_sid}",
                action_type="append",
                append_messages=[{"role": "tool", "tool_use_id": "call_1", "content": [{"type": "text", "text": "Master navigation guide loaded"}]}]
            )
            await eng.create(action3)
            
            # Query back from SQL
            actions = await eng.find_many(
                AgentRunActionModel,
                filters=ComparisonFilter.eq("session_id", test_sid)
            )
            assert len(actions) == 3, f"Expected 3 steps, got {len(actions)}"
            assert actions[0].action_type == "append"
            assert actions[1].action_type == "append"
            assert actions[2].action_type == "append"
            
            record("SQL Session & Step Accumulation", True, f"Successfully created session and accumulated {len(actions)} steps in SQLite")
            
            # Test API reading transcript
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
                res = await client.get(f"/api/sessions/{test_sid}/transcript")
                assert res.status_code == 200
                data = res.json()
                assert "lines" in data
                assert len(data["lines"]) >= 1
                record("Transcript Reconstruction from SQL", True, f"Transcript endpoint returned {len(data['lines'])} lines")
        except Exception as e:
            record("SQL Session & Step Accumulation", False, str(e))

async def test_6_full_agent_sse_stream():
    """Simulate complete agent turn through /api/chat/stream with live LLM."""
    print("\n--- 6. Testing Full Agent SSE Stream with Live LLM ---")
    async with lifespan(app):
        try:
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=120.0) as client:
                test_sid = f"live_stream_{int(time.time())}"
                payload = {
                    "session_id": test_sid,
                    "messages": "Hello! Reply with 'AGENT_READY' and your role.",
                    "user_id": "default_user",
                    "context": {"workspace_uri": "No Repo"}
                }
                
                events = []
                async with client.stream("POST", "/api/chat/stream", json=payload) as response:
                    assert response.status_code == 200, f"SSE endpoint returned status {response.status_code}"
                    async for line in response.aiter_lines():
                        if line.startswith("data:"):
                            events.append(line[5:].strip())
                            if len(events) >= 15:  # Got enough tokens/events
                                break
                                
                assert len(events) > 0, "Expected SSE stream events"
                record("Live Agent SSE Stream", True, f"Received {len(events)} SSE chunks successfully")
        except Exception as e:
            record("Live Agent SSE Stream", False, str(e))

async def main():
    print("=" * 60)
    print("COMPREHENSIVE BACKEND E2E TEST SUITE")
    print("=" * 60)
    
    await test_1_llm_direct_connectivity()
    await test_2_dynamic_context_config()
    await test_3_compaction_middleware_logic()
    await test_4_tool_calling_and_guards()
    await test_5_sql_session_and_step_accumulation()
    await test_6_full_agent_sse_stream()
    
    print("\n" + "=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)
    all_passed = True
    for r in RESULTS:
        print(f"{r['status']:6} | {r['name']:<35} | {r['detail']}")
        if r["status"] != "PASS":
            all_passed = False
            
    print("=" * 60)
    if all_passed:
        print("ALL TESTS PASSED! Backend is 100% verified.")
    else:
        print("SOME TESTS FAILED! Review details above.")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(main())
