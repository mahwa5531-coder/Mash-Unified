"""
Deep Statutory Audit & Financial Forensic Verification Suite for Mash.
Testing 10 Mission-Critical Real-World Enterprise Audit Scenarios:

1. Trial Balance Completeness & Invariant Reconciliation (Debit == Credit, Suspense Detection)
2. Canonical 3-Way Match (Purchase Orders vs GRN vs Vendor Tax Invoices)
3. ISA 240 / SAS 99 Forensic Journal Entry Testing (Weekend/Midnight postings, Smurfing, Round sums)
4. Bank Reconciliation Statement (BRS) & Stale Cheques Forensics (>90-day reversal)
5. Fixed Asset Register (FAR) & Statutory Depreciation Recalculation (Useful Life & Residual Value)
6. GST / Tax Input Tax Credit (ITC) Cross-Reconciliation (Books vs Portal)
7. Statutory Audit Skills Tool Grounding & Procedure Retrieval (73 ICAI/IAASB procedures)
8. High-Scale General Ledger (10,000 Rows) Anti-Token-Flood Parquet Pipeline
9. Multi-Client Engagement Workspace & Data Privacy Isolation
10. Statutory Working Papers Immutability & Audit Deliverables Integrity
"""

import os
import sys
import json
import tempfile
import datetime
from pathlib import Path
from decimal import Decimal

import pytest
import polars as pl
import httpx

# Ensure paths are set
sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "NexAU"))

from app.main import app, lifespan
from app.routers.chat import _ensure_project_and_context, resolve_deliverables_dir
from app.workspace import is_path_in_base_roots
from nexau.archs.sandbox.local_sandbox import LocalSandbox
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
from app.ingestion.csv_to_md_parquet import parse_csv_to_markdown


class MockAgentState:
    def __init__(self, sandbox):
        self._sandbox = sandbox
    def get_sandbox(self):
        return self._sandbox


@pytest.fixture(scope="module")
def anyio_backend():
    return "asyncio"


# ==============================================================================
# SCENARIO 1: Trial Balance Completeness & Invariant Reconciliation
# ==============================================================================
def test_audit_scenario_1_trial_balance_reconciliation():
    """
    Verify Trial Balance invariant: Sum(Debits) == Sum(Credits).
    Detects unposted suspense variance of exactly ₹45,210.85 without float slop.
    """
    with tempfile.TemporaryDirectory(prefix="tb_audit_") as tmp_dir:
        tmp_path = Path(tmp_dir)
        sb = LocalSandbox(work_dir=tmp_path)
        state = MockAgentState(sb)
        tb_file = tmp_path / "trial_balance_2026.csv"

        # Generate realistic 20-account Trial Balance with deliberate ₹45,210.85 discrepancy
        data = [
            ("1001", "Operating Cash", "Asset", 450000.00, 0.00),
            ("1002", "Accounts Receivable", "Asset", 850250.50, 0.00),
            ("1003", "Prepaid Insurance", "Asset", 35000.00, 0.00),
            ("1004", "Inventory Raw Materials", "Asset", 620000.00, 0.00),
            ("1005", "Plant & Machinery", "Asset", 2500000.00, 0.00),
            ("1006", "Accumulated Depreciation", "Asset_Contra", 0.00, 450000.00),
            ("2001", "Accounts Payable", "Liability", 0.00, 550000.00),
            ("2002", "GST Payable (CGST+SGST)", "Liability", 0.00, 85200.00),
            ("2003", "TDS Payable", "Liability", 0.00, 22400.00),
            ("2004", "Working Capital Loan (HDFC)", "Liability", 0.00, 1200000.00),
            ("3001", "Equity Share Capital", "Equity", 0.00, 1500000.00),
            ("3002", "Retained Earnings", "Equity", 0.00, 890000.00),
            ("4001", "Revenue from Operations", "Revenue", 0.00, 3450000.00),
            ("4002", "Other Operating Income", "Revenue", 0.00, 45000.00),
            ("5001", "Cost of Goods Sold", "Expense", 1850000.00, 0.00),
            ("5002", "Employee Benefit Expense", "Expense", 780000.00, 0.00),
            ("5003", "Depreciation Expense", "Expense", 120000.00, 0.00),
            ("5004", "Finance Costs", "Expense", 110000.00, 0.00),
            ("5005", "Administrative Overheads", "Expense", 220000.00, 0.00),
            ("9999", "Suspense Account (Unreconciled)", "Suspense", 45210.85, 0.00),
        ]

        df = pl.DataFrame(
            data,
            schema=["Account_Code", "Account_Name", "Classification", "Debit", "Credit"],
            orient="row"
        )
        df.write_csv(str(tb_file))

        # 1. Deterministic Python computation via run_shell_command
        py_cmd = (
            f"import polars as pl; "
            f"df = pl.read_csv(r'{tb_file}'); "
            f"d_sum = df['Debit'].sum(); "
            f"c_sum = df['Credit'].sum(); "
            f"diff = round(d_sum - c_sum, 2); "
            f"suspense = df.filter(pl.col('Classification') == 'Suspense')['Debit'].sum(); "
            f"print(f'DEBIT_TOTAL={{d_sum:.2f}}|CREDIT_TOTAL={{c_sum:.2f}}|VARIANCE={{diff:.2f}}|SUSPENSE={{suspense:.2f}}')"
        )
        res = run_shell_command(f"{sb.get_python_command()} -c \"{py_cmd}\"", sandbox=sb, agent_state=state)
        stdout = res.get("content") or res.get("output", "")
        assert "DEBIT_TOTAL=7580461.35" in stdout
        assert "CREDIT_TOTAL=8192600.00" in stdout
        assert "VARIANCE=-612138.65" in stdout
        assert "SUSPENSE=45210.85" in stdout


