# Bank Balance Confirmation

## Purpose
Obtain independent bank confirmation for all accounts (current/savings/CC/loan/FD/margin/foreign/dormant/closed) per SA 505. Address management refusal, perform alternative procedures.

## Scope
- USE WHEN: Material bank balances; CC/OD/loan accounts; foreign accounts.
- DO NOT WHEN: Bank balances immaterial and risk assessed low.
- AUDIT AREAS: All bank accounts, FDs, margin money, ECB/foreign accounts, dormant/closed accounts.

## Audit Objective
- Assertions: Existence, completeness, rights, valuation, presentation.
- Framework: SA 505 (External Confirmations), SA 330, Ind AS 7 (cash equivalents), CARO 2020.

## Workflow Dependencies
- REQUIRES: Trial Balance Validation, Risk Assessment, Bank Reconciliation Testing.
- FEEDS: Audit Reporting, Going Concern Assessment, Borrowings Testing.

## Required Inputs
- Bank account master (all accounts, type, currency, status).
- Year-end BRS for all accounts.
- FD schedules, margin money deposits, ECB/FEMA approvals.
- Loan/CC/OD account statements; sanction letters.

## Optional Inputs
- Prior-year confirmations; bank statement year-end balances.

## Knowledge
- SA 505: Auditor controls confirmation process — request, dispatch, receipt.
- SA 505.A: Maintain control over sending/recieving; address to appropriate authority.
- RBI Master Directions: FEMA reporting for foreign accounts; ECB regulations.
- CARO 2020 Cl 21(xii): Disclose accounts where investor education fund credited (unclaimed >10 yrs).
- Ind AS 7.6: Cash equivalents — short-term, highly liquid investments.
- SA 505.A28: If management refuses — ask why, perform alternative, consider implications.

## Workflow
1. Obtain complete bank account master:
   - Verify against GL, prior year, RBI/FEMA filings.
2. List all accounts by type:
   - Current, savings, CC, OD, loan, FD, margin money, foreign currency, dormant, closed.
3. Verify no account omitted:
   - IF GL account not in master → investigate.
   - IF closed account has balance → exception.
4. Prepare confirmation requests:
   - Address to bank branch manager; auditor-controlled dispatch.
   - Include account number, type, currency, FD details, loan/CC/OD, margin.
5. Send confirmations by auditor — not through client.
6. Track responses; follow up non-replies.
7. Reconcile confirmation to GL and BRS:
   - IF discrepancy → investigate; obtain explanation.
8. Test FD/margin money:
   - Verify FD receipts, lien, maturity.
   - IF margin against LC/BG → verify against outstanding LC/BG.
9. Test foreign accounts:
   - Verify FEMA compliance; convert at year-end RBI rate.
10. Test dormant/closed accounts:
    - IF dormant with movement → exception.
    - IF closed but balance in GL → exception.
11. Address non-response/refusal:
    - IF no response → alternative procedures (bank statements, subsequent clearing).
    - IF management refuses → SA 505.A28; document; assess implications.
12. Evaluate exceptions — factual/projected/anomalous; project per SA 530.

## Decision Points
- D1: All accounts identified? YES → proceed. NO → extend search.
- D2: Confirmation received? YES → reconcile. NO → alternative procedures.
- D3: Discrepancy with BRS/GL? YES → investigate, adjust. NO → proceed.
- D4: Management refuses? YES → SA 505 alternative, document implications. NO → proceed.
- D5: Dormant/closed account with balance? YES → exception, investigate. NO → proceed.
- D6: Foreign account FEMA compliant? YES → proceed. NO → flag.

## Professional Skepticism Probes
- Is bank account master genuinely complete, or accounts hidden?
- Are confirmations genuinely independent, or routed through client?
- Are FDs genuine, or fabricated receipts?
- Are dormant accounts genuinely dormant?
- Are foreign accounts FEMA compliant?
- Are CC/OD limits genuinely sanctioned, or excess drawing concealed?

## Considerations
- Multi-bank operations: reconcile across all.
- Sweep accounts: verify cash vs FD classification.
- Unclaimed deposits (10 years): transfer to IEPF (Sec 124).
- ECB accounts: FEMA reporting, end-use compliance.
- Bank charges/interest — verify in BRS.

## Common Risks
- Accounts omitted from master.
- Confirmation routed through client; manipulated response.
- FD receipts fabricated; lien undisclosed.
- Foreign accounts non-compliant with FEMA.
- Dormant accounts used to hide transactions.

## Fraud Triggers (SA 240)
- Accounts not disclosed; appearing in GL but not in master.
- Confirmation refused without rationale.
- FD receipts without bank confirmation.
- Dormant account with sudden large movement.
- Foreign account without FEMA approval.
- CC/OD limit exceeded consistently without sanction enhancement.
- Bank statement altered; confirmation mismatch.

## Common Pitfalls
- Not including all account types (margin, foreign, dormant).
- Allowing client to dispatch confirmations.
- Not following up non-replies.
- Skipping FD lien verification.
- Missing FEMA compliance for foreign accounts.

## Validation
- [ ] Complete bank account master obtained.
- [ ] All account types confirmed.
- [ ] Confirmation requests auditor-controlled.
- [ ] Responses tracked and reconciled.
- [ ] FD/margin money tested.
- [ ] Foreign accounts FEMA compliance tested.
- [ ] Dormant/closed accounts reviewed.
- [ ] Alternative procedures for non-response.
- [ ] Management refusal addressed per SA 505.
- [ ] CARO 2020 disclosures verified.
- [ ] Exceptions projected per SA 530.

## Expected Outputs
- Bank confirmation summary (account-wise).
- Confirmation request copies (auditor-controlled).
- Reconciliation to GL and BRS.
- FD/margin money test memo.
- Foreign account FEMA memo.
- Dormant/closed account review.
- Alternative procedure memo (non-response).
- Management refusal memo (if any).
- Exception summary with projection.
- Conclusion on bank balances per SA 505.

## Failure Conditions
- Complete account master not provided.
- Confirmations refused; alternative procedures not feasible.
- Bank statements unavailable for alternative procedures.

## Escalation Conditions
- Confirmation refused materially without rationale → STOP, SA 505 implications, partner consultation.
- Account material and undisclosed → STOP, fraud risk (SA 240), escalate.
- Foreign account material without FEMA compliance → STOP, refer FEMA, escalate.
- Dormant account with material unexplained movement → STOP, fraud risk, escalate.
