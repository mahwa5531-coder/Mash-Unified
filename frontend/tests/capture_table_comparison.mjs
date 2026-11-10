import { chromium } from '../node_modules/playwright/index.mjs';
import fs from 'fs';
import path from 'path';

const ARTIFACT_DIR = 'C:/Users/rama/.gemini/antigravity/brain/6c2d2530-5fae-45bb-8188-4e00a46893c6';

const sampleRows = [
  { code: '1010', name: 'Operating Cash & Bank Balances', debit: '₹ 1,45,20,000', credit: '—', variance: '+12.4%', status: 'VERIFIED' },
  { code: '1040', name: 'Trade Receivables (Debtors Ledger)', debit: '₹ 3,82,90,500', credit: '—', variance: '-3.1%', status: 'CONFIRMED' },
  { code: '2010', name: 'Trade Payables (Creditors Control)', debit: '—', credit: '₹ 2,15,40,000', variance: '+8.2%', status: 'RECONCILED' },
  { code: '2050', name: 'Statutory GST Liability Output', debit: '—', credit: '₹ 38,15,200', variance: '-1.5%', status: 'AUDITED' },
  { code: '3010', name: 'Retained Earnings & Reserves', debit: '—', credit: '₹ 2,74,55,300', variance: '+15.0%', status: 'TIED' },
];

