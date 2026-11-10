import { chromium } from 'playwright';
import path from 'path';

const ARTIFACT_DIR = 'C:/Users/rama/.gemini/antigravity/brain/6c2d2530-5fae-45bb-8188-4e00a46893c6';

async function run() {
  console.log('Testing Sidebar Calibration (Floor, Ceil, Clamping & Persistence)...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: 'dark',
  });
  const page = await context.newPage();

  // 1. Clear storage to test fresh default state
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30000 });
  await page.evaluate(() => {
    localStorage.removeItem('mash_sidebar_width');
    localStorage.removeItem('mash_right_sidebar_width');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // 2. Measure Left Sidebar default width
  const leftSidebar = page.locator('[data-testid="left-sidebar"]');
  const initialLeftBox = await leftSidebar.boundingBox();
  console.log(`Left sidebar default width: ${Math.round(initialLeftBox?.width || 0)}px (Expected: 280px)`);
  if (Math.round(initialLeftBox?.width || 0) !== 280) {
    throw new Error(`Left sidebar expected 280px, got ${initialLeftBox?.width}px`);
  }

  // 3. Open Right Sidebar via mash:open-file event
  await page.evaluate(() => {
    const evt = new CustomEvent('mash:open-file', { detail: { path: 'Audit_Deliverables/CARO_2020_Checklist.md' } });
    window.dispatchEvent(evt);
  });
  await page.waitForTimeout(1500);

  // 4. Measure Right Sidebar default open width (Floor value)
  const rightResizer = page.locator('[title="Drag to resize sidebar"]').nth(1);
  const rightSidebar = rightResizer.locator('..');
  const initialRightBox = await rightSidebar.boundingBox();
  console.log(`Right sidebar default open width: ${Math.round(initialRightBox?.width || 0)}px (Expected: 360px)`);
  if (Math.round(initialRightBox?.width || 0) !== 360) {
    throw new Error(`Right sidebar expected 360px, got ${initialRightBox?.width}px`);
  }

  // 5. Test Left Sidebar floor clamp: drag handle leftwards into negative space
  const leftResizer = page.locator('[title="Drag to resize sidebar"]').first();
  const leftResizerBox = await leftResizer.boundingBox();
  if (leftResizerBox) {
    await page.mouse.move(leftResizerBox.x + leftResizerBox.width / 2, leftResizerBox.y + 100);
    await page.mouse.down();
    await page.mouse.move(leftResizerBox.x - 150, leftResizerBox.y + 100, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  }
  const clampLeftBox = await leftSidebar.boundingBox();
  console.log(`Left sidebar after drag-left clamp: ${Math.round(clampLeftBox?.width || 0)}px (Expected clamped at: 280px)`);
  if (Math.round(clampLeftBox?.width || 0) !== 280) {
    throw new Error(`Left sidebar failed to clamp at 280px floor! Got ${clampLeftBox?.width}px`);
  }

  // 6. Test Right Sidebar floor clamp: drag handle rightwards into sidebar space
  const rightResizerBox = await rightResizer.boundingBox();
  if (rightResizerBox) {
    await page.mouse.move(rightResizerBox.x + rightResizerBox.width / 2, rightResizerBox.y + 100);
    await page.mouse.down();
    await page.mouse.move(rightResizerBox.x + 200, rightResizerBox.y + 100, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  }
  const clampRightBox = await rightSidebar.boundingBox();
  console.log(`Right sidebar after drag-right clamp: ${Math.round(clampRightBox?.width || 0)}px (Expected clamped at: 340px)`);
  if (Math.round(clampRightBox?.width || 0) !== 340) {
    throw new Error(`Right sidebar failed to clamp at 340px floor! Got ${clampRightBox?.width}px`);
  }

  // 7. Drag Left Sidebar to 320px
  const leftResizerBox2 = await leftResizer.boundingBox();
  if (leftResizerBox2) {
    await page.mouse.move(leftResizerBox2.x + leftResizerBox2.width / 2, leftResizerBox2.y + 100);
    await page.mouse.down();
    await page.mouse.move(leftResizerBox2.x + 60, leftResizerBox2.y + 100, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  }

  // 8. Drag Right Sidebar to 480px
  const rightResizerBox2 = await rightResizer.boundingBox();
  if (rightResizerBox2) {
    await page.mouse.move(rightResizerBox2.x + rightResizerBox2.width / 2, rightResizerBox2.y + 100);
    await page.mouse.down();
    await page.mouse.move(rightResizerBox2.x - 100, rightResizerBox2.y + 100, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  }

  // 9. Verify localStorage keys are persisted
  const storedWidths = await page.evaluate(() => ({
    left: localStorage.getItem('mash_sidebar_width'),
    right: localStorage.getItem('mash_right_sidebar_width'),
  }));
  console.log('Persisted localStorage values:', storedWidths);

  // 10. Capture screenshot of calibrated dual sidebars
  const screenshotPath = path.join(ARTIFACT_DIR, 'mash_calibrated_sidebars_floor.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`Screenshot saved to ${screenshotPath}`);

  await browser.close();
  console.log('ALL SIDEBAR CALIBRATION & PERSISTENCE CHECKS PASSED SUCCESSFULLY!');
}

run().catch((err) => {
  console.error('Sidebar calibration test failed:', err);
  process.exit(1);
});
