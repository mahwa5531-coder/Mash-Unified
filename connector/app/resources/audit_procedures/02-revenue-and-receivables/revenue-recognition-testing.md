# Revenue Recognition Testing

## Purpose
Verify revenue is recognized per Ind AS 115 in correct period and amount. Detect fictitious or premature revenue — SA 240 presumed fraud risk.

## Scope
- USE WHEN: Auditing revenue under Ind AS for any reporting period.
- DO NOT USE WHEN: Revenue below performance materiality.
- AUDIT AREAS: Sale of goods, services, long-term contracts, bundled arrangements, principal-agent.

## Audit Objective
- Assertions: Occurrence, Completeness, Accuracy, Cut-off, Presentation & Disclosure.
- Framework: Ind AS 115 (5-step model), SA 240, SA 540.

## Workflow Dependencies
- REQUIRES: Trial Balance Validation, Risk Assessment, Materiality, Data Profiling.
- FEEDS: AR Confirmation, Evaluation of Misstatements, Audit Reporting.

## Required Inputs
- GL: revenue, receivables, returns, discounts.
- Sales register, invoices, GRN, lorry receipts, e-way bills.
- Customer contracts (non-standard terms especially).
- Post-year-end returns and credit notes (30-60 days).

## Optional Inputs
- Prior year working papers, industry seasonality, budget-vs-actual.

## Knowledge
- Ind AS 115 5-step: identify contract → identify POs → determine TP → allocate TP → recognize on satisfaction.
- SA 240: Revenue is presumed fraud risk — mandatory brainstorming.
- GST Sec 31 + e-invoicing: Reconcile GSTR-1 vs revenue ledger.
- Long-term contracts: POC method (cost-to-cost or output).
- Sec 143(12): Report fraud ≥ ₹1 crore via Form ADT-4 within 30 days.

## Workflow
1. Profile revenue population — extract weekly trend; flag last-week-of-March spike and first-week-of-April reversal.
2. Apply 5-step model to significant contracts:
   - IF variable consideration → test estimation + constraint under SA 540.
   - IF multiple POs → test standalone selling price allocation.
   - IF principal vs agent → test control over goods before transfer.
3. Cut-off testing (mandatory): last 20 sales pre-year-end + first 20 post.
   - Vouch to dispatch docs + shipping terms (FOB/CIF).
   - IF dispatched pre-year-end but invoiced post → confirm period.
4. Long-term contracts (if any): re-compute POC; IF variance > PM → investigate.
5. Returns/credit notes post-year-end:
   - IF return relates to pre-year-end sale → evaluate reversal.
   - IF returns > 5% of related revenue → fraud indicator.
6. Analytical procedures: YoY monthly revenue, gross margin trend; investigate variance > PM or > 3 ppt margin shift.
7. Sample selection: MUS for high-value; attribute for controls.
8. Vouch sample: contract → PO → invoice → GRN/dispatch → payment.
9. Evaluate exceptions: classify factual/projected/anomalous; project per SA 530.
10. Conclude: Does revenue give true and fair view? Document rationale.

## Decision Points
- D1: Revenue significant risk? YES → mandatory SA 240 response, larger sample, mandatory cut-off. NO → standard procedures.
- D2: Long-term contracts present? YES → POC testing mandatory. NO → skip step 4.
- D3: Variable consideration material? YES → SA 540 estimation testing. NO → skip.
- D4: Post-year-end returns > 5%? YES → fraud risk, extend sample, evaluate Sec 143(12). NO → document.

## Professional Skepticism Probes
- Why last-week-March spike? Genuine or channel stuffing?
- Side letters offering price protection/return rights/extended terms?
- Bill-and-hold? Customer has capacity to take delivery?
- Related-party sales at arm's length? Sec 188 approval?
- Gross margin on year-end sales consistent with year average?
- Round-amount invoices or sequential numbering across unrelated customers?
- Have I read the actual contract — not just the invoice?

## Considerations
- Materiality: PM to revenue; specific materiality to RPT revenue.
- Risk: Revenue is always significant — minimum sample applies.
- Seasonality: Widen cut-off window for seasonal businesses.
- Related parties: Cross-reference SA 550 workflow.
- Regulatory: GST vs books reconciliation mandatory for material revenue.

## Common Risks
- Cut-off manipulation — most common revenue fraud.
- POC manipulation in long-term contracts.
- Fictitious sales to related parties or new customers.
- Premature recognition before transfer of control.
- Improper principal vs agent classification inflating revenue.

## Fraud Triggers (SA 240)
- Revenue spike in last 2 weeks of March without proportional cost increase.
- Post-year-end credit notes > 5% of related revenue.
- Sales to newly incorporated customers with no business history.
- Round-amount invoices or sequential numbering across unrelated customers.
- Missing or backdated dispatch documents.
- RPT at non-arm's length without Sec 188 approval.
- Manual JE to revenue near year-end.
- Customer confirmation exceptions not investigated.

## Common Pitfalls
- Testing revenue without cut-off testing.
- Accepting "goods dispatched" without checking shipping terms.
- Ignoring long-term contracts — POC manipulation.
- Treating bundled contracts as single PO.
- Relying on invoice description, not contract.
- Sampling before profiling — misses year-end concentration.

## Validation
- [ ] Cut-off tested (last 20 + first 20).
- [ ] 5-step model applied to significant contracts.
- [ ] Long-term contracts POC re-computed.
- [ ] Post-year-end returns analyzed.
- [ ] Sample projected per SA 530.
- [ ] SA 240 brainstorming documented.

## Expected Outputs
- Revenue testing workpaper with sample, vouching, exceptions, projection, conclusion.
- Cut-off testing schedule.
- Long-term contract POC re-computation.
- Exception summary with classification.
- Professional conclusion: revenue recognized per Ind AS 115.

## Failure Conditions
- Missing dispatch documents for material sales.
- Customer contracts unavailable.
- GL cannot reconcile to TB.
- Management refuses post-year-end returns data → scope limitation.

## Escalation Conditions
- Fraud indicators → STOP, trigger SA 240 fraud workflow, consider Sec 143(12).
- Cut-off exceptions > 10% of sample → extend sample, escalate to engagement partner.
- Long-term contract POC variance > 20% → engage expert under SA 620.
- Management override identified → STOP, escalate to EQCR.
- RPT at non-arm's length without Sec 188 approval → escalate, consider qualification.
