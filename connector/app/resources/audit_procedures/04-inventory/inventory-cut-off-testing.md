# Inventory Cut-Off Testing

## Purpose
Verify inventory recorded in correct accounting period. Test last GRN + first dispatch post year-end, goods in transit, consignment, branch transfers, C&F stock.

## Scope
- USE WHEN: Statutory audit with material inventory — significant risk.
- DO NOT USE WHEN: Inventory immaterial.
- AUDIT AREAS: Goods received, dispatched, in transit, consignment, branch transfers, C&F stock.

## Audit Objective
- Assertions: Cut-off, completeness, existence, accuracy.
- Framework: Ind AS 2 (cost recognition), SA 530, GST Sec 12/16, SA 505.

## Workflow Dependencies
- REQUIRES: Inventory Physical Verification, Purchase Cut-Off Testing, Sampling.
- FEEDS: Evaluation of Misstatements, Revenue Cut-Off Testing, Audit Reporting.

## Required Inputs
- GRN register (last 2 weeks March + first 2 weeks April).
- Dispatch / invoice register (same period).
- Goods in transit register (inward + outward).
- Consignment outward and inward records.
- Branch transfer records.
- C&F agent stock confirmation (SA 505).
- Last GRN number + first dispatch number at physical count.

## Optional Inputs
- Prior-year cut-off exceptions.
- Customer confirmation of stock on consignment.
- Third-party warehouse receipts.

## Knowledge
- Ind AS 2: Inventory cost recognized when goods received.
- SA 505: Third-party stock confirmation (C&F, consignment).
- GST Sec 12: Time of supply — invoice or last date of month, whichever earlier.
- GST Sec 16: ITC available on receipt of goods.
- Branch transfer: Not a sale; eliminate on consolidation.
- Consignment: Revenue on customer sale, not on consignment dispatch.

## Workflow
1. Obtain cut-off info from physical count — last GRN pre-count, first dispatch post-count.
2. Obtain GRN + dispatch registers for last 2 weeks March + first 2 weeks April.
3. Match GRN to inventory and purchase:
   - GRN pre + invoice pre → correctly recorded.
   - GRN pre + invoice post → verify accrual + inventory recorded; IF not → cut-off error.
   - GRN post + invoice pre → verify not recorded pre-year-end; IF recorded → cut-off error.
4. Match dispatch to inventory and revenue:
   - Dispatch pre + invoice pre → correct.
   - Dispatch pre + invoice post → verify inventory relieved + revenue in correct period.
   - Dispatch post + invoice pre → verify not recorded pre-year-end; IF recorded → cut-off error.
5. Verify goods in transit:
   - Inward (supplier dispatched, not received): IF in transit at year-end → not inventory; IF recorded → cut-off error.
   - Outward: IF FOB shipment → revenue/COGS at year-end; IF CIF destination → at delivery.
6. Verify consignment outward:
   - Stock with C&F/dealer on consignment → company's inventory.
   - Revenue on customer sale only.
   - IF revenue recognized on dispatch → reversal required.
7. Verify consignment inward:
   - Stock with company on consignment from supplier → not company's inventory.
   - IF included → cut-off error.
8. Verify branch transfers:
   - Goods in transit between branches → company's inventory; eliminate on consolidation.
   - IF recorded as sale → reclassify.
9. Verify C&F agent stock:
   - Send SA 505 confirmations to all material C&F agents.
   - IF non-response → alternative procedures (stock statement, subsequent sale).
10. Sample selection — last 20+ GRN pre-year-end, first 20+ dispatch post, high-value 100%.
11. For each sampled transaction:
    - Verify GRN/dispatch date independently (e-way bill timestamp).
    - Trace to GL entry — verify period recorded.
    - Trace to inventory record — verify inclusion/exclusion.
12. Evaluate exceptions — classify factual/projected/anomalous; project per SA 530.
13. Conclude — request management adjustment if material.