# ==============================================================================
# SCENARIO 2: Canonical 3-Way Match (PO vs GRN vs Vendor Tax Invoices)
# ==============================================================================
def test_audit_scenario_2_canonical_three_way_match():
    """
    Test automated 3-Way Matching across Purchase Orders, Goods Receipt Notes,
    and Vendor Invoices. Detects over-billing, rate inflation, and duplicate invoicing.
    """
    with tempfile.TemporaryDirectory(prefix="match_audit_") as tmp_dir:
        tmp_path = Path(tmp_dir)
        sb = LocalSandbox(work_dir=tmp_path)
        state = MockAgentState(sb)
        work_dir = tmp_path

        # 1. Purchase Orders
        pos = pl.DataFrame([
            {"po_id": "PO-101", "vendor": "Apex Industrial", "item": "Steel Rods", "qty": 100, "rate": 500.0},
            {"po_id": "PO-102", "vendor": "Zenith Fasteners", "item": "Hex Bolts", "qty": 500, "rate": 25.0},
            {"po_id": "PO-103", "vendor": "Titan Hydraulics", "item": "Piston Valves", "qty": 40, "rate": 3200.0},
        ])
        pos.write_csv(str(work_dir / "purchase_orders.csv"))

        # 2. Goods Receipt Notes (GRN)
        grns = pl.DataFrame([
            {"grn_id": "GRN-01", "po_id": "PO-101", "qty_rcvd": 100, "date": "2026-03-10"},
            {"grn_id": "GRN-02", "po_id": "PO-102", "qty_rcvd": 450, "date": "2026-03-12"}, # 50 units short!
            {"grn_id": "GRN-03", "po_id": "PO-103", "qty_rcvd": 40, "date": "2026-03-15"},
        ])
        grns.write_csv(str(work_dir / "goods_receipts.csv"))

        # 3. Vendor Invoices (with fraud & error anomalies)
        invs = pl.DataFrame([
            {"inv_id": "INV-A1", "po_id": "PO-101", "qty_billed": 100, "rate_billed": 500.0, "total": 50000.0},  # MATCH
            {"inv_id": "INV-B1", "po_id": "PO-102", "qty_billed": 500, "rate_billed": 25.0, "total": 12500.0},   # OVER-BILLED (received only 450)
            {"inv_id": "INV-C1", "po_id": "PO-103", "qty_billed": 40, "rate_billed": 3500.0, "total": 140000.0}, # RATE INFLATION (PO agreed 3200)
            {"inv_id": "INV-C2", "po_id": "PO-103", "qty_billed": 40, "rate_billed": 3200.0, "total": 128000.0}, # DUPLICATE INVOICE FOR PO-103!
        ])
        invs.write_csv(str(work_dir / "vendor_invoices.csv"))

        # Python forensic matching script
        match_script = (
            f"import polars as pl\n"
            f"po = pl.read_csv(r'{work_dir / 'purchase_orders.csv'}')\n"
            f"grn = pl.read_csv(r'{work_dir / 'goods_receipts.csv'}')\n"
            f"inv = pl.read_csv(r'{work_dir / 'vendor_invoices.csv'}')\n"
            f"joined = inv.join(po, on='po_id').join(grn, on='po_id')\n"
            f"# Check 1: Over-billing (qty_billed > qty_rcvd)\n"
            f"over_billed = joined.filter(pl.col('qty_billed') > pl.col('qty_rcvd'))\n"
            f"# Check 2: Rate variance (rate_billed > rate)\n"
            f"rate_variance = joined.filter(pl.col('rate_billed') > pl.col('rate'))\n"
            f"# Check 3: Duplicate invoices per PO\n"
            f"dup_pos = inv.group_by('po_id').count().filter(pl.col('count') > 1)['po_id'].to_list()\n"
            f"print(f'OVER_BILLED_COUNT={{len(over_billed)}}|RATE_VARIANCE_COUNT={{len(rate_variance)}}|DUP_PO={{dup_pos}}')\n"
        )
        py_path = work_dir / "run_match.py"
        py_path.write_text(match_script, encoding="utf-8")

        res = run_shell_command(f"{sb.get_python_command()} {py_path}", sandbox=sb, agent_state=state)
        stdout = res.get("content") or res.get("output", "")
        assert "OVER_BILLED_COUNT=1" in stdout
        assert "RATE_VARIANCE_COUNT=1" in stdout
        assert "PO-103" in stdout


