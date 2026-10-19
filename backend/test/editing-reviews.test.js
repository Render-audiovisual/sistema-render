import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditingReviewsRouter, recordEditingApproval, editingReviewDomainConflict,
  normalizeEditingCorrectionInput, editingCorrectionPayloadHash, editingReviewDto } from '../src/editing-reviews.js';

const REQUEST = '10000000-0000-4000-8000-000000000001';
const DELIVERY = '20000000-0000-4000-8000-000000000002';
const OTHER = '30000000-0000-4000-8000-000000000003';
const TIME = '2026-01-01T12:00:00.000Z';
const ADMIN = { id: 4, rol: 'admin', activo: true, session_version: 2 };
const body = (extra = {}) => ({ request_id: REQUEST, expected_revision: 5, expected_entrega_id: DELIVERY, notes: 'Corregir audio', ...extra });
const task = (extra = {}) => ({ id: 8, revision: 5, estado: 'en_revision', tipo_tarea: 'edicion', cliente_id: 7,
  material_referencia: 'https://example.com/raw', fecha_vencimiento: '2026-02-01', asignado_a: 'Editor',
  propiedades_extra: { workspace: 'render_os', guiones: 'Guion original', copy_trabajo: 'Copy original', edicion_responsable_id: 3,
    revision_aprobada: true, revision_aprobada_por: 'Admin', revision_aprobada_por_id: 4, revision_aprobada_at: TIME,
    revision_aprobada_entrega_id: DELIVERY, finalizada_at: TIME }, ...extra });
const delivery = (extra = {}) => ({ id: DELIVERY, task_id: 8, actor_id: 3, task_revision: 5, url: 'https://example.com/v1', notes: '', recorded_at: TIME, ...extra });

test('closed correction input requires normalized explicit version/revision and nonempty bounded notes', () => {
  assert.deepEqual(normalizeEditingCorrectionInput(body({ request_id: REQUEST.toUpperCase(), expected_entrega_id: DELIVERY.toUpperCase(), notes: ' Nota ' })), { ...body(), notes: 'Nota' });
  for (const extra of [{ actor_id: 4 }, { metadata: {} }, { estado: 'aprobada' }, { importe: 1 }, { expected_entrega_id: null }, { request_id: {} }, { expected_revision: '5' }, { expected_revision: 0 }, { notes: '' }, { notes: ' ' }, { notes: 'x'.repeat(4001) }, { notes: 'x\0y' }]) {
    assert.throws(() => normalizeEditingCorrectionInput(body(extra)), { status: 400 });
  }
});

test('correction hash binds task, exact delivery, revision and notes, not request key or identity', () => {
  const input = normalizeEditingCorrectionInput(body()), hash = editingCorrectionPayloadHash(8, input);
  assert.equal(hash, editingCorrectionPayloadHash(8, { ...input, request_id: OTHER }));
  assert.notEqual(hash, editingCorrectionPayloadHash(9, input));
  for (const extra of [{ expected_revision: 6 }, { expected_entrega_id: OTHER }, { notes: 'Otra corrección' }]) assert.notEqual(hash, editingCorrectionPayloadHash(8, { ...input, ...extra }));
});

test('decision DTO is closed even for admin and constraint mapper recognizes only reviews domain', () => {
  const dto = editingReviewDto({ id: REQUEST, task_id: 8, delivery_id: DELIVERY, actor_id: 4, action: 'aprobada', task_revision: 6, notes: '', recorded_at: new Date(TIME), salario: 'SECRET', payload_hash: 'SECRET', metadata: { token: 'SECRET' } });
  assert.deepEqual(Object.keys(dto), ['id', 'task_id', 'delivery_id', 'actor_id', 'action', 'task_revision', 'notes', 'recorded_at']);
  assert.doesNotMatch(JSON.stringify(dto), /SECRET|metadata|payload_hash/);
  for (const code of ['23503', '23505', '23514']) assert.equal(editingReviewDomainConflict({ code, constraint: 'task_editing_reviews_immutable' }), true);
  for (const error of [{ code: 'P0001', constraint: 'task_editing_reviews_test' }, { code: '23514', constraint: 'unrelated' }, { code: '23503' }]) assert.equal(editingReviewDomainConflict(error), false);
});

