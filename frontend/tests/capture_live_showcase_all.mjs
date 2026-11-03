import { chromium } from 'playwright';

const ARTIFACT_DIR = 'C:/Users/rama/.gemini/antigravity/brain/6c2d2530-5fae-45bb-8188-4e00a46893c6';

async function main() {
  console.log('Launching browser...');
  const browser = await chromium.launch();
  const page = await browser.newPage({ 
    viewport: { width: 1440, height: 1000 }, 
    colorScheme: 'dark' 
  });

  console.log('Navigating to live session on localhost:3000...');
  await page.goto('http://localhost:3000/?session=sess_01M6GKHJFVMA94Z7V94NW9FN9F', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Jump to latest if button present
  const jumpBtn = page.locator('button:has-text("Jump to latest")');
  if (await jumpBtn.count() > 0) {
    console.log('Clicking Jump to latest...');
    await jumpBtn.click();
    await page.waitForTimeout(1000);
  }

  // Scroll the chat container to bottom
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

  // Verify showcase heading is in the DOM
  const showcaseHeading = page.locator('h1:has-text("MASH Enterprise Full-Spectrum Rendering Matrix")');
  if (await showcaseHeading.count() > 0) {
    console.log('Showcase heading found!');
    await showcaseHeading.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
  } else {
    console.log('Showcase heading not found directly; searching for partial...');
  }

  // 1. Full Chat View Scrolled to Showcase
  await page.screenshot({ path: `${ARTIFACT_DIR}/live_chat_full_showcase_overview.png` });
  console.log('Saved live_chat_full_showcase_overview.png');

  // 2. Markdown Headings & Typography Macro
  const h1El = page.locator('h1:has-text("MASH Enterprise Full-Spectrum Rendering Matrix")');
  if (await h1El.count() > 0) {
    // Parent container covering headings and intro
    const typoParent = page.locator('div:has(> h1:has-text("MASH Enterprise Full-Spectrum Rendering Matrix"))').first();
    await typoParent.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await typoParent.screenshot({ path: `${ARTIFACT_DIR}/live_chat_markdown_typography_macro.png` });
    console.log('Saved live_chat_markdown_typography_macro.png');
  }

  // 3. CodeBlock Macro (TypeScript and Python)
  // Unit 17 CodeBlock has language pill header, copy button, line count
  const codeBlocks = page.locator('div:has(> div:has-text("lines"))');
  const cbCount = await codeBlocks.count();
  console.log(`Found ${cbCount} code blocks`);
  if (cbCount > 0) {
    const lastCb = codeBlocks.nth(cbCount - 2 >= 0 ? cbCount - 2 : cbCount - 1);
    await lastCb.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await lastCb.screenshot({ path: `${ARTIFACT_DIR}/live_chat_codeblock_unit17_typescript.png` });
    console.log('Saved live_chat_codeblock_unit17_typescript.png');

    const pythonCb = codeBlocks.last();
    await pythonCb.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await pythonCb.screenshot({ path: `${ARTIFACT_DIR}/live_chat_codeblock_unit17_python.png` });
    console.log('Saved live_chat_codeblock_unit17_python.png');
  }

  // 4. Financial Table Macro (Unit 15 TableContainer)
  const tables = page.locator('table');
  const tCount = await tables.count();
  console.log(`Found ${tCount} tables`);
  if (tCount > 0) {
    const lastTable = tables.last();
    const tContainer = lastTable.locator('xpath=ancestor::div[contains(@class, "overflow-x-auto")][1]');
    await tContainer.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await tContainer.screenshot({ path: `${ARTIFACT_DIR}/live_chat_table_unit15_financial_grid.png` });
    console.log('Saved live_chat_table_unit15_financial_grid.png');
  }

  // 5. Callouts / Alerts Macro (Unit 03)
  const callouts = page.locator('blockquote');
  const cCount = await callouts.count();
  console.log(`Found ${cCount} callout blockquotes`);
  if (cCount > 0) {
    const calloutEl = callouts.last();
    await calloutEl.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await calloutEl.screenshot({ path: `${ARTIFACT_DIR}/live_chat_callout_unit03_alerts.png` });
    console.log('Saved live_chat_callout_unit03_alerts.png');
  }

  // 6. FilePills & WebLinks Macro (Unit 04/07 & Unit 08)
  const filePill = page.locator('button:has-text("revenue_testing_q4.xlsx")');
  if (await filePill.count() > 0) {
    const pillSection = filePill.locator('xpath=ancestor::ul[1]');
    await pillSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await pillSection.screenshot({ path: `${ARTIFACT_DIR}/live_chat_filepills_and_weblinks.png` });
    console.log('Saved live_chat_filepills_and_weblinks.png');
  } else {
    // Alternative locator for FilePills
    const altPill = page.locator('button:has(svg):has-text(".xlsx")').last();
    if (await altPill.count() > 0) {
      const parent = altPill.locator('xpath=ancestor::ul[1]');
      await parent.scrollIntoViewIfNeeded();
      await parent.screenshot({ path: `${ARTIFACT_DIR}/live_chat_filepills_and_weblinks.png` });
      console.log('Saved live_chat_filepills_and_weblinks.png');
    }
  }

  // 7. Mermaid Inline & Modal (Unit 16)
  const mermaidSvgs = page.locator('div[data-testid="mermaid-diagram"] svg');
  const mCount = await mermaidSvgs.count();
  console.log(`Found ${mCount} mermaid svgs`);
  if (mCount > 0) {
    const lastMermaid = mermaidSvgs.last();
    const mermaidContainer = lastMermaid.locator('xpath=ancestor::div[@data-testid="mermaid-diagram"][1]');
    await mermaidContainer.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await mermaidContainer.screenshot({ path: `${ARTIFACT_DIR}/live_chat_mermaid_unit16_inline.png` });
    console.log('Saved live_chat_mermaid_unit16_inline.png');

    // Click to open modal lightbox
    console.log('Clicking mermaid diagram to trigger lightbox modal...');
    await mermaidContainer.click();
    await page.waitForTimeout(1000);

    const modalDialog = page.locator('div[role="dialog"]');
    if (await modalDialog.count() > 0) {
      await modalDialog.screenshot({ path: `${ARTIFACT_DIR}/live_chat_mermaid_unit16_modal_enlarged.png` });
      console.log('Saved live_chat_mermaid_unit16_modal_enlarged.png');
      
      // Close modal
      const closeBtn = page.locator('button[aria-label="Close dialog"], button:has-text("✕")');
      if (await closeBtn.count() > 0) {
        await closeBtn.first().click();
        await page.waitForTimeout(500);
      } else {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      }
    }
  }

  // 8. KaTeX Math Equations
  const mathDisplays = page.locator('.katex-display');
  const mathCount = await mathDisplays.count();
  console.log(`Found ${mathCount} KaTeX displays`);
  if (mathCount > 0) {
    const targetMath = mathDisplays.last();
    await targetMath.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await targetMath.screenshot({ path: `${ARTIFACT_DIR}/live_chat_math_katex_macro.png` });
    console.log('Saved live_chat_math_katex_macro.png');
  }

  await browser.close();
  console.log('All screenshots completed successfully!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