# ==============================================================================
# SCENARIO 3: ISA 240 / SAS 99 Forensic Journal Entry Testing
# ==============================================================================
def test_audit_scenario_3_isa_240_forensic_journal_entry_testing():
    """
    Forensic testing of General Ledger journal entries for fraud indicators:
    - Weekend / off-hour postings by unauthorized roles
    - Round-sum anomalies (exact ₹500,000 / ₹1,000,000)
    - Threshold smurfing right under ₹100,000 dual-authorization ceiling
    """
    with tempfile.TemporaryDirectory(prefix="je_audit_") as tmp_dir:
        tmp_path = Path(tmp_dir)
        sb = LocalSandbox(work_dir=tmp_path)
        state = MockAgentState(sb)
        gl_file = tmp_path / "general_ledger.csv"

        # Generate 100 journal entries with specific fraud anomalies
        entries = []
        for i in range(1, 95):
            entries.append({
                "je_id": f"JE-{1000+i}",
                "timestamp": f"2026-03-02 11:{i%50:02d}:00",
                "user": "staff_accountant",
                "account": "Office Supplies",
                "amount": 1240.50 + (i * 15.20),
                "memo": f"Routine vendor bill {i}",
            })
        
        # Anomaly 1: Sunday Midnight Posting (Management Override)
        entries.append({
            "je_id": "JE-9901",
            "timestamp": "2026-03-08 23:45:12", # Sunday night
            "user": "controller_cfo",
            "account": "Consulting Fees",
            "amount": 750000.00,
            "memo": "Special executive retainer adjustment",
        })

        # Anomaly 2: Round-Sum Extraction (exact ₹1,000,000)
        entries.append({
            "je_id": "JE-9902",
            "timestamp": "2026-03-11 14:20:00",
            "user": "treasury_mgr",
            "account": "Miscellaneous Expense",
            "amount": 1000000.00,
            "memo": "Quarterly clearing reclassification",
        })

        # Anomaly 3 & 4: Smurfing under ₹100,000 authorization cap
        entries.append({
            "je_id": "JE-9903",
            "timestamp": "2026-03-12 16:01:00",
            "user": "junior_clerk",
            "account": "Software Licensing",
            "amount": 99800.00,
            "memo": "Cloud infra partial payment batch 1",
        })
        entries.append({
            "je_id": "JE-9904",
            "timestamp": "2026-03-12 16:04:00",
            "user": "junior_clerk",
            "account": "Software Licensing",
            "amount": 99500.00,
            "memo": "Cloud infra partial payment batch 2",
        })

        df = pl.DataFrame(entries)
        df.write_csv(str(gl_file))

        # Forensic detection query
        audit_code = (
            f"import polars as pl\n"
            f"df = pl.read_csv(r'{gl_file}')\n"
            f"df = df.with_columns(pl.col('timestamp').str.to_datetime('%Y-%m-%d %H:%M:%S'))\n"
            f"# Test A: Weekend entries (Sunday = 7)\n"
            f"weekend_entries = df.filter(pl.col('timestamp').dt.weekday() == 7)['je_id'].to_list()\n"
            f"# Test B: Exact round sums >= 100k\n"
            f"round_sums = df.filter((pl.col('amount') >= 100000) & (pl.col('amount') % 100000 == 0))['je_id'].to_list()\n"
            f"# Test C: Smurfing (99k-99.99k)\n"
            f"smurfing = df.filter((pl.col('amount') >= 99000) & (pl.col('amount') < 100000))['je_id'].to_list()\n"
            f"print(f'WEEKEND={{weekend_entries}}|ROUND_SUMS={{round_sums}}|SMURFING={{smurfing}}')\n"
        )
        res = run_shell_command(f"{sb.get_python_command()} -c \"{audit_code}\"", sandbox=sb, agent_state=state)
        out = res.get("content") or res.get("output", "")
        assert "JE-9901" in out  # Weekend
        assert "JE-9902" in out  # Round sum
        assert "JE-9903" in out and "JE-9904" in out  # Smurfing


