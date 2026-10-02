# Inventory Valuation Testing

## Purpose
Verify inventory valued at lower of cost and NRV per Ind AS 2. Test cost formula (FIFO/weighted average), overhead absorption, NRV computation, obsolete/slow-moving write-downs, standard costing variances.

## Scope
- USE WHEN: Material inventory at year-end; valuation risk assessed.
- DO NOT USE WHEN: Inventory immaterial.
- AUDIT AREAS: Raw materials, WIP, finished goods, joint products, by-products, standard costing.

## Audit Objective
- Assertions: Valuation, accuracy, completeness, presentation.
- Framework: Ind AS 2, Ind AS 16 (capital spares), SA 540 (estimates), SA 530.

## Workflow Dependencies
- REQUIRES: Inventory Physical Verification, Trial Balance Validation, Data Profiling, Sampling.
- FEEDS: Evaluation of Misstatements, Audit Reporting, Going Concern Assessment.

## Required Inputs
- Inventory valuation summary (cost, NRV, write-down) by category.
- Cost computation workings (material, labour, overhead).
- Cost formula (FIFO/weighted average) documentation.
- Standard costing system and variance analysis.
- Slow-moving/obsolete inventory schedule.

## Optional Inputs
- Prior-year write-down schedule and reversal history.
- Industry cost benchmarks.
- Selling price list and market data.

## Knowledge
- Ind AS 2.9: Cost = purchase price + duties + freight + directly attributable + fixed/variable production overheads.
- Ind AS 2.24: NRV = estimated selling price − completion cost − selling cost.
- Ind AS 2.25: Lower of cost and NRV — item-by-item, except similar items grouped.
- Ind AS 2.27: FIFO or weighted average for interchangeable; specific identification for non-interchangeable.
- Ind AS 2.32: Write-down in P&L; reversal (2.33) when circumstance changes, limited to original.
- SA 540: NRV is accounting estimate — test management's process, develop independent expectation.

## Workflow
1. Obtain inventory valuation summary by category — tie to GL and FS.
2. Verify cost formula:
   - IF FIFO → verify oldest cost layers remain; re-compute for sample.
   - IF weighted average → re-compute for sample period.
   - IF specific identification → verify non-interchangeable nature.
   - IF formula changed → disclose per Ind AS 8.
3. Verify cost computation:
   - Material: purchase price + duties (non-refundable) + freight.
   - Labour: direct labour at standard/actual rate.
   - Fixed overhead — absorbed on normal capacity; IF actual < normal → unabsorbed expensed.
   - Variable overhead — absorbed on actual use.
4. Verify standard costing variances (price, quantity, overhead):
   - IF material variance → investigate, verify treatment per Ind AS 2.
5. Verify WIP valuation:
   - Stage of completion (cost-to-cost or output method); IF unsupported → valuation risk.
   - Re-compute cost incurred to date.
6. Verify NRV computation:
   - Estimated selling price (current price list / market data).
   - Estimated completion cost (WIP); estimated selling cost.
   - IF NRV < cost → write-down.
7. Verify obsolete/slow-moving:
   - Slow-moving: Aged > 180 days → assess NRV.
   - Obsolete: Damaged, unsaleable → write-down to scrap value.
   - IF write-down insufficient → propose adjustment.
8. Verify joint products and by-products:
   - Joint cost allocation (e.g., relative sales value method).
   - By-products: recorded at NRV or scrap value.
9. Verify write-down reversal:
   - IF reversal → verify circumstance changed (e.g., selling price increased).
   - Reversal limited to original write-down.
10. Verify service inventory — cost of service (labour + overhead) if service not yet rendered.
11. Verify capital spares — IF capital spares (for FA) → Ind AS 16, not inventory.
12. Re-compute on sample basis (by category and value); IF variance > trivial → exception.
13. Evaluate exceptions — classify factual/projected/anomalous; project per SA 530.

## Decision Points
- D1: Cost formula appropriate? YES → proceed. NO → recommend change, disclose per Ind AS 8.
- D2: Overhead absorption based on normal capacity? YES → proceed. NO → adjust, expense unabsorbed.
- D3: NRV < cost? YES → write-down required. NO → cost valuation.
- D4: Slow-moving/obsolete write-down sufficient? YES → proceed. NO → propose adjustment.
- D5: Write-down reversal justified? YES → proceed (limited to original). NO → reverse.
- D6: Sample variance > trivial? YES → exception, extend sample. NO → accept.

## Professional Skepticism Probes
- Is FIFO/weighted average genuinely applied, or selectively?
- Is overhead absorption realistic, or inflated to reduce cost?
- Are slow-moving items genuinely usable, or written up?
- Is NRV based on current prices, or optimistic projections?
- Are write-downs reversed prematurely to inflate profit?
- Are joint product allocations reasonable, or manipulated?
- Is WIP stage realistic, or profit-inflated?

## Considerations
- Industry: Manufacturing, trading, services — different cost components.
- Volatile prices: Commodity inventory — frequent NRV assessment.
- Standard costing: Variances investigated and treated per Ind AS 2.
- Estimates (SA 540): NRV, stage, obsolete — test management + independent expectation.
- Prior-year reversal: History of reversal → bias risk.

## Common Risks
- Overhead absorption inflated — inventory overvalued.
- NRV not computed or computed optimistically.
- Obsolete/slow-moving not written down.
- Write-down reversal without genuine circumstance change.
- WIP stage inflated — profit manipulation.
- Cost formula change without disclosure.

## Fraud Triggers (SA 240)
- Overhead absorption significantly higher than normal capacity.
- NRV not computed or optimistically without market data.
- Slow-moving stock not written down despite aging.
- Write-down reversal without circumstance change.
- WIP stage significantly higher than industry/peers.
- Cost formula changed near year-end.
- Manual JE to inventory write-up.

## Common Pitfalls
- Using FIFO/weighted average without re-computation.
- Accepting NRV without independent price verification.
- Skipping obsolete/slow-moving assessment.
- Treating write-down reversal as routine.
- Not testing WIP stage independently.

## Validation
- [ ] Inventory valuation summary tied to GL and FS.
- [ ] Cost formula verified (FIFO/weighted average/specific identification).
- [ ] Overhead absorption based on normal capacity.
- [ ] Standard costing variances investigated.
- [ ] WIP stage of completion verified.
- [ ] NRV computed independently on sample.
- [ ] Obsolete/slow-moving write-down assessed.
- [ ] Joint/by-product allocation tested.
- [ ] Write-down reversal justified.
- [ ] Sample re-computation performed.
- [ ] Exceptions projected per SA 530.

## Expected Outputs
- Inventory valuation testing workpaper.
- Cost formula verification memo.
- Overhead absorption computation.
- Standard costing variance analysis.
- WIP stage verification memo.
- NRV computation (sample).
- Obsolete/slow-moving write-down schedule.
- Joint/by-product allocation memo.
- Write-down reversal assessment.
- Exception summary with classification and projection.
- Conclusion on inventory valuation per Ind AS 2.

## Failure Conditions
- Cost computation workings not provided.
- Standard costing system unreliable.
- NRV computation not available.

## Escalation Conditions
- Obsolete/slow-moving material not written down → STOP, propose adjustment, partner consultation.
- NRV < cost material without write-down → STOP, propose adjustment, consider qualification.
- WIP stage significantly inflated → STOP, escalate, engage expert under SA 620.
- Standard costing variances capitalized without investigation material → STOP, escalate, propose adjustment.
