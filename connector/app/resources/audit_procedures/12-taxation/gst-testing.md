# GST Testing

## Purpose
Verify GST compliance and balances. Test GSTR-1 vs books, GSTR-3B vs books, GSTR-2B vs ITC, ITC eligibility (Sec 16), reversed ITC (Sec 17(5)), RCM, e-invoicing, e-way bills, GST on advances, place of supply, year-end GST balance, refunds pending.

## Scope
- USE WHEN: All GST-registered entities; material GST liability/ITC; refunds pending; year-end balance.
- DO NOT WHEN: Entity not registered under GST; turnover below threshold.
- AUDIT AREAS: Output tax, ITC, RCM, e-invoicing/e-way bills, GST on advances, refunds, year-end balances.

## Audit Objective
- Assertions: Completeness, accuracy, valuation, presentation, cutoff.
- Framework: CGST/SGST/IGST Acts; Sec 16/17(5)/9(3)/9(4); Ind AS 12 (GST liability DTA/DTL); CARO 2020.

## Workflow Dependencies
- REQUIRES: Trial Balance Validation, Revenue Testing, Purchase Testing, Journal Entry Testing.
- FEEDS: Statutory Dues Testing, Audit Reporting, Deferred Tax Testing.

## Required Inputs
- GSTR-1, GSTR-3B (all months); GSTR-2B (ITC auto-populated).
- Output tax and ITC ledgers in books; e-invoice and e-way bill register.
- RCM liability workings; reverse charge vendor list.
- GST reconciliation statements (GSTR-1 vs books; GSTR-2B vs ITC).
- GST refund applications and status (RFD-01); demand notices.

## Optional Inputs
- Place of supply workings; advance received register; prior-period GST workings.

## Knowledge
- Sec 16: ITC eligible if registered; goods/services received; tax charged; invoice furnished by supplier; tax paid; return filed.
- Sec 17(5): Blocked ITC — motor vehicles, personal consumption, CSR, works contract (immovable property), employee benefits, no-invoice ITC.
- Sec 9(3)/(4): RCM on specified supplies (advocate, GTA, import of services, sponsorships).
- Sec 12/13: Place of supply — determines IGST vs CGST/SGST.
- Sec 31(3)(f): GST on advances required only for goods (SAC not covered) up to notification; check current position.
- E-invoicing: Mandatory for turnover ≥₹5 cr (from August 2023); IRN + QR code.
- E-way bill: Mandatory for consignment value >₹50,000 (intra-state/inter-state as applicable).
- Sec 50: Interest @18% on delayed GST payment; from day after due date till payment date.

## Workflow
1. Obtain GST returns (GSTR-1, GSTR-3B, GSTR-2B) for all months — tie to annual books.
2. Test GSTR-1 vs books — reconcile outward supplies (taxable value, IGST/CGST/SGST); IF mismatch → exception.
3. Test GSTR-3B vs books — reconcile output tax, ITC claimed, net tax payable; IF GSTR-3B ITC > GSTR-2B ITC → disallowed.
4. Test GSTR-2B vs ITC in books:
   - Reconcile ITC per books with auto-populated GSTR-2B.
   - IF supplier not filed GSTR-1 → ITC unavailable (Sec 16(2)(aa)); IF invoices not in GSTR-2B → defer ITC.
5. Test ITC eligibility (Sec 16) — verify registered supplier; invoice furnished; goods/services received; tax paid.
   - IF payment to vendor >180 days → reverse ITC with interest (Sec 16(2)(c)).
6. Test blocked ITC reversal (Sec 17(5)) — motor vehicles (≥13 seater exempt); personal consumption; CSR; employee benefits.
7. Test RCM (Sec 9(3)/(4)) — GTA, advocate, import of services, sponsorship; self-invoice; payment in cash; IF not paid → demand with interest/penalty.
8. Test e-invoicing — IF turnover ≥₹5 cr → verify IRN generation; QR code; non-compliant → penalty up to ₹10,000 per invoice.
9. Test e-way bills — verify for consignments >₹50,000; IF non-issued → penalty + tax + seizure risk.
10. Test GST on advances — IF advances for supply of goods → GST on advances (notification position); IF adjusted against supply → adjust output tax.
11. Test place of supply (Sec 12/13) — verify IGST vs CGST/SGST; IF cross-state wrongly classified as intra-state → demand and penalty risk.
12. Test year-end GST balance — output tax payable (current liability); ITC in electronic credit ledger (assess refundability); refund pending (RFD-01) → disclose; assess recoverability.
13. Test GST demand notices — IF demand raised → assess merits; provision/disclose per Ind AS 37.
14. Evaluate exceptions — factual/projected/anomalous; project per SA 530.

