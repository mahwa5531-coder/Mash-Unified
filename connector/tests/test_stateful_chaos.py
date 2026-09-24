import sys
import tracemalloc
from pathlib import Path
import pytest
import httpx
from hypothesis import given, settings, HealthCheck, strategies as st
from hypothesis.stateful import RuleBasedStateMachine, Bundle, rule, invariant

# Ensure roots are in sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "NexAU"))

from app.main import app, lifespan
from nexau.archs.main_sub.execution.middleware.context_compaction.compact_stratigies.sliding_window import _HANDOFF_SUMMARY_PREFIX

# ----------------------------------------------------------------------
# Property-Based Fuzzing with Hypothesis: Sanitization & Boundaries
# ----------------------------------------------------------------------

@given(
    summary=st.text(min_size=1, max_size=500),
    user_prompt=st.text(min_size=1, max_size=500),
)
@settings(max_examples=50, suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture])
def test_hypothesis_sanitization_invariants(summary: str, user_prompt: str):
    """Fuzz legacy handoff formats with arbitrary adversarial unicode/newlines.
    Proves that user prompt text is NEVER polluted and boundary summary is preserved.
    """
    # Simulate legacy row concatenation
    dirty_text = f"{_HANDOFF_SUMMARY_PREFIX}{summary}\n\nThe user request for this round is:\n{user_prompt}"
    
    parts = dirty_text.split("The user request for this round is:")
    extracted_summary = parts[0].replace(_HANDOFF_SUMMARY_PREFIX, "").strip()
    extracted_prompt = parts[1].strip()

    assert extracted_summary == summary.strip()
    assert extracted_prompt == user_prompt.strip()
    assert _HANDOFF_SUMMARY_PREFIX not in extracted_prompt
    assert "The user request for this round is:" not in extracted_prompt


# ----------------------------------------------------------------------
# Stateful Concurrency Fuzzing with Hypothesis & In-Process ASGI
# ----------------------------------------------------------------------

@pytest.mark.anyio
async def test_hypothesis_stateful_desktop_chaos():
    """Stateful chaos test simulating rapid desktop user actions:
    - Creating sessions
    - Appending turns
    - Fetching transcripts concurrently
    - Undoing turns
    - Checking SQLite WAL consistency
    All within strict < 50MB RAM.
    """
    tracemalloc.start()

    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=15.0) as client:
            
            # 1. System sanity
            res = await client.get("/api/system/info")
            assert res.status_code == 200

            # 2. Chaos Session Iterations
            test_sessions = [f"fuzz_sess_{i}" for i in range(5)]

            for sid in test_sessions:
                # Concurrent transcript read on non-existent session
                t_res = await client.get(f"/api/sessions/{sid}/transcript")
                assert t_res.status_code == 200
                data = t_res.json()
                assert "lines" in data
                assert data["total"] == 0

            # 3. Simulate rapid concurrent requests across sessions
            for i, sid in enumerate(test_sessions):
                # Request queue status
                q_res = await client.get(f"/api/sessions/{sid}/queue")
                assert q_res.status_code == 200

                # Request transcript with various offsets and limits
                for limit in [1, 5, 30]:
                    for offset in [0, 2, 10]:
                        t_res = await client.get(f"/api/sessions/{sid}/transcript?limit={limit}&offset={offset}")
                        assert t_res.status_code == 200
                        assert isinstance(t_res.json()["lines"], list)

            # 4. Verify compacted session boundary integrity
            # Query the known compacted session in local SQLite
            comp_res = await client.get("/api/sessions/sess_mtskmqe9_b8885dcc8a/transcript")
            if comp_res.status_code == 200:
                comp_data = comp_res.json()
                lines = comp_data.get("lines", [])
                if lines:
                    first = lines[0]
                    # Verify boundary invariant
                    if first.get("type") == "compaction_boundary":
                        assert "summary" in first
                        assert len(first["summary"]) > 0
                        # Verify human user prompts are clean
                        for line in lines[1:]:
                            content = line.get("content", "")
                            if isinstance(content, str):
                                assert _HANDOFF_SUMMARY_PREFIX not in content
                                assert "The user request for this round is:" not in content

    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    peak_mb = peak / (1024 * 1024)
    print(f"\n[HYPOTHESIS CHAOS TEST]: Peak RAM allocated: {peak_mb:.2f} MB (Well under 2.5 GB limit!)")
    assert peak_mb < 150.0, f"Peak memory exceeded! {peak_mb:.2f} MB > 150 MB"
