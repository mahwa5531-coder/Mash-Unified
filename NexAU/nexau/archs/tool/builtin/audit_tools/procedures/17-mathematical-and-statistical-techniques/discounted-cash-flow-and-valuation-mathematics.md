# Discounted Cash Flow and Valuation Mathematics

## Purpose
Apply DCF and valuation mathematics to audit impairment (Ind AS 36), business combinations (Ind AS 103), and fair value (Ind AS 113) — verify models, assumptions, and outputs.

## Scope
- USE WHEN: Auditing impairment of CGUs/goodwill, business combination PPA, FV of investments/intangibles; testing valuation expert inputs.
- DO NOT USE WHEN: Cost model with no impairment indicators; transaction at straightforward historical cost; pure comparables-based valuation without DCF.
- APPLIES TO: Goodwill/CGU impairment, intangible valuation, investment FV, lease valuation, business combination PPA.

## Audit Objective
- Assertions: Valuation, Allocation, Accuracy, Disclosure.
- Framework: Ind AS 36; Ind AS 103; Ind AS 113; SA 540; SA 620.

## Workflow Dependencies
- REQUIRES: Accounting Estimates Testing, FV Measurement Mathematics, Materiality Determination.
- FEEDS: Impairment Conclusion, PPA Conclusion, FV Disclosure, Audit Reporting.

## Required Inputs
- Management DCF model (cash flows, discount rate, terminal growth).
- CGU definition and carrying amount (Ind AS 36).
- Business combination agreement, purchase price, identifiable assets/liabilities.
- Valuation expert report (if used); industry growth forecasts.

## Optional Inputs
- Comparable transactions; peer multiples; macroeconomic forecasts; regulator data.

## Knowledge
- Ind AS 36.18-57: Recoverable = max(VIU, FVLCD); impairment = Carrying - Recoverable.
- Ind AS 36.33-57: VIU uses reasonable, supportable cash flow projections (max 5 years unless justified).
- Ind AS 103.18-40: Identify identifiable assets/liabilities at FV; goodwill = consideration - net identifiable FV.
- Ind AS 113: FV hierarchy; Level 3 unobservable inputs require sensitivity.
- SA 540/SA 620: Test estimates; assess assumptions; assess expert.

## Mathematical Foundation
- PV = CFn / (1+r)^n; CFn = cash flow year n; r = discount rate.
- NPV = Σ [CFt / (1+r)^t] - Initial Investment; t = 1 to N.
- FCFF = EBIT × (1 - T) + D&A - Capex - ΔWC; EBIT = earnings before interest/tax; T = tax rate; D&A = depreciation; Capex = capital expenditure; ΔWC = change in working capital.
- FCFE = FCFF - Interest × (1 - T) + Net Borrowings.
- Terminal Value (Gordon): TV = CF_{n+1} / (r - g); g = terminal growth.
- WACC = (E/V) × Re + (D/V) × Rd × (1 - Tc); E = equity mkt value; D = debt mkt value; V = E + D; Re = cost of equity; Rd = cost of debt; Tc = tax rate.
- CAPM: Re = Rf + β × (Rm - Rf); Rf = risk-free rate (India 10-yr G-Sec); β = equity beta; (Rm - Rf) = equity risk premium.
- Hamada unlevered beta: βu = βl / [1 + (1 - Tc) × (D/E)]; βl = levered beta; D/E = debt-to-equity.
- Recoverable = max(VIU, FVLCD); Impairment = Carrying - Recoverable.
- Sensitivity: vary discount rate ±1%, terminal growth ±0.5%; assess impairment trigger.
- Assumptions: cash flows reasonable/supportable; discount rate reflects time value + risk; terminal growth ≤ long-term industry/market growth.
- Violation: discount rate ≠ WACC for CGU; terminal growth > long-term GDP; synergies in VIU (not permitted).

## Workflow
1. Identify asset/CGU/investment requiring valuation; obtain management DCF model.
2. Reconcile carrying amount to GL; understand basis (cost/revaluation/FV).
3. Verify CGU definition (Ind AS 36); goodwill allocation to CGUs.
4. Test cash flow projections:
   - IF explicit forecast > 5 years THEN obtain justification for longer period.
   - Compare to most recent budgets/forecasts approved by management.
   - Test reasonableness of revenue growth, margins, capex, working capital assumptions.
