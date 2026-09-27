# Income Tax Testing

## Purpose
Verify income tax expense, current tax, advance tax, TDS, Sec 40/43B adjustments, MAT, Form 3CD compliance, assessment orders, appeals, disputed demands, prior period tax.

## Scope
- USE WHEN: All audits with material tax expense; tax audit u/s 44AB; MAT liability; disputed demands.
- DO NOT WHEN: Entity tax-exempt (Sec 11/12) with no taxable income.
- AUDIT AREAS: Current tax, deferred tax, advance tax, TDS, MAT, assessments, appeals, contingencies.

## Audit Objective
- Assertions: Completeness, accuracy, valuation, presentation, classification.
- Framework: Income Tax Act 1961; Ind AS 12; ICDS; Sec 44AB tax audit; CARO 2020.

## Workflow Dependencies
- REQUIRES: Trial Balance Validation, Deferred Tax Testing, Journal Entry Testing.
- FEEDS: Audit Reporting, Provisions and Contingent Liabilities Testing (tax disputes).

## Required Inputs
- Tax computation (company's working) — P&L adjustments, MAT computation.
- Form 3CD (tax audit report); advance tax challans; TDS challans (Form 26Q/24Q).
- Assessment orders (Sec 143(1)/143(3)/144); appeal orders (CIT(A)/Tribunal/HC).
- Prior-year tax workings; deferred tax schedule.

## Optional Inputs
- ICDS impact workings; Sec 115JB MAT credit entitlement; transfer pricing report (Sec 92E).

## Knowledge
- Sec 4: Tax on total income of previous year; current tax = tax @ applicable rate on taxable income.
- Sec 115JB: MAT @ 15% (plus surcharge/cess) on book profit; MAT credit for 15 assessment years.
- Sec 40(a)(ia): Disallowance if TDS not deducted/delayed on interest/contractual/commission paid to resident.
- Sec 43B: Deduction only on actual payment — PF/ESI/bonus/gratuity/leave encashment/taxes/interest to banks.
- Sec 194 series: TDS on salary (192), contractor (194C), professional (194J), interest (194A), rent (194I), commission (194H).
- ICDS: Mandatory for tax computation from FY 2016-17; differs from Ind AS (e.g., ICDS II on inventories).
- Ind AS 12: Current tax = expected payable on taxable income; deferred tax on temporary differences.

## Workflow
1. Obtain tax computation — reconcile taxable income to P&L.
2. Re-perform key adjustments:
   - Sec 40(a)(ia): TDS not deducted on payments to resident — add back 30%.
   - Sec 40(a)(iib): Excess remuneration to partners — add back.
   - Sec 43B: PF/ESI/bonus/gratuity/taxes/interest — allow only if paid by ITR due date.
   - Depreciation per Sec 32 (rates; WDV method; additional depreciation).
   - Sec 35D/35AD: Preliminary/capital expenditure amortisation.
3. Test current tax provision — re-compute tax @ applicable rate (25.17% domestic ≤₹400 cr; 30% otherwise; surcharge + cess).
   - IF Sec 115BAA (22% concessional) opted → no MAT; verify no incentives claimed.
4. Test MAT (Sec 115JB) — re-compute book profit = P&L ± prescribed adjustments; IF MAT > current tax → MAT credit (Ind AS 12 DTA); utilise within 15 AYs.
5. Test advance tax — verify quarterly installments (15%/45%/75%/100% by June/Sep/Dec/March); IF shortfall → Sec 234C interest provision.
6. Test TDS compliance — verify deduction per Sec 194 series; deposit by due date; quarterly return (24Q/26Q/27Q/27EQ); IF not deducted → Sec 40(a)(ia) / Sec 201 default.
7. Test Form 3CD (Sec 44AB) — verify applicability (turnover >₹1 cr / >₹10 cr if digital; professional receipts >₹50 lakh); re-perform key clauses (depreciation 18, Sec 43B 26, TDS 34, RPT 36).
8. Test assessment orders and appeals — obtain latest orders; verify demands paid/disputed; IF disputed → contingent liability (Ind AS 37); IF appeal pending → assess probability; provision for probable loss.
9. Test prior-period tax — IF prior-period adjustment → verify computation; recognise in P&L (prior period item per Ind AS 8).
10. Test tax on unrealised gains — IF revaluation gain taxed on realisation → no DTL on unrealised gain; verify.
11. Evaluate exceptions — factual/projected/anomalous; project per SA 530.

## Decision Points
- D1: Sec 43B items paid by ITR due date? YES → allow. NO → add back.
- D2: TDS deducted and deposited per Sec 194? YES → allow. NO → Sec 40(a)(ia) add back.
- D3: MAT > current tax? YES → MAT credit DTA. NO → current tax only.
- D4: Appeal probability of loss >50%? YES → provision. NO → disclose contingent.
- D5: Sec 115BAA opted? YES → 22% rate, no MAT. NO → standard rate.
- D6: Tax audit applicable (Sec 44AB)? YES → Form 3CD. NO → skip.

## Professional Skepticism Probes
- Are Sec 43B items genuinely paid by ITR due date, or back-dated?
- Is TDS genuinely deducted at correct rate, or short-deducted?
- Is MAT computation correct, or book profit understated?
- Is appeal probability assessment conservative, or aggressive?
- Are prior-period tax adjustments genuine, or current period disguised?
- Are ICDS adjustments applied correctly?
- Is MAT credit recognisable — probability of future taxable profit?

## Considerations
- Surcharge: 7%/12% (domestic); 12%/15% (foreign); marginal relief applicable.
- Cess: Health and Education Cess @ 4%.
- Sec 115BAA: Concessional 22% (no incentive, no MAT, no extra depreciation).
- Sec 115BAB: New manufacturing company — 15% (set up by March 2024; extended to March 2025).
- MAT credit DTA: Recognise only if virtual certainty of future taxable profit.
- Ind AS 12.80: Recognise current/deferred tax in P&L unless from business combination or OCI/equity transaction.

## Common Risks
- Sec 43B disallowance missed (PF/ESI/bonus/gratuity).
- Sec 40(a)(ia) disallowance missed (TDS).
- MAT book profit computed incorrectly.
- MAT credit DTA overstated (no future profits).
- Assessment demands not disclosed as contingent.
- Advance tax shortfall interest not provided.
- ICDS adjustments not applied.

## Fraud Triggers (SA 240)
- Sec 43B items back-dated to avoid disallowance.
- TDS deducted but not deposited (siphoning).
- MAT book profit manipulated via manual JEs.
- MAT credit DTA recognised despite recurring losses.
- Assessment demands concealed.
- Prior-period tax adjustment to smooth P&L.
- ICDS impact omitted to understate taxable income.

## Common Pitfalls
- Missing Sec 43B timing check.
- Missing Sec 40(a)(ia) disallowance for delayed TDS.
- Not testing MAT book profit computation.
- Overstating MAT credit DTA.
- Not disclosing disputed demands as contingent.
- Missing advance tax Sec 234C interest.
- Ignoring ICDS impact.

## Validation
- [ ] Tax computation reconciled to P&L; Sec 40(a)(ia) and Sec 43B adjustments tested.
- [ ] Depreciation per Sec 32 tested; current tax re-computed at applicable rate.
- [ ] MAT (Sec 115JB) tested; MAT credit DTA tested (Ind AS 12).
- [ ] Advance tax installments tested; TDS compliance tested (Sec 194 series).
- [ ] Form 3CD (Sec 44AB) tested; assessment orders and appeals reviewed.
- [ ] Disputed demands disclosed (Ind AS 37); prior-period tax adjustments tested.
- [ ] Exceptions projected per SA 530.

## Expected Outputs
- Income tax testing working paper; tax computation re-performance memo.
- Sec 40(a)(ia) / Sec 43B adjustments memo; MAT computation memo (Sec 115JB).
- TDS compliance memo; Form 3CD review memo.
- Assessment/appeal status memo with provision/disclosure.
- Exception summary with projection.
- Conclusion on income tax per Income Tax Act / Ind AS 12.

## Failure Conditions
- Tax computation unavailable; TDS challans missing.
- Assessment orders not provided for disputed demands.
- Form 3CD not obtained (Sec 44AB applicable).

## Escalation Conditions
- Material Sec 43B/40(a)(ia) disallowance missed → STOP, tax exposure, partner consultation.
- MAT credit DTA recognised without virtual certainty → STOP, Ind AS 12 breach, restate.
- Material disputed demand undisclosed (Ind AS 37) / TDS deducted not deposited materially → STOP, fraud risk (SA 240), escalate.
- Tax computation materially misstated / Sec 44AB Form 3CD materially incorrect → STOP, tax audit exposure, escalate.
