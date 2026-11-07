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

const PORT = 8780;

const sessionList = [
  {
    session_id: "sess_proj_01",
    project_id: "proj_sox",
    title: "SOX Testing: General Controls & Files",
    custom_title: "SOX Testing: General Controls & Files",
    workspace_uri: "C:/Audits/SOX_Q3",
    created_at: Date.now() - 3600000,
    updated_at: Date.now() - 960000,
    message_count: 2,
    total_tokens: 2400,
    last_user_view_time: Date.now(),
    has_unread: false
  },
  {
    session_id: "sess_adhoc_02",
    project_id: null,
    title: "Ad-hoc Desktop Inquiry (Outside Projects)",
    custom_title: "Ad-hoc Desktop Inquiry (Outside Projects)",
    workspace_uri: "No Repo",
    created_at: Date.now() - 7200000,
    updated_at: Date.now() - 1000000,
    message_count: 2,
    total_tokens: 1600,
    last_user_view_time: Date.now(),
    has_unread: false
  },
  {
    session_id: "sess_fixed_assets",
    project_id: "proj_sox",
    title: "Fixed Asset Depreciation & Residuals",
    custom_title: "Fixed Asset Depreciation & Residuals",
    workspace_uri: "C:/Audits/SOX_Q3",
    created_at: Date.now() - 14400000,
    updated_at: Date.now() - 7200000,
    message_count: 5,
    total_tokens: 4200,
    last_user_view_time: Date.now(),
    has_unread: true
  }
];

const projectsList = [
  {
    id: "proj_sox",
    name: "FY2026 SOX Testing",
    local_folder_path: "C:/Audits/SOX_Q3",
    session_count: 2,
    created_at: Date.now() - 86400000,
    updated_at: Date.now()
  }
];

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
  if (pathname === '/api/projects' || pathname === '/projects') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ projects: projectsList }));
    return;
  }
  if (pathname === '/sessions' || pathname === '/api/sessions') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sessions: sessionList }));
    return;
  }
  if (pathname.includes('/transcript')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ total: 1, lines: [] }));
    return;
  }
  if (pathname.includes('/view')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (pathname === '/artifacts' || pathname.startsWith('/artifacts/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ deliverables: [], working_papers: [] }));
    return;
  }
  if (pathname === '/files/content') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ type: "text", filename: "test.py", content: "# Test" }));
    return;
  }

  // Static files from outDir
  let filePath = path.join(outDir, pathname === '/' ? 'index.html' : pathname);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.svg': 'image/svg+xml'
    };
    res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

async function runCapture(label = 'after') {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  console.log(`Server listening at http://127.0.0.1:${PORT}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    colorScheme: 'dark'
  });

  await context.addInitScript(() => {
    window.__MASH_DESKTOP__ = {
      apiUrl: 'http://127.0.0.1:8780',
      platform: 'win32',
      isDesktop: true
    };
    try {
      localStorage.setItem('mash_sidebar_open_folders', JSON.stringify({ 'FY2026 SOX Testing': true }));
    } catch {}
  });

  const page = await context.newPage();
  console.log(`Navigating to app on port ${PORT}...`);
  await page.goto(`http://127.0.0.1:${PORT}/?session=sess_proj_01`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Take full overview screenshot
  const overviewPath = path.join(ARTIFACT_DIR, `mash_${label}_overview.png`);
  await page.screenshot({ path: overviewPath });
  console.log(`Saved overview: ${overviewPath}`);

  // Locate the left sidebar element
  const sidebar = page.locator('div[data-testid="left-sidebar"], div.border-r').first();
  await sidebar.waitFor({ state: 'visible', timeout: 8000 });

  // 1. Normal state capture of sidebar
  const normalPath = path.join(ARTIFACT_DIR, `mash_left_sidebar_${label}_normal.png`);
  await sidebar.screenshot({ path: normalPath });
  console.log(`Saved normal sidebar: ${normalPath}`);

  // 2. Hovered state on second session item (to show hover treatment and 3-dots behavior)
  const hoverRow = page.locator('div[data-session-item="sess_adhoc_02"], div[data-testid="session-item"]:has-text("Ad-hoc")').first();
  if (await hoverRow.count() > 0) {
    await hoverRow.hover();
    await page.waitForTimeout(400);
  }
  const hoverPath = path.join(ARTIFACT_DIR, `mash_left_sidebar_${label}_hover.png`);
  await sidebar.screenshot({ path: hoverPath });
  console.log(`Saved hover sidebar: ${hoverPath}`);

  await browser.close();
  server.close();
  console.log(`Done capturing ${label}!`);
}

const targetLabel = process.argv[2] || 'after';
runCapture(targetLabel);
