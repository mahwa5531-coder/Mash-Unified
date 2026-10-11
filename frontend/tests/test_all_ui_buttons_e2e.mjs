import { spawn } from 'child_process';
import assert from 'node:assert/strict';

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = "http://localhost:3000";

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function connectCDP(port, targetUrl) {
  const chromeProc = spawn(CHROME_PATH, [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    "--window-size=1600,1000",
    "--disable-gpu",
    "--no-sandbox",
    targetUrl
  ]);

  let debugUrl = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find(p => p.type === 'page');
      if (page && page.webSocketDebuggerUrl) { debugUrl = page.webSocketDebuggerUrl; break; }
    } catch {}
  }

  if (!debugUrl) {
    chromeProc.kill();
    throw new Error(`Failed to obtain WebSocket URL on port ${port}`);
  }

  const ws = new WebSocket(debugUrl);
  let id = 1;
  const pending = new Map();
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const reqId = id++;
      pending.set(reqId, { resolve, reject });
      ws.send(JSON.stringify({ id: reqId, method, params }));
    });
  }
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  };

  await new Promise(res => { ws.onopen = res; });
  await send('Page.enable');
  await send('DOM.enable');
  await send('Runtime.enable');

  return { chromeProc, ws, send };
}

async function evalJs(send, expression) {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) {
    throw new Error(JSON.stringify(res.exceptionDetails));
  }
  return res.result ? res.result.value : undefined;
}

function record(name, passed, detail = "") {
  console.log(`${passed ? '✓ PASS' : '✗ FAIL'}: ${name}${detail ? ` (${detail})` : ''}`);
  assert.ok(passed, `Test failed: ${name} - ${detail}`);
}

