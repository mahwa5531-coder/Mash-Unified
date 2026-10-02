# Probability and Risk Models in Audit

## Purpose
Quantify audit risk components, model sampling distributions, and apply Bayesian reasoning to update risk assessments based on evidence.

## Scope
- USE WHEN: Planning audit strategy; setting detection risk; selecting sampling distributions; updating risk based on evidence.
- DO NOT USE WHEN: Pure compliance procedures without statistical inference; qualitative risk-only contexts.
- APPLIES TO: Audit strategy, risk assessment, sampling design, evidence evaluation, going concern.

## Audit Objective
- Assertions: Supports all assertions via risk-based audit approach.
- Framework: SA 200 (overall objectives); SA 315 (risk assessment); SA 330 (responses); SA 530 (sampling).

## Workflow Dependencies
- REQUIRES: Risk Assessment, Materiality Determination, Understanding Internal Control.
- FEEDS: Sample Size Determination, Substantive Strategy, Audit Conclusion.

## Required Inputs
- Assessed Inherent Risk (IR) and Control Risk (CR) at assertion level.
- Tolerable misstatement (TM); performance materiality (PM).
- Audit Risk (AR) target (typically 5-10% for reasonable assurance).

## Optional Inputs
- Prior-year risk assessments; industry risk profiles; regulator findings.

## Knowledge
- SA 200.13: Audit risk = risk auditor expresses inappropriate opinion when FS materially misstated.
- SA 315.4-5: Assess IR and CR; combine as Risk of Material Misstatement (ROMM).
- SA 330.5-7: Design responses to assessed risks; lower DR when ROMM higher.
- SA 530: Sampling risk — risk of incorrect acceptance (Type II) or incorrect rejection (Type I).

## Mathematical Foundation
- Audit Risk Model: AR = IR × CR × DR; AR = audit risk target; IR = inherent risk; CR = control risk; DR = detection risk.
- Detection Risk: DR = SAR × TAR; SAR = sampling analytical risk; TAR = total analytical risk (non-sampling).
- Implication: as IR or CR rises, DR must fall → more substantive testing required.
- Bayesian updating: Posterior = (Prior × Likelihood) / Evidence; Posterior Risk = Prior Risk × Likelihood of Evidence.
- Practical Bayesian: Posterior odds = Prior odds × Bayes factor (likelihood ratio).
- Type I error (alpha): incorrect rejection — efficiency loss.
- Type II error (beta): incorrect acceptance — effectiveness failure.
- Sampling distributions:
  - Binomial: discrete; deviations in n trials; attributes sampling.
  - Poisson: approximation to binomial for low deviation rates; MUS sampling.
  - Normal: continuous; CLT for large samples; variables sampling.
  - t-distribution: small samples (n < 30) with unknown σ.
- Reliability factors (Poisson, zero deviations): 90% → 2.31; 95% → 3.0; 99% → 4.61.
- Sample size: n ∝ RF × σ / (TM - EM); higher RF (lower DR) → larger sample.
- Assumptions: IR, CR estimable; independent evidence items; sampling method matches distribution.
- Violation: subjective IR/CR estimates; correlated evidence; misapplied distribution.

## Workflow
1. Assess IR at assertion level using SA 315 risk assessment.
2. Assess CR based on tests of controls (or set maximum if not testing controls).
3. Compute ROMM = IR × CR (qualitative or quantitative).
4. Set target AR (typically 5-10% for reasonable assurance).
5. Compute required DR = AR / (IR × CR).
   - IF DR is low THEN high substantive coverage required.
   - IF DR is moderate THEN standard substantive coverage.
   - IF DR is high (low IR, low CR) THEN reduced substantive coverage acceptable.
6. Select sampling distribution:
   - IF attribute (pass/fail) testing THEN Binomial or Poisson approximation.
   - IF MUS (monetary overstatement) THEN Poisson.
   - IF variables (continuous monetary) THEN Normal (large n) or t (small n).
