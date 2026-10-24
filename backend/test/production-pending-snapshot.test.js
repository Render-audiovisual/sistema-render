import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProductionRegistryRouter } from '../src/production-registry.js';

// Actual captured Express route and snapshot helper, no sockets or PG claims.
function fixture({ failPhotos = false, actorPatch = {} } = {}) {
  const calls = [], responses = [], forwarded = [];
  let leases = 0;
  const sentinel = new Error('Synthetic second read failure');
  const photo = { id: 'photo', visita_id: 'visit', tipo: 'Retrato', estado: 'pendiente', drive_url: null,
    observaciones: '', fecha: '2026-10-20', cliente_id: 7, cliente_nombre: 'QA' };
  const video = { id: 'video', visita_id: 'visit', titulo: 'Guion', guion: 'Conservar', estado: 'repetir',
    cliente_id: 7, fecha: '2026-10-20', cliente_nombre: 'QA' };
  const privateFields = { private_finance: 'PRIVATE_PENDING_SNAPSHOT', password_hash: 'PRIVATE_PENDING_SNAPSHOT',
    metadata: { marker: 'PRIVATE_PENDING_SNAPSHOT' } };
  const db = { async query(sql, values) {
    calls.push({ sql, values });
    if (['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    if (sql === 'SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1') {
      assert.deepEqual(values, [11]);
      return { rows: [{ id: 11, rol: 'edicion', activo: true, session_version: 3, ...actorPatch }] };
    }
    if (sql.includes('FROM produccion_videos pv')) return { rows: [{ ...video, ...privateFields }] };
    if (sql.includes('FROM produccion_fotos pf')) {
      if (failPhotos) throw sentinel;
      return { rows: [{ ...photo, ...privateFields }] };
    }
    assert.fail(`Unexpected query: ${sql}`);
  }, release(error) { calls.push({ sql: 'RELEASE', error }); } };
  const pool = { query() { assert.fail('Pool query escapes the one leased snapshot'); }, async connect() { leases++; return db; } };
  const router = createProductionRegistryRouter({ express, pool });
  const route = router.stack.find(layer => layer.route?.path === '/pendientes').route.stack[0].handle;
  return { calls, responses, forwarded, photo, sentinel, get leases() { return leases; },
    async run(query = {}) {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { responses.push(body); return this; } };
      await route({ query, auth: { id: 11, rol: 'edicion', session_version: 3 } }, res, error => forwarded.push(error));
      return res;
    } };
}

test('both pending queries use one leased RR read-only snapshot and commit before returning the closed DTO', async () => {
  const f = fixture(); const res = await f.run({ cliente_id: '7' });
  assert.equal(res.statusCode, 200); assert.equal(f.leases, 1); assert.deepEqual(f.forwarded, []);
  assert.equal(f.calls[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(f.calls[1].sql, 'SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1');
  const reads = f.calls.filter(call => /FROM produccion_(videos pv|fotos pf)/.test(call.sql));
  assert.equal(reads.length, 2);
  for (const read of reads) { assert.deepEqual(read.values, [7]); assert.match(read.sql, /AND v.cliente_id=\$1/); }
  assert.deepEqual(f.calls.slice(-2).map(call => call.sql), ['COMMIT', 'RELEASE']);
  assert.deepEqual(Object.keys(f.responses[0]).sort(), ['fotos', 'videos']);
  assert.deepEqual(f.responses[0].fotos, [f.photo]);
  assert.equal(f.responses[0].videos[0].guion, 'Conservar');
  assert.equal(JSON.stringify(f.responses).includes('PRIVATE_PENDING_SNAPSHOT'), false);
  assert.equal(Object.hasOwn(f.responses[0], 'actor'), false);
});

test('malformed client filters reject before leasing or querying', async () => {
  for (const cliente_id of ['', '0', '-1', '01', '1.5', '7 OR true', ['7'], { id: 7 }, 7, null]) {
    const f = fixture(), res = await f.run({ cliente_id });
    assert.equal(res.statusCode, 400); assert.equal(f.leases, 0); assert.deepEqual(f.calls, []); assert.deepEqual(f.forwarded, []);
  }
});

test('second read failure rolls back and forwards the original error without partial JSON', async () => {
  const f = fixture({ failPhotos: true }); await f.run();
  assert.equal(f.leases, 1); assert.deepEqual(f.responses, []); assert.deepEqual(f.forwarded, [f.sentinel]);
  assert.equal(f.calls.some(call => call.sql === 'COMMIT'), false);
  assert.deepEqual(f.calls.slice(-2).map(call => call.sql), ['ROLLBACK', 'RELEASE']);
});

test('snapshot actor rejection denies domain queries and returns no pending data', async () => {
  for (const actorPatch of [{ activo: false }, { session_version: 4 }]) {
    const f = fixture({ actorPatch }), res = await f.run();
    assert.equal(res.statusCode, 401); assert.equal(f.leases, 1); assert.deepEqual(f.forwarded, []);
    assert.equal(f.calls.some(call => call.sql.includes('FROM produccion_videos') || call.sql.includes('FROM produccion_fotos')), false);
    assert.equal(Object.hasOwn(f.responses[0], 'videos'), false);
    assert.deepEqual(f.calls.slice(-2).map(call => call.sql), ['ROLLBACK', 'RELEASE']);
  }
});
