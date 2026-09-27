# Statutory Dues Testing

## Purpose
Verify completeness, accuracy, and timely payment of statutory dues; support CARO 2020 Cl. (xxvi) reporting.

## Scope
- USE WHEN: Every statutory audit; PF, ESI, GST, IT, Sales Tax, Service Tax, Customs, Excise, Cess, PT applicable.
- DO NOT USE WHEN: Entity not subject to specific law (verify exemption).
- AUDIT AREAS: PF, ESI, GST, TDS, Income Tax, Sales Tax, Service Tax, Customs, Excise, Cess, Profession Tax.

## Audit Objective
- Assertions: Completeness, accuracy, valuation, presentation/disclosure.
- Framework: SA 250; EPF Act 1952; ESI Act 1948; CGST/SGST/IGST Acts; IT Act 1961 (Sec 201 TDS); State PT Acts; Customs Act 1962; CARO 2020 Cl. (xxvi); Ind AS 12/37.

## Workflow Dependencies
- REQUIRES: Payroll Testing, GST Testing, Tax Testing, Journal Entry Testing.
- FEEDS: Audit Conclusion, Audit Reporting, CARO 2020 Reporting.

## Required Inputs
- Statutory dues register with month-wise dues, payments, challans.
- PF ECR; ESI returns; GSTR-1/3B/2B; TDS challans and returns (24Q/26Q/27Q).
- Form 26AS / AIS; tax demand notices; assessment orders.
- Bank statements showing challan payments; vendor payment proof.

## Optional Inputs
- Prior-year dues file; reconciliations; legal opinion on disputed dues.

## Knowledge
- CARO 2020 Cl. (xxvi): Dues (PF/ESI/GST/IT/Sales Tax/Service Tax/Customs/Excise/Cess) overdue >6 months at BS date — report amount and duration.
- PF Act: Employee 12% + employer 12% (10% for jute/beedi); deposit by 15th of next month.
- ESI Act: Employee 0.75% + employer 3.25%; deposit by 15th of next month; wage ceiling ₹21,000/month.
- Sec 201: TDS default — assessee in default; interest @1% per month.
- Sec 40(a)(ia): Disallowance 30% of expense if TDS not deducted on resident payments.

## Workflow
1. Obtain statutory dues register; verify completeness; tie each statute to TB.
2. Test PF — reconcile ECR with payroll; recompute 12%+12%; verify EDLI/admin charges; IF payment after 15th → default, interest + penalty risk.
3. Test ESI — reconcile return with payroll; recompute 0.75% + 3.25%; verify wage ceiling compliance.
4. Test GST statutory dues (link to GST Testing) — verify GSTR-3B liability paid by due date; IF delayed → interest @18% (Sec 50).
5. Test TDS — recompute on salary (Sec 192) and non-salary (Sec 194 series); verify challans; reconcile with returns (24Q/26Q/27Q); reconcile per books with Form 26AS/AIS; IF mismatch → exception.
6. Test advance tax / self-assessment tax — verify instalments (Sec 211); IF shortfall >90% THEN interest u/s 234B/C.
7. Test Sales Tax / Service Tax / Excise (legacy) — IF legacy dues pending (pre-GST) → verify demands; assess provision.
8. Test Customs duty — verify import bills of entry; duty payment; IF pending at year-end → provision.
9. Test Profession Tax / Labour Cess / other cess — recompute on salary/wages per state law; verify deposit.
10. Test Sec 43B compliance — IF statutory dues unpaid at year-end but deducted in P&L THEN add back; verify payment before filing.
11. Test disputed dues (Ind AS 37) — IF disputed at appellate authority THEN assess merits; provision if probable; disclose if contingent; CARO Cl. (xxv) — amount deposited under dispute.
12. CARO 2020 Cl. (xxvi) reporting — list dues >6 months overdue at BS date; verify explanation; report clause-wise. Aggregate misstatements per SA 450; assess disclosure per Schedule III.

## Decision Points
- D1: Any dues overdue >6 months at BS date? YES → CARO Cl. (xxvi) report with amount/duration. NO → Nil reporting.
- D2: TDS per books matches Form 26AS? YES → proceed. NO → exception, assess Sec 201 default.
- D3: Disputed dues — outflow probable? YES → provision (Ind AS 37). NO → contingent disclosure.
- D4: Sec 43B dues — paid before filing? YES → deductible. NO → add back.
- D5: Sec 40(a)(ia) — TDS deducted on resident payments? YES → proceed. NO → 30% disallowance.

## Professional Skepticism Probes
- Are dues genuinely paid by 15th or backdated challans?
- Are TDS short-deductions consistently explained as "lower deduction certificate"?
- Are disputed demands systematically treated as contingent despite losing appeals?
- Are legacy dues (Service Tax/Excise) properly assessed or ignored?
- Is PF computed on full basic + DA or artificially split to reduce base?

## Considerations
- Form 26AS now includes SFT transactions; reconcile TDS comprehensively.
- Lower deduction certificate (Sec 197) — verify certificate validity and rate.
- PF wage definition includes basic + DA + retaining allowance; exclude HRA, conveyance.
- Sec 43B override applies to PF, ESI, GST, tax, bonus, leave encashment, interest on loans from PSU/banks.
- Disputed dues: deposit mandatory for filing appeal; disclose deposited amount separately (CARO Cl. xxv).

## Common Risks
- PF/ESI delayed payment — interest not provided.
- TDS short deduction — Sec 201 default + Sec 40(a)(ia) disallowance.
- Form 26AS mismatch — unrecorded TDS / excess claim.
- Legacy Service Tax/Excise demands ignored post-GST.
- Sec 43B dues not added back — overstatement of profit.

## Fraud Triggers (SA 240)
- Backdated challans to mask delayed payment.
- TDS returns showing higher deduction than books (excess claim in 26AS).
- Vendor reclassified to evade TDS / RCM.
- PF base artificially reduced by splitting salary components.
- Disputed demand treated as contingent despite losing at appellate tribunal.

## Common Pitfalls
- Not reconciling TDS per books with Form 26AS / AIS.
- Missing Sec 43B add-back; not testing PF/ESI delay beyond 6 months for CARO.
- Not assessing merits of disputed demands.
- Treating lower deduction certificate as automatic without verification.
- Missing legacy dues (Service Tax/Excise) in disclosure schedule.

## Validation
- [ ] Statutory dues register obtained; each statute tied to TB.
- [ ] PF/ESI recomputed; payment timing verified (15th deadline).
- [ ] TDS recomputed; reconciled with returns and Form 26AS/AIS.
- [ ] GST dues linked to GST Testing; Sec 50 interest tested.
- [ ] Sec 43B add-back tested; Sec 40(a)(ia) disallowance tested.

## Expected Outputs
- Statutory dues testing master working paper.
- PF/ESI re-computation memo; TDS reconciliation memo (books vs returns vs 26AS).
- Sec 43B / Sec 40(a)(ia) compliance memo.
- Disputed dues disclosure memo (Ind AS 37).

## Failure Conditions
- Statutory dues register not maintained.
- Form 26AS/AIS unavailable; challans not produced.
- Management refuses to disclose disputed dues.

## Escalation Conditions
- Material TDS default with Sec 201 + Sec 40(a)(ia) disallowance → STOP, tax partner consultation.
- Material PF/ESI default beyond 6 months → STOP, CARO reporting + labour law risk.
- Disputed dues material, undisclosed or under-provisioned → STOP, partner consultation.
- Fraud indicators (backdated challans, excess TDS claim) → STOP, SA 240, Sec 143(12).
