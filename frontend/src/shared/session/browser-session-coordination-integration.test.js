import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserSessionCoordination } from './browser-session-coordination.js';
import { createApplicationSession } from './application-session.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const dto = id => ({ usuario: { id, nombre: 'Synthetic', usuario: `qa${id}`, rol: 'edicion' }, session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) });
const response = value => new Response(JSON.stringify(value), { headers: { 'X-Render-Session-Context': value.session_context || '' } });
const tick = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

// Two distinct BroadcastChannel-compatible endpoints; messages never deliver
// to their sender. Explicit flush models asynchronous browser message tasks.
function peers() {
  const channels = [], messages = [];
  return {
    createChannel(name) {
      const listeners = new Set();
      const channel = { name, closed: false,
        addEventListener(_type, fn) { listeners.add(fn); },
        removeEventListener(_type, fn) { listeners.delete(fn); },
        close() { channel.closed = true; },
        postMessage(data) {
          for (const peer of channels) if (peer !== channel && peer.name === name)
            messages.push(() => { if (!peer.closed) for (const fn of peer.listeners) fn({ data: structuredClone(data) }); });
        }, listeners,
      };
      channels.push(channel); return channel;
    },
    flush() { while (messages.length) messages.shift()(); },
  };
}
function fixture(fetchA, fetchB) {
  const bus = peers(); let tail = Promise.resolve(), held = 0; const events = [];
  const locks = { request(name, options, work) {
    assert.equal(name, 'render:browser-session:v1'); assert.deepEqual(options, { mode: 'exclusive' });
    const result = tail.then(async () => {
      held++; assert.equal(held, 1); events.push('acquire');
      try { return await work(); } finally { held--; events.push('release'); }
    }); tail = result.catch(() => {}); return result;
  } };
  const coordinators = [createBrowserSessionCoordination(bus), createBrowserSessionCoordination(bus)];
  const runtimes = [fetchA, fetchB].map((fetchImpl, i) => createApplicationSession({
    mode: 'browser', location: { origin: 'https://render.example.test' }, fetchImpl, locks,
    sessionChanges: coordinators[i], notifyChange: coordinators[i].notifyChange,
  }));
  return { bus, events, a: runtimes[0], b: runtimes[1], ca: coordinators[0], cb: coordinators[1],
    dispose() { for (const runtime of runtimes) runtime.dispose(); for (const c of coordinators) c.dispose(); } };
}

test('two document runtimes: external hint cancels cookie POST publication without releasing shared lock or reauthenticating', async () => {
  const post = deferred(), entered = deferred(); let readsA = 0, readsB = 0;
  const f = fixture(async (url, options) => {
    if (url === '/api/sesion') { readsA++; return response(dto(1)); }
    if (url === '/api/sesion/desafio') return response({ csrf_token: 'c'.repeat(43) });
    assert.equal(url, '/api/login/browser'); assert.equal(options.signal, undefined);
    entered.resolve(); return post.promise;
  }, async url => { assert.equal(url, '/api/sesion'); readsB++; return response(dto(2)); });
  try {
    await f.a.start(); const publications = [];
    f.a.subscribe(() => { if (f.a.getSession()) publications.push(f.a.getSession()); });
    const pending = f.a.login({ kind: 'password', body: { usuario: 'qa', password: 'synthetic' } });
    await entered.promise;
    const queued = f.b.start(); await tick(); assert.equal(readsB, 0);
    f.cb.notifyChange({ reason: 'logout' }); f.bus.flush();
    assert.equal(f.a.getSnapshot().status, 'anonymous');
    await tick(); assert.equal(readsB, 0); assert.equal(f.events.at(-1), 'acquire');
    post.resolve(response(dto(9)));
    assert.equal((await pending).ok, false); await queued;
    assert.equal(readsA, 1); assert.equal(readsB, 1); assert.deepEqual(publications, []);
    assert.equal(f.a.getSession(), null);
    // A's canceled POST still emits its advisory hint, withdrawing B only.
    assert.equal(f.b.getSession().usuario.id, 2); f.bus.flush();
    assert.equal(f.b.getSession(), null); assert.equal(readsB, 1);
  } finally { f.dispose(); }
});

test('late login body and synchronous observation invalidation cannot hand an authenticated ACK to the UI', async () => {
  const body = deferred(), entered = deferred(); let reads = 0;
  const f = fixture(async url => {
    if (url === '/api/sesion') { reads++; return response(dto(1)); }
    if (url === '/api/sesion/desafio') return response({ csrf_token: 'c'.repeat(43) });
    return { ok: true, json() { entered.resolve(); return body.promise; } };
  }, async () => response(dto(2)));
  try {
    await f.a.start(); await f.b.start();
    let published = 0;
    f.a.subscribe(() => { if (f.a.getSession()) published++; });
    const pending = f.a.login({ kind: 'password', body: { usuario: 'qa', password: 'synthetic' } });
    await entered.promise; f.cb.notifyChange({ reason: 'login' }); f.bus.flush();
    body.resolve(dto(8)); assert.equal((await pending).ok, false);
    assert.equal(f.a.getSession(), null); assert.equal(reads, 1); assert.equal(published, 0);
    f.bus.flush();
  } finally { f.dispose(); }

  const g = fixture(async url => url === '/api/sesion/desafio'
    ? response({ csrf_token: 'c'.repeat(43) }) : response(dto(3)), async () => response(dto(2)));
  try {
    await g.a.start(); await g.b.start();
    g.a.subscribe(() => {
      if (g.a.getSession()) { g.cb.notifyChange({ reason: 'logout' }); g.bus.flush(); }
    });
    const result = await g.a.login({ kind: 'password', body: { usuario: 'qa', password: 'synthetic' } });
    assert.equal(result.ok, false); assert.equal(g.a.getSession(), null);
  } finally { g.dispose(); }
});
