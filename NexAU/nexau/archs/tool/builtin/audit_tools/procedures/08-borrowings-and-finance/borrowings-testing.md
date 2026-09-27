# Borrowings Testing

## Purpose
Verify borrowings per Ind AS 109. Test term loans, working capital, CC/OD, ECB (FEMA), convertible instruments, debenture redemption, security, default status (CARO 2020).

## Scope
- USE WHEN: Material borrowings; term loans; ECB; convertible instruments; debentures.
- DO NOT WHEN: Borrowings immaterial.
- AUDIT AREAS: Term loans, working capital, CC/OD, ECB, NCDs/debentures, convertible instruments, lease liabilities.

## Audit Objective
- Assertions: Completeness, existence, valuation, rights, presentation.
- Framework: Ind AS 109, Ind AS 32, Ind AS 113, FEMA, Companies Act Sec 71/62/180, CARO 2020.

## Workflow Dependencies
- REQUIRES: Trial Balance Validation, Finance Costs Testing, Financial Instruments Valuation.
- FEEDS: Audit Reporting, Going Concern Assessment, Deferred Tax Testing.

## Required Inputs
- Borrowings schedule with sanction, drawdown, repayment, balance.
- Loan agreements; sanction letters; FEMA approvals (ECB).
- Debenture trust deed; redemption reserve workings.
- Convertible instrument terms; conversion schedule.
- Security/charge creation documents (Form CHG-1/8/9).

## Optional Inputs
- Prior-year schedule; credit rating reports; covenant compliance certificates.

## Knowledge
- Ind AS 109: Borrowings at amortised cost using EIR; transaction costs adjusted.
- Ind AS 32.16: Convertible — split into debt + equity components at inception.
- FEMA ECB Regulations: ECB limit, all-in-cost ceiling, end-use, reporting (Form ECB-2).
- Companies Act Sec 71: Debentures — redemption reserve (DRR) 25% for NCDs to non-convertible.
- Companies Act Sec 62(3): Convertible debentures — preferential allotment norms.
- Companies Act Sec 77/79: Charge creation within 30 days; satisfaction filing.
- CARO 2020 Cl 11(xii): Default in repayment >90 days disclosed; clause (xvi) on borrowings for dividend to investing parties.

## Workflow
1. Obtain borrowings schedule — tie to GL and FS notes.
2. Verify sanction and drawdowns:
   - Vouch to loan agreements; verify limits, drawdowns.
   - IF drawn in tranches → verify each tranche.
3. Verify classification:
   - Current (maturity ≤12 months) vs non-current.
4. Test amortised cost:
   - EIR (effective interest rate) including transaction costs.
   - Re-compute interest and carrying amount; verify schedule.
5. Test CC/OD:
   - Verify sanctioned limit; year-end drawing; subsequent clearing.
   - IF excess drawing → exception.
6. Test ECB:
   - Verify FEMA approval; all-in-cost ceiling; end-use compliance.
   - Verify ECB-2 reporting; conversion at year-end RBI rate.
   - IF end-use breach → exception; RBI penalty risk.
7. Test debentures (Sec 71):
   - Verify DRR creation (25% for non-convertible NCDs).
   - Verify redemption schedule; debenture trust deed.
   - IF listed → SEBI compliance; credit rating.
8. Test convertible instruments (Ind AS 32):
   - Split debt + equity at inception; verify conversion ratio.
   - IF converted during year → verify conversion entries.
9. Test security/charge (Sec 77/79):
   - Verify CHG-1/8/9 filing within 30 days.
   - IF charge unsatisfied → verify Form CHG-4.
10. Test default status (CARO 2020):
    - IF default >90 days in repayment → disclose principal + interest.
11. Test covenant compliance:
    - IF covenant breached → assess going concern, disclosure.
12. Test related-party borrowings:
    - IF related party → arm's length; Ind AS 24 disclosure.
13. Evaluate exceptions — factual/projected/anomalous; project per SA 530.

## Decision Points
- D1: Amortised cost computed correctly? YES → proceed. NO → adjust.
- D2: ECB FEMA compliant? YES → proceed. NO → flag RBI risk.
- D3: DRR created (Sec 71)? YES → proceed. NO → exception.
- D4: Convertible split correctly? YES → proceed. NO → re-classify.
- D5: Default >90 days? YES → CARO 2020 disclosure. NO → proceed.
- D6: Covenant breached? YES → going concern, disclose. NO → proceed.

## Professional Skepticism Probes
- Is amortised cost computed using EIR including transaction costs?
- Is ECB end-use genuinely compliant, or routed?
- Is DRR genuinely created, or under-provided?
- Is convertible split based on substance, or manipulated?
- Is default disclosed despite management assurance?
- Are covenants genuinely complied, or waived verbally?

## Considerations
- Multi-currency borrowings: convert at year-end RBI rate; exchange diff to P&L.
- Refinancing: modification per Ind AS 109 (10% test).
- Lease liabilities (Ind AS 116): included in borrowings.
- Group borrowings: corporate guarantee; cross-default.

## Common Risks
- EIR not computed; transaction costs expensed.
- ECB end-use non-compliant; FEMA risk.
- DRR under-provided for debentures.
- Convertible split not performed.
- Default not disclosed (CARO 2020).
- Charge creation filing delayed.

## Fraud Triggers (SA 240)
- Borrowing omitted from schedule; off-balance-sheet.
- ECB end-use funds routed to related party.
- Convertible split manipulated to favour equity component.
- Default concealed despite clear evidence.
- Refinancing to avoid covenant breach.
- Manual JEs adjusting borrowing balance.
- Charge creation not filed; secured borrowings shown as unsecured.

## Common Pitfalls
- Not testing EIR computation.
- Skipping ECB end-use check.
- Missing DRR for non-convertible NCDs.
- Treating convertible as single instrument.
- Not testing CARO 2020 default disclosure.
- Missing charge creation filing check.

## Validation
- [ ] Borrowings schedule tied to GL and FS.
- [ ] Sanction/drawdown verified.
- [ ] Current/non-current tested.
- [ ] Amortised cost (EIR) re-computed.
- [ ] CC/OD limit tested.
- [ ] ECB FEMA compliance tested.
- [ ] Debenture DRR tested (Sec 71).
- [ ] Convertible split tested (Ind AS 32).
- [ ] Security/charge filing tested (Sec 77/79).
- [ ] CARO 2020 default disclosure verified.
- [ ] Covenant compliance tested.
- [ ] Related-party borrowings disclosed (Ind AS 24).
- [ ] Exceptions projected per SA 530.

## Expected Outputs
- Borrowings testing workpaper.
- Amortised cost re-computation schedule.
- ECB FEMA compliance memo.
- Debenture DRR test memo.
- Convertible split memo (Ind AS 32).
- Charge creation filing checklist.
- CARO 2020 default disclosure memo.
- Covenant compliance memo.
- Exception summary with projection.
- Conclusion on borrowings per Ind AS 109/32/FEMA/Companies Act.

## Failure Conditions
- Loan agreements unavailable; sanction letters missing.
- ECB-2 returns not filed; FEMA non-compliance.
- Debenture trust deed unavailable.

## Escalation Conditions
- Borrowing omitted materially → STOP, fraud risk (SA 240), partner consultation.
- ECB end-use non-compliant material → STOP, FEMA risk, escalate.
- Default >90 days undisclosed → STOP, CARO 2020 qualification risk, escalate.
- Convertible split material error → STOP, propose adjustment.
- Covenant breach material not disclosed → STOP, going concern (SA 570), escalate.
