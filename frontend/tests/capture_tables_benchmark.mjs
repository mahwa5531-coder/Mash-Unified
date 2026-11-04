import { chromium } from 'playwright';

const ARTIFACT_DIR = 'C:/Users/rama/.gemini/antigravity/brain/6c2d2530-5fae-45bb-8188-4e00a46893c6';

async function main() {
  console.log('Launching browser...');
  const browser = await chromium.launch();
  const page = await browser.newPage({ 
    viewport: { width: 1440, height: 1050 },
    colorScheme: 'dark'
  });

  await page.goto('http://localhost:3000/?session=sess_01M6GKHJFVMA94Z7V94NW9FN9F', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Jump to latest
  const jumpBtn = page.locator('button:has-text("Jump to latest")');
  if (await jumpBtn.count() > 0) {
    console.log('Clicking Jump to latest...');
    await jumpBtn.click();
    await page.waitForTimeout(1000);
  }

  // Scroll main container to bottom
  await page.evaluate(() => {
    const scrollables = Array.from(document.querySelectorAll('*')).filter(el => {
      const style = window.getComputedStyle(el);
      return (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
    });
    for (const el of scrollables) {
      el.scrollTop = el.scrollHeight;
    }
  });
  await page.waitForTimeout(1500);

  // Case A: 4-Row Short Table
  const h3A = page.locator('h3:has-text("Case A: Short Summary Table")');
  if (await h3A.count() > 0) {
    await h3A.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const tableA = h3A.locator('xpath=following::div[contains(@class, "overflow-x-auto")][1]');
    if (await tableA.count() > 0) {
      const boxA = await tableA.boundingBox();
      console.log('Case A (4 rows) box:', boxA);
      await tableA.screenshot({ path: `${ARTIFACT_DIR}/table_case_a_short_natural.png` });
      console.log('Saved table_case_a_short_natural.png');
    }
  }

  // Case B: 10-Row Table
  const h3B = page.locator('h3:has-text("Case B: 10-Row Financial Breakdown")');
  if (await h3B.count() > 0) {
    await h3B.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const tableB = h3B.locator('xpath=following::div[contains(@class, "overflow-x-auto")][1]');
    if (await tableB.count() > 0) {
      const boxB = await tableB.boundingBox();
      console.log('Case B (10 rows) box:', boxB);
      await tableB.screenshot({ path: `${ARTIFACT_DIR}/table_case_b_10_rows.png` });
      console.log('Saved table_case_b_10_rows.png');
    }
  }

  // Case C: 20-Row Table
  const h3C = page.locator('h3:has-text("Case C: 20-Row Trial Balance Ledger")');
  if (await h3C.count() > 0) {
    await h3C.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const tableC = h3C.locator('xpath=following::div[contains(@class, "overflow-x-auto")][1]');
    if (await tableC.count() > 0) {
      const boxC = await tableC.boundingBox();
      console.log('Case C (20 rows) box (capped at 440px):', boxC);
      await tableC.screenshot({ path: `${ARTIFACT_DIR}/table_case_c_20_rows_top.png` });
      console.log('Saved table_case_c_20_rows_top.png');

      // Scroll inside the 20-row table by 320px to show rows rolling under sticky header
      await tableC.evaluate(el => {
        el.scrollTop = 320;
      });
      await page.waitForTimeout(500);
      await tableC.screenshot({ path: `${ARTIFACT_DIR}/table_case_c_20_rows_scrolled.png` });
      console.log('Saved table_case_c_20_rows_scrolled.png');
    }
  }

  // Full view of chat with benchmark message
  const heading = page.locator('h1:has-text("Table Rendering Benchmark: Natural Fit vs. Sticky 440px Roll")');
  if (await heading.count() > 0) {
    await heading.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${ARTIFACT_DIR}/chat_tables_benchmark_full_view.png` });
    console.log('Saved chat_tables_benchmark_full_view.png');
  }

  await browser.close();
  console.log('--- ALL BENCHMARK SCREENSHOTS CAPTURED SUCCESSFULLY! ---');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
