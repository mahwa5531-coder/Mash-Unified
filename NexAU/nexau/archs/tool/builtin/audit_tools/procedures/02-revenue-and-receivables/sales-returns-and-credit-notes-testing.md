# Sales Returns and Credit Notes Testing

## Purpose
Test sales returns and credit notes post year-end to detect channel stuffing, fictitious revenue, and improper cut-off. Verify authorization, classification, and period of reversal per Ind AS 115.

## Scope
- USE WHEN: Every statutory audit with material revenue — presumed fraud risk.
- DO NOT USE WHEN: Revenue immaterial; no history of returns.
- AUDIT AREAS: Sales returns, credit notes, discounts, rebates, channel stuffing reversal.

## Audit Objective
- Assertions: Occurrence, completeness, accuracy, cut-off, classification.
- Framework: Ind AS 115 (variable consideration, refunds), SA 240, SA 530.

## Workflow Dependencies
- REQUIRES: Revenue Recognition Testing, Revenue Cut-Off Testing, Data Profiling.
- FEEDS: Evaluation of Misstatements, AR Confirmation, Audit Reporting.

## Required Inputs
- Sales returns register post year-end (30-60 days).
- Credit notes register post year-end.
- Discount/rebate schemes and approval matrix.
- Customer contracts with return rights.
- Sample of returns and credit notes for vouching.

## Optional Inputs
- Prior-year returns pattern.
- Industry return rates.
- Side letters / off-invoice arrangements.

## Knowledge
- Ind AS 115: Variable consideration — estimate refunds, constrain if highly uncertain.
- SA 240: Post-year-end returns > 5% of related revenue → fraud indicator.
- Sec 143(12): Report fraud ≥ ₹1 crore via Form ADT-4 within 30 days.
- Channel stuffing: Excess sales at year-end reversed via returns — revenue inflation.
- GST: Credit notes adjust output tax (Sec 34) — verify GSTR-1 adjustment.
- Authorization matrix: Credit notes require CFO/director approval per policy.

## Workflow
1. Extract sales returns and credit notes for first 30-60 days post year-end.
2. Profile — total amount, customer concentration, weekly trend.
   - IF spike in first week April → channel stuffing indicator.
3. Match each post-year-end return to original pre-year-end sale.
   - IF return relates to pre-year-end sale → evaluate revenue reversal.
   - IF return relates to post-year-end sale → current year, no reversal.
4. Compute return rate: Total returns (first 30 days) / March revenue.
   - IF return rate > 5% → fraud indicator, extend testing, escalate.
   - IF return rate > 10% → mandatory SA 240 escalation.
5. Sample selection — top 20 returns by value + random sample.
6. For each sampled return:
   - Verify authorization — CFO/director approval per matrix.
   - Verify goods received back (GRN inward).
   - Verify credit note issued to customer.
   - Verify GST adjustment (GSTR-1).
7. Investigate unusual returns:
   - Round-amount returns.
   - Returns from newly incorporated customers.
   - Returns with no goods received (cash refund only).
   - Returns by related parties.
8. Side letters / off-invoice arrangements:
   - Inquire of sales team (not management).
   - IF side letters offering return rights identified → revenue not recognized correctly.
9. Discounts and rebates:
   - Verify accrual per Ind AS 115 (variable consideration).
   - Verify authorization and matching to scheme.
   - IF discounts > 5% of revenue → detailed testing.
10. Channel stuffing indicators:
    - Last-week-March sales followed by April returns.
    - Customer inventory buildup without end-customer demand.
    - Extended payment terms with return rights.
11. Evaluate exceptions:
    - Classify factual (period incorrect), projected, anomalous.
    - Project per SA 530.
12. Conclude on revenue recognition — request management adjustment if material.

## Decision Points
- D1: Post-year-end return rate > 5%? YES → fraud indicator, extend testing, SA 240 escalation. NO → standard.
- D2: Return relates to pre-year-end sale? YES → revenue reversal required. NO → current year.
- D3: Authorization obtained per matrix? YES → accept. NO → exception, control deficiency.
- D4: Goods received back (GRN)? YES → genuine return. NO → cash refund, investigate.
- D5: Side letters identified? YES → revenue recognition reassessment, potential reversal. NO → standard.
- D6: Returns > 10% of March revenue? YES → mandatory SA 240 escalation, consider Sec 143(12). NO → document.

## Professional Skepticism Probes
- Why spike in April returns — genuine or channel stuffing?
- Are returns from new customers at year-end — fictitious sales reversed?
- Are credit notes authorized, or backdated by sales team?
- Are goods genuinely received back, or only cash refund?
- Are side letters offering return rights concealed?
- Do related parties return goods at non-arm's length?
- Why discounts spike at year-end — genuine or revenue inflation offset?

## Considerations
- Return rate benchmark: Industry-specific; compare to peers.
- Seasonality: Adjust for seasonal patterns (e.g., festival returns).
- Related parties: Sec 188 approval, Ind AS 24 disclosure.
- GST: Sec 34 — credit notes adjust output tax within specified time.
- Channel stuffing: Especially in FMCG, pharma, electronics, distributor-based.
- Side letters: Common in B2B contracts — inquire independently.

## Common Risks
- Channel stuffing — fictitious year-end sales reversed via returns.
- Unauthorized credit notes — control override.
- Cash refunds without goods receipt — revenue reversal not recorded.
- Side letters offering return rights — revenue not properly recognized.
- Discount accrual insufficient — variable consideration not estimated.
- GST not adjusted for credit notes — compliance failure.

## Fraud Triggers (SA 240)
- Post-year-end returns > 5% of March revenue.
- Returns spike in first week April — channel stuffing.
- Round-amount returns.
- Returns from newly incorporated customers.
- Cash refunds without goods receipt.
- Side letters offering return rights.
- Returns by related parties at non-arm's length.

## Common Pitfalls
- Not testing post-year-end returns.
- Treating all returns as current year without matching to original sale.
- Not checking goods received back.
- Skipping side letter inquiry.
- Not extending sample when return rate exceeds 5%.

## Validation
- [ ] Post-year-end returns extracted (30-60 days).
- [ ] Return rate computed vs March revenue.
- [ ] Each return matched to original sale (pre vs post year-end).
- [ ] Sample vouched — authorization, GRN inward, credit note, GST adjustment.
- [ ] Side letters inquiry performed.
- [ ] Discount/rebate accrual tested per Ind AS 115.
- [ ] Channel stuffing indicators assessed.
- [ ] Exceptions projected per SA 530.

## Expected Outputs
- Sales returns and credit notes analysis (return rate, customer concentration).
- Matching schedule (return to original sale).
- Sample vouching summary.
- Side letter inquiry documentation.
- Discount/rebate accrual testing memo.
- Channel stuffing assessment memo.
- Exception summary with classification and projection.
- Conclusion on revenue recognition impact.

## Failure Conditions
- Returns register not available.
- Goods receipt notes for returns not maintained.
- Customer contracts / side letters not provided.

## Escalation Conditions
- Return rate > 10% of March revenue → STOP, trigger SA 240 fraud workflow, consider Sec 143(12).
- Side letters identified offering return rights → STOP, revenue reassessment, partner consultation.
- Channel stuffing evidence → STOP, trigger SA 240, escalate to EQCR.
- Unauthorized credit notes by KMP → STOP, override risk, escalate.