## Decision Points
- D1: ITC per GSTR-3B ≤ GSTR-2B? YES → proceed. NO → disallowed ITC.
- D2: ITC eligible per Sec 16 (all conditions met)? YES → proceed. NO → reverse.
- D3: Blocked ITC (Sec 17(5)) reversed? YES → proceed. NO → reverse with interest.
- D4: RCM paid in cash for specified supplies? YES → proceed. NO → demand risk.
- D5: E-invoice IRN generated (turnover ≥₹5 cr)? YES → proceed. NO → penalty risk.
- D6: Vendor payment within 180 days (Sec 16(2)(c))? YES → proceed. NO → reverse ITC.

## Professional Skepticism Probes
- Is ITC claimed for genuinely received goods/services, or paper invoices?
- Are blocked ITC items (Sec 17(5)) genuinely reversed, or concealed?
- Is RCM genuinely computed on all specified supplies?
- Are GSTR-1 mismatches explained by timing, or by unrecorded sales?
- Are vendor payments delayed beyond 180 days — ITC reversal compliance?
- Is place of supply correctly determined for cross-border transactions?
- Are GST refund claims genuine, or overstated?

## Considerations
- GSTR-2B is auto-populated; only GSTR-2B ITC is eligible.
- ITC under RCM utilised to pay RCM output tax only.
- Sec 16(2)(aa): ITC available only if invoice furnished by supplier in GSTR-1.
- Cross-charge (cross-state supply within same entity): GST on open market value.
- Ind AS 12: GST liability/ITC as current liability/asset; deferred tax not applicable.
- GST on advances: Notification 66/2017 waived for goods; verify current status.
- E-invoicing thresholds revised periodically; check current threshold.

## Common Risks
- ITC claimed exceeding GSTR-2B; blocked ITC (Sec 17(5)) not reversed.
- RCM not paid on specified supplies.
- E-invoice IRN not generated; e-way bills not issued.
- GST on advances not paid; vendor payment >180 days — ITC not reversed.

## Fraud Triggers (SA 240)
- ITC claimed on fake invoices (no genuine supply).
- Round-tripping via shell vendors for ITC.
- GSTR-1 understated vs books (unrecorded sales).
- Blocked ITC concealed; not reversed.
- RCM deliberately understated.
- GST refund claims on fabricated exports.
- Place of supply manipulated to claim IGST on intra-state supply.

## Common Pitfalls
- Not reconciling GSTR-1 to books; not reconciling GSTR-3B ITC to GSTR-2B.
- Missing Sec 17(5) blocked ITC reversal; skipping RCM testing on GTA/advocate.
- Not testing e-invoicing compliance; missing Sec 16(2)(c) vendor payment check.
- Not disclosing GST demand notices (Ind AS 37).

## Validation
- [ ] GSTR-1 and GSTR-3B reconciled to books.
- [ ] GSTR-2B ITC reconciled to ITC in books.
- [ ] Sec 16 eligibility tested; Sec 17(5) blocked ITC reversal tested.
- [ ] RCM tested (Sec 9(3)/(4)); e-invoicing compliance tested (IRN); e-way bills tested (>₹50,000).
- [ ] GST on advances tested; place of supply tested (Sec 12/13).
- [ ] Year-end GST balance tested; GST refund status tested.
- [ ] GST demand notices disclosed (Ind AS 37); exceptions projected per SA 530.

## Expected Outputs
- GST testing working paper.
- GSTR-1 vs books; GSTR-3B vs books; GSTR-2B vs ITC reconciliation memos.
- Sec 16/17(5) compliance memo; RCM compliance memo.
- E-invoicing/e-way bill compliance memo; place of supply memo.
- GST refund / demand disclosure memo (Ind AS 37).
- Exception summary with projection.
- Conclusion on GST per CGST/SGST/IGST Acts.

## Failure Conditions
- GSTR-1/3B/2B returns unavailable.
- Books of accounts not reconciled to GST returns.
- E-invoice/e-way bill register unavailable.

## Escalation Conditions
- Fake invoice ITC material → STOP, fraud risk (SA 240), partner consultation.
- Blocked ITC (Sec 17(5)) material not reversed / RCM liability material unpaid → STOP, demand risk, escalate.
- GSTR-1 materially understated vs books → STOP, fraud risk (unrecorded sales), escalate.
- GST demand material undisclosed (Ind AS 37) / e-invoicing non-compliance pervasive → STOP, partner consultation.
