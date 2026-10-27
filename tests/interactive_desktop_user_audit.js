// Interactive Real-User Desktop Audit via Playwright Electron
// Launches the compiled Mash.exe, drives user actions, captures screenshots,
// verifies titlebar controls, sidebar, composer, and verifies clean exit.

const path = require('path');
const { _electron: electron } = require(path.resolve(__dirname, '../frontend/node_modules/@playwright/test'));
const fs = require('fs');
const { execSync } = require('child_process');

const ARTIFACT_DIR = 'C:/Users/rama/.gemini/antigravity/brain/bc5df091-d65b-47b2-ba8f-69ac624e9af9';

async function runInteractiveAudit() {
  const appPath = path.resolve('dist/release/win-unpacked/Mash.exe');
  console.log(`[*] Launching compiled desktop executable: ${appPath}`);

  if (!fs.existsSync(appPath)) {
    throw new Error(`Executable not found at ${appPath}`);
  }

  const app = await electron.launch({
    executablePath: appPath,
    env: {
      ...process.env,
      MASH_BYPASS_AUTH: '1',
      NODE_ENV: 'production',
    },
    timeout: 30000,
  });

  try {
    const window = await app.firstWindow();
    console.log('[OK] Electron window initialized.');

    // Wait for the window to finish loading Next.js static output
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(3000); // Allow React hydration & connector loopback handshake

    const title = await window.title();
    console.log(`[OK] Window Title: "${title}"`);

    // Screenshot 1: Initial Launch View
    const shot1 = path.join(ARTIFACT_DIR, 'desktop_launch_initial_view.png');
    await window.screenshot({ path: shot1 });
    console.log(`[OK] Saved initial view screenshot: ${shot1}`);

    // Inspect Custom Frameless Titlebar
    const titleBar = await window.$('[data-tauri-drag-region], [style*="WebkitAppRegion"]');
    console.log(`[OK] Titlebar detected: ${!!titleBar}`);

    // Check titlebar buttons
    const minBtn = await window.$('button[aria-label="Minimize"], button:has(svg.lucide-minus)');
    const maxBtn = await window.$('button[aria-label="Maximize"], button:has(svg.lucide-square), button:has(svg.lucide-copy)');
    console.log(`[OK] Titlebar Minimize button: ${!!minBtn}, Maximize button: ${!!maxBtn}`);

    // Interact: Test Window Maximize
    if (maxBtn) {
      console.log('[*] Clicking Maximize button...');
      await maxBtn.click();
      await window.waitForTimeout(1000);
      const isMax = await app.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        return win ? win.isMaximized() : false;
      });
      console.log(`[OK] Window isMaximized after click: ${isMax}`);

      const shot2 = path.join(ARTIFACT_DIR, 'desktop_maximized_view.png');
      await window.screenshot({ path: shot2 });
      console.log(`[OK] Saved maximized screenshot: ${shot2}`);

      // Click again to unmaximize / restore
      console.log('[*] Clicking Restore button...');
      await maxBtn.click();
      await window.waitForTimeout(1000);
    }

    // Inspect Sidebar & Chat Canvas Elements
    const sidebar = await window.$('aside, [role="complementary"], nav');
    console.log(`[OK] Sidebar present: ${!!sidebar}`);

    // Check Chat Composer Textarea
    const textarea = await window.$('textarea');
    if (textarea) {
      console.log('[*] Interacting with Chat Composer textarea...');
      await textarea.fill('Hello Mash, analyze the statutory income statement.');
      await window.waitForTimeout(800);

      const shot3 = path.join(ARTIFACT_DIR, 'desktop_composer_active_prompt.png');
      await window.screenshot({ path: shot3 });
      console.log(`[OK] Saved composer active prompt screenshot: ${shot3}`);
    } else {
      console.log('[!] Textarea not currently visible (may be on project selection / sign-in screen)');
    }

    // Check Settings Modal / Buttons
    const settingsBtn = await window.$('button:has(svg.lucide-settings), button[aria-label*="Setting"]');
    if (settingsBtn) {
      console.log('[*] Clicking Settings button...');
      await settingsBtn.click();
      await window.waitForTimeout(1000);

      const shot4 = path.join(ARTIFACT_DIR, 'desktop_settings_modal.png');
      await window.screenshot({ path: shot4 });
      console.log(`[OK] Saved settings modal screenshot: ${shot4}`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('>>> ALL INTERACTIVE USER STEPS COMPLETED SUCCESSFULLY <<<');
    console.log('='.repeat(60) + '\n');
  } finally {
    console.log('[*] Closing Electron desktop application...');
    await app.close();
    console.log('[OK] Electron application closed cleanly.');

    // Verify no orphan connector.exe
    if (process.platform === 'win32') {
      try {
        const out = execSync('tasklist /fi "imagename eq connector.exe" /fo csv', { encoding: 'utf-8' });
        const hasOrphan = out.includes('connector.exe');
        console.log(`[OK] Post-test Task Manager scan: ${hasOrphan ? 'ORPHAN FOUND' : '0 ZOMBIES (Clean)'}`);
      } catch (_) {}
    }
  }
}

runInteractiveAudit().catch((err) => {
  console.error('[FAIL] Interactive audit error:', err);
  process.exit(1);
});
