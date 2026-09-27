# Monetary Unit Sampling

## Purpose
Statistical sampling where sampling unit is individual monetary unit; higher-value items have proportionally higher selection probability — efficient for detecting overstatement.

## Scope
- USE WHEN: Testing for overstatement in account balances (receivables, inventory, fixed assets, revenue).
- DO NOT USE WHEN: Testing for understatement (payables completeness, liabilities); zero expected errors with small populations.
- APPLIES TO: Trade receivables, Inventory valuation, Fixed assets, Investments, Loan books, Revenue cut-off.

## Audit Objective
- Assertions: Valuation, Existence, Accuracy (overstatement focus).
- Framework: SA 530; ICAI Guidance Note on Audit Sampling.

## Workflow Dependencies
- REQUIRES: Materiality Determination, Risk Assessment, Population Definition.
- FEEDS: Misstatement Evaluation, Substantive Conclusion, Audit Opinion.

## Required Inputs
- Population book value (BV); sampling frame listing each item with its value.
- Tolerable misstatement (TM) — typically 50-75% of performance materiality.
- Expected misstatement (EM) — anticipated error rate.
- Expansion factor (EF) — depends on expected errors; 1.0 for zero, 1.5-2.0 for some.
- Reliability factor (RF) at chosen risk level (Poisson-based).

## Optional Inputs
- Prior-year MUS results; stratification by location/age; high-value threshold for 100% testing.

## Knowledge
- SA 530.6-9: Sample design; each monetary unit has selection chance proportional to value.
- MUS = PPS (probability proportional to size) sampling.
- High-value items (≥ sampling interval) selected with certainty (100% stratum).
- Tainting = (B - A)/B; B = booked value; A = audited value; ranges 0-100%.
- Negative misstatements (understatements) cannot be projected using MUS tainting.
- UML = Basic Precision + Projected Misstatement + Incremental Allowance.

## Mathematical Foundation
- Model: Poisson distribution for monetary errors; sample size derived from reliability factor.
- Sample size: n = (RF × BV) / (TM - (EM × EF)).
  - RF = reliability factor at zero deviations (3.0 at 5%, 2.31 at 10%).
  - BV = population book value; TM = tolerable misstatement; EM = expected misstatement; EF = expansion factor.
- Sampling interval: SI = BV / n.
- Tainting per item: t = (B - A) / B; B = booked value, A = audited value.
- Projected misstatement per item: PM_item = t × SI (capped at SI for 100% tainting, i.e., item value < SI).
- For high-value items (B ≥ SI): PM_item = B - A (actual misstatement, no projection).
- Basic Precision: BP = RF0 × SI; RF0 = reliability factor at zero deviations.
- Incremental Allowance (IA): accounts for additional sampling risk when errors found; per error IA = (RFd - RF(d-1) - 1) × SI for that error.
- Upper Misstatement Limit: UML = BP + Σ PM_item + Σ IA.
- Compare UML to TM; if UML ≤ TM → population acceptable; else → reject or extend.
- Assumptions: errors are overstatements; population homogenous; random selection of monetary units.
- Violation: understatement errors cannot be projected; high-value stratum dominates if not separated.

## Workflow
1. Define population and reconcile BV to GL; obtain complete listing.
2. Set TM (≤ 75% of performance materiality), EM, EF, RF (risk 5% or 10%).
3. Compute n = (RF × BV) / (TM - (EM × EF)).
4. Compute SI = BV / n.
5. Identify high-value stratum: items ≥ SI → test 100%; remove from sampled population.
6. Recompute SI for remaining population if BV changes materially.
7. Select sample: systematic selection with random start, picking every SI-th monetary unit.
8. For each selected item: identify item containing selected monetary unit; audit it.
9. For each misstated item: compute tainting t = (B - A)/B; PM_item = t × SI (cap at SI).
   - IF B ≥ SI THEN PM_item = B - A (actual, no projection).
10. Compute BP = RF0 × SI; compute IA for each error found.
11. Compute UML = BP + Σ PM + Σ IA.
12. Compare UML to TM.
    - IF UML ≤ TM THEN population acceptable.
    - IF UML > TM THEN extend sample or propose adjustment.

## Decision Points
- D1: High-value items ≥ SI exist? YES → test 100% as separate stratum. NO → proceed with sampling.
- D2: Misstatement is understatement? YES → do not project via tainting; investigate separately. NO → project normally.
- D3: UML ≤ TM? YES → accept population. NO → extend testing or propose adjustment.
- D4: Tainting = 100% (entire item overstates)? YES → cap PM at SI; consider fraud indicator. NO → normal projection.
- D5: Multiple errors with high tainting? YES → recompute IA; assess fraud risk. NO → standard evaluation.

## Professional Skepticism Probes
- Are 100% tainting errors isolated or clustered in specific transactions/customers?
- Do high-value items show consistent misstatement patterns?
- Are selected items with errors near covenant or covenant-breach thresholds?
- Has management attempted to influence which items are sampled?
- Are negative misstatements in the same population (netting concern)?

## Considerations
- MUS efficient when expected errors are low; less efficient when many errors present.
- Stratification: 100% top stratum + sampled middle + 100% or no-test bottom stratum.
- Cannot detect understatement with high reliability — supplement for liability balances.
- Three-way match failures in selected invoices — investigate before computing tainting.
- Document the sampling frame — listing must be complete and current.

## Common Risks
- Using MUS for understatement testing (payables, accruals).
- Not separating high-value stratum — distorts sampling interval.
- Capping tainting at 100% when item should be tested 100%.
- Ignoring incremental allowance — understates UML.
- Population listing not reconciled to GL — completeness failure.

## Fraud Triggers (SA 240)
- 100% tainting on related party receivables.
- Misstatements concentrated at year-end dates.
- Management disputes selected items post-identification.
- Same customer/vendor appears repeatedly in error list.
- Misstatements mask covenant breach or KPI target.

## Common Pitfalls
- Failing to remove high-value items before computing SI.
- Computing PM as actual error rather than tainting × interval for items < SI.
- Not adding incremental allowance when errors found.
- Using MUS when substantial errors expected (switch to variables sampling).
- Not addressing understatement risk separately.

## Validation
- [ ] Population listing reconciled to GL (completeness, BV accuracy).
- [ ] TM, EM, EF, RF documented with rationale.
- [ ] n computed per formula; SI computed and documented.
- [ ] High-value stratum ≥ SI tested 100%; removed from sampled population.
- [ ] Sample selection systematic with random start; method documented.
- [ ] Taintings computed per item; PM, BP, IA, UML computed and compared to TM.

## Expected Outputs
- Sample size n; sampling interval SI; high-value stratum list.
- Sample items with booked value B, audited value A, tainting t, PM per item.
- Basic precision BP; projected misstatement Σ PM; incremental allowance Σ IA.
- UML = BP + Σ PM + Σ IA; comparison to TM; conclusion.

## Failure Conditions
- Population listing incomplete or not reconciled to GL.
- Selected items cannot be located or audited.
- High-volume understatement errors detected (MUS inappropriate).
- Sampling frame changed after sample selection.

## Escalation Conditions
- UML > TM → STOP, extend sample or propose adjustment; partner consultation if material.
- 100% tainting indicating possible fraud → STOP, SA 240 escalation.
- High-value stratum items missing or unsupported → STOP, control environment concern.
- Multiple errors clustered with common counterparty → STOP, fraud investigation.
