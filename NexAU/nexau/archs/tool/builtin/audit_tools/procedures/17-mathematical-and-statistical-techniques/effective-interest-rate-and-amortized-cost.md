# Effective Interest Rate and Amortized Cost

## Purpose
Verify EIR computation, amortized cost measurement, and modification accounting for financial instruments under Ind AS 109.

## Scope
- USE WHEN: Auditing financial assets/liabilities at amortized cost (loans, deposits, debt securities HTM, borrowings); testing EIR; modification/restructuring.
- DO NOT USE WHEN: FVTPL instruments; equity investments at FVOCI; pure FV measurement without amortized cost component.
- APPLIES TO: Bank loans, NBFC advances, deposits, receivables with significant financing component, debt securities HTM, lease receivables/payables, borrowings.

## Audit Objective
- Assertions: Valuation, Accuracy, Classification, Completeness, Disclosure.
- Framework: Ind AS 109; SA 540; SA 620.

## Workflow Dependencies
- REQUIRES: Financial Instruments Valuation Testing, Borrowings Testing, Materiality Determination.
- FEEDS: Audit Conclusion, Disclosure Review, Impairment (ECL) Testing.

## Required Inputs
- Loan/borrowing agreement: principal, interest rate, maturity, transaction costs, fees.
- Contractual cash flow schedule (dates, amounts).
- Modification terms (if restructured): new principal, rate, maturity.
- GL carrying amount; amortization schedule.

## Optional Inputs
- Valuation expert report; market yield benchmarks; prior-year amortization schedule.

## Knowledge
- Ind AS 109.4.1-4.3: Classification (amortized cost, FVOCI, FVTPL) based on business model and SPPI test.
- Ind AS 109.4.2: Amortized cost = Initial recognition - Principal repayments ± Cumulative amortization - ECL.
- Ind AS 109.B5.3.1-6: EIR = rate that exactly discounts future cash payments through expected life to gross carrying amount.
- Ind AS 109.5.4-5.5: Substantial modification (≥10% PV difference) → derecognize old, recognize new.
- Transaction costs included in initial recognition; amortized over life using EIR.

## Mathematical Foundation
- EIR: solve for r in GCA = Σ [CFt / (1+r)^t]; CFt = cash flow at time t; r = EIR; GCA = gross carrying amount.
- EIR includes: transaction costs, fees, premiums/discounts, origination fees.
- Amortized Cost at t: AC_t = Initial GCA - Principal Repayments + Cumulative Amortization - ECL.
- Cumulative amortization = Σ (EIR × opening AC - contractual interest).
- Interest income = EIR × opening GCA (excluding ECL).
- Modification: PV_new vs PV_old (remaining cash flows) at original EIR.
  - Difference (%) = |PV_new - PV_old| / PV_old.
  - IF Difference ≥ 10% THEN substantial → derecognize old; recognize new at FV; difference to P&L.
  - IF Difference < 10% THEN non-substantial → adjust carrying amount prospectively; amortize using new EIR.
- Premium/discount amortization: EIR method (preferred); straight-line only if immaterial.
- Assumptions: cash flows per contract; EIR constant post-origination; transaction costs identifiable.
- Violation: variable rate (use current EIR each period); credit-impaired (use credit-adjusted EIR); modifications below 10% but material cumulative.

## Workflow
1. Obtain loan/borrowing agreement; reconcile to GL carrying amount.
2. Identify initial carrying amount: principal + transaction costs (assets) or principal - transaction costs (liabilities).
3. Extract contractual cash flow schedule: dates, interest, principal, fees.
4. Compute EIR by solving for r: GCA = Σ [CFt / (1+r)^t]; use iterative numerical method; document convergence.
5. Verify EIR matches management's; investigate differences.
6. Test amortized cost for sample periods: AC_t = AC_{t-1} + (EIR × AC_{t-1}) - contractual interest - principal repaid; reconcile to GL.
7. Test transaction costs: included in initial recognition; amortized via EIR (not straight-line).
8. Test interest income: Interest = EIR × opening GCA; reconcile to P&L.
9. IF modification occurred:
   - Compute PV_old at original EIR using remaining cash flows before modification.
   - Compute PV_new at original EIR using modified cash flows.
   - Difference = |PV_new - PV_old| / PV_old.
   - IF Difference ≥ 10% THEN derecognize old; recognize new; gain/loss to P&L.
   - IF Difference < 10% THEN adjust carrying amount; amortize prospectively.
