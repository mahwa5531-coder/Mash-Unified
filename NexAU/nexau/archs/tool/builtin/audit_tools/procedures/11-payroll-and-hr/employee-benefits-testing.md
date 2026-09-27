# Employee Benefits Testing

## Purpose
Verify employee benefits per Ind AS 19 and Ind AS 102. Test defined benefit plans (gratuity, leave encashment, pension), defined contribution (PF, superannuation), actuarial assumptions, G/L remeasurement, ESOP accounting.

## Scope
- USE WHEN: Material gratuity/leave/pension provision; ESOP scheme; actuarial valuation.
- DO NOT WHEN: Only defined contribution (PF) with no DB plan and no ESOP.
- AUDIT AREAS: Gratuity, leave encashment, pension, PF, superannuation, ESOP, OCI remeasurements.

## Audit Objective
- Assertions: Existence, completeness, valuation, accuracy, presentation.
- Framework: Ind AS 19, Ind AS 102, Ind AS 1; SA 540; SA 620.

## Workflow Dependencies
- REQUIRES: Payroll Testing, Journal Entry Testing, Actuarial Mathematics for Employee Benefits.
- FEEDS: Deferred Tax Testing, Reserves and Surplus Testing (OCI), Audit Reporting.

## Required Inputs
- Actuarial valuation report (gratuity, leave encashment, pension) — ASB-format.
- Actuary's qualification/registration; ICAI empanelment.
- Plan rules; trust deed (gratuity trust); LIC policy terms.
- Employee data — age, salary, tenure, eligibility.
- ESOP scheme documents; SEBI SBEB approval (listed); grant/vest/exercise log.

## Optional Inputs
- Prior-year actuarial report; assumption sensitivity analysis.
- Black-Scholes / binomial model workings for ESOP fair value.

## Knowledge
- Ind AS 19.50: DBO = PV of obligation + current service cost + interest cost − benefits paid ± actuarial G/L.
- Ind AS 19.54: Net DB cost = service cost (P&L) + interest net (P&L) + remeasurements (OCI).
- Ind AS 19.82: Remeasurements via OCI; never recycled to P&L.
- Ind AS 19.104: Past service cost recognised immediately (vested) or over vesting period (non-vested).
- Ind AS 102: ESOP expense = fair value at grant date (option pricing model); recognised over vesting period.
- Ind AS 102.58: Cash-settled ESOP remeasured at each reporting date; liability basis.
- SA 540/SA 620: Auditor evaluates management expert; competence, objectivity, methodology.

## Workflow
1. Obtain actuarial valuation report — check actuary's ICAI empanelment and independence.
2. Test plan classification:
   - IF defined contribution (PF/superannuation) → expense = contribution; test remittance.
   - IF defined benefit (gratuity/leave/pension) → proceed to DBO testing.
3. Test employee data — reconcile to HR master; verify age, salary, tenure.
4. Test actuarial assumptions:
   - Discount rate — verify against year-end GoI bond yield of matching duration.
   - Salary escalation (5-10%); mortality (IALM/Indian Assured Lives); attrition vs historical; withdrawal rate.
5. Re-compute DBO components:
   - Current service cost; interest cost (discount rate × opening DBO); benefits paid; past service cost.
6. Test plan assets:
   - Verify fair value at year-end (Ind AS 19.112).
   - IF LIC policy → obtain policy statement; verify surrender value.
   - IF self-administered trust → verify investments; asset-liability matching.
7. Test remeasurements (OCI):
   - Actuarial G/L = actual − expected; expected = (discount rate × opening DBO).
   - Asset return remeasurement = actual − expected (discount rate × opening assets).
   - Remeasurements through OCI, never P&L.
8. Test past service cost — IF plan amendment during year → recognise immediately if vested; over vesting period if not.
9. Test gratuity — 5-year vesting; ceiling ₹20 lakh; IF funded (LIC/trust) → verify plan asset; IF unfunded → entire DBO as liability.
10. Test leave encashment — verify plan terms; IF accumulated leave encashable → DBO including future salary escalation.
11. Test ESOP (Ind AS 102):
    - Verify grant date fair value (Black-Scholes/binomial); vesting conditions (service, performance).
    - Recognise expense over vesting; credit equity (equity-settled) or liability (cash-settled).
    - IF modification → recognise incremental fair value; IF cancellation → accelerate unvested expense.
    - IF listed → SEBI SBEB compliance (SBEB-1/2/3 returns).
