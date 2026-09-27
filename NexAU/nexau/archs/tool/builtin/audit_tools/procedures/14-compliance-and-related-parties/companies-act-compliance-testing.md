# Companies Act Compliance Testing

## Purpose
Test compliance with Companies Act 2013 and CARO 2020 to support Sec 143(2) opinion.

## Scope
- USE WHEN: Every Indian company statutory audit.
- DO NOT USE WHEN: LLP audit (LLP Act); branch audit standalone (use SA 600 + branch-specific).
- AUDIT AREAS: Sec 134(3) attachments, Sec 177/178 committees, Sec 135 CSR, Sec 186 loans/investments/guarantees, Sec 73 deposits, Sec 123 dividend, Sec 188 RPT, CARO 2020, Schedule III.

## Audit Objective
- Assertions: Completeness, accuracy, presentation/disclosure, compliance.
- Framework: Companies Act 2013; CARO 2020; Schedule III; SA 250; Sec 134, 177, 178, 135, 186, 73, 123, 188, 143, 139.

## Workflow Dependencies
- REQUIRES: Board Minutes Review, Related Party Transactions Testing, Fixed Assets Testing, Borrowings Testing, JE Testing.
- FEEDS: Audit Conclusion, Audit Reporting, CARO 2020 Reporting, Sec 143(2) Opinion.

## Required Inputs
- Audited financial statements (BS, P&L, Cash Flow, Notes).
- Board / committee minutes (Audit, Nomination, CSR, Stakeholders).
- MGT-7 (annual return); MGT-14; AOC-4; CSR-2; DPT-3; CHG-1/CHG-9.
- Register of loans/investments/guarantees (Sec 186); deposit register (Sec 73); dividend register.

## Optional Inputs
- Secretarial audit report (Sec 204); internal audit reports; prior-year compliance memo.

## Knowledge
- Sec 134(3): Attachments — Director's Report, Auditor's Report, CARO, Secretarial Audit (if applicable), CSR-2.
- Sec 177: Audit committee mandatory for listed / ≥₹10 cr borrowings / ≥₹100 cr turnover / ≥₹50 cr paid-up.
- Sec 178: Nomination & Remuneration Committee and Stakeholders Relationship Committee (listed).
- Sec 135: CSR if net worth ≥₹500 cr OR turnover ≥₹1000 cr OR profit ≥₹5 cr; spend 2% of average net profit (3 preceding years).
- Sec 135(5)/(6): Unspent transferred to specified fund within 6 months (ongoing project — within 3 years per schedule).

## Workflow
1. Verify Sec 134(3) attachments — list; tie to financial statements; IF missing → exception.
2. Test Audit Committee (Sec 177) — verify constitution (2/3 independent, chair independent); minutes; quorum; IF threshold met and not constituted → report.
3. Test Nomination & Remuneration Committee (Sec 178) — verify constitution for listed / prescribed; minutes; KMP appointment process.
4. Test CSR (Sec 135) — verify applicability; compute 2% of average net profit; verify spend; IF shortfall → transfer to specified fund (Sec 135(5)/(6)); CSR-2 filing.
5. Test loans, investments, guarantees (Sec 186) — verify register; compute 60%/100% limit; IF exceeded without special resolution → reportable; verify interest rate floor (1-year govt security YTM) for loans.
6. Test deposits (Sec 73) — verify DPT-3 filing; deposit rules compliance; IF accepted without compliance → repay within statutory timeline.
7. Test dividend (Sec 123) — verify declaration from profits after depreciation; IF losses/depreciation → no dividend (unless Sec 123(1) proviso); verify interim dividend (Sec 123(3)); unpaid dividend to IEPF after 7 years.
8. Test Sec 188 RPT (cross-reference RPT skill).
9. Test charges (Sec 77) — verify CHG-1/CHG-9 filings for created/modified charges; IF charge not registered → unenforceable.
10. Test Schedule III presentation — verify balance sheet format; notes; share capital; reserves; borrowings classification; Indian/foreign currency.
11. Test CARO 2020 (clauses i to xvi) — P&E (i-ii); intangibles (iii); inventory (iv); loans (xvi); disqualified directors (viii); dividend (ix); fraud (xii).
12. Test Sec 204 secretarial audit (if applicable) — listed / ≥₹250 cr paid-up → secretarial auditor appointment; report attached. Evaluate Sec 143(12) reporting for fraud. Aggregate compliance exceptions; assess impact on opinion and CARO reporting.

