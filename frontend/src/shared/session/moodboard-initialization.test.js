import test from 'node:test';
import assert from 'node:assert/strict';
import { createMoodboardInitialization } from './moodboard-initialization.js';
const session = { token: 'synthetic-A', usuario: { id: 7, nombre: 'QA', usuario: 'qa', rol: 'diseno' } };
const response = body => ({ ok: true, json: async () => body });
function fixture(fetchImpl) {
  let live = session, mounted = true;
  const calls = [], controller = new AbortController();
  const operation = createMoodboardInitialization({ session, readSession: () => live,
    isMounted: () => mounted, signal: controller.signal, fetchImpl: (...args) => { calls.push(args); return fetchImpl(...args); } });
  return { operation, calls, controller, change: value => { live = value; }, unmount: () => { mounted = false; } };
}
test('no write until explicit run; initialize then read use captured Authorization and cancellation signal', async () => {
  const items = [{ id: 3, clientes: [] }];
  const f = fixture(async url => response(url.endsWith('/initialize') ? { ok: true } : items));
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await f.operation.run(), items);
  assert.deepEqual(f.calls.map(([url, init]) => [url, init.method || 'GET']),
    [['/api/moodboards/boards/initialize', 'POST'], ['/api/moodboards/boards', 'GET']]);
  for (const [, init] of f.calls) {
    assert.equal(init.headers.Authorization, 'Bearer synthetic-A'); assert.equal(init.signal, f.controller.signal);
    assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error');
  }
  assert.equal(f.calls[0][1].body, '{}');
});
test('changed account/token/role or unmount never initializes under a different identity', async () => {
  for (const replacement of [null, { ...session, token: 'B' }, { ...session, usuario: { ...session.usuario, id: 8 } },
    { ...session, usuario: { ...session.usuario, rol: 'edicion' } }, { ...session, usuario: { ...session.usuario, activo: false } }]) {
    const f = fixture(() => assert.fail('no fetch')); f.change(replacement);
    assert.equal(await f.operation.run(), null);
  }
  const f = fixture(() => assert.fail('no fetch')); f.unmount(); assert.equal(await f.operation.run(), null);
});
test('late initialization result cannot read or repaint after replacement', async () => {
  let finish; const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.operation.run(); f.change({ ...session, token: 'B' }); finish(response({ ok: true }));
  assert.equal(await pending, null); assert.equal(f.calls.length, 1);
});
test('late list body cannot become visible after account change or unmount', async () => {
  for (const unmount of [false, true]) {
    let finish, entered;
    const reading = new Promise(resolve => { entered = resolve; });
    const f = fixture(async url => url.endsWith('/initialize') ? response({ ok: true })
      : { ok: true, json: () => { entered(); return new Promise(resolve => { finish = resolve; }); } });
    const pending = f.operation.run(); await reading;
    if (unmount) f.unmount(); else f.change({ ...session, token: 'B' });
    finish([{ id: 3 }]); assert.equal(await pending, null);
  }
});
test('uncertain failure and malformed confirmation never retry or fetch the list', async () => {
  for (const fetchImpl of [async () => { throw Error('offline'); }, async () => ({ ok: false, json: async () => ({}) }),
    async () => response({}), async () => ({ ok: true, json: async () => { throw Error('bad JSON'); } })]) {
    const f = fixture(fetchImpl); await assert.rejects(f.operation.run()); assert.equal(f.calls.length, 1);
  }
});
