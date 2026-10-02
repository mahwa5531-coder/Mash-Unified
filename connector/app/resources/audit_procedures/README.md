# Indian Statutory Audit Skills — Agent-Optimized Library (v3)

A library of **72 audit workflow skills** designed for an autonomous LLM agent (Nexau). Skills cover everything between PBC document collection and audit report signing under Indian statutory audit (Companies Act 2013, SAs, Ind AS).

## Design Philosophy

These skills are NOT textbooks for humans. They are concise, decision-dense instructions that fit in a fraction of the agent's context window and tell it:
- **WHAT to do** — specific audit actions
- **HOW to think** — professional reasoning and judgment
- **WHEN to escalate** — explicit STOP conditions

The agent writes its own code, scripts, and SQL. Skills never include implementation.

## Format — Concise & Imperative

Each skill = **3–8 KB** (average ~6 KB). All 16 mandatory sections, executed as:
- Imperative mood (Test, Verify, Extract, Compute, Document)
- Bullets only — no prose paragraphs
- Nested IF/THEN decision trees
- 8–12 step workflows
- 5–7 professional skepticism probes
- 5–8 fraud triggers with action
- Explicit failure and escalation conditions

## Mandatory 16-Section Structure

```
# [Skill Name]
## Purpose
## Scope
## Audit Objective
## Workflow Dependencies (REQUIRES / FEEDS)
## Required Inputs
## Optional Inputs
## Knowledge
## Workflow
## Decision Points
## Professional Skepticism Probes
## Considerations
## Common Risks
## Fraud Triggers (SA 240)
## Common Pitfalls
## Validation
## Expected Outputs
## Failure Conditions
## Escalation Conditions
```

Mathematical techniques (category 17) add a **Mathematical Foundation** section with formulas in plain text.

## Library Index — 72 Skills Across 17 Categories

| # | Category | Files | Coverage |
|---|----------|-------|----------|
| 01 | Engagement & Planning | 10 | SA 200, 210, 220, 300, 315, 320, 330, 530, 520 |
| 02 | Revenue & Receivables | 4 | Ind AS 115, SA 505, cut-off, returns |
| 03 | Procurement & Payables | 3 | Purchase testing, AP completeness, cut-off |
| 04 | Inventory | 3 | SA 501, Ind AS 2, cut-off |
| 05 | Fixed Assets | 4 | Ind AS 16, 23, 36, Schedule II |
| 06 | Cash & Bank | 3 | SA 505, BRS, cash count |
| 07 | Investments & Financial Instruments | 2 | Ind AS 109, 113, 27, 28, 40 |
| 08 | Borrowings & Finance | 2 | Ind AS 109, 116, FEMA ECB |
| 09 | Equity | 2 | Sec 39–68, reserves |
| 10 | Journal Entries | 1 | SA 240 management override |
| 11 | Payroll & HR | 2 | Ind AS 19, 102, PF/ESI/TDS |
| 12 | Taxation | 3 | IT Act, GST, Ind AS 12 |
| 13 | Provisions & Estimates | 2 | Ind AS 37, SA 540 |
| 14 | Compliance & Related Parties | 3 | SA 250, 550, CARO 2020 |
| 15 | Special Areas | 7 | SA 402, 505, 540, 550, 560, 570, 600 |
| 16 | Completion & Reporting | 5 | SA 220, 230, 450, 580, 700/705/706/710/720 |
| 17 | Mathematical & Statistical Techniques | 16 | SA 530, 520, 240, 540, 620 — with formulas |

**Total: 72 skills**

## DAG — Workflow Dependencies (High Level)