## Decision Points
- D1: GRN pre + invoice post? YES → verify accrual + inventory recorded. NO → check other combinations.
- D2: Dispatch post + invoice pre? YES → verify not recorded pre-year-end. NO → correct.
- D3: Goods in transit inward recorded as inventory? YES → reclassify. NO → correct.
- D4: Consignment outward revenue on dispatch? YES → reversal required. NO → correct.
- D5: Branch transfer recorded as sale? YES → reclassify. NO → correct.
- D6: C&F confirmation non-response? YES → alternative procedures. NO → accept.
- D7: Exceptions > 5% of sample? YES → extend, escalate. NO → document.

## Professional Skepticism Probes
- Are GRN dates genuine, or backdated?
- Are dispatch dates manipulated to shift revenue/COGS?
- Are goods in transit genuinely in transit, or concealed?
- Is consignment outward genuinely unsold, or sales disguised?
- Are branch transfers properly eliminated, or revenue inflated?
- Are C&F confirmations genuine, or management-facilitated?

## Considerations
- GRN date = primary inward cut-off evidence; dispatch date = primary outward.
- E-way bill timestamp — independent verification.
- Shipping terms (FOB/CIF) determine outward transit cut-off.
- GST: Sec 12 time of supply; Sec 16 ITC on receipt.
- C&F agents: SA 505; non-response → alternative procedures.
- ERP-driven: Evaluate ITGCs over date integrity.

## Common Risks
- GRN backdated to push inventory to current year — profit manipulation.
- Dispatch date manipulated to shift revenue — cut-off error.
- Goods in transit recorded incorrectly — cut-off error.
- Consignment outward revenue on dispatch — fictitious revenue.
- Branch transfer as sale — revenue inflation.
- C&F stock not confirmed — existence risk.

## Fraud Triggers (SA 240)
- GRN backdated near year-end.
- Dispatch date manipulation — pre/post year-end mismatch.
- Goods in transit recorded without GRN.
- Consignment outward revenue on dispatch.
- Branch transfers recorded as sales.
- C&F confirmations received via management.
- Round-amount inventory cut-off entries.

## Common Pitfalls
- Using invoice date as primary cut-off — GRN/dispatch date is primary.
- Not verifying GRN/dispatch date independently.
- Skipping goods in transit testing.
- Treating consignment outward as sale.
- Not eliminating branch transfers on consolidation.
- Not confirming C&F stock per SA 505.

## Validation
- [ ] Cut-off info from physical count obtained.
- [ ] GRN + dispatch registers obtained.
- [ ] GRN-to-inventory and GRN-to-purchase matching.
- [ ] Dispatch-to-COGS and dispatch-to-revenue matching.
- [ ] Goods in transit (inward + outward) tested.
- [ ] Consignment outward/inward tested.
- [ ] Branch transfers tested.
- [ ] C&F agent stock confirmed per SA 505.
- [ ] Sample selected (last 20+ GRN pre + first 20+ dispatch post).
- [ ] Exceptions projected per SA 530.

## Expected Outputs
- Cut-off testing schedule (GRN-to-inventory, dispatch-to-COGS).
- Sample vouching summary.
- Goods in transit review memo.
- Consignment outward/inward assessment.
- Branch transfer elimination schedule.
- C&F agent stock confirmation summary.
- Exception summary with classification and projection.
- Conclusion on inventory cut-off.

## Failure Conditions
- GRN/dispatch register not maintained.
- Cut-off info from physical count not available.
- C&F agent confirmations not obtainable and material.

## Escalation Conditions
- Exceptions > 10% of sample → extend sample, partner consultation.
- GRN/dispatch backdated evidence → STOP, trigger SA 240 fraud workflow.
- Consignment outward revenue on dispatch material → STOP, revenue reversal, escalate.
- C&F non-response material → STOP, alternative procedures, consider scope limitation.
- Branch transfer as sale material → STOP, revenue reversal, escalate.
