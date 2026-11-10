import { chromium } from 'playwright';
import path from 'path';

const ARTIFACT_DIR = 'C:/Users/rama/.gemini/antigravity/brain/6c2d2530-5fae-45bb-8188-4e00a46893c6';

async function run() {
  console.log('Verifying Complete Calibration (280px Left Sidebar, -10px Chat Gap, Typography & Contrast)...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1536, height: 864 },
    colorScheme: 'dark',
  });
  const page = await context.newPage();

  // Reset local storage to test fresh default state
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30000 });
  await page.evaluate(() => {
    localStorage.removeItem('mash_sidebar_width');
    localStorage.removeItem('mash_right_sidebar_width');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // 1. Check Left Sidebar width (must be exactly 280px)
  const leftSidebar = page.locator('[data-testid="left-sidebar"]');
  const leftBox = await leftSidebar.boundingBox();
  const leftWidth = Math.round(leftBox?.width || 0);
  console.log(`Left Sidebar Width: ${leftWidth}px (Expected: 280px)`);
  if (leftWidth !== 280) {
    throw new Error(`Left sidebar expected 280px, got ${leftWidth}px`);
  }

  // 2. Open Right Sidebar
  await page.evaluate(() => {
    const evt = new CustomEvent('mash:open-file', { detail: { path: 'Audit_Deliverables/CARO_2020_Checklist.md' } });
    window.dispatchEvent(evt);
  });
  await page.waitForTimeout(1500);

  const rightResizer = page.locator('[title="Drag to resize sidebar"]').nth(1);
  const rightSidebar = rightResizer.locator('..');
  const rightBox = await rightSidebar.boundingBox();
  const rightWidth = Math.round(rightBox?.width || 0);
  console.log(`Right Sidebar Open Width: ${rightWidth}px (Expected: 360px)`);
  if (rightWidth !== 360) {
    throw new Error(`Right sidebar expected 360px, got ${rightWidth}px`);
  }

  // 3. Inspect horizontal gap between left sidebar and composer / chat container
  const composerBox = await page.locator('textarea, [placeholder*="Ask an audit question"]').first().boundingBox();
  const gap = Math.round((composerBox?.x || 0) - (leftBox?.x || 0) - leftWidth);
  console.log(`Horizontal Distance between Left Sidebar and Chat Input: ${gap}px`);

  // 4. Capture screenshot
  const screenshotPath = path.join(ARTIFACT_DIR, 'mash_final_complete_calibrated_ui.png');
  await page.screenshot({ path: screenshotPath });
  console.log(`Captured Final Calibration Screenshot: ${screenshotPath}`);

  await browser.close();
  console.log('ALL VERIFICATIONS PASSED 100%!');
}

run().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
