# Deferred Tax Testing

## Purpose
Verify deferred tax per Ind AS 12. Test temporary differences, DTA on losses/MAT credit, DTL on revaluation/undistributed profits, tax rate changes, current vs non-current classification (Ind AS 1).

## Scope
- USE WHEN: Material temporary differences; DTA/DTL balance; carried-forward losses; MAT credit; revaluation; rate changes.
- DO NOT WHEN: No temporary differences; DTA/DTL immaterial.
- AUDIT AREAS: DTA, DTL, MAT credit, DTL on revaluation, DTL on undistributed profits, current/non-current split.

## Audit Objective
- Assertions: Existence, completeness, valuation, accuracy, presentation.
- Framework: Ind AS 12; Ind AS 1; Ind AS 8 (rate changes); Ind AS 10 (subsequent events); Income Tax Act.

## Workflow Dependencies
- REQUIRES: Income Tax Testing, Fixed Assets Testing, Employee Benefits Testing, Financial Instruments Valuation.
- FEEDS: Audit Reporting, Reserves and Surplus Testing.

## Required Inputs
- Deferred tax schedule — item-wise temporary differences, DTA/DTL, rate applied.
- Fixed asset register with tax vs accounting WDV; depreciation as per Sec 32.
- Loss carry-forward schedule (Sec 72/72A/79/80); MAT credit entitlement (Sec 115JB).
- Revaluation workings; goodwill; provision/gratuity workings; ESOP expense.

## Optional Inputs
- Prior-year DT schedule; tax planning strategy; future profitability projections (for DTA on losses).

## Knowledge
- Ind AS 12.15: DTL on taxable differences; DTA on deductible to extent probable taxable profit.
- Ind AS 12.34: DTA on unused tax losses only if probable future taxable profit.
- Ind AS 12.41: DTA/DTL measured at enacted/substantively enacted rate.
- Ind AS 12.52: DTL on undistributed profits only if tax payable on distribution (DDT abolished FY 2020-21).
- Ind AS 12.39: DTL on revaluation surplus (taxable on depreciation recoupment).
- Ind AS 12.51A: MAT credit DTA only with virtual certainty of recovery.
- Ind AS 1.78: DTA/DTL classified current/non-current based on underlying asset/liability.

## Workflow
1. Obtain DT schedule — tie DTA/DTL balances to GL and FS notes.
2. Identify all temporary differences:
   - Taxable: accelerated depreciation (tax WDV < book), unrealised gains, capitalised R&D expensed for tax.
   - Deductible: provisions (gratuity/leave/warranty), unrealised losses, deferred revenue, carry-forward losses.
3. Test DTL on accelerated depreciation:
   - Compute tax WDV (Sec 32) vs book WDV (Ind AS 16); apply enacted rate.
   - IF Sec 115BAA opted → 22%; no MAT.
4. Test DTA on carried-forward losses:
   - IF business loss (Sec 72) → 8 years; unabsorbed depreciation (Sec 32(2)) → indefinite.
   - IF Sec 79 (closely-held) → carry-forward only if shareholding continuity ≥51%.
   - Recognise DTA only if probable future taxable profit (Ind AS 12.34).
5. Test DTA on MAT credit (Sec 115JB):
   - Recognise only with virtual certainty of recovery within 15 AYs.
   - IF recurring losses → no DTA on MAT credit.
6. Test DTL on revaluation surplus:
   - IF upward revaluation (Ind AS 16) → DTL on book vs tax base; credit to OCI.
7. Test DTL on undistributed profits:
   - IF DDT abolished FY 2020-21 → no DTL for domestic companies.
   - IF foreign subsidiary → assess tax on distribution in respective jurisdiction.
8. Test DTA on Sec 43B items and ESOP:
   - IF PF/ESI/bonus/gratuity unpaid at year-end → deductible difference; DTA if probable future profit.
   - IF ESOP expense recognised but deduction on exercise (Sec 17(2)(vi)) → DTA on deductible difference.
9. Test tax rate changes (Ind AS 8/12):
   - IF rate enacted/substantively enacted during year → re-measure DTA/DTL; impact in P&L or OCI.
10. Test current/non-current classification (Ind AS 1):
    - IF underlying asset/liability is current → DT current; else non-current.
11. Evaluate exceptions — factual/projected/anomalous; project per SA 530.

