// Test: Electron Desktop PDF & Native File Opening Wiring
// Verifies:
// 1. electron/main.js has plugins: true in BrowserWindow webPreferences (enables native PDFium).
// 2. electron/main.js registers 'mash-open-path' IPC handler.
// 3. electron/preload.js exposes openPath on contextBridge electronAPI.
// 4. PdfViewer.tsx does NOT contain blocking sandbox attribute on iframe.
// 5. FastAPI connector artifacts router serves .pdf as inline application/pdf.

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

console.log('[*] Testing Electron Desktop PDF & Native File Opening Wiring...');

// 1. Check electron/main.js
const mainJsPath = path.join(rootDir, 'electron', 'main.js');
assert.ok(fs.existsSync(mainJsPath), 'electron/main.js must exist');
const mainJs = fs.readFileSync(mainJsPath, 'utf8');

assert.ok(
  /plugins:\s*true/.test(mainJs),
  'electron/main.js must set plugins: true in webPreferences to enable Chromium native PDF viewer'
);
console.log('  [PASS] 1. electron/main.js has plugins: true enabled in webPreferences.');

assert.ok(
  /mash-open-path/.test(mainJs) && /shell\.openPath/.test(mainJs),
  'electron/main.js must register mash-open-path IPC handler invoking shell.openPath'
);
console.log('  [PASS] 2. electron/main.js registers mash-open-path IPC handler.');

// 2. Check electron/preload.js
const preloadJsPath = path.join(rootDir, 'electron', 'preload.js');
assert.ok(fs.existsSync(preloadJsPath), 'electron/preload.js must exist');
const preloadJs = fs.readFileSync(preloadJsPath, 'utf8');

assert.ok(
  /openPath:\s*\(.*?\)\s*=>\s*ipcRenderer\.invoke\('mash-open-path'/.test(preloadJs),
  'electron/preload.js must expose openPath on electronAPI contextBridge'
);
console.log('  [PASS] 3. electron/preload.js exposes openPath on window.electronAPI.');

// 3. Check frontend/src/features/viewer/components/renderers/PdfViewer.tsx
const pdfViewerPath = path.join(
  rootDir,
  'frontend',
  'src',
  'features',
  'viewer',
  'components',
  'renderers',
  'PdfViewer.tsx'
);
assert.ok(fs.existsSync(pdfViewerPath), 'PdfViewer.tsx must exist');
const pdfViewer = fs.readFileSync(pdfViewerPath, 'utf8');

assert.ok(
  !pdfViewer.includes('sandbox="'),
  'PdfViewer.tsx must NOT have a sandbox attribute on the iframe because it blocks Chromium PDF plugin'
);
assert.ok(
  pdfViewer.includes('<iframe'),
  'PdfViewer.tsx must render an iframe for native PDFium attachment'
);
console.log('  [PASS] 4. PdfViewer.tsx iframe has no sandbox restrictions, allowing native PDFium attachment.');

// 4. Check connector/app/routers/artifacts.py
const artifactsPyPath = path.join(rootDir, 'connector', 'app', 'routers', 'artifacts.py');
assert.ok(fs.existsSync(artifactsPyPath), 'artifacts.py must exist');
const artifactsPy = fs.readFileSync(artifactsPyPath, 'utf8');

assert.ok(
  /media_type="application\/pdf"/.test(artifactsPy) && /content_disposition_type="inline"/.test(artifactsPy),
  'artifacts.py must serve PDFs inline as application/pdf'
);
console.log('  [PASS] 5. Backend artifacts router serves PDFs inline as application/pdf for streaming.');

console.log('[SUCCESS] All Electron Desktop PDF & Native File Opening Wiring tests PASSED!');
