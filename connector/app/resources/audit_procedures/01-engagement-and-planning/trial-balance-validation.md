# Trial Balance Validation

## Purpose
Validate TB completeness, accuracy, mapping to FS. Detect unusual entries, opening balance agreement, comparative period consistency. Foundation for all downstream testing.

## Scope
- USE WHEN: At audit commencement, before substantive testing.
- DO NOT USE WHEN: TB provided by management as final without source data.
- AUDIT AREAS: All FS line items, opening balances, comparatives, mapping.

## Audit Objective
- Assertions: Completeness, accuracy, classification, presentation.
- Framework: SA 500, SA 510 (opening balances), SA 710 (comparatives), Ind AS 1.

## Workflow Dependencies
- REQUIRES: Engagement Acceptance, Understanding Entity, Materiality.
- FEEDS: Data Profiling, Audit Planning, all execution skills.

## Required Inputs
- Audited prior-year TB and FS.
- Current-year TB by account code.
- Draft FS for current year.
- Chart of accounts and mapping document.
- GL extract with balances.

## Optional Inputs
- Sub-ledger extracts (AR, AP, inventory, FA).
- Prior-year audit adjustments schedule.
- Group trial balance (consolidated audits).

## Knowledge
- SA 510: Opening balances — assess whether prior auditor's conclusions carried forward.
- SA 710: Comparative information — consistency with current period.
- Ind AS 1: Comparative period presentation; reclassification disclosed.
- SA 500.A38: TB is starting evidence; reconcile to GL and FS.
- Companies Act Sec 129: Consistent accounting policies; disclose changes per Ind AS 8.

## Workflow
1. Obtain current-year TB — confirm signed by CFO/accountant.
2. Tie TB totals — debit = credit. IF not → escalate; cannot proceed.
3. Reconcile TB to GL:
   - Each account balance tie to GL.
   - IF variance > trivial → investigate.
4. Reconcile TB to draft FS:
   - Each FS line ties to TB account(s).
   - IF mismatch → reclassification, group adjustment, or error.
5. Reconcile to prior-year audited TB:
   - Opening balances per current TB = audited closing prior year.
   - IF variance → prior-year adjustment, reclassification, or error.
6. Identify unusual movements:
   - YoY variance > threshold (10% or PM, whichever lower).
   - New accounts — investigate rationale.
   - Dormant accounts with sudden activity.
7. Review mapping document — confirm each TB account mapped to correct FS line.
   - IF mapping changed → verify consistency per Ind AS 1.
8. Review reclassifications:
   - Reclassified between current/non-current — verify per Ind AS 1.
   - Reclassified between operating/financing/investing — verify per Ind AS 7.
9. Review new accounts — confirm business rationale; check for segregation.
10. Tie sub-ledger totals to GL control accounts:
    - AR sub-ledger vs AR control.
    - AP sub-ledger vs AP control.
    - Inventory sub-ledger vs inventory control.
    - FA register vs FA control.
    - IF variance → reconcile, identify reconciling items.
11. Identify manual JE — flag for SA 240 testing.
12. Document TB validation memo — exceptions, conclusions.

## Decision Points
- D1: TB debit = credit? YES → proceed. NO → escalate.
- D2: TB reconciles to GL? YES → proceed. NO → investigate.
- D3: TB reconciles to draft FS? YES → proceed. NO → reclassification or error.
- D4: Opening balances = prior-year audited closing? YES → proceed. NO → investigate adjustment.
- D5: Unusual movement > threshold? YES → detailed testing on that account. NO → standard testing.

## Professional Skepticism Probes
- Are new accounts explained by business change, or created to mask fraud?
- Are reclassifications properly disclosed, or hidden?
- Are manual JE at year-end appropriate, or override?
- Is sub-ledger reconciliation timely, or only at audit?
- Are prior-year adjustments genuinely errors, or manipulation?

## Considerations
- Consolidation: Eliminate inter-company; verify group TB.
- Comparative period: Apply same Ind AS/AS for consistency.
- Ind AS adoption: First-time adoption may create new accounts (per Ind AS 101).
- Manual JE: All flagged for SA 240 testing.
- Foreign currency: TB accounts translated per Ind AS 21.
- Software migration: TB may differ post-ERP change — reconcile.

## Common Risks
- TB does not tie to GL or FS — audit foundation failure.
- Opening balances not reconciled to prior-year closing.
- Sub-ledger not reconciled to control — completeness risk.
- Unusual movements not investigated.
- New accounts created to hide fraud.
- Manual JE not flagged for SA 240.

## Fraud Triggers (SA 240)
- New accounts created near year-end without business rationale.
- Manual JE at year-end by KMP to revenue or expense.
- Round-amount TB entries.
- Sub-ledger not reconciled to control — override indicator.
- Reclassifications masking fraudulent transactions.
- Dormant accounts suddenly active.
- Variance from prior-year audited balance unexplained.

## Common Pitfalls
- Not reconciling TB to GL — accepting management TB.
- Skipping sub-ledger reconciliation.
- Not investigating unusual YoY movements.
- Missing prior-year adjustment in opening balances.
- Reclassifications not tested for disclosure compliance.
- Manual JE not flagged for SA 240.

## Validation
- [ ] TB debit = credit.
- [ ] TB reconciles to GL account-by-account.
- [ ] TB reconciles to draft FS line-by-line.
- [ ] Opening balances = prior-year audited closing.
- [ ] Unusual YoY movements identified and tested.
- [ ] Sub-ledger reconciliations to control accounts verified.
- [ ] Manual JE flagged for SA 240 testing.

## Expected Outputs
- TB validation memo with reconciliations.
- YoY movement analysis with variance explanations.
- Sub-ledger reconciliation summary.
- Mapping verification working paper.
- Unusual entries list for further testing.
- Manual JE list for SA 240.

## Failure Conditions
- TB does not balance (debit ≠ credit).
- TB cannot reconcile to GL.
- Sub-ledger cannot reconcile to control accounts.
- Opening balances not available.

## Escalation Conditions
- TB manipulation evidence → STOP, trigger SA 240 workflow.
- Manual JE by KMP at year-end to revenue/expense → STOP, SA 240, consider Sec 143(12).
- Sub-ledger unreconciled > material amount → STOP, scope limitation.
- New accounts suggesting fraud → STOP, escalate to partner.
