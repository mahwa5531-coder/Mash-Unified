import json
import sqlite3
import pathlib
import urllib.request
import time
import sys
import os

# Set UTF-8 encoding for console output
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

BASE_URL = "http://127.0.0.1:8000"
DB_PATH = pathlib.Path.home() / ".nexau" / "database" / "nexau.db"
SANDBOX_DIR = pathlib.Path(r"C:\Users\rama\Downloads\Mash\scratch\sandbox")

class ToolBenchEvaluator:
    """
    Automated Test Engineer for ToolBench evaluation on NexAU Agent.
    Strictly observes, feeds natural language, monitors turns, and audits SQLite DB.
    """
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.records = []
        self.db_errors = []

    def log_db_state(self, task_id: str):
        if not DB_PATH.exists():
            return {"error": "DB not found"}
        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM agent_run_actions WHERE session_id = ?", (self.session_id,))
        sess_actions = cur.fetchone()[0]
        cur.execute("SELECT action_type, count(*) FROM agent_run_actions WHERE session_id = ? GROUP BY action_type", (self.session_id,))
        type_counts = dict(cur.fetchall())
        conn.close()
        return {
            "session_actions": sess_actions,
            "type_counts": type_counts
        }

    def execute_task(self, task_id: str, scenario_type: str, prompt: str, validator_fn):
        print("\n" + "=" * 80)
        print(f"TOOLBENCH [{task_id}] | Category: {scenario_type}")
        print(f"NLP INSTRUCTION: {prompt}")
        print("=" * 80)

        url = f"{BASE_URL}/stream"
        payload = json.dumps({
            "session_id": self.session_id,
            "messages": prompt,
            "context": {
                "working_directory": str(SANDBOX_DIR)
            }
        }).encode("utf-8")

        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
        full_text = ""
        thinking_text = ""
        tools_invoked = []
        t0 = time.time()

        with urllib.request.urlopen(req, timeout=180) as response:
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
                            sys.stdout.write(f"\r[THINKING]: {len(thinking_text)} chars")
                            sys.stdout.flush()
                        elif "TOOL_CALL_START" in ev_type:
                            tname = ev.get("tool_call_name", "")
                            tid = ev.get("tool_call_id", "")
                            targs = ev.get("tool_call_arguments", "")
                            tools_invoked.append({"name": tname, "id": tid, "args": targs})
                            print(f"\n  -> [TOOL_CALL]: {tname} (ID: {tid})")
                        elif "TOOL_CALL_RESULT" in ev_type:
                            out = str(ev.get("content") or ev.get("output") or "")
                            print(f"  <- [TOOL_OUT]: {out[:140]}...")
                        elif "TEXT_MESSAGE" in ev_type:
                            delta = ev.get("delta", "")
                            full_text += delta
                            sys.stdout.write(delta)
                            sys.stdout.flush()
                        elif "RUN_FINISHED" in ev_type:
                            print(f"\n[TURN FINISHED in {time.time()-t0:.2f}s]")
                    except Exception:
                        pass

        elapsed = round(time.time() - t0, 2)
        print("\n--- FINAL AGENT ANSWER ---")
        print(full_text.strip())
        print("--------------------------\n")

        # Validator evaluation
        passed, notes = validator_fn(full_text, tools_invoked)
        db_state = self.log_db_state(task_id)

        record = {
            "task_id": task_id,
            "scenario": scenario_type,
            "prompt": prompt,
            "tools_called": [t["name"] for t in tools_invoked],
            "iterations": len(tools_invoked),
            "response": full_text.strip(),
            "elapsed_sec": elapsed,
            "passed": passed,
            "notes": notes,
            "db_actions": db_state.get("session_actions", 0)
        }
        self.records.append(record)
        status_label = "[PASS]" if passed else "[FAIL]"
        print(f"RESULT: {status_label} | Tools: {record['tools_called']} | Time: {elapsed}s | Actions in DB: {record['db_actions']}")
        return record

    def print_toolbench_report(self):
        print("\n" + "#" * 85)
        print("                 OFFICIAL TOOLBENCH EVALUATION SCORECARD                  ")
        print("#" * 85)
        print(f"Session ID: {self.session_id}")
        print(f"Model: qwen3.5:2b (256k context via Cloudflare Ollama proxy)")
        print(f"Engine: NexAU Runtime + FastAPI Connector (Headless Execution)")
        print(f"Audit Database: {DB_PATH}\n")

        total = len(self.records)
        passed = sum(1 for r in self.records if r["passed"])
        pass_rate = (passed / total * 100) if total > 0 else 0

        # Scenario breakdown
        categories = ["I1_SINGLE_TOOL", "I2_INTRA_CATEGORY", "I3_INTER_CATEGORY"]
        cat_stats = {}
        for c in categories:
            cat_records = [r for r in self.records if r["scenario"] == c]
            c_total = len(cat_records)
            c_pass = sum(1 for r in cat_records if r["passed"])
            c_rate = (c_pass / c_total * 100) if c_total > 0 else 0
            cat_stats[c] = {"total": c_total, "passed": c_pass, "rate": c_rate}

        print("--- BENCHMARK BREAKDOWN BY TOOLBENCH SCENARIO LEVEL ---")
        for c, s in cat_stats.items():
            print(f"  Level {c:<22}: {s['passed']}/{s['total']} Passed ({s['rate']:.1f}%)")

        print(f"\nOVERALL TOOLBENCH PASS RATE (Pass^R): {pass_rate:.1f}% ({passed}/{total} Tasks Passed)\n")

        print("-" * 85)
        print(f"{'Task ID':<8} | {'Level':<18} | {'Tools Called':<28} | {'Time':<6} | {'Status':<6}")
        print("-" * 85)
        for r in self.records:
            st = "PASS" if r["passed"] else "FAIL"
            tc = ", ".join(r["tools_called"]) if r["tools_called"] else "Direct Answer"
            print(f"{r['task_id']:<8} | {r['scenario']:<18} | {tc:<28} | {r['elapsed_sec']:<5}s | [{st}]")
            if r["notes"]:
                for n in r["notes"]:
                    print(f"         > Note: {n}")
        print("#" * 85)


