"""Benchmark Script: Multi-turn Context Compaction Token & Credit Analysis

Simulates a real multi-turn audit session across 10, 20, 50, and 100 turns,
evaluating actual token counts using NexAU's TokenCounter and ToolResultCompaction.
Outputs raw results and a structured JSON summary.
"""

import os
import sys
import json
import time
from pathlib import Path

# Ensure NexAU is in sys.path
repo_root = Path(__file__).resolve().parent.parent
nexau_path = repo_root / "NexAU"
if str(nexau_path) not in sys.path:
    sys.path.insert(0, str(nexau_path))

from nexau.core.messages import Message, Role, TextBlock, ToolUseBlock, ToolResultBlock, ImageBlock
from nexau.archs.main_sub.utils.token_counter import TokenCounter
from nexau.archs.main_sub.execution.middleware.context_compaction.compact_stratigies.compact_tool_result import ToolResultCompaction

def run_benchmark():
    counter = TokenCounter()
    compactor = ToolResultCompaction(keep_iterations=3)

    # Valid 100x100 PNG Base64 for vision testing
    valid_100x100_png_b64 = (
        "iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAlUlEQVR42u3RAQ0AAAgDoNu/tD28"
        "BwY04F/bBUhIiISESEhIhIRISEiEhIRISEiEhIRISEiEhIRISEiEhIRISEiEhIRISEiEhIRISEhI"
        "hIRISEiEhIRISEiEhIRISEiEhIRISEiEhIRISEiEhIRISEiEhIRISEiEhIRISEiEhIRISEiEhIRISEhI"
        "hIRISEiEhIRISEiEhIRISEh/2bYf8Hj4m58AAAAASUVORK5CYII="
    )

    print("=" * 70)
    print("MASh AGENT RUNTIME: 100-TURN CONTEXT COMPACTION LIVE BENCHMARK")
    print("=" * 70)
    print(f"Python Runtime: {sys.executable}")
    print(f"Timestamp:      {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("-" * 70)

    all_raw_messages = [
        Message(role=Role.SYSTEM, content=[TextBlock(text="You are MASh, an expert local AI auditor.")])
    ]

    cumulative_naive_tokens = 0
    cumulative_compacted_tokens = 0

    turn_checkpoints = [10, 20, 50, 100]
    checkpoint_data = {}

    start_time = time.time()

    for t in range(1, 101):
        # 1. User Message (Every 10 turns includes a screenshot; otherwise references local file path)
        if t % 10 == 0:
            user_msg = Message(role=Role.USER, content=[
                TextBlock(text=f"Turn {t}: Audit discrepancy in attached ledger screenshot."),
                ImageBlock(mime_type="image/png", base64=valid_100x100_png_b64)
            ])
        else:
            user_msg = Message(role=Role.USER, content=[
                TextBlock(text=f"Turn {t}: Analyze ledger slice from C:/data/ledger_2026.parquet for account {2000 + t}.")
            ])
        all_raw_messages.append(user_msg)

        # 2. Assistant Tool Call
        call_id = f"call_{t}"
        asst_msg = Message(role=Role.ASSISTANT, content=[
            TextBlock(text=f"Querying account {2000 + t}..."),
            ToolUseBlock(id=call_id, name="duckdb_query", input={"query": f"SELECT * FROM ledger WHERE account = {2000 + t}"})
        ])
        all_raw_messages.append(asst_msg)

        # 3. Tool Result Payload (~2,500 characters of data per turn)
        tool_content = (
            f"Trx #{t}-01: Date 2026-11-17, Amount $4,200.00, Status POSTED\n"
            f"Trx #{t}-02: Date 2026-11-17, Amount $18,950.00, Status CLEARED\n"
        ) * 40
        tool_msg = Message(role=Role.TOOL, content=[
            ToolResultBlock(tool_use_id=call_id, content=tool_content)
        ])
        all_raw_messages.append(tool_msg)

        # 4. Assistant Final Synthesis
        final_asst = Message(role=Role.ASSISTANT, content=[
            TextBlock(text=f"Verified account {2000 + t}: balanced with $0.00 variance.")
        ])
        all_raw_messages.append(final_asst)

        # Token count calculation
        current_naive_tokens = counter.count_tokens(all_raw_messages)
        cumulative_naive_tokens += current_naive_tokens

        # Compact context
        compacted_messages = compactor.compact(all_raw_messages)
        current_compacted_tokens = counter.count_tokens(compacted_messages)
        cumulative_compacted_tokens += current_compacted_tokens

        # Checkpoints
        if t in turn_checkpoints:
            compacted_tool_blocks = [
                b for m in compacted_messages if m.role == Role.TOOL
                for b in m.content if isinstance(b, ToolResultBlock) and b.content == "Tool call result has been compacted"
            ]
            all_raw_preserved = all(b.raw_output is not None for b in compacted_tool_blocks)

            single_savings = round((1 - current_compacted_tokens / current_naive_tokens) * 100, 2)
            cumul_savings = round((1 - cumulative_compacted_tokens / cumulative_naive_tokens) * 100, 2)

            checkpoint_data[t] = {
                "turn": t,
                "messages_in_history": len(all_raw_messages),
                "single_turn_naive_tokens": current_naive_tokens,
                "single_turn_compacted_tokens": current_compacted_tokens,
                "single_turn_savings_pct": single_savings,
                "cumulative_naive_tokens_billed": cumulative_naive_tokens,
                "cumulative_compacted_tokens_billed": cumulative_compacted_tokens,
                "cumulative_savings_pct": cumul_savings,
                "compacted_tools_count": len(compacted_tool_blocks),
                "raw_output_preserved": all_raw_preserved
            }

            print(
                f"[Turn {t:3d}] Naive: {current_naive_tokens:6d} tok | "
                f"Compacted: {current_compacted_tokens:5d} tok | "
                f"Turn Savings: {single_savings:5.2f}% | "
                f"Cumulative Billed: {cumulative_compacted_tokens:7d} vs {cumulative_naive_tokens:7d} ({cumul_savings:5.2f}% saved)"
            )

    elapsed = round(time.time() - start_time, 2)
    print("-" * 70)
    print(f"Benchmark completed in {elapsed} seconds.")
    print("=" * 70)

    # Save output to scripts/benchmark_results.json
    output_path = repo_root / "scripts" / "benchmark_results.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(list(checkpoint_data.values()), f, indent=2)
    print(f"Results saved to: {output_path}")

if __name__ == "__main__":
    run_benchmark()