5. Test discount rate (WACC): verify Rf (India G-Sec at measurement date); β (Bloomberg/NSE); unlever/relever per Hamada if needed; ERP (India 6-8%); cost of debt (post-tax); capital structure (market values where possible).
6. Test terminal value: g ≤ long-term industry/GDP growth (typically 2-5% India); reconcile terminal CF to explicit forecast final year adjusted for growth.
7. Compute NPV = Σ [CFt / (1+r)^t] + TV / (1+r)^n; verify against management.
8. Compute Recoverable = max(VIU, FVLCD); compare to carrying.
   - IF Recoverable < Carrying THEN impairment loss; test disclosure.
9. Perform sensitivity: vary discount rate ±1%, terminal growth ±0.5%, revenue ±5%; identify impairment trigger scenarios.
10. Assess hindsight bias (SA 540): compare prior-year assumptions to actuals.
11. IF management expert used THEN assess competence, objectivity, methodology (SA 620); consider auditor's expert if high risk.
12. Document model, assumptions, sensitivities, conclusion; assess disclosure (Ind AS 36/103/113).

## Decision Points
- D1: Cash flow period > 5 years? YES → obtain justification. NO → standard VIU.
- D2: Discount rate ≠ WACC for CGU? YES → challenge; require correction. NO → proceed.
- D3: Terminal growth > long-term GDP? YES → reduce; challenge. NO → proceed.
- D4: Recoverable < Carrying? YES → impairment; recognize loss. NO → no impairment.
- D5: Sensitivity triggers impairment in reasonable variation? YES → high estimation uncertainty; extensive disclosure. NO → standard.

## Professional Skepticism Probes
- Do cash flow projections match approved budgets, or are they inflated for valuation?
- Is discount rate consistent with prior year and peer practice?
- Has management changed methodology or assumptions from prior year without justification?
- Are sensitivity scenarios reasonable, or do they avoid impairment trigger?

## Considerations
- Use post-tax cash flows with post-tax discount rate (or pre-tax with pre-tax); be consistent.
- FVLCD requires disposal costs; VIU does not.
- Goodwill impairment: CGU carrying (incl. goodwill) vs recoverable; cannot go below zero.
- Indian context: G-Sec yield, India ERP, sector risk premiums.

## Common Risks
- Discount rate not matching cash flow currency/risk profile.
- Terminal growth exceeding long-term industry growth.
- Inflated cash flow projections avoiding impairment.
- Sensitivity analysis avoiding impairment triggers.

## Fraud Triggers (SA 240)
- Cash flow projections materially above approved budgets without justification.
- Discount rate lowered at year-end to avoid impairment.
- Goodwill allocation across CGUs changed to mask impairment.
- Pre-impairment assumptions divergent from post-impairment actuals.

## Common Pitfalls
- Using nominal cash flows with real discount rate (or vice versa).
- Including future restructuring/synergies in VIU (not permitted).
- Not performing sensitivity on key assumptions.
- Not reconciling WACC components to market data.

## Validation
- [ ] Cash flow projections reconciled to approved budgets; assumptions tested.
- [ ] WACC components (Rf, β, ERP, Rd, capital structure) verified to market data.
- [ ] Terminal growth ≤ long-term industry/GDP growth.
- [ ] NPV computed; reconciled to management.
- [ ] Sensitivity on discount rate, terminal growth, revenue.
- [ ] Recoverable vs carrying compared; impairment recognized and disclosed.

## Expected Outputs
- DCF model with cash flows, WACC, terminal value, NPV.
- Sensitivity analysis table.
- Comparison: Recoverable vs Carrying; impairment conclusion.
- Expert report review (if applicable).
- Disclosure adequacy assessment (Ind AS 36/103/113).

## Failure Conditions
- Management DCF model cannot be obtained or is incomplete.
- Cash flow projections not supported by budgets.
- Discount rate components cannot be verified.
- Valuation expert methodology not assessable.

## Escalation Conditions
- Recoverable < Carrying but management refuses to recognize → STOP, partner consultation; possible qualification.
- Key assumptions (terminal growth, WACC) outside reasonable range → STOP, require correction.
- Valuation expert methodology flawed → STOP, engage auditor's expert.
- Sensitivity triggers impairment in reasonable scenarios → STOP, high estimation uncertainty disclosure; partner consultation.
