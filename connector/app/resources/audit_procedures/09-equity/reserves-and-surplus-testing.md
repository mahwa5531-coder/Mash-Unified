# Reserves and Surplus Testing

## Purpose
Verify R&S per Companies Act and Ind AS. Test capital reserve, CRR, DRR, general reserve, securities premium, OCI, dividend (Sec 123), revaluation reserves.

## Scope
- USE WHEN: Material R&S movement; dividend declaration; revaluation; OCI; reserve transfers.
- DO NOT WHEN: R&S immaterial and no movement.
- AUDIT AREAS: Capital reserve, CRR, DRR, general reserve, securities premium, OCI, revaluation reserve, retained earnings, dividend.

## Audit Objective
- Assertions: Existence, completeness, rights/obligations, valuation, presentation.
- Framework: Companies Act Sec 52/55/69/71/123; Ind AS 1/12/16/19/21/109; SEBI LODR.

## Workflow Dependencies
- REQUIRES: Share Capital Testing, Journal Entry Testing, Employee Benefits Testing, Financial Instruments Valuation.
- FEEDS: Deferred Tax Testing, Audit Reporting, Dividend Declaration Review.

## Required Inputs
- R&S movement schedule (opening, additions, reductions, closing).
- Board/Members' resolutions for dividend, reserve transfers, capitalisation.
- Revaluation workings; valuer's report (Ind AS 16).
- OCI workings — actuarial G/L (Ind AS 19), FVOCI (Ind AS 109), FX translation (Ind AS 21).
- DRR workings; debenture redemption schedule.

## Optional Inputs
- Prior-year R&S schedule; SEBI LODR dividend disclosures.
- Scheme of arrangement (merger/demerger) — NCLT order for reserve transfers.

## Knowledge
- Sec 52: Securities premium usable only for bonus, buyback, premium on redemption, write-off of preliminary/issue expenses.
- Sec 55: CRR on buyback (nominal value bought back); not distributable.
- Sec 69: CRR on preference redemption (nominal value redeemed).
- Sec 71(4): DRR 25% (10% for listed NCDs from April 2019); created before redemption.
- Sec 123: Dividend only from current year profits + undistributed profits; AGM within 30 days; unpaid within 7 days → unpaid dividend account.
- Ind AS 1.78: OCI presented separately; split current/non-current.
- Ind AS 16.31: Revaluation surplus in OCI; transfer to RE on disposal/depreciation.
- Ind AS 19: Remeasurements via OCI, never recycled.

## Workflow
1. Obtain R&S movement schedule — tie to GL and FS notes.
2. Test opening balances — agree to prior-year audited FS.
3. Test capital reserve:
   - Verify source (merger capital profit, pre-incorporation profit, reissue of forfeited shares).
   - Capital reserve NOT distributable as dividend.
4. Test capital redemption reserve (CRR):
   - IF preference shares redeemed → CRR = nominal value redeemed (Sec 69).
   - IF buyback → CRR = nominal value bought back (Sec 55).
   - Verify not used for distribution.
5. Test debenture redemption reserve (DRR):
   - IF NCDs to public → DRR @ 25% (10% for listed NCDs from FY 2019-20).
   - Verify DRR created before redemption begins.
6. Test general reserve and securities premium (Sec 52):
   - Verify transfers per board resolution; securities premium utilization only for permitted purposes.
   - IF misused → reclassify; exception.
7. Test OCI movements:
   - Reconcile each OCI line to underlying standard (Ind AS 19/109/21).
   - Verify no recycling of Ind AS 19 remeasurements.
   - FVOCI debt fair value changes recycled to P&L on derecognition; FX translation on disposal of foreign operation.
8. Test revaluation reserve:
   - Verify valuer's report (independent); revaluation date.
   - IF upward revaluation → credit OCI; depreciation adjustment.
   - IF downward revaluation → debit P&L first to extent of prior gain, then OCI.
9. Test dividend (Sec 123):
   - Verify declared from current year profits + undistributed profits; declared at AGM within 30 days.
   - Verify DDT/Sec 115-O abolished FY 2020-21; tax at shareholder level.
   - IF dividend in excess of profits + free reserves (Sec 123(1)) → exception.
   - IF unpaid within 30 days → unpaid dividend account; verify transfer.
10. Test transfers between reserves — verify board resolution; not from one reserve to P&L.
11. Evaluate exceptions — factual/projected/anomalous; project per SA 530.