function harness({ user = { ...ADMIN }, currentTask = task(), deliveries = [delivery()], reviews = [], total, linked = false, fault, postTrigger } = {}) {
  const calls = [], routes = new Map();
  let released = false, snapshot;
  let state = { task: structuredClone(currentTask), deliveries: structuredClone(deliveries), reviews: structuredClone(reviews) };
  const db = { release() { released = true; }, async query(sql, params = []) {
    calls.push({ sql, params });
    const error = fault?.(sql);
    if (error) throw error instanceof Error ? error : Object.assign(new Error('private SQL error'), { code: 'P0001' });
    if (sql.startsWith('BEGIN')) { snapshot = structuredClone(state); return { rows: [] }; }
    if (sql === 'ROLLBACK') { state = snapshot; return { rows: [] }; }
    if (sql.startsWith('SELECT id,rol,activo,session_version FROM usuarios')) return { rows: user ? [user] : [] };
    if (sql.startsWith('SELECT id,publicacion_id FROM tareas')) return { rows: [{ id: 8, publicacion_id: linked ? 31 : null }] };
    if (sql.startsWith('SELECT s.id,s.tarea_id')) return { rows: linked ? [{ id: 51, tarea_id: 8, publicacion_id: 31, clave: 'cliente:7', periodo: '2026-01' }] : [] };
    if (sql.startsWith('SELECT v.id,v.tarea_origen_id')) return { rows: linked ? [{ id: REQUEST, tarea_origen_id: 7 }] : [] };
    if (sql.startsWith('SELECT id,visita_id FROM produccion_videos')) return { rows: [{ id: OTHER, visita_id: REQUEST }] };
    if (sql.startsWith('SELECT t.id,t.revision,t.estado')) return { rows: state.task ? [structuredClone(state.task)] : [] };
    if (sql.startsWith('SELECT id,payload_hash FROM task_editing_reviews')) return { rows: state.reviews.filter(r => r.actor_id === params[0] && r.request_id === params[1]) };
    if (sql.startsWith('SELECT id,task_id,actor_id,task_revision')) return { rows: [...state.deliveries].sort((a, b) => b.task_revision - a.task_revision).slice(0, 1) };
    if (sql.startsWith('SELECT count(*)')) return { rows: [{ total: total ?? state.reviews.length }] };
    if (sql.startsWith('SELECT id,task_id,delivery_id')) return { rows: [...state.reviews].sort((a, b) => a.task_revision - b.task_revision).slice(-200) };
    if (sql.startsWith('UPDATE tareas SET')) {
      if (state.task.revision !== params[1]) return { rows: [] };
      state.task.estado = 'en_progreso'; state.task.revision += 1;
      Object.assign(state.task.propiedades_extra, { revision_aprobada: false, revision_aprobada_por: null, revision_aprobada_por_id: null, revision_aprobada_at: null, revision_aprobada_entrega_id: null, finalizada_at: null });
      if (postTrigger) postTrigger(state.task);
      return { rows: [structuredClone(state.task)] };
    }
    if (sql.startsWith('WITH actual AS')) {
      const [task_id, actor_id, task_revision, delivery_id, id, notes, request_id, payload_hash] = params;
      const action = sql.includes("t.estado='aprobada'") ? 'aprobada' : 'correcciones';
      const old = state.reviews.find(r => r.task_id === task_id && r.task_revision === task_revision);
      if (old) return { rows: old.action === action && old.delivery_id === delivery_id && old.actor_id === actor_id ? [{ id: old.id }] : [] };
      state.reviews.push({ id, task_id, actor_id, task_revision, delivery_id, action, notes, request_id, payload_hash, recorded_at: TIME });
      return { rows: [{ id }] };
    }
    return { rows: [] };
  } };
  const router = { use(fn) { routes.set('middleware', fn); }, get(path, fn) { routes.set(`GET ${path}`, fn); }, post(path, fn) { routes.set(`POST ${path}`, fn); } };
  createEditingReviewsRouter({ express: { Router: () => router }, pool: { connect: async () => db } });
  return { calls, routes, db, state: () => state, released: () => released, async run(write = true, input = body(), extra = {}) {
    let status, payload, error;
    const res = { status(value) { status = value; return this; }, json(value) { payload = value; } };
    await routes.get(write ? 'POST /:id/correcciones' : 'GET /:id/revisiones')({ params: { id: '8' }, query: {}, body: input, auth: { ...user }, ...extra }, res, e => { error = e; });
    return { status, payload, error };
  } };
}

