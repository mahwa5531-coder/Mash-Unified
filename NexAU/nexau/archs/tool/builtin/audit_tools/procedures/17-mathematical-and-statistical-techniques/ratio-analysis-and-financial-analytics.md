# Ratio Analysis and Financial Analytics

## Purpose
Compute and interpret financial ratios across liquidity, profitability, efficiency, leverage dimensions; benchmark against history and industry; flag risks requiring audit response.

## Scope
- USE WHEN: Every statutory audit — analytical procedures in planning and overall review (SA 520, SA 315).
- DO NOT USE WHEN: Standalone statements of newly incorporated entity without comparatives; pure immaterial subsidiary.
- APPLIES TO: Balance sheet, P&L, cash flow; planning risk assessment; going concern; final review.

## Audit Objective
- Assertions: All assertions — ratios inform risk across valuation, existence, completeness, presentation.
- Framework: SA 520 (analytical procedures); SA 315 (risk assessment); SA 570 (going concern).

## Workflow Dependencies
- REQUIRES: Trial Balance Validation, Materiality Determination, Prior-year Financials.
- FEEDS: Risk Assessment, Substantive Strategy, Going Concern Assessment, Audit Conclusion.

## Required Inputs
- Current and prior-year audited financial statements.
- Industry benchmark data (RBI, CRISIL, industry associations, peer companies).
- Management accounts; budget/forecast; segment data.

## Optional Inputs
- Quarterly results; analyst reports; sector-specific KPIs (ARPU for telecom, same-store sales for retail).

## Knowledge
- SA 315.18: Use analytical procedures as risk assessment; consider unusual ratios.
- SA 520.4-5: Substantive analytical procedures require reliable expectation and corroboration.
- SA 570.16: Going concern — assess liquidity, solvency, financial flexibility ratios.
- Single ratio in isolation is uninformative — trend and peer benchmark required.
- Indian context: consider RBI norms, SEBI LODR, sector-specific metrics.

## Mathematical Foundation
- Liquidity: Current = CA/CL (≥1.5 healthy); Quick = (CA-Inventory)/CL (≥1.0); Cash = Cash/CL.
- Profitability: Gross Margin = (Rev-COGS)/Rev; Operating Margin = EBIT/Rev; Net Margin = PAT/Rev.
- Returns: ROE = PAT/Avg Net Worth; ROCE = EBIT/(Avg Debt+Avg Equity); ROA = PAT/Avg Total Assets.
- Efficiency: Inventory Days = (Inv×365)/COGS; Receivables Days = (TR×365)/Rev; Payables Days = (TP×365)/Purchases; Asset Turnover = Rev/Avg Total Assets.
- Leverage: D/E = Total Debt/Net Worth; Interest Coverage = EBIT/Interest (≥2.0); DSCR = (EBITDA-Capex-Tax)/(Interest+Principal) (≥1.25 covenant).
- DuPont: ROE = Net Margin × Asset Turnover × Equity Multiplier; Equity Multiplier = Avg Assets/Avg Equity.
- Altman Z-Score (mfg): Z = 1.2×X1+1.4×X2+3.3×X3+0.6×X4+1.0×X5.
  - X1=WC/TA; X2=RE/TA; X3=EBIT/TA; X4=MV Equity/BV Liabilities; X5=Sales/TA.
  - Z > 2.99 safe; 1.81-2.99 grey; < 1.81 distress.
- Assumptions: financials comparable; peer data reliable; no material one-time items.
- Violation: differing accounting policies across peers; one-time items; non-recurrent transactions distort ratios.

## Workflow
1. Obtain current and prior-year financials; verify TB reconciliation and consistency.
2. Compute ratios across all four dimensions; compute YoY change.
3. Compute DuPont decomposition for ROE.
4. Compute Altman Z-Score for distress assessment.
5. Benchmark against:
   - Prior year (trend).
   - Industry peers / sector averages.
   - Management budget/forecast.
