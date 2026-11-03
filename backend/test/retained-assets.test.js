import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import express from 'express';
import { createRetainedAssetMiddleware } from '../src/retained-assets.js';
import { preservePublicAssets } from '../src/public-asset-cache.js';

const JS = 'Reports-Ab12Cd34.js';
const CSS = 'Reports-Ef56Gh78.css';
const scopeHash = index => index.toString(16).padStart(64, '0');

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'render-retained-assets-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const distDir = path.join(root, 'current', 'frontend', 'dist');
  const cacheRoot = path.join(root, 'public-assets');
  await mkdir(path.join(distDir, 'assets'), { recursive: true });
  await mkdir(cacheRoot);
  async function put(dir, name, body = 'export const retained = true;') {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, name), body);
  }
  async function cached(index, name = JS, body = `cached-${index}`) {
    const base = path.join(cacheRoot, scopeHash(index));
    await put(base, name, body);
    // Explicit deterministic newest-first order, independent of readdir order.
    const stamp = new Date(Date.UTC(2026, 0, 10 - index));
    await utimes(base, stamp, stamp);
    return base;
  }
  return { root, distDir, cacheRoot, put, cached };
}

// Supports streaming Node responses and Express-style send/sendFile. No socket,
// production server, authentication, database, or deployment is involved.
async function invoke(middleware, url, method = 'GET') {
  const headers = new Map(), chunks = [];
  let nextCalls = 0;
  let settle, fail;
  const done = new Promise((resolve, reject) => { settle = resolve; fail = reject; });
  const res = new Writable({ write(chunk, encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  res.statusCode = 200;
  res.setHeader = (name, value) => { headers.set(name.toLowerCase(), String(value)); return res; };
  res.getHeader = name => headers.get(name.toLowerCase());
  res.removeHeader = name => headers.delete(name.toLowerCase());
  res.set = res.header = (name, value) => {
    if (typeof name === 'object') for (const [key, item] of Object.entries(name)) res.setHeader(key, item);
    else res.setHeader(name, value);
    return res;
  };
  res.status = value => { res.statusCode = value; return res; };
  res.type = res.contentType = value => { res.setHeader('Content-Type', value); return res; };
  res.send = body => { res.end(method === 'HEAD' ? undefined : body); return res; };
  res.sendFile = (filename, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    const full = options?.root ? path.resolve(options.root, filename) : filename;
    readFile(full).then(bytes => {
      for (const [key, value] of Object.entries(options?.headers || {})) res.setHeader(key, value);
      res.end(method === 'HEAD' ? undefined : bytes); callback?.();
    }, error => callback ? callback(error) : fail(error));
    return res;
  };
  res.on('finish', settle); res.on('error', fail);
  const req = { method, url, originalUrl: url, path: url.split('?')[0], headers: {}, get: () => undefined };
  const returned = middleware(req, res, error => { nextCalls += 1; error ? fail(error) : settle(); });
  Promise.resolve(returned).catch(fail);
  await done;
  return { nextCalls, status: res.statusCode, headers, body: Buffer.concat(chunks).toString() };
}

function assertAsset(response, body, kind = 'js') {
  assert.equal(response.nextCalls, 0);
  assert.equal(response.status, 200);
  assert.equal(response.body, body);
  assert.match(response.headers.get('cache-control') || '', /immutable/i);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-type') || '', kind === 'css' ? /^text\/css(?:;|$)/i : /^(?:text|application)\/javascript(?:;|$)/i);
}
function assertMiss(response) {
  assert.equal(response.nextCalls, 1);
  assert.equal(response.body, '', 'must not send SPA HTML or private bytes');
}

test('direct public assets survive many archive scopes and take priority over legacy copies', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  for (let i = 1; i <= 12; i += 1) await f.cached(i, `Archive${i}-Ab12Cd34.js`, `archive-${i}`);
  await f.put(path.join(f.cacheRoot, scopeHash(1)), JS, 'legacy-copy');
  await f.put(path.join(f.cacheRoot, 'assets'), JS, 'direct-js');
  await f.put(path.join(f.cacheRoot, 'assets'), CSS, 'direct-css');
  const middleware = createRetainedAssetMiddleware({ ...f, readLimit: 1 });
  assertAsset(await invoke(middleware, `/assets/${JS}`), 'direct-js');
  assertAsset(await invoke(middleware, `/assets/${CSS}`), 'direct-css', 'css');
  assertAsset(await invoke(middleware, `/assets/${JS}`, 'HEAD'), '');
  assertAsset(await invoke(middleware, `/assets/${CSS}`, 'HEAD'), '', 'css');
  // Missing direct files still use the bounded legacy fallback.
  assertAsset(await invoke(middleware, '/assets/Archive1-Ab12Cd34.js'), 'archive-1');
  assertMiss(await invoke(middleware, '/assets/Archive12-Ab12Cd34.js'));
});

test('direct public assets reject symlink directories and files', { timeout: 5000 }, async t => {
  for (const kind of ['directory', 'file']) {
    await t.test(kind, async child => {
      const f = await fixture(child);
      const privateDir = path.join(f.root, 'private');
      await f.put(privateDir, JS, 'private bytes');
      const direct = path.join(f.cacheRoot, 'assets');
      if (kind === 'directory') await symlink(privateDir, direct, 'dir');
      else {
        await mkdir(direct);
        await symlink(path.join(privateDir, JS), path.join(direct, JS));
      }
      const middleware = createRetainedAssetMiddleware(f);
      for (const method of ['GET', 'HEAD']) assertMiss(await invoke(middleware, `/assets/${JS}`, method));
      // An unsafe direct candidate must not prevent a safe legacy recovery.
      await f.cached(1, JS, 'safe legacy bytes');
      assertAsset(await invoke(middleware, `/assets/${JS}`), 'safe legacy bytes');
    });
  }
});

test('cache fallback serves exact hashed JS/CSS; HEAD has no body', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  await f.cached(1, JS, 'old-js');
  await f.cached(2, CSS, 'cached-css');
  const middleware = createRetainedAssetMiddleware(f);
  assertAsset(await invoke(middleware, `/assets/${JS}`), 'old-js');
  assertAsset(await invoke(middleware, `/assets/${CSS}?v=1`), 'cached-css', 'css');
  assertAsset(await invoke(middleware, `/assets/${JS}`, 'HEAD'), '');
});

test('missing current chunk is recovered from a persistent 64-hex cache scope', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  await f.cached(1, JS, 'previous-js');
  await f.cached(2, CSS, 'previous-css');
  const middleware = createRetainedAssetMiddleware(f);
  assertAsset(await invoke(middleware, `/assets/${JS}`), 'previous-js');
  assertAsset(await invoke(middleware, `/assets/${CSS}`), 'previous-css', 'css');
  assertAsset(await invoke(middleware, `/assets/${CSS}`, 'HEAD'), '', 'css');
  assertMiss(await invoke(middleware, '/assets/Missing-Ab12Cd34.js'));
});

