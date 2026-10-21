import test from 'node:test';
import assert from 'node:assert/strict';
import { createReportLoader } from './report-loader.js';
const account = id => ({ token: 'qa-only-' + id, usuario: { id, rol: 'diseno', activo: true } });
const payload = tag => ({ tareas: [{ id: tag }], tareasRenderOs: [], historias: [], publicaciones: [], clientes: [], usuarios: [], entregasEdicion: [] });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('report loader binds period, no-store and observed session before sending', async () => {
  const session = account(1), calls = [];
  const loader = createReportLoader({ session, readSession: () => session, request: async (...args) => { calls.push(args); return payload(1); } });
  assert.deepEqual(await loader.load({ desde: '2026-10-01', hasta: '2026-11-01' }), payload(1));
  assert.equal(calls[0][0], '/api/reportes/datos?desde=2026-10-01&hasta=2026-11-01');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer qa-only-1');
  assert.equal(calls[0][1].cache, 'no-store');
});
test('late period response cannot replace current report even when transport ignores abort', async () => {
  const session = account(1), old = deferred(); let count = 0;
  const loader = createReportLoader({ session, readSession: () => session, request: async () => ++count === 1 ? old.promise : payload(2) });
  const first = loader.load({ desde: 'old' });
  assert.deepEqual(await loader.load({ desde: 'new' }), payload(2));
  old.resolve(payload(1)); assert.equal(await first, null);
});
test('late account response is discarded and old scope cannot start another read', async () => {
  let session = account(1), count = 0; const held = deferred();
  const loader = createReportLoader({ session, readSession: () => session, request: async () => { count++; return held.promise; } });
  const pending = loader.load({}); session = account(2); held.resolve(payload(1));
  assert.equal(await pending, null); assert.equal(await loader.load({}), null); assert.equal(count, 1);
});
test('cleanup discards late failures; a fresh effect instance can load normally', async () => {
  const session = account(1), held = deferred();
  const first = createReportLoader({ session, readSession: () => session, request: () => held.promise });
  const pending = first.load({}); first.cancel(); held.reject(new Error('late error'));
  assert.equal(await pending, null);
  const second = createReportLoader({ session, readSession: () => session, request: async () => payload(2) });
  assert.deepEqual(await second.load({}), payload(2));
});
test('current errors and malformed responses are not successful empty reports', async () => {
  const session = account(1);
  for (const request of [async () => ({}), async () => { throw new Error('offline'); }]) {
    const loader = createReportLoader({ session, readSession: () => session, request });
    await assert.rejects(loader.load({}));
  }
});
