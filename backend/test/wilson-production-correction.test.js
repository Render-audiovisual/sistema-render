import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { registerWilsonProductionCorrectionRoutes, correctLegacyProductionRecord, normalizeProductionCorrectionIntent } from '../src/wilson-production-correction.js';
import { correctLegacyProductionRegistration, observeLegacyProductionRegistrationCorrection } from '../src/production-registration-correction.js';

const external = 'qa-correction-human', sha = text => createHash('sha256').update(text).digest('hex');
const subject = { channel: 'whatsapp', actorId: external, groupId: `private:${sha(external).slice(0, 16)}`,
  userId: 7, privateChat: true, actorName: 'Untrusted leader', actorRole: 'admin' };
const path = '/tareas/:id/produccion/registros/:recordId';
const input = { expected_revision: 4, cantidad: 2 };
const actor = { id: 7, rol: 'admin', activo: true, nombre: 'Admin actual' };

// Registered callbacks and shared real mutation; strict memory-only SQL rows.
// The lease queue below serializes the fixture, not physical PostgreSQL locks.
function fixture(options = {}) {
  const routes = new Map(), calls = [], errors = [];
  const state = { task: { id: 50, revision: 4, titulo: 'Visita QA', asignado_a: 'Nombre histórico', cliente_id: 20,
    estado: 'finalizada', tipo_tarea: 'produccion', subtipo: 'visita', updated_at: '2026-10-01T12:00:00Z',
    propiedades_extra: { workspace: 'render_os', produccion_videos_previstos: 7, private_finance: 12345,
      produccion_confirmada_at: 'old', produccion_confirmada_por_id: 7, revision_aprobada: true, finalizada_at: 'old',
      produccion_registros: [{ id: 'a', cantidad: 5, fecha: '2026-10-01' }, { id: 'b', cantidad: 4, fecha: '2026-10-02', cantidad_adelanto: 2 }] } },
    actor: { ...actor, usuario: 'qa', whatsapp_habilitado: true, whatsapp_id_hash: sha(external) },
    mapping: true, assigned: true, linked: false, expired: false, tokens: {}, audits: [] };
  let pending, released = [], queue = Promise.resolve(), connects = 0, writes = 0;
  async function query(raw, p = []) {
    const sql = raw.replace(/\s+/g, ' ').trim(); calls.push({ sql, params: structuredClone(p) });
    if (sql === 'BEGIN ISOLATION LEVEL READ COMMITTED') { pending = structuredClone(state); return { rows: [] }; }
    if (sql === 'ROLLBACK') { pending = undefined; if (options.rollbackFails) throw Error('QA rollback'); return { rows: [] }; }
    if (sql === 'COMMIT') { if (options.commitFails) throw Error('QA commit'); Object.assign(state, pending); pending = undefined; return { rows: [] }; }
    if (sql.startsWith('SELECT pg_advisory_xact_lock')) { if (options.expireAt === 'scope') pending.expired = true; return { rows: [] }; }
    if (sql.startsWith('SELECT id,usuario,nombre,rol,activo,whatsapp_id_hash')) return { rows: [structuredClone(pending.actor)] };
    if (sql.startsWith('SELECT actor_hash,usuario_id,enabled')) return { rows: [] };
    if (sql.startsWith('SELECT u.id FROM usuarios u WHERE u.whatsapp_habilitado')) return { rows: pending.mapping ? [{ id: 7 }] : [] };
    if (sql.startsWith('SELECT t.id,t.revision,t.titulo')) {
      if (options.expireAt === 'task') pending.expired = true;
      return { rows: p[0] === pending.task?.id && pending.task.propiedades_extra.workspace === 'render_os' ? [structuredClone(pending.task)] : [] };
    }
    if (sql.startsWith('SELECT t.id FROM tareas t WHERE t.id=$1')) return { rows: pending.assigned || !sql.includes('tarea_asignaciones') ? [{ id: pending.task.id }] : [] };
    if (sql.startsWith('SELECT v.id FROM produccion_visitas')) { if (options.expireAt === 'mixed') pending.expired = true; return { rows: pending.linked ? [{ id: 'canonical' }] : [] }; }
    if (sql.startsWith('INSERT INTO integracion_confirmaciones')) {
      pending.tokens[p[0]] = { actor: p[1], group: p[2], operation: p[3], task: p[4], payload_hash: p[5], payload: JSON.parse(p[6]), used_at: null };
      return { rows: [{ expires_at: '2026-11-01T12:15:00Z' }] };
    }
    if (sql.startsWith('SELECT payload,payload_hash,used_at')) {
      const token = pending.tokens[p[0]];
      return { rows: token && token.actor === p[1] && token.group === p[2] && token.operation === p[3] && token.task === p[4] ? [structuredClone(token)] : [] };
    }
    if (sql.startsWith('UPDATE integracion_confirmaciones SET used_at')) {
      assert.match(sql, /expires_at>clock_timestamp\(\)/);
      const token = pending.tokens[p[0]];
      if (!token || token.used_at || pending.expired) return { rows: [] };
      token.used_at = '2026-11-01T12:02:00Z'; return { rows: [{ used_at: token.used_at }] };
    }
    if (sql.startsWith('UPDATE tareas SET estado=$3')) {
      assert.equal(pending.task.revision, p[3]); if (options.writeFails) throw Error('QA write');
      writes++; Object.assign(pending.task, { estado: p[2], propiedades_extra: JSON.parse(p[1]), revision: p[3] + 1 });
      return { rows: [structuredClone(pending.task)] };
    }
    if (sql.startsWith('SELECT tarea_id, usuario_id, tipo FROM tarea_asignaciones')) return { rows: [{ tarea_id: 50, usuario_id: 7, tipo: 'responsable' }] };
    if (sql.startsWith('INSERT INTO integracion_auditoria')) { if (options.auditFails) throw Error('QA audit'); pending.audits.push(p); return { rows: [] }; }
    if (sql.startsWith('UPDATE integracion_confirmaciones SET payload=jsonb_set')) {
      if (options.receiptFails) throw Error('QA receipt'); pending.tokens[p[0]].payload.receipt = JSON.parse(p[1]); return { rows: [{ token: p[0] }] };
    }
    throw Error(`Unexpected fixture SQL: ${sql}`);
  }
  const pool = { query, async connect() {
    connects++; if (options.connectFails) throw Error('QA connect');
    const previous = queue; let unlock; queue = new Promise(resolve => { unlock = resolve; }); await previous;
    return { query, release(error) { released.push(error); unlock(); } };
  } };
  registerWilsonProductionCorrectionRoutes({ post(p, fn) { routes.set(`POST ${p}`, fn); }, patch(p, fn) { routes.set(`PATCH ${p}`, fn); } }, { pool });
  async function run(confirm, body = input, mutate = () => {}, record = 'a') {
    const req = { body, headers: { 'x-wilson-signature-version': '2' }, wilson: { ...subject }, params: { id: '50', recordId: record } }; mutate(req);
    const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
    await routes.get(confirm ? `PATCH ${path}` : `POST ${path}/previsualizar`)(req, res, e => { errors.push(e); }); return res;
  }
  const preview = () => run(false);
  const confirm = (token, body = input, mutate, record) => run(true, { ...body, confirmacion_token: token }, mutate, record);
  return { state, calls, errors, options, pool, run, preview, confirm, get released() { return released; }, get connects() { return connects; }, get writes() { return writes; } };
}