```
[Engagement Acceptance]
        ↓
[Planning + Materiality + Risk Assessment]
        ↓
[Trial Balance Validation] → [Data Profiling] → [Analytical Procedures]
        ↓
┌──────────────────────────────────────────────────────┐
│ EXECUTION (each loop):                               │
│  • Revenue, Receivables                              │
│  • Procurement, Payables                             │
│  • Inventory (Physical, Valuation, Cut-off)          │
│  • Fixed Assets (Additions, Depreciation, CWIP)      │
│  • Cash & Bank (Confirmations, BRS)                  │
│  • Investments, Financial Instruments                │
│  • Borrowings, Finance Costs                        │
│  • Equity, Reserves                                  │
│  • Journal Entry Testing (SA 240)                    │
│  • Payroll, Employee Benefits                        │
│  • Income Tax, GST, Deferred Tax                     │
│  • Provisions, Estimates                             │
│  • Related Parties, Statutory Dues, Cos Act          │
│  • External Confirmations, Group Audits, SOC         │
└──────────────────────────────────────────────────────┘
        ↓
[Sampling & Projection (SA 530)]
        ↓
[Evaluation of Misstatements (SA 450)]
        ↓
[Subsequent Events + Going Concern + Management Letter]
        ↓
[Workpaper Documentation (SA 230)]
        ↓
[Engagement Quality Review (SA 220)]
        ↓
[Audit Conclusion & Reporting (SA 700/705/706/710/720)]
```

## Mathematical Techniques Module (Category 17)

Provides the quantitative methods that underpin conceptual workflows. Each file uses an extended structure with a **Mathematical Foundation** section stating formulas in plain text.

**17A — Statistical Sampling (5)**
- Attribute sampling: `n = RF / (TDR - EDR)`, `UDL = (d + RFd) / n`
- Variables sampling: `n = (RF × σ × N) / (TM - EM)`
- Monetary Unit Sampling: `n = (RF × BV) / (TM - (EM × EF))`, `UML = BP + PM + IA`
- Sample size determination: cross-context formulas + FPC
- Misstatement projection: 4 methods + anomalous errors

**17B — Analytics & Probability (5)**
- Benford's Law: `P(d) = log₁₀(1 + 1/d)`, Chi-square, MAD
- Regression & correlation: `y = a + bx`, R², Durbin-Watson
- Time-series & trend: decomposition, MA, CAGR, Z-score
- Ratio analysis: DuPont, Altman Z-Score
- Audit Risk Model: `AR = IR × CR × DR`, Bayesian updating

**17C — Valuation & Financial Mathematics (6)**
- Materiality quantitative models: benchmarks, PM, group aggregation
- DCF mathematics: FCFF, FCFE, WACC, CAPM, Hamada, Gordon TV
- Effective Interest Rate: EIR solution, amortized cost, 10% modification
- Actuarial math: PUC, DBO, Black-Scholes for ESOPs
- Variance analysis: material/labour/overhead/sales variances
- Fair value: L1/L2/L3 hierarchy, BSM, binomial lattice, Monte Carlo

## Coverage of Standards

- **32 Standards on Auditing** (SA 200–720)
- **28 Companies Act 2013 sections** (incl. 139, 140, 141, 143, 188, 135, 186)
- **22 Ind AS** (incl. 1, 2, 12, 16, 19, 21, 23, 24, 36, 37, 38, 102, 109, 113, 115, 116)
- **All 21 CARO 2020 clauses**
- **IT Act** (40, 43B, 194, 115JB, 269ST/SS/T, 44AB)
- **GST law** (Sec 16, 17(5), 31, RCM, e-invoicing)
- **FEMA** (ECB framework)

## Usage Notes

- Each skill fits in <2K tokens. The agent loads only relevant skills per audit area, not the entire library.
- Skills are stateless — each skill documents its own REQUIRES / FEEDS dependencies for the planner.
- The agent decides implementation (code, scripts) based on inputs and tools available to it.
- Escalation conditions are explicit — agent does not auto-proceed past them.

## Limitations

- Standards evolve — verify against latest ICAI / MCA / CBDT / CBIC pronouncements before relying on specific references.
- Sector-specific overlays (RBI banks, SEBI listed, IRDAI insurance) referenced but not exhaustively documented.
- Skills are methodology guidance, not professional advice. Application requires judgment of a qualified auditor.