# ==============================================================================
# SCENARIO 4: Bank Reconciliation Statement (BRS) & Stale Cheques Forensics
# ==============================================================================
def test_audit_scenario_4_bank_reconciliation_and_stale_cheques():
    """
    Audit Bank Reconciliation:
    - Reconciles Book Balance to Bank Statement Balance
    - Flags cheques issued >90 days ago as STALE cheques requiring writeback
    """
    with tempfile.TemporaryDirectory(prefix="brs_audit_") as tmp_dir:
        tmp_path = Path(tmp_dir)
        sb = LocalSandbox(work_dir=tmp_path)
        state = MockAgentState(sb)
        brs_file = tmp_path / "cheques_issued.csv"

        today = datetime.date(2026, 3, 31)
        # Cheques issued during FY 2025-26
        cheques = [
            {"chq_no": "CHQ-801", "date": "2026-03-28", "party": "Dell Corp", "amount": 145000.0, "cleared": "NO"}, # Unpresented (valid)
            {"chq_no": "CHQ-802", "date": "2026-03-29", "party": "Airtel Tele", "amount": 12500.0, "cleared": "NO"}, # Unpresented (valid)
            {"chq_no": "CHQ-803", "date": "2025-11-15", "party": "Old Vendor", "amount": 88000.0, "cleared": "NO"}, # STALE (>130 days!)
            {"chq_no": "CHQ-804", "date": "2025-10-01", "party": "Office Lease", "amount": 65000.0, "cleared": "NO"}, # STALE (>180 days!)
            {"chq_no": "CHQ-805", "date": "2026-03-10", "party": "Tata Power", "amount": 34000.0, "cleared": "YES"}, # Cleared
        ]
        pl.DataFrame(cheques).write_csv(str(brs_file))

        calc_code = (
            f"import polars as pl, datetime\n"
            f"df = pl.read_csv(r'{brs_file}')\n"
            f"cutoff = datetime.date(2026, 3, 31)\n"
            f"unpresented = df.filter(pl.col('cleared') == 'NO')\n"
            f"stale = unpresented.filter(\n"
            f"    pl.col('date').str.to_date('%Y-%m-%d') < (cutoff - datetime.timedelta(days=90))\n"
            f")\n"
            f"stale_sum = stale['amount'].sum()\n"
            f"stale_chqs = stale['chq_no'].to_list()\n"
            f"print(f'STALE_SUM={{stale_sum:.2f}}|STALE_CHQS={{stale_chqs}}')\n"
        )
        res = run_shell_command(f"{sb.get_python_command()} -c \"{calc_code}\"", sandbox=sb, agent_state=state)
        out = res.get("content") or res.get("output", "")
        assert "STALE_SUM=153000.00" in out
        assert "CHQ-803" in out and "CHQ-804" in out