test('only GET/HEAD safe hashed JS/CSS basenames are eligible; no fallback HTML', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  await f.cached(1);
  await f.put(f.distDir, 'index.html', '<html>must never serve</html>');
  for (const dir of [path.join(f.distDir, 'assets'), path.join(f.cacheRoot, scopeHash(1))]) {
    await f.put(dir, `${JS}.map`, 'private sourcemap');
    await f.put(dir, 'index.js', 'unhashed script');
    await f.put(path.join(dir, 'nested'), JS, 'nested script');
  }
  const middleware = createRetainedAssetMiddleware(f);
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) assertMiss(await invoke(middleware, `/assets/${JS}`, method));
  for (const url of [
    '/clientes', '/index.html', '/assets/index.js', `/assets/${JS}.map`,
    '/assets/logo.svg', `/assets/nested/${JS}`, `/assets/../${JS}`,
    '/assets/%2e%2e/private.js', '/assets/%2e%2e%2fprivate.js',
    '/assets/..%5cprivate.js', '/assets/.env', `/assets/${JS}%00`,
  ]) assertMiss(await invoke(middleware, url));
});

test('default reads at most four newest cache scopes; lower explicit limit is respected', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  for (let i = 1; i <= 5; i += 1) await f.cached(i, `Version${i}-Ab12Cd34.js`, `v${i}`);
  const middleware = createRetainedAssetMiddleware(f);
  assertAsset(await invoke(middleware, '/assets/Version4-Ab12Cd34.js'), 'v4');
  assertMiss(await invoke(middleware, '/assets/Version5-Ab12Cd34.js'));
  const limited = createRetainedAssetMiddleware({ ...f, readLimit: 1 });
  assertAsset(await invoke(limited, '/assets/Version1-Ab12Cd34.js'), 'v1');
  assertMiss(await invoke(limited, '/assets/Version2-Ab12Cd34.js'));
  let oversized;
  try { oversized = createRetainedAssetMiddleware({ ...f, readLimit: 99 }); }
  catch (error) {
    assert.match(error.message, /limit/i, 'invalid limit may be rejected explicitly');
  }
  if (oversized) assertMiss(await invoke(oversized, '/assets/Version5-Ab12Cd34.js'));
});

