# Purchase Testing

## Purpose
Verify purchase occurrence, authorization, accuracy, and completeness. Detect fictitious purchases, unauthorized vendors, related-party purchases, and goods in transit misclassification.

## Scope
- USE WHEN: Material purchases; procurement cycle risk assessed.
- DO NOT USE WHEN: Purchases immaterial; cash-based small purchases.
- AUDIT AREAS: Goods purchases, services, RPT purchases, imports, capital purchases.

## Audit Objective
- Assertions: Occurrence, completeness, accuracy, classification, cut-off.
- Framework: Ind AS 2/16/116, SA 315, SA 330, SA 550, GST Sec 16, IT Act Sec 194C.

## Workflow Dependencies
- REQUIRES: Trial Balance Validation, Risk Assessment, Data Profiling, Sampling.
- FEEDS: Accounts Payable Testing, Purchase Cut-Off Testing, Inventory Testing, Fixed Assets Testing.

## Required Inputs
- Purchase register (date, vendor, PO, GRN, invoice, amount, GST).
- Vendor master with PAN, GSTIN, address, MSME status.
- PO register and approval matrix.
- GRN (goods received notes) — inward dispatch.
- Vendor invoices with TDS deduction proof.

## Optional Inputs
- Prior-year vendor list (new vendors analysis).
- Vendor bank statements (for shell entity check).
- Import documents (BOE, BL, customs duty payment).

## Knowledge
- Ind AS 2: Inventory cost includes purchase price + duties + freight + directly attributable costs.
- SA 550: Related-party purchases — significant risk by default; arm's length + Sec 188.
- GST Sec 16: ITC eligible on receipt of goods + invoice + payment; verify GSTR-2B.
- IT Act Sec 194C: TDS on contract payments; Sec 194J on professional services.
- Sec 188: Related-party purchase approval — Board / audit committee / members.
- CARO 2020 Cl. (xii): Statutory dues disclosure.
- MSME Act: Payment to MSME within 45 days; disclosure under Sec 15.

## Workflow
1. Profile purchase population — vendor concentration, monthly trend, new vendors.
   - IF new vendor > material % of purchases → detailed verification.
2. Sample selection — MUS for high-value; stratified random for medium.
3. For each sampled purchase, verify 3-way match:
   - PO → GRN → Vendor invoice.
   - IF mismatch → exception.
4. Verify authorization:
   - PO approval per matrix (CFO/director threshold).
   - Invoice processing authorization.
   - IF unauthorized → control deficiency.
5. Verify vendor master:
   - PAN, GSTIN cross-check with portal.
   - Address — flag same as company premises.
   - Bank account — flag same as employee/director.
   - IF shell indicator → escalate.
6. Verify occurrence — goods genuinely received:
   - GRN signed by stores.
   - Inventory records updated.
   - IF no GRN → fictitious purchase indicator.
7. Verify accuracy — invoice amount, quantity, rate, GST, TDS:
   - Re-compute GST and TDS.
   - IF variance > trivial → exception.
8. Verify classification:
   - Revenue expenditure vs capital (FA) — per Ind AS 16.
   - IF capital purchase recorded as revenue → FA understatement, P&L overstatement.
9. Verify GST ITC eligibility:
   - GSTR-2B reconciliation — ITC claimed vs eligible.
   - IF ITC claimed on ineligible items → GST compliance failure.
10. Verify TDS compliance:
    - Sec 194C/194J — rate, threshold, deduction.
    - IF TDS short → disallowance under Sec 40(a)(ia).
11. Verify related-party purchases:
    - Sec 188 approval obtained.
    - Arm's length pricing per Ind AS 24.
    - IF non-arm's length → disclosure + adjustment.
12. Verify imports:
    - BOE, BL, customs duty payment.
    - Exchange rate per Ind AS 21.
13. Verify goods in transit:
    - Goods dispatched but not received by year-end — include in inventory, not purchase.
    - IF misclassified → cut-off error.