test('correction changes only work state and current approval flags, records exact artifact/actor/revision', async () => {
  const h = harness(), before = structuredClone(h.state().task);
  const result = await h.run();
  assert.equal(result.status, 201);
  assert.equal(result.payload.replayed, false);
  assert.equal(result.payload.task.estado, 'en_progreso');
  assert.equal(result.payload.task.revision, 6);
  assert.equal(result.payload.decisions[0].delivery_id, DELIVERY);
  assert.equal(result.payload.decisions[0].actor_id, 4);
  assert.equal(result.payload.decisions[0].action, 'correcciones');
  for (const key of ['asignado_a', 'material_referencia', 'fecha_vencimiento', 'cliente_id']) assert.equal(h.state().task[key], before[key]);
  for (const key of ['guiones', 'copy_trabajo', 'edicion_responsable_id']) assert.equal(h.state().task.propiedades_extra[key], before.propiedades_extra[key]);
  assert.equal(h.state().task.propiedades_extra.revision_aprobada, false);
  for (const key of ['revision_aprobada_por', 'revision_aprobada_por_id', 'revision_aprobada_at', 'revision_aprobada_entrega_id', 'finalizada_at']) assert.equal(h.state().task.propiedades_extra[key], null);
});

test('replay authorizes current scope first but ignores new latest delivery/state/CAS and returns original decision', async () => {
  const h = harness();
  const first = await h.run();
  h.state().task.estado = 'finalizada'; h.state().task.revision = 9;
  h.state().deliveries.push(delivery({ id: OTHER, task_revision: 7 }));
  const checkpoint = h.calls.length;
  const result = await h.run();
  assert.equal(result.status, 200);
  assert.equal(result.payload.decision_id, first.payload.decision_id);
  assert.equal(result.payload.replayed, true);
  assert.equal(result.payload.latest_delivery.id, OTHER);
  assert.equal(result.payload.task.revision, 9);
  assert.equal(h.state().reviews.length, 1);
  const replayQueries = h.calls.slice(checkpoint);
  assert.ok(replayQueries.findIndex(c => c.sql.startsWith('SELECT t.id,t.revision')) < replayQueries.findIndex(c => c.sql.startsWith('SELECT id,payload_hash')));
  assert.ok(replayQueries.findIndex(c => c.sql.startsWith('SELECT id,payload_hash')) < replayQueries.findIndex(c => c.sql.startsWith('SELECT id,task_id,actor_id')));
  assert.equal(replayQueries.some(c => c.sql.startsWith('UPDATE tareas')), false);
  assert.equal((await h.run(true, body({ notes: 'Diferente' }))).status, 409);
  assert.equal((await h.run(true, body(), { params: { id: '9' } })).status, 409);
  h.state().task.propiedades_extra.archivada_render_os = true;
  assert.equal((await h.run()).status, 404);
});

test('only current active admin writes; all supported roles read, unknown403 and session changes401', async () => {
  for (const rol of ['admin', 'diseno', 'edicion', 'produccion', 'community', 'programacion']) {
    const h = harness({ user: { ...ADMIN, rol, nombre: 'Admin' } });
    const read = await h.run(false);
    assert.equal(read.status, 200);
    assert.equal(read.payload.can_request_corrections, rol === 'admin');
    assert.equal((await h.run()).status, rol === 'admin' ? 201 : 403);
  }
  for (const user of [null, { ...ADMIN, activo: false }, { ...ADMIN, session_version: 3 }, { ...ADMIN, rol: 'edicion' }]) {
    assert.equal((await harness({ user }).run(true, body(), { auth: ADMIN })).status, 401);
  }
  const unknown = harness({ user: { ...ADMIN, rol: 'unknown' } });
  assert.equal((await unknown.run(false)).status, 403);
});

