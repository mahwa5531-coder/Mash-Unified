"""
Agent Production Readiness & Safeguards Verification Test Suite.
Deep evaluation of the 7 core agent pillars:
1. Runtime Context Scaffolding & Dynamic Grounding
2. Jinja System Prompt Rendering & Variable Interpolation
3. Tool YAML Schema Compliance & Alias Normalization
4. Data Dumping & Token Flood Safeguards (view_file, csv/excel parquet, grep, shell)
5. Security Boundaries & Path Traversal / Binary Blocking
6. Deliverables Mutation, Diffing & Scratchpad Isolation
7. Process Lifecycle & Stop Cancellation Handshake
"""

import os
import sys
import yaml
import tempfile
import asyncio
from pathlib import Path
from jinja2 import Template

import pytest
import httpx
import polars as pl

# Ensure connector and NexAU are in sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "NexAU"))

from app.main import app, lifespan
from app.routers.chat import _ensure_project_and_context, resolve_sandbox_work_dir, resolve_deliverables_dir
from app.workspace import is_path_in_base_roots
from nexau.archs.sandbox.local_sandbox import LocalSandbox
from nexau.archs.main_sub.execution.middleware.long_tool_output import LongToolOutputMiddleware
from nexau.archs.main_sub.execution.hooks import AfterToolHookInput
from nexau.archs.tool.builtin import (
    view_file,
    write_file,
    replace_file_content,
    search_file_content,
    glob,
    list_directory,
    run_shell_command,
    audit_skill_tool,
)
from nexau.ingestion_pipeline.csv_to_md_parquet import parse_csv_to_markdown
from nexau.ingestion_pipeline.excel_to_md import parse_excel_to_markdown


class MockAgentState:
    def __init__(self, sandbox):
        self._sandbox = sandbox
    def get_sandbox(self):
        return self._sandbox


# ==============================================================================
# PILLAR 1: Runtime Context Scaffolding & Dynamic Grounding
# ==============================================================================
@pytest.mark.anyio
async def test_pillar_1_runtime_context_scaffolding():
    with tempfile.TemporaryDirectory(prefix="mash_p1_") as tmp_dir:
        tmp_path = str(Path(tmp_dir).resolve())
        sid = "sess_p1_test_001"
        user_id = "auditor_p1"
        resolved_context = {"workspace_uri": tmp_path}

        # Run context scaffolding
        await _ensure_project_and_context(None, user_id, sid, resolved_context, tmp_path)

        # 1. Verify required context keys
        assert "brain_directory" in resolved_context
        assert "scratch_directory" in resolved_context
        assert "cache_directory" in resolved_context
        assert "working_directory" in resolved_context
        assert resolved_context["working_directory"] == tmp_path

        # 2. Verify paths physically exist on disk
        assert Path(resolved_context["brain_directory"]).is_dir()
        assert Path(resolved_context["scratch_directory"]).is_dir()

        # 3. Verify deliverables directory resolves properly
        deliv_dir = resolve_deliverables_dir(tmp_path, resolved_context["brain_directory"])
        assert "Audit_Deliverables" in str(deliv_dir) or "working_papers" in str(deliv_dir)


# ==============================================================================
# PILLAR 2: Jinja System Prompt Rendering & Variable Interpolation
# ==============================================================================
def test_pillar_2_system_prompt_rendering():
    prompt_path = Path(__file__).parent.parent.parent / "NexAU" / "nexau" / "archs" / "main_sub" / "prompts" / "default_system_prompt.j2"
    assert prompt_path.exists(), "default_system_prompt.j2 must exist"

    template_str = prompt_path.read_text(encoding="utf-8")
    template = Template(template_str)

    context_vars = {
        "tools": [{"name": "view_file", "description": "Universal file viewer"}],
        "working_directory": r"C:\Projects\ClientAudit_2026",
        "outputs_directory": r"C:\Projects\ClientAudit_2026\Audit_Deliverables",
        "brain_directory": r"C:\Users\rama\.nexau\brain\sess_123",
        "scratch_directory": r"C:\Users\rama\.nexau\brain\sess_123\scratch",
        "session_id": "sess_123",
        "current_year": 2026,
    }

    rendered = template.render(**context_vars)

    # Invariants
    assert "Senior Chartered Accountant" in rendered or "Statutory Auditor" in rendered
    assert "C:\\Projects\\ClientAudit_2026" in rendered
    assert "Audit_Deliverables" in rendered
    assert "sess_123" in rendered
    assert "2026" in rendered
    assert "[VERIFIED]" in rendered
    assert "implementation_plan.md" in rendered


