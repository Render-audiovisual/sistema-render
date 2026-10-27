import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEditingDeliveriesRouter, editingDeliveryTaskId, normalizeEditingDeliveryInput,
  editingDeliveryPayloadHash, editingDeliveryDto } from '../src/editing-deliveries.js';
import { EDITING_PROGRESS_SCHEMA } from '../src/editing-progress-ledger.js';

const KEY = '10000000-0000-4000-8000-000000000001';
const SECOND = '20000000-0000-4000-8000-000000000002';
const VISIT = '30000000-0000-4000-8000-000000000003';
const VIDEO = '40000000-0000-4000-8000-000000000004';
const TIME = '2026-01-01T12:00:00.000Z';
const ACTOR = { id: 4, rol: 'edicion', activo: true, session_version: 3 };
const body = (extra = {}) => ({ request_id: KEY, expected_revision: 2, url: 'https://example.com/final.mp4', notes: 'Primera entrega', ...extra });

test('task route identity is strict positive int32', () => {
  assert.equal(editingDeliveryTaskId('2147483647'), 2147483647);
  for (const id of ['0', '-1', '01', '1.0', '1e1', '2147483648', {}, 1, null, '']) {
    assert.throws(() => editingDeliveryTaskId(id), { status: 400 });
  }
});

test('closed delivery input rejects provenance, identity, financial bags and malformed CAS', () => {
  for (const extra of [{ task_id: 8 }, { actor_id: 4 }, { task_revision: 2 }, { estado: 'aprobada' }, { metadata: {} }, { importe: 10 }]) {
    assert.throws(() => normalizeEditingDeliveryInput(body(extra)), { status: 400 });
  }
  for (const expected_revision of [0, -1, '2', 1.1, null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => normalizeEditingDeliveryInput(body({ expected_revision })), { status: 400 });
  }
  for (const request_id of [{}, '', 'invalid', `${KEY}\0`]) assert.throws(() => normalizeEditingDeliveryInput(body({ request_id })), { status: 400 });
  const omitted = body(); delete omitted.notes;
  assert.throws(() => normalizeEditingDeliveryInput(omitted), { status: 400 });
});

test('strict HTTP(S) URLs have no credentials/controls; normalized notes are bounded text', () => {
  for (const url of ['javascript:alert(1)', 'file:///tmp/a', 'https:example.com', 'https://user:pass@example.com/', 'https://example.com/ a', 'https://example.com/\nfile', 'https://example.com/\0file', 'https://example.com\\file', 'https://' + 'x'.repeat(2000), {}]) {
    assert.throws(() => normalizeEditingDeliveryInput(body({ url })), { status: 400 });
  }
  for (const notes of [null, {}, 'x\0y', 'x'.repeat(4001), ' '.repeat(4001)]) {
    assert.throws(() => normalizeEditingDeliveryInput(body({ notes })), { status: 400 });
  }
  assert.equal(normalizeEditingDeliveryInput(body({ notes: '' })).notes, '');
  const normalized = normalizeEditingDeliveryInput(body({ request_id: KEY.toUpperCase(), url: ' HTTPS://EXAMPLE.COM:443/final.mp4 ', notes: ' Nota\nsegunda línea ' }));
  assert.equal(normalized.url, 'https://example.com/final.mp4');
  assert.equal(normalized.notes, 'Nota\nsegunda línea');
  assert.equal(normalized.request_id, KEY);
});

test('intent hash excludes request key but includes task, expected revision, normalized URL and notes', () => {
  const normalized = normalizeEditingDeliveryInput(body());
  const hash = editingDeliveryPayloadHash(8, normalized);
  assert.equal(hash, editingDeliveryPayloadHash(8, { ...normalized, request_id: SECOND }));
  assert.notEqual(hash, editingDeliveryPayloadHash(9, normalized));
  for (const extra of [{ expected_revision: 3 }, { url: 'https://example.com/other' }, { notes: 'Otra entrega' }]) assert.notEqual(hash, editingDeliveryPayloadHash(8, { ...normalized, ...extra }));
  assert.match(hash, /^[a-f0-9]{64}$/);
});

