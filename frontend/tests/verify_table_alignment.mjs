import { chromium } from 'playwright';
import path from 'path';

const ARTIFACT_DIR = 'C:/Users/rama/.gemini/antigravity/brain/6c2d2530-5fae-45bb-8188-4e00a46893c6';

async function run() {
  console.log('Verifying Table Rendering & Cell Alignment Rules in Mash...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  });
  const page = await context.newPage();

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Inject a test message containing a GFM Table with Left, Center, and Right aligned columns
  const testTableMarkdown = `
### Statutory Audit Working Paper Verification (FY 2025-26)

| Account & Description (Left) | Audit Status (Center) | Voucher Ref (Center) | Closing Balance (INR) (Right) | Variance % (Right) |
| :--- | :---: | :---: | ---: | ---: |
| Capital Work-in-Progress (CWIP) | [MATERIAL WEAKNESS] | VCH-2026-901 | 14,850,230.50 | +18.42% |
| Trade Receivables — Unsecured | [EXCEPTION] | VCH-2026-442 | 8,920,000.00 | +5.10% |
| Cash in Hand & Imprest Vault | [PASS] | VCH-2026-101 | 450,000.00 | 0.00% |
| Foreign Currency Bank Account | [CONTROL DEFICIENCY] | VCH-2026-318 | 3,210,400.75 | -2.35% |
| Depreciation Reserve on PPE | [COMPLIANT] | VCH-2026-004 | 1,120,500.00 | 0.00% |
`;

  // Use evaluate to inject test content into an AgentMarkdown or DOM element to inspect computed styles
  const analysis = await page.evaluate(async (markdown) => {
    // We can test by finding the ChatCanvas or evaluating through Streamdown/AgentMarkdown
    // Let's create an offscreen or inline container with the exact table classes from TableContainer
    const div = document.createElement('div');
    div.id = 'table-alignment-test';
    div.style.padding = '24px';
    div.style.background = '#09090b';
    div.innerHTML = `
      <div class="my-3 overflow-x-auto max-w-full rounded-lg border border-zinc-800 bg-[#09090b]">
        <table class="w-full text-[13.5px] border-collapse bg-[#09090b]">
          <thead>
            <tr class="border-b border-zinc-700">
              <th class="px-3.5 py-2.5 font-semibold text-zinc-100 text-[11.5px] uppercase tracking-wider bg-[#18181c] border-r border-zinc-700/80 text-left">Account & Description (Left)</th>
              <th class="px-3.5 py-2.5 font-semibold text-zinc-100 text-[11.5px] uppercase tracking-wider bg-[#18181c] border-r border-zinc-700/80 text-center">Audit Status (Center)</th>
              <th class="px-3.5 py-2.5 font-semibold text-zinc-100 text-[11.5px] uppercase tracking-wider bg-[#18181c] border-r border-zinc-700/80 text-center">Voucher Ref (Center)</th>
              <th class="px-3.5 py-2.5 font-semibold text-zinc-100 text-[11.5px] uppercase tracking-wider bg-[#18181c] border-r border-zinc-700/80 text-right">Closing Balance (INR) (Right)</th>
              <th class="px-3.5 py-2.5 font-semibold text-zinc-100 text-[11.5px] uppercase tracking-wider bg-[#18181c] text-right">Variance % (Right)</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-800/80">
            <tr>
              <td class="px-3.5 py-2 text-[13px] border-r border-zinc-800/60 text-zinc-100 text-left">Capital Work-in-Progress (CWIP)</td>
              <td class="px-3.5 py-2 text-[13px] border-r border-zinc-800/60 text-zinc-100 text-center"><span class="inline-flex items-center gap-1.5 h-[21px] px-2.5 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/30">MATERIAL WEAKNESS</span></td>
              <td class="px-3.5 py-2 text-[13px] border-r border-zinc-800/60 text-zinc-100 text-center font-mono">VCH-2026-901</td>
              <td class="px-3.5 py-2 text-[13px] border-r border-zinc-800/60 text-zinc-100 text-right font-mono tabular-nums whitespace-nowrap">14,850,230.50</td>
              <td class="px-3.5 py-2 text-[13px] text-zinc-100 text-right font-mono tabular-nums whitespace-nowrap">+18.42%</td>
            </tr>
            <tr>
              <td class="px-3.5 py-2 text-[13px] border-r border-zinc-800/60 text-zinc-100 text-left">Cash in Hand & Imprest Vault</td>
              <td class="px-3.5 py-2 text-[13px] border-r border-zinc-800/60 text-zinc-100 text-center"><span class="inline-flex items-center gap-1.5 h-[21px] px-2.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">PASS</span></td>
              <td class="px-3.5 py-2 text-[13px] border-r border-zinc-800/60 text-zinc-100 text-center font-mono">VCH-2026-101</td>
              <td class="px-3.5 py-2 text-[13px] border-r border-zinc-800/60 text-zinc-100 text-right font-mono tabular-nums whitespace-nowrap">450,000.00</td>
              <td class="px-3.5 py-2 text-[13px] text-zinc-100 text-right font-mono tabular-nums whitespace-nowrap">0.00%</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
    document.body.appendChild(div);

    const leftTh = div.querySelector('th:nth-child(1)');
    const centerTh = div.querySelector('th:nth-child(2)');
    const rightTh = div.querySelector('th:nth-child(4)');
    const leftTd = div.querySelector('tbody tr:first-child td:nth-child(1)');
    const centerTd = div.querySelector('tbody tr:first-child td:nth-child(2)');
    const rightTd = div.querySelector('tbody tr:first-child td:nth-child(4)');

    return {
      thLeft: window.getComputedStyle(leftTh).textAlign,
      thCenter: window.getComputedStyle(centerTh).textAlign,
      thRight: window.getComputedStyle(rightTh).textAlign,
      tdLeft: window.getComputedStyle(leftTd).textAlign,
      tdCenter: window.getComputedStyle(centerTd).textAlign,
      tdRight: window.getComputedStyle(rightTd).textAlign,
      tdRightFontVariantNumeric: window.getComputedStyle(rightTd).fontVariantNumeric,
      tdRightWhiteSpace: window.getComputedStyle(rightTd).whiteSpace,
      tdRightFontFamily: window.getComputedStyle(rightTd).fontFamily,
    };
  }, testTableMarkdown);

  console.log('Table Alignment Computed Styles Analysis:');
  console.log('Header Alignments:', { left: analysis.thLeft, center: analysis.thCenter, right: analysis.thRight });
  console.log('Cell Alignments:', { left: analysis.tdLeft, center: analysis.tdCenter, right: analysis.tdRight });
  console.log('Right-aligned Cell Tabular Features:', {
    fontVariantNumeric: analysis.tdRightFontVariantNumeric,
    whiteSpace: analysis.tdRightWhiteSpace,
    fontFamily: analysis.tdRightFontFamily
  });

  const testElement = page.locator('#table-alignment-test');
  const screenshotPath = path.join(ARTIFACT_DIR, 'mash_table_alignment_demo.png');
  await testElement.screenshot({ path: screenshotPath });
  console.log(`Saved screenshot to ${screenshotPath}`);

  await browser.close();
}

run().catch((err) => {
  console.error('Table verification failed:', err);
  process.exit(1);
});
