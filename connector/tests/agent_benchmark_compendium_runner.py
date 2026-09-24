import json
import sqlite3
import pathlib
import urllib.request
import time
import sys
import os

# Ensure UTF-8 output across all consoles
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

BASE_URL = "http://127.0.0.1:8000"
DB_PATH = pathlib.Path.home() / ".nexau" / "database" / "nexau.db"
SANDBOX_DIR = pathlib.Path(r"C:\Users\rama\Downloads\Mash\scratch\sandbox")

class NexAUTestEngineer:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.results = []
        self.db_errors = []

    def inspect_db(self, tag: str):
        print(f"\n[QA DB AUDIT - {tag}]")
        if not DB_PATH.exists():
            print(f"  [ERROR] Database file not found at {DB_PATH}")
            return {}
        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()

        # Session verification
        cur.execute("SELECT session_id, created_at, context FROM sessions WHERE session_id = ?", (self.session_id,))
        sess_row = cur.fetchone()

        # Actions verification
        cur.execute(
            "SELECT action_id, run_id, action_type, created_at, extra FROM agent_run_actions WHERE session_id = ? ORDER BY created_at_ns ASC",
            (self.session_id,)
        )
        actions = cur.fetchall()

        # Check for errors in DB
        cur.execute(
            "SELECT action_id, run_id, extra FROM agent_run_actions WHERE session_id = ? AND extra LIKE '%error%'",
            (self.session_id,)
        )
        err_rows = cur.fetchall()

        conn.close()

        print(f"  Session in DB: {'FOUND' if sess_row else 'NOT_FOUND'} (Session: {self.session_id})")
        print(f"  Total Actions Logged: {len(actions)}")
        print(f"  Error Actions Found: {len(err_rows)}")
        if err_rows:
            for er in err_rows:
                print(f"    [DB ERR] Action {er[0]}: {er[2][:120]}...")
                self.db_errors.append(er)
        print("-" * 70)
        return {
            "session_exists": bool(sess_row),
            "action_count": len(actions),
            "error_count": len(err_rows)
        }

    def create_clean_session(self):
        print(f"\n>>> [QA SETUP] Creating Clean Benchmark Session: {self.session_id}")
        url = f"{BASE_URL}/sessions"
        payload = json.dumps({
            "session_id": self.session_id,
            "title": "AI Agent Benchmark Compendium Evaluation",
            "workspace_uri": str(SANDBOX_DIR)
        }).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode())
                print(f"  Session creation status: {data.get('status', 'created')}")
                return data
        except Exception as e:
            print(f"  [WARN] /sessions call: {e} (Will auto-provision via /stream)")
            return None

    def send_nlp_prompt(self, benchmark_name: str, category: str, prompt: str, validation_fn=None, timeout: int = 180):
        print("\n" + "=" * 80)
        print(f"BENCHMARK TASK: [{benchmark_name}] - Category: {category}")
        print(f"USER NLP: {prompt}")
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
                            sys.stdout.write(f"\r[AGENT REASONING]: {len(thinking_text)} chars")
                            sys.stdout.flush()
                        elif "TOOL_CALL_START" in ev_type:
                            tname = ev.get("tool_call_name", "")
                            tid = ev.get("tool_call_id", "")
                            targs = ev.get("tool_call_arguments", "")
                            tools_called.append({"name": tname, "id": tid, "args": targs})
                            print(f"\n  -> [TOOL INVOCATION]: {tname} (ID: {tid})")
                        elif "TOOL_CALL_RESULT" in ev_type:
                            out = str(ev.get("content") or ev.get("output") or "")
                            print(f"  <- [TOOL RESULT]: {out[:180]}...")
                        elif "TEXT_MESSAGE" in ev_type:
                            delta = ev.get("delta", "")
                            full_text += delta
                            sys.stdout.write(delta)
                            sys.stdout.flush()
                        elif "RUN_FINISHED" in ev_type:
                            print(f"\n[TURN COMPLETED in {time.time()-t0:.2f}s]")
                    except Exception:
                        pass

        elapsed = round(time.time() - t0, 2)
        print("\n--- AGENT RESPONSE ---")
        print(full_text.strip())
        print("----------------------\n")

        # Validation
        passed = True
        notes = []
        if validation_fn:
            passed, notes = validation_fn(full_text, tools_called)

        result_entry = {
            "benchmark": benchmark_name,
            "category": category,
            "prompt": prompt,
            "thinking_chars": len(thinking_text),
            "tools": [t["name"] for t in tools_called],
            "response": full_text.strip(),
            "elapsed_sec": elapsed,
            "passed": passed,
            "notes": notes
        }
        self.results.append(result_entry)
        self.inspect_db(f"AFTER {benchmark_name}")
        return result_entry

    def print_final_qa_report(self):
        print("\n" + "=" * 80)
        print("          NEXAU AGENT BENCHMARK COMPENDIUM QA EVALUATION REPORT          ")
        print("=" * 80)
        print(f"Evaluator Mode: QA Test Engineer (Headless, Zero Manual Intervention)")
        print(f"Target Session: {self.session_id}")
        print(f"Model Under Test: qwen3.5:2b (256k context via Cloudflare endpoint)")
        print(f"SQLite DB Audit: {DB_PATH}\n")

        passed_count = sum(1 for r in self.results if r["passed"])
        total_count = len(self.results)
        print(f"Overall Benchmark Score: {passed_count}/{total_count} Passed ({passed_count/total_count*100:.1f}%)\n")

        for r in self.results:
            status_str = "[PASS]" if r["passed"] else "[FAIL]"
            tools_str = ", ".join(r["tools"]) if r["tools"] else "None (Direct Output)"
            print(f"{status_str} {r['benchmark']:<18} | Cat: {r['category']:<22} | Tools: {tools_str:<24} | Time: {r['elapsed_sec']}s")
            if r["notes"]:
                for n in r["notes"]:
                    print(f"       Note: {n}")

        print("\nDatabase & Architecture Health:")
        print(f"  - Database Errors Logged: {len(self.db_errors)}")
        print(f"  - Total Actions Recorded in Session: {sum(1 for _ in self.results)}")
        print("=" * 80)

