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

const PORT = 8766;

const pyContent = `# ==============================================================================
# AUDIT VERIFICATION RULE: controls/ar_rules.py
# PROJECT: FY2026 SOX Testing (Inside Project Workspace)
# ==============================================================================

class ControlException(Exception):
    """Raised when an internal control threshold is violated."""
    pass

def verify_discount_threshold(discount_pct: float, authorized_limit: float = 0.10) -> bool:
    """
    Validates whether a manual discount override adheres to policy.
    Discounts exceeding 10% require secondary CFO controller sign-off.
    """
    if discount_pct > authorized_limit:
        raise ControlException(
            f"Control Exception: Manual discount {discount_pct:.1%} exceeds limit of {authorized_limit:.1%}"
        )
    return True

def audit_duplicate_invoices(transactions: list[dict]) -> list[dict]:
    """Identifies invoice hashes submitted multiple times for same vendor amount."""
    seen = set()
    duplicates = []
    for tx in transactions:
        key = (tx['vendor_id'], tx['amount'])
        if key in seen:
            duplicates.append(tx)
        seen.add(key)
    return duplicates
`;

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
          session_id: "sess_proj_01",
          project_id: "proj_1",
          title: "SOX Testing: General Ledger Audit",
          custom_title: "SOX Testing: General Ledger Audit",
          workspace_uri: "C:/Audits/SOX_Q3",
          created_at: Date.now() - 3600000,
          updated_at: Date.now(),
          message_count: 2,
          total_tokens: 1840,
          last_user_view_time: Date.now(),
          has_unread: false
        },
        {
          session_id: "sess_adhoc_02",
          project_id: null,
          title: "Ad-hoc Audit Inquiry (Outside Projects)",
          custom_title: "Ad-hoc Audit Inquiry (Outside Projects)",
          workspace_uri: "No Repo",
          created_at: Date.now() - 7200000,
          updated_at: Date.now() - 1000000,
          message_count: 2,
          total_tokens: 1200,
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
          role: "user",
          content: "Please review the internal control script `controls/ar_rules.py` in our project, and check if we have access to the server configuration file `outside/secret_keys.env` outside the workspace.",
          created_at: new Date().toISOString()
        },
        {
          id: "m_asst_1",
          role: "assistant",
          content: "I evaluated both files under workspace containment boundaries:\n\n1. **Authorized Project File**: Verified `controls/ar_rules.py` inside the project workspace.\n2. **Unauthorized External Path**: Tested external target `outside/secret_keys.env`. This path is outside the project workspace sandbox.\n\nYou can click either file pill below to inspect it in the Right Sidebar viewer.",
          created_at: new Date().toISOString(),
          thoughts: [
            "Checked authorized project workspace roots",
            "Identified controls/ar_rules.py as permitted project source",
            "Identified outside/secret_keys.env as external path outside authorized roots"
          ],
          tools: [
            {
              id: "tc_1",
              name: "replace_file_content",
              toolAction: "Auditing control script",
              toolSummary: "controls/ar_rules.py",
              args: { TargetFile: "controls/ar_rules.py" },
              output: "File verified within project boundary",
              status: "completed"
            },
            {
              id: "tc_2",
              name: "read_file",
              toolAction: "Probing external boundary",
              toolSummary: "outside/secret_keys.env",
              args: { Path: "outside/secret_keys.env" },
              output: "Access denied: Path is outside authorized workspace directories",
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
  if (pathname === '/files/content') {
    const filePath = url.searchParams.get('path') || '';
    console.log(`[MockServer] /files/content requested for: "${filePath}"`);
    
    if (filePath.includes('ar_rules.py')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        type: "text",
        filename: "ar_rules.py",
        path: "controls/ar_rules.py",
        content: pyContent,
        is_truncated: false
      }));
      return;
    }

    if (filePath.includes('secret_keys.env') || filePath.includes('win.ini') || filePath.includes('outside')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        detail: "Access denied: file is outside authorized workspace directories."
      }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: "File not found on local disk" }));
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
    const context = await browser.newContext({
      viewport: { width: 1520, height: 960 },
      colorScheme: 'dark'
    });

    await context.addInitScript(() => {
      window.__MASH_DESKTOP__ = {
        apiUrl: 'http://127.0.0.1:8766',
        platform: 'win32',
        isDesktop: true
      };
      window.electronAPI = {
        minimize: () => {},
        maximize: () => {},
        close: () => {},
        restartAndInstall: () => {},
        onUpdateDownloading: () => {},
        onUpdateReady: () => {}
      };
    });

    const page = await context.newPage();
    console.log('Navigating to session in project...');
    await page.goto(`http://127.0.0.1:${PORT}/?session=sess_proj_01`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Initial Overview
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mash_ui_pills_overview_before_click.png') });

    // STEP 1: Click the INSIDE PROJECT File Pill (`controls/ar_rules.py`)
    console.log('Clicking inside-project file pill: ar_rules.py ...');
    const insidePill = page.locator('button:has-text("ar_rules.py")').first();
    await insidePill.click();
    await page.waitForTimeout(1800);

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mash_ui_pill_click_inside_project_workspace.png') });
    console.log('Saved mash_ui_pill_click_inside_project_workspace.png');

    const rightSidebar = page.locator('aside, div[class*="border-l"]').last();
    if (await rightSidebar.count() > 0) {
      await rightSidebar.screenshot({ path: path.join(ARTIFACT_DIR, 'mash_ui_rightsidebar_inside_project_editor.png') });
      console.log('Saved mash_ui_rightsidebar_inside_project_editor.png');
    }

    // STEP 2: Click the OUTSIDE WORKSPACE File Pill (`secret_keys.env`)
    console.log('Clicking outside-workspace file pill: secret_keys.env ...');
    const outsidePill = page.locator('button:has-text("secret_keys.env")').first();
    await outsidePill.click();
    await page.waitForTimeout(1800);

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mash_ui_pill_click_outside_workspace.png') });
    console.log('Saved mash_ui_pill_click_outside_workspace.png');

    if (await rightSidebar.count() > 0) {
      await rightSidebar.screenshot({ path: path.join(ARTIFACT_DIR, 'mash_ui_rightsidebar_outside_workspace_access_denied.png') });
      console.log('Saved mash_ui_rightsidebar_outside_workspace_access_denied.png');
    }

    // STEP 3: Switch to Ad-Hoc Session (Outside Projects / "No Repo")
    console.log('Switching to Ad-hoc session (outside projects)...');
    const adhocSessionItem = page.locator('div:has-text("Ad-hoc Audit Inquiry")').first();
    if (await adhocSessionItem.count() > 0) {
      await adhocSessionItem.click();
      await page.waitForTimeout(1800);
      await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mash_ui_session_outside_projects.png') });
      console.log('Saved mash_ui_session_outside_projects.png');
    }

    await browser.close();
    console.log('All file pill click and RightSidebar states captured successfully!');
  } catch (err) {
    console.error('Error during capture:', err);
  } finally {
    server.close();
    process.exit(0);
  }
});
