# Payroll Testing

## Purpose
Verify payroll expense and statutory deductions. Test attendance, leave, overtime, bonus, PF/ESI/PT/TDS, gratuity provisioning, salary revisions, contractual staff vs employees, dual employment, ghost employees.

## Scope
- USE WHEN: Material payroll expense; new hires/separations; salary revisions; bonus/incentive payouts.
- DO NOT WHEN: Payroll immaterial and outsourced with clean compliance.
- AUDIT AREAS: Salaries, wages, bonus, incentive, overtime, leave encashment, PF/ESI/PT/TDS, gratuity, contractual staff.

## Audit Objective
- Assertions: Occurrence, completeness, accuracy, classification, cutoff.
- Framework: PF Act, ESI Act, PT Acts (state), Income Tax Sec 192/194, Payment of Bonus Act, Payment of Gratuity Act, Code on Wages; Ind AS 19.

## Workflow Dependencies
- REQUIRES: Trial Balance Validation, Journal Entry Testing, Employee Benefits Testing.
- FEEDS: Statutory Dues Testing, Audit Reporting, Deferred Tax Testing.

## Required Inputs
- Payroll register (monthly) with employee-wise gross, deductions, net.
- HR master — joining/exit dates, designation, salary structure.
- Attendance/biometric logs; leave ledger; overtime approvals.
- PF/ESI/PT/TDS challans and returns (Form 12A/3B/24Q/PT return).
- Bonus/incentive workings and board approvals.

## Optional Inputs
- Prior-year payroll; benchmarking report; HR policy manual.
- Contractual staff agreements; consultant agreements.

## Knowledge
- PF Act: 12% employer + 12% employee on basic + DA + retaining allowance (wage ceiling ₹15,000).
- ESI Act: 3.25% employer + 0.75% employee on gross ≤ ₹21,000/month.
- PT: State-specific slab (e.g., Maharashtra ₹200/₹300; Karnataka ₹200; Delhi nil).
- IT Sec 192: TDS on salary; estimate annual income; deduct monthly; Form 16/24Q.
- Payment of Bonus Act: 8.33%-20% of allocable surplus; ceiling ₹7,000/₹21,000 (wage base).
- Payment of Gratuity Act: 15 days wages per year of service (max ₹20 lakh from 2018); 5-year vesting.
- Code on Wages: Defined wages; subsumes Payment of Wages/Minimum Wages/Bonus/Equal Remuneration.

## Workflow
1. Obtain payroll register — tie monthly totals to GL salary expense.
2. Reconcile headcount — HR master vs payroll vs biometric; IF mismatch → exception; investigate ghost employees.
3. Test new hires — vouch to offer letter, joining report, biometric enrolment; verify salary structure.
4. Test separations — vouch to exit interview, F&F settlement, PF withdrawal/transfer; verify no salary paid after exit.
5. Test attendance and leave — reconcile biometric to attendance to payroll; test leave ledger; IF LOP not deducted → exception.
6. Test overtime — verify approval; statutory limit (Factories Act: 48 hours/quarter); re-compute OT rate (twice ordinary rate).
7. Test bonus/incentive — vouch to board approval; KPI; IF Payment of Bonus Act applies → verify 8.33% minimum.
8. Test salary revisions — vouch to revision letter; effective date; arrears recognised in correct period.
9. Test statutory deductions:
   - PF 12% + 12% — verify challan (Form 12A) and ECR filing.
   - ESI 3.25% + 0.75% — verify challan and Form 5/6 return.
   - PT — verify state-wise challan and return.
   - TDS — verify Form 24Q quarterly; Form 16 annual.
   - IF not remitted by due date → Sec 36(1)(va) disallowance (Sec 43B).
10. Test gratuity provision — re-compute 15 days wages per year of service; verify ceiling; IF LIC scheme → obtain actuarial valuation (Ind AS 19).
11. Test contractual staff vs employees:
    - IF on company payroll → employee; TDS Sec 192.
    - IF consultant → Sec 194J TDS; GST compliance if registered.
    - Misclassification risk → PF/ESI/PT exposure.
12. Test dual employment and ghost employees:
    - Verify PAN/Aadhaar unique across master; cross-check biometric vs canteen/transport usage.
    - IF same bank account for multiple employees → red flag.