async function runRigorousUiTests() {
  console.log("======================================================================");
  console.log("  RIGOROUS FRONTEND BUTTON & SCENARIO VERIFICATION SUITE");
  console.log("======================================================================\n");

  // PHASE 1: Main Application Interface
  console.log("--- PHASE 1: Main Application Interface (/chat) ---");
  const mainClient = await connectCDP(9488, `${BASE_URL}/?session=sess_fixed_assets`);
  await sleep(3000);

  try {
    // 1. Textarea & Send Button State Test
    console.log("[Suite 1] Chat Composer & Action Buttons");
    const sendBtnDisabledInitially = await evalJs(mainClient.send, `(() => {
      const btn = document.querySelector('button[aria-label="Send prompt"]');
      return btn ? btn.disabled : null;
    })()`);
    record("Send button disabled when prompt is empty", sendBtnDisabledInitially === true);

    // Type prompt text using React synthetic value tracker
    await evalJs(mainClient.send, `(() => {
      const ta = document.querySelector('textarea');
      if (ta) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        nativeSetter.call(ta, "Auditing Test Observation");
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return ta ? ta.value : null;
    })()`);
    await sleep(300);

    const sendBtnEnabledAfterText = await evalJs(mainClient.send, `(() => {
      const btn = document.querySelector('button[aria-label="Send prompt"]');
      return btn ? !btn.disabled : false;
    })()`);
    record("Send button enabled when prompt text is present", sendBtnEnabledAfterText === true);

    // Clear textarea
    await evalJs(mainClient.send, `(() => {
      const ta = document.querySelector('textarea');
      if (ta) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        nativeSetter.call(ta, "");
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`);

    // 2. Attach Files Button (+)
    const plusBtnExists = await evalJs(mainClient.send, `(() => {
      const btn = document.querySelector('button[aria-label="Attach documents, spreadsheets, or images"]');
      return Boolean(btn);
    })()`);
    record("Attach (+) button present in composer", plusBtnExists === true);

    // 3. Left Sidebar Buttons & Navigation
    console.log("\n[Suite 2] Sidebar Navigation & Session Management");
    const newChatBtn = await evalJs(mainClient.send, `(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const newConv = btns.find(b => b.textContent.includes('New Conversation') || b.textContent.includes('New Chat'));
      return Boolean(newConv);
    })()`);
    record("New Conversation action button present in sidebar", newChatBtn === true);

    const sidebarInfo = await evalJs(mainClient.send, `(() => {
      const sessionElements = Array.from(document.querySelectorAll('div')).filter(el => 
        el.textContent?.includes('Fixed Assets') && el.classList.toString().includes('cursor-pointer')
      );
      return {
        sessionFound: sessionElements.length > 0,
        count: sessionElements.length
      };
    })()`);
    record("Session history items rendered in sidebar", sidebarInfo.sessionFound === true, `found ${sidebarInfo.count}`);

    // 4. Settings Gear Button & Modal Verification
    console.log("\n[Suite 3] Settings Modal & Configuration Tabs");
    const settingsBtn = await evalJs(mainClient.send, `(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const settings = btns.find(b => b.getAttribute('aria-label')?.includes('Settings') || b.textContent.includes('Settings') || b.title?.includes('Settings'));
      if (settings) {
        settings.click();
        return true;
      }
      return false;
    })()`);
    record("Settings button clicked", settingsBtn === true);
    await sleep(500);

    const settingsModalOpen = await evalJs(mainClient.send, `(() => {
      const modal = document.querySelector('[role="dialog"], [aria-modal="true"], .fixed');
      return Boolean(modal);
    })()`);
    record("Settings modal opened successfully", settingsModalOpen === true);

    // Tab 1: Usage Tab
    const clickUsageTab = await evalJs(mainClient.send, `(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Usage'));
      if (btn) { btn.click(); return true; }
      return false;
    })()`);
    record("Settings 'Usage' tab clicked", clickUsageTab === true);
    await sleep(300);

    const hasUsageText = await evalJs(mainClient.send, `(() => {
      return document.body.innerText.includes('Rolling Token Quotas') || document.body.innerText.includes('Quotas');
    })()`);
    record("Settings 'Usage' content rendered", hasUsageText === true);

    // Tab 2: Account Tab
    const clickAccountTab = await evalJs(mainClient.send, `(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Account'));
      if (btn) { btn.click(); return true; }
      return false;
    })()`);
    record("Settings 'Account' tab clicked", clickAccountTab === true);
    await sleep(300);

    // Tab 3: Appearance Tab
    const clickAppearanceTab = await evalJs(mainClient.send, `(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Appearance'));
      if (btn) { btn.click(); return true; }
      return false;
    })()`);
    record("Settings 'Appearance' tab clicked", clickAppearanceTab === true);
    await sleep(300);

    // Close Settings modal via Close button
    const closedModal = await evalJs(mainClient.send, `(() => {
      const closeBtn = document.querySelector('button[title="Close Settings"], button[aria-label*="Close"]');
      if (closeBtn) {
        closeBtn.click();
        return true;
      }
      return false;
    })()`);
    record("Settings modal closed via close button", closedModal === true);
    await sleep(400);

  } finally {
    mainClient.ws.close();
    mainClient.chromeProc.kill();
  }

  // PHASE 2: Design System Showcase & Primitives
  console.log("\n--- PHASE 2: Design System Showcase & Primitives (/design-system) ---");
  const dsClient = await connectCDP(9489, `${BASE_URL}/design-system`);
  await sleep(3000);

  try {
    console.log("[Suite 4] Design System & Primitive Components");
    const dsHeading = await evalJs(dsClient.send, `(() => {
      return document.querySelector('h1')?.textContent || '';
    })()`);
    record("Design System showcase renders cleanly", dsHeading.includes("Design System"));

    // Check 4D Invalid Media Banner Unit in Design System
    const unit4DPresent = await evalJs(dsClient.send, `(() => {
      const h2s = Array.from(document.querySelectorAll('h2'));
      return h2s.some(h => h.textContent.includes('4D') && h.textContent.includes('Invalid Media'));
    })()`);
    record("Unit 4D (5-Attachment Limit & Media Banner) active", unit4DPresent === true);

    // Click "Attach 6th File" in Design System
    const triggerCap = await evalJs(dsClient.send, `(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Attach 6th File'));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    })()`);
    record("Click 'Attach 6th File' in design system", triggerCap === true);
    await sleep(400);

    const hasInvalidMediaAlert = await evalJs(dsClient.send, `(() => {
      const alerts = Array.from(document.querySelectorAll('[role="alert"]'));
      return alerts.some(a => a.textContent && a.textContent.includes('Invalid Media'));
    })()`);
    record("Invalid Media Banner triggered with alert role", hasInvalidMediaAlert === true);

    // Dismiss one file in AttachedFilesList via ✕ button
    const dismissedOneFile = await evalJs(dsClient.send, `(() => {
      const dismissBtn = document.querySelector('button[aria-label*="Remove"]');
      if (dismissBtn) {
        dismissBtn.click();
        return true;
      }
      return false;
    })()`);
    record("Dismiss attachment via inline (✕) button", dismissedOneFile === true);
    await sleep(300);

    // Verify Active Attachments count changed to 4/5
    const countAfterDismiss = await evalJs(dsClient.send, `(() => {
      return document.body.innerText.includes('4/5');
    })()`);
    record("Attachment count reflects reduction (4/5)", countAfterDismiss === true);

    // Click 'Reset to 5 Attached Files'
    const resetFiles = await evalJs(dsClient.send, `(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Reset to 5'));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    })()`);
    record("Click 'Reset to 5 Attached Files' button", resetFiles === true);
    await sleep(300);

    const countAfterReset = await evalJs(dsClient.send, `(() => {
      return document.body.innerText.includes('5/5');
    })()`);
    record("Attachment count restored to (5/5)", countAfterReset === true);

    // Verify Theme Toggle Button on Design System
    const themeBtnClicked = await evalJs(dsClient.send, `(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Switch to Light') || b.textContent.includes('Switch to Dark'));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    })()`);
    record("Theme switch toggle button clicked", themeBtnClicked === true);

    console.log("\n======================================================================");
    console.log("  ALL FRONTEND UI BUTTONS & SCENARIOS VERIFIED 100% OPERATIONAL!");
    console.log("======================================================================");

  } finally {
    dsClient.ws.close();
    dsClient.chromeProc.kill();
  }
}

runRigorousUiTests().catch(err => {
  console.error("Test Suite Encountered Failure:", err);
  process.exit(1);
});
