# Copyright (c) Nex-AGI. All rights reserved.
"""Full end-to-end multi-turn diagnostic probe for NexAU Agent.

Tests:
1. Exact system prompt rendering and XML sections.
2. Turn 1 live LLM tool call (create an audit calculation spreadsheet).
3. Tool execution in local sandbox.
4. Turn 2 follow-up user prompt with context accumulation.
5. Tool execution in Turn 2 (read_file on the created spreadsheet).
6. SQLite database inspection (~/.nexau/nexau.db) for session and action rows.
"""

import os
import sys
import json
import sqlite3
from pathlib import Path

# Force UTF-8 output
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from nexau_ui_backend.main import _build_agent_config
from nexau.archs.main_sub.agent import Agent
from nexau.archs.main_sub.prompt_builder import PromptBuilder
from nexau.archs.platform.path_helpers import get_database_path, get_session_brain_dir

print("="*90)
print("             NEXAU COMPREHENSIVE END-TO-END MULTI-TURN DIAGNOSTIC PROBE")
print("="*90)

# Step 1: Initialize Agent Config & Render System Prompt
print("\n[STEP 1] INITIALIZING AGENT CONFIG & RENDERING SYSTEM PROMPT")
config = _build_agent_config()
pb = PromptBuilder()
system_prompt_parts = pb.build_system_prompt(config)
full_system_prompt = "\n".join(p.text for p in system_prompt_parts)

print(f"Total System Prompt Length: {len(full_system_prompt)} characters / ~{len(full_system_prompt)//4} tokens")
print("Verifying XML Sections Present in Prompt:")
expected_sections = [
    "<identity>", "<user_information>", "<capabilities>", "<subagents>",
    "<tool_rules>", "<data_stack_rules>", "<conversation_transcript>",
    "<artifacts>", "<planning_mode>", "<guidelines>", "<communication_style>"
]
for sec in expected_sections:
    present = sec in full_system_prompt
    print(f"  {'✓' if present else '❌'} {sec:<25} Present: {present}")

# Step 2: Instantiate Live Agent
print("\n[STEP 2] INSTANTIATING LIVE AGENT ENGINE")
agent = Agent(config=config)
print(f"Agent Name: {agent.config.name}")
print(f"Active Tools Count: {len(agent.config.tools)}")
print(f"Active Tool Names: {[t.name for t in agent.config.tools]}")
print(f"Active Subagents: {list(agent.config.sub_agents.keys()) if agent.config.sub_agents else 'None'}")
print(f"Sandbox Work Dir: {agent.sandbox_manager.work_dir}")

# Step 3: Turn 1 - Dispatching First Task (Spreadsheet Creation + Validation)
print("\n[STEP 3] TURN 1: DISPATCHING FIRST TASK TO LIVE GEMINI LLM")
t1_prompt = (
    "Please create an Excel spreadsheet at 'audit_working_papers/diagnostic_test.xlsx' "
    "with a sheet named 'Summary' containing: "
    "Row 1: Header ('Line Item', 'Amount_USD'), "
    "Row 2: ('Revenue', 500000), "
    "Row 3: ('COGS', 300000), "
    "Row 4: ('Gross_Profit', '=B2-B3'). "
    "Then run excel_tool validate on it to confirm formula integrity."
)
print(f"User Input Turn 1:\n  \"{t1_prompt}\"\n")
print(">>> Sending Turn 1 to Agent...")
t1_resp = agent.run(message=t1_prompt)
print("\n--- TURN 1 AGENT RESPONSE ---")
print(t1_resp)

# Step 4: Verify Workspace Disk Artifact
print("\n[STEP 4] VERIFYING PHYSICAL DISK ARTIFACT CREATED IN WORKSPACE")
created_file = Path("audit_working_papers/diagnostic_test.xlsx")
if created_file.exists():
    print(f"  ✓ SUCCESS: File exists on disk at '{created_file}' (Size: {created_file.stat().st_size} bytes)")
else:
    print(f"  ❌ File not found at '{created_file}'")

# Step 5: Turn 2 - Follow-up Request Testing Context Continuity
print("\n[STEP 5] TURN 2: FOLLOW-UP PROMPT (TESTING CONTEXT MEMORY & READ_FILE)")
t2_prompt = "Now use read_file to inspect 'audit_working_papers/diagnostic_test.xlsx' and report the exact Gross Profit formula and calculated amount."
print(f"User Input Turn 2:\n  \"{t2_prompt}\"\n")
print(">>> Sending Turn 2 to Agent...")
t2_resp = agent.run(message=t2_prompt)
print("\n--- TURN 2 AGENT RESPONSE ---")
print(t2_resp)

# Step 6: Query SQLite Database & Inspect Audit Logs
print("\n[STEP 6] INSPECTING BACKEND SQLITE PERSISTENCE LAYER (~/.nexau/nexau.db)")
db_path = get_database_path()
print(f"Database Path: {db_path} (Exists: {db_path.exists()})")

if db_path.exists():
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()
    
    # Check tables
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [r[0] for r in cursor.fetchall()]
    print(f"Total SQLite Tables in nexau.db: {len(tables)} -> {tables}")
    
    # Query sessions table
    cursor.execute("SELECT session_id, root_agent_id, updated_at FROM sessions ORDER BY updated_at DESC LIMIT 5")
    sessions = cursor.fetchall()
    print(f"\nRecent Sessions (Count: {len(sessions)}):")
    for s in sessions:
        print(f"  - Session ID: {s[0]} | Root Agent: {s[1]} | Updated: {s[2]}")
        
    # Query agent_run_actions table
    cursor.execute("SELECT action_id, session_id, action_type, agent_name, created_at_ns FROM agent_run_actions ORDER BY action_id DESC LIMIT 10")
    actions = cursor.fetchall()
    print(f"\nRecent Agent Run Actions (Count: {len(actions)}):")
    for a in actions:
        print(f"  - Action ID: {a[0]} | Session: {a[1][:8]}... | Type: {a[2]} | Agent: {a[3]} | Timestamp (ns): {a[4]}")
        
    conn.close()

print("\n" + "="*90)
print("                         DIAGNOSTIC PROBE COMPLETE")
print("="*90)