test('scope and fresh CAS/latest/state gate rejects without review or task mutation', async () => {
  for (const currentTask of [task({ estado: 'aprobada' }), task({ estado: 'finalizada' }), task({ revision: 6 }),
    task({ tipo_tarea: 'diseno' }), task({ propiedades_extra: { workspace: 'private' } }),
    task({ propiedades_extra: { workspace: 'render_os', papelera_render_os: true } })]) {
    const h = harness({ currentTask });
    assert.ok([404, 409].includes((await h.run()).status));
    assert.equal(h.state().reviews.length, 0);
    assert.equal(h.calls.some(c => c.sql.startsWith('UPDATE tareas')), false);
  }
  for (const deliveries of [[], [delivery({ id: OTHER })], [delivery({ task_id: 9 })], [delivery({ task_revision: 6 })]]) {
    const h = harness({ deliveries });
    assert.equal((await h.run()).status, 409);
    assert.equal(h.state().reviews.length, 0);
  }
});

test('effective post-trigger wrong state/revision/binding rolls back without repair', async () => {
  for (const postTrigger of [t => { t.estado = 'aprobada'; }, t => { t.revision += 1; }, t => { t.propiedades_extra.revision_aprobada_entrega_id = DELIVERY; }]) {
    const h = harness({ postTrigger });
    const before = structuredClone(h.state());
    assert.equal((await h.run()).status, 409);
    assert.deepEqual(h.state(), before);
    assert.equal(h.calls.filter(c => c.sql.startsWith('UPDATE tareas')).length, 1);
    assert.equal(h.calls.some(c => c.sql.startsWith('WITH actual AS')), false);
  }
});