6. Identify ratios with significant deviation (> 10% YoY change or > industry median ± 1 std dev).
7. For each flagged ratio, identify driver — numerator or denominator.
8. Investigate flagged ratios:
   - IF liquidity ratios deteriorating THEN going concern concern; SA 570.
   - IF profitability margins declining contrary to industry THEN revenue recognition or expense classification risk.
   - IF receivables days extending THEN ECL/valuation risk.
   - IF inventory days extending then obsolescence / NRV risk.
   - IF D/E rising or interest coverage falling THEN covenant compliance; going concern.
9. Corroborate ratio findings with substantive testing plans; revise risk assessment.
10. Document ratio table, benchmarks, deviations, investigations, conclusions.
11. Cross-validate ratios with cash flow statement — quality of earnings assessment.
12. Summarize key ratio risks in audit strategy memorandum.

## Decision Points
- D1: Ratio deviation > 10% YoY OR > 1 std dev from peer median? YES → investigate. NO → corroboration.
- D2: Liquidity ratios deteriorating materially? YES → SA 570 going concern assessment. NO → continue.
- D3: Profitability deviating from industry trend? YES → revenue/expense testing focus. NO → corroborate.
- D4: Z-Score < 1.81? YES → going concern risk; convene going concern assessment. NO → continue.
- D5: DSCR or interest coverage below covenant threshold? YES → covenant compliance testing; going concern. NO → continue.

## Professional Skepticism Probes
- Are ratio improvements driven by genuine performance or accounting choices?
- Are one-time items excluded from ratios but material to current year?
- Has management changed accounting policies affecting comparability?
- Are segment-level ratios consistent with consolidated view?
- Do cash flow ratios corroborate accrual-based ratios?

## Considerations
- Use averages for balance sheet items (opening + closing / 2) for income-statement denominator.
- Adjust for one-time items, accounting policy changes, prior-period errors.
- Industry context matters — D/E of 3:1 normal in infra, distress in IT services.
- Indian sectoral context: NBFCs (CAR, NPA), Banks (PCR, GNPA), Infra (D/E, AR days).

## Common Risks
- Comparing ratios across entities with different accounting policies.
- Ignoring one-time items distorting ratios.
- Relying on management-provided benchmarks without independent verification.
- Focusing on absolute levels without trend analysis.

## Fraud Triggers (SA 240)
- Margins improving contrary to industry without operational change.
- Receivables growing faster than revenue (channel stuffing).
- Debt ratios improving just before covenant breach through JE manipulation.
- Z-Score deterioration masked by aggressive revenue recognition.

## Common Pitfalls
- Treating ratio analysis as formality without investigation of deviations.
- Using point-in-time balance sheet items with period-flow denominators without averaging.
- Comparing to inappropriate peers (size, sector, geography mismatch).
- Ignoring qualitative factors despite strong ratios.

## Validation
- [ ] Ratios computed across liquidity, profitability, efficiency, leverage.
- [ ] DuPont decomposition and Z-Score computed.
- [ ] Benchmarks (prior year, peers, budget) documented.
- [ ] Deviations > 10% YoY or > 1 std dev from peer investigated.
- [ ] Cross-validation with cash flow ratios performed.
- [ ] Conclusions documented and integrated with risk assessment.

## Expected Outputs
- Ratio table (current, prior, YoY change, industry, deviation).
- DuPont decomposition; Altman Z-Score with classification.
- Investigation memos for flagged ratios (driver, transactions, conclusion).
- Risk assessment update; substantive testing focus areas.
- Going concern implication if liquidity/solvency ratios deteriorating.

## Failure Conditions
- Financials not reconciled to TB; comparability issues.
- Industry benchmark data unavailable or unreliable.
- Significant one-time items distorting ratios; cannot adjust.
- Segment-level data unavailable for diversified entity.

## Escalation Conditions
- Z-Score < 1.81 OR liquidity ratios critical → STOP, SA 570 going concern convene.
- Ratio deviations indicate fraud → STOP, SA 240 escalation.
- Covenant breach (DSCR, D/E) → STOP, going concern; legal correspondence review.
- Disagreement with management on ratio interpretation → STOP, partner consultation.
