# Variables Sampling for Substantive Testing

## Purpose
Statistically test monetary balances by sampling account items and projecting monetary misstatement to the population with quantified sampling risk.

## Scope
- USE WHEN: Substantive testing of homogeneous account balances where individual item values vary widely.
- DO NOT USE WHEN: Zero/low misstatement expected (use MUS); population is small (100% test); qualitative attributes only.
- APPLIES TO: Inventory valuation, Accounts receivable, Fixed asset additions, Payables completeness, Expenses testing.

## Audit Objective
- Assertions: Valuation, Existence, Completeness, Accuracy.
- Framework: SA 530; ICAI Guidance Note on Audit Sampling.

## Workflow Dependencies
- REQUIRES: Materiality Determination, Risk Assessment, Population Definition.
- FEEDS: Misstatement Evaluation, Audit Conclusion, Substantive Strategy.

## Required Inputs
- Population book value (BV) and number of items N.
- Tolerable misstatement (TM) — typically 50-75% of performance materiality.
- Expected misstatement (EM) — from prior year/walkthroughs.
- Reliability factor (RF) based on confidence (90% = 2.31, 95% = 3.0, 99% = 4.61).
- Population standard deviation σ (estimated from pilot sample or prior year).

## Optional Inputs
- Stratification variables (location, age, value bands); prior-year misstatement rates.

## Knowledge
- SA 530.6: Design sample so each sampling unit has chance of selection.
- SA 530.9: Each sampling unit can represent monetary amount.
- Classical variables sampling (CVS) — three methods: mean-per-unit, ratio, difference.
- Selection proportional to size not required; random or systematic acceptable.
- Stratification reduces variability and sample size.

## Mathematical Foundation
- Model: Normal distribution (CLT) for sample mean; t-distribution for small samples.
- Sample size: n = (RF × σ × N) / (TM - EM); RF = reliability factor; σ = pop std dev; N = items; TM = tolerable misstatement; EM = expected misstatement.
- Mean-per-unit (MPU): PM = (sample mean × N) - recorded BV.
- Ratio method: PM = recorded BV × [(audited sample value) / (booked sample value) - 1].
- Difference method: PM = (average difference per item) × N; diff = audited - booked per item.
- Precision: P = RF × (σ_sample / √n) × N; sampling risk allowance.
- UML = |PM| + P; compare UML to TM.
- Assumptions: items independently distributed; distribution approximately normal; stable population.
- Violation: heavy skew or outliers → use stratification or MUS; non-normal small samples → use t-distribution.

## Workflow
1. Define population (account, period, BV, N); reconcile to GL.
2. Choose method based on population characteristics.
   - IF item values similar AND no expected correlation BV↔audited THEN use MPU.
   - IF audited values proportional to booked values THEN use Ratio.
   - IF audited-booked differences stable across items THEN use Difference.
3. Set TM (≤ performance materiality), EM (conservative), RF (confidence level).
4. Estimate σ from prior year data or pilot sample of 30-50 items.
5. Compute n = (RF × σ × N) / (TM - EM); apply FPC if n/N > 0.10.
6. Stratify if σ high or population has distinct subgroups; recompute n per stratum.
7. Select sample — random (random number table/generator) or systematic with random start.
8. Perform audit procedures on each item; record audited value and difference.
9. Compute projected misstatement PM per chosen method.
10. Compute precision P; compute UML = |PM| + P.
11. Compare UML to TM.
    - IF UML ≤ TM THEN population acceptable; misstatement within tolerance.
    - IF UML > TM THEN population not acceptable; extend testing or adjust FS.
12. Document methodology, sample, results, conclusion.

## Decision Points
- D1: Item values highly variable? YES → stratify before sampling. NO → proceed unstratified.
- D2: Audited value proportional to booked value? YES → use Ratio method. NO → use Difference or MPU.
- D3: UML ≤ TM? YES → accept population. NO → extend sample / propose adjustment.
- D4: Anomalous misstatement found? YES → isolate; do not project; investigate. NO → project normally.
- D5: σ_sample significantly > σ_assumed? YES → recompute n; extend sample. NO → proceed.

## Professional Skepticism Probes
- Are large misstatements concentrated in specific locations or item types?
- Do differences correlate with particular preparers or systems?
- Are management explanations for misstatements consistent with audit evidence?
- Is the population complete — any post-cutoff additions or pre-cutoff removals?
- Are negative (favourable) misstatements netted against positive without investigation?

## Considerations
- Stratification by value bands (top stratum 100%, middle sampled, low 100% or no test).
- Difference method preferred when misstatement is independent of BV.
- Ratio method preferred when audited value scales with BV.
- MPU preferred when no BV available (e.g., count-based populations).
- Document population completeness — reconcile to trial balance and subsidiary ledgers.
- Negative misstatements (overstatements in liability populations) — direction matters.

## Common Risks
- Using prior-year σ that no longer reflects current population.
- Stratifying so heavily that sample becomes non-statistical.
- Netting favourable and unfavourable misstatements masking material errors.
- Misapplying Ratio method when audited ≠ proportional to booked.
- Ignoring population completeness (e.g., unrecorded liabilities).

## Fraud Triggers (SA 240)
- Large misstatements concentrated at year-end or in related party balances.
- Misstatements with consistent direction (always overstate assets / understate liabilities).
- Anomalous items clustered around covenant thresholds.
- Sample reveals round-tripping or fabricated entries.
- Management requests auditor to "test different items" after seeing initial selection.

## Common Pitfalls
- Not applying FPC when n/N is high.
- Treating non-statistical judgmental selection as variables sampling.
- Failing to project misstatement to population.
- Using TM equal to performance materiality (should be ≤75% of PM).
- Not evaluating precision alongside projected misstatement.

## Validation
- [ ] Population reconciled to GL (completeness and existence).
- [ ] Method (MPU/Ratio/Difference) justified by data characteristics.
- [ ] σ estimated and documented (source: prior year, pilot sample).
- [ ] Sample size formula applied; FPC considered.
- [ ] Sample selected randomly; selection method documented.
- [ ] PM, precision, UML computed; UML compared to TM; conclusion documented.

## Expected Outputs
- Sample size n with formula and inputs.
- Sample items tested with audited vs booked values.
- Projected misstatement PM (method-stated).
- Precision P; Upper Misstatement Limit UML.
- Conclusion: population acceptable / not acceptable; proposed adjustments.

## Failure Conditions
- Population cannot be reconciled to GL.
- σ unavailable and pilot sample infeasible.
- Sample selection not random (system restrictions).
- Anomalous misstatements dominate — invalidate projection.

## Escalation Conditions
- UML > TM → STOP, extend testing or propose adjustment; partner consultation if material.
- Anomalous misstatement indicates fraud → STOP, SA 240 escalation.
- Population stratification reveals inconsistent subgroups → STOP, reconsider method.
- σ significantly underestimated (sample reveals wider variance) → STOP, recompute n.
