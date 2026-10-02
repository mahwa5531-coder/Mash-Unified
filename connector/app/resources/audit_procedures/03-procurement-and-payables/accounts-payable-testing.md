# Accounts Payable Testing

## Purpose
Verify AP completeness — search for unrecorded liabilities. Test accruals, GRN-not-invoiced, post-year-end payments for pre-year-end expenses. Detect understatement of liabilities and expenses.

## Scope
- USE WHEN: Every statutory audit — AP completeness is significant risk.
- DO NOT USE WHEN: AP immaterial; cash-based small operations.
- AUDIT AREAS: Trade payables, accruals, GRN-not-invoiced, MSME payables, RPT payables.

## Audit Objective
- Assertions: Completeness, existence, accuracy, classification, cut-off.
- Framework: Ind AS 1 (classification), SA 530, SA 505, MSME Act, Sec 188, GST Sec 16.

## Workflow Dependencies
- REQUIRES: Purchase Testing, Trial Balance Validation, Data Profiling, Sampling.
- FEEDS: Evaluation of Misstatements, Purchase Cut-Off Testing, Audit Reporting.

## Required Inputs
- AP sub-ledger ageing as of year-end.
- GRN-not-invoiced register (goods received, invoice pending).
- Accruals schedule (expense incurred, invoice not received).
- Vendor statements (top vendors).
- Post-year-end payments register (30-60 days).
- Bank statements for material payments.

## Optional Inputs
- Vendor confirmations.
- Prior-year AP schedule.
- MSME vendor list.

## Knowledge
- SA 530: Search for unrecorded liabilities — sample post-year-end payments, trace to AP.
- SA 505: Vendor confirmations — alternative procedure when sent.
- MSME Act Sec 15: Payment within 45 days; disclosure in FS.
- Sec 188: Related-party payables — Sec 188 + Ind AS 24 disclosure.
- Ind AS 1: Current vs non-current classification; trade payables aging.
- Ind AS 19/116: Accruals for services, leave, bonus.
- GST Sec 16: ITC — verify RCM liability accrued.

## Workflow
1. Obtain AP sub-ledger ageing — tie to GL and FS.
   - IF mismatch → investigate reconciling items.
2. Search for unrecorded liabilities:
   - Extract post-year-end payments (30-60 days).
   - For each material payment, verify whether liability existed at year-end.
   - IF payment relates to pre-year-end expense → verify accrual recorded.
   - IF not accrued → unrecorded liability; propose adjustment.
3. GRN-not-invoiced review:
   - Goods received pre-year-end, invoice not received → accrue at year-end.
   - Verify accrual computed at PO rate or estimated.
4. Accruals testing:
   - Sample accruals — vouch to supporting documentation (contracts, services received).
   - Re-compute accrual (e.g., monthly service × period pending).
   - IF accrual insufficient → adjust.
5. Vendor statements reconciliation:
   - Obtain statements from top vendors.
   - Reconcile to AP sub-ledger.
   - IF vendor balance > books → potential understated AP.
6. Post-year-end expense review:
   - Scan April/May bank statements for material payments.
   - Trace each to AP at year-end.
   - IF no AP entry → unrecorded liability.
7. MSME compliance:
   - Obtain MSME vendor declaration.
   - Compute days from receipt of goods/services to year-end.
   - IF > 45 days → interest accrual per MSME Act.
   - Verify disclosure in FS.
8. Related-party payables:
   - Sec 188 approval for RPT purchases.
   - Ind AS 24 disclosure.
   - Arm's length pricing verification.
9. Classification:
   - Current vs non-current per Ind AS 1.
   - Trade payables vs other payables (advances, deposits).
   - GST/TDS/ESI/PF payable — separate line items.
10. Statutory dues:
    - GST, TDS, PF, ESI, PT payable at year-end.
    - Reconcile to returns filed.
    - IF variance → investigate, propose adjustment.
11. Vendor confirmations (if sent):
    - Process responses, investigate exceptions.
