import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { extractProductionCreateRequest, productionCreateIntentHash, withProductionCreateReceipt } from '../src/production-create-receipts.js';
import { createProductionRegistryRouter, validateProductionVisit, validateProductionItem } from '../src/production-registry.js';

const key = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const body = { cliente_id: 12, fecha: '2026-10-20', titulo: 'QA private visit', participante_ids: [8, 7] };
const input = () => validateProductionVisit(body);

test('optional envelope preserves legacy input; UUID is exact, noncoercing and lowercased', () => {
  const legacy = extractProductionCreateRequest(body);
  assert.equal(legacy.requestId, null); assert.equal(legacy.body, body);
  const keyed = { ...body, request_id: key.toUpperCase() };
  assert.deepEqual(extractProductionCreateRequest(keyed), { requestId: key, body });
  assert.equal(keyed.request_id, key.toUpperCase(), 'never mutate caller request');
  for (const value of [undefined, null, [], {}, 123, true, '', ' '+key, key+' ', key+'\n', key+'\r', key+'\r\n', key.slice(1)])
    assert.throws(() => extractProductionCreateRequest({ ...body, request_id: value }), { status: 400 });
  for (const value of [undefined, null, [], 'text']) assert.throws(() => extractProductionCreateRequest(value), { status: 400 });
});

test('hash uses validated full defaults and sorted distinct participants, not raw shape/order', () => {
  const a = input(), before = structuredClone(a), hash = productionCreateIntentHash(a);
  assert.match(hash, /^[0-9a-f]{64}$/);
  const b = validateProductionVisit({ titulo: '  QA private visit  ', fecha: body.fecha, cliente_id: 12,
    participante_ids: [7, 8, 7], observaciones: '', drive_url: '', tarea_origen_id: null });
  assert.equal(productionCreateIntentHash(b), hash);
  assert.deepEqual(a, before);
  for (const changes of [{ cliente_id: 13 }, { fecha: '2026-10-21' }, { titulo: 'Other' }, { participante_ids: [7] },
    { observaciones: 'Other notes' }, { drive_url: 'https://example.invalid/material' }, { tarea_origen_id: 99 }])
    assert.notEqual(productionCreateIntentHash(validateProductionVisit({ ...body, ...changes })), hash);
});

