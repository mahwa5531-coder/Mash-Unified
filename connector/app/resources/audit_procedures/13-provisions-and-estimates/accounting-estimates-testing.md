# Accounting Estimates Testing

## Purpose
Test reasonableness of accounting estimates and disclosures per SA 540 and applicable Ind AS.

## Scope
- USE WHEN: Impairment (Ind AS 36), intangibles useful life (Ind AS 38), NRV, fair value, ECL (Ind AS 109), provisions.
- DO NOT USE WHEN: Pure historical cost transactions; factual errors (use SA 450).
- AUDIT AREAS: Impairment, useful life, fair value, ECL, restructuring, onerous contracts.

## Audit Objective
- Assertions: Valuation, accuracy, completeness, presentation/disclosure.
- Framework: SA 540; SA 620; Ind AS 36, 38, 109, 37, 113; SA 500.

## Workflow Dependencies
- REQUIRES: Fixed Assets Testing, Receivables Testing, Revenue Testing, JE Testing.
- FEEDS: Audit Conclusion, Audit Reporting, Going Concern Assessment.

## Required Inputs
- Management estimate memo with assumptions, methodology, sensitivity.
- Impairment workings (CGU, discount rate, growth rate, terminal value).
- ECL model with PD/LGD/EAD; impairment indicators list.
- Useful life / residual value assessment; intangibles amortisation.
- Management expert report; independent valuation report if used.

## Optional Inputs
- Industry data; competitor benchmarks; prior-year actual vs estimate.

## Knowledge
- SA 540.8: Assess basis appropriate, assumptions reasonable, consistent with prior period.
- SA 540.9: Test controls over estimate process; perform substantive procedures.
- SA 540.18: Develop point estimate / range; use management expert if needed (SA 620).
- Ind AS 36.6: Impairment indicators — external (market, technology, rates) and internal (obsolescence, decline).
- Ind AS 36.80: CGU = smallest group generating largely independent cash inflows.

## Workflow
1. Obtain complete list of estimates; tie each to TB and disclosure.
2. Assess estimation process — IF documented with controls THEN test + substantive; IF ad hoc THEN extended substantive.
3. Identify impairment indicators (Ind AS 36.6) — IF indicator present THEN obtain recoverable amount (higher of FVLCD and VIU).
4. Test CGU identification — IF cash flows not independent THEN challenge aggregation; IF too large THEN require disaggregation.
5. Test impairment computation — recompute VIU; test cash flow projections, growth, discount rate, terminal value; IF growth exceeds industry THEN challenge; IF discount rate < WACC THEN challenge.
6. Test ECL (Ind AS 109) — verify stage allocation (1/2/3); test PD/LGD/EAD; IF significant increase in credit risk not reflected THEN challenge staging.
7. Test useful life / residual value — IF extended without basis THEN challenge; IF residual >5% of cost THEN assess.
8. Test fair value (Ind AS 113) — verify level (1/2/3); IF Level 3 THEN test assumptions; compare to market data.
9. Evaluate management expert (SA 620) — assess competence, capabilities, objectivity; IF not objective THEN use auditor's expert.
10. Develop auditor's point estimate / range — IF within management range THEN accept; IF outside THEN misstatement; IF wide range THEN use range midpoint evaluation.
11. Test sensitivity — identify key assumptions; perform sensitivity; IF small change reverses conclusion THEN heightened scrutiny.
12. Review post year-end events (SA 560) — IF subsequent event confirms estimate unreasonable THEN adjusting event. Evaluate disclosures (Ind AS 36.134, 109.35, Schedule III); aggregate misstatements per SA 450.

## Decision Points
- D1: Impairment indicator present? YES → obtain recoverable amount. NO → no test (unless goodwill annual).
- D2: Management expert objective and competent? YES → rely. NO → use auditor's expert.
- D3: Auditor's point estimate within management range? YES → accept. NO → misstatement.
- D4: Key assumption sensitive? YES → heightened scrutiny + sensitivity. NO → standard testing.
- D5: Goodwill/intangibles with indefinite life? YES → annual impairment test mandatory.

## Professional Skepticism Probes
- Are growth rates aligned with industry or management optimism?
- Is discount rate genuinely risk-adjusted or cherry-picked to avoid impairment?
- Are ECL stage transfers consistent or manipulated to minimise Stage 3?
- Has useful life extension been justified by genuine change or to reduce amortisation?
- Are impairment indicators ignored (declining margins, asset under-utilisation)?

## Considerations
- Goodwill: test annually even without indicators (Ind AS 36.10).
- Discount rate pre-tax; cash flows pre-tax consistently.
- Terminal growth rate not exceeding long-term industry/country growth.
- ECL: lifetime for Stage 2/3; 12-month for Stage 1; trade receivables practical expedient — lifetime ECL.
- Estimate uncertainty disclosure when reasonably possible outcome materially different (Ind AS 1.125).

## Common Risks
- Discount rate understated; growth rate overstated to avoid impairment.
- CGU aggregated too broadly to dilute impairment signal.
- ECL Stage 1 over-allocated; Stage 3 understated.
- Useful life extended without genuine basis to defer amortisation.
- Level 3 fair value inputs manipulated.

## Fraud Triggers (SA 240)
- Impairment avoided by manipulating discount / growth rate.
- CGU restructured just before testing to avoid impairment.
- ECL staging manipulated to keep non-performing receivables in Stage 1.
- Useful life extended in year of declining profitability.
- Management expert replaced when unfavorable report expected.

## Common Pitfalls
- Not testing CGU cash flow independence.
- Accepting management discount rate without independent WACC.
- Not calibrating past estimates to actuals.
- Failing to perform sensitivity on key assumptions.
- Not evaluating objectivity of management expert.

## Validation
- [ ] Complete estimates list obtained; tied to TB and disclosure.
- [ ] Each material estimate tested for methodology, assumptions, sensitivity.
- [ ] Impairment indicators assessed; CGU independence tested.
- [ ] Discount rate, growth, terminal value recomputed; sensitivity performed.
- [ ] ECL staging and PD/LGD/EAD tested.

## Expected Outputs
- Accounting estimates master working paper.
- Impairment testing memo (CGU, VIU/FVLCD, assumptions, sensitivity).
- ECL testing memo (staging, PD/LGD/EAD).
- Management expert evaluation memo (SA 620).

## Failure Conditions
- Management expert unavailable; refuses to share methodology.
- CGU cash flow data not maintained or unreliable.
- Discount / growth rate basis not documented.

## Escalation Conditions
- Material impairment avoided by unreasonable assumptions → STOP, partner consultation, possible qualified opinion.
- Management expert lacks objectivity / competence → STOP, engage auditor's expert (SA 620).
- ECL manipulation material → STOP, SA 240 fraud risk, partner consultation.
- Estimate uncertainty disclosure omitted and material → STOP, modify opinion (SA 705).
