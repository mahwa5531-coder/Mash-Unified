# Variance Analysis for Standard Costing

## Purpose
Apply variance analysis to audit inventory valuation under standard costing (Ind AS 2), verify variance classification, and assess abnormal vs normal cost treatment.

## Scope
- USE WHEN: Entity uses standard costing system for inventory valuation; testing variance computations and classification; assessing capacity utilization.
- DO NOT USE WHEN: Pure actual cost system; service entities without inventory; immaterial inventory balance.
- APPLIES TO: Manufacturing inventory, WIP, finished goods; cost of production; overhead absorption.

## Audit Objective
- Assertions: Valuation, Accuracy, Allocation, Completeness, Classification.
- Framework: Ind AS 2 (inventories); SA 520 (analytical procedures); Companies Act Schedule II (depreciation, capacity).

## Workflow Dependencies
- REQUIRES: Inventory Valuation Testing, Materiality Determination, Cost Accounting Records (CARO).
- FEEDS: Inventory Conclusion, COGS Conclusion, Audit Reporting.

## Required Inputs
- Standard cost sheet: standard prices, quantities, rates, hours per unit.
- Actual production data: actual quantities, prices, hours, rates.
- Normal capacity definition; actual production volume.
- Variance ledger accounts; cost sheet reconciliation.

## Optional Inputs
- Industry benchmarks; prior-year variance analysis; production planning reports.

## Knowledge
- Ind AS 2.12-13: Cost of conversion = direct labor + production overheads (fixed and variable) allocated based on normal capacity.
- Ind AS 2.12: Fixed overhead allocation not increased for low production; unallocated fixed OH recognized as expense in P&L.
- Ind AS 2.16: Abnormal waste (materials, labor, overhead) recognized as expense, not capitalized in inventory.
- Companies Act, Sec 148: Cost records for specified industries; CARO 2020 reporting on cost records.
- Variance analysis supports substantive analytical procedures (SA 520).

## Mathematical Foundation
- MPV (Material Price Variance) = (SP - AP) × AQ; SP = std price; AP = actual price; AQ = actual quantity.
- MUV (Material Usage Variance) = (SQ - AQ) × SP; SQ = std quantity for actual output.
- LRV (Labour Rate Variance) = (SR - AR) × AH; SR = std rate; AR = actual rate; AH = actual hours.
- LEV (Labour Efficiency Variance) = (SH - AH) × SR; SH = std hours for actual output.
- Variable OH Expenditure Variance = (SVOR - AVOR) × AH; SVOR = std variable OH rate; AVOR = actual.
- Variable OH Efficiency Variance = (SH - AH) × SVOR.
- Fixed OH Expenditure Variance = Budgeted Fixed OH - Actual Fixed OH.
- Fixed OH Volume Variance = (Normal Capacity Hours - Budgeted Hours) × SFOR; SFOR = std fixed OH rate.
- Fixed OH Capacity Variance = (Budgeted Hours - Actual Hours) × SFOR.
- Fixed OH Efficiency Variance = (Std Hours - Actual Hours) × SFOR.
- Normal capacity: production expected on average over periods; not maximum.
- Unallocated fixed OH (actual < normal): expensed in P&L, not inventory.
- Abnormal waste: expensed, not capitalized; quantity × std cost.
- Assumptions: standards reasonable; allocation bases consistent; production measurable.
- Violation: outdated standards; over-absorbing fixed OH in inventory; capitalizing abnormal waste.

## Workflow
1. Obtain standard cost sheet and actual cost data; reconcile to GL inventory and COGS.
2. Verify standards reasonableness: compare to prior year; verify updated for current cost environment.
3. Compute material variances (MPV, MUV); reconcile to variance ledger; investigate significant.
4. Compute labour variances (LRV, LEV); reconcile to variance ledger; investigate.
5. Compute overhead variances: Variable (Expenditure, Efficiency); Fixed (Expenditure, Volume = Capacity + Efficiency).
6. Verify normal capacity definition: reconcile to Schedule II; verify based on historical/expected production.
7. Test fixed OH allocation:
   - IF actual < normal THEN unallocated fixed OH to P&L (not inventory).
   - IF actual ≥ normal THEN allocate at standard rate (no over-allocation).
