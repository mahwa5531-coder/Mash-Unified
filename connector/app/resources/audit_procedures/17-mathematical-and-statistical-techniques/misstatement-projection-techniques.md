# Misstatement Projection Techniques

## Purpose
Project sample misstatements to population, compute upper misstatement limit, and conclude whether population is acceptable within tolerable misstatement.

## Scope
- USE WHEN: Sample testing revealed misstatements; project to population per SA 530.
- DO NOT USE WHEN: Zero misstatements in sample (still compute basic precision); non-statistical sampling (use qualitative evaluation).
- APPLIES TO: All substantive sampling — MUS, variables (MPU/Ratio/Difference).

## Audit Objective
- Assertions: Valuation, Accuracy, Existence, Completeness.
- Framework: SA 530; ICAI Guidance Note on Audit Sampling.

## Workflow Dependencies
- REQUIRES: Sample Size Determination, Attribute/MUS/Variables Sampling skills, Sample Test Results.
- FEEDS: Evaluation of Misstatements, Audit Conclusion, Adjustment Proposals.

## Required Inputs
- Sampling method used (attribute/MUS/variables sub-method).
- Sample items with audited and booked values; identified misstatements.
- Sampling interval (MUS); sample mean and std dev (variables); deviation count (attribute).
- Reliability factor (RF) at chosen risk; expansion factor (EF).
- Tolerable misstatement (TM); performance materiality (PM).

## Optional Inputs
- Anomalous misstatements identified; high-value stratum results; prior-year projections.

## Knowledge
- SA 530.10-11: Project misstatements to population; assess sampling risk.
- SA 530.12: Investigate anomalies; consider qualitative aspects.
- SA 530.A31-A36: Project misstatements to population; consider both quantitative and qualitative aspects.
- Anomalous misstatement: unlikely to recur; isolate from projection.
- One-sided (overstatement) vs two-sided (both directions) projection.
- UML = BP + PM + IA; compare to TM.

## Mathematical Foundation
- Four projection methods:
  - Ratio: PM = BV × [(audited sample) / (booked sample) - 1].
  - Difference: PM = (avg diff per item) × N; diff = audited - booked.
  - MPU: PM = (sample mean × N) - recorded BV.
  - MUS: PM_item = tainting × interval; tainting = (B - A)/B; cap tainting at 100% for items < interval.
- Anomalous error handling: cap PM_item at one sampling interval (MUS) or treat as isolated (variables).
- Basic Precision (MUS): BP = RF0 × SI; RF0 = RF at zero deviations.
- Incremental Allowance (MUS): IA per error = (RFd - RF(d-1) - 1) × SI for that error.
- Upper Misstatement Limit: UML = BP + Σ PM + Σ IA (MUS); UML = |PM| + precision (variables).
- One-sided: when testing for overstatement only; UML on upper side.
- Two-sided: when misstatements in both directions; compute UML_upper and UML_lower.
- Zero errors: PM = 0; UML = BP only (MUS) or precision only (variables); compare to TM.
- Compare UML to TM:
  - IF UML ≤ TM THEN population acceptable.
  - IF UML > TM THEN population not acceptable; extend or adjust.
- Assumptions: random sample; stable population; misstatements representative.
- Violation: anomalies distort projection; isolate; non-random selection invalidates UML.

## Workflow
1. Gather sample test results; list each misstatement with booked (B), audited (A), and direction.
2. Identify anomalous misstatements (gross, unusual, isolated).
   - IF anomaly identified THEN isolate; cap impact; investigate root cause separately.
3. Choose projection method per sampling method:
   - IF MUS THEN PM_item = tainting × SI (cap at SI for B < SI).
   - IF variables Ratio THEN PM = BV × [(audited sample) / (booked sample) - 1].
   - IF variables Difference THEN PM = avg diff × N.
   - IF variables MPU THEN PM = sample mean × N - recorded BV.
