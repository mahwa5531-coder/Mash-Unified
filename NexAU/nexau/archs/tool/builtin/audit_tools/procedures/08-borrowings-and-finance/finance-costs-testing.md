# Finance Costs Testing

## Purpose
Verify interest cost recognition and borrowing cost capitalization per Ind AS 23 (commencement, suspension, cessation). Test EIR, amortised cost, transaction costs, modification.

## Scope
- USE WHEN: Material borrowings; capitalization of borrowing cost on QAP; modification of loans.
- DO NOT WHEN: Finance costs immaterial; no QAP.
- AUDIT AREAS: Interest on term loans, CC/OD, debentures, ECB; borrowing cost capitalization; lease interest; modification gains/losses.

## Audit Objective
- Assertions: Accuracy, completeness, valuation, cut-off, presentation.
- Framework: Ind AS 23, Ind AS 109, Ind AS 116, Companies Act Sec 208, CARO 2020.

## Workflow Dependencies
- REQUIRES: Borrowings Testing, Fixed Assets Additions Testing, CWIP Testing, Trial Balance.
- FEEDS: Audit Reporting, Deferred Tax Testing, Going Concern Assessment.

## Required Inputs
- Finance cost schedule (interest, commitment fees, EIR amortisation).
- Loan statements; EIR computation workings.
- Borrowing cost capitalization workings (qualifying assets).
- Lease liability schedule (Ind AS 116).
- Loan modification documentation.

## Optional Inputs
- Prior-year finance cost schedule; covenant compliance certificates.

## Knowledge
- Ind AS 23.8: Capitalize borrowing cost on QAP — commencement (expenditure + borrowing + activities begin), suspension (substantial delay), cessation (substantially complete).
- Ind AS 109: Effective interest method — EIR includes transaction costs, premiums, discounts.
- Ind AS 109.3.3: Loan modification — if 10% test exceeded, extinguish old + recognise new (difference to P&L).
- Ind AS 116: Lease interest — separate from principal; finance lease interest to P&L.
- Companies Act Sec 208: Interest on calls; disclosure requirements.
- CARO 2020 Cl 11(xii): Default in interest repayment disclosed.
- Ind AS 1.82: Finance cost presented separately in P&L.

## Workflow
1. Obtain finance cost schedule — tie to GL, P&L, FS notes.
2. Verify classification:
   - Interest expense, commitment fees, EIR amortisation, lease interest, modification gain/loss.
3. Test interest on term loans:
   - Verify rate, period, computation; re-compute on sample.
   - Tie to loan statements.
4. Test CC/OD interest:
   - Verify daily drawing × rate; re-compute for sample period.
5. Test debenture interest:
   - Verify coupon rate; payment schedule; accrued at year-end.
6. Test ECB interest:
   - Verify all-in-cost ceiling; convert at average/year-end rate per FEMA.
7. Test EIR (effective interest method):
   - Verify EIR includes transaction costs, fees, premiums/discounts.
   - Re-compute amortised cost schedule; verify interest expense pattern.
8. Test borrowing cost capitalization (Ind AS 23):
   - Identify qualifying assets (QAP).
   - Verify commencement (expenditure + borrowing + activities).
   - Verify suspension during substantial delays.
   - Verify cessation at substantial completion.
   - IF capitalized beyond cessation → exception, re-class to expense.
9. Test specific vs general borrowings:
   - Specific: actual borrowing cost less income on temporary investment.
   - General: weighted average capitalization rate × cumulative expenditure.
10. Test lease interest (Ind AS 116):
    - Verify lease liability unwound using IRR; interest to P&L.
11. Test loan modification (Ind AS 109.3.3):
    - Compute PV of revised cash flows vs carrying amount (10% test).
    - IF >10% difference → extinguish old + recognise new; P&L gain/loss.
    - IF <10% → adjust EIR prospectively.
12. Test cut-off:
    - Accrued interest at year-end; interest paid next year.
13. Test CARO 2020 default in interest.
14. Evaluate exceptions — factual/projected/anomalous; project per SA 530.

## Decision Points
- D1: Borrowing cost on QAP? YES → capitalize per Ind AS 23. NO → expense.
- D2: Capitalization ceased at substantial completion? YES → proceed. NO → exception.
- D3: Substantial delay during QAP? YES → suspend capitalization. NO → proceed.
- D4: Modification 10% test exceeded? YES → extinguish + recognise. NO → adjust EIR.
- D5: EIR computed correctly? YES → proceed. NO → re-compute.
- D6: Default in interest repayment? YES → CARO 2020 disclosure. NO → proceed.

## Professional Skepticism Probes
- Is borrowing cost capitalization genuinely on QAP, or routine interest capitalised?
- Is cessation date correct, or extended to inflate assets?
- Is suspension applied during delays, or ignored?
- Is EIR genuinely computed with all fees, or simplified?
- Is modification treatment based on substance, or cosmetic?
- Is accrued interest recognised correctly at year-end?

## Considerations
- Capitalization rate: weighted average for general borrowings.
- Temporary investment income: netted against specific borrowing cost.
- Multi-currency: convert interest at average/year-end rate per FEMA.
- Lease modifications: separate treatment under Ind AS 116.

## Common Risks
- Borrowing cost capitalized beyond cessation.
- Suspension not applied during delays.
- EIR not computed; transaction costs expensed.
- Modification not tested (10% test).
- Accrued interest not recognised.
- Default in interest not disclosed (CARO 2020).

## Fraud Triggers (SA 240)
- Capitalization continued after completion to reduce P&L expense.
- Suspension ignored during project delays.
- EIR understated to reduce interest expense.
- Modification treated as extinguishment to defer gain/loss.
- Manual JEs adjusting finance cost with vague narration.
- Accrued interest reversed at year-end.
- Capitalization on non-qualifying assets.

## Common Pitfalls
- Not testing cessation date independently.
- Skipping suspension test.
- Accepting EIR without re-computation.
- Missing 10% modification test.
- Not testing lease interest separately.

## Validation
- [ ] Finance cost schedule tied to GL, P&L, FS.
- [ ] Classification verified.
- [ ] Term loan interest tested.
- [ ] CC/OD interest tested.
- [ ] Debenture interest tested.
- [ ] ECB interest tested (FEMA).
- [ ] EIR re-computed.
- [ ] Borrowing cost capitalization tested.
- [ ] Commencement/suspension/cessation verified.
- [ ] Specific vs general borrowings tested.
- [ ] Lease interest tested (Ind AS 116).
- [ ] Modification (10% test) assessed.
- [ ] Cut-off tested.
- [ ] CARO 2020 default verified.
- [ ] Exceptions projected per SA 530.

## Expected Outputs
- Finance costs testing workpaper.
- EIR re-computation schedule.
- Borrowing cost capitalization memo (Ind AS 23).
- Specific vs general borrowing computation.
- Lease interest memo (Ind AS 116).
- Modification test memo (10% test).
- Cut-off test schedule.
- CARO 2020 default disclosure memo.
- Exception summary with projection.

## Failure Conditions
- Loan statements unavailable; EIR workings missing.
- Borrowing cost capitalization workings not provided.
- Modification documentation missing.

## Escalation Conditions
- Capitalization beyond cessation material → STOP, propose adjustment, partner consultation.
- Suspension ignored during material delay → STOP, propose adjustment.
- Modification misclassified materially → STOP, propose adjustment.
- Default in interest material not disclosed → STOP, CARO 2020 qualification risk, escalate.
