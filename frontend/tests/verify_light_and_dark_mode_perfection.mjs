import { chromium } from 'playwright';
import path from 'path';

const ARTIFACT_DIR = 'C:/Users/rama/.gemini/antigravity/brain/6c2d2530-5fae-45bb-8188-4e00a46893c6';

async function run() {
  console.log('Verifying Light Mode and Dark Mode Callouts & FilePills live...');
  const browser = await chromium.launch({ headless: true });

  // Test 1: LIGHT MODE
  console.log('Testing Light Mode...');
  const lightContext = await browser.newContext({
    viewport: { width: 1440, height: 1200 },
    colorScheme: 'light',
  });
  const lightPage = await lightContext.newPage();
  await lightPage.goto('http://localhost:3000/design-system', { waitUntil: 'networkidle', timeout: 30000 });
  await lightPage.waitForTimeout(1000);

  // Set theme to light explicitly
  await lightPage.evaluate(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('theme', 'light');
  });
  await lightPage.waitForTimeout(500);

  const lightCalloutsCard = lightPage.locator('section:has-text("Audit Observation Blockquotes")');
  await lightCalloutsCard.scrollIntoViewIfNeeded();
  await lightPage.waitForTimeout(500);
  await lightCalloutsCard.screenshot({ path: path.join(ARTIFACT_DIR, 'verified_light_mode_callouts.png') });

  const lightPillsCard = lightPage.locator('section:has-text("Interactive File Pills")');
  await lightPillsCard.scrollIntoViewIfNeeded();
  await lightPage.waitForTimeout(500);
  await lightPillsCard.screenshot({ path: path.join(ARTIFACT_DIR, 'verified_light_mode_filepills.png') });

  // Measure light mode callout heading metrics
  const lightCalloutData = await lightPage.$$eval('blockquote div:has(> span.uppercase)', (els) => {
    return els.map((el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return {
        text: el.innerText.trim(),
        height: rect.height,
        marginBottom: style.marginBottom,
        color: style.color,
      };
    });
  });
  console.log('Light Mode Callout Headings:', lightCalloutData.slice(0, 3));

  // Measure light mode file pill metrics
  const lightPillData = await lightPage.$$eval('button[title*="Open"]', (buttons) => {
    return buttons.map((b) => {
      const rect = b.getBoundingClientRect();
      const style = window.getComputedStyle(b);
      return {
        title: b.title,
        height: rect.height,
        padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
        color: style.color,
      };
    });
  });
  console.log('Light Mode FilePills:', lightPillData.slice(0, 3));

  // Test 2: DARK MODE
  console.log('Testing Dark Mode...');
  const darkContext = await browser.newContext({
    viewport: { width: 1440, height: 1200 },
    colorScheme: 'dark',
  });
  const darkPage = await darkContext.newPage();
  await darkPage.goto('http://localhost:3000/design-system', { waitUntil: 'networkidle', timeout: 30000 });
  await darkPage.waitForTimeout(1000);

  // Set theme to dark explicitly
  await darkPage.evaluate(() => {
    document.documentElement.classList.add('dark');
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('theme', 'dark');
  });
  await darkPage.waitForTimeout(500);

  const darkCalloutsCard = darkPage.locator('section:has-text("Audit Observation Blockquotes")');
  await darkCalloutsCard.scrollIntoViewIfNeeded();
  await darkPage.waitForTimeout(500);
  await darkCalloutsCard.screenshot({ path: path.join(ARTIFACT_DIR, 'verified_dark_mode_callouts.png') });

  const darkPillsCard = darkPage.locator('section:has-text("Interactive File Pills")');
  await darkPillsCard.scrollIntoViewIfNeeded();
  await darkPage.waitForTimeout(500);
  await darkPillsCard.screenshot({ path: path.join(ARTIFACT_DIR, 'verified_dark_mode_filepills.png') });

  await browser.close();
  console.log('ALL LIGHT & DARK MODE CHECKS COMPLETED AND SCREENSHOTS SAVED!');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