test('real Express chain: current asset priority, retained GET/HEAD, missing asset 404 never SPA HTML', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  await f.put(path.join(f.distDir, 'assets'), JS, 'current-js');
  await f.cached(1, JS, 'older-js');
  await f.cached(2, CSS, 'retained-css');
  const app = express();
  // Mirror server.js ordering without importing the production server/DB.
  app.use(express.static(f.distDir, { setHeaders(res, file) {
    if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } }));
  app.use(createRetainedAssetMiddleware(f));
  app.use('/assets', (_req, res) => res.status(404).set('Cache-Control', 'no-store').type('text/plain').send('Archivo no disponible.'));
  let spaHits = 0;
  app.use((_req, res) => { spaHits += 1; res.type('html').send('<html>SPA fallback</html>'); });
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve(listener));
    listener.once('error', reject);
  });
  t.after(() => new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const current = await fetch(`${origin}/assets/${JS}`);
  assert.equal(current.status, 200);
  assert.equal(await current.text(), 'current-js');
  assert.match(current.headers.get('content-type'), /javascript/);
  assert.match(current.headers.get('cache-control'), /immutable/);
  for (const method of ['GET', 'HEAD']) {
    const response = await fetch(`${origin}/assets/${CSS}`, { method });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/css/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('cache-control'), /immutable/);
    assert.equal(response.headers.get('content-length'), String(Buffer.byteLength('retained-css')));
    assert.equal(await response.text(), method === 'HEAD' ? '' : 'retained-css');
    const missing = await fetch(`${origin}/assets/Missing-Ab12Cd34.js`, { method });
    assert.equal(missing.status, 404);
    assert.match(missing.headers.get('content-type'), /^text\/plain/);
    assert.equal(missing.headers.get('cache-control'), 'no-store');
    assert.equal(await missing.text(), method === 'HEAD' ? '' : 'Archivo no disponible.');
  }
  assert.equal(spaHits, 0, 'asset misses must not reach SPA fallback');
  const route = await fetch(`${origin}/clientes`);
  assert.match(await route.text(), /SPA fallback/);
  assert.equal(spaHits, 1);
});

test('Hostinger retirement: preserved old lazy chunk survives deletion of its version via auto-discovered cache', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const hbuilds = path.join(f.root, 'hbuilds');
  const oldVersion = path.join(hbuilds, 'versions', '00000000-0000-4000-8000-000000000001');
  const newVersion = path.join(hbuilds, 'versions', '00000000-0000-4000-8000-000000000002');
  const oldDist = path.join(oldVersion, 'nodejs', 'frontend', 'dist');
  const newDist = path.join(newVersion, 'nodejs', 'frontend', 'dist');
  const cacheRoot = path.join(hbuilds, 'public-assets');
  const newJS = 'Reports-NewHash9.js';
  const oldCode = 'export const release = "old lazy chunk";';
  const newCode = 'export const release = "current lazy chunk";';
  await f.put(path.join(oldDist, 'assets'), JS, oldCode);
  await f.put(path.join(newDist, 'assets'), newJS, newCode);
  await f.put(oldDist, 'index.html', '<html>old release</html>');
  await f.put(newDist, 'index.html', '<html>new release</html>');
  assert.equal((await preservePublicAssets({ sourceDir: path.join(oldDist, 'assets'), cacheRoot })).files, 1);
  assert.equal((await preservePublicAssets({ sourceDir: path.join(newDist, 'assets'), cacheRoot })).files, 1);
  // Explicit, fixture-owned target only: model Hostinger retiring the old UUID.
  assert.ok(oldVersion.startsWith(`${f.root}${path.sep}`));
  await rm(oldVersion, { recursive: true });
  await assert.rejects(readFile(path.join(oldDist, 'assets', JS)), { code: 'ENOENT' });

  const app = express();
  app.use(express.static(newDist, { setHeaders(res) { res.setHeader('X-Fixture-Source', 'current-build'); } }));
  app.use(createRetainedAssetMiddleware({ distDir: newDist })); // No injected cacheRoot.
  app.use('/assets', (_req, res) => res.status(404).type('text/plain').send('Missing asset'));
  let spaHits = 0;
  app.use((_req, res) => { spaHits += 1; res.type('html').send('<html>SPA fallback</html>'); });
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve(listener));
    listener.once('error', reject);
  });
  t.after(() => new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const method of ['GET', 'HEAD']) {
    const old = await fetch(`${origin}/assets/${JS}`, { method });
    assert.equal(old.status, 200);
    assert.match(old.headers.get('content-type'), /javascript/);
    assert.match(old.headers.get('cache-control'), /immutable/);
    assert.equal(old.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(old.headers.get('x-fixture-source'), null, 'retired chunk must come from retention');
    assert.equal(await old.text(), method === 'HEAD' ? '' : oldCode);
    const current = await fetch(`${origin}/assets/${newJS}`, { method });
    assert.equal(current.status, 200);
    assert.equal(current.headers.get('x-fixture-source'), 'current-build', 'static current build must precede its preserved copy');
    assert.equal(await current.text(), method === 'HEAD' ? '' : newCode);
  }
  const missing = await fetch(`${origin}/assets/Missing-Ab12Cd34.js`);
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), 'Missing asset');
  assert.equal(spaHits, 0, 'neither retained assets nor asset misses reach HTML fallback');
});

