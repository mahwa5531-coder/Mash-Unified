import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ARTIFACT_DIR = 'C:/Users/rama/.gemini/antigravity/brain/6c2d2530-5fae-45bb-8188-4e00a46893c6';

const PORT = 8799;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  if (pathname.includes('/auth/me')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      authenticated: true,
      email: "auditor@mash.ai",
      name: "Senior Auditor",
      plan: "pro",
      subscription_status: "active",
      credits_remaining: 500,
      quota: { windows: [{ window: "weekly", percent: 12 }] },
      accounts: [{ email: "auditor@mash.ai", name: "Senior Auditor", plan: "pro", credits_remaining: 500 }]
    }));
    return;
  }

  if (pathname.includes('/projects')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([{ id: "p1", name: "Mash", description: "Default Workspace", color: "#6366f1" }]));
    return;
  }

  if (pathname.includes('/sessions') && !pathname.includes('/transcript')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      sessions: [
        {
          session_id: "sess_multi_turn_deleted_img",
          project_id: "p1",
          title: "Multi-Turn BCI Audit with Deleted Image",
          updated_at: new Date().toISOString(),
          last_user_view_time: Date.now(),
          has_unread: false
        }
      ]
    }));
    return;
  }

  // Accumulated turns: Turn 1 generated image, Turn 2 continued analysis, Turn 3 concluded
  if (pathname.includes('/transcript')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      total: 6,
      lines: [
        // Turn 1: User requested diagram
        {
          id: "turn1_user",
          role: "user",
          content: "Generate the initial BCI telemetry architecture diagram.",
          created_at: new Date(Date.now() - 60000).toISOString()
        },
        {
          id: "turn1_asst_tools",
          role: "assistant",
          content: "",
          created_at: new Date(Date.now() - 55000).toISOString(),
          thoughts: ["Generated visual exhibit into Audit_Deliverables/bci_architecture.png"],
          tools: [
            {
              id: "tc_1",
              name: "write_file",
              toolAction: "Writing architecture diagram",
              toolSummary: "Audit_Deliverables/bci_architecture.png",
              args: { Path: "Audit_Deliverables/bci_architecture.png" },
              output: "File saved: 212 KB image",
              status: "completed"
            }
          ]
        },
        {
          id: "turn1_asst_prose",
          role: "assistant",
          content: `Here is the architecture exhibit from Turn 1:

![BCI Architecture Diagram](Audit_Deliverables/bci_architecture.png)

Referenced artifact: \`Audit_Deliverables/bci_architecture.png\``,
          created_at: new Date(Date.now() - 50000).toISOString(),
          tools: []
        },
        // Turn 2: User asks follow-up
        {
          id: "turn2_user",
          role: "user",
          content: "Now verify the signal acquisition sampling rate and noise threshold.",
          created_at: new Date(Date.now() - 40000).toISOString()
        },
        {
          id: "turn2_asst_prose",
          role: "assistant",
          content: `Sampling rate verified at 1,000 Hz with Butterworth bandpass filter (0.5–100 Hz). SNR is +18.4 dB across all 64 scalp electrodes.`,
          created_at: new Date(Date.now() - 30000).toISOString(),
          tools: []
        },
        // Turn 3: User concludes
        {
          id: "turn3_user",
          role: "user",
          content: "Summarize deliverable status.",
          created_at: new Date(Date.now() - 20000).toISOString()
        },
        {
          id: "turn3_asst_prose",
          role: "assistant",
          content: `All deliverables recorded. Working papers are ready for final sign-off.`,
          created_at: new Date(Date.now() - 10000).toISOString(),
          tools: []
        }
      ]
    }));
    return;
  }

  // Files content: bci_architecture.png is DELETED -> returns 404!
  if (pathname === '/files/content') {
    const p = url.searchParams.get('path') || '';
    console.log(`[MockServer] /files/content requested for deleted file: ${p}`);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: `File '${p}' not found on local disk.` }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
});

server.listen(PORT, async () => {
  console.log(`Mock server listening on port ${PORT}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 2,
    colorScheme: 'dark'
  });

  await context.addInitScript(() => {
    localStorage.setItem('selectedSessionId', 'sess_multi_turn_deleted_img');
    window.__MASH_DESKTOP__ = {
      apiUrl: 'http://localhost:8799',
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
  console.log('Navigating to http://localhost:3000/?session=sess_multi_turn_deleted_img...');
  await page.goto('http://localhost:3000/?session=sess_multi_turn_deleted_img', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  // Capture Screenshot 1: Multi-turn chat showing Turn 1 with deleted image
  const screenshotPath1 = path.join(ARTIFACT_DIR, 'mash_deleted_image_accumulated_turns.png');
  await page.screenshot({ path: screenshotPath1 });
  console.log(`Captured: ${screenshotPath1}`);

  // Now click the FilePill for the deleted image to see what happens in RightSidebar
  const filePill = page.locator('button:has-text("bci_architecture.png")').first();
  if (await filePill.isVisible()) {
    console.log('Clicking FilePill of deleted image to test Right Sidebar...');
    await filePill.click();
    await page.waitForTimeout(2000);

    const screenshotPath2 = path.join(ARTIFACT_DIR, 'mash_deleted_image_right_sidebar_error.png');
    await page.screenshot({ path: screenshotPath2 });
    console.log(`Captured: ${screenshotPath2}`);
  }

  await browser.close();
  server.close();
  console.log('DELETED IMAGE TEST COMPLETE!');
  process.exit(0);
});
