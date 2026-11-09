import { chromium } from 'playwright';
import path from 'path';

const ARTIFACT_DIR = 'C:/Users/rama/.gemini/antigravity/brain/6c2d2530-5fae-45bb-8188-4e00a46893c6';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  });
  const page = await context.newPage();

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Set to 260px
  await page.evaluate(() => {
    localStorage.setItem('mash_sidebar_width', '260');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const leftSidebar = page.locator('[data-testid="left-sidebar"]');
  const path260 = path.join(ARTIFACT_DIR, 'mash_left_sidebar_260px.png');
  await leftSidebar.screenshot({ path: path260 });
  console.log(`Captured 260px Left Sidebar: ${path260}`);

  // Set to 280px
  await page.evaluate(() => {
    localStorage.setItem('mash_sidebar_width', '280');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const path280 = path.join(ARTIFACT_DIR, 'mash_left_sidebar_280px.png');
  await leftSidebar.screenshot({ path: path280 });
  console.log(`Captured 280px Left Sidebar: ${path280}`);

  await browser.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
