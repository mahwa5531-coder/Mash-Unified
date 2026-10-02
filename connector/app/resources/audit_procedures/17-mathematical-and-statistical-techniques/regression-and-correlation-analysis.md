# Regression and Correlation Analysis

## Purpose
Quantify relationships between variables, predict expected values, and identify outliers in financial data for substantive analytical procedures.

## Scope
- USE WHEN: Predicting account balances from driver(s); validating reasonableness of expenses/revenue; identifying unusual period-end balances.
- DO NOT USE WHEN: Insufficient data points (< 30); non-linear relationships without transformation; spurious correlations without economic logic.
- APPLIES TO: Revenue vs units sold, Interest expense vs debt, Payroll vs headcount, Travel expense vs revenue, Inventory vs COGS.

## Audit Objective
- Assertions: Accuracy, Valuation, Completeness (substantive analytical procedures).
- Framework: SA 520 (analytical procedures); SA 315 (risk assessment).

## Workflow Dependencies
- REQUIRES: Data Profiling, Ratio Analysis, Risk Assessment.
- FEEDS: Substantive Testing Strategy, Audit Conclusion, Estimates Testing.

## Required Inputs
- Dependent variable (y) — account balance/amount being predicted.
- Independent variable(s) (x) — driver(s) with economic relationship to y.
- Sufficient data points (monthly periods, locations, segments); minimum 30 for valid inference.

## Optional Inputs
- Prior-year regression results; industry benchmarks; segment-level data.

## Knowledge
- SA 520.5: Substantive analytical procedures include consideration of relationships and trend investigation.
- SA 520.A15-A18: Expect prediction model reliable; consider predictability and source reliability.
- Correlation does not imply causation — require economic logic for driver.
- Outliers may indicate errors, fraud, or genuine business changes.

## Mathematical Foundation
- Model: Linear regression y = a + bx; b = slope; a = intercept.
- Slope: b = Σ[(xi - x̄)(yi - ȳ)] / Σ(xi - x̄)²; x̄, ȳ = means of x and y.
- Intercept: a = ȳ - b × x̄.
- Correlation coefficient: r = Σ[(xi - x̄)(yi - ȳ)] / √[Σ(xi - x̄)² × Σ(yi - ȳ)²]; r ∈ [-1, 1].
- Coefficient of determination: R² = r²; proportion of variance in y explained by x.
- Standard error: SE = √[Σ(yi - ŷi)² / (n - 2)]; ŷi = predicted value.
- Prediction confidence interval: ŷp ± t × SE × √[1 + 1/n + (xp - x̄)² / Σ(xi - x̄)²]; t = t-statistic at chosen confidence, df = n-2.
- Residual: e_i = yi - ŷi.
- Assumptions: linearity (relationship); independence (Durbin-Watson DW ≈ 2); homoscedasticity (constant variance); normality of residuals.
- Violation: non-linearity → transform or use non-linear model; autocorrelation (DW < 1 or > 3) → unreliable SE; heteroscedasticity → biased SE; non-normal residuals in small samples → use non-parametric alternatives.
- Investigate if |residual| > performance materiality OR |residual| > 2 SE.

## Workflow
1. Identify dependent variable (account) and driver(s) with economic logic.
2. Collect paired data (≥ 30 points); reconcile to GL; clean outliers (genuine vs errors).
3. Plot scatter — visually inspect linearity.
   - IF non-linear THEN transform (log, square root) OR use non-linear model.
4. Compute slope b, intercept a; derive regression equation y = a + bx.
5. Compute correlation r, R², standard error SE.
6. Check regression assumptions:
   - Durbin-Watson statistic — IF DW < 1 or > 3 THEN autocorrelation; consider alternative model.
   - Plot residuals vs predicted — IF pattern THEN heteroscedasticity; transform or weighted least squares.
   - Normality of residuals — IF severe skew with small n THEN caution.