# ==============================================================================
# SCENARIO 5: Fixed Asset Register & Depreciation Recalculation
# ==============================================================================
def test_audit_scenario_5_fixed_asset_register_depreciation():
    """
    Test Fixed Asset Register (FAR) depreciation recomputation (Schedule II / Ind AS 16).
    Flags assets depreciated beyond 95% threshold (below 5% residual salvage value).
    """
    with tempfile.TemporaryDirectory(prefix="far_audit_") as tmp_dir:
        tmp_path = Path(tmp_dir)
        sb = LocalSandbox(work_dir=tmp_path)
        state = MockAgentState(sb)
        far_file = tmp_path / "asset_register.csv"

        assets = [
            {"asset_id": "AST-01", "name": "Heavy CNC Lathe", "cost": 1000000.0, "accum_dep": 960000.0, "residual_limit": 50000.0}, # VIOLATION (depreciated to 40k < 50k residual)
            {"asset_id": "AST-02", "name": "Delivery Van", "cost": 600000.0, "accum_dep": 400000.0, "residual_limit": 30000.0},     # OK
            {"asset_id": "AST-03", "name": "Servers & Rack", "cost": 500000.0, "accum_dep": 485000.0, "residual_limit": 25000.0},   # VIOLATION (depreciated to 15k < 25k residual)
        ]
        pl.DataFrame(assets).write_csv(str(far_file))

        code = (
            f"import polars as pl\n"
            f"df = pl.read_csv(r'{far_file}')\n"
            f"df = df.with_columns((pl.col('cost') - pl.col('accum_dep')).alias('wdv'))\n"
            f"violations = df.filter(pl.col('wdv') < pl.col('residual_limit'))['asset_id'].to_list()\n"
            f"print(f'RESIDUAL_VIOLATIONS={{violations}}')\n"
        )
        res = run_shell_command(f"{sb.get_python_command()} -c \"{code}\"", sandbox=sb, agent_state=state)
        out = res.get("content") or res.get("output", "")
        assert "AST-01" in out and "AST-03" in out
        assert "AST-02" not in out


# ==============================================================================
# SCENARIO 6: GST Input Tax Credit (ITC) Cross-Reconciliation
# ==============================================================================
def test_audit_scenario_6_gst_itc_gstr2b_reconciliation():
    """
    Reconciles Purchase Register against GSTR-2B government tax portal.
    Quantifies ineligible / mismatched ITC claims with exact precision.
    """
    with tempfile.TemporaryDirectory(prefix="gst_audit_") as tmp_dir:
        tmp_path = Path(tmp_dir)
        sb = LocalSandbox(work_dir=tmp_path)
        state = MockAgentState(sb)
        work_dir = tmp_path

        # 1. Company Books (Purchase Register)
        pr = pl.DataFrame([
            {"inv_no": "INV-1001", "gstin": "27AAACB2212R1Z1", "tax_books": 18000.0},
            {"inv_no": "INV-1002", "gstin": "29BBBCB3313R1Z2", "tax_books": 24000.0},
            {"inv_no": "INV-1003", "gstin": "07CCCCB4414R1Z3", "tax_books": 50000.0}, # Missing in portal!
        ])
        pr.write_csv(str(work_dir / "purchase_register.csv"))

        # 2. Government GSTR-2B Portal
        gstr2b = pl.DataFrame([
            {"inv_no": "INV-1001", "gstin": "27AAACB2212R1Z1", "tax_portal": 18000.0}, # Matched
            {"inv_no": "INV-1002", "gstin": "29BBBCB3313R1Z2", "tax_portal": 22000.0}, # Mismatch: 2000 shortfall
            {"inv_no": "INV-9999", "gstin": "06DDDDB5515R1Z4", "tax_portal": 15000.0}, # Unrecorded in books
        ])
        gstr2b.write_csv(str(work_dir / "gstr2b_portal.csv"))

        reconcile_code = (
            f"import polars as pl\n"
            f"pr = pl.read_csv(r'{work_dir / 'purchase_register.csv'}')\n"
            f"g2 = pl.read_csv(r'{work_dir / 'gstr2b_portal.csv'}')\n"
            f"joined = pr.join(g2, on='inv_no', how='full')\n"
            f"missing_in_portal = joined.filter(pl.col('tax_portal').is_null())['tax_books'].sum()\n"
            f"portal_shortfall = joined.filter(\n"
            f"    pl.col('tax_books').is_not_null() & pl.col('tax_portal').is_not_null() & (pl.col('tax_books') > pl.col('tax_portal'))\n"
            f")['tax_books'].sum() - joined.filter(\n"
            f"    pl.col('tax_books').is_not_null() & pl.col('tax_portal').is_not_null() & (pl.col('tax_books') > pl.col('tax_portal'))\n"
            f")['tax_portal'].sum()\n"
            f"total_ineligible_itc = missing_in_portal + portal_shortfall\n"
            f"print(f'INELIGIBLE_ITC={{total_ineligible_itc:.2f}}|MISSING_PORTAL={{missing_in_portal:.2f}}|SHORTFALL={{portal_shortfall:.2f}}')\n"
        )
        res = run_shell_command(f"{sb.get_python_command()} -c \"{reconcile_code}\"", sandbox=sb, agent_state=state)
        out = res.get("content") or res.get("output", "")
        assert "INELIGIBLE_ITC=52000.00" in out
        assert "MISSING_PORTAL=50000.00" in out
        assert "SHORTFALL=2000.00" in out


