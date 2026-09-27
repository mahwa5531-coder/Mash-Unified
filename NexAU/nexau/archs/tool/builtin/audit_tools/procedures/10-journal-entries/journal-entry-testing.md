# Journal Entry Testing

## Purpose
Test journal entries for material misstatement and fraud per SA 240. Identify and test fraud-prone JEs: year-end, manual, round amounts, unauthorized poster, RPT, top-side adjustments, suspense entries, CEO/CFO entries.

## Scope
- USE WHEN: All audits (SA 240 mandatory); higher intensity when fraud risk assessed high.
- DO NOT WHEN: Immaterial entity with no GL access.
- AUDIT AREAS: General ledger JEs, manual JEs, top-side adjustments, suspense/clearing accounts, period-end accruals, RPT entries.

## Audit Objective
- Assertions: Occurrence, completeness, accuracy, authorization, classification.
- Framework: SA 240, SA 315, SA 330, SA 500, SA 520.

## Workflow Dependencies
- REQUIRES: Risk Assessment, Understanding Internal Control, Data Profiling and Analytics.
- FEEDS: Audit Reporting, Fraud Risk Assessment, Management Letter.

## Required Inputs
- Full GL JE extract (date, account, amount, poster, description, source, manual/auto flag).
- User master with access rights and approval matrix.
- Chart of accounts; suspense/clearing account list.
- Risk assessment results (fraud risks, RPT list, management override areas).

## Optional Inputs
- Benford's law analytics output; weekend/holiday JE extract.
- Manual JE log; suspense aging; related-party master.

## Knowledge
- SA 240.32-33: Test JEs for inappropriate/suspicious entries; management override risk.
- SA 240.A45-A48: Characteristics — unauthorized, end-of-period, no explanation, RPT, round sums, suspense.
- SA 330.18: Substantive procedures for management override of controls mandatory.
- Period-end: Last 5 working days + first 5 days of next period.
- Top-side: Entries made at consolidation/holding level not flowing through subsidiaries.
- Suspense accounts: Should close to zero; persistent balance = red flag.

## Workflow
1. Obtain full JE population for the period — reconcile to TB and FS.
2. Confirm completeness of extract — tie to GL control totals.
3. Stratify JEs:
   - System vs manual.
   - Period-end vs intra-period.
   - Authorised vs unauthorised poster.
4. Apply fraud-risk filters (any ONE triggers selection):
   - Posted in last 5 working days / first 5 days next period.
   - Manual entry; round amounts (multiples of ₹1 lakh / ₹10 lakh).
   - Posted by CEO/CFO/accounting manager (no segregation).
   - Entries to revenue, P&L, suspense, RPT accounts.
   - Entries without narration or with generic text ("as per mgmt", "adjustment").
   - Posted on weekends/holidays or outside business hours.
   - Top-side adjusting entries at consolidation level.
   - Suspense entries not cleared by year-end.
5. Select sample:
   - High-risk filter JEs — 100% if few; sample if many.
   - Random sample of manual JEs — minimum 25.
   - Suspense entries aged >30 days — all.
6. Vouch selected JEs:
   - Verify supporting documentation (invoice, contract, board resolution).
   - Verify approval as per authorisation matrix.
   - Verify posting date aligns with transaction date.
   - Verify account classification.
   - Verify business rationale.
7. Test management override:
   - IF CEO/CFO entries to revenue/provisions → vouch to support; challenge rationale.
   - IF top-side adjustments → trace to subsidiary records.
8. Test suspense/clearing accounts:
   - IF suspense balance >0 at year-end → exception; investigate aging.
   - IF suspense used as parking account → fraud red flag.
9. Test RPT entries:
   - Verify pricing arm's length; Ind AS 24 disclosure.
10. Test period-end accruals/reversals:
    - IF accrual reversed in next period → verify genuine; assess earnings management.
11. Perform analytics:
    - Benford's law on manual JEs; investigate deviations.
    - Trend analysis on top-side adjustments vs prior year.
