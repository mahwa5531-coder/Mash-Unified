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

const PORT = 8877;

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

  if (pathname === '/api/auth/me' || pathname === '/api/auth/profile' || pathname === '/auth/profile') {
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
      projects: [{ id: "proj_1", name: "SOX_Q3", local_folder_path: "C:/Audits/SOX_Q3", is_active: true }]
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
          repo_name: "SOX_Q3",
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
          content: "### Executive Audit Findings: Q3 Accounts Receivable\n\nI have scanned all **14,208 transactions** in `AR_ledger_q3.csv` against internal control thresholds:\n\n1. **Duplicate Invoice Anomaly (High Risk)**: Found 3 transactions sharing vendor ID `VND-4882` with identical amounts (`$14,283.33`) submitted across consecutive days.\n2. **Unauthorized Discount Exception**: Line item #9021 features a manual `25%` credit override executed without controller sign-off (policy limit: `10%`).\n\nAll working papers have been generated and cross-referenced.",
          created_at: new Date().toISOString()
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
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 920 },
      colorScheme: 'dark'
    });

    await context.addInitScript(() => {
      window.__MASH_DESKTOP__ = {
        apiUrl: 'http://127.0.0.1:8877',
        platform: 'win32',
        isDesktop: true
      };
      window.electronAPI = {
        minimize: () => {},
        maximize: () => {},
        close: () => {},
        checkForUpdates: () => console.log('checkForUpdates called'),
        restartAndInstall: () => console.log('restartAndInstall called'),
        onUpdateDownloading: (cb) => { window.__onUpdateDownloading = cb; },
        onUpdateReady: (cb) => { window.__onUpdateReady = cb; }
      };
      try {
        localStorage.setItem('mash_auth_token', 'mock_token');
        localStorage.setItem('mash_user_profile', JSON.stringify({
          authenticated: true,
          email: "auditor@mash.ai",
          name: "Senior Auditor",
          plan: "pro"
        }));
        localStorage.setItem('mash_sidebar_open_folders', JSON.stringify({ 'SOX_Q3': true }));
      } catch {}
    });

    const page = await context.newPage();
    console.log('Navigating to workspace session...');
    await page.goto(`http://127.0.0.1:${PORT}/?session=sess_01`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // 1. CAPTURE CHAT TOOLBAR & BREADCRUMBS
    console.log('Capturing Screenshot 1: Full App Overview with Breadcrumbs...');
    const fullAppPath = path.join(ARTIFACT_DIR, 'mash_real_app_with_breadcrumbs.png');
    await page.screenshot({ path: fullAppPath });
    console.log('Saved:', fullAppPath);

    const toolbar = page.locator('#chat-top-toolbar');
    if (await toolbar.count() > 0) {
      const toolbarPath = path.join(ARTIFACT_DIR, 'mash_real_chat_toolbar.png');
      await toolbar.screenshot({ path: toolbarPath });
      console.log('Saved:', toolbarPath);
    }

    const breadcrumbNav = page.locator('#chat-top-toolbar nav[aria-label="breadcrumb"]');
    if (await breadcrumbNav.count() > 0) {
      const breadcrumbPath = path.join(ARTIFACT_DIR, 'mash_real_breadcrumb_zoomed.png');
      await breadcrumbNav.screenshot({ path: breadcrumbPath });
      console.log('Saved:', breadcrumbPath);
    }

    // 2. CAPTURE DELETE SESSION CONFIRMATION DIALOG
    console.log('Triggering Session Delete Context Menu...');
    const sessionItem = page.locator('[data-session-item="sess_01"]').first();
    if (await sessionItem.count() > 0) {
      await sessionItem.click({ button: 'right' });
      await page.waitForTimeout(400);

      const deleteMenuItem = page.locator('div[role="menuitem"]:has-text("Delete")').first();
      if (await deleteMenuItem.count() > 0) {
        console.log('Clicking Delete in Context Menu...');
        await deleteMenuItem.click();
        await page.waitForTimeout(600);

        console.log('Capturing Screenshot 2: Delete Session Modal in DeleteConfirmDialog.tsx...');
        const sessionDialogPath = path.join(ARTIFACT_DIR, 'mash_real_delete_session_dialog.png');
        await page.screenshot({ path: sessionDialogPath });
        console.log('Saved:', sessionDialogPath);

        // Cancel the dialog to reset for project delete test
        const cancelBtn = page.locator('button:has-text("Cancel")').first();
        if (await cancelBtn.count() > 0) {
          await cancelBtn.click();
          await page.waitForTimeout(500);
        }
      } else {
        console.log('Could not find div[role="menuitem"]:has-text("Delete")');
      }
    }

    // 3. CAPTURE DELETE PROJECT CONFIRMATION DIALOG
    console.log('Triggering Project Options Menu...');
    const projectFolder = page.locator('.group\\/folder').first();
    if (await projectFolder.count() > 0) {
      // Hover folder to show actions
      await projectFolder.hover();
      await page.waitForTimeout(300);

      const projectOptionsBtn = projectFolder.locator('button[aria-label="Project options"]').first();
      if (await projectOptionsBtn.count() > 0) {
        console.log('Clicking Project Options Button...');
        await projectOptionsBtn.click();
        await page.waitForTimeout(400);

        const deleteProjectMenuItem = page.locator('[role="menuitem"]:has-text("Delete Project")').first();
        if (await deleteProjectMenuItem.count() > 0) {
          console.log('Clicking Delete Project menuitem...');
          await deleteProjectMenuItem.click();
          await page.waitForTimeout(600);

          console.log('Capturing Screenshot 3: Delete Project Modal in DeleteConfirmDialog.tsx...');
          const projectDialogPath = path.join(ARTIFACT_DIR, 'mash_real_delete_project_dialog.png');
          await page.screenshot({ path: projectDialogPath });
          console.log('Saved:', projectDialogPath);
        } else {
          console.log('Could not find [role="menuitem"]:has-text("Delete Project")');
        }
      } else {
        console.log('Could not find button[aria-label="Project options"]');
      }
    }

    await browser.close();
    console.log('ALL REAL APP SCREENSHOTS CAPTURED SUCCESSFULLY!');
  } catch (err) {
    console.error('Error during capture:', err);
  } finally {
    server.close();
    process.exit(0);
  }
});