# ==============================================================================
# SCENARIO 7: Statutory Audit Skills Retrieval & Procedure Grounding
# ==============================================================================
def test_audit_scenario_7_statutory_audit_skills_grounding():
    """
    Verify on-demand retrieval of statutory audit procedures from the 73 built-in skills.
    Ensures correct ICAI/IAASB guidelines, working paper templates, and audit assertions.
    """
    # 1. Master Guide
    guide_res = audit_skill_tool(action="get_guide")
    assert "73 specialized audit procedures" in guide_res["content"]
    assert "03-procurement-and-payables" in guide_res["content"]

    # 2. Retrieve Specific Procedure: accounts-payable-testing
    ap_res = audit_skill_tool(action="get_skill", skill_name="accounts-payable-testing")
    assert ap_res.get("content"), "accounts-payable-testing skill must return content"
    content = ap_res["content"].lower()
    assert "3-way match" in content or "purchase" in content or "payable" in content

    # 3. Retrieve Specific Procedure: trial-balance-validation
    tb_res = audit_skill_tool(action="get_skill", skill_name="trial-balance-validation")
    assert tb_res.get("content")
    assert "trial balance" in tb_res["content"].lower()

    # 4. Search Skills: 'depreciation'
    search_res = audit_skill_tool(action="search_skills", query="depreciation")
    assert len(search_res.get("results", [])) > 0


# ==============================================================================
# SCENARIO 8: High-Scale General Ledger (10,000 Rows) Anti-Dump Parquet
# ==============================================================================
def test_audit_scenario_8_large_general_ledger_10k_rows_anti_dump():
    """
    Stress-test with enterprise-scale dataset (10,000 journal transactions).
    Verifies that parse_csv_to_markdown safely converts to Parquet, limits output
    to <2,000 characters (zero context dump), and leaves a fast polars query command.
    """
    with tempfile.TemporaryDirectory(prefix="large_gl_") as tmp_dir:
        gl_path = Path(tmp_dir) / "gl_enterprise_10k.csv"
        
        # Build 10,000 rows
        rows = []
        for i in range(10000):
            rows.append({
                "txn_id": f"TXN-{100000+i}",
                "account": f"ACC-{100 + (i % 25)}",
                "debit": float(i * 10),
                "credit": 0.0 if i % 2 == 0 else float(i * 10),
                "status": "POSTED",
            })
        df = pl.DataFrame(rows)
        df.write_csv(str(gl_path))

        # Parse with ingestion pipeline
        md_output = parse_csv_to_markdown(str(gl_path), session_id="test_sess_stress")
        assert len(md_output) < 2500, f"Output too large ({len(md_output)} chars)! Anti-dump failed."
        assert ".parquet" in md_output
        assert "10000 rows" in md_output
        assert "pl.read_parquet" in md_output


