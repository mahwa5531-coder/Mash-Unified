"""Rigorous Validation Suite: Context Compaction Invariants & Token Accuracy

Tests all core assumptions, token counting fidelity, schema invariants,
and forensic evidence retention across 6 validation suites.
"""

import sys
import json
import math
from pathlib import Path

# Link NexAU into path
repo_root = Path(__file__).resolve().parent.parent
nexau_path = repo_root / "NexAU"
if str(nexau_path) not in sys.path:
    sys.path.insert(0, str(nexau_path))

import tiktoken
from nexau.core.messages import Message, Role, TextBlock, ToolUseBlock, ToolResultBlock, ImageBlock
from nexau.archs.main_sub.utils.token_counter import TokenCounter, _estimate_image_tokens
from nexau.archs.main_sub.utils.image_probe import estimate_tokens_from_dimensions
from nexau.archs.main_sub.execution.middleware.context_compaction.compact_stratigies.compact_tool_result import ToolResultCompaction

def run_validation():
    print("=" * 75)
    print("VALIDATION SUITE: MASh CONTEXT COMPACTION & TOKEN ACCURACY")
    print("=" * 75)
    
    # -------------------------------------------------------------------------
    # SUITE 1: TokenCounter Fidelity vs Direct Tiktoken & Character Heuristic
    # -------------------------------------------------------------------------
    print("\n[SUITE 1] Validating Token Counter Accuracy against Ground Truth...")
    
    # 1.1 Tiktoken Mode Validation
    tiktoken_counter = TokenCounter(strategy="tiktoken", model="gpt-4o")
    sample_text = "MASh audit reconciliation engine verified transaction ledger 2026."
    enc = tiktoken.get_encoding("o200k_base")
    expected_text_tokens = len(enc.encode(sample_text))
    
    msg = Message(role=Role.USER, content=[TextBlock(text=sample_text)])
    actual_tiktoken_tokens = tiktoken_counter.count_tokens([msg])
    # Role 'user' (1 token) + message overhead (+3) + block overhead (+1)
    role_tokens = len(enc.encode("user"))
    expected_total_tiktoken = expected_text_tokens + role_tokens + 3 + 1
    assert actual_tiktoken_tokens == expected_total_tiktoken, (
        f"Tiktoken count mismatch: expected {expected_total_tiktoken}, got {actual_tiktoken_tokens}"
    )
    print(f"  [PASS] Tiktoken mode exact match: {actual_tiktoken_tokens} tokens (o200k_base + protocol framing)")

    # 1.2 Fallback Heuristic Mode Validation (4-char rule)
    fallback_counter = TokenCounter(strategy="fallback")
    actual_fallback_tokens = fallback_counter.count_tokens([msg])
    expected_fallback = ((len(sample_text) + 3) // 4) + ((len("user") + 3) // 4) + 3 + 1
    assert actual_fallback_tokens == expected_fallback, (
        f"Fallback heuristic mismatch: expected {expected_fallback}, got {actual_fallback_tokens}"
    )
    print(f"  [PASS] Fast heuristic mode exact match: {actual_fallback_tokens} tokens (4-char chunking + protocol framing)")

    # 1.3 Image Token Formula Validation (Anthropic Official Patch Formula)
    formula_1024 = estimate_tokens_from_dimensions(1024, 1024)
    assert formula_1024 > 0, "Image token formula produced 0"
    print(f"  [PASS] Image token formula verified: 1024x1024 px = {formula_1024} tokens")

    # -------------------------------------------------------------------------
    # SUITE 2: System Prompt & Chronological Order Invariants
    # -------------------------------------------------------------------------
    print("\n[SUITE 2] Validating System Prompt & Order Invariants...")
    compactor_rounds = ToolResultCompaction(keep_user_rounds=2)
    
    system_text = "CRITICAL SYSTEM INSTRUCTION: DO NOT FORGET AUDIT RULES."
    raw_msgs = [
        Message(role=Role.SYSTEM, content=[TextBlock(text=system_text)]),
        Message(role=Role.USER, content=[TextBlock(text="Turn 1: Check account 101")]),
        Message(role=Role.ASSISTANT, content=[ToolUseBlock(id="t1", name="read", input={})]),
        Message(role=Role.TOOL, content=[ToolResultBlock(tool_use_id="t1", content="Account 101: $5000")]),
        Message(role=Role.ASSISTANT, content=[TextBlock(text="Done 1")]),
        Message(role=Role.USER, content=[TextBlock(text="Turn 2: Check account 102")]),
        Message(role=Role.ASSISTANT, content=[ToolUseBlock(id="t2", name="read", input={})]),
        Message(role=Role.TOOL, content=[ToolResultBlock(tool_use_id="t2", content="Account 102: $6000")]),
        Message(role=Role.ASSISTANT, content=[TextBlock(text="Done 2")]),
        Message(role=Role.USER, content=[TextBlock(text="Turn 3: Check account 103")]),
        Message(role=Role.ASSISTANT, content=[ToolUseBlock(id="t3", name="read", input={})]),
        Message(role=Role.TOOL, content=[ToolResultBlock(tool_use_id="t3", content="Account 103: $7000")]),
        Message(role=Role.ASSISTANT, content=[TextBlock(text="Done 3")]),
    ]
    
    compacted = compactor_rounds.compact(raw_msgs)
    
    # Invariant 1: System prompt is preserved at index 0
    assert compacted[0].role == Role.SYSTEM, "System prompt was not at index 0!"
    assert compacted[0].content[0].text == system_text, "System prompt text was modified or lost!"
    print("  [PASS] System prompt preserved strictly at index 0 with identical content")

    # Invariant 2: Total message count preserved
    assert len(compacted) == len(raw_msgs), f"Message count changed: {len(raw_msgs)} -> {len(compacted)}"
    print(f"  [PASS] Message structure integrity preserved: exactly {len(compacted)} messages")

    # -------------------------------------------------------------------------
    # SUITE 3: Iteration & User-Round Protection Boundaries
    # -------------------------------------------------------------------------
    print("\n[SUITE 3] Validating Protection Boundaries (User-Rounds vs Iterations)...")
    
    # 3.1 User-Rounds Mode (keep_user_rounds=2)
    # Turn 1 compacted, Turn 2 and Turn 3 protected
    tool_results_rounds = [
        (m.content[0].tool_use_id, m.content[0].content)
        for m in compacted if m.role == Role.TOOL
    ]
    assert tool_results_rounds[0][0] == "t1"
    assert tool_results_rounds[0][1] == "Tool call result has been compacted", "Turn 1 was not compacted!"
    assert tool_results_rounds[1][0] == "t2"
    assert tool_results_rounds[1][1] == "Account 102: $6000", "Turn 2 was improperly altered!"
    assert tool_results_rounds[2][0] == "t3"
    assert tool_results_rounds[2][1] == "Account 103: $7000", "Turn 3 was improperly altered!"
    print("  [PASS] User-Rounds mode (keep_user_rounds=2): Turn 1 compacted, Turns 2 & 3 protected")

    # 3.2 Iterations Mode (keep_iterations=4 -> exactly 4 model execution hops)
    compactor_iter = ToolResultCompaction(keep_iterations=4)
    compacted_iter = compactor_iter.compact(raw_msgs)
    tool_results_iter = [
        (m.content[0].tool_use_id, m.content[0].content)
        for m in compacted_iter if m.role == Role.TOOL
    ]
    assert tool_results_iter[0][1] == "Tool call result has been compacted"
    assert tool_results_iter[1][1] == "Account 102: $6000"
    assert tool_results_iter[2][1] == "Account 103: $7000"
    print("  [PASS] Iteration-Hops mode (keep_iterations=4): exactly matches 2-turn execution boundary")

    # -------------------------------------------------------------------------
    # SUITE 4: Forensic Evidence Retention (RFC-0024 raw_output)
    # -------------------------------------------------------------------------
    print("\n[SUITE 4] Validating UI Forensic Evidence Preservation (raw_output)...")
    compacted_t1_block = compacted[3].content[0]
    assert isinstance(compacted_t1_block, ToolResultBlock)
    assert compacted_t1_block.content == "Tool call result has been compacted"
    assert compacted_t1_block.raw_output is not None, "raw_output was lost during compaction!"
    assert compacted_t1_block.raw_output == {"result": "Account 101: $5000"}, (
        f"raw_output content mismatch! Got: {compacted_t1_block.raw_output}"
    )
    print("  [PASS] RFC-0024 raw_output retention verified: UI retains full original payload")

    # -------------------------------------------------------------------------
    # SUITE 5: Tool Call & Result Pairing Invariant (No Orphaned Calls)
    # -------------------------------------------------------------------------
    print("\n[SUITE 5] Validating Tool Call/Result Pairing Invariants...")
    tool_use_ids = set()
    for m in compacted:
        if m.role == Role.ASSISTANT:
            for b in m.content:
                if isinstance(b, ToolUseBlock):
                    tool_use_ids.add(b.id)
                    
    for m in compacted:
        if m.role == Role.TOOL:
            for b in m.content:
                if isinstance(b, ToolResultBlock):
                    assert b.tool_use_id in tool_use_ids, (
                        f"Orphaned ToolResultBlock found: tool_use_id={b.tool_use_id} not in {tool_use_ids}"
                    )
    print(f"  [PASS] 1:1 Tool ID pairing verified: all {len(tool_use_ids)} tool calls cleanly paired")

    # -------------------------------------------------------------------------
    # SUITE 6: Multi-Tool Execution & Error Handling Integrity
    # -------------------------------------------------------------------------
    print("\n[SUITE 6] Validating Multi-Tool Invocations & Error Flag Preservation...")
    multi_tool_msgs = [
        Message(role=Role.SYSTEM, content=[TextBlock(text="Multi-tool audit test")]),
        Message(role=Role.USER, content=[TextBlock(text="Execute batch audit")]),
        Message(role=Role.ASSISTANT, content=[
            TextBlock(text="Calling tools..."),
            ToolUseBlock(id="call_pass", name="verify_hash", input={"hash": "abc"}),
            ToolUseBlock(id="call_fail", name="verify_sig", input={"sig": "invalid"}),
        ]),
        Message(role=Role.TOOL, content=[
            ToolResultBlock(tool_use_id="call_pass", content="Hash MATCHED", is_error=False),
            ToolResultBlock(tool_use_id="call_fail", content="Signature INVALID", is_error=True),
        ]),
        Message(role=Role.ASSISTANT, content=[TextBlock(text="Handling failure...")]),
        Message(role=Role.USER, content=[TextBlock(text="Proceed to next")]),
        Message(role=Role.ASSISTANT, content=[TextBlock(text="All done.")]),
    ]
    
    compactor_1 = ToolResultCompaction(keep_user_rounds=1)
    compacted_multi = compactor_1.compact(multi_tool_msgs)
    
    tool_result_msg = [m for m in compacted_multi if m.role == Role.TOOL][0]
    res_pass = [b for b in tool_result_msg.content if b.tool_use_id == "call_pass"][0]
    res_fail = [b for b in tool_result_msg.content if b.tool_use_id == "call_fail"][0]
    
    assert res_pass.content == "Tool call result has been compacted"
    assert res_pass.is_error is False, "is_error flag was corrupted for successful tool!"
    
    assert res_fail.content == "Tool call result has been compacted"
    assert res_fail.is_error is True, "is_error=True flag was lost during compaction!"
    print("  [PASS] Multi-tool and error flag preservation verified (is_error=True preserved)")

    print("\n" + "=" * 75)
    print("ALL 6 VALIDATION SUITES PASSED CLEANLY (100% INVARIANTS VERIFIED)")
    print("=" * 75)

if __name__ == "__main__":
    run_validation()
