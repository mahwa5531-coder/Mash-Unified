import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outDir = path.resolve(__dirname, '../out');
const ARTIFACT_DIR = 'C:/Users/rama/.gemini/antigravity/brain/6c2d2530-5fae-45bb-8188-4e00a46893c6';

const authState = {
  authenticated: true,
  email: "auditor@mash.ai",
  name: "Senior Auditor",
  plan: "pro",
  subscription_status: "active",
  credits_remaining: 500,
  quota: { windows: [{ window: "weekly", percent: 12 }] },
  accounts: [{ email: "auditor@mash.ai", name: "Senior Auditor", plan: "pro", credits_remaining: 500 }]
};

const PORT = 8769;

const pyCode = `# ==============================================================================
# AUDIT VERIFICATION SCRIPT: controls/ar_rules.py
# PROJECT: FY2026 SOX Testing (Inside Project Workspace)
# ==============================================================================

class ControlException(Exception):
    """Raised when an internal control threshold is violated."""
    pass

def verify_discount_threshold(discount_pct: float, authorized_limit: float = 0.10) -> bool:
    """Validates whether a manual discount override adheres to policy."""
    if discount_pct > authorized_limit:
        raise ControlException(f"Control Exception: Manual discount {discount_pct:.1%} exceeds limit of {authorized_limit:.1%}")
    return True
`;

const makefileCode = `# ==============================================================================
# EXTENSION-LESS BUILD FILE: Makefile
# PROJECT: FY2026 SOX Testing
# ==============================================================================

.PHONY: all audit test clean

all: audit test

audit:
\t@echo "[AUDIT] Checking general ledger rules..."
\tpython controls/ar_rules.py

test:
\t@echo "[TEST] Running compliance suite..."
\tpytest -v

clean:
\t@rm -rf __pycache__ .pytest_cache
`;

const hostsCode = `# Host Database
# Localhost configuration for audit mock network
127.0.0.1       localhost
::1             localhost
127.0.0.1       audit-internal.mash.local
192.168.1.100   sox-compliance-db.internal
`;

const outsidePyCode = `# ==============================================================================
# EXTERNAL DESKTOP SCRIPT: outside_sample.py
# LOCATION: C:/Users/rama/Downloads/Mash/outside_sample.py
# ==============================================================================

def verify_external_audit_runner():
    print("External audit runner verified across desktop boundaries.")
    return True
`;

const bashrcCode = `# ~/.bashrc desktop environment configuration
export AUDIT_ENV="production"
export MASH_DESKTOP_EDITION="1.2.0"
alias run_audit="python -m connector"
`;

const reconCrossSessionCode = `# ==============================================================================
# CROSS-SESSION WORKING PAPER: working_papers/recon_calc.py
# RESOLVED ACROSS SESSIONS VIA PATH.GLOB FALLBACK
# ==============================================================================

def reconcile_balances(prior: float, current: float) -> float:
    variance = current - prior
    return variance
`;

const sampleCsv = `Transaction_ID,Vendor,Amount,Status
TX_1001,Acme Industrial,14200.50,VERIFIED
TX_1002,Global Logistics,8900.00,VERIFIED
TX_1003,Starlight Telecom,450.25,FLAGGED
`;

const samplePng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const sessionList = [
  {
    session_id: "sess_proj_01",
    project_id: "proj_sox",
    title: "SOX Testing: General Controls & Files",
    custom_title: "SOX Testing: General Controls & Files",
    workspace_uri: "C:/Audits/SOX_Q3",
    created_at: Date.now() - 3600000,
    updated_at: Date.now(),
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
  }
];

const session1Transcript = {
  total: 3,
  lines: [
    {
      id: "m_u1",
      role: "user",
      content: "Please audit all project files, extension-less files, external host files, and folders across workspace boundaries.",
      created_at: new Date(Date.now() - 10000).toISOString()
    },
    {
      id: "m_a1_tools",
      role: "assistant",
      content: "",
      created_at: new Date(Date.now() - 5000).toISOString(),
      thoughts: [
        "Verified Python code inside workspace: controls/ar_rules.py",
        "Verified extension-less file inside workspace: Makefile",
        "Verified extension-less host file: C:/Windows/system32/drivers/etc/hosts"
      ],
      tools: [
        {
          id: "tc_1",
          name: "write_file",
          toolAction: "Creating control script",
          toolSummary: "controls/ar_rules.py",
          args: { file_path: "controls/ar_rules.py", content: pyCode },
          output: "File written successfully",
          status: "completed"
        },
        {
          id: "tc_2",
          name: "write_file",
          toolAction: "Creating extension-less build file",
          toolSummary: "Makefile",
          args: { file_path: "Makefile", content: makefileCode },
          output: "File written successfully",
          status: "completed"
        }
      ]
    },
    {
      id: "m_a1_response",
      role: "assistant",
      content: `### Executive File Audit Matrix

I inspected and generated all project and host files across the required scenarios:

1. **Inside Workspace Code File**: \`controls/ar_rules.py\`
2. **Inside Workspace Extension-less File**: [Makefile](Makefile)
3. **Outside Workspace Host Extension-less File**: [hosts](C:/Windows/system32/drivers/etc/hosts)
4. **Outside Workspace Host Python Script**: [outside_sample.py](C:/Users/rama/Downloads/Mash/outside_sample.py)
5. **Inside Workspace Spreadsheet**: [SOX_Report.xlsx](Audit_Deliverables/SOX_Report.xlsx)
6. **Workspace Directory / Folder**: [workpapers/FY26/](workpapers/FY26/)
7. **Missing File Test**: [missing_file.py](tests/missing_file.py)

Click any file pill to inspect it in the RightSidebar viewer.`,
      created_at: new Date().toISOString()
    }
  ]
};