# ==============================================================================
# PILLAR 3: Tool YAML Schema Compliance & Alias Normalization
# ==============================================================================
def test_pillar_3_tool_schemas_and_aliases():
    schema_dir = Path(__file__).parent.parent.parent / "NexAU" / "nexau" / "archs" / "tool" / "builtin" / "schemas"
    required_tools = [
        "view_file.tool.yaml",
        "write_file.tool.yaml",
        "replace_file_content.tool.yaml",
        "search_file_content.tool.yaml",
        "glob.tool.yaml",
        "run_shell_command.tool.yaml",
        "audit_skill_tool.tool.yaml",
    ]

    for tool_file in required_tools:
        file_path = schema_dir / tool_file
        assert file_path.exists(), f"Schema {tool_file} missing!"
        data = yaml.safe_load(file_path.read_text(encoding="utf-8"))
        assert "name" in data
        assert "description" in data
        assert "input_schema" in data
        props = data["input_schema"].get("properties", {})

        # Verify cross-model alias redundancy
        if tool_file == "view_file.tool.yaml":
            assert "AbsolutePath" in props and "file_path" in props
            assert "StartLine" in props and "start_line" in props
        elif tool_file == "write_file.tool.yaml":
            assert "TargetFile" in props and "file_path" in props
            assert "CodeContent" in props and "content" in props
            assert "overwrite" in props and "Overwrite" in props
        elif tool_file == "replace_file_content.tool.yaml":
            assert "TargetFile" in props and "file_path" in props
            assert "StartLine" in props and "start_line" in props
            assert "TargetContent" in props and "old_string" in props


# ==============================================================================
# PILLAR 4: Data Dumping, Token Flood & Ingestion Safeguards
# ==============================================================================
def test_pillar_4_data_dumping_safeguards():
    with tempfile.TemporaryDirectory(prefix="mash_p4_") as tmp_dir:
        tmp_path = Path(tmp_dir)
        sandbox = LocalSandbox(work_dir=tmp_path)
        mock_state = MockAgentState(sandbox)

        # 1. view_file 100-line default windowing
        hundred_fifty_lines = "\n".join([f"Transaction #{i:05d}: $1,000.00" for i in range(1, 151)])
        ledger_file = tmp_path / "general_ledger.txt"
        ledger_file.write_text(hundred_fifty_lines, encoding="utf-8")

        v_res = view_file(AbsolutePath=str(ledger_file), sandbox=sandbox)
        assert "Transaction #00001" in v_res["content"]
        assert "Transaction #00100" in v_res["content"]
        assert "Transaction #00101" not in v_res["content"], "view_file must truncate at DEFAULT_WINDOW_SIZE (100 lines)!"
        assert "more lines below" in v_res["content"]

        # 2. CSV ingestion pipeline with > 100 rows auto-parquet
        csv_file = tmp_path / "large_transactions.csv"
        rows = ["Date,Account,Debit,Credit"] + [f"2026-03-31,1001,{i*10},0" for i in range(1, 150)]
        csv_file.write_text("\n".join(rows), encoding="utf-8")

        csv_md = parse_csv_to_markdown(str(csv_file), session_id="test_sess")
        assert ".parquet" in csv_md, "CSV with > 100 rows must be exported to Parquet cache!"
        assert "Sample Preview (First 5 Rows)" in csv_md
        assert "149 rows" in csv_md

        # 3. search_file_content 50-match hard ceiling
        grep_res = search_file_content(pattern="Transaction", path=str(tmp_path), sandbox=sandbox)
        assert "(results limited to 50 matches" in grep_res["content"]

        # 4. LongToolOutputMiddleware generic interception
        middleware = LongToolOutputMiddleware(
            max_output_chars=400,
            head_chars=150,
            tail_chars=150,
            head_lines=5,
            tail_lines=5,
            temp_dir=None,
        )
        fake_massive = "Header Info\n" + ("VERY LONG REPETITIVE LEDGER OUTPUT ROW\n" * 50) + "Footer Info"
        hook_in = AfterToolHookInput(
            tool_name="test_tool",
            tool_call_id="call_99",
            tool_input={},
            tool_output=fake_massive,
            agent_state=mock_state,
            sandbox=sandbox,
        )
        hook_out = middleware.after_tool(hook_in)
        assert len(hook_out.tool_output) < len(fake_massive)
        assert "truncated" in hook_out.tool_output.lower()