7. Predict expected y for current period using actual x.
8. Compute residual = actual y - predicted y.
9. Compare |residual| to thresholds.
   - IF |residual| > PM OR |residual| > 2 SE THEN investigate.
   - IF |residual| within tolerance AND R² acceptable THEN corroboration achieved.
10. Investigate significant residuals:
    - Identify specific transactions/periods driving variance.
    - Corroborate with documentation; assess misstatement or business change.
11. IF model unreliable (low R², violated assumptions) THEN do not use as substantive evidence; use alternative procedures.
12. Document model, inputs, results, residual analysis, conclusion.

## Decision Points
- D1: Economic logic for driver exists? YES → proceed. NO → do not use; spurious correlation risk.
- D2: R² ≥ 0.70 (acceptable fit)? YES → use for substantive analytical. NO → augment with other procedures or discard.
- D3: Assumptions met (linearity, independence, homoscedasticity, normality)? YES → proceed. NO → transform or use alternative.
- D4: |residual| > PM OR > 2 SE? YES → investigate specific transactions. NO → corroborate; reduce substantive testing.
- D5: Residual explained by genuine business change? YES → document; consider model update. NO → potential misstatement; propose adjustment.

## Professional Skepticism Probes
- Is the regression result consistent with management's explanations for variance?
- Have outliers been excluded without documentation (cherry-picking)?
- Is the driver chosen by management or independently identified?
- Are residuals clustered at year-end or near covenant dates?
- Has the model been re-fit on a subset to mask anomalies?

## Considerations
- Multi-variable regression (multiple drivers) increases explanatory power; document each driver's economic logic.
- Use lagged drivers (e.g., prior month's activity) when current-period driver lags effect.
- Industry-specific drivers: units sold, headcount, capacity utilization, commodity price.
- R² alone insufficient — check residual patterns and predictive accuracy.
- Time series autocorrelation is common — DW test mandatory.

## Common Risks
- Spurious correlation — high R² without economic causation.
- Overfitting with too many drivers relative to data points.
- Excluding outliers without investigation (data mining).
- Applying regression when assumptions violated.
- Treating regression prediction as precise without considering SE.

## Fraud Triggers (SA 240)
- Residuals concentrate at year-end on KMP-initiated transactions.
- Management proposes specific driver that yields low residual (model manipulation).
- Outliers in related-party transactions or related entities.
- Residuals consistently in management's favour (earnings management).
- Regression model changes from prior year without rationale.

## Common Pitfalls
- Not testing regression assumptions (DW, residual plots).
- Using prediction as single source of evidence without corroboration.
- Conflating correlation with causation.
- Ignoring SE in determining acceptable residual range.
- Applying to non-linear relationships without transformation.

## Validation
- [ ] Driver(s) have documented economic logic.
- [ ] Data points ≥ 30; reconciled to GL.
- [ ] Regression equation, R², SE, DW computed.
- [ ] Assumptions tested (linearity, independence, homoscedasticity, normality).
- [ ] Residuals computed and compared to PM / 2 SE thresholds.
- [ ] Significant residuals investigated; conclusion documented.

## Expected Outputs
- Regression equation y = a + bx with coefficients.
- R², SE, correlation r, Durbin-Watson statistic.
- Predicted vs actual y for current period; residuals.
- Investigation of significant residuals; conclusion on misstatement.
- Substantive evidence conclusion (corroborated / not corroborated).

## Failure Conditions
- Insufficient data points (< 30).
- Driver lacks economic logic.
- Regression assumptions severely violated; model unreliable.
- Residuals cannot be explained or investigated.

## Escalation Conditions
- Significant residuals indicate material misstatement → STOP, propose adjustment; partner consultation.
- Residuals indicate fraud or override → STOP, SA 240 escalation.
- Regression assumptions violated; model cannot be relied upon → STOP, switch to tests of detail.
- Management refuses to provide data for residual investigation → STOP, scope limitation.
