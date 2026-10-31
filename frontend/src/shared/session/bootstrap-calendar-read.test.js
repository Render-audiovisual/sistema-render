import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplicationSession } from './application-session.js';
import { createBootstrapCalendarRead } from './bootstrap-calendar-read.js';
import { createBrowserSessionState } from './browser-session-state.js';

const request = '/api/calendario?desde=2026-09-28&hasta=2026-11-02&vista=publicaciones&limit=200&offset=0';
const context = 'a'.repeat(43);
const session = { usuario: { id: 1, usuario: 'test', nombre: 'Test', rol: 'admin' }, session_context: context, csrf_token: 'b'.repeat(43) };
const response = (body, proof = context, status = 200) => new Response(JSON.stringify(body), { status,
  headers: proof ? { 'X-Render-Session-Context': proof } : {} });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const tick = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
function runtime(fetchImpl, extra = {}) {
  return createApplicationSession({ mode: 'browser', fetchImpl, location: { origin: 'https://render.test' },
    locks: { request: async (_name, _options, work) => work() }, initialCalendarRead: request, ...extra });
}

test('calendar read starts before session finishes; no adoption before authentication; only one calendar GET', async () => {
  const gate = deferred(), calls = [];
  const app = runtime(async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/sesion') { await gate.promise; return response(session); }
    assert.equal(url, request); return response({ events: ['verified'] });
  });
  const start = app.start(); await tick();
  assert.deepEqual(calls.map(x => x.url), ['/api/sesion', request]);
  assert.equal(app.getSession(), null);
  await assert.rejects(app.fetch(request), /sesión/);
  assert.equal(calls.length, 2);
  gate.resolve(); await start;
  assert.deepEqual(await (await app.fetch(request)).json(), { events: ['verified'] });
  assert.equal(calls.length, 2);
  await app.fetch(request); assert.equal(calls.length, 3, 'not a persistent cache');
  assert.equal(calls[1].options.credentials, 'same-origin');
  assert.equal(calls[1].options.redirect, 'error');
  assert.equal(calls[1].options.cache, 'no-store');
  app.dispose();
});

for (const kind of ['different proof', 'missing proof', 'unauthorized', 'network failure']) {
  test(`unusable speculative response falls back through authenticated transport: ${kind}`, async () => {
    let reads = 0;
    const app = runtime(async url => {
      if (url === '/api/sesion') return response(session);
      if (++reads > 1) return response({ fresh: true });
      if (kind === 'network failure') throw new Error('offline');
      return response({ stale: true }, kind === 'different proof' ? 'c'.repeat(43) : kind === 'missing proof' ? null : context,
        kind === 'unauthorized' ? 401 : 200);
    });
    await app.start();
    assert.deepEqual(await (await app.fetch(request)).json(), { fresh: true });
    assert.equal(reads, 2); assert.equal(app.getSession().usuario.id, 1); app.dispose();
  });
}

test('withdrawal discards pending read and prevents consumption after session changes', async () => {
  let notify, signal;
  const gate = deferred();
  const app = runtime(async (url, options) => {
    if (url === '/api/sesion') return response(session);
    signal = options.signal; await gate.promise; return response({ stale: true });
  }, { sessionChanges: { subscribe(fn) { notify = fn; return () => {}; } } });
  await app.start(); notify();
  assert.equal(signal.aborted, true); assert.equal(app.getSession(), null);
  gate.resolve(); await assert.rejects(app.fetch(request)); app.dispose();
});

test('anonymous bootstrap aborts speculative request; unrelated routes never reuse it', async () => {
  let signal;
  const app = runtime(async (url, options) => {
    if (url === '/api/sesion') { await tick(); return response({}, null, 401); }
    signal = options.signal; return response({});
  });
  await app.start(); assert.equal(signal.aborted, true); await assert.rejects(app.fetch(request)); app.dispose();
  const urls = [];
  const other = runtime(async url => { urls.push(url); return response(session); }, { initialCalendarRead: '/api/finanzas?vista=publicaciones' });
  await other.start(); assert.deepEqual(urls, ['/api/sesion']); other.dispose();
});

test('accepted read retains body ownership and the normal fence rejects a body after invalidation', async () => {
  let signal;
  const app = runtime(async (url, options) => {
    if (url === '/api/sesion') return response(session);
    signal = options.signal; return response({ verified: true });
  });
  await app.start(); const result = await app.fetch(request);
  assert.equal(signal.aborted, false);
  const intent = (await import('./browser-session-state.js')).captureBrowserSessionIntent(app.getSession());
  app.invalidateSession(intent);
  await assert.rejects(result.json(), /sesión/); app.dispose();
});

test('bounded lifetime aborts an unused read; subsequent requests use the network', async () => {
  const store = createBrowserSessionState(), ticket = store.beginBootstrap();
  let calls = 0, signal;
  const read = createBootstrapCalendarRead({ request, store, ttl: 5, fetchImpl: async (_url, options) => {
    calls++; signal = options.signal; return response({ fresh: true });
  } });
  read.start(); await tick(); const initialSignal = signal;
  store.acceptBootstrap(ticket, session);
  await new Promise(done => setTimeout(done, 15));
  assert.equal(initialSignal.aborted, true);
  await read.fetch(request, { method: 'GET' }); assert.equal(calls, 2); read.dispose();
});

test('different month and POST are never supplied the speculative GET', async () => {
  const calls = [];
  const app = runtime(async (url, options) => { calls.push({ url, method: options.method });
    return url === '/api/sesion' ? response(session) : response({ fresh: true }); });
  await app.start();
  await app.fetch(`${request}&different=1`);
  const { captureBrowserSessionIntent } = await import('./browser-session-state.js');
  await app.fetch(request, { method: 'POST', sessionIntent: captureBrowserSessionIntent(app.getSession()) });
  assert.equal(calls.length, 4); assert.equal(calls.at(-1).method, 'POST'); app.dispose();
});

test('dispose cancels an outstanding read, and abort during adoption does not retry', async () => {
  const gate = deferred(); let signal, calls = 0;
  const app = runtime(async (url, options) => {
    if (url === '/api/sesion') return response(session);
    calls++; signal = options.signal; await gate.promise; return response({});
  });
  await app.start();
  const abort = new AbortController(); const result = app.fetch(request, { signal: abort.signal });
  abort.abort(); gate.resolve(); await assert.rejects(result);
  assert.equal(signal.aborted, true); assert.equal(calls, 1); app.dispose();
  const second = runtime(async (url, options) => {
    if (url === '/api/sesion') return response(session);
    signal = options.signal; return response({});
  });
  await second.start(); second.dispose(); assert.equal(signal.aborted, true);
});