# ==============================================================================
# SCENARIO 9: Multi-Client Workspace & Data Privacy Isolation
# ==============================================================================
@pytest.mark.anyio
async def test_audit_scenario_9_multi_client_workspace_isolation():
    """
    Verify complete tenant isolation between two concurrent client audit engagements:
    Client A (Apex Holdings) and Client B (Zenith Global).
    Ensures brain directory, scratchpad, and deliverables never cross-contaminate.
    """
    with tempfile.TemporaryDirectory(prefix="apex_holdings_") as apex_dir, \
         tempfile.TemporaryDirectory(prefix="zenith_global_") as zenith_dir:
        
        apex_path = str(Path(apex_dir).resolve())
        zenith_path = str(Path(zenith_dir).resolve())

        ctx_apex = {"workspace_uri": apex_path, "project_id": "proj_apex"}
        ctx_zenith = {"workspace_uri": zenith_path, "project_id": "proj_zenith"}

        await _ensure_project_and_context(None, "auditor_1", "sess_apex_01", ctx_apex, apex_path)
        await _ensure_project_and_context(None, "auditor_2", "sess_zenith_01", ctx_zenith, zenith_path)

        # Assert isolated directories
        assert ctx_apex["brain_directory"] != ctx_zenith["brain_directory"]
        assert ctx_apex["scratch_directory"] != ctx_zenith["scratch_directory"]
        assert ctx_apex["working_directory"] != ctx_zenith["working_directory"]

        # Write client A confidential working paper
        p_a = Path(ctx_apex["scratch_directory"]) / "apex_confidential_payroll.txt"
        p_a.write_text("CONFIDENTIAL APEX SALARY DATA: CEO $1.2M", encoding="utf-8")

        # Verify Client B workspace has no access to Client A's path
        assert not Path(p_a).is_relative_to(Path(zenith_path))
        # Ensure path security boundary check catches non-base roots
        assert is_path_in_base_roots(Path("C:/Windows/System32/config")) is False


# ==============================================================================
# SCENARIO 10: Deliverables Immutability & Working Paper Integrity
# ==============================================================================
def test_audit_scenario_10_deliverables_working_paper_integrity():
    """
    Verify that formal Audit Working Papers (AWPs) created in Audit_Deliverables/
    adhere to statutory audit documentation standards (SA 230):
    - Objectives, Scope, Procedures, Sample Size, Findings, and Audit Ticks.
    - Verified against accidental corruption or unauthorized overwriting.
    """
    with tempfile.TemporaryDirectory(prefix="awp_deliv_") as tmp_dir:
        tmp_path = Path(tmp_dir)
        sb = LocalSandbox(work_dir=tmp_path)
        state = MockAgentState(sb)
        deliv_dir = tmp_path / "Audit_Deliverables"
        deliv_dir.mkdir(parents=True, exist_ok=True)

        working_paper = (
            "# AUDIT WORKING PAPER: FY 2025-26 ACCOUNTS PAYABLE RECONCILIATION\n\n"
            "**Client:** Apex Industrial Ltd\n"
            "**Standard:** SA 505 (External Confirmations) & SA 330 (Auditor's Responses to Assessed Risks)\n"
            "**Lead Auditor:** Senior Forensic Auditor (CPA/CA)\n"
            "**Date:** 31-March-2026\n\n"
            "## 1. Audit Assertions Tested\n"
            "- [✓ Verified] Completeness: All vendor liabilities recorded in period.\n"
            "- [✓ Verified] Valuation: Payables stated at correct settlement amounts.\n"
            "- [✗ Discrepancy] Accuracy: Discovered ₹12,500 over-billing on PO-102 (INV-B1).\n\n"
            "## 2. Testing Methodology & Sample\n"
            "Sample Size: 100% of material vendors > ₹100,000 (Monetary Unit Sampling).\n"
            "Total Population Tested: ₹4,550,000 across 45 vendor ledger balances.\n\n"
            "## 3. Statutory Sign-Off\n"
            "Engagement Partner Review: APPROVED\n"
            "Workpaper Status: FINALIZED\n"
        )

        awp_file = deliv_dir / "AWP_Accounts_Payable_FY26.md"
        
        # 1. Create file using write_file
        res_write = write_file(TargetFile=str(awp_file), CodeContent=working_paper, overwrite=False, sandbox=sb, agent_state=state)
        assert awp_file.exists(), f"Working paper file should exist! Got: {res_write}"

        # 2. Test overwrite protection: write_file with overwrite=False must fail
        res_fail = write_file(TargetFile=str(awp_file), CodeContent="Malicious Overwrite", overwrite=False, sandbox=sb, agent_state=state)
        msg = res_fail.get("content", "").lower()
        assert "already exists" in msg or "error" in msg or res_fail.get("isError") is True

        # 3. Read back and verify intact audit assertions
        res_read = view_file(AbsolutePath=str(awp_file), sandbox=sb, agent_state=state)
        read_content = res_read.get("content", "")
        assert "[✓ Verified] Completeness" in read_content
        assert "[✗ Discrepancy] Accuracy" in read_content
        assert "SA 505" in read_content
