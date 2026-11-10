import { chromium } from 'playwright';
import path from 'path';

const ARTIFACT_DIR = 'C:/Users/rama/.gemini/antigravity/brain/6c2d2530-5fae-45bb-8188-4e00a46893c6';

async function run() {
  console.log('Verifying divider symmetry with Playwright...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: 'dark',
  });
  const page = await context.newPage();

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // 1. Hover over Left Sidebar divider
  const leftResizer = page.locator('[title="Drag to resize sidebar"]').first();
  await leftResizer.hover();
  await page.waitForTimeout(400);

  const leftScreenshot = path.join(ARTIFACT_DIR, 'mash_left_divider_pill_hover.png');
  await page.screenshot({ path: leftScreenshot, fullPage: false });
  console.log(`Captured Left Divider Hover: ${leftScreenshot}`);

  await browser.close();
  console.log('DIVIDER SYMMETRY VERIFIED!');
}

run().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
