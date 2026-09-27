# Depreciation Testing

## Purpose
Verify depreciation per Schedule II/Ind AS 16. Test useful lives, component approach, residual value, change in estimate vs policy, additional depreciation, SLM vs WDV, revaluation impact.

## Scope
- USE WHEN: Material depreciation charge; FAR active; revaluations.
- DO NOT WHEN: Asset base immaterial.
- AUDIT AREAS: Tangible FA, intangibles (amortisation), revalued assets, componentised assets.

## Audit Objective
- Assertions: Valuation, accuracy, allocation, presentation.
- Framework: Ind AS 16, Ind AS 38, Schedule II (Companies Act 2013), Ind AS 8 (changes), Ind AS 36.

## Workflow Dependencies
- REQUIRES: Fixed Assets Additions Testing, Disposal Testing, Trial Balance.
- FEEDS: Deferred Tax Testing, Audit Reporting, Provisions.

## Required Inputs
- FAR with useful life, method, residual value, depreciation workings.
- Schedule II useful life schedule; policy for deviations.
- Component register (if component approach adopted).
- Revaluation workings and reserve movement.
- Prior-year depreciation schedule.

## Optional Inputs
- Technical/actuarial life assessment; impairment indicators.

## Knowledge
- Schedule II: Useful lives prescribed; deviate IF justified by technical evaluation.
- Ind AS 16.43: Component approach — significant components depreciated separately.
- Ind AS 16.51: Residual value reviewed annually; ≥5% original cost customary (not mandatory).
- Ind AS 16.54: SLM or WDV — applied consistently; change in method = change in policy per Ind AS 8.
- Ind AS 16.31: Revaluation surplus credited to OCI; depreciation on revalued amount.
- Ind AS 16.55: Revaluation reserve transfer to retained earnings equal to excess depreciation.
- Ind AS 8.36: Change in estimate (useful life, residual) prospective; change in method retrospective.
- Companies Act Sec 205: Depreciation mandatory before dividend.

## Workflow
1. Obtain depreciation schedule — tie total to GL, P&L, FS notes.
2. Verify method consistency:
   - IF method changed → check Ind AS 8 (policy change, retrospective).
3. Verify useful lives:
   - Compare to Schedule II; IF deviates → verify technical justification.
4. Verify component approach:
   - IF components significant → test separate depreciation; IF not componentised → assess materiality.
5. Verify residual value:
   - IF residual >5% → verify justification; review annually.
6. Re-compute depreciation on sample:
   - Additions: proportionate from RFU date; disposals: up to disposal date.
   - IF SLM → (cost − residual) / life; IF WDV → rate × opening WDV.
7. Verify additional depreciation:
   - IF asset used <180 days in year → 50% additional dep (Schedule II proviso for new assets).
8. Verify revaluation impact:
   - Depreciation on revalued amount; excess credited to OCI.
   - Transfer from revaluation reserve to retained earnings = excess depreciation.
9. Verify change in estimate:
   - IF useful life revised → prospective application; disclose per Ind AS 8.
10. Test intangibles amortisation:
    - IF finite life → amortise; IF indefinite → no amortisation, test impairment (Ind AS 36).
11. Test cut-off — additions/disposals depreciation computed correctly.
12. Evaluate exceptions — factual/projected/anomalous; project per SA 530.

## Decision Points
- D1: Method changed? YES → Ind AS 8 retrospective. NO → proceed.
- D2: Useful life deviates from Schedule II? YES → technical justification. NO → proceed.
- D3: Component approach adopted? YES → test components separately. NO → assess materiality.
- D4: Residual value reasonable? YES → proceed. NO → adjust.
- D5: Revaluation in year? YES → test excess depreciation and OCI transfer. NO → proceed.
- D6: Indefinite-life intangible? YES → no amortisation, impairment test. NO → amortise.

## Professional Skepticism Probes
- Is useful life shortened/extended to manage profit?
- Is component approach selectively applied?
- Is residual value inflated to reduce depreciation?
- Is revaluation reserve transfer correctly computed?
- Are indefinite-life intangibles genuinely indefinite?
- Is additional depreciation correctly restricted to eligible assets?

## Considerations
- Schedule II vs Companies Act provisions for non-Schedule II entities.
- Tax depreciation vs books (Income Tax Act) — separate, do not reconcile.
- Revaluation frequency: fair value updated regularly.
- Impairment indicators (Ind AS 36): obsolescence, idle assets, market decline.

## Common Risks
- Useful life inconsistent with Schedule II without justification.
- Component approach ignored — single life for asset with mixed components.
- Residual value >5% without rationale.
- Revaluation reserve not transferred for excess depreciation.
- Change in estimate treated as change in policy (or vice versa).

## Fraud Triggers (SA 240)
- Useful life extended near year-end without technical basis.
- Depreciation halted on idle assets still in use.
- Revaluation created without external valuer; depreciation not updated.
- Manual JEs reducing depreciation with vague narration.
- Component approach abandoned selectively for older assets.

## Common Pitfalls
- Not testing additional depreciation for <180-day assets.
- Accepting deviations from Schedule II without technical report.
- Treating change in estimate as policy change.
- Missing revaluation reserve transfer.
- Not testing intangibles for indefinite-life classification.

## Validation
- [ ] Depreciation schedule tied to GL and FS.
- [ ] Method consistency verified.
- [ ] Useful life compared to Schedule II.
- [ ] Component approach tested.
- [ ] Residual value tested.
- [ ] Sample re-computation performed.
- [ ] Additional depreciation verified.
- [ ] Revaluation impact tested.
- [ ] Change in estimate vs policy assessed.
- [ ] Intangibles amortisation/impairment tested.
- [ ] Exceptions projected per SA 530.

## Expected Outputs
- Depreciation testing workpaper with sample re-computation.
- Method consistency memo.
- Useful life deviation assessment.
- Component depreciation memo.
- Revaluation impact memo.
- Change in estimate vs policy assessment.
- Exception summary with projection.
- Conclusion on depreciation per Schedule II/Ind AS 16.

## Failure Conditions
- FAR incomplete; depreciation workings unavailable.
- Component register missing despite component approach claimed.
- No technical justification for Schedule II deviation.

## Escalation Conditions
- Useful life deviation material without technical basis → STOP, propose adjustment, partner consultation.
- Revaluation without independent valuation material → STOP, engage expert under SA 620.
- Indefinite-life intangible without impairment test → STOP, refer Ind AS 36, escalate.
- Component approach not applied to significant components material → STOP, propose adjustment.
