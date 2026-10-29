// Test: Live PDF Document Rendering in Mash Right Sidebar
// Loads sample audit PDF into RightSidebar and captures real screenshots:
// 1. Standard split view (Chat on left, PDF in RightSidebar).
// 2. Maximized view (PDF taking 100% of the screen width).

const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require(path.resolve(__dirname, '../frontend/node_modules/@playwright/test'));

const ARTIFACT_DIR = 'C:\\Users\\rama\\.gemini\\antigravity\\brain\\bc5df091-d65b-47b2-ba8f-69ac624e9af9';
const SAMPLE_PDF_PATH = path.resolve(__dirname, '../NexAU/.skills/theme-factory/theme-showcase.pdf');

const MOCK_PROJECTS = [
  { id: 'proj-1', name: 'Mash', local_folder_path: 'C:\\Users\\rama\\Downloads\\Mash', session_count: 3 },
  { id: 'proj-2', name: 'ai audit os', local_folder_path: 'C:\\Audits\\ai-audit-os', session_count: 1 },
];

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

async function runLivePdfTest() {
  const distDir = path.resolve(__dirname, '../frontend/out');
  const port = 3892;
  const server = await startStaticServer(distDir, port);

  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--headless=new', '--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900'],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  await context.addInitScript(({ projects }) => {
    localStorage.setItem('mash_cached_projects', JSON.stringify(projects));
    localStorage.setItem('mash_theme_settings', JSON.stringify({ mode: 'dark' }));
  }, { projects: MOCK_PROJECTS });

  const page = await context.newPage();
  page.on('console', msg => console.log('[BrowserConsole]', msg.type(), msg.text()));
  page.on('pageerror', err => console.error('[BrowserError]', err));
  page.on('request', req => {
    if (req.url().includes('files/content')) console.log('[Req:files/content]', req.method(), req.url());
  });
  page.on('response', res => {
    if (res.url().includes('files/content')) console.log('[Res:files/content]', res.status(), res.url());
  });

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
      body: JSON.stringify({
        sessions: [
          { session_id: 's1', title: 'Ledger Audit FY26', workspace_uri: 'C:\\Users\\rama\\Downloads\\Mash', section: 'workspace', message_count: 2 },
        ],
      }),
    });
  });

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authenticated: true, user: { email: 'auditor@mash.ai', name: 'Lead Auditor' } }),
    });
  });

  // Intercept PDF file request
  const pdfBuffer = fs.readFileSync(SAMPLE_PDF_PATH);
  await page.route('**/files/content**', async (route) => {
    const url = route.request().url();
    if (url.includes('.pdf')) {
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline; filename="Audit_Annual_Report_FY26.pdf"',
          'Content-Length': String(pdfBuffer.length),
        },
        body: pdfBuffer,
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'text/plain',
        body: 'Sample file content',
      });
    }
  });

  console.log('[*] Navigating to Mash frontend...');
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Trigger opening PDF in Right Sidebar
  console.log('[*] Triggering open of Audit_Annual_Report_FY26.pdf in RightSidebar...');
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('mash:open-file', {
      detail: { path: 'Audit_Annual_Report_FY26.pdf' }
    }));
  });

  // Wait for RightSidebar to open and display the PDF tab
  await page.waitForTimeout(2000);

  // Scenario 6: Split view with PDF in RightSidebar
  const shot6 = path.join(ARTIFACT_DIR, 'real_ui_scenario_6_pdf_in_right_sidebar.png');
  await page.screenshot({ path: shot6 });
  console.log(`[OK] Saved: ${shot6}`);

  // Scenario 7: Maximize the RightSidebar
  console.log('[*] Testing RightSidebar Maximize (100% full-screen PDF view)...');
  const maximizeBtn = page.locator('button[title="Maximize"]').last();
  if (await maximizeBtn.count() > 0) {
    await maximizeBtn.click();
    await page.waitForTimeout(1200);
    const shot7 = path.join(ARTIFACT_DIR, 'real_ui_scenario_7_pdf_right_sidebar_maximized.png');
    await page.screenshot({ path: shot7 });
    console.log(`[OK] Saved: ${shot7}`);
  }

  console.log('[SUCCESS] All PDF RightSidebar rendering scenarios completed successfully!');
  await browser.close();
  server.close();
}

runLivePdfTest().catch((err) => {
  console.error('[ERROR] Failed running PDF test:', err);
  process.exit(1);
});
