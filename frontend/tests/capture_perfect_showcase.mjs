import { chromium } from 'playwright';

const ARTIFACT_DIR = 'C:/Users/rama/.gemini/antigravity/brain/6c2d2530-5fae-45bb-8188-4e00a46893c6';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, colorScheme: 'dark' });
  
  await page.goto('http://localhost:3000/?session=sess_01M6GKHJFVMA94Z7V94NW9FN9F', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Jump to latest / scroll to bottom
  const jumpBtn = page.locator('button:has-text("Jump to latest")');
  if (await jumpBtn.count() > 0) {
    await jumpBtn.click();
    await page.waitForTimeout(1000);
  }

  await page.evaluate(() => {
    const scrollables = Array.from(document.querySelectorAll('*')).filter(el => {
      const style = window.getComputedStyle(el);
      return (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
    });
    for (const el of scrollables) {
      el.scrollTop = el.scrollHeight;
    }
  });
  await page.waitForTimeout(2000);

  // Locate the showcase assistant message turn
  const h1 = page.locator('h1:has-text("MASH Enterprise Full-Spectrum Rendering Matrix")');
  if (await h1.count() === 0) {
    console.error('Showcase heading not found!');
    process.exit(1);
  }
  console.log('Found showcase heading!');
  await h1.scrollIntoViewIfNeeded();

  // 1. Full view of showcase turn
  const turnContainer = h1.locator('xpath=ancestor::div[contains(@class, "group/turn") or contains(@class, "prose") or contains(@class, "font-sans")][last()]');
  await page.screenshot({ path: `${ARTIFACT_DIR}/chat_showcase_master_overview.png` });
  console.log('Saved chat_showcase_master_overview.png');

  // 2. Typography & Headings block
  const h1El = page.locator('h1:has-text("MASH Enterprise Full-Spectrum Rendering Matrix")').first();
  if (await h1El.count() > 0) {
    await h1El.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    // Capture the entire markdown prose container of the showcase message
    const proseParent = h1El.locator('xpath=ancestor::div[contains(@class, "font-sans") and contains(@class, "text-[13.5px]")][1]');
    if (await proseParent.count() > 0) {
      // Scroll to Section 7 Formatted Lists & Typography
      const section7 = page.locator('h3:has-text("7. Formatted Lists & Typography")').last();
      if (await section7.count() > 0) {
        await section7.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        const ulBlock = section7.locator('xpath=following-sibling::ul[1]');
        if (await ulBlock.count() > 0) {
          await ulBlock.screenshot({ path: `${ARTIFACT_DIR}/chat_markdown_typography_macro.png` });
          console.log('Saved chat_markdown_typography_macro.png with lists & typography');
        } else {
          await section7.screenshot({ path: `${ARTIFACT_DIR}/chat_markdown_typography_macro.png` });
        }
      }
    }
  }

  // 3. CodeBlock: TypeScript
  const tsPill = page.locator('span:text-is("typescript")').last();
  if (await tsPill.count() > 0) {
    const tsCodeBox = tsPill.locator('xpath=ancestor::div[contains(@class, "rounded-lg") and contains(@class, "border")][1]');
    await tsCodeBox.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await tsCodeBox.screenshot({ path: `${ARTIFACT_DIR}/chat_codeblock_typescript_macro.png` });
    console.log('Saved chat_codeblock_typescript_macro.png');
  } else {
    console.log('typescript pill not found');
  }

  // 4. CodeBlock: Python
  const pyPill = page.locator('span:text-is("python")').last();
  if (await pyPill.count() > 0) {
    const pyCodeBox = pyPill.locator('xpath=ancestor::div[contains(@class, "rounded-lg") and contains(@class, "border")][1]');
    await pyCodeBox.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await pyCodeBox.screenshot({ path: `${ARTIFACT_DIR}/chat_codeblock_python_macro.png` });
    console.log('Saved chat_codeblock_python_macro.png');
  } else {
    console.log('python pill not found');
  }

  // 5. TableContainer: Financial Matrix with Grey Header & Hairlines
  const lastTable = page.locator('table').last();
  if (await lastTable.count() > 0) {
    const tWrap = lastTable.locator('xpath=ancestor::div[contains(@class, "overflow-x-auto")][1]');
    await tWrap.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await tWrap.screenshot({ path: `${ARTIFACT_DIR}/chat_table_grey_header_macro.png` });
    console.log('Saved chat_table_grey_header_macro.png');
  }

  // 6. Callouts (Statutory Guidance Note, Cutoff Exception Warning, Control Deficiency Caution)
  const calloutGroup = page.locator('blockquote').last();
  if (await calloutGroup.count() > 0) {
    const allQuotes = page.locator('blockquote');
    const qCount = await allQuotes.count();
    // Grab the 3 callouts from the showcase
    const showcaseCallout = allQuotes.nth(qCount - 3 >= 0 ? qCount - 3 : 0);
    await showcaseCallout.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await showcaseCallout.screenshot({ path: `${ARTIFACT_DIR}/chat_callout_note_macro.png` });
    console.log('Saved chat_callout_note_macro.png');

    const warningCallout = allQuotes.nth(qCount - 2 >= 0 ? qCount - 2 : 0);
    await warningCallout.scrollIntoViewIfNeeded();
    await warningCallout.screenshot({ path: `${ARTIFACT_DIR}/chat_callout_warning_macro.png` });
    console.log('Saved chat_callout_warning_macro.png');
  }

  // 7. FilePills & WebLinks
  const filePillBtn = page.locator('button:has-text("revenue_testing_q4.xlsx")').last();
  if (await filePillBtn.count() > 0) {
    const pillList = filePillBtn.locator('xpath=ancestor::ul[1]');
    await pillList.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await pillList.screenshot({ path: `${ARTIFACT_DIR}/chat_filepills_and_weblinks_macro.png` });
    console.log('Saved chat_filepills_and_weblinks_macro.png');
  }

  // 8. Mermaid Diagram: Wait for SVG render
  const mermaidContainers = page.locator('div[title="Click to expand diagram"]');
  const mcCount = await mermaidContainers.count();
  console.log(`Found ${mcCount} mermaid containers`);
  if (mcCount > 0) {
    const mTarget = mermaidContainers.last();
    await mTarget.scrollIntoViewIfNeeded();
    // Wait for SVG to populate inside
    console.log('Waiting for Mermaid SVG to render...');
    await page.waitForFunction(
      (el) => el.querySelector('svg') !== null,
      await mTarget.elementHandle(),
      { timeout: 10000 }
    ).catch(e => console.log('Wait for SVG timed out or completed'));
    await page.waitForTimeout(1000);

    await mTarget.screenshot({ path: `${ARTIFACT_DIR}/chat_mermaid_inline_macro.png` });
    console.log('Saved chat_mermaid_inline_macro.png');

    // Click to open modal
    console.log('Clicking mermaid container to open modal...');
    await mTarget.click();
    await page.waitForTimeout(1000);

    const dialog = page.locator('div[role="dialog"]');
    if (await dialog.count() > 0) {
      await dialog.screenshot({ path: `${ARTIFACT_DIR}/chat_mermaid_modal_enlarged_macro.png` });
      console.log('Saved chat_mermaid_modal_enlarged_macro.png');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
  }

  // 9. KaTeX Math
  const katexElems = page.locator('.katex');
  const kCount = await katexElems.count();
  console.log(`Found ${kCount} KaTeX elements`);
  if (kCount > 0) {
    const kTarget = katexElems.last().locator('xpath=ancestor::p[1]');
    await kTarget.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await kTarget.screenshot({ path: `${ARTIFACT_DIR}/chat_katex_math_macro.png` });
    console.log('Saved chat_katex_math_macro.png');
  }

  await browser.close();
  console.log('All perfect screenshots captured!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