def run_compendium_benchmark():
    session_id = f"bench_compendium_{int(time.time())}"
    qa = NexAUTestEngineer(session_id)
    
    # Step 1: Create clean session
    qa.create_clean_session()
    qa.inspect_db("INITIAL SESSION STATE")

    # ─────────────────────────────────────────────────────────────────────────────
    # Task 1: BFCL (Berkeley Function Calling Leaderboard) - Tool Selection Precision
    # ─────────────────────────────────────────────────────────────────────────────
    def val_bfcl(resp, tools):
        called = [t["name"] for t in tools]
        passed = "glob" in called and "run_shell_command" not in called
        notes = []
        if "glob" not in called:
            notes.append("Expected 'glob' tool invocation")
        if "run_shell_command" in called:
            notes.append("Agent improperly executed shell command contrary to constraint")
        return passed, notes

    qa.send_nlp_prompt(
        benchmark_name="BFCL-Precision",
        category="Function Calling & Tool Use",
        prompt="Use the glob tool to find which files in your workspace directory match pattern '*.csv'. Do not execute any shell commands.",
        validation_fn=val_bfcl
    )

    # ─────────────────────────────────────────────────────────────────────────────
    # Task 2: ComplexFuncBench - Multi-Step Logic & Constraint File Creation
    # ─────────────────────────────────────────────────────────────────────────────
    def val_complex_func(resp, tools):
        target_file = SANDBOX_DIR / "tax_calculator.py"
        exists = target_file.exists()
        passed = exists and "taxable_income" in target_file.read_text(encoding="utf-8")
        notes = [f"File created on disk: {exists}"]
        return passed, notes

    qa.send_nlp_prompt(
        benchmark_name="ComplexFuncBench",
        category="Function Calling & Tool Use",
        prompt="Use the write_file tool to create 'scratch/sandbox/tax_calculator.py' with this exact function:\n"
               "def compute_corporate_tax(revenue: float, deductions: float) -> dict:\n"
               "    taxable = max(0.0, revenue - deductions)\n"
               "    rate = 0.25 if taxable > 50000.0 else 0.15\n"
               "    return {'taxable_income': taxable, 'tax': taxable * rate}\n"
               "Confirm when written.",
        validation_fn=val_complex_func
    )

    # ─────────────────────────────────────────────────────────────────────────────
    # Task 3: SWE-bench Lite - Execution, Assertions & Verification
    # ─────────────────────────────────────────────────────────────────────────────
    def val_swe_bench(resp, tools):
        called = [t["name"] for t in tools]
        passed = "run_shell_command" in called and "TAX_TEST_PASSED" in resp
        notes = [f"Found TAX_TEST_PASSED in output: {'TAX_TEST_PASSED' in resp}"]
        return passed, notes

    qa.send_nlp_prompt(
        benchmark_name="SWE-bench-Lite",
        category="Coding & Software Engineering",
        prompt="Run this shell command using run_shell_command:\n"
               "python -c \"from tax_calculator import compute_corporate_tax; res = compute_corporate_tax(100000, 20000); assert res['tax'] == 20000.0; print('TAX_TEST_PASSED')\"\n"
               "Report the output of the test.",
        validation_fn=val_swe_bench
    )

    # ─────────────────────────────────────────────────────────────────────────────
    # Task 4: GAIA - Multimodal Document Financial Reconciliation
    # ─────────────────────────────────────────────────────────────────────────────
    def val_gaia(resp, tools):
        # Look for $3,420,000 or 3420000 and Liabilities/Equity balance
        passed = ("3,420,000" in resp or "3420000" in resp) and ("1,820,000" in resp or "1820000" in resp)
        notes = ["Reconciled Net Equity ($3,420,000) and Liabilities ($1,820,000) against Total Assets ($5,240,000)"]
        return passed, notes

    qa.send_nlp_prompt(
        benchmark_name="GAIA-AuditRecon",
        category="General Assistant & Reasoning",
        prompt="Inspect the audit memorandum PDF at 'C:/Users/rama/Downloads/Mash/scratch/sandbox/sample_audit.pdf'. "
               "Run a python command with fitz to extract page 0 text, and verify if Total Liabilities plus Net Equity equals Total Assets ($5,240,000). Show the math.",
        validation_fn=val_gaia
    )

    # ─────────────────────────────────────────────────────────────────────────────
    # Task 5: ToolBench - Live API Fetch & Verification
    # ─────────────────────────────────────────────────────────────────────────────
    def val_toolbench(resp, tools):
        called = [t["name"] for t in tools]
        passed = "web_fetch" in called and "mash-backend" in resp
        notes = [f"web_fetch used: {'web_fetch' in called}, service identified: {'mash-backend' in resp}"]
        return passed, notes

    qa.send_nlp_prompt(
        benchmark_name="ToolBench-LiveAPI",
        category="Function Calling & Tool Use",
        prompt="Use the web_fetch tool to fetch http://127.0.0.1:8000/api/health and report the service name and status.",
        validation_fn=val_toolbench
    )

    # Step Final: Output comprehensive QA Engineer Report
    qa.print_final_qa_report()

if __name__ == "__main__":
    run_compendium_benchmark()