test('event DTO closes all roles to safe immutable fields, never finance/raw metadata', () => {
  const dto = editingDeliveryDto({ id: KEY, task_id: 8, actor_id: 4, task_revision: 3, url: 'https://example.com/final.mp4', notes: '', recorded_at: new Date(TIME), payload_hash: 'SECRET', request_id: SECOND, salario: 'PRIVATE', metadata: { token: 'PRIVATE' } });
  assert.deepEqual(Object.keys(dto), ['id', 'task_id', 'actor_id', 'task_revision', 'url', 'notes', 'recorded_at']);
  assert.equal(dto.recorded_at, TIME);
  assert.doesNotMatch(JSON.stringify(dto), /PRIVATE|SECRET|metadata|request_id|payload_hash/);
});

function harness({ user = { ...ACTOR }, task = {}, assigned = true, linked = false, fault = null } = {}) {
  const calls = [], routes = new Map();
  let released = false, snapshot;
  let state = { task: { id: 8, revision: 2, estado: 'en_progreso', tipo_tarea: 'edicion', workspace: 'render_os', archived: 'false', trashed: 'false', assigned,
    material_referencia: 'https://example.com/raw', fecha_vencimiento: '2026-02-01', aclaraciones: 'No cambiar',
    propiedades_extra: { workspace: 'render_os', guiones: 'Guion', revision_aprobada: true, revision_aprobada_por: 'Líder', revision_aprobada_por_id: 1, revision_aprobada_at: TIME, finalizada_at: TIME, edicion_responsable_id: 4 }, ...task }, events: [], progress: [] };
  const db = { release() { released = true; }, async query(sql, params = []) {
    calls.push({ sql, params });
    const error = fault?.(sql);
    if (error) throw error instanceof Error ? error : Object.assign(new Error('Unexpected SQL failure'), { code: 'P0001' });
    if (sql.startsWith('BEGIN')) { snapshot = structuredClone(state); return { rows: [] }; }
    if (sql === 'ROLLBACK') { state = snapshot; return { rows: [] }; }
    if (sql.includes('AS columns') && sql.includes('FROM pg_constraint')) return { rows: [{
      columns: Object.entries(EDITING_PROGRESS_SCHEMA.columns).map(([name,[type,notNull]]) => ({name,type,notNull})),
      constraints: Object.entries(EDITING_PROGRESS_SCHEMA.constraints).map(([name,definition]) => ({name,definition,validated:true,deferred:false})),
    }] };
    if (sql.startsWith('SELECT id,revision,estado,tipo_tarea,titulo,cliente_id,propiedades_extra')) return {rows:[structuredClone(state.task)]};
    if (sql.startsWith('SELECT id,task_id,task_revision,recorded_at')) return {rows:state.events.slice(-1)};
    if (sql.startsWith('SELECT tarea_id,editor_user_id,origen_registro,delivery_id,task_revision')) return {rows:state.progress};
    if (sql.startsWith('SELECT a.usuario_id,a.tipo,u.activo')) return {rows:[{usuario_id:4,tipo:'responsable',activo:true}]};
    if (sql.startsWith('INSERT INTO public.progreso_edicion_entregas')) {
      state.progress.push({tarea_id:params[0],editor_user_id:params[6],origen_registro:'canonical_delivery',delivery_id:params[7],task_revision:params[8]});
      return {rows:[]};
    }
    if (sql.startsWith('UPDATE public.progreso_edicion_entregas')) {
      Object.assign(state.progress[0],{delivery_id:params[1],task_revision:params[2]});return {rows:[]};
    }
    if (sql.startsWith('SELECT id,rol,activo,session_version,usuario,nombre FROM usuarios')) return { rows: [user] };
    if (sql.startsWith('SELECT id,publicacion_id FROM tareas')) return { rows: [{ id: 8, publicacion_id: linked ? 31 : null }] };
    if (sql.startsWith('SELECT s.id,s.tarea_id')) return { rows: linked ? [{ id: 51, tarea_id: 8, publicacion_id: 31, clave: 'cliente:7', periodo: '2026-01' }] : [] };
    if (sql.startsWith('SELECT v.id,v.tarea_origen_id')) return { rows: linked ? [{ id: VISIT, tarea_origen_id: 7 }] : [] };
    if (sql.startsWith('SELECT id,visita_id FROM produccion_videos')) return { rows: [{ id: VIDEO, visita_id: VISIT }] };
    if (sql.startsWith('SELECT t.id,t.revision,t.estado')) return { rows: [{ ...state.task }] };
    if (sql.startsWith('SELECT id,payload_hash FROM task_editing_deliveries')) return { rows: state.events.filter(e => e.actor_id === params[0] && e.request_id === params[1]) };
    if (sql.startsWith('UPDATE tareas SET')) {
      if (state.task.revision !== params[1]) return { rows: [] };
      state.task.estado = 'en_revision'; state.task.revision += 1;
      Object.assign(state.task.propiedades_extra, { revision_aprobada: false, revision_aprobada_por: null, revision_aprobada_por_id: null, revision_aprobada_at: null, finalizada_at: null });
      return { rows: [{ id: 8, revision: state.task.revision, estado: state.task.estado }] };
    }
    if (sql.startsWith('INSERT INTO task_editing_deliveries')) {
      const [id, task_id, actor_id, request_id, payload_hash, task_revision, url, notes] = params;
      state.events.push({ id, task_id, actor_id, request_id, payload_hash, task_revision, url, notes, recorded_at: TIME });
    }
    if (sql.startsWith('SELECT id,task_id,actor_id,task_revision')) return { rows: [...state.events].reverse() };
    return { rows: [] };
  } };
  const router = { use(fn) { routes.set('middleware', fn); }, get(path, fn) { routes.set(`GET ${path}`, fn); }, post(path, fn) { routes.set(`POST ${path}`, fn); } };
  createEditingDeliveriesRouter({ express: { Router: () => router }, pool: { connect: async () => db } });
  return { calls, routes, state: () => state, released: () => released, async run(write = true, input = body(), extra = {}) {
    let status, payload, error;
    const res = { status(value) { status = value; return this; }, json(value) { payload = value; } };
    await routes.get(`${write ? 'POST' : 'GET'} /:id/entregas`)({ params: { id: '8' }, query: {}, body: input, auth: { ...user }, ...extra }, res, e => { error = e; });
    return { status, payload, error };
  } };
}

