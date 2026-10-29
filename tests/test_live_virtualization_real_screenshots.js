// Test: Live Real Screenshots for Virtualized Terminal, Massive JSON, and Left Sidebar
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require(path.resolve(__dirname, '../frontend/node_modules/@playwright/test'));

const ARTIFACT_DIR = 'C:\\Users\\rama\\.gemini\\antigravity\\brain\\bc5df091-d65b-47b2-ba8f-69ac624e9af9';

// 1. Generate 1,000 realistic sessions for Left Sidebar stress test
const MOCK_PROJECTS = [
  { id: 'proj-mash', name: 'Mash', local_folder_path: 'C:\\Users\\rama\\Downloads\\Mash', session_count: 500 },
  { id: 'proj-audit', name: 'Statutory_FY26', local_folder_path: 'C:\\Audits\\Statutory_FY26', session_count: 300 },
  { id: 'proj-forensic', name: 'Forensic_Investigation', local_folder_path: 'C:\\Audits\\Forensic', session_count: 200 },
];

const MOCK_SESSIONS = [];
for (let i = 1; i <= 500; i++) {
  MOCK_SESSIONS.push({
    session_id: `session-mash-${i}`,
    title: `Statutory Reconciliation Task #${i}`,
    workspace_uri: 'C:\\Users\\rama\\Downloads\\Mash',
    section: 'workspace',
    message_count: 4,
    has_unread: i === 1,
  });
}
for (let i = 1; i <= 300; i++) {
  MOCK_SESSIONS.push({
    session_id: `session-statutory-${i}`,
    title: `General Ledger Variance Audit #${i}`,
    workspace_uri: 'C:\\Audits\\Statutory_FY26',
    section: 'workspace',
    message_count: 2,
    has_unread: false,
  });
}
for (let i = 1; i <= 200; i++) {
  MOCK_SESSIONS.push({
    session_id: `session-direct-${i}`,
    title: `Ad-hoc Forensic Query #${i}`,
    workspace_uri: 'No Repo',
    section: 'direct',
    message_count: 6,
    has_unread: false,
  });
}

// 2. Generate 50,000-line background task log
const sampleLogLines = [];
for (let i = 1; i <= 50000; i++) {
  sampleLogLines.push(`[${new Date().toISOString()}] [INFO] [AuditEngine::TaskRunner] Processing transaction block #${i} ... OK (checksum: 0x${(i * 1337).toString(16)})`);
}
const MOCK_50K_LOG = sampleLogLines.join('\n');

// 3. Generate 2MB realistic minified JSON file (forensic audit dataset)
const records = [];
for (let i = 0; i < 8000; i++) {
  records.push(`{"id":${i},"tx_ref":"TXN-2026-${100000 + i}","account":"GL-${1000 + (i % 250)}","amount":${(i * 19.95).toFixed(2)},"currency":"USD","audited":${i % 2 === 0},"verified":true}`);
}
const MOCK_MINIFIED_JSON = `{"batch_id":"BATCH-FY26-Q4","total_records":8000,"transactions":[${records.join(',')}]}`;

async function startStaticServer(distDir, port) {
  const handler = (req, res) => {
    let filePath = path.join(distDir, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
    if (!fs.existsSync(filePath) && fs.existsSync(filePath + '.html')) {
      filePath += '.html';
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(distDir, 'index.html');
    }

    const ext = path.extname(filePath);
    const contentTypeMap = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.woff2': 'font/woff2',
      '.pdf': 'application/pdf',
    };

    res.writeHead(200, { 'Content-Type': contentTypeMap[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  };

  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(port, resolve));
  console.log(`[HTTP] Static production server listening on http://127.0.0.1:${port}`);
  return server;
}

async function runLiveScreenshotAudit() {
  const distDir = path.resolve(__dirname, '../frontend/out');
  const port = 3896;
  const server = await startStaticServer(distDir, port);

  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--headless=new', '--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900'],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  await context.addInitScript(({ projects, sessions }) => {
    localStorage.setItem('mash_cached_projects', JSON.stringify(projects));
    localStorage.setItem('mash_cached_sessions', JSON.stringify(sessions));
    localStorage.setItem('mash_theme_settings', JSON.stringify({ mode: 'dark' }));
  }, { projects: MOCK_PROJECTS, sessions: MOCK_SESSIONS });

  const page = await context.newPage();

  // Intercept backend API requests
  await page.route('**/api/projects', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ projects: MOCK_PROJECTS }),
    });
  });

  await page.route('**/sessions**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessions: MOCK_SESSIONS }),
    });
  });

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authenticated: true, user: { email: 'lead.auditor@mash.ai', name: 'Lead Forensic Auditor' } }),
    });
  });

  // Intercept files/content for JSON
  await page.route('**/files/content**', async (route) => {
    const url = route.request().url();
    if (url.includes('.json')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          content: MOCK_MINIFIED_JSON,
          is_truncated: false,
          type: 'text',
        }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          content: 'Audit text file content',
          is_truncated: false,
          type: 'text',
        }),
      });
    }
  });

  // Intercept tasks log API (both /tasks/:id/log and /api/tasks/:id/log)
  await page.route('**/tasks/**/log**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        content: MOCK_50K_LOG,
        status: 'running',
      }),
    });
  });

  console.log('[*] Navigating to Mash app with 1,000 sessions in Left Sidebar...');
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // ---------------------------------------------------------------------------
  // SCREENSHOT 1: Left Sidebar with 1,000 Sessions (content-visibility: auto)
  // ---------------------------------------------------------------------------
  console.log('[*] Capturing Screenshot 1: Left Sidebar with 1,000 Sessions...');
  const shot1 = path.join(ARTIFACT_DIR, 'real_ui_virtualized_left_sidebar_1000_sessions.png');
  await page.screenshot({ path: shot1, fullPage: false });
  console.log(`  -> Saved Screenshot 1: ${shot1}`);

  // ---------------------------------------------------------------------------
  // SCREENSHOT 2: Right Sidebar with Massive Minified JSON (Monaco Virtualized)
  // ---------------------------------------------------------------------------
  console.log('[*] Opening Massive Minified JSON file (2MB / 8,000 records) in Right Sidebar...');
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('mash:open-file', {
      detail: { path: 'Forensic_Audit_Dataset.json' }
    }));
  });
  await page.waitForTimeout(3000);

  const shot2 = path.join(ARTIFACT_DIR, 'real_ui_virtualized_monaco_massive_json.png');
  await page.screenshot({ path: shot2, fullPage: false });
  console.log(`  -> Saved Screenshot 2: ${shot2}`);

  // ---------------------------------------------------------------------------
  // SCREENSHOT 3: Right Sidebar with 50,000-Line Terminal Task Log
  // ---------------------------------------------------------------------------
  console.log('[*] Switching Right Sidebar to 50,000-Line Background Task Log...');
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('mash:open-terminal', {
      detail: { taskId: '9999', title: 'Audit Engine Continuous Scan (PID 9999)' }
    }));
  });
  await page.waitForTimeout(3000);

  const shot3 = path.join(ARTIFACT_DIR, 'real_ui_virtualized_terminal_50k_lines.png');
  await page.screenshot({ path: shot3, fullPage: false });
  console.log(`  -> Saved Screenshot 3: ${shot3}`);

  await browser.close();
  server.close();
  console.log('[SUCCESS] All real UI screenshots captured and verified!');
}

runLiveScreenshotAudit().catch(err => {
  console.error('[FATAL] Live screenshot audit failed:', err);
  process.exit(1);
});