test('intent is closed and never coerces quantity, revision or record selector', () => {
  const valid = { task_id: 50, record_id: 'a', ...input };
  assert.deepEqual(normalizeProductionCorrectionIntent(valid), valid);
  for (const change of [{ task_id: '50' }, { expected_revision: 0 }, { cantidad: '2' }, { cantidad: 1.5 }, { cantidad: Number.MAX_SAFE_INTEGER + 1 },
    { record_id: ' a' }, { record_id: '' }, { record_id: 'a\n' }, { estado: 'publicada' }, { notificar_asignacion: false }]) assert.throws(() => normalizeProductionCorrectionIntent({ ...valid, ...change }), { status: 400 });
});

test('preview changes only confirmation table and shows exact amount/state effects', async () => {
  const f = fixture(), before = structuredClone(f.state.task), res = await f.preview();
  assert.deepEqual(f.errors, []); assert.equal(res.statusCode, 201); assert.equal(res.body.summary.previous, 5);
  assert.equal(res.body.summary.amount, 2); assert.equal(res.body.summary.total_after, 6);
  assert.equal(res.body.summary.state_after, 'en_progreso'); assert.deepEqual(f.state.task, before); assert.equal(f.writes, 0);
  assert.ok(!JSON.stringify(res.body).includes('private_finance'));
});

