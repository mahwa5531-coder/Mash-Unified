# Materiality Quantitative Models

## Purpose
Quantify overall materiality, performance materiality, and specific materiality using benchmarks; apply qualitative overlays; aggregate materiality across group components.

## Scope
- USE WHEN: Every statutory audit — materiality determination is mandatory at planning and revised at completion.
- DO NOT USE WHEN: Pure compliance-only engagement without opinion on financial statements.
- APPLIES TO: All audit areas; planning, execution, completion; group audits; component materiality.

## Audit Objective
- Assertions: All assertions — materiality frames what is material to the financial statements.
- Framework: SA 320 (materiality); SA 600 (group audits); Companies Act Sec 143; Ind AS 1 (materiality in presentation).

## Workflow Dependencies
- REQUIRES: Understanding Entity, Risk Assessment, Prior-year Financials.
- FEEDS: Risk Assessment, Sample Size Determination, Evaluation of Misstatements, Audit Reporting.

## Required Inputs
- Current and prior-year financial statements; interim financials.
- Entity type (listed, unlisted, SME, NBFC, bank, insurer, PSU).
- Industry sector; ownership structure; debt covenants.
- Group structure (if applicable) and component list.

## Optional Inputs
- Management budget/forecast; analyst expectations; regulator thresholds; peer benchmarks.

## Knowledge
- SA 320.4-5: Determine overall materiality and performance materiality at planning.
- SA 320.12-14: Revise materiality if material information emerges; reassess at completion.
- SA 600.16-19: Component materiality; aggregate must not exceed group materiality.
- Companies Act Sec 143(3): Auditor reports on material misstatements; CARO 2020 thresholds.
- Qualitative factors may make quantitatively immaterial items material.

## Mathematical Foundation
- Benchmarks (Indian context): PBT 5-10% (profit-oriented); Total Revenue 0.5-1% (high-volume, low-margin; NPO); Total Assets 1-2% (asset-intensive: NBFCs, banks, infra); Net Worth 1-5% (equity holders; newly incorporated); Total Income 1-2% (NPO).
- OM = Benchmark × Percentage.
- PM = OM × Factor; Factor 50-75%.
  - IF no prior-year corrections AND low risk THEN Factor = 75%.
  - IF some corrections OR moderate risk THEN Factor = 60%.
  - IF multiple corrections OR high risk THEN Factor = 50%.
- Tolerable Misstatement (TM) = 50-75% of PM (for sampling).
- Clearly Trivial: 1-5% of PM; below this no accumulation.
- Group Materiality: Sum of component PM ≤ Group PM; Component PM allocation = factor 1.5-3.0× on component OM.
- Specific Materiality: lower thresholds for regulatory, covenant, RPT, KMP, going concern.
- Qualitative overlays (override): covenant breaches (₹1 over covenant matters); regulatory thresholds; RPT; KMP compensation; going concern; fraud.
- Assumptions: benchmark stable; percentage appropriate to risk profile; qualitative overlays identified.
- Violation: inappropriate benchmark (PBT for loss-making); percentage not risk-adjusted; qualitative overlays ignored.

## Workflow
1. Identify benchmark based on entity type, industry, metric stability.
   - IF profit-oriented and PBT stable THEN use PBT.
   - IF loss-making OR PBT volatile THEN use Total Revenue or Total Assets.
   - IF asset-intensive (NBFC, bank, infra) THEN use Total Assets.
   - IF not-for-profit THEN use Total Income.
2. Select percentage from range: high risk → higher; low risk → lower.
3. Compute OM = Benchmark × Percentage.
4. Determine PM Factor (50-75%) based on prior-year misstatements, current-year expectations, control environment, risk.
5. Compute PM = OM × Factor.
6. Compute TM = 50-75% of PM; Clearly Trivial = 1-5% of PM.
7. IF group audit THEN:
   - Compute Group OM and Group PM.
   - Allocate Component PM using factor 1.5-3.0× on component OM.
   - Verify sum of Component PMs ≤ Group PM; adjust if exceeds.
8. Identify qualitative overlays requiring specific materiality: covenant; regulatory; RPT; KMP; going concern; fraud.
9. Document materiality in working paper; obtain engagement partner approval.
10. Communicate materiality to engagement team; apply throughout audit.
11. At completion, reassess materiality:
    - IF material change to benchmark THEN revise OM and PM; assess impact.
    - IF no material change THEN confirm original materiality.

## Decision Points
- D1: Benchmark appropriate to entity? PBT stable → PBT. Loss/volatile → Revenue/Assets. Asset-intensive → Assets. NPO → Income.
- D2: Risk profile high? YES → higher percentage within range; lower PM factor (50%). NO → lower percentage; higher PM factor (75%).
- D3: Group audit? YES → allocate component PM; verify sum ≤ group PM. NO → single materiality.
- D4: Qualitative overlays present (covenants, RPT, KMP, regulatory)? YES → apply specific materiality; document. NO → standard materiality.
- D5: Material change at completion? YES → revise materiality; assess impact. NO → confirm original.

## Professional Skepticism Probes
- Has management chosen benchmark that yields highest materiality (lowering audit scope)?
- Are prior-year misstatement patterns considered in PM factor?
- Are qualitative overlays (covenants, RPT) identified and applied?
- Has materiality been revised if interim results differ materially from planning?

## Considerations
- Document benchmark rationale.
- Apply PM at account balance/assertion level; OM at FS level.
- Specific materiality for: related party disclosures, KMP compensation, contingent liabilities.
- Communicate materiality to component auditors (SA 600).
- Indian listed entities: consider SEBI LODR materiality for disclosures.

## Common Risks
- Using PBT for loss-making entity.
- Setting PM factor at 75% regardless of risk.
- Not aggregating component materiality across group.
- Not revising materiality when benchmark changes materially.

## Fraud Triggers (SA 240)
- Management proposes benchmark maximizing materiality (reduces audit scope).
- Materiality revised downward only at auditor insistence after evidence emerges.
- Component materiality allocated to mask specific component misstatements.
- Qualitative overlays (covenant, RPT) not identified.
- Materiality set to accommodate specific management adjustment.

## Common Pitfalls
- Applying materiality mechanically without qualitative considerations.
- Not documenting benchmark selection rationale.
- Failing to revise materiality at completion when benchmark changes.
- Setting Clearly Trivial threshold too high (e.g., 10% of PM).

## Validation
- [ ] Benchmark documented with rationale; appropriate to entity type.
- [ ] Percentage within range; risk-adjusted.
- [ ] PM factor (50-75%) justified by misstatement history and risk.
- [ ] Group: sum of component PM ≤ group PM.
- [ ] Qualitative overlays identified and applied.
- [ ] Materiality approved by partner; communicated to team.

## Expected Outputs
- Materiality determination working paper: Benchmark, percentage, OM amount; PM factor, PM amount; TM amount; Clearly Trivial threshold.
- Component materiality table (group audits).
- Qualitative overlays list with specific materiality applied.
- Completion reassessment; revision (if any) documented.

## Failure Conditions
- No appropriate benchmark available (newly incorporated, no operations).
- Benchmark cannot be reliably measured (interim financials unreliable).
- Group structure not determinable; component materiality cannot be allocated.
- Qualitative overlays cannot be identified.

## Escalation Conditions
- Materiality disputed by management → STOP, partner consultation; document.
- Material benchmark change at completion requires revision → STOP, reassess; partner approval.
- Group component exceeds allocated materiality → STOP, group-level consideration; possible scope expansion.
- Qualitative overlay (covenant breach, fraud) requires specific materiality below quantitative → STOP, partner consultation.