10. Test ECL interaction (Ind AS 109.5.5): interest income on credit-impaired assets uses credit-adjusted EIR or net carrying amount.
11. Test disclosures: EIR, amortized cost movement schedule, modification (if material).
12. Document computations, reconciliations, conclusions; assess disclosure adequacy.

## Decision Points
- D1: SPPI test passed and held-to-collect business model? YES → amortized cost. NO → FVOCI or FVTPL.
- D2: Transaction costs present? YES → include in initial GCA; amortize via EIR. NO → EIR = contractual rate.
- D3: Modification occurred? YES → compute PV difference; apply 10% threshold. NO → standard amortization.
- D4: PV difference ≥ 10%? YES → derecognize old; recognize new at FV; gain/loss to P&L. NO → adjust prospectively.
- D5: Asset credit-impaired? YES → interest income on net carrying amount (not GCA). NO → interest income on GCA.

## Professional Skepticism Probes
- Are transaction costs correctly identified (legal fees, origination fees)?
- Has management used straight-line instead of EIR for material amounts?
- Is the 10% modification threshold applied with PV at original EIR?
- Has modification been structured to avoid 10% threshold (cumulative modifications)?

## Considerations
- EIR held constant; revise only on modification or write-off.
- Floating rate: EIR updates at each repricing date.
- Transaction costs: legal fees, origination fees, points; NOT commitment fees.
- Premium/discount: EIR method (not straight-line) unless immaterial.
- Indian context: RBI guidelines for banks/NBFCs; Ind AS 109 mandatory for listed.

## Common Risks
- Excluding transaction costs from initial GCA (EIR misstated).
- Using contractual rate instead of EIR for interest income.
- Applying straight-line instead of EIR for material amounts.
- Not updating EIR for floating rate at repricing.

## Fraud Triggers (SA 240)
- Modification structured to fall just below 10% threshold.
- Transaction costs excluded to inflate EIR (interest income).
- Modification terms favoring related party; non-arm's length.
- EIR recalculated mid-life without modification trigger.

## Common Pitfalls
- Treating commitment fees as transaction costs (they are not).
- Applying 10% threshold to nominal cash flows (should be PV).
- Using straight-line for material premium/discount.
- Interest income on GCA when asset is credit-impaired (should be net).

## Validation
- [ ] Initial GCA reconciled to agreement (principal ± transaction costs).
- [ ] Contractual cash flow schedule verified.
- [ ] EIR computed by solving for r in PV equation; reconciled to management.
- [ ] Amortized cost tested for sample periods; reconciled to GL.
- [ ] Modification (if any): PV difference at original EIR; threshold applied.
- [ ] Interest income: EIR × opening GCA reconciled to P&L.

## Expected Outputs
- EIR computation: equation, solution, reconciliation to management.
- Amortized cost schedule: opening, interest, principal, closing; reconciliation to GL.
- Modification analysis (if applicable): PV_old, PV_new, % difference, treatment.
- Interest income reconciliation to P&L.
- Disclosure adequacy assessment (EIR, movement schedule, modifications).

## Failure Conditions
- Loan/borrowing agreement cannot be obtained.
- Cash flow schedule incomplete or non-verifiable.
- Transaction costs cannot be identified.
- EIR cannot be computed reliably (complex instruments).

## Escalation Conditions
- Material difference between auditor-computed EIR and management's EIR → STOP, partner consultation.
- Modification crosses 10% but management treats as non-substantial → STOP, require derecognition.
- Transaction costs excluded from initial GCA materially → STOP, require correction.
- Complex instrument where EIR unreliable → STOP, engage auditor's expert.
