# Revenue Cut-Off Testing

## Purpose
Verify revenue recorded in correct accounting period per Ind AS 115 and accrual concept. Test last-week-March and first-week-April transactions for proper cut-off. Detect premature or deferred revenue recognition.

## Scope
- USE WHEN: Every statutory audit — cut-off is presumed fraud risk under SA 240.
- DO NOT USE WHEN: Revenue below materiality threshold.
- AUDIT AREAS: Sale of goods, services, long-term contracts, bill-and-hold, consignment.

## Audit Objective
- Assertions: Cut-off, occurrence, completeness, accuracy.
- Framework: Ind AS 115 (5-step model — control transfer), SA 240, SA 530.

## Workflow Dependencies
- REQUIRES: Revenue Recognition Testing, Data Profiling, Trial Balance Validation.
- FEEDS: Evaluation of Misstatements, Sales Returns Testing, AR Confirmation.

## Required Inputs
- Sales register (date, invoice number, customer, amount, dispatch date).
- Dispatch documents — GRN (customer), lorry receipt, e-way bill, BL/AWB for exports.
- Customer POs and contracts.
- Shipping terms (FOB, CIF, ex-works).
- Sales returns register for first 30 days post year-end.

## Optional Inputs
- Branch transfer records.
- Consignment outward records.
- Stock at C&F agent records.
- Service completion certificates (for services).

## Knowledge
- Ind AS 115: Control transfer — typically on dispatch for goods, on service completion for services.
- Shipping terms: FOB — control on shipment; CIF — control on delivery at destination.
- SA 240: Revenue cut-off is presumed fraud risk — mandatory testing.
- GST Sec 31: Time of supply — issue of invoice or last date of month, whichever earlier.
- E-way bill: Required for movement of goods > ₹50,000.
- Bill-and-hold: Control transfer requires specific criteria (Ind AS 115).

## Workflow
1. Profile sales by week — flag last-week-March spike and first-week-April reversal.
   - IF spike > 20% of normal weekly sales → mandatory detailed testing.
2. Select sample:
   - Last 20+ sales invoices pre-year-end (March 25-31).
   - First 20+ sales invoices post-year-end (April 1-7).
   - High-value last-week transactions — 100%.
3. For pre-year-end sales — verify control transferred before year-end:
   - Vouch to GRN (customer-acknowledged), lorry receipt, e-way bill.
   - Confirm shipping terms — FOB shipment vs CIF destination.
   - IF dispatched pre-year-end but invoiced post → verify revenue recorded in correct period.
4. For post-year-end sales — verify not recognized pre-year-end:
   - Vouch to dispatch date — confirm dispatch post year-end.
   - IF dispatched post-year-end but invoiced pre → revenue reversal or cut-off error.
5. For services:
   - Verify service completion certificate.
   - IF milestone-based → confirm milestone achieved pre-year-end.
6. For long-term contracts:
   - Verify POC as of year-end.
   - IF cost incurred post-year-end for pre-year-end revenue → investigate.
7. Bill-and-hold transactions:
   - Verify reasons for bill-and-hold.
   - Confirm product identified separately, ready for transfer, customer requested.
   - IF criteria not met → revenue reversal.
8. Consignment outward:
   - Verify revenue recognized only on customer sale (not on consignment).
   - IF revenue recognized on consignment dispatch → reversal.
9. Branch transfers:
   - Verify not recognized as revenue (inter-company elimination).
10. Stock at C&F agents:
    - Verify ownership transfer to customer; if still with company, no revenue.
11. Evaluate exceptions:
    - Classify factual (period incorrect), projected, anomalous.
    - Project per SA 530.
12. Conclude on cut-off — request management adjustment if material.

## Decision Points
- D1: Last-week-March spike > 20%? YES → mandatory detailed cut-off testing. NO → standard sample.
- D2: Dispatched pre-year-end, invoiced post? YES → verify revenue recorded in March (correct). NO → check reverse.
- D3: Dispatched post-year-end, invoiced pre? YES → revenue reversal required. NO → correct.
- D4: Bill-and-hold? YES → verify Ind AS 115 criteria. NO → standard.
- D5: Consignment outward? YES → revenue on customer sale only. NO → standard.
- D6: Cut-off exceptions > 5% of sample? YES → extend sample, escalate. NO → document.

## Professional Skepticism Probes
- Why last-week-March spike — genuine or channel stuffing?
- Are dispatch documents backdated — verify e-way bill timestamp?
- Are shipping terms genuinely FOB, or disguised CIF?
- Are bill-and-hold transactions genuine, or fictitious?
- Are consignment sales genuinely customer sales, or revenue inflation?
- Are branch transfers excluded from revenue?
- Is revenue from new customers at year-end genuine?

## Considerations
- E-way bill timestamp: Independent verification — cannot be backdated.
- GST vs books: GSTR-1 vs revenue ledger — material variance investigated.
- Industry practice: Cut-off window may need extension for seasonal businesses.
- Export sales: BL/AWB date — verify from shipping line independently.
- Related parties: Sec 188 approval, arm's length, separate cut-off test.
- Long-term contracts: POC method — re-compute independently.

## Common Risks
- Backdated dispatch documents.
- Premature recognition — control not transferred.
- Bill-and-hold without Ind AS 115 criteria.
- Consignment treated as sale.
- Branch transfer recorded as revenue.
- Cut-off manipulation via channel stuffing.

## Fraud Triggers (SA 240)
- Last-week-March spike > 20% of normal weekly sales.
- Dispatch documents missing or backdated.
- E-way bill timestamp post invoice date.
- Round-amount year-end invoices.
- Sales to newly incorporated customers at year-end.
- Side letters offering return rights — channel stuffing.
- Bill-and-hold without business rationale.

## Common Pitfalls
- Not testing post-year-end dispatches for pre-year-end revenue.
- Accepting "dispatched" without checking shipping terms.
- Not verifying e-way bill timestamp independently.
- Treating bill-and-hold as valid without criteria check.
- Ignoring consignment — recognizing on dispatch.

## Validation
- [ ] Last 20+ pre-year-end + first 20+ post-year-end sales tested.
- [ ] Dispatch documents vouched (GRN, LR, e-way bill).
- [ ] Shipping terms verified (FOB/CIF).
- [ ] E-way bill timestamps checked independently.
- [ ] Bill-and-hold transactions assessed per Ind AS 115.
- [ ] Consignment, branch transfer, C&F stock reviewed.
- [ ] Long-term contracts POC re-computed.
- [ ] Exceptions projected per SA 530.

## Expected Outputs
- Cut-off testing schedule (pre and post year-end).
- Dispatch document vouching summary.
- E-way bill verification log.
- Bill-and-hold assessment memo.
- Consignment / branch transfer review.
- Exception summary with classification and projection.
- Conclusion on revenue cut-off.

## Failure Conditions
- Dispatch documents missing for material sales.
- E-way bill data not available.
- Customer POs and contracts unavailable.
- Stock at C&F agents not confirmed.

## Escalation Conditions
- Cut-off exceptions > 10% of sample → extend sample, partner consultation.
- Backdated dispatch documents → STOP, trigger SA 240 fraud workflow.
- Bill-and-hold without Ind AS 115 criteria → STOP, revenue reversal required, escalate.
- Channel stuffing evidence (side letters, post-year-end returns) → STOP, trigger SA 240, consider Sec 143(12).
