import { chromium } from 'playwright';
import path from 'path';

const ARTIFACT_DIR = 'C:/Users/rama/.gemini/antigravity/brain/6c2d2530-5fae-45bb-8188-4e00a46893c6';

const VIEWPORTS = [
  { name: '1280x720 (150% Laptop)', width: 1280, height: 720 },
  { name: '1366x768 (Standard 14in)', width: 1366, height: 768 },
  { name: '1536x864 (125% Windows User Config)', width: 1536, height: 864 },
  { name: '1920x1080 (100% Desktop FHD)', width: 1920, height: 1080 },
  { name: '2560x1440 (QHD 27in Monitor)', width: 2560, height: 1440 },
];

async function run() {
  console.log('Testing Screen Matrix & Pixel Math across 5 Resolutions...');
  const browser = await chromium.launch({ headless: true });

  const results = [];

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      colorScheme: 'dark',
    });
    const page = await context.newPage();
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30000 });

    // Ensure left sidebar is 280px and right sidebar is 380px
    await page.evaluate(() => {
      localStorage.setItem('mash_sidebar_width', '280');
      localStorage.setItem('mash_right_sidebar_width', '380');
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Open right sidebar
    await page.evaluate(() => {
      const evt = new CustomEvent('mash:open-file', { detail: { path: 'Audit_Deliverables/CARO_2020_Checklist.md' } });
      window.dispatchEvent(evt);
    });
    await page.waitForTimeout(1000);

    const metrics = await page.evaluate(() => {
      const leftEl = document.querySelector('[data-testid="left-sidebar"]');
      const rightResizer = document.querySelectorAll('[title="Drag to resize sidebar"]')[1];
      const rightEl = rightResizer ? rightResizer.parentElement : null;
      const centerEl = document.querySelector('main > div:nth-child(2)');

      return {
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
        leftWidth: leftEl ? leftEl.getBoundingClientRect().width : 0,
        rightWidth: rightEl ? rightEl.getBoundingClientRect().width : 0,
        centerWidth: centerEl ? centerEl.getBoundingClientRect().width : 0,
      };
    });

    results.push({ ...vp, ...metrics });

    // Capture screenshot for the user's specific screen tier (1536x864) and standard 1920x1080
    if (vp.width === 1536 || vp.width === 1920) {
      const ssPath = path.join(ARTIFACT_DIR, `mash_screen_tier_${vp.width}.png`);
      await page.screenshot({ path: ssPath });
      console.log(`Saved screenshot for ${vp.name} to ${ssPath}`);
    }

    await context.close();
  }

  console.log('Screen Matrix Results:');
  console.table(results);

  await browser.close();
}

run().catch((err) => {
  console.error('Screen matrix test failed:', err);
  process.exit(1);
});
