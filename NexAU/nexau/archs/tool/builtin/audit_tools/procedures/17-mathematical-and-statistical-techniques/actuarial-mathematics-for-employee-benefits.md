# Actuarial Mathematics for Employee Benefits

## Purpose
Apply actuarial mathematics to audit defined benefit obligations (DBO), service/interest cost, and actuarial gains/losses under Ind AS 19 and Ind AS 102.

## Scope
- USE WHEN: Auditing gratuity, pension, post-retirement medical, defined benefit plans; SBBS under Ind AS 102; ESOP valuation.
- DO NOT USE WHEN: Defined contribution plans (PF); short-term compensated absences within 12 months.
- APPLIES TO: Gratuity, pensions, post-retirement benefits, long-term compensated absences, SBBS, ESOPs.

## Audit Objective
- Assertions: Valuation, Accuracy, Completeness, Disclosure.
- Framework: Ind AS 19; Ind AS 102; SA 540; SA 620.

## Workflow Dependencies
- REQUIRES: Employee Benefits Testing, Accounting Estimates Testing, Materiality Determination.
- FEEDS: Audit Conclusion, Disclosure Review, Going Concern (if material DBO).

## Required Inputs
- Actuarial valuation report (management's actuary); employee data (age, salary, service).
- Plan terms: benefit formula, vesting, eligibility from trust deed/policy.
- Discount rate; salary escalation rate; mortality table; attrition assumption.
- DBO reconciliation: opening, movements, closing.

## Optional Inputs
- Auditor's actuary (SA 620); industry benchmarks; prior-year actuarial report.

## Knowledge
- Ind AS 19.50-66: DBO, current service cost, interest cost, remeasurements to OCI.
- Ind AS 19.82-90: Service cost and interest cost to P&L; remeasurements to OCI (not recycled).
- Ind AS 102: Equity-settled SBBS at FV grant date; cash-settled re-measured each reporting date.
- SA 540: Test assumptions; consider hindsight bias.
- SA 620: Assess competence, objectivity, methodology of expert.

## Mathematical Foundation
- Method: Projected Unit Credit (PUC); DBO = PV of expected future benefits for service to date.
- Annual Benefit per employee = (Salary at exit × Service_to_date / Total_service) × Benefit_factor.
- PV = Annual Benefit × PV factor (annuity or lump sum per plan).
- Current Service Cost (CSC) = actuarial PV of benefits earned in current year.
- Interest Cost (IC) = DBO_opening × Discount Rate.
- DBO reconciliation: DBO_closing = DBO_opening + CSC + IC + Benefits Paid + Remeasurements + Plan Amendments.
- Actuarial Gains/Losses (remeasurements) → OCI; not recycled.
- Demographic assumptions: Mortality = IALM 2012-14 (or current); Attrition = entity/industry.
- Financial assumptions: Discount rate = govt bond yields matching benefit duration (India 7-8%); Salary escalation = 5-8%.
- Black-Scholes-Merton (SBBS equity-settled): C = S×N(d1) - K×e^(-rT)×N(d2); d1 = [ln(S/K)+(r+σ²/2)T]/(σ√T); d2 = d1 - σ√T. S=share price; K=exercise price; r=risk-free; T=time to exercise; σ=volatility; N=cumulative normal.
- Binomial lattice for SBBS with vesting/market conditions.
- Assumptions: stable workforce; discount rate matches benefit duration; mortality table current; consistent across plans.
- Violation: discount rate too high (low DBO); salary escalation too low (low DBO); outdated mortality table.

## Workflow
1. Obtain actuarial report; verify scope, date, and methodology (PUC).
2. Verify employee data completeness: headcount to payroll; salary to HR.
3. Verify plan terms from trust deed/policy: benefit formula, vesting, eligibility.
4. Test actuarial assumptions:
   - Discount rate: reconcile to govt bond yields (India 7-8%) for benefit duration.
   - Salary escalation: 5-8% India; consistent with prior year and industry.
   - Mortality table: IALM 2012-14 or current; verify not outdated.
   - Attrition: entity-specific or industry; reasonable.
5. Test PUC methodology: benefit allocation to service periods; DBO = PV of future payments for service to date.
6. Test DBO reconciliation: opening + CSC + IC + Benefits + Remeasurements + Amendments = closing; reconcile to GL.
7. Verify recognition: CSC and IC to P&L; Remeasurements to OCI (not P&L).
8. Test assumption changes from prior year:
   - IF discount rate differs > 50 bps THEN document market rationale.
   - IF salary escalation differs THEN document HR/operational rationale.
9. Assess hindsight bias (SA 540): compare prior-year assumptions to actual experience.
10. For SBBS under Ind AS 102:
    - Equity-settled: verify grant date FV via BSM/binomial; expense over vesting period.
    - Cash-settled: re-measure at each reporting date.
    - Test inputs: S, K, r (G-Sec), T, σ (historical volatility).
11. IF complex or material THEN engage auditor's actuary (SA 620); assess methodology.
12. Document assumptions, methodology, reconciliation, conclusion; assess disclosure adequacy.

## Decision Points
- D1: Plan is defined benefit? YES → actuarial valuation required. NO → defined contribution; no DBO.
- D2: Discount rate within reasonable range (7-8% India)? YES → proceed. NO → challenge.
- D3: Salary escalation consistent with prior year and industry? YES → proceed. NO → document rationale.
- D4: Significant remeasurement in OCI? YES → test assumption changes; assess disclosure. NO → standard.
- D5: SBBS equity or cash-settled? Equity → grant date FV. Cash → remeasure each period.
- D6: Material/complex valuation? YES → engage auditor's actuary (SA 620). NO → use management's actuary.

## Professional Skepticism Probes
- Has management changed assumptions without market/operational basis?
- Is discount rate selected to minimize DBO (high rate → low DBO)?
- Are remeasurements consistently favorable (assumption manipulation)?
- Has prior-year actual experience differed materially from assumptions?

## Considerations
- Use spot yield curve (not single rate) for long-duration benefits.
- Mortality table should be current; outdated tables understate DBO.
- Plan amendments: past service cost at earlier of amendment date or related restructuring date.
- Indian context: Gratuity Act 1972 (₹20 lakh tax-free ceiling).

## Common Risks
- Discount rate too high (understated DBO).
- Salary escalation too low (understated DBO).
- Outdated mortality table (understated DBO).
- Remeasurements misclassified as service cost (P&L instead of OCI).

## Fraud Triggers (SA 240)
- Discount rate increased significantly without market evidence.
- Salary escalation reduced to lower DBO.
- Remeasurements consistently favorable across years.
- Employee data manipulation (excluding high-tenure employees).

## Common Pitfalls
- Using single discount rate instead of yield curve for long-duration benefits.
- Recognizing remeasurements in P&L instead of OCI.
- Not updating mortality table (IALM 2012-14 → current).
- Misclassifying equity-settled as cash-settled SBBS (or vice versa).

## Validation
- [ ] Employee data reconciled to payroll/HR records.
- [ ] Plan terms verified from trust deed/policy.
- [ ] Discount rate reconciled to govt bond yields.
- [ ] Salary escalation consistent with industry and prior year.
- [ ] Mortality table current (IALM 2012-14 or latest).
- [ ] DBO reconciliation reconciled to GL; CSC/IC to P&L; Remeasurements to OCI.

## Expected Outputs
- Actuarial assumption table: discount rate, salary escalation, mortality, attrition.
- DBO reconciliation: opening, CSC, IC, benefits paid, remeasurements, closing.
- P&L: CSC, IC; OCI: Remeasurements; verified to GL.
- SBBS valuation (if applicable): grant date FV, inputs (S, K, r, T, σ).
- Disclosure adequacy assessment (Ind AS 19/102).

## Failure Conditions
- Actuarial report cannot be obtained or is incomplete.
- Employee data not reconciled to payroll/HR.
- Plan terms not documented (no trust deed/policy).
- Assumptions cannot be tested (no market data).

## Escalation Conditions
- Material/complex valuation; management's actuary methodology questionable → STOP, engage auditor's actuary (SA 620).
- Discount rate significantly above market → STOP, require revision.
- SBBS valuation inputs unreliable → STOP, partner consultation.
- Remeasurements indicate assumption manipulation → STOP, partner consultation.
