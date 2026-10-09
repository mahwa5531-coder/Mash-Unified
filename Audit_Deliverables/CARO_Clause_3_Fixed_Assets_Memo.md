# AUDIT WORKING PAPER: CARO 2020 CLAUSE 3(i) & SCHEDULE II COMPLIANCE

**Client:** Apex Industries Limited  
**Period Under Audit:** FY 2024–25 (April 1, 2024 – March 31, 2025)  
**Engagement Type:** Statutory Audit under Section 143 of the Companies Act, 2013  
**Working Paper Ref:** `WP-FA-2025-01`  
**Prepared By:** MASH Autonomous Audit Agent  
**Review Status:** `Ready for Partner Review`  

---

### 1. Objective & Statutory Scope

The objective of this substantive testing procedure is to verify compliance with:
1. **Companies (Auditor's Report) Order, 2020 (CARO 2020) — Clause 3(i)(a) to (e)** regarding maintenance of proper records, physical verification, title deeds of immovable properties, and non-revaluation.
2. **Schedule II to the Companies Act, 2013** regarding the determination of useful lives, residual values (capped at 5%), and statutory depreciation recalculation under the Straight Line Method (SLM).

---

### 2. Vouching Methodology & Materiality

- **Planning Materiality:** ₹ 15,00,000 (0.5% of Revenue)
- **Tolerable Misstatement:** ₹ 10,00,000
- **Sampling Strategy:** 100% substantive recalculation of all Fixed Asset Register items exceeding ₹ 5,00,000 capitalised cost.
- **Data Examined:** `FAR_Fixed_Assets_2025.xlsx` (342 asset line items) reconciled against statutory asset categories in `Schedule_II_Companies_Act_2013.pdf`.

---

### 3. Reconciled Depreciation Variance Schedule

> [WARNING] MATERIAL DEPRECIATION VARIANCE DETECTED  
> Plant & Machinery asset **FA-PM-1042** (CNC 5-Axis Milling Unit - Line 1) has been depreciated using an adopted useful life of **20 years** instead of the statutory prescribed limit of **15 years** under Schedule II Class 4, without technical justification or valuer certification. This has resulted in a cumulative under-provisioning of depreciation amounting to **₹ 37,50,000**.  
> — § CARO 2020 Clause 3(i)(a) & Ind AS 16.35

#### Summary of Audit Findings by Asset Class

| Asset Category | Gross Block (INR) | Useful Life (Adopted) | Useful Life (Schedule II) | Recorded Book Dep (INR) | Statutory SLM Dep (INR) | Net Variance (INR) | Audit Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Plant & Machinery** | 4,90,00,000 | 20 Years | 15 Years | 27,28,333 | 31,03,333 | **+37,50,000** | [EXCEPTION] |
| **Computer Hardware & IT** | 65,00,000 | 3 Years | 3 Years | 20,58,333 | 20,58,333 | **0** | [COMPLIANT] |
| **Factory Buildings & Sheds** | 4,50,00,000 | 30 Years | 30 Years | 14,25,000 | 14,25,000 | **0** | [COMPLIANT] |
| **Office Equipment & HVAC** | 92,00,000 | 15 Years | 15 Years | 5,82,667 | 5,82,667 | **0** | [COMPLIANT] |
| **TOTAL AUDITED PORTFOLIO** | **10,97,00,000** | — | — | **67,94,333** | **71,69,333** | **+37,50,000** | **[ADJUSTING ENTRY REQUIRED]** |

*Source Reference:* `Audit_Deliverables/Reconciled_FAR_Schedule_II.xlsx#Audit_Adjustments` (Cell J2: `=H2-I2`)

---

### 4. Recommended Statutory Audit Adjusting Entry

To prevent material misstatement in the Statement of Profit and Loss for the year ended March 31, 2025, the following adjusting entry is proposed for management representation:

```text
Debit:  Depreciation & Amortisation Expense (P&L)      INR 37,50,000
Credit: Accumulated Depreciation - Plant & Machinery  INR 37,50,000
(Being adjusting entry for under-provisioned depreciation on CNC Milling Unit per Schedule II)
```

---

### 5. Engagement Partner Sign-Off & Verification

| Review Role | Auditor Name | Sign-Off Status | Date |
| :--- | :--- | :--- | :--- |
| **Audit Senior / Preparer** | MASH Autonomous Agent | Completed | 2025-04-02 |
| **Audit Manager** | R. Ramanathan, FCA | Verified | 2025-04-02 |
| **Engagement Partner** | Statutory Audit Partner | **Ready for Review** | Pending |
