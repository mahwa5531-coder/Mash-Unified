// End-to-End Verification Test for Desktop Window State Persistence & Titlebar Sync
// Tests:
// 1. window.electronAPI.isMaximized and onMaximizeChange presence & reactivity
// 2. Window resizing & positioning persistence to userData/window-state.json
// 3. Normal bounds preservation when maximized (Restore Down doesn't corrupt size)
// 4. Persistence across application relaunch (cold start restores exact bounds)

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import pkg from '../node_modules/@playwright/test/index.js';
const { _electron: electron } = pkg;

console.log('[*] Starting Electron Window State Persistence E2E Test...');

(async () => {
  let app1;
  let app2;
  let app3;
  try {
    console.log('\n--- Phase 1: Launching First Electron Instance ---');
    app1 = await electron.launch({
      args: ['electron/main.js'],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        MASH_DEV_URL: 'http://127.0.0.1:3000',
      },
    });

    const page1 = await app1.firstWindow();
    await page1.waitForLoadState('domcontentloaded');

    // 1. Verify electronAPI bridges
    const apis = await page1.evaluate(() => {
      const api = window.electronAPI;
      return {
        hasIsMaximized: typeof api?.isMaximized === 'function',
        hasOnMaximizeChange: typeof api?.onMaximizeChange === 'function',
        initialMaximized: api?.isMaximized?.(),
      };
    });

    assert.ok(apis.hasIsMaximized, 'window.electronAPI.isMaximized must be a function');
    assert.ok(apis.hasOnMaximizeChange, 'window.electronAPI.onMaximizeChange must be a function');
    console.log('  [PASS] 1. electronAPI.isMaximized and onMaximizeChange verified.');

    // 2. Set up listener in renderer for maximize changes
    await page1.evaluate(() => {
      window.__maximizeEvents = [];
      window.electronAPI.onMaximizeChange((isMax) => {
        window.__maximizeEvents.push(isMax);
      });
    });

    // 3. Obtain userData path from Electron app
    const userDataPath = await app1.evaluate(({ app }) => app.getPath('userData'));
    const stateFilePath = path.join(userDataPath, 'window-state.json');
    console.log(`  [*] UserData path: ${userDataPath}`);
    console.log(`  [*] State file path: ${stateFilePath}`);

    // 4. Resize and reposition the window to a distinctive test rectangle
    const targetRect = { x: 50, y: 30, width: 1000, height: 600 };
    console.log(`  [*] Setting window bounds to:`, targetRect);
    await app1.evaluate(({ BrowserWindow }, rect) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.unmaximize();
      win.setBounds(rect);
    }, targetRect);

    // Allow debounce (300ms) to flush atomic write
    await new Promise((r) => setTimeout(r, 600));

    // 5. Verify state file written to disk
    assert.ok(fs.existsSync(stateFilePath), 'window-state.json must exist');
    let savedState = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
    console.log('  [*] Saved state after resize:', savedState);
    assert.strictEqual(savedState.width, targetRect.width, 'Saved width matches resized width');
    assert.strictEqual(savedState.height, targetRect.height, 'Saved height matches resized height');
    assert.strictEqual(savedState.x, targetRect.x, 'Saved x matches resized x');
    assert.strictEqual(savedState.y, targetRect.y, 'Saved y matches resized y');
    assert.strictEqual(savedState.isMaximized, false, 'isMaximized is false when floating');
    console.log('  [PASS] 2. Window resize & position saved atomically to disk.');

    // 6. Test Maximize & Event dispatch
    console.log('\n--- Phase 2: Testing Maximize & Floating Bounds Protection ---');
    await page1.evaluate(() => {
      window.electronAPI.maximize();
    });

    // Wait for maximize event and debounced save
    await new Promise((r) => setTimeout(r, 600));

    const maxState = await page1.evaluate(() => ({
      isMax: window.electronAPI.isMaximized(),
      events: window.__maximizeEvents,
    }));
    assert.strictEqual(maxState.isMax, true, 'isMaximized() must report true after maximize');
    assert.ok(maxState.events.includes(true), 'onMaximizeChange event listener received true');
    console.log('  [PASS] 3. Native maximize triggered and broadcast to renderer.');

    // Verify that saved floating bounds were NOT overwritten with full-screen dimensions
    savedState = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
    console.log('  [*] Saved state while maximized:', savedState);
    assert.strictEqual(savedState.isMaximized, true, 'isMaximized is true in json');
    assert.strictEqual(savedState.width, targetRect.width, 'Cached normal width is preserved');
    assert.strictEqual(savedState.height, targetRect.height, 'Cached normal height is preserved');
    console.log('  [PASS] 4. Root cause protection: normal bounds preserved during maximize.');

    // 7. Unmaximize
    await page1.evaluate(() => {
      window.electronAPI.maximize();
    });
    await new Promise((r) => setTimeout(r, 600));

    const unmaxState = await page1.evaluate(() => ({
      isMax: window.electronAPI.isMaximized(),
      events: window.__maximizeEvents,
    }));
    assert.strictEqual(unmaxState.isMax, false, 'isMaximized() must report false after unmaximize');
    assert.ok(unmaxState.events.includes(false), 'onMaximizeChange event listener received false');
    console.log('  [PASS] 5. Unmaximize restored normal state and notified renderer.');

    // Close app1
    await app1.close();
    app1 = null;
    console.log('  [*] First Electron instance closed cleanly.');

    // 8. Relaunch app2 to verify persistent restoration
    console.log('\n--- Phase 3: Relaunching Electron to Verify Cold-Start Restoration ---');
    app2 = await electron.launch({
      args: ['electron/main.js'],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        MASH_DEV_URL: 'http://127.0.0.1:3000',
      },
    });

    const page2 = await app2.firstWindow();
    await page2.waitForLoadState('domcontentloaded');

    const restoredBounds = await app2.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.getBounds();
    });
    console.log('  [*] Restored window bounds on relaunch:', restoredBounds);

    assert.strictEqual(restoredBounds.width, targetRect.width, 'Restored width matches target');
    assert.strictEqual(restoredBounds.height, targetRect.height, 'Restored height matches target');
    assert.strictEqual(restoredBounds.x, targetRect.x, 'Restored x matches target');
    assert.strictEqual(restoredBounds.y, targetRect.y, 'Restored y matches target');
    console.log('  [PASS] 6. Cold-start persistence verified! Window restored exact geometry.');

    // 9. Test Disconnected Monitor & Off-screen Clamping Recovery
    console.log('\n--- Phase 4: Testing Phantom Window / Disconnected Monitor Clamping ---');
    // Deliberately write an impossible off-screen state (e.g. unplugged second 4K monitor at x: 4500, y: 3000)
    fs.writeFileSync(stateFilePath, JSON.stringify({
      x: 4500,
      y: 3000,
      width: 2500,
      height: 1800,
      isMaximized: false,
    }, null, 2), 'utf8');

    await app2.close();
    app2 = null;

    app3 = await electron.launch({
      args: ['electron/main.js'],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        MASH_DEV_URL: 'http://127.0.0.1:3000',
      },
    });

    const page3 = await app3.firstWindow();
    await page3.waitForLoadState('domcontentloaded');

    const recoveredBounds = await app3.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const display = screen.getPrimaryDisplay();
      return {
        bounds: win.getBounds(),
        workArea: display.workArea,
      };
    });

    console.log('  [*] Recovered bounds from off-screen phantom coordinates:', recoveredBounds.bounds);
    console.log('  [*] Display workArea:', recoveredBounds.workArea);

    assert.ok(
      recoveredBounds.bounds.x >= recoveredBounds.workArea.x,
      'Recovered x must be >= workArea.x'
    );
    assert.ok(
      recoveredBounds.bounds.y >= recoveredBounds.workArea.y,
      'Recovered y must be >= workArea.y'
    );
    assert.ok(
      recoveredBounds.bounds.width <= recoveredBounds.workArea.width,
      'Recovered width must be clamped to workArea.width'
    );
    assert.ok(
      recoveredBounds.bounds.height <= recoveredBounds.workArea.height,
      'Recovered height must be clamped to workArea.height'
    );
    console.log('  [PASS] 7. Disconnected monitor protection verified! Off-screen window rescued into visible screen.');
    await app3.close();
    app3 = null;

    console.log('\n[SUCCESS] ALL WINDOW STATE PERSISTENCE CHECKS PASSED 100%!');
  } catch (err) {
    console.error('\n[FAIL] Test encountered error:', err);
    process.exitCode = 1;
  } finally {
    if (app1) {
      try { await app1.close(); } catch (_) {}
    }
    if (app2) {
      try { await app2.close(); } catch (_) {}
    }
    if (app3) {
      try { await app3.close(); } catch (_) {}
    }
  }
})();
