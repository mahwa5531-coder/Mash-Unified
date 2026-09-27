# Service Organization Controls

## Purpose
Evaluate service organisation controls impact on user entity financial statements; obtain and assess SOC 1 / ISAE 3402 reports per SA 402.

## Scope
- USE WHEN: Entity uses service organisations — IT outsourcing, BPO, shared service centres, payroll vendors, cloud hosting, custodians.
- DO NOT USE WHEN: Service performed is immaterial; user entity retains full control of relevant processes.
- AUDIT AREAS: Outsourced IT, BPO, shared services, payroll, cloud hosting, custodian services.

## Audit Objective
- Assertions: Completeness, accuracy, occurrence, cutoff — for processes performed by service organisation.
- Framework: SA 402; SA 315; SA 330; SA 500; Sec 143.

## Workflow Dependencies
- REQUIRES: Risk Assessment, IT General Controls Testing, Substantive Testing of Affected Areas.
- FEEDS: Audit Conclusion, Audit Reporting, Controls Reliance Conclusion.

## Required Inputs
- List of service organisations used; services performed; contracts / SLAs.
- SOC 1 (Type 1 / Type 2) or ISAE 3402 report covering user entity's period.
- Complementary user entity controls (CUECs) listed in SOC report.
- User control environment documentation; reconciliations between user entity and service organisation.

## Optional Inputs
- Prior-year SOC report; independent assurance on service organisation; vendor due diligence.

## Knowledge
- SA 402.6: Understand services including relevant controls and their effect on user entity's internal control.
- SA 402.9: Obtain type of report — Type 1 (design at point in time) vs Type 2 (design + operating effectiveness over period).
- SA 402.10: Evaluate effect of service organisation's controls on user entity's risk assessment.
- SA 402.11: Type 2 report — evaluate design and operating effectiveness; consider CUECs.
- SA 402.13: If report insufficient → request modified scope or perform alternative procedures / visit service organisation.

## Workflow
1. Identify service organisations used — IT (cloud, application management), BPO (transaction processing), shared services, payroll, custodian, fund accounting.
2. Assess materiality of services to user entity's FS — IF services affect material account balances / disclosures THEN evaluate SOC report; IF confined to immaterial processes THEN document conclusion; minimal procedures.
3. Obtain SOC 1 / ISAE 3402 report — Type 1 (design only) limited value; Type 2 (operating effectiveness over period) preferred; IF report period does not cover user entity's reporting period THEN request bridge letter or alternative.
4. Evaluate report scope and criteria — verify report covers relevant control objectives; assess criteria used.
5. Assess service organisation's controls — evaluate design and operating effectiveness (Type 2); identify exceptions / qualified opinion in report.
6. Identify complementary user entity controls (CUECs) — list CUECs from report; verify user entity has implemented CUECs.
7. Test CUECs at user entity — test reconciliation between user entity and service organisation; review exception reports; access controls.
8. Test user entity's oversight — verify SLA monitoring; periodic vendor review; risk assessment of service organisation.
9. Evaluate exceptions in SOC report — IF exceptions noted THEN assess impact on user entity's controls; perform compensating procedures.
10. Assess subservice organisations — IF service organisation uses subservice THEN obtain inclusive vs carve-out report; evaluate impact.
11. Visit service organisation (if necessary) — IF report insufficient / unavailable / exceptions pervasive THEN consider site visit or alternative procedures.
12. Conclude on sufficiency of evidence — IF CUECs not implemented or service organisation controls weak THEN extend substantive procedures. Document evaluation and impact on audit opinion; communicate to TCWG if material control deficiencies.

## Decision Points
- D1: Services material to user entity's FS? YES → obtain SOC report. NO → document minimal procedures.
- D2: Type 2 report available covering reporting period? YES → evaluate design + effectiveness. NO → request bridge letter / alternative.
- D3: SOC report qualified / exceptions noted? YES → assess impact; perform compensating procedures. NO → rely on report.
- D4: CUECs identified and implemented at user entity? YES → test CUECs. NO → extend substantive procedures.
- D5: Subservice organisation involved? YES → assess inclusive vs carve-out; obtain additional report if needed. NO → proceed.

## Professional Skepticism Probes
- Is SOC report from a reputable independent auditor?
- Does report cover all relevant control objectives for user entity's processes?
- Are CUECs genuinely implemented at user entity, or documented only?
- Are exceptions in SOC report assessed for impact, or dismissed?
- Is subservice organisation identified and covered?

## Considerations
- Type 1 report: design at point in time — does not support operating effectiveness reliance.
- Type 2 report: design + operating effectiveness over period — preferred.
- Bridge letter: covers gap between SOC report period end and user entity year-end.
- CUECs: must be tested at user entity; failing CUECs negates service organisation controls.
- Subservice organisations: inclusive method (covered in main report) vs carve-out (excluded; user obtains separately).

## Common Risks
- Type 1 report relied upon as if Type 2.
- Report period gap not bridged (no bridge letter).
- CUECs identified but not tested at user entity.
- Exceptions in SOC report not assessed for impact.
- Subservice organisation excluded (carve-out) without alternative procedures.

## Fraud Triggers (SA 240)
- SOC report from related-party auditor of service organisation.
- CUECs reported as implemented but evidence missing.
- Exceptions in SOC report involving management override at service organisation.
- Service organisation controlled by related party without disclosure.
- Subservice organisation concealed to avoid review.

## Common Pitfalls
- Accepting Type 1 report as sufficient for operating effectiveness reliance.
- Not verifying report period covers user entity's reporting period.
- Not testing CUECs at user entity.
- Dismissing SOC report exceptions without impact assessment.
- Missing subservice organisation coverage.

## Validation
- [ ] Service organisations identified; materiality assessed.
- [ ] SOC 1 / ISAE 3402 report obtained (Type 2 preferred); report period verified.
- [ ] Control objectives evaluated; exceptions assessed.
- [ ] CUECs identified and tested at user entity.
- [ ] Subservice organisations covered (inclusive / carve-out alternative).

## Expected Outputs
- Service organisation controls evaluation master working paper.
- SOC report evaluation memo (scope, criteria, period, exceptions).
- CUECs identification and testing memo.
- Subservice organisation memo (inclusive / carve-out).

## Failure Conditions
- SOC report unavailable; service organisation refuses to provide.
- CUECs not implemented; no compensating controls.
- Subservice organisation excluded without alternative procedures.

## Escalation Conditions
- SOC report qualified with pervasive exceptions → STOP, extend substantive procedures, partner consultation.
- Service organisation controlled by undisclosed related party → STOP, SA 240 + SA 550, partner consultation.
- CUECs not implemented and substantive procedures insufficient → STOP, scope limitation (SA 705).
- Cloud hosting risk (data residency, access, segregation) pervasive → STOP, partner consultation, possibly modify opinion.