test('GET returns latest artifact by revision and newest200 decisions chronologically with explicit total', async () => {
  const reviews = Array.from({ length: 205 }, (_, n) => ({ id: REQUEST, task_id: 8, delivery_id: DELIVERY, actor_id: 4, action: 'aprobada', task_revision: n + 1, notes: '', recorded_at: TIME, metadata: { salary: 'SECRET' } }));
  const h = harness({ reviews });
  const result = await h.run(false);
  assert.equal(result.payload.total, 205);
  assert.equal(result.payload.truncated, true);
  assert.equal(result.payload.decisions.length, 200);
  assert.equal(result.payload.decisions[0].task_revision, 6);
  assert.equal(result.payload.decisions.at(-1).task_revision, 205);
  assert.doesNotMatch(JSON.stringify(result.payload), /SECRET|material_referencia|propiedades_extra|request_id|payload_hash/);
  const sql = h.calls.map(c => c.sql).join('\n');
  assert.match(sql, /ORDER BY task_revision DESC,recorded_at DESC,id DESC LIMIT 1/);
  assert.match(sql, /ORDER BY task_revision DESC,id DESC LIMIT 200/);
  assert.equal(h.calls[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.doesNotMatch(sql, /FOR UPDATE|FOR SHARE|pg_advisory/);
});

test('approval helper does not query for legacy, inserts/repeats once for exact locked revision, never locks', async () => {
  const h = harness(), approved = task({ estado: 'aprobada', revision: 6 });
  assert.equal(await recordEditingApproval(h.db, approved, ADMIN, null), null);
  assert.equal(h.calls.length, 0);
  const first = await recordEditingApproval(h.db, approved, ADMIN, DELIVERY);
  assert.equal(await recordEditingApproval(h.db, approved, ADMIN, DELIVERY), first);
  assert.equal(h.state().reviews.length, 1);
  assert.equal(h.state().reviews[0].action, 'aprobada');
  assert.equal(h.state().reviews[0].request_id, null);
  assert.equal(h.state().reviews[0].payload_hash, null);
  const sql = h.calls[0].sql;
  assert.doesNotMatch(sql, /FOR UPDATE|FOR SHARE|pg_advisory|UPDATE tareas|BEGIN|COMMIT/);
  assert.match(sql, /JOIN task_editing_deliveries d ON d.task_id=t.id AND d.id=\$4::uuid/);
  assert.match(sql, /revision_aprobada_entrega_id'\)=?|'revision_aprobada_entrega_id'=\$4::text/);
  assert.match(sql, /u.session_version=\$9/);
  assert.match(sql, /ON CONFLICT \(task_id,task_revision\) DO NOTHING/);
});

test('approval helper fails closed for invalid actor/post-trigger metadata and failed SQL proof', async () => {
  for (const changed of [task(), task({ estado: 'aprobada', propiedades_extra: { workspace: 'render_os', revision_aprobada: false, revision_aprobada_entrega_id: DELIVERY } }), task({ estado: 'aprobada', tipo_tarea: 'diseno' })]) {
    await assert.rejects(recordEditingApproval(harness().db, changed, ADMIN, DELIVERY), { status: 409 });
  }
  await assert.rejects(recordEditingApproval(harness().db, task({ estado: 'aprobada' }), { ...ADMIN, rol: 'edicion' }, DELIVERY), { status: 403 });
  const calls = [];
  await assert.rejects(recordEditingApproval({ query: async (...args) => { calls.push(args); return { rows: [] }; } }, task({ estado: 'aprobada', revision: 6 }), ADMIN, DELIVERY), { status: 409 });
  assert.equal(calls.length, 1);
});

test('resource helper preserves period/tasks/publication/slot/visit/video lock order before update', async () => {
  const h = harness({ linked: true });
  assert.equal((await h.run()).status, 201);
  const sql = h.calls.map(c => c.sql);
  const indexes = [
    sql.findIndex(s => s.includes('FROM usuarios')),
    sql.findIndex(s => s.includes("hashtext('editing-review-request')")),
    sql.findIndex(s => s.includes("hashtext('vinculo-objetivo-mensual')")),
    h.calls.findIndex(c => c.params[0] === 'objetivo:2026-01:cliente:7'),
    sql.findIndex(s => s.startsWith('SELECT id FROM tareas WHERE id=ANY')),
    sql.findIndex(s => s.startsWith('SELECT id FROM publicaciones WHERE')),
    sql.findIndex(s => s.startsWith('SELECT id FROM cliente_objetivo_piezas WHERE')),
    sql.findIndex(s => s.startsWith('SELECT id FROM produccion_visitas WHERE')),
    sql.findIndex(s => s.startsWith('SELECT id FROM produccion_videos WHERE')),
    sql.findIndex(s => s.startsWith('UPDATE tareas')),
  ];
  assert.ok(indexes.every((n, i) => n >= 0 && (!i || n > indexes[i - 1])));
  assert.match(sql[indexes[0]], /FOR SHARE$/);
  assert.deepEqual(h.calls[indexes[4]].params[0], [7, 8]);
});

test('insert fault rolls back task/proof/revision and preserves same-key retry', async () => {
  let broken = true;
  const h = harness({ fault: sql => broken && sql.startsWith('WITH actual AS') });
  const before = structuredClone(h.state()), failed = await h.run();
  assert.equal(failed.error?.code, 'P0001');
  assert.equal(failed.status, undefined);
  assert.deepEqual(h.state(), before);
  assert.equal(h.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(h.released(), true);
  broken = false;
  assert.equal((await h.run()).status, 201);
});

test('named review conflicts409 and arbitrary SQL errors remain global500; no-store/query guards', async () => {
  for (const [code, constraint, expected] of [['23514', 'task_editing_reviews_delivery_fk', 409], ['23514', 'unrelated', undefined], ['P0001', 'task_editing_reviews_injected', undefined]]) {
    const h = harness({ fault: sql => sql.startsWith('WITH actual AS') && Object.assign(new Error('private detail'), { code, constraint }) });
    assert.equal((await h.run()).status, expected);
  }
  const h = harness(); let header;
  h.routes.get('middleware')({}, { set: (...args) => { header = args; } }, () => {});
  assert.deepEqual(header, ['Cache-Control', 'no-store']);
  assert.equal((await h.run(false, undefined, { query: { actor_id: '4' } })).status, 400);
});