test('auto discovery follows dist realpath only in the exact Hostinger hbuilds layout', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const hbuilds = path.join(f.root, 'hbuilds');
  const realDist = path.join(hbuilds, 'versions', '00000000-0000-4000-8000-000000000001', 'nodejs', 'frontend', 'dist');
  await mkdir(path.join(realDist, 'assets'), { recursive: true });
  await f.put(path.join(hbuilds, 'public-assets', scopeHash(1)), JS, 'auto-discovered');
  const linkedDist = path.join(f.root, 'live-dist');
  await symlink(realDist, linkedDist, 'dir');
  assertAsset(await invoke(createRetainedAssetMiddleware({ distDir: linkedDist }), `/assets/${JS}`), 'auto-discovered');
  // A normal local build cannot accidentally discover a neighboring cache.
  assertMiss(await invoke(createRetainedAssetMiddleware({ distDir: f.distDir }), `/assets/${JS}`));
});

test('current assets directory and current exact file cannot be symlinks', { timeout: 5000 }, async t => {
  for (const kind of ['directory', 'file']) {
    await t.test(kind, async child => {
      const f = await fixture(child);
      const privateDir = path.join(f.root, 'private');
      await f.put(privateDir, JS, 'private');
      let distDir = f.distDir;
      if (kind === 'directory') {
        distDir = path.join(f.root, 'another-dist');
        await mkdir(distDir);
        await symlink(privateDir, path.join(distDir, 'assets'), 'dir');
      } else await symlink(path.join(privateDir, JS), path.join(distDir, 'assets', JS));
      assertMiss(await invoke(createRetainedAssetMiddleware({ ...f, distDir }), `/assets/${JS}`));
    });
  }
});

test('non-64-lowercase-hex scopes and nested/private layouts are never searched', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  for (const name of ['private', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64), ' '+ 'a'.repeat(64)]) {
    await f.put(path.join(f.cacheRoot, name), JS, 'private');
  }
  await f.put(path.join(f.cacheRoot, scopeHash(1), 'assets'), JS, 'wrong-layout');
  assertMiss(await invoke(createRetainedAssetMiddleware(f), `/assets/${JS}`));
});

test('symlinked cache scope, cache root, or exact cached asset cannot expose private bytes', { timeout: 5000 }, async t => {
  for (const kind of ['scope', 'root', 'file']) {
    await t.test(kind, async child => {
      const f = await fixture(child);
      const external = path.join(f.root, 'private');
      await f.put(external, JS, 'private');
      const base = path.join(f.cacheRoot, scopeHash(1));
      let cacheRoot = f.cacheRoot;
      if (kind === 'scope') await symlink(external, base, 'dir');
      else if (kind === 'root') {
        await f.put(path.join(external, scopeHash(1)), JS, 'private');
        cacheRoot = path.join(f.root, 'cache-link');
        await symlink(external, cacheRoot, 'dir');
      } else {
        await mkdir(base);
        await symlink(path.join(external, JS), path.join(base, JS));
      }
      assertMiss(await invoke(createRetainedAssetMiddleware({ ...f, cacheRoot }), `/assets/${JS}`));
    });
  }
});
