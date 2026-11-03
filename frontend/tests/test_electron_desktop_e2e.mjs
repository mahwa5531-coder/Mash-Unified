// End-to-end Electron Desktop mode verification test
// Launches real Electron runtime and tests desktop bridges, preload APIs, and native mode flags.
import assert from 'node:assert';
import pkg from '../node_modules/@playwright/test/index.js';
const { _electron: electron } = pkg;

console.log('[*] Launching real Electron desktop application...');

(async () => {
  let app;
  try {
    app = await electron.launch({
      args: ['electron/main.js'],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        MASH_DEV_URL: 'http://127.0.0.1:3000',
      },
    });

    console.log('  [PASS] 1. Electron process launched successfully.');

    const page = await app.firstWindow();
    console.log('  [PASS] 2. First desktop window created.');

    // Wait for DOM
    await page.waitForLoadState('domcontentloaded');

    // 1. Verify window.__MASH_DESKTOP__
    const isDesktop = await page.evaluate(() => window.__MASH_DESKTOP__?.isDesktop);
    assert.strictEqual(isDesktop, true, '__MASH_DESKTOP__.isDesktop must be true');
    console.log('  [PASS] 3. window.__MASH_DESKTOP__.isDesktop === true');

    // 2. Verify window.electronAPI presence and methods
    const apis = await page.evaluate(() => {
      const api = window.electronAPI;
      return {
        hasApi: Boolean(api),
        hasGetPathForFile: typeof api?.getPathForFile === 'function',
        hasOpenPath: typeof api?.openPath === 'function',
        hasMinimize: typeof api?.minimize === 'function',
        hasMaximize: typeof api?.maximize === 'function',
        hasClose: typeof api?.close === 'function',
      };
    });

    assert.ok(apis.hasApi, 'window.electronAPI must exist in desktop mode');
    assert.ok(apis.hasGetPathForFile, 'window.electronAPI.getPathForFile must be a function');
    assert.ok(apis.hasOpenPath, 'window.electronAPI.openPath must be a function');
    assert.ok(apis.hasMinimize, 'window.electronAPI.minimize must be a function');
    assert.ok(apis.hasMaximize, 'window.electronAPI.maximize must be a function');
    assert.ok(apis.hasClose, 'window.electronAPI.close must be a function');
    console.log('  [PASS] 4. window.electronAPI verified with all native bridges (getPathForFile, openPath, window controls).');

    console.log('\n[SUCCESS] Real Electron Desktop Mode E2E Test PASSED!');
  } catch (err) {
    console.error('[FAIL] Electron Desktop Test Failed:', err);
    process.exitCode = 1;
  } finally {
    if (app) {
      await app.close();
      console.log('  [*] Electron desktop application closed cleanly.');
    }
  }
})();