// Actual router + authority/receipt helpers; injected SQL protocol only. No
// listening app, DB module, environment credentials, provider or filesystem writes.
function fixture({ failStage = null } = {}) {
  const calls = [], actors = new Map([7, 8].map(id => [id, { id, rol: 'edicion', activo: true, session_version: 2 }]));
  let state = { visits: [], receipts: [] }, saved;
  const failure = new Error(`Synthetic ${failStage || 'storage'} failure`);
  const db = {
    release() { calls.push({ sql: 'RELEASE' }); },
    async query(sql, values = []) {
      calls.push({ sql, values: structuredClone(values) });
      if (sql.startsWith('BEGIN')) { saved = structuredClone(state); return { rows: [] }; }
      if (sql === 'ROLLBACK') { state = saved; return { rows: [] }; }
      if (sql === 'COMMIT') { if (failStage === 'commit') throw failure; return { rows: [] }; }
      if (sql === 'SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1 FOR SHARE')
        return { rows: actors.has(values[0]) ? [actors.get(values[0])] : [] };
      if (sql.startsWith('SELECT pg_advisory_xact_lock(')) return { rows: [] };
      if (sql.includes('FROM production_create_receipts')) return { rows: state.receipts.filter(row => row.actor_user_id === values[0] && row.request_id === values[1]) };
      if (sql === 'SELECT id FROM produccion_visitas WHERE id=$1 FOR SHARE')
        return { rows: state.visits.filter(row => row.id === values[0]).map(row => ({ id: row.id })) };
      if (sql.includes('FROM clientes WHERE')) return { rows: [{ id: values[0], nombre: 'QA client' }] };
      if (sql.startsWith('SELECT id,nombre,rol FROM usuarios WHERE id=ANY')) return { rows: values[0].map(id => ({ id, nombre: 'QA participant', rol: 'edicion' })) };
      if (sql.startsWith('INSERT INTO produccion_visitas(')) {
        if (failStage === 'visit') throw failure;
        state.visits.push({ id: values[0], tarea_origen_id: values[1], cliente_id: values[2], fecha: values[3],
          titulo: values[4], observaciones: values[5], drive_url: values[6], creado_por_id: values[7],
          cliente_nombre: 'QA client', participante_ids: [], revision: 1 });
        return { rows: [] };
      }
      if (sql.startsWith('DELETE FROM produccion_visita_participantes')) {
        state.visits.find(row => row.id === values[0]).participante_ids = []; return { rows: [] };
      }
      if (sql.startsWith('INSERT INTO produccion_visita_participantes')) {
        if (failStage === 'participants') throw failure;
        state.visits.find(row => row.id === values[0]).participante_ids = [...values[1]]; return { rows: [] };
      }
      if (sql.includes('FROM produccion_visitas v JOIN clientes')) {
        if (failStage === 'read') throw failure;
        return { rows: state.visits.filter(row => row.id === values[0]) };
      }
      if (sql.includes('FROM produccion_videos pv LEFT JOIN tareas')) return { rows: [] };
      if (sql.includes('FROM produccion_fotos')) return { rows: [] };
      if (sql.startsWith('INSERT INTO production_create_receipts(')) {
        if (failStage === 'receipt') throw failure;
        state.receipts.push({ actor_user_id: values[0], request_id: values[1], payload_hash: values[2], visit_id: values[3] });
        return { rows: [] };
      }
      throw new Error(`Unexpected receipt unit SQL: ${sql}`);
    },
  };
  const pool = { connect: async () => db };
  const router = createProductionRegistryRouter({ express, pool });
  const route = router.stack.find(layer => layer.route?.path === '/' && layer.route.methods.post).route.stack[0].handle;
  return { calls, actors, failure, get state() { return state; },
    async run(payload = { ...body, request_id: key }, auth = { id: 7, rol: 'admin', activo: true, session_version: 2 }) {
      const req = { body: payload, auth }, res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
      await route(req, res, error => { throw error; }); return res;
    },
  };
}

test('first keyed create commits receipt and visit atomically after current actor then receipt lock', async () => {
  const f = fixture(), result = await f.run();
  assert.equal(result.statusCode, 201); assert.equal(result.body.visita.titulo, body.titulo);
  assert.equal(f.state.visits.length, 1); assert.equal(f.state.receipts.length, 1);
  assert.equal(f.state.receipts[0].visit_id, result.body.visita.id);
  const sql = f.calls.map(call => call.sql);
  const actor = sql.findIndex(value => value.includes('FROM usuarios WHERE id=$1 FOR SHARE'));
  const mutex = sql.findIndex(value => value.startsWith('SELECT pg_advisory_xact_lock('));
  const domain = sql.findIndex(value => value.includes('FROM clientes WHERE'));
  const receipt = sql.findIndex(value => value.startsWith('INSERT INTO production_create_receipts'));
  assert.ok(actor > 0 && mutex > actor && domain > mutex && receipt > domain);
  assert.ok(sql.indexOf('COMMIT') > receipt); assert.equal(sql.at(-1), 'RELEASE');
  assert.deepEqual(Object.keys(f.state.receipts[0]).sort(), ['actor_user_id', 'payload_hash', 'request_id', 'visit_id']);
  assert.ok(!JSON.stringify(f.state.receipts).includes(body.titulo), 'receipt must not retain private payload');
});

