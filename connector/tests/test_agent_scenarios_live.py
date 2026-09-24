import json
import sqlite3
import pathlib
import urllib.request
import time
import sys
import os

# Set UTF-8 encoding for stdout/stderr to avoid Windows cp932/cp1252 character crashes
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

BASE_URL = "http://127.0.0.1:8000"
DB_PATH = pathlib.Path.home() / ".nexau" / "database" / "nexau.db"
SANDBOX_DIR = pathlib.Path("C:/Users/rama/Downloads/Mash/scratch/sandbox")

def get_db_stats(session_id: str):
    if not DB_PATH.exists():
        return {"error": "Database not found"}
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    
    # Total actions
    cur.execute("SELECT COUNT(*) FROM agent_run_actions")
    total_actions = cur.fetchone()[0]
    
    # Session actions
    cur.execute("SELECT COUNT(*) FROM agent_run_actions WHERE session_id = ?", (session_id,))
    session_actions = cur.fetchone()[0]
    
    # Latest action types for this session
    cur.execute(
        "SELECT action_id, run_id, action_type, created_at, extra FROM agent_run_actions WHERE session_id = ? ORDER BY created_at_ns DESC LIMIT 5",
        (session_id,)
    )
    latest_rows = []
    for r in cur.fetchall():
        latest_rows.append({
            "action_id": r[0],
            "run_id": r[1],
            "action_type": r[2],
            "created_at": r[3],
            "extra": r[4]
        })
    
    # Total sessions
    cur.execute("SELECT COUNT(*) FROM sessions")
    total_sessions = cur.fetchone()[0]
    
    conn.close()
    return {
        "total_actions": total_actions,
        "session_actions": session_actions,
        "latest_rows": latest_rows,
        "total_sessions": total_sessions
    }

def print_db_snapshot(tag: str, session_id: str):
    stats = get_db_stats(session_id)
    print(f"\n[DB SNAPSHOT - {tag}]")
    print(f"  Sessions in DB: {stats.get('total_sessions')}")
    print(f"  Total Actions in DB: {stats.get('total_actions')}")
    print(f"  Actions for Session '{session_id}': {stats.get('session_actions')}")
    print("  Latest Action Records:")
    for r in stats.get("latest_rows", []):
        print(f"    - [{r['created_at']}] Run: {r['run_id']} | Type: {r['action_type']} | ID: {r['action_id']}")
    print("-" * 60)

