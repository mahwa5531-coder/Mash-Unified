import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outDir = path.resolve(__dirname, '../out');
const workspaceDir = path.resolve(__dirname, '../../');
const ARTIFACT_DIR = 'C:/Users/rama/.gemini/antigravity/brain/6c2d2530-5fae-45bb-8188-4e00a46893c6';

const PORT = 8899;

const authState = {
  authenticated: true,
  email: "auditor@mash.ai",
  name: "Senior Forensic Auditor",
  plan: "pro",
  subscription_status: "active",
  credits_remaining: 500,
  quota: { windows: [{ window: "weekly", percent: 8 }] },
  accounts: [{ email: "auditor@mash.ai", name: "Senior Forensic Auditor", plan: "pro", credits_remaining: 500 }]
};

const deliverablesList = [
  {
    name: "Q3_Financial_Forensic_Workpaper.xlsx",
    path: "Q3_Financial_Forensic_Workpaper.xlsx",
    rel_path: "Audit_Deliverables/Q3_Financial_Forensic_Workpaper.xlsx",
    group: "deliverables",
    size: 13185
  },
  {
    name: "Bike Sales Project.xlsx",
    path: "Bike Sales Project.xlsx",
    rel_path: "Audit_Deliverables/Bike Sales Project.xlsx",
    group: "deliverables",
    size: 204978
  },
  {
    name: "alphabet_10k_financials.xlsx",
    path: "alphabet_10k_financials.xlsx",
    rel_path: "Audit_Deliverables/alphabet_10k_financials.xlsx",
    group: "deliverables",
    size: 158356
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
  if (pathname === '/api/projects') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      projects: [{ id: "proj_1", name: "Forensic_Audit_Q3", local_folder_path: "C:/Audits/Forensic_Audit_Q3", is_active: true }]
    }));
    return;
  }
  if (pathname === '/sessions') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      sessions: [
        {
          session_id: "sess_excel_01",
          title: "Q3 2026 Forensic Audit & Financial Analysis",
          custom_title: "Q3 2026 Forensic Audit & Financial Analysis",
          workspace_uri: "C:/Audits/Forensic_Audit_Q3",
          repo_name: "Forensic_Audit_Q3",
          created_at: Date.now() - 3600000,
          updated_at: Date.now(),
          message_count: 2,
          total_tokens: 2450,
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
          session_id: "sess_excel_01",
          turn_id: "turn_1",
          role: "user",
          content: "Audit the Q3 financial performance, consolidate the general ledger, and calculate budget variances.",
          created_at: new Date().toISOString()
        },
        {
          id: "m_asst_1",
          session_id: "sess_excel_01",
          turn_id: "turn_1",
          role: "assistant",
          content: "### Forensic Audit Complete: Q3 Financial Summary\n\nI have generated the comprehensive multi-sheet forensic model: `Q3_Financial_Forensic_Workpaper.xlsx`.\n\n- **Executive Summary**: Consolidated quarterly revenue vs expenses with visual variance charts.\n- **General Ledger**: Full transaction log with automated anomaly flags on journal vouchers.\n- **Variance Matrix**: Departmental cost-center budget variance tracking.\n\nClick the spreadsheet in the Deliverables panel on the right to inspect it in the virtualized viewer.",
          created_at: new Date().toISOString()
        }
      ]
    }));
    return;
  }
  if (pathname.includes('/artifacts')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      is_project_session: true,
      deliverables: deliverablesList,
      working_papers: [],
      items: deliverablesList,
      files: deliverablesList.map(d => d.rel_path),
      mode: "workspace"
    }));
    return;
  }
  if (pathname === '/files/content') {
    const filePathParam = url.searchParams.get('path') || 'Q3_Financial_Forensic_Workpaper.xlsx';
    const cleanBase = path.basename(filePathParam);
    const candidates = [
      path.resolve(workspaceDir, cleanBase),
      path.resolve(outDir, cleanBase),
      path.resolve(__dirname, '../public', cleanBase)
    ];

    let foundPath = candidates.find(p => fs.existsSync(p));
    if (foundPath) {
      const stat = fs.statSync(foundPath);
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Length': stat.size,
        'Content-Disposition': `attachment; filename="${cleanBase}"`
      });
      fs.createReadStream(foundPath).pipe(res);
      return;
    }
  }
  if (pathname.includes('/view')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Serve static files from out/
  let filePath = path.join(outDir, pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(filePath)) {
    if (fs.existsSync(filePath + '.html')) {
      filePath = filePath + '.html';
    } else {
      filePath = path.join(outDir, 'index.html');
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.listen(PORT, async () => {
  console.log(`Mock server running at http://127.0.0.1:${PORT}`);

  try {
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 2,
      colorScheme: 'dark'
    });

    await context.addInitScript((port) => {
      window.__MASH_DESKTOP__ = {
        apiUrl: `http://127.0.0.1:${port}`,
        appVersion: '1.2.0',
        platform: 'win32'
      };
      localStorage.setItem('mash_user_profile', JSON.stringify({
        authenticated: true,
        email: "auditor@mash.ai",
        name: "Senior Forensic Auditor",
        plan: "pro"
      }));
      localStorage.setItem('mash_active_session', 'sess_excel_01');
      localStorage.setItem('mash_active_project', 'proj_1');
      localStorage.setItem('mash_sidebar_open_folders', JSON.stringify({ 'Forensic_Audit_Q3': true }));
      sessionStorage.setItem('mash_right_sidebar_open', 'true');
    }, PORT);

    const page = await context.newPage();

    // 1. OPEN STANDARD RIGHT SIDEBAR VIEW
    console.log('Navigating with file parameter to trigger RightSidebar open...');
    await page.goto(
      `http://127.0.0.1:${PORT}/?session=sess_excel_01&file=Q3_Financial_Forensic_Workpaper.xlsx`,
      { waitUntil: 'networkidle' }
    );

    // Wait for the Excel viewer to fetch bytes and initialize canvas virtualization
    console.log('Waiting for virtualized spreadsheet canvas to render in Right Sidebar...');
    await page.waitForTimeout(5000);

    // Screenshot 1: Standard Right Sidebar View
    const sidebarScreenshotPath = path.join(ARTIFACT_DIR, 'mash_real_excel_right_sidebar.png');
    await page.screenshot({ path: sidebarScreenshotPath });
    console.log(`Saved: ${sidebarScreenshotPath}`);

    // Zoomed in screenshot of the Right Sidebar Excel Viewer
    const viewerContainer = page.locator('.flex-1.overflow-hidden.bg-\\[var\\(--bg-app\\)\\]').last();
    if (await viewerContainer.isVisible().catch(() => false)) {
      const zoomedCardPath = path.join(ARTIFACT_DIR, 'mash_real_excel_sidebar_zoomed.png');
      await viewerContainer.screenshot({ path: zoomedCardPath });
      console.log(`Saved: ${zoomedCardPath}`);
    }

    // 2. OPEN MAXIMIZED VIEW
    console.log('Navigating with maximized parameter...');
    await page.goto(
      `http://127.0.0.1:${PORT}/?session=sess_excel_01&file=Q3_Financial_Forensic_Workpaper.xlsx&maximized=true`,
      { waitUntil: 'networkidle' }
    );
    await page.waitForTimeout(4000);

    // Screenshot 2: Maximized View
    const maxScreenshotPath = path.join(ARTIFACT_DIR, 'mash_real_excel_maximized.png');
    await page.screenshot({ path: maxScreenshotPath });
    console.log(`Saved: ${maxScreenshotPath}`);

    // 3. SHEET SWITCHING IN MAXIMIZED VIEW
    console.log('Clicking General_Ledger tab in maximized view...');
    const glTab = page.locator('button:has-text("General_Ledger"), div:has-text("General_Ledger")').last();
    if (await glTab.isVisible({ timeout: 4000 }).catch(() => false)) {
      await glTab.click();
      await page.waitForTimeout(2000);

      const glScreenshotPath = path.join(ARTIFACT_DIR, 'mash_real_excel_general_ledger_sheet.png');
      await page.screenshot({ path: glScreenshotPath });
      console.log(`Saved: ${glScreenshotPath}`);
    }

    // 4. OPEN USER'S REAL WORKBOOK FROM DOWNLOADS: Bike Sales Project.xlsx
    console.log('Opening Bike Sales Project.xlsx in maximized view...');
    await page.goto(
      `http://127.0.0.1:${PORT}/?session=sess_excel_01&file=Bike+Sales+Project.xlsx&maximized=true`,
      { waitUntil: 'networkidle' }
    );
    await page.waitForTimeout(5000);

    const bikeScreenshotPath = path.join(ARTIFACT_DIR, 'mash_real_excel_bike_sales.png');
    await page.screenshot({ path: bikeScreenshotPath });
    console.log(`Saved: ${bikeScreenshotPath}`);

    console.log('All real Excel viewer screenshots captured successfully!');
    await browser.close();
  } catch (err) {
    console.error('Error during capture:', err);
  } finally {
    server.close();
    process.exit(0);
  }
});
