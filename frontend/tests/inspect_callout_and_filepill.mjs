import { chromium } from 'playwright';
import path from 'path';

const ARTIFACT_DIR = 'C:/Users/rama/.gemini/antigravity/brain/6c2d2530-5fae-45bb-8188-4e00a46893c6';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1200 },
    colorScheme: 'dark',
  });
  const page = await context.newPage();

  await page.goto('http://localhost:3000/design-system', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);

  // 1. Scroll and zoom into Unit 3: Callouts
  const unit3 = page.locator('text=Audit Observation Blockquotes').first();
  await unit3.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  const calloutsCard = page.locator('section:has-text("Audit Observation Blockquotes")');
  await calloutsCard.screenshot({ path: path.join(ARTIFACT_DIR, 'inspect_unit03_callouts_zoom.png') });

  // 2. Scroll and zoom into Unit 4: File Pills
  const unit4 = page.locator('text=Interactive File Pills').first();
  await unit4.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  const pillsCard = page.locator('section:has-text("Interactive File Pills")');
  await pillsCard.screenshot({ path: path.join(ARTIFACT_DIR, 'inspect_unit04_filepills_zoom.png') });

  // 3. Inspect FilePill exact dimensions
  const pillData = await page.$$eval('button[title*="Open"]', (buttons) => {
    return buttons.map((b) => {
      const rect = b.getBoundingClientRect();
      const style = window.getComputedStyle(b);
      const icon = b.querySelector('svg');
      const iconRect = icon ? icon.getBoundingClientRect() : null;
      return {
        title: b.title,
        width: rect.width,
        height: rect.height,
        padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        iconSize: iconRect ? `${iconRect.width}x${iconRect.height}` : 'none',
      };
    });
  });

  console.log('Real FilePill Elements in Unit 4:', pillData.slice(0, 5));

  // 4. Inspect blockquote title elements
  const blockquoteData = await page.$$eval('blockquote', (bqs) => {
    return bqs.map((bq) => {
      const heading = bq.querySelector('div.font-bold');
      const body = bq.querySelector('div:not(.font-bold)');
      const hRect = heading ? heading.getBoundingClientRect() : null;
      const bStyle = heading ? window.getComputedStyle(heading) : null;
      return {
        headingText: heading ? heading.innerText.trim() : null,
        headingHeight: hRect ? hRect.height : null,
        headingFontSize: bStyle ? bStyle.fontSize : null,
        headingLineHeight: bStyle ? bStyle.lineHeight : null,
        headingMarginBottom: bStyle ? bStyle.marginBottom : null,
        bodyMarginTop: body ? window.getComputedStyle(body).marginTop : null,
      };
    });
  });

  console.log('Real Blockquote Callouts in Unit 3:', blockquoteData.slice(0, 5));

  await browser.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