function generateHtml(theme) {
  const isDark = theme === 'dark';
  const pageBg = isDark ? '#09090b' : '#f8fafc';
  const textPrimary = isDark ? '#f4f4f5' : '#09090b';
  const textMuted = isDark ? '#a1a1aa' : '#64748b';

  return `<!DOCTYPE html>
<html class="${isDark ? 'dark' : ''}">
<head>
  <meta charset="utf-8">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            app: '${isDark ? '#09090b' : '#ffffff'}',
          }
        }
      }
    }
  </script>
  <style>
    body {
      background-color: ${pageBg};
      color: ${textPrimary};
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      margin: 0;
      padding: 32px;
    }
    .badge-verified {
      background: rgba(16, 185, 129, 0.15);
      color: #10b981;
      border: 1px solid rgba(16, 185, 129, 0.3);
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      font-family: monospace;
    }
    .badge-audit {
      background: rgba(59, 130, 246, 0.15);
      color: #3b82f6;
      border: 1px solid rgba(59, 130, 246, 0.3);
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      font-family: monospace;
    }
  </style>
</head>
<body class="${isDark ? 'dark' : ''}">
  <div class="max-w-6xl mx-auto space-y-10">
    <div class="border-b ${isDark ? 'border-zinc-800' : 'border-zinc-200'} pb-5">
      <div class="flex items-center gap-3 mb-2">
        <span class="px-2.5 py-1 rounded bg-indigo-500/10 text-indigo-500 text-xs font-semibold uppercase tracking-wider font-mono">Design Research</span>
        <span class="text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'} font-mono">${theme.toUpperCase()} THEME COMPARISON</span>
      </div>
      <h1 class="text-2xl font-bold tracking-tight text-foreground">Table Heading & Border Line Visibility Analysis</h1>
      <p class="text-sm ${isDark ? 'text-zinc-400' : 'text-zinc-600'} mt-1">Direct side-by-side comparison of current faded hairlines vs. proposed saturated, high-contrast grid lines.</p>
    </div>

    <!-- 1. CURRENT (BEFORE) -->
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded-full bg-rose-500/80 inline-block"></span>
          <h2 class="text-base font-semibold text-rose-500">CURRENT (BEFORE): Faded Faint Zinc & Low Contrast</h2>
        </div>
        <span class="text-xs px-2.5 py-1 rounded bg-rose-500/10 text-rose-400 font-mono">Lines barely visible (white/[0.05] & white/[0.08])</span>
      </div>
      
      <p class="text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-500'}">
        Notice how the column separator lines disappear, row dividers are faint, and the heading looks flat/washed out.
      </p>

      <!-- CURRENT TABLE CONTAINER -->
      <div class="overflow-x-auto select-text custom-scrollbar max-w-full rounded-lg border border-zinc-200/80 dark:border-white/[0.08] shadow-2xs bg-white dark:bg-[#09090b]">
        <table class="w-full min-w-full text-[13.5px] border-collapse bg-transparent dark:bg-[#09090b] 
          [&_thead]:border-b [&_thead]:border-zinc-300 dark:[&_thead]:border-white/[0.12] 
          [&_th]:sticky [&_th]:top-0 [&_th]:z-10 
          [&_th]:bg-zinc-100 dark:[&_th]:bg-[#1c1c1f] 
          [&_th]:py-2.5 [&_th]:px-3.5 [&_th]:font-semibold 
          [&_th]:text-zinc-700 dark:[&_th]:text-zinc-300 
          [&_th]:text-[12px] [&_th]:uppercase [&_th]:tracking-wider
          [&_th]:border-r [&_th]:border-zinc-200 dark:[&_th]:border-white/[0.08] [&_th:last-child]:border-r-0 
          [&_tbody]:divide-y [&_tbody]:divide-zinc-200/70 dark:[&_tbody]:divide-white/[0.06] 
          [&_tbody_tr]:hover:bg-zinc-50/80 dark:[&_tbody_tr]:hover:bg-white/[0.03] [&_tbody_tr]:transition-colors 
          [&_td]:border-r [&_td]:border-zinc-200/50 dark:[&_td]:border-white/[0.05] [&_td:last-child]:border-r-0 
          [&_td]:py-2.5 [&_td]:px-3.5 [&_td]:tabular-nums">
          <thead>
            <tr>
              <th class="text-left font-mono">Account Code</th>
              <th class="text-left">Account Description</th>
              <th class="text-right font-mono">Debit Balance</th>
              <th class="text-right font-mono">Credit Balance</th>
              <th class="text-right font-mono">YoY Variance</th>
              <th class="text-center font-mono">Audit Status</th>
            </tr>
          </thead>
          <tbody>
            ${sampleRows.map(r => `
              <tr>
                <td class="font-mono text-zinc-500 dark:text-zinc-400">${r.code}</td>
                <td class="font-medium text-foreground">${r.name}</td>
                <td class="text-right font-mono text-emerald-600 dark:text-emerald-400">${r.debit}</td>
                <td class="text-right font-mono text-rose-500 dark:text-rose-400">${r.credit}</td>
                <td class="text-right font-mono text-zinc-500">${r.variance}</td>
                <td class="text-center"><span class="${r.status === 'VERIFIED' || r.status === 'RECONCILED' ? 'badge-verified' : 'badge-audit'}">${r.status}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- 2. PROPOSED (AFTER) -->
    <div class="space-y-3 pt-6 border-t ${isDark ? 'border-zinc-800' : 'border-zinc-200'}">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded-full bg-emerald-500 inline-block"></span>
          <h2 class="text-base font-semibold text-emerald-500">PROPOSED (AFTER): Saturated Zinc Header & Crisp Visible Grid</h2>
        </div>
        <span class="text-xs px-2.5 py-1 rounded bg-emerald-500/10 text-emerald-400 font-mono">High contrast, sharp dividing lines, saturated header</span>
      </div>
      
      <p class="text-xs ${isDark ? 'text-zinc-400' : 'text-zinc-600'}">
        Notice how every column boundary is distinctly visible, the thead bottom anchor is crisp, and the header ribbon is elevated and saturated.
      </p>

      <!-- PROPOSED TABLE CONTAINER -->
      <div class="overflow-x-auto select-text custom-scrollbar max-w-full rounded-lg border border-zinc-300 dark:border-zinc-800 shadow-sm bg-white dark:bg-[#0c0c0e]">
        <table class="w-full min-w-full text-[13.5px] border-collapse bg-transparent dark:bg-[#0c0c0e] 
          [&_thead]:border-b [&_thead]:border-zinc-300 dark:[&_thead]:border-zinc-700 
          [&_th]:sticky [&_th]:top-0 [&_th]:z-10 
          [&_th]:bg-zinc-100/90 dark:[&_th]:bg-[#18181c] 
          [&_th]:py-2.5 [&_th]:px-3.5 [&_th]:font-semibold 
          [&_th]:text-zinc-900 dark:[&_th]:text-zinc-100 
          [&_th]:text-[12px] [&_th]:uppercase [&_th]:tracking-wider
          [&_th]:border-r [&_th]:border-zinc-300/80 dark:[&_th]:border-zinc-700/80 [&_th:last-child]:border-r-0 
          [&_tbody]:divide-y [&_tbody]:divide-zinc-200 dark:[&_tbody]:divide-zinc-800/80 
          [&_tbody_tr]:hover:bg-zinc-50/90 dark:[&_tbody_tr]:hover:bg-zinc-800/25 [&_tbody_tr]:transition-colors 
          [&_td]:border-r [&_td]:border-zinc-200 dark:[&_td]:border-zinc-800/60 [&_td:last-child]:border-r-0 
          [&_td]:py-2.5 [&_td]:px-3.5 [&_td]:tabular-nums">
          <thead>
            <tr>
              <th class="text-left font-mono">Account Code</th>
              <th class="text-left">Account Description</th>
              <th class="text-right font-mono">Debit Balance</th>
              <th class="text-right font-mono">Credit Balance</th>
              <th class="text-right font-mono">YoY Variance</th>
              <th class="text-center font-mono">Audit Status</th>
            </tr>
          </thead>
          <tbody>
            ${sampleRows.map(r => `
              <tr>
                <td class="font-mono text-zinc-500 dark:text-zinc-400">${r.code}</td>
                <td class="font-medium text-foreground">${r.name}</td>
                <td class="text-right font-mono text-emerald-600 dark:text-emerald-400">${r.debit}</td>
                <td class="text-right font-mono text-rose-500 dark:text-rose-400">${r.credit}</td>
                <td class="text-right font-mono text-zinc-500">${r.variance}</td>
                <td class="text-center"><span class="${r.status === 'VERIFIED' || r.status === 'RECONCILED' ? 'badge-verified' : 'badge-audit'}">${r.status}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- CODE TOKEN CHANGES BREAKDOWN -->
    <div class="p-4 rounded-lg border ${isDark ? 'border-zinc-800 bg-[#121215]' : 'border-zinc-200 bg-white'} space-y-2 text-xs">
      <div class="font-semibold text-foreground">Exact CSS / Tailwind Tokens Modified:</div>
      <div class="grid grid-cols-2 gap-4 font-mono text-[11.5px] mt-2">
        <div class="space-y-1 text-rose-400">
          <div class="font-bold">❌ CURRENT VALUES (Washed Out)</div>
          <div>• thead border: dark:border-white/[0.12] (Faint 12%)</div>
          <div>• th background: dark:bg-[#1c1c1f]</div>
          <div>• th vertical line: dark:border-white/[0.08] (Faint 8%)</div>
          <div>• td vertical line: dark:border-white/[0.05] (Invisible 5%)</div>
          <div>• row divider: dark:divide-white/[0.06] (Faint 6%)</div>
        </div>
        <div class="space-y-1 text-emerald-400">
          <div class="font-bold">✓ PROPOSED VALUES (High Contrast)</div>
          <div>• thead border: dark:border-zinc-700 (Thin 1px saturated anchor)</div>
          <div>• th background: dark:bg-[#18181c] (Crisp elevated header)</div>
          <div>• th vertical line: dark:border-zinc-700/80 (Distinct boundary)</div>
          <div>• td vertical line: dark:border-zinc-800/60 (Clean gridline)</div>
          <div>• row divider: dark:divide-zinc-800/80 (Crisp row separation)</div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

async function run() {
  const browser = await chromium.launch();

  // 1. Dark Mode
  const pageDark = await browser.newPage({ viewport: { width: 1200, height: 1100 }, colorScheme: 'dark' });
  await pageDark.setContent(generateHtml('dark'), { waitUntil: 'networkidle' });
  await pageDark.waitForTimeout(500);
  const darkPath = `${ARTIFACT_DIR}/table_before_after_comparison_dark.png`;
  await pageDark.screenshot({ path: darkPath, fullPage: true });
  console.log(`Saved dark mode comparison: ${darkPath}`);

  // Macro zoom on the tables
  const tables = pageDark.locator('table');
  if (await tables.count() >= 2) {
    const tableBefore = tables.nth(0);
    const tableAfter = tables.nth(1);
    await tableBefore.screenshot({ path: `${ARTIFACT_DIR}/table_macro_before_dark.png` });
    await tableAfter.screenshot({ path: `${ARTIFACT_DIR}/table_macro_after_dark.png` });
    console.log('Saved macro table crops for dark mode');
  }

  // 2. Light Mode
  const pageLight = await browser.newPage({ viewport: { width: 1200, height: 1100 }, colorScheme: 'light' });
  await pageLight.setContent(generateHtml('light'), { waitUntil: 'networkidle' });
  await pageLight.waitForTimeout(500);
  const lightPath = `${ARTIFACT_DIR}/table_before_after_comparison_light.png`;
  await pageLight.screenshot({ path: lightPath, fullPage: true });
  console.log(`Saved light mode comparison: ${lightPath}`);

  await browser.close();
}

run().catch(console.error);