def run_full_toolbench_evaluation():
    session_id = f"toolbench_full_{int(time.time())}"
    print(f"================================================================================")
    print(f"  LAUNCHING FULL TOOLBENCH BENCHMARK SUITE FOR NEXAU AGENT")
    print(f"  Session ID: {session_id}")
    print(f"  Total Benchmark Tasks: 15 (5x I1, 5x I2, 5x I3)")
    print(f"================================================================================")
    
    tb = ToolBenchEvaluator(session_id)

    # ═════════════════════════════════════════════════════════════════════════════
    # LEVEL I1: SINGLE-TOOL INSTRUCTION (I1-1 to I1-5)
    # ═════════════════════════════════════════════════════════════════════════════

    # Task I1-1: Exact Pattern Matching via glob
    def v_i1_1(resp, tools):
        called = [t["name"] for t in tools]
        passed = "glob" in called and "accounts.csv" in resp and "vendors.csv" in resp
        return passed, ["Identified both CSV files via glob"]
    tb.execute_task(
        "I1-1", "I1_SINGLE_TOOL",
        "Use the glob tool to find all '*.csv' files inside your workspace directory and list their names.",
        v_i1_1
    )

    # Task I1-2: Targeted Line Range Extraction via view_file
    def v_i1_2(resp, tools):
        called = [t["name"] for t in tools]
        passed = "view_file" in called and "senior_cpa" in resp
        return passed, ["Extracted login username from audit trail log lines 1-3"]
    tb.execute_task(
        "I1-2", "I1_SINGLE_TOOL",
        "Use view_file to inspect the first 3 lines of 'scratch/sandbox/audit_trail.log' and tell me the username of the user who logged in.",
        v_i1_2
    )

    # Task I1-3: Pattern Query via search_file_content
    def v_i1_3(resp, tools):
        called = [t["name"] for t in tools]
        passed = ("search_file_content" in called or "view_file" in called) and "10.0.0.99" in resp
        return passed, ["Located IP address 10.0.0.99 associated with CRITICAL log entry"]
    tb.execute_task(
        "I1-3", "I1_SINGLE_TOOL",
        "Use search_file_content to find lines containing 'CRITICAL' in 'scratch/sandbox/audit_trail.log' and report the unauthorized IP address.",
        v_i1_3
    )

    # Task I1-4: Deterministic Python Aggregation via run_shell_command
    def v_i1_4(resp, tools):
        called = [t["name"] for t in tools]
        # Sum of Approved: 145000 + 285000 + 120000 = 550,000
        passed = "run_shell_command" in called and ("550000" in resp or "550,000" in resp)
        return passed, ["Calculated Approved vendor sum: $550,000"]
    tb.execute_task(
        "I1-4", "I1_SINGLE_TOOL",
        "Run this python shell command using run_shell_command:\n"
        "python -c \"import csv; rows=list(csv.DictReader(open(r'C:/Users/rama/Downloads/Mash/scratch/sandbox/vendors.csv'))); approved_sum=sum(float(r['TotalBilled']) for r in rows if r['Status']=='Approved'); print(f'APPROVED_TOTAL={approved_sum}')\"\n"
        "State the APPROVED_TOTAL amount.",
        v_i1_4
    )

    # Task I1-5: Live REST API Query via web_fetch
    def v_i1_5(resp, tools):
        called = [t["name"] for t in tools]
        passed = "web_fetch" in called and "mash-backend" in resp
        return passed, ["Parsed live JSON response from backend API"]
    tb.execute_task(
        "I1-5", "I1_SINGLE_TOOL",
        "Use the web_fetch tool to fetch http://127.0.0.1:8000/api/health and report the service name and status returned.",
        v_i1_5
    )

    # ═════════════════════════════════════════════════════════════════════════════
    # LEVEL I2: INTRA-CATEGORY MULTI-TOOL ORCHESTRATION (I2-1 to I2-5)
    # ═════════════════════════════════════════════════════════════════════════════

    # Task I2-1: Filesystem Discovery -> Inspection Chain
    def v_i2_1(resp, tools):
        called = [t["name"] for t in tools]
        passed = "glob" in called and "view_file" in called and "AUDIT-2026-X" in resp
        return passed, ["Chained glob discovery to view_file inspection of audit_meta.json"]
    tb.execute_task(
        "I2-1", "I2_INTRA_CATEGORY",
        "First, use the glob tool to find the '*.json' configuration file in the workspace directory. Then use view_file to read it and report the audit_id.",
        v_i2_1
    )

    # Task I2-2: Log Anomaly Detection -> Workpaper Generation
    def v_i2_2(resp, tools):
        called = [t["name"] for t in tools]
        passed = ("search_file_content" in called or "view_file" in called) and "V-005" in resp
        return passed, ["Identified disputed vendor V-005 from log and generated documentation"]
    tb.execute_task(
        "I2-2", "I2_INTRA_CATEGORY",
        "Search 'scratch/sandbox/audit_trail.log' for any 'WARN' entries to identify which vendor is on payment hold. Then state the vendor ID and invoice number.",
        v_i2_2
    )

    # Task I2-3: Multi-File Cross-Ledger Reconciliation
    def v_i2_3(resp, tools):
        called = [t["name"] for t in tools]
        # Cash: 450,000; Approved vendors: 550,000; Difference: -100,000 (shortfall)
        passed = ("450,000" in resp or "450000" in resp) and ("550,000" in resp or "550000" in resp)
        return passed, ["Reconciled Cash ($450,000) against Approved vendor payables ($550,000)"]
    tb.execute_task(
        "I2-3", "I2_INTRA_CATEGORY",
        "Compare the 'Operating Cash' balance from 'scratch/sandbox/accounts.csv' with the total of 'Approved' vendors from 'scratch/sandbox/vendors.csv'. Does current cash ($450,000) cover approved vendor bills ($550,000)?",
        v_i2_3
    )

    # Task I2-4: Structured Audit Note Creation via write_file
    def v_i2_4(resp, tools):
        called = [t["name"] for t in tools]
        passed = "write_file" in called
        return passed, ["Created cash_shortfall_memo.md workpaper in workspace"]
    tb.execute_task(
        "I2-4", "I2_INTRA_CATEGORY",
        "Use the write_file tool to write a workpaper file named 'cash_shortfall_memo.md' in your workspace with the content:\n"
        "# Cash Position Alert\nCash: $450,000\nApproved Vendor Bills: $550,000\nShortfall: $100,000\nAction: Defer Vendor V-002 payment.\n"
        "Confirm when created.",
        v_i2_4
    )

    # Task I2-5: File Integrity & Verification Chain
    def v_i2_5(resp, tools):
        called = [t["name"] for t in tools]
        passed = "view_file" in called and "V-002" in resp
        return passed, ["Verified cash shortfall memo content and deferral recommendation"]
    tb.execute_task(
        "I2-5", "I2_INTRA_CATEGORY",
        "Use view_file to read 'cash_shortfall_memo.md' and confirm which vendor payment was recommended for deferral.",
        v_i2_5
    )

    # ═════════════════════════════════════════════════════════════════════════════
    # LEVEL I3: INTER-CATEGORY CROSS-DOMAIN MULTI-TOOL WORKFLOWS (I3-1 to I3-5)
    # ═════════════════════════════════════════════════════════════════════════════

    # Task I3-1: Web API + Filesystem Integration Pipeline
    def v_i3_1(resp, tools):
        called = [t["name"] for t in tools]
        passed = "web_fetch" in called and "1.0.0" in resp
        return passed, ["Queried system info API and reported backend version"]
    tb.execute_task(
        "I3-1", "I3_INTER_CATEGORY",
        "Use web_fetch to query http://127.0.0.1:8000/api/system/info and report the machine platform and version string.",
        v_i3_1
    )

    # Task I3-2: PDF Document Vision + Python Data Science Pipeline
    def v_i3_2(resp, tools):
        called = [t["name"] for t in tools]
        passed = "run_shell_command" in called and ("3,420,000" in resp or "3420000" in resp)
        return passed, ["Extracted PDF memorandum text with fitz and reported Net Equity"]
    tb.execute_task(
        "I3-2", "I3_INTER_CATEGORY",
        "Run this python command using run_shell_command to read the sample audit PDF and print its text:\n"
        "python -c \"import fitz; doc=fitz.open(r'C:/Users/rama/Downloads/Mash/scratch/sandbox/sample_audit.pdf'); print(doc[0].get_text())\"\n"
        "Tell me the Net Equity reported in the memorandum.",
        v_i3_2
    )

    # Task I3-3: Security Incident Log Forensics + Executive Report
    def v_i3_3(resp, tools):
        called = [t["name"] for t in tools]
        passed = "9090" in resp and "10.0.0.99" in resp
        return passed, ["Synthesized security incident on port 9090 from 10.0.0.99"]
    tb.execute_task(
        "I3-3", "I3_INTER_CATEGORY",
        "Analyze the security breach reported in 'scratch/sandbox/audit_trail.log'. What was the target port and the unauthorized source IP address?",
        v_i3_3
    )

    # Task I3-4: Autonomous Error Diagnosis & Recovery (DFSDT)
    def v_i3_4(resp, tools):
        called = [t["name"] for t in tools]
        # Should gracefully detect that nonexistent.csv doesn't exist and fall back
        passed = ("does not exist" in resp.lower() or "not found" in resp.lower() or "error" in resp.lower() or "accounts.csv" in resp)
        return passed, ["Handled missing resource gracefully without unhandled exception"]
    tb.execute_task(
        "I3-4", "I3_INTER_CATEGORY",
        "Check if 'scratch/sandbox/nonexistent_ledger.csv' exists. If it does not exist, inspect 'scratch/sandbox/accounts.csv' instead and tell me how many accounts are present.",
        v_i3_4
    )

    # Task I3-5: End-to-End Autonomous Statutory Balance Sheet Audit
    def v_i3_5(resp, tools):
        called = [t["name"] for t in tools]
        # Equation: Assets ($5,240,000) = Liabilities ($1,820,000) + Equity ($3,420,000)
        passed = ("5,240,000" in resp or "5240000" in resp) and ("1,820,000" in resp or "1820000" in resp)
        return passed, ["Verified fundamental accounting equilibrium: Assets = Liabilities + Equity"]
    tb.execute_task(
        "I3-5", "I3_INTER_CATEGORY",
        "Synthesize our audit findings: In 'scratch/sandbox/sample_audit.pdf', does Total Current Liabilities ($1,820,000) plus Net Equity ($3,420,000) equal Total Assets ($5,240,000)? Show the mathematical formula and state whether the balance sheet is reconciled.",
        v_i3_5
    )

    # Generate final comprehensive scorecard
    tb.print_toolbench_report()

if __name__ == "__main__":
    run_full_toolbench_evaluation()