12. Evaluate exceptions — classify, project per SA 530.

## Decision Points
- D1: AP sub-ledger ties to GL/FS? YES → proceed. NO → investigate.
- D2: Post-year-end payment relates to pre-year-end expense? YES → verify accrual; IF not accrued → propose adjustment. NO → current year.
- D3: GRN-not-invoiced at year-end? YES → accrue. NO → standard.
- D4: Vendor statement balance > books? YES → investigate, potential adjustment. NO → accept.
- D5: MSME vendor overdue > 45 days? YES → interest accrual + disclosure. NO → standard.
- D6: Related-party payable? YES → Sec 188 + Ind AS 24 disclosure + arm's length. NO → standard.

## Professional Skepticism Probes
- Are accruals genuinely computed, or rounded down?
- Are post-year-end payments genuinely current year, or pre-year-end liabilities?
- Are vendor statements independently obtained, or management-facilitated?
- Are MSME disclosures complete, or selectively applied?
- Are related-party payables genuinely arm's length?
- Are statutory dues paid on time, or chronic default?
- Why do GRN-not-invoiced items remain unreconciled?

## Considerations
- MSME Act: Vendor declaration mandatory; interest if > 45 days; disclosure.
- RPT: Sec 188 approval, Ind AS 24 disclosure, arm's length.
- GST RCM: Reverse charge accrual for specified services.
- Statutory dues: PF, ESI, PT, GST, TDS — separate disclosure.
- Foreign payables: FEMA compliance, exchange rate per Ind AS 21.
- Comparative: Use same classification for consistency.

## Common Risks
- Unrecorded liabilities at year-end — expenses understated.
- GRN-not-invoiced not accrued — AP understated.
- Accruals insufficient — expenses understated.
- MSME interest not accrued — non-compliance.
- Related-party payables without disclosure.
- Statutory dues under-accrued — compliance failure.

## Fraud Triggers (SA 240)
- Manual JE post year-end to record pre-year-end expense — override.
- Vendor statements not obtained for top vendors — concealment.
- Round-amount accruals without computation.
- GRN-not-invoiced not tracked — unrecorded liabilities.
- MSME vendors identified post-year-end only — selective.
- Related-party payables without Sec 188 approval.

## Common Pitfalls
- Not performing search for unrecorded liabilities.
- Accepting books without vendor statement reconciliation.
- Skipping MSME compliance testing.
- Not testing related-party payables separately.
- Treating statutory dues as immaterial without verification.

## Validation
- [ ] AP sub-ledger tied to GL and FS.
- [ ] Search for unrecorded liabilities performed (post-year-end payments).
- [ ] GRN-not-invoiced accrued at year-end.
- [ ] Accruals sample vouched and re-computed.
- [ ] Vendor statements obtained and reconciled (top vendors).
- [ ] MSME compliance verified (declaration, 45-day rule, disclosure).
- [ ] Related-party payables tested separately.
- [ ] Statutory dues reconciled to returns.
- [ ] Exceptions projected per SA 530.

## Expected Outputs
- AP ageing schedule tied to GL/FS.
- Search for unrecorded liabilities memo (post-year-end payments analysis).
- GRN-not-invoiced accrual schedule.
- Accruals testing workpaper.
- Vendor statements reconciliation.
- MSME compliance testing memo.
- Related-party payables schedule with arm's length assessment.
- Statutory dues reconciliation.
- Exception summary with classification and projection.

## Failure Conditions
- AP sub-ledger not provided.
- Vendor statements not obtainable for top vendors.
- GRN register not maintained.

## Escalation Conditions
- Unrecorded liability material → STOP, propose adjustment, partner consultation.
- MSME interest not accrued material → STOP, escalate, require disclosure + adjustment.
- Related-party payable without Sec 188 approval → STOP, escalate, consider qualification.
- Statutory dues chronically in default material → STOP, escalate, consider CARO 2020 disclosure and qualification.