7. Set Type I (alpha) and Type II (beta) risks; typically alpha = 10%, beta = 5% for substantive.
8. Determine sample size based on RF (from beta) and population parameters (link to Sample Size skill).
9. As evidence accumulates, apply Bayesian updating:
   - Update IR/CR based on walkthrough, JE testing, interim results.
   - Re-compute required DR; adjust substantive scope.
10. IF evidence corroborates risk assessment THEN maintain strategy; document.
11. IF evidence contradicts risk assessment (lower or higher) THEN update model; revise strategy.
12. Document risk model inputs, calculations, updates, final conclusion.

## Decision Points
- D1: Controls tested and effective? YES → CR low; DR may be higher. NO → CR at maximum; DR must be low.
- D2: IR assessed high (complex, judgmental, fraud-prone)? YES → reduce DR; more substantive. NO → standard DR.
- D3: Sample evidence corroborates expectation? YES → posterior risk reduced; maintain strategy. NO → posterior risk increased; extend testing.
- D4: Type II error risk critical? YES → increase sample size; lower beta. NO → proceed.
- D5: Distribution assumptions met? YES → proceed with parametric inference. NO → use non-parametric or judgmental evaluation.

## Professional Skepticism Probes
- Are IR/CR estimates based on evidence or default values?
- Has management's narrative influenced IR assessment without corroboration?
- Are CR assessments lowered based on management self-assessment rather than auditor tests?
- Has the audit strategy been updated as evidence emerged, or static throughout?
- Are posterior risk updates documented when evidence contradicts prior risk?

## Considerations
- Use qualitative IR/CR scales (low/medium/high) mapped to quantitative DR bands.
- Document assumptions explicitly — subjective estimates must be justified.
- Bayesian updating is informal — re-assess periodically, not after every procedure.
- Fraud risk (SA 240) — set IR to maximum for revenue recognition and management override.

## Common Risks
- Setting CR to maximum without testing controls (over-auditing).
- Setting CR below maximum based on walkthrough only (insufficient evidence).
- Not updating risk model as evidence emerges.
- Misapplying distributions (e.g., Poisson for variables sampling).

## Fraud Triggers (SA 240)
- Risk assessment unchanged despite contrary evidence.
- Management proposes reducing substantive testing citing "low risk".
- IR for revenue recognition not set to maximum (presumption).
- Evidence of override ignored; risk model not updated.

## Common Pitfalls
- Treating AR model as formulaic rather than judgmental.
- Not documenting subjective IR/CR estimates with rationale.
- Using default DR without considering IR/CR.
- Failing to update risk model based on interim evidence.

## Validation
- [ ] IR assessed per assertion with documented rationale.
- [ ] CR assessed based on tests of controls (or maximum if not tested).
- [ ] Required DR computed; substantive scope aligned with DR.
- [ ] Sampling distribution matches sampling method.
- [ ] Type I/II risks considered; RF appropriately selected.
- [ ] Bayesian updates documented where evidence emerged.

## Expected Outputs
- Audit Risk Model table: IR, CR, ROMM, target AR, required DR per assertion.
- Substantive coverage decision (high/moderate/reduced).
- Sampling distribution selection with rationale.
- Risk model updates based on interim evidence.
- Final risk conclusion integrated with audit strategy.

## Failure Conditions
- IR/CR not assessable (data restrictions).
- Controls cannot be tested; CR set to maximum.
- Evidence contradicts risk model; cannot update reliably.
- Sampling distribution assumptions violated.

## Escalation Conditions
- Computed DR infeasibly low (impractical sample size) → STOP, partner consultation; reconsider reliance on controls.
- Fraud risk identified; IR not initially set high → STOP, update model; SA 240 response.
- Evidence indicates pervasive misstatement risk → STOP, update strategy; partner consultation.
- Risk model assumptions demonstrably invalid → STOP, redesign approach.
