# Fixed Assets Additions Testing

## Purpose
Verify capitalization of FA additions per Ind AS 16/23. Test direct vs incidental costs, borrowing cost capitalization, CWIP-to-FA transfers, threshold policies.

## Scope
- USE WHEN: Material FA additions in year; capitalization policy risk.
- DO NOT USE WHEN: Additions immaterial; no capex cycle.
- AUDIT AREAS: Land, buildings, plant & machinery, vehicles, computers, intangibles, CWIP transfers.

## Audit Objective
- Assertions: Existence, completeness, valuation, accuracy, classification, cut-off.
- Framework: Ind AS 16, Ind AS 23, Ind AS 38 (intangibles), Companies Act 2013 Sec 143/207, CARO 2020.

## Workflow Dependencies
- REQUIRES: Trial Balance Validation, Risk Assessment, Journal Entry Testing, Sampling.
- FEEDS: Depreciation Testing, CWIP Testing, Finance Costs Testing, Audit Reporting.

## Required Inputs
- Fixed assets register (FAR) with additions schedule.
- Vendor invoices, BOQ, completion certificates, capitalization memos.
- Borrowing cost capitalization workings.
- Board approvals for capex; threshold policy.
- Insurance, customs, freight, installation documents.

## Optional Inputs
- Project consultant reports; supplier reconciliations.
- Prior-year additions roll-forward; revaluation workings.

## Knowledge
- Ind AS 16.16: Capitalize purchase price, duties, freight, installation, site prep, professional fees, testing costs.
- Ind AS 16.17: Decommissioning cost capitalized if reliably measurable.
- Ind AS 16.19: Day-1 costs for dismantling, removing assets expensed.
- Ind AS 16.22: Cost of self-constructed asset = direct + attributable overheads; abnormal waste expensed.
- Ind AS 23.8: Capitalize borrowing cost on qualifying asset (QAP) — commencement, suspension, cessation.
- Ind AS 38.57: Development costs capitalize if PIRATE criteria met; research expensed.
- Sec 198/Companies (CSR) Rules: Asset created from CSR grant to be reported; CSR asset held for ≥1 year.

## Workflow
1. Obtain additions schedule — tie total to GL and FS notes.
2. Vouch additions to invoices/BOQ for sample (stratified by value).
3. Verify capitalization criteria:
   - IF asset ready-for-use date identified → confirm capitalization date.
   - IF costs incurred post-RFU → expense, not capitalize.
4. Test cost composition:
   - Include: purchase price, non-refundable taxes, freight, installation, testing, professional fees.
   - Exclude: refundable GST, admin overhead, training, abnormal waste, post-RFU costs.
5. Test borrowing cost capitalization:
   - IF qualifying asset (QAP) → verify commencement (expenditure + borrowing + activities begin).
   - IF substantial work suspended → suspend capitalization.
   - IF substantially complete → cease capitalization.
6. Test CWIP-to-FA transfers:
   - Verify transfer value = cumulative cost.
   - IF partial capitalization → apportion on defensible basis.
7. Test self-constructed assets:
   - Verify direct cost + attributable overhead; exclude abnormal waste.
8. Test intangibles:
   - IF development cost → verify PIRATE criteria; research expensed.
9. Test cut-off:
   - Vouch additions near year-end; IF invoice dated next year in FAR → remove.
10. Verify Board approval for capex exceeding threshold; confirm authorization matrix.
11. Test related-party additions (Ind AS 24):
    - IF supplier is related party → verify arm's length pricing.
12. Evaluate exceptions — factual/projected/anomalous; project per SA 530.

## Decision Points
- D1: Cost ready-for-use? YES → capitalize. NO → retain in CWIP.
- D2: Borrowing cost on QAP? YES → capitalize per Ind AS 23. NO → expense.
- D3: CWIP transfer value supported? YES → proceed. NO → recompute, adjust.
- D4: Self-construction overhead appropriate? YES → proceed. NO → re-classify to expense.
- D5: Intangible development PIRATE met? YES → capitalize. NO → expense.

## Professional Skepticism Probes
- Are capitalized costs genuinely attributable, or routine expense reallocated?
- Is RFU date realistic, or accelerated to start depreciation earlier/later?
- Are abnormal costs capitalized to inflate assets?
- Is borrowing cost capitalization suspended during delays?
- Are related-party additions at arm's length?
- Are post-RFU costs still in CWIP?

## Considerations
- Capitalization threshold: confirm policy applied consistently.
- GST credit: refundable credit excluded; non-refundable capitalized.
- Imported assets: customs duty, forex, demurrage classification.
- Government grant assets (Ind AS 20): grant treatment disclosed.
- CSR assets (Sec 135): track for 1-year holding rule.

## Common Risks
- Revenue expense capitalized (repairs, maintenance, training).
- Borrowing cost capitalized beyond cessation.
- CWIP not capitalized despite completion — delayed depreciation.
- Pre-operative expenses capitalized without basis.
- Abnormal costs capitalized; GST credit included in cost.

## Fraud Triggers (SA 240)
- Capitalization spike near year-end with no operational rationale.
- RFU date manipulated to defer depreciation.
- Borrowing cost capitalized during suspended activities.
- Related-party additions significantly above market price.
- Manual JEs to FA with vague narration.
- Costs vouched to internal/related-party invoices without external evidence.
- CWIP capitalized without completion certificate.

## Common Pitfalls
- Not testing borrowing cost cessation date.
- Accepting capitalization policy without recalculating.
- Including refundable GST in asset cost.
- Not vouching CWIP transfers to underlying costs.
- Skipping intangible PIRATE assessment.
- Missing cut-off at year-end.

## Validation
- [ ] Additions schedule tied to GL and FS.
- [ ] Sample vouched to invoices/BOQ.
- [ ] Capitalization criteria verified.
- [ ] Cost composition tested (inclusions/exclusions).
- [ ] Borrowing cost capitalization tested.
- [ ] CWIP-to-FA transfers reconciled.
- [ ] Self-construction overhead verified.
- [ ] Intangibles PIRATE assessed.
- [ ] Cut-off tested.
- [ ] Related-party pricing verified.
- [ ] Exceptions projected per SA 530.

## Expected Outputs
- Additions testing workpaper with sample vouching.
- Capitalization criteria verification memo.
- Borrowing cost capitalization test memo.
- CWIP transfer reconciliation.
- Intangibles assessment memo.
- Cut-off test schedule.
- Exception summary with projection.
- Conclusion on FA additions per Ind AS 16/23.

## Failure Conditions
- FAR not maintained; additions schedule incomplete.
- Capitalization memos not supported.
- Borrowing cost workings unavailable.

## Escalation Conditions
- Revenue expenditure capitalized materially → STOP, propose adjustment, partner consultation.
- Borrowing cost capitalized post-cessation → STOP, propose adjustment.
- Related-party addition at non-arm's length material → STOP, refer Ind AS 24, escalate.
- CWIP capitalized without completion evidence → STOP, reverse to CWIP, escalate.
