# Investments Testing

## Purpose
Verify investments per Ind AS 40 (investment property), 27/28/24 (subsidiary/associate/JV). Test classification current/non-current, FVOCI vs FVTPL (Ind AS 109), unquoted equity impairment, subsidiary vs associate classification.

## Scope
- USE WHEN: Material investments in subsidiaries, associates, JV, equity, debt, investment property.
- DO NOT WHEN: Investments immaterial.
- AUDIT AREAS: Equity investments, debt investments, subsidiaries, associates, JV, investment property.

## Audit Objective
- Assertions: Existence, rights, valuation, completeness, presentation.
- Framework: Ind AS 27, 28, 24, 40, 109, 36, 32, Companies Act Sec 186.

## Workflow Dependencies
- REQUIRES: Trial Balance Validation, Related Party Transactions, Financial Instruments Valuation.
- FEEDS: Audit Reporting, Deferred Tax Testing, Going Concern Assessment.

## Required Inputs
- Investment schedule with cost, carrying amount, classification.
- Subsidiary/associate list; shareholding pattern; SHA/SSA.
- Investment property register; rental yields.
- Board approvals; Sec 186 compliance.
- Independent valuation for material unquoted equity.

## Optional Inputs
- Audited financials of investees; prior-year valuations.

## Knowledge
- Ind AS 27: Subsidiary — control = power + exposure to variable returns + ability to use power.
- Ind AS 28: Associate — significant influence (20-50%); equity method.
- Ind AS 24: Related-party disclosure for investees.
- Ind AS 40: Investment property — FV or cost model; FV through P&L if FV model.
- Ind AS 109: Equity — FVTPL or FVOCI (irrevocable election); debt — amortised cost/FVTPL/FVOCI.
- Ind AS 36: Unquoted equity impairment — recoverable amount.
- Companies Act Sec 186: Loan/investment/guarantee limits; disclosure.
- Ind AS 32.16: Preference shares — debt or equity based on substance.

## Workflow
1. Obtain investment schedule — tie to GL and FS notes.
2. Verify existence:
   - Vouch to share certificates, demat statements, broker confirmations.
3. Verify classification:
   - Subsidiary vs associate vs JV — assess control/significant influence.
   - IF control → consolidate (Ind AS 27); equity investment eliminated on consolidation.
4. Test equity investments:
   - IF quoted → verify at fair value (Ind AS 109).
   - IF unquoted → FVOCI or FVTPL; assess impairment per Ind AS 36.
5. Test debt investments:
   - IF held for collection → amortised cost.
   - IF held for collection + sale → FVOCI.
   - IF held for trading → FVTPL.
6. Test investment property (Ind AS 40):
   - Verify cost or fair value model.
   - IF FV model → independent valuation; P&L change.
   - IF cost model → depreciation per Ind AS 16; disclosure of FV.
7. Test current vs non-current:
   - IF maturity ≤12 months → current; else non-current.
8. Test unquoted equity impairment:
   - IF indicator (loss, decline in NAV) → compute recoverable amount.
   - IF carrying > recoverable → impairment loss.
9. Verify Sec 186 compliance:
   - IF loan/investment/guarantee → check limits, Board/shareholder approval.
10. Test related-party investments:
    - Verify arm's length; Ind AS 24 disclosure.
11. Test preference shares:
    - IF non-redeemable, discretionary dividend → equity.
    - IF redeemable, fixed dividend → debt (Ind AS 32).
12. Evaluate exceptions — factual/projected/anomalous; project per SA 530.

## Decision Points
- D1: Subsidiary or associate? YES (control) → subsidiary. NO (significant influence) → associate.
- D2: Equity unquoted? YES → FVOCI/FVTPL, impairment test. NO → quoted, fair value.
- D3: Investment property model? YES (FV) → P&L. NO (cost) → depreciation + disclose FV.
- D4: Debt classification? YES → amortised cost / FVOCI / FVTPL.
- D5: Sec 186 complied? YES → proceed. NO → exception.
- D6: Preference shares debt or equity? YES (substance) → classify per Ind AS 32.

## Professional Skepticism Probes
- Is subsidiary classification based on genuine control, or cosmetic?
- Is unquoted equity valuation realistic, or inflated?
- Is investment property FV supported, or management estimate?
- Are related-party investments at arm's length?
- Are preference shares genuinely equity, or disguised debt?
- Is impairment recognised despite clear indicators?

## Considerations
- Group audits: consolidate subsidiary; refer Ind AS 110.
- Foreign investment: FEMA compliance; conversion at year-end rate.
- Tax: capital gains on disposal; Ind AS 12 deferred tax.
- Revaluation history: bias risk if consistently upward.

## Common Risks
- Subsidiary not consolidated despite control.
- Unquoted equity overvalued without impairment.
- Investment property FV without independent valuer.
- Sec 186 limit breached; approval missing.
- Preference shares misclassified (debt vs equity).

## Fraud Triggers (SA 240)
- Subsidiary acquisition at inflated price from related party.
- Unquoted equity not impaired despite investee losses.
- Investment property FV based on management estimate without valuer.
- Related-party investment without Sec 186 approval.
- Manual JEs to investment carrying value.
- Preference share classification manipulated to manage ratios.
- Investment existence without broker/demat confirmation.

## Common Pitfalls
- Not testing subsidiary control assessment.
- Accepting unquoted equity at cost without impairment.
- Skipping investment property FV independence.
- Missing Sec 186 compliance check.
- Not classifying preference shares per Ind AS 32.

## Validation
- [ ] Investment schedule tied to GL and FS.
- [ ] Existence vouched (certificates, demat).
- [ ] Classification tested (subsidiary/associate/JV).
- [ ] Equity investments tested (quoted/unquoted).
- [ ] Debt investments tested per Ind AS 109.
- [ ] Investment property tested per Ind AS 40.
- [ ] Current/non-current tested.
- [ ] Unquoted equity impairment assessed.
- [ ] Sec 186 compliance verified.
- [ ] Related-party investments disclosed (Ind AS 24).
- [ ] Preference shares classified per Ind AS 32.
- [ ] Exceptions projected per SA 530.

## Expected Outputs
- Investments testing workpaper.
- Subsidiary/associate/JV classification memo.
- Equity/debt classification memo (Ind AS 109).
- Investment property test memo (Ind AS 40).
- Unquoted equity impairment memo (Ind AS 36).
- Sec 186 compliance checklist.
- Preference share classification memo.
- Exception summary with projection.

## Failure Conditions
- Investment schedule incomplete; existence evidence missing.
- Subsidiary financials not provided for consolidation.
- Independent valuation unavailable for material investment property.

## Escalation Conditions
- Subsidiary not consolidated despite control → STOP, group audit (Ind AS 600), partner consultation.
- Unquoted equity not impaired material → STOP, propose adjustment, engage valuer (SA 620).
- Sec 186 breach material → STOP, refer Companies Act, escalate.
- Investment property FV without independent valuer material → STOP, engage expert, escalate.
