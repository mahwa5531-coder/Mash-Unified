import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outDir = path.resolve(__dirname, '../out');
const ARTIFACT_DIR = 'C:/Users/rama/.gemini/antigravity/brain/6c2d2530-5fae-45bb-8188-4e00a46893c6';

let authState = {
  authenticated: true,
  email: "auditor@mash.ai",
  name: "Senior Auditor",
  plan: "pro",
  subscription_status: "active",
  credits_remaining: 500,
  quota: { windows: [{ window: "weekly", percent: 12 }] },
  accounts: [{ email: "auditor@mash.ai", name: "Senior Auditor", plan: "pro", credits_remaining: 500 }]
};

const PORT = 8765;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const pathname = url.pathname;

  if (pathname === '/api/auth/me') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(authState));
    return;
  }
  if (pathname === '/api/auth/config') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ gateway_url: "https://api.mash.ai", auth_required: false, env: "development" }));
    return;
  }
  if (pathname === '/api/system/updates') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: "idle", version: "1.2.0" }));
    return;
  }
  if (pathname === '/api/projects') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      projects: [{ id: "proj_1", name: "FY2026 SOX Testing", is_active: true }]
    }));
    return;
  }
  if (pathname === '/sessions') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      sessions: [
        {
          session_id: "sess_01",
          title: "General Ledger Anomalies Review",
          custom_title: "General Ledger Anomalies Review",
          workspace_uri: "C:/Audits/SOX_Q3",
          created_at: Date.now() - 3600000,
          updated_at: Date.now(),
          message_count: 2,
          total_tokens: 1840,
          last_user_view_time: Date.now(),
          has_unread: false
        }
      ]
    }));
    return;
  }
  if (pathname.includes('/transcript')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      total: 2,
      lines: [
        {
          id: "m_user_1",
          session_id: "sess_01",
          turn_id: "turn_1",
          role: "user",
          content: "Audit the Q3 accounts receivable ledger for duplicate invoice numbers and unapproved discounts.",
          created_at: new Date().toISOString()
        },
        {
          id: "m_asst_1",
          session_id: "sess_01",
          turn_id: "turn_1",
          role: "assistant",
          content: "### Executive Audit Findings: Q3 Accounts Receivable\n\nI have scanned all **14,208 transactions** in `AR_ledger_q3.csv` against internal control thresholds:\n\n1. **Duplicate Invoice Anomaly (High Risk)**: Found 3 transactions sharing vendor ID `VND-4882` with identical amounts (`$14,283.33`) submitted across consecutive days.\n2. **Unauthorized Discount Exception**: Line item #9021 features a manual `25%` credit override executed without controller sign-off (policy limit: `10%`).\n\n```python\n# Audit Verification Rule\ndef verify_discount_threshold(discount_pct, authorized_limit=0.10):\n    if discount_pct > authorized_limit:\n        raise ControlException(f'Threshold breached: {discount_pct:.1%}')\n```\n\nAll working papers have been generated and cross-referenced.",
          created_at: new Date().toISOString(),
          thoughts: [
            "Parsed general ledger CSV stream using vectorized pandas parser",
            "Indexed transaction UUIDs and identified 3 duplicate invoices totaling $42,850",
            "Queried authorization matrix: 25% discount override exceeded CFO tier 2 approval limit"
          ],
          tools: [
            {
              id: "tc_1",
              name: "replace_file_content",
              toolAction: "Applying control patch",
              toolSummary: "Flag anomalous invoice records",
              args: { TargetFile: "controls/ar_rules.py" },
              output: "Successfully flagged 3 records",
              status: "completed"
            }
          ]
        }
      ]
    }));
    return;
  }
  if (pathname.includes('/view')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  let filePath = path.join(outDir, pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(filePath)) {
    if (fs.existsSync(filePath + '.html')) {
      filePath = filePath + '.html';
    } else {
      filePath = path.join(outDir, 'index.html');
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2'
  };

  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, async () => {
  console.log(`Mock server listening on http://127.0.0.1:${PORT}`);
  try {
    const browser = await chromium.launch();
    
    // --- PART A: Desktop Workspace & Update States (Past, Present, Future) ---
    const context = await browser.newContext({
      viewport: { width: 1440, height: 920 },
      colorScheme: 'dark'
    });
    
    await context.addInitScript(() => {
      window.__MASH_DESKTOP__ = {
        apiUrl: 'http://127.0.0.1:8765',
        platform: 'win32',
        isDesktop: true
      };
      window.electronAPI = {
        minimize: () => {},
        maximize: () => {},
        close: () => {},
        restartAndInstall: () => console.log('restartAndInstall called'),
        onUpdateDownloading: (cb) => { window.__onUpdateDownloading = cb; },
        onUpdateReady: (cb) => { window.__onUpdateReady = cb; }
      };
    });

    const page = await context.newPage();
    console.log('Navigating to workspace session...');
    await page.goto(`http://127.0.0.1:${PORT}/?session=sess_01`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Expand thinking accordion if present
    const accordionBtn = page.locator('button:has-text("Thought")').first();
    if (await accordionBtn.count() > 0) {
      await accordionBtn.click().catch(() => {});
      await page.waitForTimeout(400);
    }

    // 1. PAST / IDLE STATE: Normal Toolbar & Full Live Conversation
    console.log('Capturing State 1: Past / Idle Workspace with Live Chat...');
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mash_ui_state_1_idle_workspace.png') });
    
    const toolbar = page.locator('div[class*="border-b"][class*="px-3"]').first();
    if (await toolbar.count() > 0) {
      await toolbar.screenshot({ path: path.join(ARTIFACT_DIR, 'mash_ui_toolbar_state_1_idle.png') });
    }

    // 2. PRESENT / DOWNLOADING STATE: "downloading...." in toolbar
    console.log('Triggering State 2: Downloading...');
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('mash:update-state', {
        detail: { status: 'downloading', progress: 45, version: '1.2.1' }
      }));
    });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mash_ui_state_2_downloading_workspace.png') });
    if (await toolbar.count() > 0) {
      await toolbar.screenshot({ path: path.join(ARTIFACT_DIR, 'mash_ui_toolbar_state_2_downloading.png') });
    }

    // 3. FUTURE / READY STATE: "[ restart -> ]" Blue Capsule Pill
    console.log('Triggering State 3: Ready to Restart...');
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('mash:update-state', {
        detail: { status: 'ready', version: '1.2.1' }
      }));
    });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mash_ui_state_3_ready_restart_workspace.png') });
    if (await toolbar.count() > 0) {
      await toolbar.screenshot({ path: path.join(ARTIFACT_DIR, 'mash_ui_toolbar_state_3_ready_restart.png') });
    }

    // 4. Assistant Response Macro (Typography, Thinking block, Code snippet)
    const assistantTurn = page.locator('div:has-text("Executive Audit Findings")').last();
    if (await assistantTurn.count() > 0) {
      await assistantTurn.screenshot({ path: path.join(ARTIFACT_DIR, 'mash_ui_audit_turn_detail.png') });
      console.log('Saved mash_ui_audit_turn_detail.png');
    }

    await browser.close();
    console.log('Live workspace states captured successfully!');
  } catch (err) {
    console.error('Error during capture:', err);
  } finally {
    server.close();
    process.exit(0);
  }
});