12. Evaluate exceptions — factual/projected/anomalous; project per SA 530.

## Decision Points
- D1: Plan is DC or DB? DC → test remittance. DB → test DBO.
- D2: Actuary ICAI-empanelled and independent? YES → use. NO → re-engage.
- D3: Discount rate matches GoI bond yield? YES → proceed. NO → adjust.
- D4: Remeasurements through OCI only? YES → proceed. NO → restate.
- D5: ESOP equity or cash settled? Equity → credit equity. Cash → remeasure liability.
- D6: Past service cost vested? YES → recognise immediately. NO → over vesting period.

## Professional Skepticism Probes
- Is discount rate cherry-picked to lower DBO?
- Is salary escalation understated to reduce obligation?
- Is attrition assumption unrealistic to deflate liability?
- Are plan assets overvalued at year-end?
- Is the actuary genuinely independent of management?
- Is ESOP fair value at grant date, or backdated to lower price?
- Are past service costs being deferred improperly?

## Considerations
- Ind AS 19 prohibited corridor approach for cumulative actuarial G/L.
- DBO discount rate: high-quality GoI bond yield matching duration (10-15 year bonds).
- Compounding: half-yearly convention common in Indian valuations.
- Leave encashment: only accumulated is DB plan.
- Ind AS 102: For listed, SBEB Regulations override on grant terms.
- DTA on allowed deductions (gratuity paid vs provided); verify per Ind AS 12.

## Common Risks
- Discount rate not matching GoI bond yield.
- Salary escalation understated.
- Attrition assumption unrealistic.
- Plan assets overvalued; insufficient ALM.
- Remeasurements mis-routed to P&L.
- ESOP expense not recognised (Ind AS 102).
- Past service cost deferred improperly.

## Fraud Triggers (SA 240)
- Discount rate rounded upward to reduce DBO.
- Salary escalation manipulated to lower liability.
- Plan asset fair value inflated.
- Actuary pressured by management; non-independent.
- ESOP grant date backdated to lower exercise price.
- Remeasurement recycled to P&L to inflate profit.
- Past service cost deferred to smooth P&L impact.

## Common Pitfalls
- Not testing actuary independence (SA 620).
- Accepting discount rate without bond yield reconciliation.
- Skipping plan asset fair value test.
- Missing ESOP modification expense.
- Treating cash-settled ESOP as equity-settled.
- Not testing past service cost treatment.
- Missing Ind AS 19 OCI non-recycling rule.

## Validation
- [ ] Actuarial report obtained; actuary independence verified (SA 620); plan classification DC vs DB tested.
- [ ] Employee data reconciled to HR master; actuarial assumptions benchmarked.
- [ ] DBO components re-computed; plan assets fair value tested.
- [ ] Remeasurements tested via OCI (no recycling); past service cost treatment tested.
- [ ] Gratuity ceiling/vesting and leave encashment terms tested.
- [ ] ESOP fair value and vesting tested (Ind AS 102); SEBI SBEB compliance (listed).
- [ ] Exceptions projected per SA 530.

## Expected Outputs
- Employee benefits testing working paper.
- Actuarial assumption benchmarking memo; DBO re-computation schedule.
- Plan asset test memo; OCI remeasurement test memo.
- ESOP accounting memo (Ind AS 102); DTA on benefits memo (Ind AS 12).
- Exception summary with projection.
- Conclusion on employee benefits per Ind AS 19/102.

## Failure Conditions
- Actuarial report unavailable; actuary not ICAI-empanelled.
- Employee data not reconciled to HR master.
- Plan asset statements unavailable (LIC/trust).

## Escalation Conditions
- Material actuarial assumption deviation (discount/salary/attrition) → STOP, SA 540, re-engage actuary.
- Plan assets materially overvalued → STOP, restate, escalate.
- Remeasurements recycled to P&L materially → STOP, Ind AS 19 breach, restate.
- ESOP grant date backdated materially → STOP, fraud risk (SA 240), partner consultation.
- Actuary not independent of management → STOP, SA 620, re-engage actuary.
- ESOP not recognised per Ind AS 102 materially → STOP, restate, escalate.