## Decision Points
- D1: CSR applicable? YES → verify 2% spend and shortfall transfer. NO → no CSR compliance.
- D2: Sec 186 limit exceeded? YES → special resolution obtained? NO → report.
- D3: Dividend declared per Sec 123? YES → proceed. NO → if losses/depreciation, no dividend.
- D4: Charges registered per Sec 77? YES → proceed. NO → unenforceable; disclose.
- D5: CARO 2020 applicable? YES → test all 16 clauses. NO → disclose exemption.

## Professional Skepticism Probes
- Are Sec 186 loans genuinely at arm's length or routed to related parties?
- Is CSR spend genuine or inflated via related party donations?
- Are dividends declared on real profits or manipulated earnings?
- Are deposits accepted disguised as loans to avoid Sec 73 compliance?
- Are charge filings updated for modifications or stale?

## Considerations
- Sec 135 CSR: Administrative overhead capped at 5% of total CSR spend.
- Sec 186: Investment in wholly-owned subsidiary exempt from limit (Sec 186(2) proviso).
- Sec 73: Private company accepting deposits from members exempt subject to conditions.
- Schedule III: Revised effective FY 2021-22 — additional disclosures (trade payables ageing, P&E, Benami, title disputes, crypto).
- Sec 143(12): Material fraud ≥₹1 cr reporting threshold (Rule 13 of Audit Rules).

## Common Risks
- CSR shortfall not transferred to specified fund.
- Sec 186 limit exceeded without special resolution.
- Dividend declared despite insufficient profits.
- Deposits accepted without Sec 73 compliance / DPT-3.
- Charges not registered / modified.

## Fraud Triggers (SA 240)
- Sec 186 loans to shell companies related to directors.
- CSR donations to related party trusts.
- Dividend declared based on inflated profits.
- Deposits from undisclosed related parties in disguise.
- Charges suppressed to avoid secured creditor disclosure.

## Common Pitfalls
- Not verifying Sec 186 limits with computed denominators.
- Missing CSR shortfall transfer provision (Sec 135(6)).
- Accepting dividend declaration without depreciation check.
- Not testing DPT-3 with deposit register.
- Not reconciling CHG-1 filings with charge creation in loan documents.

## Validation
- [ ] Sec 134(3) attachments verified.
- [ ] Sec 177/178 committees constitution and minutes verified.
- [ ] Sec 135 CSR applicability, 2% computation, shortfall transfer tested.
- [ ] Sec 186 limit and register tested; Sec 185 prohibition tested.
- [ ] Sec 73 deposits tested; DPT-3 verified.

## Expected Outputs
- Companies Act compliance master working paper.
- Sec 177/178 committee memo; Sec 135 CSR memo.
- Sec 186 loans/investments/guarantees memo with limit computation.
- Sec 73 deposits memo; Sec 123 dividend memo.

## Failure Conditions
- Board / committee minutes not produced.
- Registers (Sec 186, deposits, dividend) not maintained.
- Filings (MGT-7, AOC-4, DPT-3, CSR-2) unavailable.

## Escalation Conditions
- Material Sec 186 / Sec 185 breach → STOP, Sec 143(12) reporting, partner consultation.
- Material CARO 2020 misstatement → STOP, modify CARO reporting and audit opinion.
- Material fraud identified (Sec 143(12) ≥₹1 cr) → STOP, central government reporting.
- Material non-compliance with Schedule III / Sec 134(3) → STOP, modify opinion (SA 705).