test('shared mutation recalculates subsequent advances, resets workflow and retains ID provenance', async () => {
  const f = fixture(), p = await f.preview(), token = p.body.confirmacion_token, res = await f.confirm(token);
  assert.deepEqual(f.errors, []); assert.equal(res.statusCode, 200); assert.equal(res.body.updated, true);
  assert.equal(res.body.previous, 5); assert.equal(res.body.amount, 2); assert.equal(f.state.task.estado, 'en_progreso');
  const props = f.state.task.propiedades_extra;
  assert.equal(props.produccion_registros[1].cantidad_mes_actual, 4); assert.equal(props.produccion_registros[1].cantidad_adelanto, 0);
  assert.equal(props.produccion_registros[0].corregido_por_id, 7); assert.equal(props.produccion_registros[0].corregido_por, 'Admin actual');
  for (const key of ['produccion_confirmada_at', 'produccion_confirmada_por_id', 'finalizada_at', 'revision_aprobada_at']) assert.equal(props[key], null);
  assert.equal(props.revision_aprobada, false); assert.equal(props.mia_notificacion_pendiente.tipo, 'correccion_grabacion');
  assert.ok(!JSON.stringify(res.body.task).includes('private_finance')); assert.equal(f.state.audits.length, 1);
  const before = structuredClone(f.state), replay = await f.confirm(token);
  assert.equal(replay.body.idempotent, true); assert.equal(replay.body.updated, false); assert.deepEqual(f.state, before); assert.equal(f.writes, 1);
});

test('record ID, task ID, quantity and revision substitution do not consume token', async () => {
  const f = fixture(), p = await f.preview(), token = p.body.confirmacion_token;
  assert.equal((await f.confirm(token, input, undefined, 'b')).statusCode, 409);
  assert.equal((await f.confirm(token, input, req => { req.params.id = '51'; })).statusCode, 409);
  assert.equal((await f.confirm(token, { ...input, cantidad: 3 })).statusCode, 409);
  assert.equal((await f.confirm(token, { ...input, expected_revision: 5 })).statusCode, 409);
  assert.equal(f.state.tokens[token].used_at, null); assert.equal(f.writes, 0);
});

for (const [name, mutate] of [
  ['v1', req => { req.headers['x-wilson-signature-version'] = '1'; }], ['group', req => { req.wilson.privateChat = false; }],
  ['forged private scope', req => { req.wilson.groupId = 'private:forged'; }], ['system actor', req => { req.wilson.systemActor = true; }],
  ['telegram', req => { req.wilson.channel = 'telegram'; }], ['unlinked', req => { req.wilson.userId = null; }],
]) test(`${name} fails before lease`, async () => {
  const f = fixture(), res = await f.run(false, input, mutate); assert.ok([401, 403].includes(res.statusCode)); assert.equal(f.connects, 0);
});

for (const [name, mutate] of [
  ['inactive', s => { s.actor.activo = false; }], ['demoted', s => { s.actor.rol = 'produccion'; }],
  ['disabled WhatsApp', s => { s.actor.whatsapp_habilitado = false; }], ['ambiguous/unmapped', s => { s.mapping = false; }],
  ['revision drift', s => { s.task.revision++; }], ['source drift', s => { s.task.titulo = 'Changed without revision'; }],
  ['trashed', s => { s.task.propiedades_extra.papelera_render_os = true; }], ['archived', s => { s.task.propiedades_extra.archivada_render_os = 'true'; }],
  ['wrong workspace', s => { s.task.propiedades_extra.workspace = 'other'; }], ['canonical registry', s => { s.linked = true; }],
]) test(`confirmation rejects ${name}`, async () => {
  const f = fixture(), p = await f.preview(), token = p.body.confirmacion_token; mutate(f.state);
  const before = structuredClone(f.state), res = await f.confirm(token);
  assert.ok([403, 404, 409].includes(res.statusCode), JSON.stringify({ res, errors: f.errors.map(e => e.message) }));
  assert.deepEqual(f.state, before); assert.equal(f.writes, 0);
});

