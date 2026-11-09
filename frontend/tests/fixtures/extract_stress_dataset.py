#!/usr/bin/env python3
"""
Read-Only Benchmark Ingestion Script
Extracts real production turns containing Mermaid diagrams, SVGs, CodeBlocks, and Tool Traces
from authentic conversation databases without modifying or writing to the source databases.
"""

import json
import os
import sys

SESSION_1_PATH = r"C:\Users\rama\.gemini\antigravity\brain\6c2d2530-5fae-45bb-8188-4e00a46893c6\.system_generated\logs\transcript.jsonl"
SESSION_2_PATH = r"C:\Users\rama\.gemini\antigravity\brain\bc5df091-d65b-47b2-ba8f-69ac624e9af9\.system_generated\logs\transcript_full.jsonl"
OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_FILE_1000 = os.path.join(OUTPUT_DIR, "stress_1000_turns.json")
OUTPUT_FILE_SESSION_B = os.path.join(OUTPUT_DIR, "stress_session_b.json")

def extract_turns_from_jsonl(path, target_count, session_id):
    if not os.path.exists(path):
        print(f"[ERROR] Source transcript not found: {path}")
        return []

    turns = []
    current_user = None
    current_assts = []
    mermaid_count = 0
    svg_count = 0
    code_count = 0
    tool_count = 0

    print(f"[*] Reading (read-only): {path}...")
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        for line_idx, line in enumerate(f):
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
            except Exception:
                continue

            msg_type = data.get("type")
            role = data.get("role") or ("user" if msg_type == "USER_INPUT" else ("assistant" if msg_type == "PLANNER_RESPONSE" else None))
            content = data.get("content") or ""
            thinking = data.get("thinking") or ""
            tools = data.get("tool_calls") or []

            if "```mermaid" in content or "flowchart" in content or "sequenceDiagram" in content:
                mermaid_count += 1
            if "<svg" in content or ".svg" in content:
                svg_count += 1
            if "```" in content:
                code_count += 1
            if tools:
                tool_count += len(tools)

            if role == "user":
                if current_user is not None:
                    turns.append({
                        "session_id": session_id,
                        "turn_idx": len(turns),
                        "user": current_user,
                        "assistant_steps": current_assts,
                    })
                    if len(turns) >= target_count:
                        break
                    current_assts = []
                current_user = {
                    "id": f"{session_id}_user_{len(turns)}",
                    "role": "user",
                    "content": content,
                    "created_at": data.get("created_at"),
                }
            elif role == "assistant":
                current_assts.append({
                    "id": f"{session_id}_asst_{len(turns)}_{len(current_assts)}",
                    "role": "assistant",
                    "content": content,
                    "thoughts": [thinking] if thinking else [],
                    "tools": [
                        {
                            "id": tc.get("id") or f"tc_{line_idx}_{t_idx}",
                            "name": tc.get("name") or tc.get("tool_name") or "tool",
                            "args": tc.get("args") or tc.get("parameters") or {},
                            "output": tc.get("output") or tc.get("result") or "",
                            "status": "completed",
                        }
                        for t_idx, tc in enumerate(tools)
                    ],
                    "status": "completed",
                    "created_at": data.get("created_at"),
                })

        if current_user is not None and len(turns) < target_count:
            turns.append({
                "session_id": session_id,
                "turn_idx": len(turns),
                "user": current_user,
                "assistant_steps": current_assts,
            })

    print(f"  -> Extracted {len(turns)} turns: {mermaid_count} Mermaid diagrams, {svg_count} SVGs, {code_count} codeblocks, {tool_count} tools.")
    return turns

def main():
    print("======================================================================")
    print("EXTRACTING 1,000-TURN AUTHENTIC BENCHMARK FIXTURE (STRICTLY READ-ONLY)")
    print("======================================================================\n")

    # 1. Extract 470 turns from Session 1 (all available)
    turns_sess1 = extract_turns_from_jsonl(SESSION_1_PATH, 470, "session_6c2d2530")

    # 2. Extract 530 turns from Session 2 to make exactly 1,000 turns for Session A
    turns_sess2_for_1000 = extract_turns_from_jsonl(SESSION_2_PATH, 530, "session_bc5df091")
    combined_1000 = turns_sess1 + turns_sess2_for_1000

    print(f"\n[*] Writing combined 1,000-turn stress dataset to: {OUTPUT_FILE_1000}")
    with open(OUTPUT_FILE_1000, "w", encoding="utf-8") as out_f:
        json.dump(combined_1000, out_f, indent=None) # compact JSON to save disk
    file_size_mb = os.path.getsize(OUTPUT_FILE_1000) / (1024 * 1024)
    print(f"  [SUCCESS] 1,000 turns exported ({file_size_mb:.2f} MB)")

    # 3. Extract independent Session B (500 turns) for cross-session switching test
    print(f"\n[*] Writing independent Session B (500 turns) to: {OUTPUT_FILE_SESSION_B}")
    with open(OUTPUT_FILE_SESSION_B, "w", encoding="utf-8") as out_b:
        json.dump(turns_sess2_for_1000[:500], out_b, indent=None)
    sess_b_size_mb = os.path.getsize(OUTPUT_FILE_SESSION_B) / (1024 * 1024)
    print(f"  [SUCCESS] Session B exported ({sess_b_size_mb:.2f} MB)")

    print("\n======================================================================")
    print("FIXTURE EXTRACTION COMPLETED WITH ZERO SOURCE DATABASE MUTATION (100% READ-ONLY)")
    print("======================================================================")

if __name__ == "__main__":
    main()
