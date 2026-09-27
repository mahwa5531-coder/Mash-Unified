# Bank Reconciliation Testing

## Purpose
Verify year-end BRS for all accounts. Test long-outstanding items, stale cheques, unidentified credits/debits, year-end BRS vs subsequent clearing, items >6 months.

## Scope
- USE WHEN: All bank accounts; material year-end BRS items.
- DO NOT WHEN: Bank balances immaterial.
- AUDIT AREAS: All bank BRS, CC/OD/loan BRS, FD, foreign currency accounts.

## Audit Objective
- Assertions: Existence, completeness, accuracy, valuation, cut-off.
- Framework: SA 330, SA 505, SA 240 (stale items as fraud indicator).

## Workflow Dependencies
- REQUIRES: Bank Balance Confirmation, Trial Balance Validation, Journal Entry Testing.
- FEEDS: Audit Reporting, Evaluation of Misstatements, Cash & Petty Cash Testing.

## Required Inputs
- Year-end BRS for all accounts.
- Bank statements (year-end + subsequent 1–2 months).
- Outstanding cheques/deposits schedule.
- Unidentified credits/debits schedule.
- Prior-year BRS for comparison.

## Optional Inputs
- GL detail; vendor/customer aging.

## Knowledge
- BRS reconciles bank balance per bank to per books.
- Outstanding cheques: issued but not cleared; verify subsequent clearing.
- Outstanding deposits: deposited but not credited; verify subsequent clearing.
- Items >6 months: stale cheque per RBI; write-back to income or investigate.
- SA 240.A6: Stale items, unidentified credits — fraud indicators.
- Sec 269ST/269SS/269T (IT Act): cash transactions; relevant for cash BRS items.
- RBI Master Direction: Cheque validity 3 months.

## Workflow
1. Obtain year-end BRS for all accounts — verify completeness.
2. Tie BRS opening balance to prior-year closing.
3. Verify arithmetical accuracy of BRS.
4. Test outstanding cheques:
   - Vouch to cheque register; verify subsequent clearing.
   - IF >6 months outstanding → stale; write-back to income.
5. Test outstanding deposits:
   - Vouch to deposit slips; verify subsequent clearing.
   - IF >6 months outstanding → investigate; possible fictitious entry.
6. Test bank charges/interest:
   - Verify in bank statement; confirm recorded in books.
7. Test unidentified credits/debits:
   - IF unidentified credit → investigate source; potential fraud.
   - IF unidentified debit → investigate payee; potential misappropriation.
8. Test subsequent clearing:
   - Items in year-end BRS should clear in subsequent 1–2 months.
   - IF not cleared → exception; assess validity.
9. Test foreign currency BRS:
   - Verify year-end conversion rate (RBI); exchange diff to P&L.
10. Test CC/OD BRS:
    - Verify limit sanction; assess excess drawing.
11. Compare prior-year items to current-year clearing:
    - IF prior items still outstanding → exception; investigate.
12. Evaluate exceptions — factual/projected/anomalous; project per SA 530.

## Decision Points
- D1: BRS for all accounts obtained? YES → proceed. NO → obtain.
- D2: Items >6 months? YES → stale, write-back/investigate. NO → proceed.
- D3: Unidentified credits/debits? YES → investigate. NO → proceed.
- D4: Subsequent clearing verified? YES → proceed. NO → exception.
- D5: Foreign currency conversion correct? YES → proceed. NO → adjust.
- D6: Prior items still outstanding? YES → investigate, adjust. NO → proceed.

## Professional Skepticism Probes
- Are outstanding items genuine, or fabricated to conceal shortfall?
- Are unidentified credits genuinely unidentified, or off-book revenue?
- Are stale cheques written back, or carried indefinitely?
- Are subsequent clearings genuine, or reversed post-audit?
- Are CC/OD limits genuinely within sanction, or excess concealed?
- Are foreign currency conversions at correct RBI rate?

## Considerations
- Multi-bank operations: reconcile each separately.
- Internet banking: verify reconciliation logic; reconciliation software.
- Bulk cheque issuance (payroll): aged items.
- Cash credit accounts: daily drawing pattern.

## Common Risks
- Outstanding items carried >6 months without write-back.
- Unidentified credits retained in suspense.
- Stale cheques not written back to income.
- Foreign currency conversion incorrect.
- Subsequent clearing not verified.

## Fraud Triggers (SA 240)
- Large unidentified credit retained.
- Stale cheque written back to related party.
- Outstanding items reversed post-audit.
- Manual JEs adjusting bank balance.
- CC/OD excess drawing concealed.
- BRS not prepared for some accounts.
- Cheques issued but not recorded in books (unrecorded liability).

## Common Pitfalls
- Not obtaining BRS for all accounts.
- Skipping arithmetical check.
- Accepting items >6 months without write-back.
- Not testing subsequent clearing.
- Missing foreign currency conversion test.

## Validation
- [ ] BRS for all accounts obtained.
- [ ] Opening tied to prior-year closing.
- [ ] Arithmetical accuracy verified.
- [ ] Outstanding cheques tested.
- [ ] Outstanding deposits tested.
- [ ] Stale items (>6 months) addressed.
- [ ] Unidentified credits/debits investigated.
- [ ] Subsequent clearing verified.
- [ ] Foreign currency conversion tested.
- [ ] CC/OD limit tested.
- [ ] Prior-year items reviewed.
- [ ] Exceptions projected per SA 530.

## Expected Outputs
- BRS testing workpaper (account-wise).
- Outstanding items test memo.
- Stale items write-back schedule.
- Unidentified credits/debits investigation memo.
- Subsequent clearing verification.
- Foreign currency conversion memo.
- CC/OD limit test memo.
- Exception summary with projection.
- Conclusion on BRS per SA 330/505.

## Failure Conditions
- BRS not prepared for material accounts.
- Bank statements unavailable.
- Unidentified credits/debits not investigated.

## Escalation Conditions
- Large unidentified credit retained materially → STOP, fraud risk (SA 240), partner consultation.
- Stale items not written back material → STOP, propose adjustment.
- BRS not prepared for material account → STOP, qualification risk, escalate.
- Subsequent clearing not verifiable materially → STOP, alternative procedures, escalate.