## Decision Points
- D1: Probable future taxable profit for DTA on losses? YES → recognise. NO → do not recognise.
- D2: Virtual certainty for MAT credit DTA (Ind AS 12.51A)? YES → recognise. NO → do not.
- D3: Tax rate substantively enacted at year-end? YES → apply. NO → defer.
- D4: DDT abolished (FY 2020-21)? YES → no DTL on undistributed profits (domestic). NO → assess.
- D5: Revaluation gain taxed on realisation only? YES → no DTL until realisation. NO → DTL on book-tax difference.
- D6: Underlying asset/liability current or non-current? Current → DT current. Non-current → DT non-current.

## Professional Skepticism Probes
- Are future profit projections for DTA realistic, or optimistically inflated?
- Is MAT credit recognisable, or recurring losses likely?
- Is tax rate applied at enacted/substantively enacted rate?
- Is DTL on revaluation computed correctly, or understated?
- Are Sec 43B/ESOP DTA genuinely recoverable?
- Are temporary differences complete, or items missed?

## Considerations
- Ind AS 12.31: DTA/DTL not recognised on initial recognition of goodwill (non-tax-deductible).
- Ind AS 12.15(b): DTA not recognised on initial recognition not affecting P&L (acquisition fair-value exception).
- Substantively enacted rate: Finance Act passed (typically 1 April for FY).
- Ind AS 12.80: Recognise current/deferred tax in P&L unless from business combination/OCI/equity.
- Sec 115BAA: 22% (no incentive, no MAT); Sec 115BAB: 15% (new manufacturing).
- Discounting prohibited for DTA/DTL.

## Common Risks
- DTA on losses without probable future profit.
- MAT credit DTA without virtual certainty.
- Tax rate not updated for enacted changes.
- DTL on revaluation understated.
- Sec 43B / ESOP DTA not assessed for recoverability.
- Current/non-current misclassification (Ind AS 1).

## Fraud Triggers (SA 240)
- Future profit projections aggressively inflated to recognise DTA.
- MAT credit DTA recognised despite recurring losses.
- Tax rate manipulated to understate DTL.
- Temporary differences incomplete (e.g., R&D, ESOP omitted).
- DTL on revaluation reversed via manual JE.
- Sec 43B DTA recognised despite likely disallowance.
- DTA on related-party transaction without future profit substance.

## Common Pitfalls
- Not testing future profit projections (SA 540 / SA 620).
- Recognising MAT credit DTA without virtual certainty.
- Applying stale tax rate (not enacted).
- Missing DTL on revaluation surplus.
- Missing DTA on Sec 43B / ESOP (Sec 17(2)(vi)).
- Classifying DT based on expected recovery, not underlying asset/liability.

## Validation
- [ ] DT schedule tied to GL and FS; all temporary differences identified.
- [ ] DTL on accelerated depreciation tested (Sec 32 vs Ind AS 16).
- [ ] DTA on losses — probable future profit tested.
- [ ] DTA on MAT credit — virtual certainty tested.
- [ ] DTL on revaluation surplus and undistributed profits tested.
- [ ] DTA on Sec 43B items and ESOP tested.
- [ ] Tax rate enacted/substantively enacted; rate change re-measured (Ind AS 8/12).
- [ ] Current/non-current classification tested (Ind AS 1).
- [ ] Exceptions projected per SA 530.

## Expected Outputs
- Deferred tax testing working paper.
- Temporary differences schedule (taxable/deductible).
- DTA on losses — future profit projection memo (SA 540).
- MAT credit DTA memo (virtual certainty).
- DTL on revaluation memo; rate change re-measurement memo.
- Current/non-current classification memo (Ind AS 1).
- Exception summary with projection.
- Conclusion on deferred tax per Ind AS 12.

## Failure Conditions
- DT schedule / tax computation unavailable.
- Future profit projections for DTA not supported.
- Tax rate enactment status unclear.

## Escalation Conditions
- DTA on losses without probable future profit → STOP, Ind AS 12 breach, partner consultation.
- MAT credit DTA without virtual certainty → STOP, restate, escalate.
- Tax rate not updated for enacted changes materially → STOP, restate, escalate.
- DTL on revaluation materially understated / temporary differences incomplete → STOP, escalate.
- DT current/non-current materially misclassified → STOP, restate, escalate.
