# Time Series and Trend Analysis

## Purpose
Decompose financial data into trend, seasonal, cyclical, and irregular components; predict expected values; identify outliers and anomalies over time.

## Scope
- USE WHEN: Multi-period financial data (monthly/quarterly) to identify trends, seasonality, and anomalies.
- DO NOT USE WHEN: Single-period data; structural breaks without adjustment; non-stationary series without differencing.
- APPLIES TO: Revenue, expenses, working capital, cash flows, production volumes, headcount.

## Audit Objective
- Assertions: Accuracy, Valuation, Completeness, Occurrence (analytical procedures).
- Framework: SA 520 (analytical procedures); SA 315 (risk assessment); SA 570 (going concern).

## Workflow Dependencies
- REQUIRES: Data Profiling, Ratio Analysis, Risk Assessment.
- FEEDS: Substantive Strategy, Going Concern Assessment, Fraud Investigation.

## Required Inputs
- Multi-period time series data (minimum 24 monthly points for seasonality; 36+ for cyclical).
- Frequency: monthly, quarterly, annual (higher frequency preferred).
- Reconciled to GL; cleaned for known structural changes (M&A, accounting policy changes).

## Optional Inputs
- Industry seasonal indices; macroeconomic indicators; prior-year analysis.

## Knowledge
- SA 520.5: Investigate unexpected differences; consider relationships and trends.
- SA 570.16: Going concern — consider trends in financial performance, liquidity, solvency.
- Components: Trend (T), Seasonal (S), Cyclical (C), Irregular (I).
- Additive model assumes independent components; multiplicative assumes interaction.

## Mathematical Foundation
- Components: Trend (T) — long-term direction; Seasonal (S) — periodic fluctuations; Cyclical (C) — business cycle; Irregular (I) — random.
- Additive model: Y = T + S + C + I.
- Multiplicative model: Y = T × S × C × I (use when seasonal variation scales with trend).
- Moving Average (MA): MA_t = (1/k) × Σ Y_{t-i} for i=0 to k-1; smooths short-term fluctuations.
- Centered moving average for even k — average of two consecutive MA.
- Exponential smoothing: F_{t+1} = α × Y_t + (1 - α) × F_t; α = smoothing factor (0 < α < 1); higher α = more weight on recent.
- Compound Annual Growth Rate (CAGR): CAGR = (End Value / Start Value)^(1/n) - 1; n = number of years.
- Z-score outlier: Z = (Y_t - μ) / σ; |Z| > 2 → mild outlier; |Z| > 3 → extreme outlier.
- Seasonal index (ratio-to-moving-average): SI = Y_t / MA_t; average per period across years.
- Deseasonalized value: Y_deseason = Y_t / SI (multiplicative) or Y_t - SI (additive).
- Assumptions: stationarity for many models (constant mean/variance); structural changes identified and adjusted.
- Violation: non-stationary data → spurious trends; structural breaks → invalid inference; insufficient seasonal cycles → unreliable indices.

## Workflow
1. Identify account/variable and obtain multi-period data (≥ 24 months preferred).
2. Reconcile data to GL; document data integrity; adjust for known structural changes.
3. Plot time series — visually inspect trend, seasonality, structural breaks.
4. Decompose into components.
   - IF seasonal amplitude grows with trend THEN use multiplicative.
   - IF seasonal amplitude stable THEN use additive.
5. Compute trend using moving average or least-squares linear trend.
6. Compute seasonal indices using ratio-to-moving-average; verify indices sum to 12 (monthly) or 4 (quarterly).
7. Compute deseasonalized series; identify residual/irregular component.
8. Forecast expected value for current period using trend + seasonal.
9. Compare actual to forecast; compute residual.
10. Identify outliers.
    - IF |Z-score| > 2 THEN investigate specific period.
    - IF residual > PM OR > 2 SE THEN investigate.
11. Investigate outliers — specific transactions, journal entries, business events.
12. Document decomposition, forecast, outliers, investigation, conclusion.

## Decision Points
- D1: Seasonal amplitude scales with trend? YES → multiplicative model. NO → additive model.
- D2: Structural break identified (M&A, policy change)? YES → split series; analyze separately. NO → proceed.
- D3: |Z| > 2 on deseasonalized data? YES → investigate period-specific transactions. NO → within expectation.
- D4: Trend direction consistent with management's narrative? YES → corroborate. NO → investigate divergence.
- D5: Forecast residual > PM? YES → potential misstatement; extend testing. NO → corroborate; reduce testing.

## Professional Skepticism Probes
- Are outliers clustered at year-end, quarter-end, or near covenant dates?
- Has management provided explanations for outliers before auditor identified them?
- Are seasonal indices consistent with prior year and industry?
- Do structural changes documented by management align with operational evidence?
- Is the trend direction consistent with macroeconomic and industry conditions?

## Considerations
- Use longer time series (≥ 36 months) for reliable seasonal estimation.
- Adjust for one-time events (demonetization, COVID, GST rollout) — indicator variables.
- Compare multiple variables' trends — cross-validation (e.g., revenue vs production volume).
- CAGR useful for multi-year comparisons; not for short-term or volatile series.
- Document data source reliability and any manual adjustments.

## Common Risks
- Applying additive model to multiplicative data (or vice versa).
- Insufficient seasonal cycles for reliable indices.
- Not adjusting for structural breaks.
- Treating deseasonalized outliers as errors without investigation.
- Ignoring macroeconomic context in trend interpretation.

## Fraud Triggers (SA 240)
- Outliers clustered at year-end on KMP-initiated transactions.
- Seasonal pattern inconsistent with industry (e.g., no December spike in retail).
- Trend reversal only in audited period without operational change.
- Forecast residuals consistently in management's favour.
- Structural break timing suspiciously aligned with covenant breach.

## Common Pitfalls
- Using CAGR on volatile short-term series.
- Not deseasonalizing before trend analysis.
- Ignoring autocorrelation in residuals.
- Applying linear trend to exponential growth (or vice versa).
- Treating outlier as anomaly without investigating underlying transactions.

## Validation
- [ ] Time series data ≥ 24 months; reconciled to GL.
- [ ] Structural changes identified and adjusted.
- [ ] Decomposition method (additive/multiplicative) justified.
- [ ] Seasonal indices computed; sum check passed.
- [ ] Forecast and residuals computed; outliers identified via Z-score.
- [ ] Significant outliers investigated; conclusion documented.

## Expected Outputs
- Time series plot with trend, seasonal, irregular components.
- Seasonal indices per period; deseasonalized series.
- Forecast for current period; residual vs actual.
- Outlier list (period, Z-score, value) with investigation.
- Conclusion: trend corroborates or contradicts recorded balances.

## Failure Conditions
- Insufficient data points (< 24 months).
- Severe structural breaks without adjustment capability.
- Seasonal indices cannot be reliably estimated.
- Outliers cannot be investigated (data restrictions).

## Escalation Conditions
- Significant outliers indicate fraud or management override → STOP, SA 240 escalation.
- Trend reversal indicates going concern issue → STOP, SA 570 going concern assessment.
- Forecast residual materially exceeds PM → STOP, propose adjustment; partner consultation.
- Seasonal pattern inconsistent with industry without explanation → STOP, investigate.
