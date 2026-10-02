# Attribute Sampling for Controls Testing

## Purpose
Statistically evaluate operating effectiveness of a control by testing a sample of control occurrences and extrapolating deviation rate to the population.

## Scope
- USE WHEN: Testing operating effectiveness of controls where population is homogeneous and deviations are binary (pass/fail).
- DO NOT USE WHEN: Testing monetary amounts (use MUS/variables); controls with no deviation trail; exploratory/non-statistical sampling.
- APPLIES TO: Authorization controls, Segregation of duties, Reconciliation reviews, ITGC access reviews, Three-way match approvals, SOX-equivalent controls.

## Audit Objective
- Assertions: Operating effectiveness of controls (indirect, supports risk assessment).
- Framework: SA 530; SA 330; ICAI Guidance Note on Audit Sampling.

## Workflow Dependencies
- REQUIRES: Risk Assessment, Understanding Internal Control, Materiality Determination.
- FEEDS: Tests of Controls Results, Substantive Strategy, Audit Conclusion.

## Required Inputs
- Population definition: control being tested, period, population size N.
- Tolerable Deviation Rate (TDR): max rate auditor accepts (typically 5-10%).
- Expected Deviation Rate (EDR): anticipated error rate from walkthroughs/prior year.
- Risk of Overreliance (RoR): 5% or 10%.
- Acceptable confidence level: 90% or 95%.

## Optional Inputs
- Prior-year deviation rates; internal audit test results; control self-assessment reports.

## Knowledge
- SA 530.6-7: Sample design — auditor shall design sample to achieve audit purpose and population.
- SA 530.8-9: Sample selection — each item has equal chance; project errors to population.
- SA 530.10-11: Evaluate sample results; project errors; assess sampling risk.
- TDR is inversely related to control risk: lower TDR → higher confidence required.
- Deviation in sample ≠ control failure; compare UDL to TDR.
- Population must be complete and free from systematic bias.

## Mathematical Foundation
- Model: Poisson approximation to binomial distribution for low deviation rates.
- Sample size: n = RF / (TDR - EDR); RF = Reliability Factor from Poisson table.
- RF (0 expected deviations): 3.0 at 5% risk, 2.31 at 10% risk, 4.61 at 1% risk.
- RF with deviations: 1 dev = 4.75 (5%), 3.89 (10%); 2 dev = 6.30 (5%), 5.33 (10%).
- Upper Deviation Limit: UDL = (d + RFd) / n; d = deviations found; RFd = RF for d deviations at chosen risk.
- Compare UDL to TDR → if UDL ≤ TDR → control effective; if UDL > TDR → control ineffective.
- Finite Population Correction (FPC): n_adj = n / (1 + n/N) for small populations.
- Assumptions: random selection, independent occurrences, stable deviation rate.
- Violation: non-random selection biases results; clustering inflates apparent effectiveness.

## Workflow
1. Define control, population, period, sampling unit (occurrence/transaction).
2. Set TDR based on control risk assessment (lower TDR for higher risk).
3. Set EDR based on walkthroughs, prior year, internal audit results.
4. Choose RoR (5% high-risk, 10% low-risk) and corresponding RF.
5. Compute n = RF / (TDR - EDR); apply FPC if N < 1000.
6. Select sample using random number generator or systematic with random start.
7. Test each selected item for control performance; document pass/fail.
8. Count deviations d; classify root cause (manual error, system, override).
9. Compute UDL = (d + RFd) / n using RFd for actual d at chosen risk.
10. Compare UDL to TDR.
    - IF UDL ≤ TDR THEN control operating effectively; rely on control.
    - IF UDL > TDR THEN control ineffective; do not rely; increase substantive testing.
11. Document conclusion, deviations, root cause, impact on risk assessment.
12. IF deviations indicate fraud or override THEN escalate per SA 240.

## Decision Points
- D1: UDL ≤ TDR? YES → rely on control. NO → do not rely; extend substantive tests.
- D2: Any deviation indicates fraud/override? YES → escalate; consult SA 240. NO → assess as control deficiency.
- D3: Population < 1000 items? YES → apply FPC adjustment. NO → no FPC needed.
- D4: Sample size > N? YES → test 100% of population (census). NO → proceed with sampling.
- D5: Deviations clustered at specific period/user? YES → investigate; consider stratification or 100% of subgroup. NO → treat as random.

## Professional Skepticism Probes
- Are deviations random or systematic in timing, user, or location?
- Did management explain deviations before or after auditor identified them?
- Are walkthrough results consistent with sample test results?
- Has the control changed mid-year; does the sample reflect both periods?
- Are compensating controls operating effectively for failed controls?

## Considerations
- TDR reflects auditor's tolerance for control failure; lower for key controls.
- EDR must be conservative — underestimating inflates sample; overestimating understates risk.
- Sample selection must be genuinely random; systematic acceptable if no periodicity.
- Document population completeness — reconcile to GL, system reports.
- Stratify if population has subgroups with different deviation characteristics.
- Compensating controls may mitigate single control failure.

## Common Risks
- Defining population to exclude known problem areas (scope manipulation).
- Using prior-year EDR without considering current-year changes.
- Sample selection bias toward easily accessible items.
- Misclassifying deviations as isolated errors vs systemic failures.
- Ignoring compensating controls when evaluating failures.

## Fraud Triggers (SA 240)
- Deviations concentrated at period-end or near covenant dates.
- Deviations consistently attributed to same KMP.
- Deviations in controls over journal entries or related party transactions.
- Sample reveals overrides of automated controls.
- Compensating controls also failing — no redundancy.

## Common Pitfalls
- Using TDR without reference to assessed control risk.
- Not adjusting sample size when EDR approaches TDR (sample becomes impractical).
- Treating "no deviation" as control effective without considering sample sufficiency.
- Failing to project deviations to population.
- Not documenting population completeness evidence.

## Validation
- [ ] Population reconciled to GL/system reports (completeness).
- [ ] TDR and EDR documented with rationale.
- [ ] RF selected correctly for chosen risk and expected deviations.
- [ ] Sample size computed per formula; FPC applied if needed.
- [ ] Sample selection method documented (random/systematic with start).
- [ ] UDL computed and compared to TDR; conclusion documented.

## Expected Outputs
- Sample size n with supporting formula.
- List of sample items with test results (pass/deviation).
- Computed UDL; comparison to TDR.
- Conclusion: control effective / ineffective; impact on substantive scope.

## Failure Conditions
- Population cannot be reconciled or is incomplete.
- Sample cannot be selected randomly (system limitations).
- Deviations indicate pervasive control failure across multiple controls.
- Management refuses to provide evidence for selected sample items.

## Escalation Conditions
- UDL > TDR for a key control → STOP, do not rely; increase substantive testing scope.
- Deviations indicate fraud or management override → STOP, SA 240 consultation.
- Sample deviations reveal systematic override of controls → STOP, partner consultation.
- Population defined to exclude problem areas → STOP, redefine population.