4. Compute PM for each misstatement; sum to total projected misstatement.
5. Compute Basic Precision (MUS) or precision (variables).
6. Compute Incremental Allowance per error (MUS); sum.
7. Compute UML = BP + Σ PM + Σ IA (MUS); UML = |PM| + precision (variables).
8. Determine direction:
   - IF testing overstatement only THEN one-sided UML.
   - IF both directions THEN two-sided; compute UML_upper and UML_lower.
9. Compare UML to TM.
   - IF UML ≤ TM THEN population acceptable; document conclusion.
   - IF UML > TM THEN population not acceptable; extend sample or propose adjustment.
10. Evaluate qualitative aspects — fraud indicators, control deficiencies, root causes.
11. IF UML > PM but ≤ TM THEN assess precision dominance; document conclusion.
12. Document projection, UML, comparison to TM, qualitative evaluation, conclusion.

## Decision Points
- D1: Misstatement anomalous (gross, isolated, unlikely to recur)? YES → isolate; cap at interval. NO → project normally.
- D2: Sample method MUS? YES → use tainting × SI; cap at SI. NO → use variables method per chosen sub-method.
- D3: Both overstatement and understatement errors present? YES → two-sided evaluation. NO → one-sided.
- D4: UML ≤ TM? YES → accept population. NO → extend testing or propose adjustment.
- D5: UML ≤ PM (overall)? YES → no adjustment needed at FS level. NO → propose adjustment.

## Professional Skepticism Probes
- Are misstatements clustered in specific transactions, customers, or periods?
- Do management explanations for misstatements align with audit evidence?
- Are "anomalous" misstatements truly isolated or part of a pattern?
- Has management proposed adjustments that conveniently bring UML below TM?
- Are qualitative indicators (fraud, override, related party) considered alongside quantitative UML?

## Considerations
- Cap anomalous errors at one interval (MUS) to avoid over-projection.
- Negative misstatements (understatements) cannot be projected via MUS tainting.
- Two-sided evaluation when both overstatement and understatement testing.
- Qualitative factors (fraud, override, RPT) may require adjustment even if UML ≤ TM.
- Aggregate UML across populations; FS-level misstatement evaluation.

## Common Risks
- Misclassifying systematic errors as anomalies (under-projection).
- Not adding incremental allowance when errors found.
- Netting overstatement and understatement errors without separate evaluation.
- Applying MPU when audited values correlate with booked (use Ratio).

## Fraud Triggers (SA 240)
- Misstatements with consistent direction toward management's targets.
- Anomalous errors concentrated in related party or KMP transactions.
- Management requests to write off specific misstatements as "isolated".
- Same counterparty repeatedly in error list.

## Common Pitfalls
- Projecting actual error rather than tainting × interval (MUS, B < SI).
- Not computing Incremental Allowance (UML understated).
- Comparing UML to PM instead of TM at population level.
- Not aggregating misstatements across populations for FS evaluation.

## Validation
- [ ] Each misstatement documented with B, A, direction, root cause.
- [ ] Anomalous misstatements identified and isolated.
- [ ] Projection method matches sampling method.
- [ ] BP, PM, IA computed; UML = BP + Σ PM + Σ IA (MUS).
- [ ] UML compared to TM; conclusion documented.
- [ ] Qualitative aspects evaluated; fraud indicators assessed.

## Expected Outputs
- Misstatement summary table (item, B, A, tainting/diff, PM).
- Anomalous misstatement list with isolation rationale.
- Projected misstatement PM; basic precision BP; incremental allowance IA.
- Upper Misstatement Limit UML; comparison to TM; conclusion.

## Failure Conditions
- Sample results incomplete or unsupported.
- Anomalous misstatements cannot be investigated.
- Misstatement direction cannot be determined.
- Sampling method mismatch (e.g., MUS projection on variables sample).

## Escalation Conditions
- UML > TM → STOP, extend sample or propose adjustment; partner consultation if material.
- Anomalous misstatement indicates fraud → STOP, SA 240 escalation.
- Qualitative indicators (fraud, override) despite UML ≤ TM → STOP, partner consultation.
- Aggregate FS-level misstatement exceeds PM → STOP, propose adjustment.