14. Evaluate exceptions — classify, project per SA 530.

## Decision Points
- D1: New vendor material? YES → detailed verification, shell check. NO → standard.
- D2: 3-way match? YES → proceed. NO → exception, control deficiency.
- D3: Vendor master shows shell indicators? YES → escalate, fictitious purchase risk. NO → proceed.
- D4: GRN available? YES → occurrence confirmed. NO → fictitious purchase indicator.
- D5: Capital vs revenue classification correct? YES → proceed. NO → reclassification.
- D6: Related-party purchase? YES → Sec 188 + arm's length + Ind AS 24. NO → standard.

## Professional Skepticism Probes
- Are new vendors genuine businesses, or shell entities?
- Is vendor address same as company premises or director residence?
- Are round-amount purchases from new vendors genuine?
- Are GRN genuinely signed by stores, or backdated?
- Are related-party purchases at arm's length?
- Are imports genuinely for business, or transfer pricing manipulation?
- Are TDS/GST compliance gaps indicative of vendor management issues?

## Considerations
- MSME status: Vendor declaration; payment within 45 days; disclosure per Sec 15 MSME Act.
- RPT: Sec 188 approval, Ind AS 24 disclosure, arm's length pricing.
- Imports: FEMA compliance, customs duty, exchange rate.
- GST: ITC eligibility, GSTR-2B reconciliation, RCM (reverse charge).
- TDS: Sec 194C/194J/194I; threshold, rate, disallowance risk.
- IT environment: ERP-driven 3-way matching — evaluate ITGCs.

## Common Risks
- Fictitious purchases from shell vendors — fund diversion.
- Unauthorized POs — control override.
- Capital purchases recorded as revenue — FA understatement.
- GST ITC on ineligible items — compliance failure.
- TDS short deduction — Sec 40(a)(ia) disallowance.
- Related-party purchases at non-arm's length — profit shifting.

## Fraud Triggers (SA 240)
- New vendors with round-amount invoices.
- Vendor address same as company premises/director residence.
- Same bank account/PAN across vendors — shell entities.
- GRN missing or backdated.
- Purchases without PO (override).

## Common Pitfalls
- Not verifying vendor master for shell indicators.
- Accepting invoice without GRN.
- Skipping GST/TDS re-computation.
- Not testing related-party purchases separately.
- Treating capital purchases as revenue without verification.

## Validation
- [ ] Vendor master verified (PAN, GSTIN, address, bank).
- [ ] Sample selected via MUS / stratified.
- [ ] 3-way match (PO-GRN-invoice) for each sampled item.
- [ ] Authorization per matrix verified.
- [ ] GST ITC eligibility verified (GSTR-2B reconciliation).
- [ ] TDS compliance verified (Sec 194C/194J).
- [ ] Related-party purchases tested separately (Sec 188, Ind AS 24).
- [ ] Goods in transit classified correctly.
- [ ] Exceptions projected per SA 530.

## Expected Outputs
- Purchase testing workpaper with sample, vouching, exceptions.
- Vendor master verification memo (shell indicators).
- 3-way match reconciliation.
- GST/TDS compliance summary.
- Related-party purchases schedule with arm's length assessment.
- Goods in transit schedule.
- Exception summary with classification and projection.
- Conclusion on purchase occurrence and accuracy.

## Failure Conditions
- Vendor master not provided.
- GRN not maintained.
- PO approval matrix unavailable.
- Related-party register not provided.

## Escalation Conditions
- Shell vendor identified → STOP, trigger SA 240 fraud workflow, consider Sec 143(12).
- Fictitious purchase evidence → STOP, escalate to partner, consider qualification.
- Related-party purchase without Sec 188 approval → STOP, escalate, consider qualification.
- GST ITC on ineligible items material → STOP, escalate, consider GST exposure.
- TDS short deduction material → STOP, escalate, consider Sec 40(a)(ia) disallowance.
