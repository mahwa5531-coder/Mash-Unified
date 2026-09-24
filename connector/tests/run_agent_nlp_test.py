import json
import sqlite3
import pathlib
import urllib.request
import time
import sys

BASE_URL = "http://127.0.0.1:8000"
DB_PATH = pathlib.Path.home() / ".nexau" / "database" / "nexau.db"

def inspect_database(tag="", session_id=None):
    print(f"\n{'='*20} DATABASE CHECK [{tag}] {'='*20}")
    if not DB_PATH.exists():
        print(f"Database {DB_PATH} does not exist.")
        return
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")]
    print(f"Active Tables ({len(tables)}): {tables}")
    for t in tables:
        count = cur.execute(f"SELECT COUNT(*) FROM [{t}]").fetchone()[0]
        session_filter = ""
        if session_id:
            # check if session_id column exists
            cols = [d[1] for d in cur.execute(f"PRAGMA table_info([{t}])").fetchall()]
            if "session_id" in cols:
                s_count = cur.execute(f"SELECT COUNT(*) FROM [{t}] WHERE session_id = ?", (session_id,)).fetchone()[0]
                session_filter = f" (for session '{session_id}': {s_count})"
        print(f"  Table '{t}': {count} total rows{session_filter}")
        if session_id and "session_id" in [d[1] for d in cur.execute(f"PRAGMA table_info([{t}])").fetchall()]:
            rows = cur.execute(f"SELECT * FROM [{t}] WHERE session_id = ? ORDER BY 1 DESC LIMIT 3", (session_id,)).fetchall()
            col_names = [d[0] for d in cur.description]
            for r in rows:
                print(f"    [{t}] Row: {dict(zip(col_names[:5], r[:5]))}")
    conn.close()
    
    # Also inspect transcript file if it exists
    if session_id:
        transcript_path = pathlib.Path.home() / ".nexau" / "brain" / session_id / ".system_generated" / "logs" / "transcript.jsonl"
        if transcript_path.exists():
            lines = transcript_path.read_text(encoding="utf-8", errors="ignore").strip().splitlines()
            print(f"  Transcript file: {transcript_path} ({len(lines)} steps recorded)")
    print("=" * 60)

def send_nlp_query(session_id: str, prompt: str):
    print(f"\n>>> SENDING NLP TO AGENT: \"{prompt}\" (Session: {session_id})")
    url = f"{BASE_URL}/stream"
    payload = json.dumps({
        "session_id": session_id,
        "messages": prompt,
        "context": {
            "working_directory": str(pathlib.Path("scratch/sandbox").resolve())
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

    with urllib.request.urlopen(req, timeout=180) as response:
        buffer = ""
        for chunk in response:
            line = chunk.decode("utf-8")
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
                        tools_called.append({"name": tname, "id": tid})
                        print(f"\n[TOOL START]: {tname} (id: {tid})")
                    elif "TOOL_CALL_RESULT" in ev_type:
                        out = str(ev.get("content") or ev.get("output") or "")[:200]
                        print(f"[TOOL RESULT]: {out}...")
                    elif "TEXT_MESSAGE" in ev_type:
                        delta = ev.get("delta", "")
                        full_text += delta
                        sys.stdout.write(delta)
                        sys.stdout.flush()
                    elif "RUN_FINISHED" in ev_type:
                        print("\n[RUN FINISHED]")
                except Exception as e:
                    pass

    print("\n--- FINAL AGENT ANSWER ---")
    print(full_text.strip())
    print("--------------------------")
    return {
        "thinking": thinking_text,
        "answer": full_text,
        "tools": tools_called
    }

if __name__ == "__main__":
    session_id = f"test_nlp_{int(time.time())}"
    print(f"Starting Live NLP Agent Test on session: {session_id}")
    
    inspect_database("BEFORE ANY RUN")

    # Turn 1: Pure NLP asking the agent to inspect the sandbox folder
    p1 = "List what files currently exist in your working directory and tell me."
    send_nlp_query(session_id, p1)
    inspect_database("AFTER TURN 1 - DIRECTORY LISTING")

    # Turn 2: Pure NLP asking the agent to create a test file in sandbox
    p2 = "Please create a file named 'nexau_live_test.txt' in your working directory with the exact content 'NexAU Engine Test Passed 2026' and confirm when done."
    send_nlp_query(session_id, p2)
    inspect_database("AFTER TURN 2 - FILE CREATION")

    # Turn 3: Pure NLP asking the agent to read and verify that file
    p3 = "Now read the file 'nexau_live_test.txt' you just created and report its content."
    send_nlp_query(session_id, p3)
    inspect_database("AFTER TURN 3 - FILE VERIFICATION")