test('same normalized intent replays CURRENT full aggregate 200, not stored original DTO, with visit share lock', async () => {
  const f = fixture(); const first = await f.run();
  f.state.visits[0].titulo = 'Current edited title'; f.state.visits[0].revision = 9;
  const before = structuredClone(f.state), start = f.calls.length;
  const replay = await f.run({ ...body, participante_ids: [7, 8, 7], request_id: key.toUpperCase() });
  assert.equal(replay.statusCode, 200); assert.equal(replay.body.visita.id, first.body.visita.id);
  assert.equal(replay.body.visita.revision, 9); assert.equal(replay.body.visita.titulo, 'Current edited title');
  assert.deepEqual(replay.body.visita.videos, []); assert.deepEqual(replay.body.visita.fotos, []);
  assert.deepEqual(f.state, before);
  const calls = f.calls.slice(start), sql = calls.map(call => call.sql);
  assert.equal(sql.some(value => /^(INSERT|UPDATE|DELETE)\b/.test(value)), false);
  assert.equal(sql.some(value => value.includes('FROM clientes WHERE') || value.startsWith('SELECT * FROM tareas')), false);
  const share = sql.indexOf('SELECT id FROM produccion_visitas WHERE id=$1 FOR SHARE');
  assert.ok(share > 0 && share < sql.findIndex(value => value.includes('FROM produccion_visitas v JOIN clientes')));
  assert.ok(share < sql.findIndex(value => value.includes('FROM produccion_videos pv LEFT JOIN tareas')));
  const locks = f.calls.filter(call => call.sql.startsWith('SELECT pg_advisory_xact_lock('));
  assert.deepEqual(locks[0].values, locks[1].values, 'UUID letter case cannot split serialization keys');
});

test('receipt intent mismatch is generic 409 and performs no domain reads or writes', async () => {
  const f = fixture(); await f.run(); const before = structuredClone(f.state), start = f.calls.length;
  const result = await f.run({ ...body, titulo: 'Other private intent', request_id: key });
  assert.equal(result.statusCode, 409); assert.deepEqual(f.state, before);
  assert.ok(!JSON.stringify(result.body).includes('private')); assert.ok(!JSON.stringify(result.body).includes(f.state.receipts[0].payload_hash));
  assert.equal(f.calls.slice(start).some(call => /^(INSERT|UPDATE|DELETE)\b/.test(call.sql) || call.sql.includes('FROM produccion_visitas')), false);
  assert.equal(f.calls.at(-2).sql, 'ROLLBACK');
});

test('actor-scoped keys do not share receipts across identities', async () => {
  const f = fixture(); const a = await f.run();
  const b = await f.run({ ...body, request_id: key }, { id: 8, rol: 'edicion', activo: true, session_version: 2 });
  assert.equal(b.statusCode, 201); assert.notEqual(a.body.visita.id, b.body.visita.id);
  assert.equal(f.state.visits.length, 2); assert.equal(f.state.receipts.length, 2);
  const locks = f.calls.filter(call => call.sql.startsWith('SELECT pg_advisory_xact_lock('));
  assert.notDeepEqual(locks[0].values, locks[1].values);
});

test('receipt lookup and domain work await the transaction mutex; helper never commits on its own', async () => {
  let unlock, reached;
  const gate = new Promise(resolve => { unlock = resolve; });
  const atLock = new Promise(resolve => { reached = resolve; });
  const calls = [];
  const db = { async query(sql, values) {
    calls.push({ sql, values });
    if (sql.startsWith('SELECT pg_advisory_xact_lock(')) { reached(); await gate; }
    return { rows: [] };
  } };
  const pending = withProductionCreateReceipt(db, { actorId: 7, requestId: key.toUpperCase(), input: input() }, {
    create: async () => { calls.push({ sql: 'CREATE CALLBACK' }); return { id: key, revision: 1 }; },
    read: () => assert.fail('No replay exists'),
  });
  await atLock;
  assert.equal(calls.length, 1, 'no lookup/create can run before lock acknowledgement');
  unlock(); await pending;
  assert.ok(calls[1].sql.includes('FROM production_create_receipts'));
  assert.equal(calls[1].values[1], key);
  assert.equal(calls[2].sql, 'CREATE CALLBACK');
  assert.ok(calls[3].sql.startsWith('INSERT INTO production_create_receipts'));
  assert.equal(calls.some(call => /^(BEGIN|COMMIT|ROLLBACK)/.test(call.sql)), false);
});

