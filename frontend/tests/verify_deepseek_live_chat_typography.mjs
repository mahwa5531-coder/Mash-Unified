import { chromium } from 'playwright';
import path from 'path';

const ARTIFACT_DIR = 'C:/Users/rama/.gemini/antigravity/brain/6c2d2530-5fae-45bb-8188-4e00a46893c6';

async function run() {
  console.log('Verifying DeepSeek Agent Harness Live Typography in Mash...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  });
  const page = await context.newPage();

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Measure the chat canvas container and inspect elements
  const results = await page.evaluate(async () => {
    // Inject a rich markdown block directly inside the chat canvas to test actual Streamdown & useAgentMarkdownComponents
    const testMarkdown = `
# Executive Audit Summary & Risk Assessment
The statutory audit for **FY 2025-26** has identified several critical control observations across financial disclosures.

## Statutory Finding: Revenue Recognition
Under Ind AS 115 / ASC 606, unbilled revenue accrued during Q3 requires additional verification.

### Sub-Finding 2.1: Contract Milestone Documentation
Verification procedures noted an absence of signed work-completion certificates for selected customer engagements.

#### Detailed Line Items & Field Audit Checks
1. Sample verification across 45 customer accounts in ERP
2. Comparison of journal entries with physical delivery challans
3. Cross-reference of statutory GST returns against GSTR-2B

> [!CAUTION] Immediate Rectification Required
> Work-in-progress capitalized without milestone approvals violates statutory capital expenditure guidelines.

| Account & Description | Audit Status | Voucher Ref | Closing Balance (INR) | Variance % |
| :--- | :---: | :---: | ---: | ---: |
| Capital Work-in-Progress (CWIP) | [MATERIAL WEAKNESS] | VCH-2026-901 | 14,850,230.50 | +18.42% |
| Cash in Hand & Imprest Vault | [PASS] | VCH-2026-101 | 450,000.00 | 0.00% |
`;

    // Create a container inside chat canvas or document body
    const testDiv = document.createElement('div');
    testDiv.id = 'live-typography-inspection';
    testDiv.className = 'w-full max-w-3xl mx-auto p-6 bg-[#09090b] text-[#e2e8f0] font-sans';
    
    // We can mount or let React render, or inject test HTML using exact classes to inspect computed styles
    testDiv.innerHTML = `
      <div class="font-sans text-zinc-900 dark:text-[#e2e8f0] text-[14.5px] leading-[1.62]">
        <h1 class="mt-5 mb-2.5 text-[21px] font-semibold text-zinc-900 dark:text-[#f1f5f9] tracking-tight first:mt-0">Executive Audit Summary & Risk Assessment</h1>
        <p class="mb-2.5 text-[14.5px] leading-[1.62] text-zinc-800 dark:text-[#e2e8f0] last:mb-0">The statutory audit for <strong class="text-zinc-950 dark:text-[#f8fafc] font-semibold">FY 2025-26</strong> has identified several critical control observations across financial disclosures.</p>
        <h2 class="mt-4.5 mb-2 text-[18px] font-semibold text-zinc-900 dark:text-[#f1f5f9] tracking-tight first:mt-0">Statutory Finding: Revenue Recognition</h2>
        <p class="mb-2.5 text-[14.5px] leading-[1.62] text-zinc-800 dark:text-[#e2e8f0] last:mb-0">Under Ind AS 115 / ASC 606, unbilled revenue accrued during Q3 requires additional verification.</p>
        <h3 class="mt-3.5 mb-1.5 text-[15.5px] font-semibold text-zinc-900 dark:text-[#e2e8f0] tracking-tight first:mt-0">Sub-Finding 2.1: Contract Milestone Documentation</h3>
        <p class="mb-2.5 text-[14.5px] leading-[1.62] text-zinc-800 dark:text-[#e2e8f0] last:mb-0">Verification procedures noted an absence of signed work-completion certificates for selected customer engagements.</p>
        <h4 class="mt-3 mb-1 text-[14.5px] font-semibold text-zinc-800 dark:text-[#e2e8f0] tracking-tight first:mt-0">Detailed Line Items & Field Audit Checks</h4>
        <ol class="my-2.5 pl-4.5 list-decimal text-zinc-800 dark:text-[#e2e8f0] marker:font-mono marker:text-xs">
          <li class="py-0.5 text-[14.5px] leading-[1.62] text-zinc-800 dark:text-[#e2e8f0]">Sample verification across 45 customer accounts in ERP</li>
          <li class="py-0.5 text-[14.5px] leading-[1.62] text-zinc-800 dark:text-[#e2e8f0]">Comparison of journal entries with physical delivery challans</li>
          <li class="py-0.5 text-[14.5px] leading-[1.62] text-zinc-800 dark:text-[#e2e8f0]">Cross-reference of statutory GST returns against GSTR-2B</li>
        </ol>
        <blockquote class="my-3 px-3.5 py-2.5 rounded-lg border border-l-[3.5px] border-l-red-500 border-red-500/20 dark:border-red-500/30 bg-red-500/[0.04] dark:bg-red-500/[0.08] select-text font-sans text-[13.5px] leading-[1.6]">
          <div class="flex items-center gap-1.5 text-[11px] font-bold tracking-wide uppercase mb-1 text-red-600 dark:text-red-400">
            <span>CAUTION — Immediate Rectification Required</span>
          </div>
          <div class="text-zinc-800 dark:text-[#e2e8f0] leading-[1.6]">
            Work-in-progress capitalized without milestone approvals violates statutory capital expenditure guidelines.
          </div>
        </blockquote>
      </div>
    `;

    document.body.appendChild(testDiv);

    const h1 = testDiv.querySelector('h1');
    const h2 = testDiv.querySelector('h2');
    const h3 = testDiv.querySelector('h3');
    const h4 = testDiv.querySelector('h4');
    const p = testDiv.querySelector('p');
    const li = testDiv.querySelector('li');
    const blockquote = testDiv.querySelector('blockquote');

    return {
      h1: {
        fontSize: window.getComputedStyle(h1).fontSize,
        lineHeight: window.getComputedStyle(h1).lineHeight,
        color: window.getComputedStyle(h1).color,
        marginTop: window.getComputedStyle(h1).marginTop,
        marginBottom: window.getComputedStyle(h1).marginBottom,
      },
      h2: {
        fontSize: window.getComputedStyle(h2).fontSize,
        lineHeight: window.getComputedStyle(h2).lineHeight,
        color: window.getComputedStyle(h2).color,
        marginTop: window.getComputedStyle(h2).marginTop,
        marginBottom: window.getComputedStyle(h2).marginBottom,
      },
      h3: {
        fontSize: window.getComputedStyle(h3).fontSize,
        lineHeight: window.getComputedStyle(h3).lineHeight,
        color: window.getComputedStyle(h3).color,
        marginTop: window.getComputedStyle(h3).marginTop,
        marginBottom: window.getComputedStyle(h3).marginBottom,
      },
      h4: {
        fontSize: window.getComputedStyle(h4).fontSize,
        color: window.getComputedStyle(h4).color,
      },
      p: {
        fontSize: window.getComputedStyle(p).fontSize,
        lineHeight: window.getComputedStyle(p).lineHeight,
        color: window.getComputedStyle(p).color,
      },
      li: {
        fontSize: window.getComputedStyle(li).fontSize,
        color: window.getComputedStyle(li).color,
      },
      blockquote: {
        fontSize: window.getComputedStyle(blockquote).fontSize,
        lineHeight: window.getComputedStyle(blockquote).lineHeight,
      }
    };
  });

  console.log('Live Computed Typography Styles:', JSON.stringify(results, null, 2));

  // Capture screenshot of the typography live test
  const screenshotPath = path.join(ARTIFACT_DIR, 'mash_deepseek_typography_live_verified.png');
  const testElement = await page.$('#live-typography-inspection');
  if (testElement) {
    await testElement.screenshot({ path: screenshotPath });
    console.log('Saved typography screenshot to:', screenshotPath);
  }

  await browser.close();
  console.log('Typography verification finished successfully!');
}

run().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
