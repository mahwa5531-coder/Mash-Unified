# Data Profiling and Analytics

## Purpose
Profile complete populations to detect anomalies, patterns, duplicates, gaps. Apply CAATs (Computer-Assisted Audit Techniques) for population completeness, JE analytics, Benford's law, 3-way matching.

## Scope
- USE WHEN: Population-level analytics before sampling; JE testing; fraud risk procedures.
- DO NOT USE WHEN: Population too small for analytics; manual records only.
- AUDIT AREAS: GL, sub-ledgers, sales, purchase, inventory, payroll, JE, fixed assets.

## Audit Objective
- Assertions: Population completeness, occurrence, accuracy, cut-off, classification.
- Framework: SA 500 (sufficient appropriate evidence), SA 520 (analytics), SA 240 (fraud analytics), SA 230 (documentation).

## Workflow Dependencies
- REQUIRES: Trial Balance Validation, Risk Assessment, Materiality.
- FEEDS: Audit Sampling, Revenue Testing, JE Testing, Fraud Risk Assessment.

## Required Inputs
- GL extract (date, account, amount, description, user, timestamp).
- Sub-ledger extracts (AR, AP, inventory, FA, payroll).
- Master data (customer, vendor, employee, item master).
- Trial balance and FS for reconciliation.
- System metadata (creation date, user ID, modification log).

## Optional Inputs
- Prior-year data for YoY comparison.
- Industry benchmarks.
- Benford's law expected distribution.

## Knowledge
- SA 520.4: Substantive analytics include ratio, trend, reasonableness, predictive.
- SA 240.24: JE testing mandatory for management override risk — analytics to identify unusual JE.
- SA 500.A40: Electronic evidence requires evaluation of IT controls.
- Benford's Law: First-digit distribution for natural data; deviation signals manipulation.
- 3-way matching: PO-GRN-Invoice for procurement; Order-Dispatch-Invoice for sales.
- GSTR-1/GSTR-3B reconciliation vs revenue ledger (GST compliance).

## Workflow
1. Obtain complete data extract — verify row counts, totals reconcile to TB.
   - IF extract does not reconcile → escalate; cannot proceed.
2. Profile population:
   - Total amount, count, average, min/max.
   - Date distribution — heatmap by week/month.
   - Amount distribution — histogram.
3. Test completeness:
   - Sequence check on invoice/voucher numbers — identify gaps.
   - IF gaps identified → investigate; potential missing transactions.
4. Test duplicates:
   - Same invoice number, same amount, same vendor/customer.
   - Same bank account for multiple vendors — possible shell.
5. Test outliers:
   - Amount > 3 sigma from mean.
   - Transactions outside business hours/weekends/holidays.
   - Round-amount transactions (₹10,00,000 / ₹1 crore).
6. Trend analysis:
   - YoY monthly revenue, expense, JE frequency.
   - IF last-week-of-March spike → flag for cut-off testing.
7. Benford's Law:
   - Compute first-digit distribution of revenue, expense, JE.
   - IF deviation > threshold → flag for fraud investigation.
8. JE analytics:
   - Manual JE (vs system-generated).
   - JE by user — identify unusual users (CFO, MD).
   - JE near year-end (last 2 weeks March + first 2 weeks April).
   - Round-amount JE.
   - JE to revenue account.
   - Top 20 JE by value — review.
9. 3-way matching:
   - Sales: Order → Dispatch → Invoice — confirm matched sets.
   - Purchase: PO → GRN → Invoice — confirm matched sets.
   - IF unmatched items → investigate.
10. Related-party analytics:
    - Transactions with related parties — frequency, pricing, terms.
    - Common addresses, PAN, bank accounts across vendors/customers.
11. GST reconciliation:
    - GSTR-1 vs revenue ledger; GSTR-3B vs output tax; GSTR-2B vs input tax.
    - IF variance > trivial → investigate.
12. Document findings, link to sampling plan, escalate fraud indicators.

## Decision Points
- D1: Data extract reconciles to TB? YES → proceed. NO → escalate, do not proceed.
- D2: Sequence gaps identified? YES → investigate each gap. NO → document.
- D3: Outliers present? YES → vouch each outlier. NO → document.
- D4: Benford's deviation > threshold? YES → fraud investigation, extend sample. NO → document.
- D5: Manual JE near year-end by KMP? YES → SA 240 fraud risk, vouch. NO → document.
- D6: GST vs books variance > trivial? YES → investigate, escalate if fraud indicator. NO → document.

## Professional Skepticism Probes
- Is data extract truly complete, or filtered by management?
- Are outliers explained by business rationale, or evaded?
- Are duplicates coincidental, or indicative of double booking?
- Why do JE concentrate at year-end?
- Are round-amount transactions genuine, or fabricated?
- Why does Benford's deviation exist — manipulation or business model?
- Is the GST reconciliation difference explained by timing or concealment?

## Considerations
- Data quality: Validate field formats, nulls, encoding before analysis.
- IT controls: Evaluate ITGCs over source system before relying on data.
- Privacy: Mask personal data (PAN, Aadhaar) per IT Act and DPDP Act.
- Comparative period: Use same data definitions for YoY analysis.
- Sampling link: Use analytics to stratify sample — high-risk groups oversampled.
- Group audit: Coordinate analytics across components.

## Common Risks
- Data extract filtered by management to hide exceptions.
- Field mapping errors masking duplicates.
- Outliers accepted without vouching.
- Benford's deviation ignored.
- Manual JE not separately analysed.
- GST reconciliation skipped.

## Fraud Triggers (SA 240)
- Manual JE at year-end by KMP — override risk.
- Round-amount JE to revenue.
- Same bank account for multiple vendors — shell entities.
- Sequence gaps in invoices — missing/fabricated.
- Benford's law deviation — manipulation indicator.
- Transactions outside business hours — override.
- Unmatched 3-way transactions — fictitious.

## Common Pitfalls
- Treating analytics as optional — mandatory for SA 240.
- Not documenting data extract reconciliation.
- Skipping JE analytics — management override risk.
- Not escalating outliers — material misstatement missed.
- Accepting GST reconciliation without investigation.

## Validation
- [ ] Data extract reconciles to TB and FS.
- [ ] Sequence check, duplicates, outliers performed.
- [ ] YoY trend analysis documented.
- [ ] Benford's Law applied to revenue, expense, JE.
- [ ] JE analytics: manual, year-end, KMP, round amounts.
- [ ] 3-way matching performed (sales, purchase).
- [ ] GST reconciliation completed.
- [ ] Findings linked to sampling and fraud risk procedures.

## Expected Outputs
- Data profiling report (population stats, trends).
- Duplicate, gap, outlier schedule.
- Benford's Law analysis chart.
- JE analytics summary with top 20 JE.
- 3-way matching reconciliation.
- GST vs books reconciliation.
- Fraud indicators for SA 240 escalation.

## Failure Conditions
- Data extract does not reconcile to TB.
- Source system ITGCs weak — data integrity questionable.
- Management refuses to provide complete extract.

## Escalation Conditions
- Benford's deviation > threshold → STOP, trigger SA 240 fraud workflow.
- Manual JE by KMP at year-end to revenue → STOP, trigger SA 240, consider Sec 143(12).
- Same bank account/PAN across multiple vendors → STOP, investigate shell entities.
- GST vs books variance > material → STOP, escalate, consider qualification.