for (const revoked of ['inactive', 'epoch', 'missing']) test(`${revoked} current actor cannot replay from stale middleware authority`, async () => {
  const f = fixture(); await f.run(); const before = structuredClone(f.state), start = f.calls.length;
  if (revoked === 'inactive') f.actors.get(7).activo = false;
  if (revoked === 'epoch') f.actors.get(7).session_version++;
  if (revoked === 'missing') f.actors.delete(7);
  const result = await f.run(); assert.equal(result.statusCode, 401);
  assert.deepEqual(f.state, before);
  assert.equal(f.calls.slice(start).some(call => /production_create_receipts|advisory/.test(call.sql)), false);
});

for (const stage of ['visit', 'participants', 'read', 'receipt', 'commit']) test(`${stage} failure rolls back visit and receipt with no successful response`, async () => {
  const f = fixture({ failStage: stage });
  await assert.rejects(f.run(), error => error === f.failure);
  assert.deepEqual(f.state, { visits: [], receipts: [] });
  assert.equal(f.calls.at(-2).sql, 'ROLLBACK'); assert.equal(f.calls.at(-1).sql, 'RELEASE');
});

test('unkeyed legacy creates remain 201 and do not depend on receipt SQL', async () => {
  const f = fixture(); const a = await f.run(body), b = await f.run(body);
  assert.equal(a.statusCode, 201); assert.equal(b.statusCode, 201);
  assert.equal(f.state.visits.length, 2); assert.equal(f.state.receipts.length, 0);
  assert.equal(f.calls.some(call => /production_create_receipts|advisory/.test(call.sql)), false);
});

test('bad envelopes fail before DB; request_id remains prohibited by business/PATCH/media validators', async () => {
  for (const request_id of [null, key+'\n', 12, []]) {
    const f = fixture(), result = await f.run({ ...body, request_id });
    assert.equal(result.statusCode, 400); assert.deepEqual(f.calls, []);
  }
  assert.throws(() => validateProductionVisit({ ...body, request_id: key }), { status: 400 });
  assert.throws(() => validateProductionVisit({ expected_revision: 1, titulo: 'PATCH', request_id: key }, { partial: true }), { status: 400 });
  assert.throws(() => validateProductionItem({ expected_revision: 1, titulo: 'Video', request_id: key }, 'videos'), { status: 400 });
});

test('receipt replay cannot recreate an unavailable target and rejects direct malformed helper keys', async () => {
  const f = fixture(); await f.run(); f.state.visits = [];
  const result = await f.run(); assert.equal(result.statusCode, 409); assert.deepEqual(f.state.visits, []);
  for (const requestId of [undefined, key+'\n', null]) {
    let writes = 0;
    const options = { actorId: requestId === null ? 0 : 7, requestId, input: input() };
    await assert.rejects(withProductionCreateReceipt({query:()=>assert.fail('No SQL')}, options,
      {create:()=>{writes++;},read:()=>assert.fail('No read')}));
    assert.equal(writes, 0);
  }
});

test('migration keeps only digest/IDs/time, restrictive FKs and actor-scoped UUID uniqueness', () => {
  const sql = readFileSync(new URL('../migrations/075_production_create_receipts.sql', import.meta.url), 'utf8');
  assert.match(sql, /PRIMARY KEY \(actor_user_id, request_id\)/);
  assert.match(sql, /request_id UUID NOT NULL/);
  assert.match(sql, /visit_id UUID NOT NULL REFERENCES produccion_visitas\(id\) ON DELETE RESTRICT/);
  assert.match(sql, /actor_user_id INTEGER NOT NULL REFERENCES usuarios\(id\) ON DELETE RESTRICT/);
  assert.match(sql, /char_length\(payload_hash\) = 64/);
  assert.match(sql, /committed_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)/);
  assert.match(sql, /CREATE INDEX .* ON production_create_receipts\(visit_id\)/);
  assert.doesNotMatch(sql, /\b(?:JSONB?|payload\s|rol\s|nombre\s|UPDATE|DELETE FROM)\b/i);
});