## Decision Points
- D1: CRR created on preference redemption/buyback? YES → proceed. NO → exception.
- D2: DRR adequate (Sec 71)? YES → proceed. NO → exception.
- D3: Securities premium used for permitted purpose? YES → proceed. NO → reclassify.
- D4: Dividend from permitted source (Sec 123)? YES → proceed. NO → void declaration.
- D5: Revaluation surplus in OCI (not P&L)? YES → proceed. NO → reclassify.
- D6: Ind AS 19 remeasurements recycled? YES → exception (no recycling). NO → proceed.

## Professional Skepticism Probes
- Are reserve transfers at arm's length, or to mask distribution?
- Is revaluation supported by independent valuer, or internally inflated?
- Is DRR genuinely created, or under-provided to inflate distributable profits?
- Is dividend declaration supported by genuine profits, or accreted via revaluation?
- Are OCI movements correctly classified, or recycled to inflate P&L?
- Is CRR being misused despite Sec 55/69 prohibition?

## Considerations
- Buyback CRR (Sec 55) distinct from preference redemption CRR (Sec 69).
- Ind AS 12: DTL on revaluation surplus; not DTA (revaluation not taxable).
- Dividend tax abolished FY 2020-21; shareholders taxed per slab/companies per Sec 115BAA.
- Sec 123(2): Dividend declared within 30 days of AGM; listed → SEBI LODR disclosure within 24 hours.
- Ind AS 1.82A: OCI items grouped by nature; reclassification adjustments shown separately.

## Common Risks
- DRR under-provided (Sec 71); securities premium misused (Sec 52).
- Dividend from non-permitted source (Sec 123); CRR utilised for distribution (Sec 55/69).
- Ind AS 19 remeasurements recycled to P&L.
- Revaluation surplus credited to P&L (not OCI).
- Unpaid dividend not transferred to unpaid dividend account.

## Fraud Triggers (SA 240)
- Reserve transfers between reserves to mask distribution; revaluation inflated to support dividend/borrowing base.
- DRR reversal to free distributable profits; securities premium reversed to P&L via manual JE.
- OCI reclassification to inflate P&L; dividend declared despite accumulated losses.
- Revaluation reserve used to offset impairment.

## Common Pitfalls
- Missing CRR on buyback/preference redemption; under-providing DRR (post-FY 2019 listed NCD change).
- Recycling Ind AS 19 remeasurements to P&L; not testing revaluation valuer independence.
- Dividend DDT not removed (post-FY 2020-21 abolition).
- Missing DTL on revaluation surplus (Ind AS 12); OCI reclassifications untested.

## Validation
- [ ] R&S schedule tied to GL and FS; opening balances to prior-year FS.
- [ ] Capital reserve source and CRR on redemption/buyback tested (Sec 55/69).
- [ ] DRR tested (Sec 71); securities premium utilization tested (Sec 52).
- [ ] OCI movements reconciled to Ind AS 19/109/21; revaluation valuer independence tested.
- [ ] Dividend source/rate tested (Sec 123); unpaid dividend transfer tested.
- [ ] Reserve transfers vouched to board resolution; DTL on revaluation tested (Ind AS 12).
- [ ] Exceptions projected per SA 530.

## Expected Outputs
- R&S movement working paper.
- CRR/DRR compliance memo; securities premium utilization memo (Sec 52).
- Revaluation compliance memo (Ind AS 16); OCI reconciliation memo (Ind AS 19/109/21).
- Dividend compliance memo (Sec 123); DTL on revaluation memo (Ind AS 12).
- Exception summary with projection.
- Conclusion on R&S per Companies Act/Ind AS.

## Failure Conditions
- Board/Members' resolutions for reserve transfers unavailable.
- Revaluation valuer report missing or valuer not independent; DRR/CRR workings unavailable.

## Escalation Conditions
- Dividend declared in breach of Sec 123 → STOP, Companies Act violation, partner consultation.
- Securities premium materially misused / DRR/CRR materially under-provided → STOP, restate, escalate.
- Revaluation inflated materially → STOP, Ind AS 16 breach, valuer re-engagement.
- OCI recycling in violation of Ind AS 19 → STOP, restate, escalate.
- Reserve transfer masking distribution → STOP, fraud risk (SA 240), escalate.
