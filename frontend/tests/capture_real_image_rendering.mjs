import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ARTIFACT_DIR = 'C:/Users/rama/.gemini/antigravity/brain/6c2d2530-5fae-45bb-8188-4e00a46893c6';
const REAL_IMAGE_PATH = 'C:/Users/rama/Downloads/Mash/Audit_Deliverables/bci_architecture.png';

const PORT = 8788;
const imageBytes = fs.readFileSync(REAL_IMAGE_PATH);

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
          session_id: "sess_real_image_test",
          project_id: "p1",
          title: "BCI Architecture Analysis",
          updated_at: new Date().toISOString(),
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
      total: 3,
      lines: [
        {
          id: "m_user_1",
          role: "user",
          content: "Please generate the system architecture diagram for our BCI neural signal processing pipeline and summarize the findings.",
          created_at: new Date().toISOString()
        },
        {
          id: "m_asst_step_1",
          role: "assistant",
          content: "",
          created_at: new Date(Date.now() - 3000).toISOString(),
          thoughts: [
            "Parsed neural telemetry pipeline specifications",
            "Synthesized filter cascade and real-time decoding stages",
            "Generated visual exhibit to Audit_Deliverables/bci_architecture.png"
          ],
          tools: [
            {
              id: "tc_img_gen",
              name: "write_file",
              toolAction: "Generating architecture exhibit",
              toolSummary: "Audit_Deliverables/bci_architecture.png",
              args: { Path: "Audit_Deliverables/bci_architecture.png" },
              output: "File saved: 212 KB image",
              status: "completed"
            }
          ]
        },
        {
          id: "m_asst_step_2",
          role: "assistant",
          content: `I have synthesized the neural telemetry pipeline architecture and verified the working papers:

### 1. BCI Signal Processing Architecture Exhibit
![BCI Neural Telemetry Pipeline Architecture](Audit_Deliverables/bci_architecture.png)

### 2. Verified Deliverables & Audit Trail
- Primary Architecture Exhibit: \`Audit_Deliverables/bci_architecture.png\`
- Real-time Sampling Workpaper: \`Audit_Deliverables/sampling_metrics.xlsx\`

> [!NOTE]
> The diagram above reflects deterministic signal filtering and real-time EEG decoding stages verified from source records. Click the image to inspect in full-resolution lightbox or click the file pill to open in the Right Sidebar viewer.`,
          created_at: new Date().toISOString(),
          tools: []
        }
      ]
    }));
    return;
  }

  if (pathname === '/files/content') {
    const p = url.searchParams.get('path') || '';
    if (p.includes('bci_architecture.png') || p.includes('bci.png')) {
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Disposition': 'inline; filename="bci_architecture.png"',
        'Content-Length': imageBytes.length
      });
      res.end(imageBytes);
      return;
    }
    if (p.includes('.xlsx')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ type: 'excel', filename: path.basename(p), path: p }));
      return;
    }
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
    localStorage.setItem('selectedSessionId', 'sess_real_image_test');
    window.__MASH_DESKTOP__ = {
      apiUrl: 'http://localhost:8788',
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

  // Route API calls to mock server
  await page.route('**/api/**', async (route) => {
    const reqUrl = route.request().url();
    const target = reqUrl.replace(/http:\/\/localhost:\d+\/api/, `http://localhost:${PORT}`);
    try {
      const response = await fetch(target, {
        method: route.request().method(),
        headers: route.request().headers(),
        body: route.request().postData() || undefined
      });
      const data = await response.text();
      route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: data
      });
    } catch (err) {
      route.continue();
    }
  });

  // Route files/content to mock server
  await page.route('**/files/content**', async (route) => {
    const reqUrl = route.request().url();
    const target = reqUrl.replace(/http:\/\/localhost:\d+\/files\/content/, `http://localhost:${PORT}/files/content`);
    try {
      const response = await fetch(target);
      const buf = Buffer.from(await response.arrayBuffer());
      route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: buf
      });
    } catch (err) {
      route.continue();
    }
  });

  console.log('Navigating to http://localhost:3000/?session=sess_real_image_test...');
  await page.goto('http://localhost:3000/?session=sess_real_image_test', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'debug_page.png') });
  console.log('Saved debug_page.png');

  // 1. Verify inline image rendered
  const imgElement = page.locator('img[alt*="BCI"]').first();
  await imgElement.waitFor({ state: 'visible', timeout: 8000 });

  const isLoaded = await imgElement.evaluate((img) => img.complete && img.naturalWidth > 0);
  console.log(`Inline image loaded successfully: ${isLoaded}`);

  // Screenshot 1: Inline Chat Image Rendering
  const screenshot1Path = path.join(ARTIFACT_DIR, 'mash_real_image_inline_chat.png');
  await page.screenshot({ path: screenshot1Path });
  console.log(`Captured: ${screenshot1Path}`);

  // 2. Click FilePill to open image in Right Sidebar viewer
  const filePill = page.locator('button:has-text("bci_architecture.png")').first();
  if (await filePill.isVisible()) {
    console.log('Clicking FilePill to open Right Sidebar ImageViewer...');
    await filePill.click();
    await page.waitForTimeout(2000);

    const sidebarImg = page.locator('.flex.items-center.justify-center img[alt*="bci_architecture"]').first();
    await sidebarImg.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

    // Screenshot 2: Right Sidebar Image Viewer
    const screenshot2Path = path.join(ARTIFACT_DIR, 'mash_real_image_right_sidebar_viewer.png');
    await page.screenshot({ path: screenshot2Path });
    console.log(`Captured: ${screenshot2Path}`);
  }

  // 3. Click inline image to open Lightbox Modal
  console.log('Clicking inline image to test Lightbox modal...');
  await imgElement.click();
  await page.waitForTimeout(1000);

  const lightbox = page.locator('[role="dialog"], .fixed.inset-0').first();
  await lightbox.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

  // Screenshot 3: Lightbox Modal
  const screenshot3Path = path.join(ARTIFACT_DIR, 'mash_real_image_lightbox_modal.png');
  await page.screenshot({ path: screenshot3Path });
  console.log(`Captured: ${screenshot3Path}`);

  await browser.close();
  server.close();
  console.log('ALL SCREENSHOTS CAPTURED SUCCESSFULLY!');
  process.exit(0);
});