13. Evaluate exceptions — factual/projected/anomalous; project per SA 530.

## Decision Points
- D1: PF/ESI/PT/TDS remitted by due date (Sec 43B)? YES → proceed. NO → disallowance.
- D2: Headcount reconciled across HR/payroll/biometric? YES → proceed. NO → ghost risk.
- D3: Bonus ≥8.33% if Payment of Bonus Act applies? YES → proceed. NO → exception.
- D4: Contractor/consultant genuinely not employee? YES → Sec 194J. NO → reclassify.
- D5: Gratuity provision per Ind AS 19? YES → proceed. NO → restate.
- D6: Dual employment or ghost employee detected? YES → fraud risk. NO → proceed.

## Professional Skepticism Probes
- Why are biometric and payroll headcount mismatching?
- Is the consultant genuinely independent, or disguised employee?
- Why is OT clustered in last week — fabricated hours?
- Are salary revisions backdated to inflate arrears?
- Is bonus KPI manipulated to inflate payout?
- Why are statutory dues delayed — cash flow stress?
- Same bank account for multiple employees — ghost employees?

## Considerations
- PF wage ceiling ₹15,000; voluntary PF on actual basic permitted.
- ESI wage ceiling ₹21,000/month (₹25,000 for persons with disability).
- Sec 43B: PF/ESI/bonus/gratuity remitted by due date of IT return allowed.
- Code on Wages: Effective from notification; check state notifications.
- LWF (Labour Welfare Fund): State-specific; verify deduction and remittance.
- Ind AS 19: Leave encashment provision — actuarial valuation.

## Common Risks
- Ghost employees on payroll.
- Statutory dues delayed (Sec 43B disallowance).
- Bonus <8.33% if Act applies.
- Gratuity under-provided (Ind AS 19).
- OT fabricated near year-end.
- Consultant misclassified (PF/ESI exposure).
- Dual employment not detected.

## Fraud Triggers (SA 240)
- Same bank account for multiple employees.
- Biometric headcount < payroll headcount.
- Salary paid after exit date.
- Round-amount bonus without KPI.
- OT approved by same person; not production-linked.
- Consultant invoice duplicate across periods.
- Salary revision backdated without revision letter.

## Common Pitfalls
- Not reconciling biometric to payroll.
- Missing PF/ESI/PT challan verification.
- Not testing Payment of Bonus Act minimum.
- Under-testing gratuity provision (Ind AS 19).
- Accepting consultant classification without substance test.
- Not testing dual employment via PAN uniqueness.
- Missing Sec 43B timing check on dues.

## Validation
- [ ] Payroll register tied to GL; headcount reconciled HR/payroll/biometric.
- [ ] New hires vouched to offer/joining; separations tested (F&F, PF withdrawal).
- [ ] Attendance and LOP tested; overtime approval and rate tested.
- [ ] Bonus/incentive KPI tested; salary revisions and arrears tested.
- [ ] PF/ESI/PT/TDS challans verified; gratuity provision re-computed (Ind AS 19).
- [ ] Contractual staff vs employee classification tested; dual employment / ghost employee check performed.
- [ ] Exceptions projected per SA 530.

## Expected Outputs
- Payroll testing working paper; headcount reconciliation memo.
- Statutory deductions compliance memo (PF/ESI/PT/TDS); bonus compliance memo (Payment of Bonus Act).
- Gratuity provision test memo (Ind AS 19); contractual staff classification memo.
- Ghost employee check memo.
- Exception summary with projection.
- Conclusion on payroll per Ind AS 19 / statutory Acts.

## Failure Conditions
- Payroll register unavailable; HR master missing.
- Biometric/attendance logs not provided.
- PF/ESI/PT/TDS challans and returns unavailable.

## Escalation Conditions
- Ghost employees detected materially → STOP, fraud risk (SA 240), partner consultation.
- Statutory dues materially delayed (Sec 43B disallowance) → STOP, tax exposure, escalate.
- Gratuity materially under-provided (Ind AS 19) → STOP, restate, escalate.
- Consultant misclassification pervasive → STOP, PF/ESI exposure, escalate.
- Dual employment material → STOP, fraud risk, partner consultation.
- OT fabricated / bonus manipulated → STOP, fraud risk (SA 240), escalate.