12. Evaluate exceptions — factual/projected/anomalous; project per SA 530.

## Decision Points
- D1: JE extract complete and reconciled to GL? YES → proceed. NO → re-obtain.
- D2: JE has support + approval? YES → pass. NO → exception.
- D3: Suspense balance >0 year-end? YES → exception. NO → proceed.
- D4: CEO/CFO entry to revenue/P&L? YES → deep-dive. NO → standard test.
- D5: Accrual reversed in next period? YES → earnings management risk. NO → proceed.
- D6: Benford's deviation material? YES → expand sample. NO → proceed.

## Professional Skepticism Probes
- Why was this entry manual, not automated?
- Why posted outside business hours or on a weekend?
- Is the narration generic because there is no genuine transaction?
- Why is suspense not cleared — is it parking unrecorded items?
- Is the round amount coincidental, or fabricated?
- Is the top-side adjustment supported by subsidiary records?
- Why is the accrual reversed so quickly — earnings smoothing?

## Considerations
- Population = complete JE list including reversing entries.
- Filters target risk, not random selection.
- Suspense and clearing accounts are common fraud vehicles.
- Period-end + early next period cutoff is critical.
- Top-side adjustments may bypass subsidiary controls.
- CEO/CFO access to GL indicates weak segregation.

## Common Risks
- Year-end manual JEs to manage earnings.
- Top-side adjustments unsupported by subsidiaries.
- Suspense accounts used as parking.
- Round amounts indicating fabricated transactions.
- CEO/CFO override of controls.
- Unauthorised poster bypassing approval matrix.
- Accrual reversal in next period (smoothing).

## Fraud Triggers (SA 240)
- JEs to revenue/provisions with no support.
- Entries posted by unauthorized user.
- Round amounts with no business rationale.
- Entries to/from suspense not cleared.
- Top-side adjustments inflating revenue/profit.
- Entries on weekends/holidays outside business hours.
- Generic narrations ("as per mgmt", "year-end adj").
- RPT entries without arm's length pricing.

## Common Pitfalls
- Testing only random sample; ignoring high-risk filters.
- Not reconciling extract to GL completeness.
- Not investigating suspense aged balance.
- Accepting generic narration as support.
- Skipping top-side adjustments at consolidation.
- Not testing accrual reversals in next period.
- Missing CEO/CFO poster entries.

## Validation
- [ ] JE extract reconciled to GL and TB.
- [ ] Population completeness confirmed.
- [ ] Fraud-risk filters applied.
- [ ] Sample size adequate (min 25 manual JEs).
- [ ] Each selected JE vouched to support.
- [ ] Approval matrix verified.
- [ ] CEO/CFO entries deep-dived.
- [ ] Top-side adjustments traced to subsidiaries.
- [ ] Suspense accounts investigated if >0.
- [ ] Accrual reversals in next period tested.
- [ ] Benford's law analytics performed.
- [ ] Exceptions projected per SA 530.

## Expected Outputs
- JE testing working paper with selected JEs.
- Fraud-risk filter results memo.
- Suspense/clearing account analysis.
- Top-side adjustment test memo.
- CEO/CFO entry analysis memo.
- Benford's law analytics memo.
- Exception summary with projection.
- Conclusion on JE testing per SA 240/330.

## Failure Conditions
- GL access unavailable; extract incomplete.
- User master / approval matrix unavailable.
- Supporting documents for material JEs missing.

## Escalation Conditions
- Material unsupported JE to revenue/provisions → STOP, fraud risk (SA 240), partner consultation.
- Suspense balance materially >0 at year-end → STOP, investigate, escalate.
- Top-side adjustment unsupported by subsidiaries → STOP, fraud risk, escalate.
- CEO/CFO override of controls pervasive → STOP, scope/going concern risk, partner consultation.
- Pattern of round-amount manual JEs near year-end → STOP, fraud risk (SA 240), escalate.
- Accrual reversal pattern indicating earnings management → STOP, partner consultation.
