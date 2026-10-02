# Cash and Petty Cash Testing

## Purpose
Verify cash on hand and petty cash. Test cash counts, imprest system, surprise counts, unclaimed wages, IOU vouchers, multi-location cash, large cash transactions (IT Sec 269ST/269SS/269T).

## Scope
- USE WHEN: Material cash balance; multi-location cash; large cash transactions.
- DO NOT WHEN: Cash immaterial; single location with negligible cash.
- AUDIT AREAS: Cash on hand, petty cash, unclaimed wages, IOUs, multi-location cash.

## Audit Objective
- Assertions: Existence, completeness, accuracy, rights, cut-off.
- Framework: SA 505 (physical count), SA 240 (cash fraud risk), IT Act Sec 269ST/269SS/269T, CARO 2020.

## Workflow Dependencies
- REQUIRES: Trial Balance Validation, Bank Reconciliation Testing, Journal Entry Testing.
- FEEDS: Audit Reporting, Evaluation of Misstatements, Fraud Risk Assessment.

## Required Inputs
- Cash book; petty cash register; imprest restoration vouchers.
- Cash count memos (year-end + surprise).
- IOU vouchers; unclaimed wages register.
- Multi-location cash summary.
- Large cash transaction schedule.

## Optional Inputs
- Insurance policy on cash; payroll register; vendor payment mode analysis.

## Knowledge
- Cash count performed on surprise basis at year-end and interim.
- Imprest system: petty cash restored to fixed float; vouchers supported.
- IT Sec 269ST: No cash receipt ≥2 lakh per transaction/event/day.
- IT Sec 269SS: No cash loan/deposit ≥20,000.
- IT Sec 269T: No cash repayment of loan/deposit ≥20,000.
- CARO 2020 Cl 21(xii): Cash transactions covered u/s 269ST.
- SA 240.A6: Cash transactions — high fraud risk; obsolescence risk.

## Workflow
1. Obtain cash book and petty cash register — tie to GL.
2. Perform cash count at year-end (surprise):
   - Count physically; document denomination, currency.
   - IF count differs from book → exception, investigate.
3. Verify multi-location cash:
   - Obtain simultaneous counts; IF remote locations → obtain count memos signed.
4. Verify petty cash imprest:
   - Verify float maintained; restoration vouchers supported.
   - IF float not restored → exception.
5. Test IOU vouchers:
   - IF IOU outstanding → verify business purpose, recovery plan.
   - IF IOU aged → exception; potential misappropriation.
6. Test unclaimed wages:
   - Verify aging; IF aged >limit → deposit to "unclaimed wages" account.
7. Test large cash transactions:
   - Scan cash receipts ≥2 lakh (Sec 269ST).
   - Scan cash loans/deposits ≥20,000 (Sec 269SS).
   - Scan cash repayments ≥20,000 (Sec 269T).
   - IF breach → exception; income tax disallowance risk.
8. Test cut-off:
   - Cash receipts/payments at year-end; verify in correct period.
9. Verify revenue receipts in cash:
   - IF large cash sales → assess business rationale; potential unrecorded revenue.
10. Test unusual items:
    - IF unusual cash receipt → investigate source.
    - IF unusual cash payment → investigate payee.
11. Verify insurance coverage for cash in hand.
12. Evaluate exceptions — factual/projected/anomalous; project per SA 530.

## Decision Points
- D1: Cash count matches book? YES → proceed. NO → investigate, adjust.
- D2: Imprest maintained? YES → proceed. NO → exception.
- D3: IOU outstanding aged? YES → exception, recover. NO → proceed.
- D4: Unclaimed wages aged >limit? YES → deposit to separate account. NO → proceed.
- D5: Cash transactions breach Sec 269ST/269SS/269T? YES → flag, IT risk. NO → proceed.
- D6: Multi-location counts obtained? YES → proceed. NO → extend.

## Professional Skepticism Probes
- Is cash count genuinely surprise, or pre-arranged?
- Are IOU vouchers genuine advances, or misappropriation?
- Are large cash receipts genuine business, or off-book revenue?
- Are unclaimed wages genuine, or parked funds?
- Is multi-location cash genuinely counted, or fabricated memos?
- Are cash payments to vendors genuine, or routed funds?

## Considerations
- Industry: Retail/hospitality — higher cash volume.
- Insurance: Cash in hand, cash in transit.
- Forex cash: Convert at year-end RBI rate.
- Cash management policy: Limits on cash holding.

## Common Risks
- Cash count not surprise; balance manipulated.
- IOU outstanding aged indefinitely.
- Unclaimed wages retained in cash.
- Cash transactions breach Sec 269ST/269SS/269T.
- Multi-location cash fabricated without physical count.

## Fraud Triggers (SA 240)
- Cash count not permitted or pre-arranged.
- Large unexplained cash balance.
- IOU outstanding to related party.
- Cash receipt ≥2 lakh in single transaction (Sec 269ST breach).
- Cash loan/deposit ≥20,000 (Sec 269SS breach).
- Manual JEs adjusting cash balance.
- Cash payment to vendor with vague narration.

## Common Pitfalls
- Not performing surprise count.
- Skipping multi-location count.
- Accepting IOU without recovery plan.
- Missing Sec 269ST/269SS/269T scan.
- Not testing unclaimed wages aging.

## Validation
- [ ] Cash book and petty cash tied to GL.
- [ ] Surprise cash count performed.
- [ ] Multi-location cash counted.
- [ ] Petty cash imprest tested.
- [ ] IOU vouchers tested.
- [ ] Unclaimed wages aging tested.
- [ ] Sec 269ST scan performed.
- [ ] Sec 269SS/269T scan performed.
- [ ] Cut-off tested.
- [ ] Unusual items investigated.
- [ ] Insurance coverage verified.
- [ ] Exceptions projected per SA 530.

## Expected Outputs
- Cash count memo (year-end + surprise).
- Petty cash imprest test memo.
- IOU voucher test schedule.
- Unclaimed wages aging schedule.
- Sec 269ST/269SS/269T compliance memo.
- Multi-location cash summary.
- Exception summary with projection.
- Conclusion on cash and petty cash per SA 505/240.

## Failure Conditions
- Cash count not permitted.
- Multi-location count memos unavailable.
- Large cash transactions not investigable.

## Escalation Conditions
- Cash count refused → STOP, fraud risk (SA 240), partner consultation, consider qualification.
- Sec 269ST breach material → STOP, IT disallowance risk, escalate.
- IOU outstanding to related party material → STOP, fraud risk, escalate.
- Unexplained large cash balance → STOP, investigate source, escalate.
