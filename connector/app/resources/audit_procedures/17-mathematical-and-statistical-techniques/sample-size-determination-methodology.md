# Sample Size Determination Methodology

## Purpose
Compute statistically defensible sample sizes across audit contexts (attribute, MUS, variables) with explicit confidence, tolerable rate/misstatement, and population parameters.

## Scope
- USE WHEN: Any sampling application requiring formal sample size justification (SA 530 documentation).
- DO NOT USE WHEN: 100% testing appropriate; non-statistical judgmental sampling documented as such.
- APPLIES TO: Controls testing, substantive monetary testing, MUS, analytical procedures sampling.

## Audit Objective
- Assertions: Supports all assertions via statistically derived sample sizes.
- Framework: SA 530; ICAI Guidance Note on Audit Sampling.

## Workflow Dependencies
- REQUIRES: Materiality Determination, Risk Assessment, Population Definition.
- FEEDS: Attribute Sampling, MUS, Variables Sampling skills; Substantive Strategy.

## Required Inputs
- Sampling objective (attribute/MUS/variables).
- Confidence level (90/95/99%); corresponding RF.
- Tolerable deviation rate (TDR) or tolerable misstatement (TM).
- Expected deviation rate (EDR) or expected misstatement (EM).
- Population size N or BV; population standard deviation σ (variables only).
- Expansion factor (EF) for MUS (1.0 if zero expected errors).

## Optional Inputs
- Prior-year sample results; pilot sample data; stratification parameters.

## Knowledge
- SA 530.6: Auditor shall determine sample size sufficient to reduce sampling risk to acceptable low level.
- Confidence ↔ risk of incorrect acceptance are complementary (95% confidence = 5% risk).
- Higher confidence → larger RF → larger sample.
- Higher EDR/EM → larger sample (must approach but not exceed tolerable).
- Small populations require FPC adjustment.

## Mathematical Foundation
- Confidence-to-RF mapping (Poisson, zero deviations): 90% → RF 2.31; 95% → RF 3.0; 99% → RF 4.61.
- Attribute sampling: n = RF / (TDR - EDR); RF = reliability factor for chosen risk and expected deviations.
- MUS / PPS: n = (RF × BV) / (TM - (EM × EF)); BV = book value; TM = tolerable misstatement; EM = expected misstatement; EF = expansion factor.
- Variables (classical): n = (RF × σ × N) / (TM - EM); σ = population standard deviation; N = number of items.
- Finite Population Correction: n_adj = n / (1 + n/N); apply when n/N > 0.05 (small populations).
- Stratified sampling: n_h = n × (N_h × σ_h) / Σ(N_j × σ_j); allocate proportional to stratum size × variability.
- Assumptions: random selection; population stable; parameters correctly estimated.
- Violation: biased estimates of σ/EDR → under/oversized sample; non-random selection invalidates inference.

## Workflow
1. Identify sampling context (attribute, MUS, or variables).
2. Set confidence level based on risk assessment (95% default; 99% high risk; 90% low risk).
3. Set tolerable parameter (TDR for attributes; TM for monetary; typically ≤ 75% of PM).
4. Set expected parameter (EDR for attributes; EM for monetary).
5. Select RF for chosen confidence and expected deviations/zero.
   - IF attribute sampling THEN n = RF / (TDR - EDR).
   - IF MUS THEN n = (RF × BV) / (TM - (EM × EF)).
   - IF variables THEN n = (RF × σ × N) / (TM - EM).
6. Compute n; check feasibility vs population N.
7. Apply FPC if n/N > 0.05: n_adj = n / (1 + n/N).
8. IF stratified THEN allocate n across strata using n_h formula.
9. Document inputs (RF, TDR/TM, EDR/EM, σ, BV, N) and chosen formula.
10. Cross-check n against minimum professional thresholds (attributes ≥ 25; MUS ≥ 25; variables ≥ 30 for normality).
11. Reconcile to professional judgment — if n < threshold, increase; if n > N, do 100%.
12. Lock sample size; proceed to sample selection skill.

## Decision Points
- D1: Sampling for controls or monetary? Controls → attribute formula. Monetary → MUS or variables.
- D2: Overstatement testing with low expected errors? YES → MUS formula. NO → variables formula.
- D3: n/N > 0.05? YES → apply FPC. NO → use n directly.
- D4: EDR approaching TDR (or EM approaching TM)? YES → sample impractical; do not rely on control / extend testing. NO → proceed.
- D5: Population has distinct subgroups with different σ/EDR? YES → stratify; allocate n per stratum. NO → proceed unstratified.

## Professional Skepticism Probes
- Are EDR/EM estimates based on reliable evidence (prior year, pilot) or management assertions?
- Is the chosen confidence level commensurate with assessed risk of material misstatement?
- Has management attempted to influence population definition to reduce sample size?
- Are tolerable parameters set independently of management's targets?
- Does the sample size exceed prior year without explanation for change?

## Considerations
- Default 95% confidence for most substantive applications; 90% for low-risk controls.
- Use 99% for fraud-risk areas, related parties, management override.
- Stratify when sub-populations have materially different characteristics (size, age, location).
- Pilot sample (30-50 items) for σ estimation when prior-year data unreliable.
- Document minimum thresholds — even if formula yields lower n, use professional minimum.

## Common Risks
- Underestimating EDR/EM to reduce sample (insufficient evidence).
- Overestimating σ → oversized sample (inefficient but safe).
- Using wrong RF for chosen confidence/risk.
- Failing to apply FPC on small populations.
- Treating non-statistical sample as statistical.

## Fraud Triggers (SA 240)
- Management proposes unusually low sample size without basis.
- Sample selection reveals patterns inconsistent with random selection.
- Population listing differs from GL; management cannot explain.
- Stratification excludes transactions linked to KMP or related parties.
- Sampling parameters changed without documented rationale from prior year.

## Common Pitfalls
- Confusing confidence level with risk of incorrect acceptance (complementary).
- Using TM = performance materiality (should be ≤ 75% of PM).
- Not documenting rationale for chosen RF.
- Applying attribute formula to monetary testing or vice versa.
- Ignoring FPC for small populations.

## Validation
- [ ] Sampling context identified (attribute/MUS/variables).
- [ ] Confidence level and RF documented and consistent.
- [ ] Tolerable parameter ≤ 75% of performance materiality (monetary) or appropriate for control risk (attribute).
- [ ] Expected parameter based on documented evidence.
- [ ] Sample size formula applied correctly; FPC applied if needed.
- [ ] Resulting n meets professional minimum thresholds.

## Expected Outputs
- Sample size n with formula, inputs, and rationale.
- RF reference table entry used.
- Stratification plan (if applicable) with n per stratum.
- Reconciliation to prior-year n with explanation for changes.

## Failure Conditions
- Cannot obtain reliable EDR/EM/σ estimates.
- Population cannot be reconciled to GL.
- Required n exceeds N (switch to 100% testing).
- Population definition disputed by management.

## Escalation Conditions
- Sample size impractical (EDR ≥ TDR or EM ≥ TM) → STOP, do not rely; increase substantive testing.
- Significant change in sampling parameters from prior year → STOP, document justification.
- Management disputes sampling parameters → STOP, partner consultation.
- Stratification reveals subgroup with abnormal characteristics → STOP, investigate before proceeding.
