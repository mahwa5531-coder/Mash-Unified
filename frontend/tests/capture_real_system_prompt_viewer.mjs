import { chromium } from 'playwright';
import path from 'path';

const ARTIFACT_DIR = 'C:/Users/rama/.gemini/antigravity/brain/6c2d2530-5fae-45bb-8188-4e00a46893c6';
const TARGET_FILE = 'c:/Users/rama/.gemini/antigravity/scratch/system_prompt.md';

async function run() {
  console.log('Launching browser to inspect real agent with system_prompt.md...');
  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: 'dark',
  });

  const page = await context.newPage();

  // 1. Navigate to real agent with ?file=...
  const targetUrl = `http://localhost:3000/?file=${encodeURIComponent(TARGET_FILE)}`;
  console.log(`Navigating to ${targetUrl}...`);
  await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 });

  // 2. Wait for Right Sidebar to open and render content
  console.log('Waiting for Right Sidebar and markdown content to mount...');
  await page.waitForTimeout(3000);

  // Take full split-view screenshot (Chat on left, System Prompt in Right Sidebar on right)
  const splitScreenshot = path.join(ARTIFACT_DIR, 'mash_real_system_prompt_split_view.png');
  await page.screenshot({ path: splitScreenshot, fullPage: false });
  console.log(`Captured: ${splitScreenshot}`);

  // 3. Maximize the Right Sidebar to see full document preview
  console.log('Navigating to maximized view...');
  const maxUrl = `http://localhost:3000/?file=${encodeURIComponent(TARGET_FILE)}&maximized=true`;
  await page.goto(maxUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2500);

  const maxScreenshot = path.join(ARTIFACT_DIR, 'mash_real_system_prompt_maximized.png');
  await page.screenshot({ path: maxScreenshot, fullPage: false });
  console.log(`Captured: ${maxScreenshot}`);

  // 4. Scroll down in the rendered markdown to capture alerts and mermaid section
  console.log('Scrolling down in markdown viewer...');
  await page.evaluate(() => {
    const scroller = document.querySelector('.custom-scrollbar') || document.querySelector('[class*="overflow-auto"]');
    if (scroller) {
      scroller.scrollTop = 600;
    }
  });
  await page.waitForTimeout(1000);

  const scrolledScreenshot = path.join(ARTIFACT_DIR, 'mash_real_system_prompt_alerts.png');
  await page.screenshot({ path: scrolledScreenshot, fullPage: false });
  console.log(`Captured: ${scrolledScreenshot}`);

  await browser.close();
  console.log('REAL AGENT CAPTURE COMPLETE!');
}

run().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
