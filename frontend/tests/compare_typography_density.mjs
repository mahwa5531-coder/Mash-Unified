import { chromium } from 'playwright';
import path from 'path';

const ARTIFACT_DIR = 'C:/Users/rama/.gemini/antigravity/brain/6c2d2530-5fae-45bb-8188-4e00a46893c6';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1500, height: 950 },
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
      font-family: 'Inter', -apple-system, sans-serif;
      padding: 24px;
    }
    .header-bar {
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .header-bar h1 {
      font-size: 18px;
      font-weight: 600;
      color: #f4f4f5;
    }
    .header-bar p {
      font-size: 13px;
      color: #a1a1aa;
      margin-top: 4px;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      align-items: start;
    }
    .card {
      background: #121215;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      padding: 20px 24px;
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
      letter-spacing: 0.05em;
      padding: 3px 8px;
      border-radius: 4px;
    }
    .badge-curr {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }
    .badge-rec {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .height-indicator {
      font-family: 'Fira Code', monospace;
      font-size: 11px;
      color: #71717a;
    }

    /* CURRENT STYLING */
    .curr h1 {
      font-size: 22px;
      font-weight: 700;
      color: #ffffff; /* 100% white glare */
      margin-top: 28px;
      margin-bottom: 12px;
      line-height: 1.3;
    }
    .curr h1:first-child { margin-top: 0; }
    .curr h2 {
      font-size: 20px;
      font-weight: 700;
      color: #ffffff; /* 100% white glare */
      margin-top: 28px;
      margin-bottom: 12px;
      line-height: 1.35;
    }
    .curr h3 {
      font-size: 16.5px;
      font-weight: 600;
      color: #f4f4f5;
      margin-top: 20px;
      margin-bottom: 8px;
    }
    .curr p {
      font-size: 15px;
      line-height: 1.65;
      color: #e4e4e7;
      margin-bottom: 12px;
    }
    .curr ul, .curr ol {
      margin: 12px 0;
      padding-left: 24px;
    }
    .curr li {
      font-size: 15px;
      line-height: 1.65;
      color: #e4e4e7;
      padding: 4px 0;
    }
    .curr li::marker {
      color: #a1a1aa;
      font-weight: 600;
    }
    .curr .callout {
      margin: 14px 0;
      padding: 12px 14px;
      border-radius: 10px;
      background: rgba(59, 130, 246, 0.08);
      border: 1px solid rgba(59, 130, 246, 0.2);
      border-left: 3.5px solid #3b82f6;
      font-size: 13.5px;
      line-height: 1.68;
    }

    /* RECOMMENDED CALM & COMPACT STYLING */
    .rec h1 {
      font-size: 18px;
      font-weight: 600;
      color: #f4f4f5; /* Calm zinc-100, zero glare */
      margin-top: 16px;
      margin-bottom: 8px;
      line-height: 1.3;
      letter-spacing: -0.01em;
    }
    .rec h1:first-child { margin-top: 0; }
    .rec h2 {
      font-size: 16px;
      font-weight: 600;
      color: #f4f4f5;
      margin-top: 14px;
      margin-bottom: 6px;
      line-height: 1.35;
      letter-spacing: -0.01em;
    }
    .rec h3 {
      font-size: 14.5px;
      font-weight: 600;
      color: #e4e4e7;
      margin-top: 12px;
      margin-bottom: 4px;
    }
    .rec p {
      font-size: 13.5px; /* Matches User message & IDE default */
      line-height: 1.58;
      color: #d4d4d8; /* Balanced contrast, comfortable reading */
      margin-bottom: 8px;
    }
    .rec ul, .rec ol {
      margin: 8px 0;
      padding-left: 18px; /* Tighter indent */
    }
    .rec li {
      font-size: 13.5px;
      line-height: 1.58;
      color: #d4d4d8;
      padding: 2px 0; /* Snug vertical spacing */
    }
    .rec li::marker {
      color: #71717a;
      font-size: 12px;
    }
    .rec .callout {
      margin: 10px 0;
      padding: 10px 12px;
      border-radius: 8px;
      background: rgba(59, 130, 246, 0.06);
      border: 1px solid rgba(59, 130, 246, 0.18);
      border-left: 3px solid #3b82f6;
      font-size: 13px;
      line-height: 1.58;
    }
    .rec .callout-title {
      font-size: 11px;
      font-weight: 600;
      color: #60a5fa;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 4px;
    }
    .curr .callout-title {
      font-size: 12px;
      font-weight: 700;
      color: #60a5fa;
      text-transform: uppercase;
      margin-bottom: 6px;
    }
  </style>
</head>
<body>
  <div class="header-bar">
    <h1>Typography & Vertical Density Research: Current vs Recommended Calibrated Scale</h1>
    <p>Real side-by-side comparison of font sizes, line heights, margins, and brightness contrast in dark mode.</p>
  </div>

  <div class="grid">
    <!-- LEFT: CURRENT -->
    <div class="card curr">
      <div class="badge-bar">
        <span class="badge badge-curr">Current Mash Scale (Bloated & Harsh)</span>
        <span class="height-indicator" id="curr-height">Measuring...</span>
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

    <!-- RIGHT: RECOMMENDED -->
    <div class="card rec">
      <div class="badge-bar">
        <span class="badge badge-rec">Recommended Calibrated Scale (Compact & Ergonomic)</span>
        <span class="height-indicator" id="rec-height">Measuring...</span>
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
    const currCard = document.querySelector('.card.curr');
    const recCard = document.querySelector('.card.rec');
    document.getElementById('curr-height').textContent = 'Total Height: ' + currCard.offsetHeight + 'px (100%)';
    const pct = Math.round((recCard.offsetHeight / currCard.offsetHeight) * 100);
    const saved = currCard.offsetHeight - recCard.offsetHeight;
    document.getElementById('rec-height').textContent = 'Total Height: ' + recCard.offsetHeight + 'px (' + pct + '% | -' + saved + 'px saved)';
  </script>
</body>
</html>
  `;

  await page.setContent(comparisonHtml, { waitUntil: 'load' });
  await page.waitForTimeout(500);

  const screenshotPath = path.join(ARTIFACT_DIR, 'mash_typography_density_comparison.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Captured Typography Comparison Screenshot: ${screenshotPath}`);

  const metrics = await page.evaluate(() => {
    const c = document.querySelector('.card.curr');
    const r = document.querySelector('.card.rec');
    return {
      currHeight: c.offsetHeight,
      recHeight: r.offsetHeight,
      savedPx: c.offsetHeight - r.offsetHeight,
      savedPct: Math.round(((c.offsetHeight - r.offsetHeight) / c.offsetHeight) * 100),
    };
  });
  console.log('Typography Density Metrics:', metrics);

  await browser.close();
}

run().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
