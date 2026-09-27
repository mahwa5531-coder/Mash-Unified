# Share Capital Testing

## Purpose
Verify share capital transactions per Companies Act Sec 39-68. Test public/private placement, preferential allotment, bonus, rights, buyback, reduction, sweat equity, ESOP, securities premium, share application money.

## Scope
- USE WHEN: Share capital movement; allotments; buyback; reduction; ESOP/sweat equity.
- DO NOT WHEN: No share capital movement; immaterial equity changes.
- AUDIT AREAS: Equity share capital, preference share capital, securities premium, share application money, ESOP, sweat equity.

## Audit Objective
- Assertions: Existence, completeness, rights/obligations, valuation, presentation.
- Framework: Companies Act Sec 39/42/52/53/54/62/63/66/68; SEBI (ICDR) Regulations; SEBI (SBEB) Regulations; Ind AS 32/109; FEMA (FDI).

## Workflow Dependencies
- REQUIRES: Trial Balance Validation, Journal Entry Testing, Related Party Testing.
- FEEDS: Reserves and Surplus Testing, Deferred Tax Testing, Audit Reporting.

## Required Inputs
- Share capital movement schedule (opening, additions, reductions, closing).
- Board/Members' resolutions; MGT-7, MGT-14, PAS-3.
- Prospectus/offering memorandum; SEBI observations (public issue).
- Allotment letters; bank realisation certificates (FIRC for FDI).
- Buyback agreement; tender offer; solvency declaration (Form SH-9).

## Optional Inputs
- Valuation report (preferential/CCD); SEBI take-over exemption.
- ESOP trust deed; SBEB scheme approval; SBEB-1/2/3 returns.
- NCLT order (reduction of capital); RBI FC-GPR (FDI).

## Knowledge
- Sec 39/42: Offer only after prospectus or private placement (PAS-4/5).
- Sec 52: Securities premium usable only for bonus, buyback, premium on redemption, write-off of preliminary/issue expenses.
- Sec 53: Issue of shares at discount VOID (except sweat equity Sec 54).
- Sec 62: Preferential allotment — valuation report; in-principle approval; pricing.
- Sec 68: Buyback — 25% of paid-up + free reserves; 10% (cash); solvency declaration (SH-9); SH-11.
- Sec 66: Reduction of capital — NCLT order; creditors' consent.
- FEMA FDI: Pricing guidelines; FC-GPR within 30 days; sectoral caps.
- Ind AS 32.16A: Compound instruments split debt/equity at inception.

## Workflow
1. Obtain share capital movement schedule — tie to GL and FS notes.
2. Test opening balance — agree to prior-year audited FS.
3. Test fresh allotments:
   - IF public issue → verify prospectus, SEBI observations, oversubscription/refund.
   - IF private placement → verify PAS-4/5, MGT-14, 25% application money on subscription.
   - IF preferential (Sec 62) → verify valuation report, in-principle exchange approval, pricing.
   - IF FDI → verify FC-GPR filing, FIRC, pricing guideline compliance, sectoral cap.
4. Test bonus issue (Sec 63) — drawn from free reserves/securities premium; authorized capital headroom.
5. Test rights issue — verify ratio; offer letter; renunciation; minimum subscription compliance.
6. Test buyback (Sec 68):
   - Verify solvency declaration (SH-9); limit (25%/10%); SH-11 filing within 30 days.
   - Verify source (free reserves/securities premium/proceeds of issue); 2-year cooling period.
7. Test reduction of capital (Sec 66) — verify NCLT order; creditors' consent; filing with ROC.
8. Test sweat equity (Sec 54) — verify 1-year lock-in; special resolution; ceiling 15% (25% for listed).
9. Test ESOP (SEBI SBEB/Companies Act):
   - Verify scheme approval; trust deed; grant/vest/exercise dates.
   - IF listed → SEBI SBEB compliance; SBEB-1/2/3 returns.
10. Test securities premium (Sec 52) and share application money:
    - Verify premium utilization only for permitted purposes.
    - IF share application money pending allotment >1 year → reclassify non-current; refund risk.
    - Verify allotment/refund within 60 days (Sec 40); else refund with 12% interest.
11. Evaluate exceptions — factual/projected/anomalous; project per SA 530.