# ==============================================================================
# PILLAR 5: Security Boundaries & Path Traversal / Binary Blocking
# ==============================================================================
def test_pillar_5_security_and_sandbox_boundaries():
    with tempfile.TemporaryDirectory(prefix="mash_p5_") as tmp_dir:
        tmp_path = Path(tmp_dir)
        sandbox = LocalSandbox(work_dir=tmp_path)

        # 1. Path traversal attack check (outside allowed roots)
        traversal_path = Path("C:/Windows/System32/cmd.exe")
        is_safe = is_path_in_base_roots(traversal_path)
        assert is_safe is False, "Path traversal outside allowed roots must be rejected!"

        # 2. Binary file format rejection in view_file
        sqlite_file = tmp_path / "financial.sqlite"
        sqlite_file.write_bytes(b"SQLite format 3\x00")
        v_res = view_file(AbsolutePath=str(sqlite_file), sandbox=sandbox)
        assert v_res.get("isError") is True
        assert "is not supported" in v_res["content"]


# ==============================================================================
# PILLAR 6: Deliverables Mutation, Diffing & Scratchpad Isolation
# ==============================================================================
def test_pillar_6_deliverables_and_diffs():
    with tempfile.TemporaryDirectory(prefix="mash_p6_") as tmp_dir:
        tmp_path = Path(tmp_dir)
        sandbox = LocalSandbox(work_dir=tmp_path)

        target = tmp_path / "memo.md"
        w1 = write_file(
            TargetFile=str(target),
            CodeContent="# Memo Title\nInitial draft notes.\n",
            overwrite=True,
            sandbox=sandbox,
        )
        assert not w1.get("isError")
        assert "Successfully created" in w1["content"]
        # Invariant: prompt content must NOT dump the full text back
        assert "# Memo Title" not in w1["content"]

        # Overwrite safety guard
        w2 = write_file(
            TargetFile=str(target),
            CodeContent="# Malicious overwrite\n",
            overwrite=False,
            sandbox=sandbox,
        )
        assert w2.get("isError") or "already exists" in w2["content"], "overwrite: False must reject overwrite!"

        # Scoped replace_file_content with exact lines
        r1 = replace_file_content(
            TargetFile=str(target),
            TargetContent="Initial draft notes.",
            ReplacementContent="Verified statutory audit findings.",
            Instruction="Update draft notes to verified findings",
            StartLine=1,
            EndLine=3,
            sandbox=sandbox,
        )
        assert not r1.get("isError")
        final_text = target.read_text(encoding="utf-8")
        assert "Verified statutory audit findings." in final_text


# ==============================================================================
# PILLAR 7: Process Lifecycle & Cancellation Handshake
# ==============================================================================
@pytest.mark.anyio
async def test_pillar_7_process_lifecycle():
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=10.0) as client:
            # 1. Verify health
            h_res = await client.get("/api/health")
            assert h_res.status_code == 200

            # 2. Test stop request handling
            stop_res = await client.post("/api/chat/stop", json={"session_id": "test_sess_lifecycle", "user_id": "auditor_1"})
            assert stop_res.status_code == 200
            data = stop_res.json()
            assert data["status"] in ("ok", "success")
