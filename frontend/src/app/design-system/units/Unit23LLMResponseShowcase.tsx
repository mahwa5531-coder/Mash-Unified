"use client";

import React from 'react';
import { AssistantProse } from '@/features/chat/components/messages/AssistantProse';

const SAMPLE_LLM_OUTPUT = `## Executive Summary: Q4 Statutory Audit & Reconciliation

**Audit Posture:** [PASS] Substantive testing of **$14,250,800.00** total transaction volume completed across 12 ledger accounts. Net reconciliation variance isolated to **$18,450.00** (0.13% of population), within the performance materiality threshold of **$50,000.00**.

> [!EXCEPTION] Material Physical Inventory Discrepancy
> Physical count at Warehouse B shows an unexplained shortfall of **$45,200.00** against perpetual inventory records. Perpetual balances were not updated for damaged goods disposal.
> — ISA 501 Audit Evidence / Ref: WP-402

---

## 1. Substantive Testing & Account Summary

Substantive verification procedures performed on general ledger balances as of December 31, 2026. All material quantitative figures verified deterministically using $Variance = \\frac{|Actual - Budget|}{Budget} \\times 100\\%$:

| Account Description | GL Code | Balance ($) | Variance (%) | Audit Status |
| :--- | :---: | ---: | ---: | :---: |
| Cash & Cash Equivalents | 1010 | 1,245,800.00 | +4.2% | [VERIFIED] |
| Accounts Receivable | 1100 | 3,890,450.00 | -1.1% | [PASS] |
| Perpetual Merchandise Inventory | 1200 | 4,120,500.00 | -5.8% | [EXCEPTION] |
| Trade Accounts Payable | 2010 | (2,450,150.00) | +0.4% | [VERIFIED] |
| Accrued Payroll & Statutory Liabilities | 2200 | (615,800.00) | +12.3% | [NEEDS REVIEW] |

---

## 2. Bank Balance Tie-Out & Reconciliation Flow

Visual representation of the cash tie-out between external confirmation letters (SA 505) and the general ledger:

\`\`\`mermaid
flowchart TD
    A["Bank Statement Balance ($1,245,800.00)"] --> B["Less: Outstanding Cheques ($18,450.00)"]
    B --> C["Add: Deposits in Transit ($42,100.00)"]
    C --> D["Adjusted Bank Balance ($1,269,450.00)"]
    E["General Ledger Cash Balance ($1,269,450.00)"] --> F["Reconciliation Tie-out Status: [PASS]"]
    D --> F
\`\`\`

---

## 3. Detailed Audit Observations & Findings

Follow-up procedures and control evaluations categorized by risk priority:

### 1. Cash & Bank Substantive Testing
- **External Confirmations (SA 505):** Received 100% direct positive confirmations from depository institutions. No unauthorized credit facilities identified.
- **Unpresented Cheques:** 3 cheques over 90 days old totaling **$18,450.00** remain outstanding; management has initiated stale-cheque reversal entries.
- **Foreign Currency Translation:** Foreign denominated accounts revalued at closing exchange rates in accordance with IAS 21.

### 2. Inventory & Cut-off Assertions
- **Warehouse B Discrepancy:** Recommend adjusting journal entry to write down damaged stock by **$45,200.00** to net realizable value.
- **Shipping Cut-off:** Inspected shipping documents 5 days before and after balance sheet date. All goods shipped prior to midnight were derecognized.

### 3. Internal Control Deficiencies
- **Segregation of Duties:** Dual authorization required for disbursements exceeding **$25,000.00**; sampled 45 vouchers with 0 exceptions.
- **Manual Adjusting Entries:** 14 manual journals reviewed via \`src/utils/audit_calc.py\`; all supported by valid managerial sign-off.

---

## 4. Workpapers & Verified Deliverables

All test procedures, automated calculation scripts, and supporting schedules have been saved to the engagement directory:

- Generated Audit Working Paper: \`Audit_Deliverables/Cash_Reconciliation_WP.xlsx\`
- Full Substantive Population Verification: \`Audit_Deliverables/GL_Substantive_Ledger.csv\`
- Deterministic Sampling Script: \`src/utils/audit_calc.py\`

\`\`\`python
# Deterministic materiality verification script
def verify_materiality(variance_amount: float, threshold: float = 50000.00) -> bool:
    """Verifies whether the isolated variance exceeds performance materiality."""
    is_acceptable = abs(variance_amount) <= threshold
    return is_acceptable
\`\`\`
`;

export function Unit23LLMResponseShowcase() {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
          <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">23</span>
          <span>Full Production LLM Agent Response Showcase</span>
        </h2>
        <span className="font-mono text-xs text-[var(--m-text-muted)]">AssistantProse / AgentMarkdown</span>
      </div>

      <div className="p-6 rounded-2xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] shadow-lg" id="llm-response-showcase">
        <AssistantProse content={SAMPLE_LLM_OUTPUT} />
      </div>
    </section>
  );
}
