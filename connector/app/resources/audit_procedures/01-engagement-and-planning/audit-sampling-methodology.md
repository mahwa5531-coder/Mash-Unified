# Audit Sampling Methodology

## Purpose
Design, select, evaluate audit samples per SA 530. Apply to controls testing (attribute) and substantive testing (variables/MUS). Project misstatements to population with confidence.

## Scope
- USE WHEN: Testing population where 100% examination not feasible (controls, transactions, balances).
- DO NOT USE WHEN: Population small enough for 100% review; analytical procedures suffice.
- AUDIT AREAS: Revenue, procurement, inventory, FA, payroll, JE — any population-based testing.

## Audit Objective
- Assertions: Sample representative; conclusions projectable to population; SA 530 compliance.
- Framework: SA 530, ICAI Guidance Note on Audit Sampling; SA 330 (risk-based sizing).

## Workflow Dependencies
- REQUIRES: Risk Assessment, Materiality, Internal Control Understanding.
- FEEDS: All execution skills (sample-driven), Evaluation of Misstatements.

## Required Inputs
- Complete population data (GL, sub-ledger, transactions list).
- Performance materiality (PM), tolerable misstatement, expected error.
- Risk assessment (higher risk → larger sample).
- Stratification parameters (value, geography, transaction type).

## Optional Inputs
- Prior-year error rates.
- Benford's law / data analytics results for stratification.
- Industry benchmarks for expected error.

## Knowledge
- SA 530.5: Define population, sampling unit, threshold for anomalous error.
- SA 530.7: Sample size driven by risk, control deviation rate, tolerable rate.
- Attribute sampling: Controls testing — expected deviation vs tolerable.
- MUS (Monetary Unit Sampling): Substantive — probability proportional to size.
- Variables sampling: Substantive — classical variables (mean-per-unit, ratio, difference).
- Stratification: Reduce variability, focus on high-value items.
- Anomalous error: Isolated, not projectable — investigate root cause.

## Workflow
1. Define population — complete, relevant, complete for audit objective.
   - IF population incomplete → escalate; cannot sample.
2. Define sampling unit — invoice, voucher, line item, monetary unit.
3. Determine sampling approach:
   - Controls → attribute sampling.
   - Substantive (high-value, low-error) → MUS.
   - Substantive (variable population) → variables sampling.
4. Determine tolerable misstatement/deviation:
   - Substantive: TM = PM (or lower for significant risk).
   - Controls: Tolerable deviation = 5-10% based on control criticality.
5. Estimate expected error:
   - Use prior-year, walk-through, analytics to estimate.
   - IF expected error ≥ tolerable → 100% testing or different procedure.
6. Compute sample size:
   - Attribute: Use AICPA/ICAI tables based on risk, expected, tolerable.
   - MUS: n = (Reliability Factor × Book Value) / TM.
   - Variables: n = (Reliability × Std Dev × Population) / TM.
   - Higher risk → larger sample.
7. Stratify population:
   - High-value: Top X% (e.g., 80% value) — 100% examination.
   - Medium-value: Stratified random or systematic.
   - Low-value: Haphazard or random.
8. Select sample:
   - Random: Each unit equal probability.
   - Systematic: Fixed interval (e.g., every nth).
   - MUS: PPS — larger items higher probability.
   - Haphazard: For low-value, no bias.
   - Block: NOT recommended (low representative).
9. Perform audit procedures on selected items.
   - IF item not available → treat as exception; cannot replace.
10. Evaluate results:
    - Attribute: Project deviation rate; IF upper limit ≤ tolerable → control effective.
    - MUS: Project misstatement = (Error / Sampling Interval) × 100.
    - Variables: Project per chosen method (mean-per-unit, ratio, difference).
11. Identify anomalous errors:
    - IF isolated, large error → investigate; do not project.
12. Conclude:
    - IF projected error + anomalous < PM → population acceptable.
    - IF projected error ≥ PM → extend sample, request management correction, qualify.

## Decision Points
- D1: Population complete and relevant? YES → proceed. NO → escalate.
- D2: Controls testing or substantive? Controls → attribute. Substantive → MUS or variables.
- D3: Expected error ≥ tolerable? YES → 100% or different procedure. NO → compute sample.
- D4: Anomalous error identified? YES → investigate, do not project. NO → include in projection.
- D5: Projected error ≥ PM? YES → extend sample or qualify. NO → conclude acceptable.

## Professional Skepticism Probes
- Is the population truly complete, or filtered by management?
- Are high-value items tested at 100%, or buried in random sample?
- Are exceptions investigated, or accepted without root-cause?
- Has stratification been manipulated to reduce sample size?
- Are anomalous errors really anomalous, or systemic?

## Considerations
- Risk-based sizing: Significant risk → larger sample (often 50-100% increase).
- Prior-year errors: Adjust expected error upward if recurring.
- IT environment: CAATs enable 100% testing where feasible.
- Group audits: Component sampling aligned with group materiality.
- Manual JE: All manual JE near year-end tested (SA 240).
- Comparative period: Use consistent sampling methodology.

## Common Risks
- Population filtered to exclude exceptions.
- Sample size set to match budget, not risk.
- Stratification excludes high-risk categories.
- Selection bias — picking "easy" items.
- Not projecting errors to population.
- Treating all errors as anomalous to avoid projection.

## Fraud Triggers (SA 240)
- Missing items in sample — destroyed or inaccessible.
- Repeated "anomalous" errors indicating systemic fraud.
- Population appears filtered (e.g., excludes weekends, off-hours).
- Unusually high error rate in stratified high-risk group.
- Sample selection manipulated by management.

## Common Pitfalls
- Sample size not documented with risk rationale.
- Haphazard selection labelled as "random."
- Block selection used for convenience.
- Errors not projected per SA 530.
- Anomalous error tag used to avoid extending sample.

## Validation
- [ ] Population defined and completeness confirmed.
- [ ] Sampling approach matches objective (controls vs substantive).
- [ ] Sample size justified by risk, tolerable, expected error.
- [ ] Stratification documented.
- [ ] Selection method appropriate (random/systematic/MUS).
- [ ] Errors projected per SA 530.
- [ ] Anomalous errors investigated, not assumed.

## Expected Outputs
- Sampling plan (population, approach, size, selection method).
- Sample selection list with rationale.
- Audit procedures performed on sample.
- Error summary with classification (factual, projected, anomalous).
- Projection computation per chosen method.
- Conclusion on population acceptability.

## Failure Conditions
- Population incomplete or inaccessible.
- Sample size cannot be justified.
- Selection method inappropriate (e.g., block for high-risk).

## Escalation Conditions
- Projected error ≥ PM → extend sample, partner consultation.
- Anomalous error suggests systemic fraud → STOP, trigger SA 240.
- Population deliberately filtered → STOP, escalate to partner.
- Sample items missing → STOP, treat as scope limitation if material.