test('delivery atomically enters review, clears approval/finalization, preserves unrelated metadata and raw content', async () => {
  for (const estado of ['pendiente', 'en_progreso', 'en_revision', 'aprobada']) {
    const h = harness({ task: { estado } });
    const before = structuredClone(h.state().task);
    const result = await h.run();
    assert.equal(result.status, 201);
    assert.equal(result.payload.task.estado, 'en_revision');
    assert.equal(result.payload.task.revision, 3);
    assert.equal(result.payload.deliveries[0].task_revision, 3);
    assert.equal(result.payload.replayed, false);
    for (const key of ['material_referencia', 'fecha_vencimiento', 'aclaraciones']) assert.equal(h.state().task[key], before[key]);
    assert.equal(h.state().task.propiedades_extra.guiones, 'Guion');
    assert.equal(h.state().task.propiedades_extra.edicion_responsable_id, 4);
    assert.equal(h.state().task.propiedades_extra.revision_aprobada, false);
    for (const key of ['revision_aprobada_por', 'revision_aprobada_por_id', 'revision_aprobada_at', 'finalizada_at']) assert.equal(h.state().task.propiedades_extra[key], null);
    assert.equal(h.calls.filter(c => c.sql.startsWith('UPDATE tareas')).length, 1);
  }
});

