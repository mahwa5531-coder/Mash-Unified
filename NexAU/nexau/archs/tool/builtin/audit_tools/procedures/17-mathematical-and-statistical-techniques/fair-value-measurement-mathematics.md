# Fair Value Measurement Mathematics

## Purpose
Apply fair value mathematics across Ind AS 113 hierarchy (Level 1/2/3); verify market, income, and cost approaches; test valuation models for instruments, intangibles, and unquoted investments.

## Scope
- USE WHEN: Auditing FV measurements — financial instruments (Level 2/3), unquoted investments, intangibles, biological assets, investment property; testing valuation models.
- DO NOT USE WHEN: Level 1 quoted prices in active markets (verify quote, no model); historical cost without FV disclosure.
- APPLIES TO: FVTPL/FVOCI investments, unquoted equity, derivatives, intangible impairment (FVLCD), biological assets, investment property, contingent consideration.

## Audit Objective
- Assertions: Valuation, Accuracy, Classification, Disclosure.
- Framework: Ind AS 113; Ind AS 109; Ind AS 36; SA 540; SA 620.

## Workflow Dependencies
- REQUIRES: Accounting Estimates Testing, DCF Mathematics, Materiality Determination.
- FEEDS: Audit Conclusion, Disclosure Review (Level 3 reconciliation), Audit Reporting.

## Required Inputs
- Management valuation report; valuation model (DCF, BSM, multiples).
- Hierarchy classification: Level 1, 2, or 3.
- Inputs: observable (Level 1/2), unobservable (Level 3).
- Level 3 reconciliation (roll-forward).

## Optional Inputs
- Valuation expert report; transaction comparables; market data feeds.

## Knowledge
- Ind AS 113.18-24: Three-level hierarchy based on lowest significant input.
- Ind AS 113.24: Level 1 = quoted active market; Level 2 = observable inputs other than Level 1; Level 3 = unobservable.
- Ind AS 113.B5-B10: Valuation approaches — market, income, cost.
- Ind AS 113.93-99: Disclosure — Level 3 reconciliation, sensitivity to unobservable inputs.
- SA 540/SA 620: Test estimates; assess expert competence, objectivity, methodology.

## Mathematical Foundation
- Hierarchy: Level 1 = quoted price in active market for identical asset (no adjustment); Level 2 = observable inputs (similar asset prices, yield curves, credit spreads, implied vol); Level 3 = unobservable inputs (entity-specific assumptions).
- Market approach: FV = Comparable Multiple × Entity Metric (revenue, EBITDA, earnings).
- Income approach: DCF (NPV = Σ [CFt/(1+r)^t]; cf. DCF skill); DDM (FV = D1/(r-g); D1=next dividend; g=growth); MPEEM (intangibles: PV of excess earnings after contributory asset charges).
- Cost approach: Replacement Cost - Depreciation (functional, economic, physical).
- Black-Scholes-Merton (BSM): C = S×N(d1) - K×e^(-rT)×N(d2); d1 = [ln(S/K)+(r+σ²/2)T]/(σ√T); d2 = d1 - σ√T. S=price; K=strike; r=risk-free; T=expiry; σ=volatility; N=cumulative normal.
- Binomial lattice (American/path-dependent): p = [(1+r)^t - d]/(u-d); Option = [p×Cu + (1-p)×Cd]/(1+r)^t.
- Monte Carlo: simulate price paths; average payoffs; discount to PV.
- Discounts: DLOM 20-40% (unquoted equity); DLOC 0-25% (minority); Combined D_total = 1 - (1-DLOC)×(1-DLOM).
- Sensitivity: vary each unobservable input ±10%; disclose impact on FV.
- Assumptions: market participant perspective; highest and best use (non-financial assets); principal market.
- Violation: entity-specific perspective; outdated comparables; inconsistent inputs; missing discounts.

