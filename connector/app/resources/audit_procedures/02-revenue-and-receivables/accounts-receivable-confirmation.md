# Accounts Receivable Confirmation

## Purpose
Obtain direct external confirmation of AR balances from debtors per SA 505. Verify existence and accuracy. Detect fictitious revenue, related-party balances, and management manipulation.

## Scope
- USE WHEN: Material AR balances; significant risk of fictitious revenue.
- DO NOT USE WHEN: AR immaterial; alternative procedures sufficient.
- AUDIT AREAS: Trade receivables, related-party receivables, advances, deposits.

## Audit Objective
- Assertions: Existence, accuracy, rights, completeness (limited — confirmations test existence, not completeness).
- Framework: SA 505, SA 330, SA 240, Ind AS 109 (ECL), Sec 143(3) Companies Act.

## Workflow Dependencies
- REQUIRES: Revenue Recognition Testing, Trial Balance Validation, Data Profiling, Sampling.
- FEEDS: Evaluation of Misstatements, Audit Reporting, Related Party Testing.

## Required Inputs
- AR ageing summary as of year-end.
- Customer master with addresses, GSTIN, contact persons.
- Sample selection (MUS-based, high-value bias).
- Customer statements / ledgers.
- Post-year-end receipts data (alternative procedure).

## Optional Inputs
- Industry credit terms, seasonality.
- Prior-year confirmation response rates.
- Credit rating, litigation history of major debtors.

## Knowledge
- SA 505.6: Auditor controls confirmation design, dispatch, receipt — mitigate interception by management.
- SA 505.A10: Positive vs negative — positive required for material balances.
- SA 505.8: Non-response → alternative procedures (subsequent receipts, dispatch docs, JE).
- SA 505.A15: Management refusal → inquire, assess, consider qualification.
- SA 240: Revenue presumed fraud risk — confirmation mandatory for significant receivables.
- Sec 143(3)(i): ICFR — controls over AR and credit.

## Workflow
1. Obtain AR ageing as of year-end — tie to GL and FS.
2. Apply MUS sampling:
   - High-value: 100% confirmation (top 80% value).
   - Medium-value: Stratified random selection.
   - Low-value: Haphazard.
3. Maintain auditor control over confirmation process:
   - Use addresses from independent source (GSTIN portal, ROC, customer website).
   - IF management insists on internal addresses → escalate; risk of interception.
4. Prepare confirmation letters — auditor signs and dispatches directly.
5. Send positive confirmations (mandatory for material balances):
   - IF low-value, high-volume → consider negative confirmation.
   - IF negative response received → escalate.
6. Send reminder for non-responses within 30 days.
7. For non-responses — perform alternative procedures:
   - Subsequent cash receipts post year-end.
   - Dispatch documents (GRN, lorry receipt, e-way bill).
   - Customer order and contract.
   - IF no evidence → exception; potential qualification.
8. Investigate exceptions:
   - Disputed amounts — assess ECL per Ind AS 109.
   - Timing differences — reclassification.
   - Unauthorized deductions — credit note testing.
9. Related-party balances:
   - Confirm separately; verify Sec 188 approval, arm's length.
   - IF non-arm's length → Ind AS 24 disclosure; valuation test.
10. Evaluate responses:
    - Confirmations received by auditor (not via management).
    - IF received via management → re-send or alternative procedures.
11. Document response rate, exceptions, conclusions.
12. Conclude on AR existence — project exceptions per SA 530.

## Decision Points
- D1: Material AR balance? YES → positive confirmation mandatory. NO → alternative procedures.
- D2: Confirmation non-response? YES → alternative procedures (subsequent receipts, dispatch docs). NO → document.
- D3: Exception identified? YES → investigate, classify, assess ECL. NO → document.
- D4: Management refuses to permit confirmation? YES → inquire, assess, consider qualification per SA 505. NO → proceed.
- D5: Related-party balance? YES → separate confirmation + Sec 188 + arm's length test. NO → standard.
- D6: Confirmation received via management? YES → re-send or alternative procedures. NO → accept.

## Professional Skepticism Probes
- Are addresses genuine, or routed to management-controlled entity?
- Are responses received too quickly — possibly fabricated?
- Do debtors have capacity to pay, or are they shell entities?
- Are disputes explained, or evaded?
- Are post-year-end receipts genuine customer payments, or round-tripping?
- Are related-party balances genuinely arm's length?
- Why does management resist confirmation of specific customers?

## Considerations
- Response rate: Indian context typically low — alternative procedures essential.
- GSTIN verification: Cross-check customer GSTIN with portal.
- ECL per Ind AS 109: Ageing, historical default, forward-looking.
- Foreign debtors: FEMA compliance, exchange rate.
- Group companies: Confirm inter-company balances; eliminate on consolidation.
- Subsequent events: Post-year-end receipts strongest evidence.

## Common Risks
- Management intercepting confirmations — fabricated responses.
- Using management-provided addresses without verification.
- Accepting late/non-responses without alternative procedures.
- Not testing related-party balances separately.
- Over-reliance on subsequent receipts without checking source.
- Ignoring disputes — ECL understated.

## Fraud Triggers (SA 240)
- Round-amount AR balances.
- Newly incorporated customers with large balances.
- Confirmation responses received via management.
- Customer addresses same as company premises.
- Same bank account/PAN across customers — shell entities.
- Refusal to allow confirmation of specific customers.
- Disputed balances with no ECL provisioning.

## Common Pitfalls
- Using management-provided envelopes for dispatch.
- Not following up on non-responses.
- Treating subsequent receipts as conclusive without source check.
- Not testing related-party balances separately.
- Not projecting exceptions per SA 530.

## Validation
- [ ] AR ageing tied to GL and FS.
- [ ] Sample selected via MUS / stratified.
- [ ] Auditor controls dispatch and receipt.
- [ ] Positive confirmations for material balances.
- [ ] Non-responses — alternative procedures performed.
- [ ] Related-party balances tested separately.
- [ ] Exceptions investigated, classified, projected.
- [ ] ECL per Ind AS 109 assessed for disputed/aged balances.

## Expected Outputs
- AR confirmation summary (sent, received, non-response, exceptions).
- Sample selection schedule.
- Alternative procedures documentation.
- Exception summary with classification.
- ECL assessment for disputed/aged balances.
- Concluding memo on AR existence.

## Failure Conditions
- Management refuses to permit confirmation of material AR.
- Customer master unreliable — addresses invalid.
- Alternative procedures cannot be performed.

## Escalation Conditions
- Management refuses confirmation of material customer → STOP, consider qualification per SA 505.
- Confirmation fraud suspected → STOP, trigger SA 240 workflow.
- Shell customer identified → STOP, escalate to partner, consider Sec 143(12).
- ECL provisioning materially deficient → STOP, escalate, consider qualification.
