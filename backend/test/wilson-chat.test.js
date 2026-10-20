import test from "node:test";
import assert from "node:assert/strict";
import { shouldSendWilsonDigest, wilsonPeriod, createWilsonChatRouter } from "../src/wilson-chat.js";
import { readFileSync } from 'node:fs';

test("el período de Wilson usa el mes de Argentina", () => {
  assert.equal(wilsonPeriod(new Date("2026-09-01T02:00:00Z")), "2026-08");
});

test("viernes a las 10 genera un control semanal", () => {
  assert.deepEqual(shouldSendWilsonDigest(new Date("2026-08-21T13:00:00Z")), { date: "2026-08-21", type: "semanal" });
});

test("el día 28 que también es viernes combina ambos controles", () => {
  assert.deepEqual(shouldSendWilsonDigest(new Date("2026-08-28T13:00:00Z")), { date: "2026-08-28", type: "semanal_mensual" });
});

// Execute registered handlers with synthetic SQL responses; no HTTP/DB claim.
function fixture(current = null, fail = false) {
  const routes = new Map(), calls = [];
  const pool = { async query(sql, params) {
    calls.push({ sql, params });
    assert.match(sql.trim(), /^SELECT\b/); assert.doesNotMatch(sql, /INSERT|UPDATE|DELETE|FOR UPDATE/);
    if (fail) throw new Error('synthetic query failure');
    if (sql.includes('FROM wilson_conversaciones')) return { rows: current ? [current] : [] };
    if (sql.includes('FROM wilson_mensajes')) return { rows: [{ id: '71', contenido: 'Literal message' }] };
    if (sql.includes('FROM tareas')) return { rows: [] };
    throw new Error('Unexpected query');
  } };
  const router = Object.fromEntries(['get', 'post', 'delete'].map(method => [method, (path, fn) => routes.set(`${method}:${path}`, fn)]));
  createWilsonChatRouter({ express: { Router: () => router }, pool });
  return { calls, async get(path, rol = 'admin') {
    let status = 200, body;
    const response = { status(value) { status = value; return this; }, json(value) { body = value; return this; } };
    await routes.get(`get:${path}`)({ auth: { id: 7, rol }, params: { userId: '8' } }, response, error => { throw error; });
    return { status, body };
  } };
}
for (const path of ['/conversacion', '/conversaciones/:userId']) {
  test(`${path}: absent conversation is null with empty messages and SELECTs only`, async () => {
    const f = fixture(); const result = await f.get(path);
    assert.equal(result.status, 200); assert.equal(result.body.conversation, null); assert.deepEqual(result.body.messages, []);
    assert.equal(f.calls.some(call => call.sql.includes('FROM wilson_mensajes')), false);
    assert.deepEqual(f.calls[0].params, [path === '/conversacion' ? 7 : '8', wilsonPeriod()]);
    if (path === '/conversacion') {
      assert.ok(result.body.priorities); assert.ok(Array.isArray(result.body.priorities.recommendations));
      const taskRead = f.calls.find(call => call.sql.includes('FROM tareas'));
      assert.ok(taskRead); assert.ok(taskRead.params.includes(7), 'self priorities stay current-ID scoped');
    } else assert.equal(Object.hasOwn(result.body, 'priorities'), false);
  });
  test(`${path}: existing conversation and ordered messages return without writes`, async () => {
    const current = { id: '9223372036854775807', usuario_id: 7, periodo: wilsonPeriod() }, f = fixture(current);
    const result = await f.get(path); assert.deepEqual(result.body.conversation, current);
    assert.deepEqual(result.body.messages, [{ id: '71', contenido: 'Literal message' }]);
    const read = f.calls.find(call => call.sql.includes('FROM wilson_mensajes'));
    assert.deepEqual(read.params, [current.id]); assert.match(read.sql, /ORDER BY created_at,id/);
  });
  test(`${path}: database failures propagate rather than creating a replacement`, async () => {
    const f = fixture(null, true); await assert.rejects(f.get(path), /synthetic query failure/); assert.equal(f.calls.length, 1);
  });
}
test('other-user conversation stays admin-only and denies before SQL', async () => {
  const f = fixture(); assert.equal((await f.get('/conversaciones/:userId', 'edicion')).status, 403); assert.equal(f.calls.length, 0);
});
test('POST writers still create conversations; actual frontend consumers do not dereference nullable conversation', () => {
  const source = readFileSync(new URL('../src/wilson-chat.js', import.meta.url), 'utf8');
  const seen = source.slice(source.indexOf('router.post("/conversacion/leida"'), source.indexOf('router.post("/conversacion/leida"') + 600);
  assert.match(seen, /await conversation\(pool, req.auth.id\)/);
  assert.match(source, /INSERT INTO wilson_conversaciones/);
  for (const path of ['../../frontend/src/features/render-os/WilsonAssistant.jsx', '../../frontend/src/pages/WilsonConversations.jsx']) {
    const consumer = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(consumer, /result\.conversation\./); assert.match(consumer, /result.messages \|\| \[\]/);
  }
});
