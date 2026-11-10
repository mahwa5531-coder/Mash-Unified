// Mash Desktop Protocol Handlers & Asset Security
// Handles custom privileged schemes, Next.js static asset routing, and path traversal defense.

const fs = require('fs');
const path = require('path');
const { app, protocol } = require('electron');
const { getAppOutDir } = require('./paths');

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

// 1. Privileged scheme registration must run synchronously BEFORE app.whenReady()
function registerPrivilegedSchemes() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}

// 2. Custom deep link protocol registration: mash://auth/callback?code=...
function setupDefaultProtocolClient() {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('mash', process.execPath, [path.resolve(process.argv[1])]);
    }
  } else {
    app.setAsDefaultProtocolClient('mash');
  }
}

// 3. Application protocol handler routing app://mash/* to frontend/out/*
function registerCustomProtocolHandlers() {
  const outDir = getAppOutDir();

  protocol.handle('app', async (request) => {
    try {
      const parsed = new URL(request.url);
      let decodedPath = decodeURIComponent(parsed.pathname);
      if (decodedPath === '/' || decodedPath === '') {
        decodedPath = '/index.html';
      }
      let target = path.join(outDir, decodedPath);

      // Clean HTML routing for Next.js static exports (QA-BUG-10c)
      if (!fs.existsSync(target) || (fs.existsSync(target) && fs.statSync(target).isDirectory())) {
        const cleanPath = decodedPath.replace(/\/+$/, '');
        if (fs.existsSync(path.join(outDir, `${cleanPath}.html`))) {
          target = path.join(outDir, `${cleanPath}.html`);
        } else if (fs.existsSync(path.join(outDir, cleanPath, 'index.html'))) {
          target = path.join(outDir, cleanPath, 'index.html');
        } else {
          target = path.join(outDir, 'index.html');
        }
      }

      // Hard path traversal containment (QA-BUG-3):
      // Target must resolve strictly within frontend/out
      const resolvedTarget = path.resolve(target);
      const normalizedOutDir = path.resolve(outDir);
      if (
        !resolvedTarget.startsWith(normalizedOutDir + path.sep) &&
        resolvedTarget !== normalizedOutDir &&
        resolvedTarget !== path.join(normalizedOutDir, 'index.html')
      ) {
        console.warn('[Protocol:app] Traversal attempt blocked:', request.url);
        return new Response('Forbidden', { status: 403 });
      }

      // Read via Node fs (which penetrates app.asar transparently)
      const data = fs.readFileSync(resolvedTarget);
      const ext = path.extname(target).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      return new Response(data, {
        status: 200,
        headers: { 'Content-Type': contentType },
      });
    } catch (e) {
      console.error('[Protocol:app] Error resolving:', request.url, e);
      return new Response('Not Found', { status: 404 });
    }
  });
}

module.exports = {
  registerPrivilegedSchemes,
  setupDefaultProtocolClient,
  registerCustomProtocolHandlers,
};
