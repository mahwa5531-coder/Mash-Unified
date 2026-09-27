# Financial Instruments Valuation Testing

## Purpose
Verify financial instrument valuation per Ind AS 109. Test classification (amortised cost/FVTPL/FVOCI), ECL (simplified + general approach), fair value hierarchy (L1/L2/L3), derivatives, hedging.

## Scope
- USE WHEN: Material financial assets/liabilities at fair value; ECL; derivatives; hedge accounting.
- DO NOT WHEN: Financial instruments immaterial; no derivatives/hedging.
- AUDIT AREAS: Debt securities, loans/receivables, trade receivables (ECL), derivatives, hedge accounting.

## Audit Objective
- Assertions: Valuation, accuracy, completeness, presentation.
- Framework: Ind AS 109, Ind AS 113, Ind AS 107, SA 540, SA 620.

## Workflow Dependencies
- REQUIRES: Investments Testing, Accounts Receivable Testing, Borrowings Testing, Trial Balance.
- FEEDS: Audit Reporting, Deferred Tax Testing, Provisions Testing.

## Required Inputs
- Financial instrument register with classification and carrying amount.
- Fair value hierarchy classification (L1/L2/L3).
- ECL computation (PD, LGD, EAD).
- Derivative contracts; hedge documentation.
- Independent valuation reports for L3.

## Optional Inputs
- Bloomberg/valuation models; counterparty credit ratings.

## Knowledge
- Ind AS 109.4.1: SPPI test + business model → amortised cost / FVOCI / FVTPL.
- Ind AS 109.5.5: ECL simplified (trade receivables — lifetime), general (3-stage).
- Ind AS 109.6.4: Hedge accounting — designation, effectiveness, documentation.
- Ind AS 113.72: FV hierarchy — L1 (quoted), L2 (observable), L3 (unobservable).
- Ind AS 107.21: Disclosure of FV hierarchy; sensitivity for L3.
- SA 540: Valuation is accounting estimate — test management's process + independent expectation.
- SA 620: Auditor's expert for complex valuation.

## Workflow
1. Obtain financial instrument register — tie to GL and FS notes.
2. Verify classification (amortised cost / FVOCI / FVTPL):
   - Test business model + SPPI per Ind AS 109.
   - IF FVTPL → fair value through P&L.
   - IF FVOCI equity → irrevocable election; FV through OCI, no recycling.
3. Verify fair value measurement:
   - L1: quoted price; verify to exchange.
   - L2: observable inputs; verify to broker quote.
   - L3: unobservable inputs; verify to independent valuer (SA 620).
4. Test ECL on financial assets:
   - Trade receivables (simplified): lifetime ECL based on historical loss + forward-looking.
   - Other financial assets (general): Stage 1 (12-month), Stage 2 (lifetime, significant increase), Stage 3 (credit-impaired).
5. Verify ECL computation:
   - PD (probability of default), LGD (loss given default), EAD (exposure at default).
   - Test management assumptions vs historical data; develop independent expectation.
6. Test derivatives:
   - Verify valuation at fair value; L2 typically.
   - IF hedge accounting → verify designation, effectiveness test, documentation.
7. Test hedge accounting:
   - Cash flow hedge → effective portion in OCI; ineffective in P&L.
   - Fair value hedge → adjustment to carrying amount + P&L.
   - IF designation removed → reclassify per Ind AS 109.
8. Test embedded derivatives:
   - IF economic characteristics not closely related → separate at fair value.
9. Test reclassification:
   - IF reclassified between categories → verify business model change; rare.
10. Test presentation:
    - Offset only if legal right of set-off + intention.
11. Test disclosure (Ind AS 107):
    - FV hierarchy; L3 sensitivity; hedge accounting; risk exposures.
12. Evaluate exceptions — factual/projected/anomalous; project per SA 530.

## Decision Points
- D1: SPPI + business model? YES → amortised cost / FVOCI. NO → FVTPL.
- D2: FV level? L1 → quoted. L2 → observable. L3 → unobservable + expert.
- D3: ECL simplified or general? Simplified (trade receivables) → lifetime. General → 3-stage.
- D4: Hedge effectiveness tested? YES → proceed. NO → discontinue hedge accounting.
- D5: Embedded derivative separable? YES → fair value. NO → host contract.
- D6: Reclassification justified? YES → business model change. NO → exception.

## Professional Skepticism Probes
- Is SPPI test genuinely met, or contractual cash flows structured?
- Is L3 valuation based on credible inputs, or optimistic assumptions?
- Is ECL PD/LGD realistic, or understated to reduce provision?
- Is hedge effectiveness genuine, or manipulated to retain hedge accounting?
- Are embedded derivatives genuinely closely related, or separated selectively?
- Is reclassification driven by genuine business model change?

## Considerations
- Forward-looking ECL: macro-economic scenarios, weightings.
- Counterparty credit risk: rating migration; market data.
- Hedge documentation: contemporaneous, not back-dated.
- SA 620: engage expert for complex L3 valuation.

## Common Risks
- SPPI test failed but classified as amortised cost.
- L3 valuation optimistic; sensitivity not disclosed.
- ECL provision understated; PD/LGD optimistic.
- Hedge effectiveness not tested; hedge accounting retained.
- Embedded derivatives not separated.
- Reclassification without business model change.

## Fraud Triggers (SA 240)
- SPPI classification manipulated to avoid FVTPL volatility.
- L3 inputs optimistic; sensitivity understated.
- ECL provision reduced near year-end without basis.
- Hedge effectiveness back-tested post year-end.
- Embedded derivative separation selectively avoided.
- Manual JEs to financial instrument carrying value.
- Reclassification near year-end to manage P&L.

## Common Pitfalls
- Not testing SPPI for complex instruments.
- Accepting L3 without independent valuer.
- ECL computation not re-performed.
- Hedge documentation not contemporaneous.

## Validation
- [ ] Financial instrument register tied to GL and FS.
- [ ] Classification tested (Ind AS 109).
- [ ] FV hierarchy tested (L1/L2/L3).
- [ ] L3 valuation independently supported.
- [ ] ECL (simplified) tested for trade receivables.
- [ ] ECL (general) tested for other assets.
- [ ] PD/LGD/EAD assumptions tested.
- [ ] Derivatives valuation tested.
- [ ] Hedge accounting tested (designation, effectiveness).
- [ ] Embedded derivatives assessed.
- [ ] Reclassification assessed.
- [ ] Presentation and disclosure (Ind AS 107) verified.
- [ ] Exceptions projected per SA 530.

## Expected Outputs
- Financial instruments valuation workpaper.
- Classification memo (amortised cost / FVOCI / FVTPL).
- FV hierarchy test memo (L1/L2/L3).
- L3 valuation independent review memo.
- ECL computation memo (simplified + general).
- Derivative valuation memo.
- Hedge accounting test memo.
- Embedded derivative memo.
- Ind AS 107 disclosure checklist.
- Exception summary with projection.

## Failure Conditions
- Valuation models unavailable; L3 inputs not disclosed.
- ECL computation not supported.
- Hedge documentation not provided.

## Escalation Conditions
- L3 valuation material without independent valuer → STOP, engage expert (SA 620), partner consultation.
- ECL provision materially understated → STOP, propose adjustment.
- Hedge accounting retained despite effectiveness failure → STOP, propose de-designation.
- Reclassification without business model change material → STOP, propose reversal.