## Decision Points
- D1: Allotment at discount? YES → Sec 53 violation, except sweat equity. NO → proceed.
- D2: Buyback limits complied? YES → proceed. NO → exception.
- D3: Securities premium used for permitted purpose? YES → proceed. NO → reclassify.
- D4: Share application money >1 year pending? YES → non-current; refund risk. NO → current.
- D5: FDI FC-GPR filed within 30 days? YES → proceed. NO → FEMA non-compliance.
- D6: Buyback solvency declaration filed (SH-9)? YES → proceed. NO → exception.

## Professional Skepticism Probes
- Is allotment price at fair value, or disguised discount/preferential to insiders?
- Is securities premium utilized correctly, or diverted to revenue?
- Is share application money genuinely pending allotment, or unclaimed refund?
- Is ESOP grant/vesting aligned with scheme, or backdated?
- Is buyback solvency genuine, or overstated to evade Sec 68 limits?
- Are related-party allotments at arm's length pricing?

## Considerations
- Compound instruments (CCPS/CCD): split debt/equity at inception per Ind AS 32.
- ESOP accounting: Ind AS 102 — fair value at grant date; expense over vesting.
- Buyback consideration >₹2 lakh paid through bank (Sec 68(7)).
- Listed entity: SEBI LODR disclosure within 24 hours.
- Sec 73-76: Public deposits — verify if share application misclassified.

## Common Risks
- Allotment at discount (Sec 53 violation); securities premium misused (Sec 52).
- Buyback exceeding 25%/10% limits; share application money >1 year — non-current misclassification.
- ESOP expense not recognised (Ind AS 102); FDI FC-GPR not filed (FEMA non-compliance).
- Compound instrument not split (Ind AS 32 breach).

## Fraud Triggers (SA 240)
- Round-sum allotments to related parties without valuation.
- Share application money from shell entities.
- Buyback at inflated price to siphon funds.
- Securities premium reversed to revenue via manual JE.
- ESOP grants backdated to lower exercise price.
- CCD conversion ratio manipulated to favour holders.
- Unauthorised share capital movement without board resolution.

## Common Pitfalls
- Not verifying FC-GPR filing for FDI allotments; missing SH-9 solvency declaration for buyback.
- Treating CCPS/CCD as pure equity without Ind AS 32 split.
- Not testing ESOP expense per Ind AS 102; ignoring Sec 53 (discount) for sweat equity.
- Not reclassifying share application money >1 year; missing MGT-14/PAS-3 filing for allotments.

## Validation
- [ ] Opening balance tied to prior-year FS; allotments vouched to resolutions/PAS-3/bank.
- [ ] Public/private placement and preferential allotment compliance tested (Sec 39/42/62).
- [ ] Bonus source (Sec 63/52); rights ratio/offer tested.
- [ ] Buyback limits + SH-9/SH-11 tested (Sec 68); NCLT order verified for reduction.
- [ ] Sweat equity lock-in/ceiling (Sec 54); ESOP + Ind AS 102 expense tested.
- [ ] Securities premium utilization tested (Sec 52); share application money aged (>1 year reclassified).
- [ ] FDI FC-GPR/FIRC tested (FEMA); exceptions projected per SA 530.

## Expected Outputs
- Share capital movement working paper.
- Allotment compliance memo (Sec 39/42/62); buyback compliance memo (Sec 68; SH-9/SH-11).
- Securities premium utilization memo (Sec 52); ESOP accounting memo (Ind AS 102).
- FDI compliance memo (FEMA FC-GPR); compound instrument split memo (Ind AS 32).
- Exception summary with projection.
- Conclusion on share capital per Companies Act/Ind AS.

## Failure Conditions
- Board/Members' resolutions unavailable; PAS-3/MGT-14 not filed; allotment not registered with ROC.
- Buyback solvency declaration unavailable; SH-11 not filed.
- NCLT order unavailable for reduction of capital.

## Escalation Conditions
- Allotment at discount (Sec 53 breach) → STOP, Companies Act violation, partner consultation.
- Buyback limit breach material → STOP, Sec 68 violation, escalate.
- Securities premium materially misused → STOP, restate, escalate.
- FDI pricing non-compliant / FC-GPR not filed → STOP, FEMA risk, escalate.
- Share application money from shell entities / unauthorised capital movement → STOP, fraud risk (SA 240), escalate.