test('exact retry returns current task/history even finalized; wrong intent cannot reuse actor/key', async () => {
  const h = harness();
  const first = await h.run();
  h.state().task.estado = 'finalizada'; h.state().task.revision = 5;
  const retry = await h.run();
  assert.equal(retry.status, 200);
  assert.equal(retry.payload.replayed, true);
  assert.equal(retry.payload.delivery_id, first.payload.delivery_id);
  assert.equal(retry.payload.task.estado, 'finalizada');
  assert.equal(retry.payload.task.revision, 5);
  assert.equal(retry.payload.can_deliver, false);
  assert.equal(h.state().events.length, 1);
  assert.equal((await h.run(true, body({ notes: 'Distinta' }))).status, 409);
  assert.equal((await h.run(true, body(), { params: { id: '9' } })).status, 409);
});

test('current ID assignment and role/session revocation precede replay; display names never grant permission', async () => {
  const h = harness();
  assert.equal((await h.run()).status, 201);
  h.state().task.assigned = false;
  assert.equal((await h.run()).status, 403);
  assert.equal(h.state().events.length, 1);
  const impostor = harness({ user: { ...ACTOR, id: 99, nombre: 'Editor real' }, assigned: false });
  assert.equal((await impostor.run()).status, 403);
  for (const user of [{ ...ACTOR, activo: false }, { ...ACTOR, session_version: 4 }, { ...ACTOR, rol: 'community' }]) {
    assert.equal((await harness({ user }).run(true, body(), { auth: ACTOR })).status, 401);
  }
  assert.equal((await harness({ user: { ...ACTOR, rol: 'unknown' } }).run()).status, 403);
});

test('shared current staff can read, only IDs/admin write; closed output applies to admin too', async () => {
  for (const rol of ['admin', 'diseno', 'edicion', 'produccion', 'community', 'programacion']) {
    const h = harness({ user: { ...ACTOR, rol }, assigned: false });
    const read = await h.run(false);
    assert.equal(read.status, 200);
    assert.equal(read.payload.can_deliver, rol === 'admin');
    assert.deepEqual(Object.keys(read.payload.task), ['id', 'revision', 'estado']);
    assert.equal((await h.run()).status, rol === 'admin' ? 201 : 403);
  }
  const collaborator = harness({ user: { ...ACTOR, rol: 'diseno' }, assigned: true });
  assert.equal((await collaborator.run()).status, 201);
});

test('unavailable scope returns404 and finalized new deliveries409; CAS prevents stale writes', async () => {
  for (const task of [{ workspace: 'historical' }, { tipo_tarea: 'produccion' }, { archived: 'true' }, { trashed: 'true' }]) {
    const h = harness({ task });
    assert.equal((await h.run(false)).status, 404);
    assert.equal((await h.run()).status, 404);
    assert.equal(h.state().events.length, 0);
  }
  for (const estado of ['finalizada', 'publicada']) assert.equal((await harness({ task: { estado } }).run()).status, 409);
  assert.equal((await harness({ task: { revision: 3 } }).run()).status, 409);
  const h = harness();
  assert.equal((await h.run()).status, 201);
  assert.equal((await h.run(true, body({ request_id: SECOND }))).status, 409);
  assert.equal(h.state().events.length, 1);
});

