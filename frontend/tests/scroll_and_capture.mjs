import { chromium } from 'playwright';

const ARTIFACT_DIR = 'C:/Users/rama/.gemini/antigravity/brain/6c2d2530-5fae-45bb-8188-4e00a46893c6';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, colorScheme: 'dark' });
  await page.goto('http://localhost:3000/?session=sess_01M6GKHJFVMA94Z7V94NW9FN9F', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Click Jump to latest
  const jumpBtn = page.locator('button:has-text("Jump to latest")');
  if (await jumpBtn.count() > 0) {
    console.log('Clicking Jump to latest...');
    await jumpBtn.click();
    await page.waitForTimeout(1000);
  }

  // Find scroll containers and scroll to bottom
  await page.evaluate(() => {
    const scrollables = Array.from(document.querySelectorAll('*')).filter(el => {
      const style = window.getComputedStyle(el);
      return (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
    });
    for (const el of scrollables) {
      el.scrollTop = el.scrollHeight;
    }
  });
  await page.waitForTimeout(1000);

  const headings = await page.locator('h1, h2, h3').allInnerTexts();
  console.log('Headings found:', headings);

  // Capture the full chat view
  await page.screenshot({ path: `${ARTIFACT_DIR}/chat_scrolled_to_showcase.png` });
  console.log('Saved chat_scrolled_to_showcase.png');

  // Capture CodeBlock specifically
  const codeBlocks = page.locator('div:has(> div:has-text("lines"))');
  const cbCount = await codeBlocks.count();
  console.log('CodeBlocks count:', cbCount);
  if (cbCount > 0) {
    const targetCb = codeBlocks.last();
    await targetCb.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await targetCb.screenshot({ path: `${ARTIFACT_DIR}/chat_codeblock_unit17_macro.png` });
    console.log('Saved chat_codeblock_unit17_macro.png');
  }

  // Capture Callouts specifically
  const callout = page.locator('blockquote').last();
  if (await callout.count() > 0) {
    await callout.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await callout.screenshot({ path: `${ARTIFACT_DIR}/chat_callout_unit03_macro.png` });
    console.log('Saved chat_callout_unit03_macro.png');
  }

  // Capture Table specifically
  const table = page.locator('table').last();
  if (await table.count() > 0) {
    const tContainer = table.locator('xpath=ancestor::div[contains(@class, "overflow-x-auto")][1]');
    await tContainer.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await tContainer.screenshot({ path: `${ARTIFACT_DIR}/chat_table_unit15_macro.png` });
    console.log('Saved chat_table_unit15_macro.png');
  }

  // Capture KaTeX Math specifically
  const katex = page.locator('.katex-display').last();
  if (await katex.count() > 0) {
    await katex.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await katex.screenshot({ path: `${ARTIFACT_DIR}/chat_math_katex_macro.png` });
    console.log('Saved chat_math_katex_macro.png');
  }

  await browser.close();
  console.log('Done capturing all macro screenshots!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