for (const bad of [null, false, true, '', ' ', '1.5', '0', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) test(`invalid previous count ${JSON.stringify(bad)} refuses reconciliation`, async () => {
  const f = fixture(); f.state.task.propiedades_extra.produccion_registros[0].cantidad = bad;
  assert.equal((await f.preview()).statusCode, 409); assert.equal(Object.keys(f.state.tokens).length, 0);
});

test('ambiguous IDs across numeric/string legacy representations reject, not first-match correction', async () => {
  const f = fixture(); f.state.task.propiedades_extra.produccion_registros = [{ id: 7, cantidad: 2 }, { id: '7', cantidad: 3 }];
  const res = await f.run(false, input, undefined, '7');
  assert.equal(res.statusCode, 409); assert.equal(res.body.code, 'PRODUCTION_RECORD_ID_AMBIGUOUS'); assert.equal(f.writes, 0);
});

test('numeric legacy IDs and positive integer-shaped quantity remain supported', async () => {
  const f = fixture(); f.state.task.propiedades_extra.produccion_registros[0] = { id: 7, cantidad: '5', fecha: '2026-10-01' };
  const p = await f.run(false, input, undefined, '7'); assert.equal(p.statusCode, 201);
  assert.equal((await f.confirm(p.body.confirmacion_token, input, undefined, '7')).body.previous, 5);
});

for (const wait of ['scope', 'task', 'mixed']) test(`TTL after ${wait} lock wait rolls back token and domain`, async () => {
  const options = {}, f = fixture(options), p = await f.preview(), token = p.body.confirmacion_token; options.expireAt = wait;
  assert.equal((await f.confirm(token)).statusCode, 409); assert.equal(f.state.tokens[token].used_at, null); assert.equal(f.writes, 0);
});

test('concurrent same-token confirmations mutate once (memory lease, not physical lock proof)', async () => {
  const f = fixture(), p = await f.preview(), token = p.body.confirmacion_token;
  const results = await Promise.all([f.confirm(token), f.confirm(token)]);
  assert.deepEqual(results.map(r => r.body.idempotent).sort(), [false, true]); assert.equal(f.writes, 1); assert.equal(f.state.audits.length, 1);
});

test('two previews of same observed revision cannot apply two corrections', async () => {
  const f = fixture(), p = await f.preview(), q = await f.preview(); await f.confirm(p.body.confirmacion_token);
  assert.equal((await f.confirm(q.body.confirmacion_token)).statusCode, 409); assert.equal(f.writes, 1);
});

for (const fault of ['writeFails', 'auditFails', 'receiptFails', 'commitFails']) test(`${fault} rolls back task/token/audit/receipt`, async () => {
  const options = {}, f = fixture(options), p = await f.preview(), before = structuredClone(f.state); options[fault] = true;
  await f.confirm(p.body.confirmacion_token); assert.equal(f.errors.length, 1); assert.deepEqual(f.state, before);
});

test('rollback failure discards lease but preserves primary fault', async () => {
  const options = {}, f = fixture(options), p = await f.preview(); options.auditFails = true; options.rollbackFails = true;
  await f.confirm(p.body.confirmacion_token); assert.match(f.errors[0].message, /QA audit/); assert.match(f.released.at(-1).message, /QA rollback/);
});

test('replay is historical, requires current admin and emits no second pending correction', async () => {
  const f = fixture(), p = await f.preview(), token = p.body.confirmacion_token; await f.confirm(token);
  f.state.task.propiedades_extra.produccion_registros[0].cantidad = 99; f.state.task.revision++;
  const before = structuredClone(f.state), r = await f.confirm(token);
  assert.equal(r.body.receipt.amount, 2); assert.match(r.body.text, /histórico/); assert.deepEqual(f.state, before);
  f.state.actor.rol = 'community'; assert.equal((await f.confirm(token)).statusCode, 403);
});

test('shared helper preserves web employee ID-access and transition policy, owns no transaction', async () => {
  const f = fixture(), db = await f.pool.connect(); await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  const result = await correctLegacyProductionRecord(db, { ...actor, rol: 'produccion' }, { task_id: 50, record_id: 'a', ...input });
  assert.equal(result.previous, 5); await db.query('COMMIT'); db.release();
  assert.equal(f.state.task.estado, 'en_progreso'); assert.equal(f.calls.filter(c => c.sql.startsWith('BEGIN')).length, 1);
});

test('shared camelCase contract returns annotated saved row, not DTO/envelope or transaction', async () => {
  const f = fixture(), db = await f.pool.connect(), source = structuredClone(f.state.task);
  await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  const shared = { taskId: 50, recordId: 'a', expectedRevision: 4, amount: 2 };
  const plan = await observeLegacyProductionRegistrationCorrection(db, actor, shared);
  assert.equal(plan.previous, 5); assert.equal(plan.recorded, 6); assert.equal(f.writes, 0);
  let invoked = 0;
  const saved = await correctLegacyProductionRegistration(db, actor, shared, { beforeMutation: async context => {
    invoked++; assert.equal(context.db, db); assert.equal(context.task.revision, 4);
    assert.equal(context.previous, 5); assert.equal(f.writes, 0);
  } });
  assert.equal(invoked, 1); assert.equal(saved.id, 50); assert.equal(saved.revision, 5); assert.equal(saved.asignado_a_id, 7);
  assert.equal(saved.task, undefined); assert.equal(saved.propiedades_extra.private_finance, 12345, 'Caller, not shared mutation, owns DTO policy');
  assert.deepEqual(f.state.task, source, 'Helper did not COMMIT caller transaction');
  await db.query('COMMIT'); db.release();
  assert.equal(f.state.task.estado, 'en_progreso'); assert.equal(f.calls.filter(c => c.sql.startsWith('BEGIN')).length, 1);
});

test('shared beforeMutation can reject after locks with zero domain mutation', async () => {
  const f = fixture(), db = await f.pool.connect(), before = structuredClone(f.state);
  await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  const fault = Error('Claim expired');
  await assert.rejects(correctLegacyProductionRegistration(db, actor, { taskId: 50, recordId: 'a', expectedRevision: 4, amount: 2 },
    { beforeMutation: async () => { throw fault; } }), e => e === fault);
  assert.equal(f.writes, 0); await db.query('ROLLBACK'); db.release(); assert.deepEqual(f.state, before);
});

test('integrated web correction keeps early gates, retained actor, shared mutation and caller-owned COMMIT/DTO', () => {
  const source = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const start = source.indexOf('router.patch("/tareas/:id/produccion/registros/:recordId"');
  assert.ok(start > 0);
  const route = source.slice(start, source.indexOf('\nrouter.delete(', start));
  for (const gate of ['canRecordProduction(req.auth)', 'req.query.workspace !== "render_os"', 'Number.isSafeInteger(req.body.expected_revision)', 'Number.isSafeInteger(amount)']) {
    assert.ok(route.indexOf(gate) >= 0 && route.indexOf(gate) < route.indexOf('pool.connect()'));
  }
  assert.match(route, /BEGIN ISOLATION LEVEL READ COMMITTED/);
  assert.ok(route.indexOf('retainLegacyProductionActor(client, capturedActor)') < route.indexOf('correctLegacyProductionRegistration(client, actor,'));
  assert.match(route, /taskId: Number\(req.params.id\), recordId: req.params.recordId/);
  assert.match(route, /expectedRevision: req.body.expected_revision, amount/);
  assert.ok(route.indexOf('correctLegacyProductionRegistration(client, actor,') < route.indexOf('client.query("COMMIT")'));
  assert.ok(route.indexOf('client.query("COMMIT")') < route.indexOf('taskOperationalDto(saved, req.auth)'));
  assert.doesNotMatch(route, /correctProductionRecord\(/);
  const authority = readFileSync(new URL('../src/task-state-authority.js', import.meta.url), 'utf8');
  assert.match(authority, /return \{ id:row.id, rol:row.rol, activo:true, session_version:row.session_version \}/);
});

test('shared helper rejects withdrawn employee ID membership before mutation', async () => {
  const f = fixture(); f.state.assigned = false;
  const db = await f.pool.connect(); await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  await assert.rejects(correctLegacyProductionRecord(db, { ...actor, rol: 'produccion' }, { task_id: 50, record_id: 'a', ...input }), { status: 404 });
  await db.query('ROLLBACK'); db.release(); assert.equal(f.writes, 0);
});

test('missing record, malformed rows and non-production source refuse without a preview token', async () => {
  for (const mutation of [s => { s.task.tipo_tarea = 'edicion'; }, s => { s.task.propiedades_extra.produccion_registros = null; },
    s => { s.task.propiedades_extra.produccion_registros.push({ cantidad: 3 }); }]) {
    const f = fixture(); mutation(f.state); assert.ok([404, 409].includes((await f.preview()).statusCode)); assert.equal(Object.keys(f.state.tokens).length, 0);
  }
  const f = fixture(); assert.equal((await f.run(false, input, undefined, 'missing')).statusCode, 404);
});

test('pool acquisition failure reaches next without phantom rollback or release', async () => {
  const f = fixture({ connectFails: true }); await f.preview();
  assert.match(f.errors[0].message, /QA connect/); assert.equal(f.released.length, 0); assert.equal(f.calls.length, 0);
});

test('claim follows actor, scope, parent task and mixed-registry checks; audit and receipt precede COMMIT', async () => {
  const f = fixture(), p = await f.preview(), start = f.calls.length; await f.confirm(p.body.confirmacion_token);
  const sql = f.calls.slice(start).map(c => c.sql);
  const at = prefix => sql.findIndex(s => s.startsWith(prefix));
  assert.ok(at('SELECT id,usuario,nombre,rol,activo') < at('SELECT pg_advisory_xact_lock'));
  assert.ok(at('SELECT pg_advisory_xact_lock') < at('SELECT t.id,t.revision,t.titulo'));
  assert.ok(at('SELECT t.id,t.revision,t.titulo') < at('SELECT v.id FROM produccion_visitas'));
  assert.ok(at('SELECT v.id FROM produccion_visitas') < at('UPDATE integracion_confirmaciones SET used_at'));
  assert.ok(at('UPDATE integracion_confirmaciones SET used_at') < at('UPDATE tareas SET estado=$3'));
  assert.ok(at('INSERT INTO integracion_auditoria') < at('UPDATE integracion_confirmaciones SET payload=jsonb_set'));
  assert.ok(at('UPDATE integracion_confirmaciones SET payload=jsonb_set') < at('COMMIT'));
});

test('generic editar token, legacy confirmation bags and unknown body fields cannot authorize correction', async () => {
  const f = fixture(), p = await f.preview(), token = p.body.confirmacion_token; f.state.tokens[token].operation = 'editar';
  assert.equal((await f.confirm(token)).statusCode, 409);
  for (const extra of [{ confirmado: true }, { estado: 'publicada' }, { tarea_origen_id: 50 }, { cantidad: '2' }]) assert.equal((await f.run(false, { ...input, ...extra })).statusCode, 400);
  assert.equal(f.writes, 0);
});

test('module never mutates publication, video registry, assignments or schema nor directly calls a notifier', () => {
  const source = readFileSync(new URL('../src/wilson-production-correction.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /UPDATE publicaciones|UPDATE historias|INSERT INTO publicaciones|UPDATE produccion_|INSERT INTO produccion_|CREATE TABLE|ALTER TABLE|fetch\(|notifyAssignment\s*\(/);
  const shared = readFileSync(new URL('../src/production-registration-correction.js', import.meta.url), 'utf8');
  assert.doesNotMatch(shared, /UPDATE publicaciones|UPDATE historias|INSERT INTO publicaciones|UPDATE produccion_|INSERT INTO produccion_|CREATE TABLE|ALTER TABLE|fetch\(|notifyAssignment\s*\(|import[^\n]*taskOperationalDto|db\.query\(['"](?:BEGIN|COMMIT|ROLLBACK)/);
});