test('resource helper order covers goal/publication/visit before task UPDATE without reverse task locks', async () => {
  const h = harness({ linked: true });
  assert.equal((await h.run()).status, 201);
  const calls = h.calls;
  assert.equal(calls[0].sql, 'BEGIN ISOLATION LEVEL READ COMMITTED');
  const actor = calls.findIndex(c => c.sql.includes('FROM usuarios'));
  const request = calls.findIndex(c => c.sql.includes("hashtext('editing-delivery-request')"));
  const global = calls.findIndex(c => c.sql.includes("hashtext('vinculo-objetivo-mensual')"));
  const period = calls.findIndex(c => c.params[0] === 'objetivo:2026-01:cliente:7');
  const tasks = calls.findIndex(c => c.sql.startsWith('SELECT id FROM tareas WHERE id=ANY'));
  const publication = calls.findIndex(c => c.sql.startsWith('SELECT id FROM publicaciones WHERE'));
  const goal = calls.findIndex(c => c.sql.startsWith('SELECT id FROM cliente_objetivo_piezas WHERE'));
  const visit = calls.findIndex(c => c.sql.startsWith('SELECT id FROM produccion_visitas WHERE'));
  const video = calls.findIndex(c => c.sql.startsWith('SELECT id FROM produccion_videos WHERE'));
  const write = calls.findIndex(c => c.sql.startsWith('UPDATE tareas'));
  assert.ok(actor < request && request < global && global < period && period < tasks && tasks < publication && publication < goal && goal < visit && visit < video && video < write);
  assert.match(calls[actor].sql, /FOR SHARE$/);
  assert.deepEqual(calls[tasks].params, [[7, 8]]);
  assert.equal(calls.slice(video + 1).some(c => c.sql.includes('FROM tareas') && c.sql.includes('FOR UPDATE')), false);
});

test('insert fault rolls back state, approval, revision and history; same CAS/key succeeds after fault removed', async () => {
  let broken = true;
  const h = harness({ fault: sql => broken && sql.startsWith('INSERT INTO task_editing_deliveries') });
  const before = structuredClone(h.state());
  const result = await h.run();
  assert.equal(result.error?.code, 'P0001');
  assert.equal(result.status, undefined);
  assert.deepEqual(h.state(), before);
  assert.equal(h.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(h.released(), true);
  broken = false;
  assert.equal((await h.run()).status, 201);
});

test('only known named delivery domain SQL failures map409, arbitrary driver errors remain500', async () => {
  for (const [code, constraint, expected] of [['23505', 'task_editing_deliveries_request_unique', 409], ['23514', 'some_other_constraint', undefined], ['P0001', 'task_editing_deliveries_injected', undefined]]) {
    const error = Object.assign(new Error('private SQL detail'), { code, constraint });
    const h = harness({ fault: sql => sql.startsWith('INSERT INTO task_editing_deliveries') && error });
    const result = await h.run();
    assert.equal(result.status, expected);
    assert.equal(h.state().events.length, 0);
    if (expected === 409) assert.doesNotMatch(JSON.stringify(result.payload), /private SQL/);
    else assert.equal(result.error, error);
  }
});

test('GET is snapshot read-only; no-store and query rejection are explicit', async () => {
  const h = harness();
  assert.equal((await h.run(false)).status, 200);
  assert.equal(h.calls[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(h.calls.some(c => /FOR UPDATE|FOR SHARE|pg_advisory/.test(c.sql)), false);
  let header;
  h.routes.get('middleware')({}, { set: (...v) => { header = v; } }, () => {});
  assert.deepEqual(header, ['Cache-Control', 'no-store']);
  assert.equal((await h.run(false, undefined, { query: { actor_id: '4' } })).status, 400);
});

test('source cannot write raw material, scripts, editorial fields, assignments or immutable delivery history', () => {
  const source = readFileSync(new URL('../src/editing-deliveries.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /UPDATE publicaciones|UPDATE historias|UPDATE cliente_objetivo|INSERT INTO tareas|UPDATE task_editing_deliveries|DELETE FROM task_editing_deliveries|replaceTaskAssignments/);
  const update = source.slice(source.indexOf('UPDATE tareas SET'), source.indexOf('RETURNING id,revision,estado'));
  assert.doesNotMatch(update, /material_referencia|guiones|copy_trabajo|fecha_vencimiento|asignado_a|edicion_responsable/);
  for (const flag of ['revision_aprobada', 'revision_aprobada_por', 'revision_aprobada_por_id', 'revision_aprobada_at', 'finalizada_at']) assert.ok(update.includes(flag));
  assert.match(source, /ORDER BY recorded_at DESC,id DESC/);
});