def send_nlp_turn(session_id: str, prompt: str, timeout: int = 180):
    print(f"\n================================================================================")
    print(f">>> [SCENARIO NLP PROMPT] >>> Session: {session_id}")
    print(f"PROMPT: {prompt}")
    print(f"================================================================================")
    
    url = f"{BASE_URL}/stream"
    payload = json.dumps({
        "session_id": session_id,
        "messages": prompt,
        "context": {
            "working_directory": str(SANDBOX_DIR.resolve())
        }
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"}
    )

    full_text = ""
    thinking_text = ""
    tools_called = []
    t0 = time.time()

    with urllib.request.urlopen(req, timeout=timeout) as response:
        buffer = ""
        for chunk in response:
            line = chunk.decode("utf-8", errors="replace")
            buffer += line
            while "\n\n" in buffer:
                event_str, buffer = buffer.split("\n\n", 1)
                event_str = event_str.strip()
                if not event_str.startswith("data:"):
                    continue
                data_json = event_str[5:].strip()
                if not data_json:
                    continue
                try:
                    ev = json.loads(data_json)
                    ev_type = ev.get("type", "")
                    
                    if "THINKING" in ev_type:
                        delta = ev.get("delta", "")
                        thinking_text += delta
                        sys.stdout.write(f"\r[AGENT THINKING]: {len(thinking_text)} chars")
                        sys.stdout.flush()
                    elif "TOOL_CALL_START" in ev_type:
                        tname = ev.get("tool_call_name", "")
                        tid = ev.get("tool_call_id", "")
                        targs = ev.get("tool_call_arguments", "")
                        tools_called.append({"name": tname, "id": tid, "args": targs})
                        print(f"\n[TOOL START]: {tname} (ID: {tid})")
                        if targs:
                            print(f"  Args: {str(targs)[:200]}")
                    elif "TOOL_CALL_RESULT" in ev_type:
                        out = str(ev.get("content") or ev.get("output") or "")
                        print(f"[TOOL RESULT]: {out[:300]}...")
                    elif "TEXT_MESSAGE" in ev_type:
                        delta = ev.get("delta", "")
                        full_text += delta
                        sys.stdout.write(delta)
                        sys.stdout.flush()
                    elif "RUN_FINISHED" in ev_type:
                        print(f"\n[AGENT TURN FINISHED in {time.time()-t0:.2f}s]")
                except Exception as e:
                    pass

    print("\n---------------- AGENT FINAL ANSWER ----------------")
    print(full_text.strip())
    print("----------------------------------------------------\n")

    return {
        "prompt": prompt,
        "thinking_len": len(thinking_text),
        "tools_called": tools_called,
        "answer": full_text.strip(),
        "elapsed_sec": round(time.time() - t0, 2)
    }

def call_undo(session_id: str, from_turn: int = 1):
    print(f"\n>>> [TESTING SESSION UNDO / ROLLBACK] for Session: {session_id} from_turn={from_turn}")
    url = f"{BASE_URL}/sessions/{session_id}/undo"
    payload = json.dumps({"from_turn": from_turn}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="DELETE"
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read().decode("utf-8")
            print(f"Undo Response: {data}")
            return json.loads(data)
    except Exception as e:
        print(f"Undo Error: {e}")
        return {"error": str(e)}

def run_all_scenarios():
    session_id = f"auditor_session_{int(time.time())}"
    print(f"=== INITIATING LIVE NEXAU AGENT SCENARIO MATRIX ===")
    print(f"Target Session ID: {session_id}")
    print(f"Working Directory / Sandbox: {SANDBOX_DIR}")
    print(f"LLM Endpoint: {BASE_URL} -> qwen3.5:2b (256k context)")
    
    print_db_snapshot("INITIAL STATE", session_id)
    results = []

    # Scenario 1: Workspace Inspection (glob)
    s1 = send_nlp_turn(
        session_id,
        "Use the glob tool to find all files inside the workspace directory and report their filenames."
    )
    results.append(("S1_GLOB_LISTING", s1))
    print_db_snapshot("AFTER S1 (glob)", session_id)

    # Scenario 2: File Creation (write_file)
    s2 = send_nlp_turn(
        session_id,
        "Use the write_file tool to create a new file named 'audit_summary_2026.txt' inside your workspace directory with the exact content:\n"
        "Audit Engagement 2026: Active.\nLead Auditor: Senior CPA.\nScope: Balance Sheet Reconciliation.\n"
        "Confirm once the write_file tool finishes."
    )
    results.append(("S2_WRITE_FILE", s2))
    print_db_snapshot("AFTER S2 (write_file)", session_id)

    # Scenario 3: File Inspection (view_file)
    s3 = send_nlp_turn(
        session_id,
        "Use the view_file tool to read 'audit_summary_2026.txt' and tell me the Scope."
    )
    results.append(("S3_VIEW_FILE", s3))
    print_db_snapshot("AFTER S3 (view_file)", session_id)

    # Scenario 4: Python CSV Ledger Analysis (run_shell_command)
    s4 = send_nlp_turn(
        session_id,
        "Run this exact python shell command using run_shell_command:\n"
        "python -c \"import csv; rows=list(csv.DictReader(open(r'C:/Users/rama/Downloads/Mash/scratch/sandbox/accounts.csv'))); total=sum(float(r['Balance']) for r in rows if r['Category']=='Assets'); print(f'TOTAL_ASSETS={total}')\"\n"
        "State the calculated TOTAL_ASSETS value in your answer."
    )
    results.append(("S4_PYTHON_CSV_ANALYSIS", s4))
    print_db_snapshot("AFTER S4 (run_shell_command)", session_id)

    # Scenario 5: PDF to Image & Vision Text Extraction (run_shell_command)
    s5 = send_nlp_turn(
        session_id,
        "Run this exact python command using run_shell_command to render page 0 of the audit PDF to an image and extract its text:\n"
        "python -c \"import fitz; doc=fitz.open(r'C:/Users/rama/Downloads/Mash/scratch/sandbox/sample_audit.pdf'); p=doc[0]; p.get_pixmap().save(r'C:/Users/rama/Downloads/Mash/scratch/sandbox/sample_audit_page0.png'); print(p.get_text())\"\n"
        "Tell me the Net Equity reported in the output."
    )
    results.append(("S5_PDF_IMAGE_EXTRACTION", s5))
    print_db_snapshot("AFTER S5 (PDF to Image)", session_id)

    # Scenario 6: Verify Image Generated
    s6 = send_nlp_turn(
        session_id,
        "Use the glob tool to check if 'sample_audit_page0.png' exists in 'scratch/sandbox'."
    )
    results.append(("S6_VERIFY_IMAGE_CREATED", s6))
    print_db_snapshot("AFTER S6 (Verify Image)", session_id)

    # Scenario 7: Multi-Turn Context Memory Recall
    s7 = send_nlp_turn(
        session_id,
        "Based on our conversation in this session, answer two questions:\n"
        "1. What was the TOTAL_ASSETS from the CSV?\n"
        "2. What was the Net Equity from the PDF?"
    )
    results.append(("S7_MULTI_TURN_RECALL", s7))
    print_db_snapshot("AFTER S7 (Memory Recall)", session_id)

    # Scenario 8: Backend Web Fetch (web_fetch)
    s8 = send_nlp_turn(
        session_id,
        "Use the web_fetch tool to fetch http://127.0.0.1:8000/api/health and report the returned JSON status."
    )
    results.append(("S8_WEB_FETCH", s8))
    print_db_snapshot("AFTER S8 (web_fetch)", session_id)

    # Scenario 9: Event-Sourced Undo / State Rollback
    print("\n--- Testing RFC-0022 Event-Sourced Undo ---")
    undo_res = call_undo(session_id, from_turn=3)
    print_db_snapshot("AFTER S9 (UNDO ROLLBACK)", session_id)

    # Scenario 10: Post-Undo Verification
    s10 = send_nlp_turn(
        session_id,
        "Please confirm what our current active audit focus is."
    )
    results.append(("S10_POST_UNDO_VERIFY", s10))
    print_db_snapshot("AFTER S10 (POST UNDO)", session_id)

    print("\n" + "=" * 80)
    print("LIVE AGENT SCENARIO MATRIX EXECUTION COMPLETED")
    print("=" * 80)
    for name, r in results:
        tools_str = ", ".join(t["name"] for t in r["tools_called"]) if r["tools_called"] else "None (Direct Answer)"
        print(f"Scenario {name:<26} | Tools: {tools_str:<32} | Time: {r['elapsed_sec']}s")

if __name__ == "__main__":
    run_all_scenarios()
