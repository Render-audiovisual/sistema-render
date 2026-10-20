import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Real Vite middleware/HTTP, not a browser evaluation or backend/DB test.
// Ordinary test discovery opens no socket and creates no cache directory.
test('canonical development serves the actual App and SPA entries without preview imports or sandbox proxy', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 60000,
}, async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'render-canonical-vite-'));
  let vite, server;
  const sockets = new Set();
  t.after(async () => {
    try {
      if (server?.listening) {
        const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        // Only sockets accepted by this test's own ephemeral HTTP server.
        for (const socket of sockets) socket.destroy();
        await closed;
      }
    } finally {
      try { if (vite) await vite.close(); }
      finally {
        await rm(cacheDir, { recursive: true, force: true });
        await assert.rejects(access(cacheDir), error => error.code === 'ENOENT');
      }
    }
  });
  vite = await createServer({
    root, configFile: path.join(root, 'vite.config.js'), mode: 'development', cacheDir,
    logLevel: 'silent', clearScreen: false,
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  assert.equal(vite.config.root, root.replace(/\/$/, ''));
  assert.equal(vite.config.mode, 'development');
  assert.equal(vite.config.server.middlewareMode, true);
  const sandboxPaths = ['/sandbox-api', '/sandbox-api/qa-canonical-development'];
  // Inspect the resolved REAL config before issuing any request. If a stale
  // sandbox proxy remains, fail without ever contacting its configured target.
  for (const [context, options] of Object.entries(vite.config.server.proxy || {})) {
    const matches = route => context.startsWith('^') ? new RegExp(context).test(route) : route.startsWith(context);
    assert.equal(sandboxPaths.some(matches), false, 'No resolved proxy may match sandbox requests');
    const target = typeof options === 'string' ? options : options.target;
    const port = typeof target === 'string' ? new URL(target).port : String(target?.port || '');
    assert.notEqual(port, '5190', 'Resolved config must not retain the old sandbox target');
  }
  server = http.createServer((req, res) => {
    vite.middlewares(req, res, error => {
      res.statusCode = error ? 500 : 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(error ? 'Development middleware failure' : 'Not found');
    });
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.equal(address.address, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;
  const get = async route => {
    const response = await fetch(new URL(route, base), { signal: AbortSignal.timeout(10000), redirect: 'error' });
    return { status: response.status, type: response.headers.get('content-type') || '', text: await response.text() };
  };

  const transformed = await get('/src/App.jsx');
  assert.equal(transformed.status, 200); assert.match(transformed.type, /javascript/);
  for (const inherited of ['DesignPreview', 'CommentsProposal', 'LocalDesignShell']) {
    const pattern = new RegExp(`\\b${inherited}\\b`);
    assert.equal(pattern.test(`const ${inherited} = 1`), true, 'Forbidden-name check must match its positive canary');
    assert.equal(pattern.test(`const Prefix${inherited}Suffix = 1`), false, 'Forbidden-name check must use word boundaries');
    assert.equal(pattern.test(transformed.text), false,
      `Actual transformed App must not retain ${inherited} imports or wrapper`);
  }
  assert.match(transformed.text, /QuickHomePage/);
  assert.match(transformed.text, /ProductionsPage/);

  const entry = html => {
    assert.match(html, /<div\s+id=["']root["']\s*>/);
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(match => match[1]);
    assert.ok(scripts.includes('/src/main.jsx'), 'Canonical HTML must load the real main entry');
    return scripts;
  };
  const index = await get('/'); assert.equal(index.status, 200); assert.match(index.type, /text\/html/);
  const canonicalScripts = entry(index.text);
  for (const route of ['/inicio', '/producciones', '/inicio/producciones']) {
    const response = await get(route); assert.equal(response.status, 200); assert.match(response.type, /text\/html/);
    assert.deepEqual(entry(response.text), canonicalScripts, 'SPA deep links must serve the same real entry, not a parallel preview');
  }
  for (const route of sandboxPaths) {
    const response = await get(route);
    assert.ok([200, 404].includes(response.status), 'Retired sandbox path is local HTML fallback or local 404');
    assert.doesNotMatch(response.type, /application\/json/i);
    if (response.status === 200) { assert.match(response.type, /text\/html/); assert.deepEqual(entry(response.text), canonicalScripts); }
  }
  // No /api request, default Vite CLI, actual backend, provider, browser JS or
  // configured database is started/executed by this middleware proof.
});
