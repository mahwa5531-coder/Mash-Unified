# Purchase Cut-Off Testing

## Purpose
Verify purchases recorded in correct accounting period. Test goods received pre-year-end invoiced post, and goods invoiced pre-year-end received post. Detect cut-off manipulation affecting payables and inventory.

## Scope
- USE WHEN: Every statutory audit with material purchases — significant risk.
- DO NOT USE WHEN: Purchases immaterial.
- AUDIT AREAS: Goods purchases, services, imports, GRN-not-invoiced, goods in transit.

## Audit Objective
- Assertions: Cut-off, completeness, existence, accuracy.
- Framework: Ind AS 2 (inventory cost), Ind AS 1 (accrual concept), SA 530, GST Sec 12/16.

## Workflow Dependencies
- REQUIRES: Purchase Testing, Accounts Payable Testing, Data Profiling, Sampling.
- FEEDS: Inventory Cut-Off Testing, Evaluation of Misstatements, Audit Reporting.

## Required Inputs
- GRN register (last 2 weeks March + first 2 weeks April).
- Purchase invoice register (same period).
- Vendor invoice copies with dates.
- PO register and shipping terms.
- Goods in transit register.
- AP sub-ledger.

## Optional Inputs
- Prior-year cut-off exceptions.
- Vendor confirmation responses.
- Branch transfer records.

## Knowledge
- Ind AS 2: Inventory cost includes purchase price + duties + freight; cost recognized when goods received.
- Ind AS 1: Accrual concept — expense recognized when incurred, not when paid.
- GRN-based cut-off: Goods received = liability incurred; invoice follows.
- GST Sec 12: Time of supply for goods — issue of invoice or last date of month, whichever earlier.
- GST Sec 16: ITC available on receipt of goods.
- SA 530: Sample selection and projection of cut-off exceptions.

## Workflow
1. Obtain GRN register for last 2 weeks March + first 2 weeks April.
2. Obtain purchase invoice register for same period.
3. Match GRN to invoice:
   - GRN pre-year-end + invoice pre-year-end → correctly recorded.
   - GRN pre-year-end + invoice post-year-end → verify accrual at year-end.
     - IF not accrued → unrecorded liability; propose adjustment.
   - GRN post-year-end + invoice pre-year-end → verify not recorded as pre-year-end purchase.
     - IF recorded pre-year-end → cut-off error; reclassify.
   - GRN post-year-end + invoice post-year-end → current year, correct.
4. Sample selection:
   - Last 20+ GRN pre-year-end.
   - First 20+ GRN post-year-end.
   - High-value GRN — 100%.
5. For each sampled GRN:
   - Verify GRN date — independent of invoice.
   - Trace to invoice — verify invoice date.
   - Trace to GL entry — verify period recorded.
6. Verify goods in transit:
   - Goods dispatched by supplier, not received by company at year-end.
   - IF in transit at year-end → not company's inventory; no purchase recorded.
   - IF recorded → cut-off error.
7. Verify services cut-off:
   - Service completion certificate.
   - IF service rendered pre-year-end → accrue at year-end.
   - IF not accrued → unrecorded liability.
8. Verify imports cut-off:
   - BL/AWB date — independent verification from shipping line.
   - Customs clearance date.
   - IF goods cleared pre-year-end → record at year-end.
   - IF cleared post-year-end → current year.
9. Verify GRN-not-invoiced:
   - At year-end, list GRN without invoice.
   - Accrue at PO rate or estimated cost.
   - IF not accrued → propose adjustment.
10. Verify goods in transit at year-end:
    - List goods dispatched by supplier, not received.
    - IF in transit → not company's purchase.
    - IF recorded → reclassify.
11. Evaluate exceptions:
    - Classify factual (period incorrect), projected, anomalous.
    - Project per SA 530.
12. Conclude on cut-off — request management adjustment if material.

## Decision Points
- D1: GRN pre-year-end + invoice post? YES → verify accrual at year-end. NO → check other combinations.
- D2: GRN post-year-end + invoice pre? YES → verify not recorded pre-year-end. NO → correct.
- D3: Goods in transit recorded as purchase? YES → reclassify, cut-off error. NO → correct.
- D4: Service rendered pre-year-end accrued? YES → proceed. NO → propose adjustment.
- D5: GRN-not-invoiced at year-end accrued? YES → proceed. NO → propose adjustment.
- D6: Cut-off exceptions > 5% of sample? YES → extend sample, escalate. NO → document.

## Professional Skepticism Probes
- Are GRN dates genuine, or backdated to push expenses to current year?
- Are invoice dates manipulated to shift purchases between periods?
- Are goods in transit genuinely in transit, or received and concealed?
- Are GRN-not-invoiced items genuinely unbilled, or invoices suppressed?
- Are imports correctly dated — BL/AWB independently verified?
- Why does supplier dispatch not match GRN date — logistics or manipulation?

## Considerations
- GRN date is primary cut-off evidence — independently verified.
- GST: Time of supply per Sec 12; ITC on receipt of goods per Sec 16.
- Imports: BL/AWB date from shipping line — independent source.
- Services: Service completion certificate — accrual basis.
- Related-party purchases: Sec 188 approval, arm's length, separate cut-off test.
- ERP-driven GRN: Evaluate ITGCs over date integrity.

## Common Risks
- GRN backdated to push expenses to current year — profit manipulation.
- Goods received but invoice suppressed — AP understated.
- Goods in transit recorded as purchase — cut-off error.
- Imports cut-off based on invoice, not customs clearance.
- GRN-not-invoiced not accrued — unrecorded liability.
- Services not accrued — expense understated.

## Fraud Triggers (SA 240)
- GRN backdated near year-end.
- Invoice date manipulation — pre-year-end invoice for post-year-end GRN.
- Goods in transit recorded as purchase without GRN.
- GRN-not-invoiced not accrued.
- Round-amount accruals without computation.
- Imports cut-off based on invoice, not BL/AWB.

## Common Pitfalls
- Using invoice date as primary cut-off — GRN date is primary.
- Not verifying GRN date independently.
- Skipping goods in transit testing.
- Treating GRN-not-invoiced as current year without accrual.
- Not testing imports cut-off based on BL/AWB.

## Validation
- [ ] GRN register obtained (last 2 weeks March + first 2 weeks April).
- [ ] Invoice register matched to GRN.
- [ ] Sample selected (last 20+ GRN pre + first 20+ GRN post).
- [ ] Each GRN traced to invoice and GL.
- [ ] Goods in transit tested.
- [ ] Services cut-off tested.
- [ ] Imports cut-off tested (BL/AWB independent verification).
- [ ] GRN-not-invoiced accrued at year-end.
- [ ] Exceptions projected per SA 530.

## Expected Outputs
- Cut-off testing schedule (GRN-to-invoice matching).
- Sample vouching summary.
- Goods in transit review memo.
- GRN-not-invoiced accrual schedule.
- Services and imports cut-off memo.
- Exception summary with classification and projection.
- Conclusion on purchase cut-off.

## Failure Conditions
- GRN register not maintained.
- Invoice register incomplete.
- GRN dates unreliable — IT controls weak.
- Goods in transit register not available.

## Escalation Conditions
- Cut-off exceptions > 10% of sample → extend sample, partner consultation.
- GRN backdated evidence → STOP, trigger SA 240 fraud workflow.
- Goods in transit recorded without GRN → STOP, escalate, fictitious purchase risk.
- GRN-not-invoiced material not accrued → STOP, propose adjustment, consider qualification.
