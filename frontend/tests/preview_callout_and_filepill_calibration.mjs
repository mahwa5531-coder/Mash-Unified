import { chromium } from 'playwright';
import path from 'path';

const ARTIFACT_DIR = 'C:/Users/rama/.gemini/antigravity/brain/6c2d2530-5fae-45bb-8188-4e00a46893c6';

async function run() {
  console.log('Testing calibrated CSS properties for Callout and FilePill...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  });
  const page = await context.newPage();

  // Create an HTML page comparing Before vs After
  const htmlContent = `
    <!DOCTYPE html>
    <html class="dark">
    <head>
      <meta charset="utf-8">
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
        body { background: #0e0e11; color: #f4f4f6; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 40px; }
      </style>
    </head>
    <body>
      <h1 class="text-xl font-bold mb-6 text-white">AuditCallout & FilePill Calibration Comparison</h1>

      <div class="grid grid-cols-2 gap-8">
        <!-- COLUMN 1: BEFORE -->
        <div class="p-6 rounded-xl border border-red-500/30 bg-red-500/[0.02]">
          <div class="text-xs font-mono uppercase tracking-wider text-red-400 font-bold mb-4">❌ Current (Flawed: Squeezed 11px, Bottom Clipped, 22px Pill)</div>

          <!-- Current Callout -->
          <blockquote class="my-4 px-3.5 py-2.5 rounded-lg border border-l-[3.5px] border-amber-500/20 border-l-amber-500 bg-amber-500/[0.08] text-[13.5px] leading-[1.6]">
            <div class="flex items-center gap-1.5 text-[11px] font-bold tracking-wide uppercase mb-1 text-amber-400 select-none">
              <svg width="13.5" height="13.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <span>CONTROL DEFICIENCY — INADEQUATE SEGREGATION OF DUTIES IN ERP VENDOR MASTER</span>
            </div>
            <div class="text-[#e2e8f0] leading-[1.6]">
              <p class="my-1">Accounts payable executives possess dual rights to create vendor records and release payments exceeding threshold limits.</p>
            </div>
            <footer class="mt-2 text-[11px] font-mono text-zinc-400">— § Section 143(3)(i) ICFR Framework</footer>
          </blockquote>

          <!-- Current FilePill -->
          <div class="pt-4 space-y-2">
            <div class="text-xs text-zinc-400 font-mono">Current FilePills (h-[22px], px-2, py-0, max-w-[260px]):</div>
            <div class="flex flex-wrap gap-2">
              <button class="inline-flex items-center gap-1.5 h-[22px] px-2 py-0 rounded-[5px] text-[12px] leading-none bg-white/[0.06] border border-white/[0.08] text-zinc-200">
                <span class="w-3.5 h-3.5 flex items-center justify-center">📄</span>
                <span class="truncate max-w-[260px]">workpapers/Trade_Payables_Vouching.xlsx</span>
                <span class="font-mono text-[10.5px] text-zinc-400">:42</span>
              </button>
              <button class="inline-flex items-center gap-1.5 h-[22px] px-2 py-0 rounded-[5px] text-[12px] leading-none bg-white/[0.06] border border-white/[0.08] text-zinc-200">
                <span class="w-3.5 h-3.5 flex items-center justify-center">📑</span>
                <span class="truncate max-w-[260px]">Statutory_Audit_Report_FY26.pdf</span>
              </button>
            </div>
          </div>
        </div>

        <!-- COLUMN 2: AFTER -->
        <div class="p-6 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.02]">
          <div class="text-xs font-mono uppercase tracking-wider text-emerald-400 font-bold mb-4">✅ Proposed (Calibrated: 13px Hierarchy, Zero Cut-off, 25px Spacious Pill)</div>

          <!-- Proposed Callout -->
          <blockquote class="my-4 px-3.5 py-2.5 rounded-lg border border-l-[3.5px] border-amber-500/30 border-l-amber-500 bg-amber-500/[0.08] text-[13.5px] leading-[1.6]">
            <div class="flex items-center gap-2 mb-2 select-none min-h-[20px]">
              <span class="inline-flex items-center gap-1.5 text-[11.5px] font-bold tracking-wider uppercase text-amber-400">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <span>CONTROL DEFICIENCY</span>
              </span>
              <span class="text-zinc-600 text-xs">|</span>
              <span class="text-[13px] font-semibold text-zinc-200 tracking-tight leading-normal">
                Inadequate Segregation of Duties in ERP Vendor Master
              </span>
            </div>
            <div class="text-[#e2e8f0] leading-[1.62]">
              <p class="my-1">Accounts payable executives possess dual rights to create vendor records and release payments exceeding threshold limits.</p>
            </div>
            <footer class="mt-2.5 pt-1.5 border-t border-white/[0.06] text-[11px] font-mono text-zinc-400 flex items-center gap-1.5">
              <span class="text-zinc-500 font-sans">Source:</span>
              <span>§ Section 143(3)(i) ICFR Framework</span>
            </footer>
          </blockquote>

          <!-- Proposed FilePill -->
          <div class="pt-4 space-y-2">
            <div class="text-xs text-zinc-400 font-mono">Proposed FilePills (h-[25px], px-2.5, py-0.5, max-w-[340px]):</div>
            <div class="flex flex-wrap gap-2">
              <button class="inline-flex items-center gap-1.5 h-[25px] px-2.5 py-0.5 rounded-[6px] text-[12px] leading-tight bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] hover:border-white/[0.20] text-zinc-200 shadow-2xs transition-all">
                <span class="w-4 h-4 flex items-center justify-center shrink-0">📄</span>
                <span class="truncate max-w-[340px]">workpapers/Trade_Payables_Vouching.xlsx</span>
                <span class="font-mono text-[11px] text-zinc-400 font-normal shrink-0">:42</span>
              </button>
              <button class="inline-flex items-center gap-1.5 h-[25px] px-2.5 py-0.5 rounded-[6px] text-[12px] leading-tight bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] hover:border-white/[0.20] text-zinc-200 shadow-2xs transition-all">
                <span class="w-4 h-4 flex items-center justify-center shrink-0">📑</span>
                <span class="truncate max-w-[340px]">Statutory_Audit_Report_FY26.pdf</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  await page.setContent(htmlContent, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const screenshotPath = path.join(ARTIFACT_DIR, 'calibration_before_after_comparison.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`Saved comparison screenshot to ${screenshotPath}`);

  await browser.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
