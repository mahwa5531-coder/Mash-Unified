import { chromium } from 'playwright';
import path from 'path';

const ARTIFACT_DIR = 'C:/Users/rama/.gemini/antigravity/brain/6c2d2530-5fae-45bb-8188-4e00a46893c6';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1700, height: 1000 },
    colorScheme: 'dark',
  });
  const page = await context.newPage();

  const comparisonHtml = `
<!DOCTYPE html>
<html class="dark">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fira+Code:wght@400;500&display=swap">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #09090b;
      color: #e4e4e7;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 24px;
    }
    .header-bar {
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .header-bar h1 {
      font-size: 19px;
      font-weight: 600;
      color: #f4f4f5;
    }
    .header-bar p {
      font-size: 13px;
      color: #9ba1af;
      margin-top: 4px;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 20px;
      align-items: start;
    }
    .card {
      background: #121316; /* DeepSeek Canvas Surface */
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      padding: 20px 22px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    }
    .badge-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
      padding-bottom: 10px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .badge {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 3px 8px;
      border-radius: 4px;
    }
    .badge-old {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }
    .badge-mid {
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }
    .badge-dsh {
      background: rgba(59, 130, 246, 0.15);
      color: #60a5fa;
      border: 1px solid rgba(59, 130, 246, 0.3);
    }
    .height-indicator {
      font-family: 'Fira Code', monospace;
      font-size: 11px;
      color: #71717a;
    }

    /* 1. OLD BLOATED SCALE (24px/22px + mt-7 = 28px margins, pure white glare) */
    .card-old h1 { font-size: 22px; font-weight: 700; color: #ffffff; margin-top: 28px; margin-bottom: 12px; line-height: 1.3; }
    .card-old h1:first-child { margin-top: 0; }
    .card-old h2 { font-size: 20px; font-weight: 700; color: #ffffff; margin-top: 28px; margin-bottom: 12px; }
    .card-old h3 { font-size: 16.5px; font-weight: 600; color: #f4f4f5; margin-top: 20px; margin-bottom: 8px; }
    .card-old p { font-size: 15px; line-height: 1.65; color: #e4e4e7; margin-bottom: 12px; }
    .card-old ol, .card-old ul { margin: 12px 0; padding-left: 24px; }
    .card-old li { font-size: 15px; line-height: 1.65; color: #e4e4e7; padding: 4px 0; }
    .card-old strong { color: #ffffff; font-weight: 700; }
    .card-old .callout { margin: 14px 0; padding: 12px 14px; border-radius: 10px; background: rgba(59, 130, 246, 0.08); border-left: 3.5px solid #3b82f6; font-size: 13.5px; line-height: 1.68; color: #e4e4e7; }
    .card-old .callout-title { font-size: 12px; font-weight: 700; color: #60a5fa; margin-bottom: 6px; text-transform: uppercase; }

    /* 2. OVER-COMPRESSED SCALE (18px/16px/14.5px, 13.5px body, dim zinc-300, flattened hierarchy) */
    .card-mid h1 { font-size: 18px; font-weight: 600; color: #f4f4f5; margin-top: 16px; margin-bottom: 8px; line-height: 1.3; }
    .card-mid h1:first-child { margin-top: 0; }
    .card-mid h2 { font-size: 16px; font-weight: 600; color: #f4f4f5; margin-top: 14px; margin-bottom: 6px; }
    .card-mid h3 { font-size: 14.5px; font-weight: 600; color: #e4e4e7; margin-top: 12px; margin-bottom: 4px; }
    .card-mid p { font-size: 13.5px; line-height: 1.58; color: #d4d4d8; margin-bottom: 8px; }
    .card-mid ol, .card-mid ul { margin: 8px 0; padding-left: 18px; }
    .card-mid li { font-size: 13.5px; line-height: 1.58; color: #d4d4d8; padding: 2px 0; }
    .card-mid strong { color: #f4f4f5; font-weight: 600; }
    .card-mid .callout { margin: 10px 0; padding: 10px 12px; border-radius: 8px; background: rgba(59, 130, 246, 0.06); border-left: 3px solid #3b82f6; font-size: 13px; line-height: 1.58; color: #d4d4d8; }
    .card-mid .callout-title { font-size: 11px; font-weight: 600; color: #60a5fa; margin-bottom: 4px; text-transform: uppercase; }

    /* 3. DEEPSEEK AGENT HARNESS GOLD STANDARD (Crisp Off-White, High-Legibility Stepping, Asymmetric Spacing) */
    .card-dsh h1 {
      font-size: 21px;
      font-weight: 600;
      color: #f1f5f9; /* Slate-100 high-clarity off-white */
      margin-top: 22px;
      margin-bottom: 10px;
      line-height: 1.3;
      letter-spacing: -0.015em;
    }
    .card-dsh h1:first-child { margin-top: 0; }
    .card-dsh h2 {
      font-size: 18px;
      font-weight: 600;
      color: #f1f5f9;
      margin-top: 18px;
      margin-bottom: 8px;
      line-height: 1.35;
      letter-spacing: -0.01em;
    }
    .card-dsh h3 {
      font-size: 15.5px;
      font-weight: 600;
      color: #e2e8f0; /* Slate-200 distinct contrast */
      margin-top: 15px;
      margin-bottom: 6px;
      line-height: 1.4;
    }
    .card-dsh p {
      font-size: 14.5px; /* Gold standard for dense AI chat text */
      line-height: 1.62;
      color: #e2e8f0; /* Crisp slate-200, zero muddy wash, zero glare */
      margin-bottom: 10px;
    }
    .card-dsh ol, .card-dsh ul {
      margin: 10px 0;
      padding-left: 20px;
    }
    .card-dsh li {
      font-size: 14.5px;
      line-height: 1.62;
      color: #e2e8f0;
      padding: 3px 0;
    }
    .card-dsh li::marker {
      color: #94a3b8; /* Slate-400 clean marker */
      font-weight: 500;
    }
    .card-dsh strong {
      color: #f8fafc;
      font-weight: 600;
    }
    .card-dsh .callout {
      margin: 12px 0;
      padding: 11px 14px;
      border-radius: 8px;
      background: rgba(59, 130, 246, 0.07);
      border: 1px solid rgba(59, 130, 246, 0.2);
      border-left: 3.5px solid #3b82f6;
      font-size: 13.5px;
      line-height: 1.6;
      color: #e2e8f0;
    }
    .card-dsh .callout-title {
      font-size: 11.5px;
      font-weight: 700;
      color: #60a5fa;
      letter-spacing: 0.04em;
      margin-bottom: 5px;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <div class="header-bar">
    <h1>Typography & Clarity Benchmark: DeepSeek Agent Harness vs Over-Compressed vs Old Bloat</h1>
    <p>Rigorous 3-way optical evaluation: heading contrast, visual hierarchy separation, reading comfort, and space density.</p>
  </div>

  <div class="grid">
    <!-- COL 1: OLD BLOATED -->
    <div class="card card-old">
      <div class="badge-bar">
        <span class="badge badge-old">1. Old Bloated Scale</span>
        <span class="height-indicator" id="h-old">...</span>
      </div>

      <h1>1. Executive Audit Summary</h1>
      <p>We completed substantive testing on procurement cycles and bank reconciliations for FY 2025-26 under statutory engagement protocols.</p>

      <h2>Key Verification Findings</h2>
      <ol>
        <li><strong>Capital Work-in-Progress (CWIP)</strong>: ₹14.85 Cr aging beyond 3 years without capitalization memo.</li>
        <li><strong>Bank Confirmation Tie-Out</strong>: 14 out of 16 scheduled commercial bank accounts fully reconciled.</li>
        <li><strong>Input Tax Credit Matching</strong>: GSTR-2B reconciliation identified unreconciled variance of ₹42.8 Lakhs.</li>
      </ol>

      <div class="callout">
        <div class="callout-title">NOTE — Ind AS 115 Compliance</div>
        Revenue cutoff testing confirmed sales orders through March 31 satisfied performance obligations prior to ledger closure.
      </div>

      <h3>Action Items for Next Turn</h3>
      <ul>
        <li>Obtain board approval memo for physical inventory discrepancies.</li>
        <li>Verify vendor balance confirmations exceeding ₹25 Lakhs threshold.</li>
      </ul>
    </div>

    <!-- COL 2: OVER-COMPRESSED (FLAT HIERARCHY) -->
    <div class="card card-mid">
      <div class="badge-bar">
        <span class="badge badge-mid">2. Over-Compressed (Unclear Headings)</span>
        <span class="height-indicator" id="h-mid">...</span>
      </div>

      <h1>1. Executive Audit Summary</h1>
      <p>We completed substantive testing on procurement cycles and bank reconciliations for FY 2025-26 under statutory engagement protocols.</p>

      <h2>Key Verification Findings</h2>
      <ol>
        <li><strong>Capital Work-in-Progress (CWIP)</strong>: ₹14.85 Cr aging beyond 3 years without capitalization memo.</li>
        <li><strong>Bank Confirmation Tie-Out</strong>: 14 out of 16 scheduled commercial bank accounts fully reconciled.</li>
        <li><strong>Input Tax Credit Matching</strong>: GSTR-2B reconciliation identified unreconciled variance of ₹42.8 Lakhs.</li>
      </ol>

      <div class="callout">
        <div class="callout-title">NOTE — Ind AS 115 Compliance</div>
        Revenue cutoff testing confirmed sales orders through March 31 satisfied performance obligations prior to ledger closure.
      </div>

      <h3>Action Items for Next Turn</h3>
      <ul>
        <li>Obtain board approval memo for physical inventory discrepancies.</li>
        <li>Verify vendor balance confirmations exceeding ₹25 Lakhs threshold.</li>
      </ul>
    </div>

    <!-- COL 3: DEEPSEEK AGENT HARNESS GOLD STANDARD -->
    <div class="card card-dsh">
      <div class="badge-bar">
        <span class="badge badge-dsh">3. DeepSeek Agent Harness (Gold Standard)</span>
        <span class="height-indicator" id="h-dsh">...</span>
      </div>

      <h1>1. Executive Audit Summary</h1>
      <p>We completed substantive testing on procurement cycles and bank reconciliations for FY 2025-26 under statutory engagement protocols.</p>

      <h2>Key Verification Findings</h2>
      <ol>
        <li><strong>Capital Work-in-Progress (CWIP)</strong>: ₹14.85 Cr aging beyond 3 years without capitalization memo.</li>
        <li><strong>Bank Confirmation Tie-Out</strong>: 14 out of 16 scheduled commercial bank accounts fully reconciled.</li>
        <li><strong>Input Tax Credit Matching</strong>: GSTR-2B reconciliation identified unreconciled variance of ₹42.8 Lakhs.</li>
      </ol>

      <div class="callout">
        <div class="callout-title">NOTE — Ind AS 115 Compliance</div>
        Revenue cutoff testing confirmed sales orders through March 31 satisfied performance obligations prior to ledger closure.
      </div>

      <h3>Action Items for Next Turn</h3>
      <ul>
        <li>Obtain board approval memo for physical inventory discrepancies.</li>
        <li>Verify vendor balance confirmations exceeding ₹25 Lakhs threshold.</li>
      </ul>
    </div>
  </div>

  <script>
    const o = document.querySelector('.card-old');
    const m = document.querySelector('.card-mid');
    const d = document.querySelector('.card-dsh');
    document.getElementById('h-old').textContent = o.offsetHeight + 'px (100%)';
    document.getElementById('h-mid').textContent = m.offsetHeight + 'px (' + Math.round((m.offsetHeight/o.offsetHeight)*100) + '%)';
    document.getElementById('h-dsh').textContent = d.offsetHeight + 'px (' + Math.round((d.offsetHeight/o.offsetHeight)*100) + '%)';
  </script>
</body>
</html>
  `;

  await page.setContent(comparisonHtml, { waitUntil: 'load' });
  await page.waitForTimeout(500);

  const screenshotPath = path.join(ARTIFACT_DIR, 'mash_deepseek_harness_typography_comparison.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Captured 3-Way Comparison Screenshot: ${screenshotPath}`);

  const metrics = await page.evaluate(() => {
    const o = document.querySelector('.card-old');
    const m = document.querySelector('.card-mid');
    const d = document.querySelector('.card-dsh');
    return {
      oldHeight: o.offsetHeight,
      midHeight: m.offsetHeight,
      dshHeight: d.offsetHeight,
      savedVsOld: o.offsetHeight - d.offsetHeight,
      savedVsOldPct: Math.round(((o.offsetHeight - d.offsetHeight) / o.offsetHeight) * 100),
    };
  });
  console.log('Metrics:', metrics);

  await browser.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