## Workflow
1. Identify asset/liability measured at FV; verify classification (Level 1/2/3).
2. For Level 1: verify quoted price from active market; identical asset; reconcile to broker/exchange.
3. For Level 2: identify observable inputs; test valuation technique (matrix pricing, yield curve, OAS); reconcile to independent market data.
4. For Level 3: identify valuation technique (DCF, BSM, MPEEM, lattice, Monte Carlo); identify unobservable inputs (revenue growth, discount rate, volatility, DLOM, DLOC); test each for reasonableness.
5. Test market participant perspective (not entity-specific).
6. Test principal market (greatest volume/activity) or most advantageous market.
7. For non-financial assets: verify highest and best use assumption.
8. Compute FV using valuation technique; reconcile to GL.
9. Perform sensitivity analysis: vary each significant unobservable input ±10%; document and verify disclosure.
10. Test Level 3 reconciliation: Opening + Purchases + Transfers in + Gains/Losses (P&L/OCI) + Settlements/Sales + Transfers out = Closing.
11. IF valuation expert used THEN assess competence, objectivity, methodology (SA 620).
12. Document hierarchy, technique, inputs, sensitivity, reconciliation, conclusions; assess disclosure.

## Decision Points
- D1: Quoted price in active market for identical asset? YES → Level 1. NO → Level 2 or 3.
- D2: Observable inputs other than Level 1? YES → Level 2. NO → Level 3.
- D3: Unobservable inputs significant? YES → Level 3; sensitivity required. NO → Level 2.
- D4: Valuation involves unquoted equity or minority interest? YES → apply DLOM (20-40%) and/or DLOC (0-25%). NO → no discount.
- D5: Significant unobservable inputs; high estimation uncertainty? YES → extensive disclosure; auditor's expert. NO → standard disclosure.

## Professional Skepticism Probes
- Has management chosen valuation technique that maximizes FV?
- Are unobservable inputs consistent with market evidence and prior year?
- Have discounts (DLOM, DLOC) been appropriately applied?
- Is hierarchy classification appropriate (Level 3 items not classified as Level 2)?

## Considerations
- Principal market: highest volume/activity; use that market's price.
- Market participant perspective: not entity-specific assumptions.
- Highest and best use (non-financial assets): maximizes FV (could differ from current use).
- Indian context: limited active markets for unquoted equity; DLOM often 30-40%.

## Common Risks
- Misclassifying Level 3 as Level 2 (using "observable" inputs that are not).
- Using outdated comparables in market approach.
- Applying DLOM/DLOC inconsistently or omitting.
- Entity-specific assumptions instead of market participant perspective.

## Fraud Triggers (SA 240)
- Repeatedly using valuation techniques that maximize FV.
- Changing unobservable inputs at year-end to inflate FV.
- Reclassifying Level 3 to Level 2 to avoid sensitivity disclosure.
- Comparable transactions chosen from related parties at non-arm's length.

## Common Pitfalls
- Treating Level 3 items as Level 2 (insufficient observability).
- Not applying DLOM for unquoted equity (significant overvaluation).
- Using entity-specific assumptions instead of market participant.
- Not disclosing Level 3 reconciliation (roll-forward).

## Validation
- [ ] Hierarchy classification documented (Level 1/2/3) per Ind AS 113.
- [ ] Level 1: quoted price verified from active market.
- [ ] Level 2: observable inputs reconciled to independent market data.
- [ ] Level 3: valuation technique, unobservable inputs documented; sensitivity performed.
- [ ] Discounts (DLOM, DLOC) applied where appropriate.
- [ ] Level 3 reconciliation (roll-forward) tested; disclosures verified.

## Expected Outputs
- Hierarchy classification per asset/liability (Level 1/2/3).
- Valuation technique and inputs table (observable and unobservable).
- FV computation reconciled to GL.
- Sensitivity analysis on significant unobservable inputs (±10%).
- Level 3 reconciliation (roll-forward); disclosure adequacy assessment.

## Failure Conditions
- Valuation model cannot be obtained or is opaque.
- Unobservable inputs cannot be tested for reasonableness.
- Comparable transactions cannot be verified (no market data).
- Valuation expert methodology not assessable.

## Escalation Conditions
- Significant Level 3 valuation with unreliable inputs → STOP, engage auditor's expert (SA 620).
- Hierarchy misclassification (Level 3 as Level 2) → STOP, require reclassification.
- Discounts (DLOM/DLOC) omitted; material overvaluation → STOP, require correction.
- Sensitivity triggers material FV change → STOP, high estimation uncertainty; extensive disclosure required.