8. Test abnormal waste: identify (materials, labour, OH); verify expensed, not capitalized.
9. Test variance classification: favorable → reduce inventory or COGS; adverse → investigate; classify.
10. Reconcile: Std cost + Variances = Actual cost; reconcile to GL.
11. Test cost records (CARO 2020): IF specified industry THEN verify records per Sec 148.
12. Document variances, classification, reconciliation, conclusions; assess disclosure adequacy.

## Decision Points
- D1: Standards updated and reasonable? YES → proceed. NO → challenge; require update.
- D2: Actual below normal capacity? YES → unallocated fixed OH to P&L. NO → allocate at standard rate.
- D3: Abnormal waste identified? YES → expense, not inventory. NO → normal waste capitalized.
- D4: Variance material? YES → investigate root cause; test classification. NO → document.
- D5: Specified industry under Sec 148? YES → verify cost records; CARO 2020 reporting. NO → no cost records requirement.

## Professional Skepticism Probes
- Has management redefined "normal capacity" to over-absorb fixed OH into inventory?
- Are adverse variances capitalized in inventory (improper)?
- Have standards been manipulated to create favorable variances?

## Considerations
- Standards should be reviewed annually; outdated standards distort inventory valuation.
- Normal capacity should reflect realistic expected production; not maximum theoretical.
- Fixed OH allocation: use standard rate × standard hours for actual output.
- Abnormal waste identification: compare to historical norms; investigate significant deviations.
- Indian context: Sec 148 cost records for specified industries; CARO 2020 reporting.

## Common Risks
- Allocating fixed OH above normal capacity (over-absorption in inventory).
- Capitalizing abnormal waste in inventory (overstated inventory).
- Outdated standards (distorted variance and inventory valuation).
- Manipulating normal capacity definition to absorb more fixed OH.

## Fraud Triggers (SA 240)
- Redefining normal capacity upward at year-end to absorb more fixed OH.
- Capitalizing abnormal waste to inflate inventory and reduce COGS.
- Standards manipulated to create favorable variances.
- Cost records not maintained for Sec 148-specified industry (suppression).

## Common Pitfalls
- Not identifying abnormal waste (treated as normal, capitalized).
- Allocating fixed OH above normal capacity (over-absorption).
- Using outdated standards (distorted variance analysis).
- Not reconciling standard to actual cost via variance ledger.

## Validation
- [ ] Standard cost sheet obtained; standards updated and reasonable.
- [ ] Material, labour, overhead variances computed; reconciled to variance ledger.
- [ ] Normal capacity verified; fixed OH allocation per Ind AS 2.12.
- [ ] Abnormal waste identified and expensed (not capitalized).
- [ ] Variance classification tested (favorable/adverse).
- [ ] Standard cost + Variances = Actual cost; reconciled to GL.

## Expected Outputs
- Variance computation table: MPV, MUV, LRV, LEV, OH variances (variable and fixed).
- Normal capacity assessment; fixed OH allocation test.
- Abnormal waste identification and expense recognition.
- Variance ledger reconciliation; standard-to-actual cost reconciliation.
- CARO 2020 cost records compliance conclusion (if applicable).

## Failure Conditions
- Standard cost sheet cannot be obtained.
- Actual cost data not reconcilable to GL.
- Normal capacity not defined or cannot be verified.
- Variance ledger not maintained or incomplete.

## Escalation Conditions
- Material over-absorption of fixed OH into inventory → STOP, require correction; partner consultation.
- Abnormal waste capitalized in inventory → STOP, require reclassification; partner consultation.
- Standards manipulated → STOP, partner consultation; potential fraud (SA 240).
- Cost records not maintained for Sec 148 industry → STOP, CARO 2020 reporting.
