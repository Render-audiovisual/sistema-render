import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProductionRegistryRouter, validateProductionItem } from '../src/production-registry.js';

// Actual router without sockets. SQL contract assertions are not a PG execution proof.
const photo = extra => ({ id: '11111111-1111-4111-8111-111111111111',
  visita_id: '22222222-2222-4222-8222-222222222222', tipo: 'Producto', estado: 'pendiente',
  drive_url: 'https://example.test/photos', observaciones: 'Volver por luz natural',
  fecha: '2026-10-19', cliente_id: 7, cliente_nombre: 'QA', ...extra });
function fixture({ photos = [], videos = [], error } = {}) {
  const calls = [];
  const pool = { async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes('FROM produccion_fotos pf')) { if (error) throw error; return { rows: photos }; }
    if (sql.includes('FROM produccion_videos pv')) return { rows: videos };
    throw new Error(`Unexpected SQL ${sql}`);
  }, connect() { throw new Error('Read must not lease a mutation transaction'); } };
  const router = createProductionRegistryRouter({ express, pool });
  return { calls, async run(query = {}, auth = { id: 11, rol: 'edicion' }) {
    const req = { query, auth }, res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    let allowed = false;
    router.stack[0].handle(req, res, () => { allowed = true; });
    if (allowed) await router.stack.find(l => l.route?.path === '/pendientes').route.stack[0].handle(req, res, e => { throw e; });
    return res;
  } };
}

test('pending bank always contains additive videos/fotos arrays, including empty banks', async () => {
  const f = fixture(), res = await f.run();
  assert.equal(res.statusCode, 200); assert.deepEqual(res.body, { videos: [], fotos: [] });
  assert.equal(f.calls.length, 2);
  for (const call of f.calls) { assert.match(call.sql, /^SELECT /); assert.deepEqual(call.params, []); }
});

test('photo DTO is exact and scalar, keeps nullable values and never leaks row internals', async () => {
  const first = photo(), second = photo({ id: '33333333-3333-4333-8333-333333333333', estado: 'repetir', drive_url: null, observaciones: '' });
  const f = fixture({ photos: [ { ...first, created_at: 'PRIVATE', creado_por_id: 11, private_finance: 123, metadata: { secret: true } }, second ] });
  const res = await f.run();
  assert.deepEqual(res.body.fotos, [first, second]); assert.deepEqual(res.body.videos, []);
  assert.match(res.body.fotos[0].fecha, /^\d{4}-\d{2}-\d{2}$/);
});

test('actual photo states and SQL use only pendiente/repetir, visit/client joins, and deterministic ordering', async () => {
  for (const estado of ['realizada', 'pendiente', 'repetir']) assert.equal(validateProductionItem({ expected_revision: 1, tipo: 'Producto', estado }, 'fotos').estado, estado);
  assert.throws(() => validateProductionItem({ expected_revision: 1, tipo: 'Producto', estado: 'planificado' }, 'fotos'));
  const f = fixture(); await f.run(); const sql = f.calls[1].sql;
  assert.match(sql, /WHERE pf.estado IN \('pendiente','repetir'\)/);
  assert.doesNotMatch(sql, /realizada|planificado|video_origen_id|NOT EXISTS|LIMIT|OFFSET/);
  assert.match(sql, /JOIN produccion_visitas v ON v.id=pf.visita_id JOIN clientes c ON c.id=v.cliente_id/);
  assert.match(sql, /to_char\(v.fecha,'YYYY-MM-DD'\) fecha/);
  assert.match(sql, /ORDER BY v.fecha,pf.created_at,pf.id$/);
});

test('same optional client filter is bound to both queries without changing existing video lineage rules', async () => {
  const video = { id: 'video', visita_id: 'visit', titulo: 'Existing video', estado: 'pendiente', guion: 'Keep script' };
  const f = fixture({ videos: [video], photos: [photo()] }), res = await f.run({ cliente_id: '7' });
  assert.equal(res.body.videos[0].guion, 'Keep script'); assert.equal(res.body.fotos[0].cliente_id, 7);
  for (const call of f.calls) { assert.deepEqual(call.params, [7]); assert.match(call.sql, /AND v.cliente_id=\$1/); }
  assert.match(f.calls[0].sql, /pv.estado IN \('planificado','pendiente','repetir'\)/);
  assert.match(f.calls[0].sql, /NOT EXISTS\(SELECT 1 FROM produccion_videos child WHERE child.video_origen_id=pv.id\)/);
  assert.match(f.calls[0].sql, /ORDER BY v.fecha,pv.created_at,pv.id$/);
});

for (const cliente_id of ['', '0', '-1', '01', '1.5', '7 OR true', '9007199254740992', ['7'], { id: 7 }, 7, null]) {
  test(`invalid optional client ${JSON.stringify(cliente_id)} rejects before any query`, async () => {
    const f = fixture(), res = await f.run({ cliente_id });
    assert.equal(res.statusCode, 400); assert.deepEqual(f.calls, []);
  });
}

test('read permissions remain shared across active verified roles; absent/inactive identity never queries', async () => {
  for (const rol of ['admin', 'community', 'edicion', 'produccion', 'custom']) {
    assert.equal((await fixture().run({}, { id: 11, rol })).statusCode, 200);
  }
  for (const auth of [null, { id: 0 }, { id: 11, activo: false }]) {
    const f = fixture(); assert.equal((await f.run({}, auth)).statusCode, 403); assert.deepEqual(f.calls, []);
  }
});

test('photo query failure propagates rather than publishing a misleading partial bank', async () => {
  const error = new Error('Photo read failed'), f = fixture({ error });
  await assert.rejects(f.run(), e => e === error);
});