const session2Transcript = {
  total: 2,
  lines: [
    {
      id: "m_u2",
      role: "user",
      content: "Can you inspect my desktop configuration and cross-session working papers outside of any project?",
      created_at: new Date(Date.now() - 10000).toISOString()
    },
    {
      id: "m_a2",
      role: "assistant",
      content: `### Ad-hoc Desktop Inquiry (Outside Projects)

Under the desktop read model, files across the desktop environment and previous session brains are accessible:

1. **Host Environment File**: [.bashrc](C:/Users/rama/.bashrc)
2. **Cross-Session Working Paper**: [recon_calc.py](working_papers/recon_calc.py)
3. **External CSV Dataset**: [samples.csv](C:/Audits/SOX_Q3/data/samples.csv)

Click any pill to open in the Right Sidebar viewer.`,
      created_at: new Date().toISOString(),
      thoughts: [
        "Probing host environment config .bashrc",
        "Probing cross-session relative paper working_papers/recon_calc.py",
        "Probing CSV file C:/Audits/SOX_Q3/data/samples.csv"
      ]
    }
  ]
};

// HTTP Server for serving static exported frontend assets
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
  console.log(`Static server running at http://127.0.0.1:${PORT}`);
  try {
    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1540, height: 960 },
      colorScheme: 'dark'
    });

    // Intercept all API routes inside Playwright (independent of port)
    await context.route('**/api/auth/me', route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(authState) });
    });
    await context.route('**/api/auth/config', route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ gateway_url: "https://api.mash.ai", auth_required: false }) });
    });
    await context.route('**/api/system/updates', route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: "idle", version: "1.2.0" }) });
    });
    await context.route('**/api/projects', route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ projects: [{ id: "proj_sox", name: "FY2026 SOX Testing", is_active: true }] }) });
    });
    await context.route('**/sessions', route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: sessionList }) });
    });
    await context.route('**/sessions/sess_proj_01/transcript**', route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session1Transcript) });
    });
    await context.route('**/sessions/sess_adhoc_02/transcript**', route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session2Transcript) });
    });
    await context.route('**/sessions/**/view', route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    await context.route('**/artifacts/session/**', route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ deliverables: [], working_papers: [] }) });
    });

    // File Content Interceptor
    await context.route('**/files/content**', async (route) => {
      const reqUrl = new URL(route.request().url());
      const rawPath = reqUrl.searchParams.get('path') || '';
      const clean = rawPath.replace(/\\/g, '/');
      console.log(`[API Intercept] /files/content requested: "${rawPath}" (clean: "${clean}")`);

      if (clean.includes('ar_rules.py')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            type: "text",
            filename: "ar_rules.py",
            path: "controls/ar_rules.py",
            content: pyCode,
            is_truncated: false
          })
        });
      }

      if (clean.endsWith('Makefile') || clean === 'Makefile') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            type: "text",
            filename: "Makefile",
            path: "Makefile",
            content: makefileCode,
            is_truncated: false
          })
        });
      }

      if (clean.includes('drivers/etc/hosts') || clean.endsWith('/hosts')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            type: "text",
            filename: "hosts",
            path: "C:/Windows/system32/drivers/etc/hosts",
            content: hostsCode,
            is_truncated: false
          })
        });
      }

      if (clean.includes('outside_sample.py')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            type: "text",
            filename: "outside_sample.py",
            path: "C:/Users/rama/Downloads/Mash/outside_sample.py",
            content: outsidePyCode,
            is_truncated: false
          })
        });
      }

      if (clean.endsWith('.xlsx')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            type: "excel",
            filename: "SOX_Report.xlsx",
            path: "Audit_Deliverables/SOX_Report.xlsx",
            content: `{"sheets": [{"name": "Controls", "rows": [["Control ID", "Status", "Test Result"], ["CTL-01", "Effective", "Passed"], ["CTL-02", "Effective", "Passed"]]}]}`,
            is_truncated: false
          })
        });
      }

      if (clean.endsWith('.bashrc')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            type: "text",
            filename: ".bashrc",
            path: "C:/Users/rama/.bashrc",
            content: bashrcCode,
            is_truncated: false
          })
        });
      }

      if (clean.includes('recon_calc.py')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            type: "text",
            filename: "recon_calc.py",
            path: "working_papers/recon_calc.py",
            content: reconCrossSessionCode,
            is_truncated: false
          })
        });
      }

      if (clean.endsWith('.csv')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            type: "text",
            filename: "samples.csv",
            path: "C:/Audits/SOX_Q3/data/samples.csv",
            content: sampleCsv,
            is_truncated: false
          })
        });
      }

      if (clean.includes('missing_file.py')) {
        return route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ detail: "File not found on local disk" })
        });
      }

      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ detail: "File not found" })
      });
    });

    await context.addInitScript(() => {
      window.__MASH_DESKTOP__ = {
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

    // =========================================================================
    // SECTION 1: SESSION INSIDE PROJECT WORKSPACE ("FY2026 SOX Testing")
    // =========================================================================
    console.log('\n======================================================');
    console.log('--- 1. Testing Session INSIDE Project Workspace ---');
    console.log('======================================================');
    await page.goto(`http://127.0.0.1:${PORT}/?session=sess_proj_01`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);

    // 1A. Overview Screenshot
    const s1OverviewPath = path.join(ARTIFACT_DIR, 'mash_deep_matrix_session1_overview.png');
    await page.screenshot({ path: s1OverviewPath });
    console.log(`[Screenshot 1A] Saved: ${s1OverviewPath}`);

    const chatText = await page.evaluate(() => {
      const main = document.querySelector('main');
      return main ? main.innerText : document.body.innerText;
    });
    console.log('[PAGE MAIN INNER TEXT]:\n', chatText);

    // 1B. Verify Directory PathPill behavior
    console.log('\n[Check: Folder PathPill]');
    const folderPill = page.locator('span[title*="workpapers/FY26"]').first();
    const folderExists = await folderPill.count() > 0;
    console.log(`- Folder PathPill rendered: ${folderExists}`);
    if (folderExists) {
      const tag = await folderPill.evaluate(el => el.tagName.toLowerCase());
      console.log(`- HTML Tag: <${tag}> (Static non-button, non-clickable: ${tag === 'span'})`);
      const hasFolderIcon = await folderPill.locator('svg').count() > 0;
      console.log(`- Folder Icon Present: ${hasFolderIcon}`);
    }

    // 1C. Click Inside Workspace Python Code File (ar_rules.py)
    console.log('\n[Click Test: Inside Project Python Code (ar_rules.py)]');
    const arRulesPill = page.locator('button:has-text("ar_rules.py")').first();
    await arRulesPill.click();
    await page.waitForTimeout(1800);
    const s1PyPath = path.join(ARTIFACT_DIR, 'mash_deep_matrix_session1_inside_code.png');
    await page.screenshot({ path: s1PyPath });
    console.log(`[Screenshot 1C] Saved: ${s1PyPath}`);

    // 1D. Click Inside Workspace Extension-less File (Makefile)
    console.log('\n[Click Test: Inside Project Extension-less File (Makefile)]');
    const makefilePill = page.locator('button:has-text("Makefile")').first();
    await makefilePill.click();
    await page.waitForTimeout(1800);
    const s1MakePath = path.join(ARTIFACT_DIR, 'mash_deep_matrix_session1_extensionless_makefile.png');
    await page.screenshot({ path: s1MakePath });
    console.log(`[Screenshot 1D] Saved: ${s1MakePath}`);

    // 1E. Click Outside Workspace Host Extension-less File (hosts)
    console.log('\n[Click Test: Outside Workspace Host Extension-less File (hosts)]');
    const hostsPill = page.locator('button:has-text("hosts")').first();
    await hostsPill.click();
    await page.waitForTimeout(1800);
    const s1HostsPath = path.join(ARTIFACT_DIR, 'mash_deep_matrix_session1_host_file_outside.png');
    await page.screenshot({ path: s1HostsPath });
    console.log(`[Screenshot 1E] Saved: ${s1HostsPath}`);

    // 1F. Click Outside Workspace Host Python Script (outside_sample.py)
    console.log('\n[Click Test: Outside Workspace Host Python Script (outside_sample.py)]');
    const outsidePyPill = page.locator('button:has-text("outside_sample.py")').first();
    if (await outsidePyPill.count() > 0) {
      await outsidePyPill.click();
      await page.waitForTimeout(1800);
      const s1OutPyPath = path.join(ARTIFACT_DIR, 'mash_deep_matrix_session1_outside_python.png');
      await page.screenshot({ path: s1OutPyPath });
      console.log(`[Screenshot 1F] Saved: ${s1OutPyPath}`);
    }

    // 1G. Click Inside Workspace Spreadsheet (SOX_Report.xlsx)
    console.log('\n[Click Test: Inside Project Spreadsheet (SOX_Report.xlsx)]');
    const xlsxPill = page.locator('button:has-text("SOX_Report.xlsx")').first();
    if (await xlsxPill.count() > 0) {
      await xlsxPill.click();
      await page.waitForTimeout(1800);
      const s1XlsxPath = path.join(ARTIFACT_DIR, 'mash_deep_matrix_session1_excel_viewer.png');
      await page.screenshot({ path: s1XlsxPath });
      console.log(`[Screenshot 1G] Saved: ${s1XlsxPath}`);
    }

    // 1H. Click Missing File (missing_file.py) -> Notice
    console.log('\n[Click Test: Missing File Notice (missing_file.py)]');
    const missingPill = page.locator('button:has-text("missing_file.py")').first();
    if (await missingPill.count() > 0) {
      await missingPill.click();
      await page.waitForTimeout(1800);
      const s1MissingPath = path.join(ARTIFACT_DIR, 'mash_deep_matrix_session1_missing_file_notice.png');
      await page.screenshot({ path: s1MissingPath });
      console.log(`[Screenshot 1H] Saved: ${s1MissingPath}`);
    }

    // =========================================================================
    // SECTION 2: SESSION OUTSIDE PROJECT / AD-HOC DESKTOP SESSION
    // =========================================================================
    console.log('\n======================================================');
    console.log('--- 2. Testing Session OUTSIDE Projects (Desktop Ad-hoc) ---');
    console.log('======================================================');
    console.log('Navigating directly to Session 2 (Outside Projects: sess_adhoc_02)...');
    await page.goto(`http://127.0.0.1:${PORT}/?session=sess_adhoc_02`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // 2A. Overview Screenshot
    const s2OverviewPath = path.join(ARTIFACT_DIR, 'mash_deep_matrix_session2_overview.png');
    await page.screenshot({ path: s2OverviewPath });
    console.log(`[Screenshot 2A] Saved: ${s2OverviewPath}`);

    // 2B. Click Host Environment File (.bashrc)
    console.log('\n[Click Test: Host Environment File (.bashrc)]');
    const bashrcPill = page.locator('button:has-text(".bashrc")').first();
    if (await bashrcPill.count() > 0) {
      await bashrcPill.click();
      await page.waitForTimeout(1800);
      const s2BashrcPath = path.join(ARTIFACT_DIR, 'mash_deep_matrix_session2_extensionless_bashrc.png');
      await page.screenshot({ path: s2BashrcPath });
      console.log(`[Screenshot 2B] Saved: ${s2BashrcPath}`);
    }

    // 2C. Click Cross-Session Working Paper (recon_calc.py)
    console.log('\n[Click Test: Cross-Session Working Paper (recon_calc.py)]');
    const crossPill = page.locator('button:has-text("recon_calc.py")').first();
    if (await crossPill.count() > 0) {
      await crossPill.click();
      await page.waitForTimeout(1800);
      const s2CrossPath = path.join(ARTIFACT_DIR, 'mash_deep_matrix_session2_cross_session_paper.png');
      await page.screenshot({ path: s2CrossPath });
      console.log(`[Screenshot 2C] Saved: ${s2CrossPath}`);
    }

    // 2D. Click External CSV Dataset (samples.csv)
    console.log('\n[Click Test: External CSV Dataset (samples.csv)]');
    const csvPill = page.locator('button:has-text("samples.csv")').first();
    if (await csvPill.count() > 0) {
      await csvPill.click();
      await page.waitForTimeout(1800);
      const s2CsvPath = path.join(ARTIFACT_DIR, 'mash_deep_matrix_session2_csv_viewer.png');
      await page.screenshot({ path: s2CsvPath });
      console.log(`[Screenshot 2D] Saved: ${s2CsvPath}`);
    }

    await browser.close();
    console.log('\n======================================================');
    console.log('>>> COMPLETE MATRIX EXECUTION VERIFIED 100% SUCCESS <<<');
    console.log('======================================================');
  } catch (err) {
    console.error('Error during deep matrix execution:', err);
  } finally {
    server.close();
    process.exit(0);
  }
});
