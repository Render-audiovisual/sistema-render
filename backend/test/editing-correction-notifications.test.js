import test from 'node:test';
import assert from 'node:assert/strict';
import {createEditingReviewsRouter} from '../src/editing-reviews.js';

const REQUEST = '10000000-0000-4000-8000-000000000396';
const DELIVERY = '20000000-0000-4000-8000-000000000396';
const OTHER = '30000000-0000-4000-8000-000000000396';
const BEFORE = '2026-10-25T10:00:00.000Z', AFTER = '2026-10-25T11:00:00.000Z';
const body = patch => ({request_id: REQUEST, expected_revision: 5, expected_entrega_id: DELIVERY,
  notes: '  Corregir audio\nConservar el cierre.  ', ...patch});
const tick = () => new Promise(resolve => setImmediate(resolve));

// Real router and its real decision/assignment helpers; bounded SQL stubs only.
// No HTTP server, database or external notification provider is started.
function fixture({members = [{usuario_id: 12, tipo: 'responsable'}, {usuario_id: 13, tipo: 'colaborador'}],
  label = {nombre: 'Same display name', usuario: 'qa396_current_admin'}, fault,
  notifierFault, omittedNotifier = false, taskPatch = {}} = {}) {
  const calls = [], order = [], notifications = [], routes = new Map();
  const user = {id: 4, rol: 'admin', activo: true, session_version: 2};
  let committed = false, released = false, snapshot;
  let state = {task: {id: 8, revision: 5, estado: 'en_revision', tipo_tarea: 'edicion', cliente_id: 7,
    titulo: 'QA396 current work', prioridad: 'alta', fecha_vencimiento: '2026-10-29', updated_at: BEFORE,
    asignado_a: 'Same display name', propiedades_extra: {workspace: 'render_os', copy_trabajo: 'Keep draft',
      edicion_responsable_id: 3, revision_aprobada: false}, ...taskPatch}, reviews: [],
    deliveries: [{id: DELIVERY, task_id: 8, actor_id: 3, task_revision: 5,
      url: 'https://example.invalid/qa396/old-editor.mp4', notes: '', recorded_at: BEFORE}]};
  const db = {
    release() {released = true; order.push('release');},
    async query(sql, params = []) {
      calls.push({sql, params: structuredClone(params)}); order.push(sql);
      if (fault?.(sql)) throw new Error('Synthetic database failure');
      if (sql.startsWith('BEGIN')) {snapshot = structuredClone(state); committed = false; return {rows: []};}
      if (sql === 'ROLLBACK') {state = snapshot; return {rows: []};}
      if (sql === 'COMMIT') {committed = true; return {rows: []};}
      if (sql.startsWith('SELECT id,rol,activo,session_version FROM usuarios')) return {rows: [{...user}]};
      if (sql === 'SELECT nombre,usuario FROM usuarios WHERE id=$1') {
        assert.deepEqual(params, [4]);
        assert.ok(calls.some(call => call.sql === 'SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1 FOR SHARE'),
          'Audit label must be read under the existing retained actor lock');
        return {rows: label ? [{...label}] : []};
      }
      if (sql.startsWith('SELECT pg_advisory_xact_lock')) return {rows: []};
      if (sql.startsWith('SELECT id,publicacion_id FROM tareas')) return {rows: [{id: 8, publicacion_id: null}]};
      if (sql.startsWith('SELECT s.id,s.tarea_id') || sql.startsWith('SELECT v.id,v.tarea_origen_id')) return {rows: []};
      if (sql.startsWith('SELECT id FROM tareas WHERE id=ANY')) return {rows: [{id: 8}]};
      if (sql === 'SELECT usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1 ORDER BY usuario_id,tipo') {
        assert.deepEqual(params, [8]);
        assert.ok(calls.some(call => call.sql.includes('SELECT id FROM tareas WHERE id=ANY') && call.sql.includes('FOR UPDATE')),
          'Recipient memberships must be observed while current task lock is held');
        return {rows: structuredClone(members)};
      }
      if (sql.startsWith('SELECT t.id,t.revision,t.estado')) {
        const fields = ['id', 'revision', 'estado', 'tipo_tarea', 'cliente_id'];
        const row = Object.fromEntries(fields.map(key => [key, state.task[key]]));
        for (const key of ['titulo', 'asignado_a', 'prioridad', 'fecha_vencimiento', 'updated_at', 'propiedades_extra'])
          if (new RegExp(`t\\.${key}\\b`).test(sql)) row[key] = structuredClone(state.task[key]);
        return {rows: [row]};
      }
      if (sql.startsWith('SELECT id,payload_hash FROM task_editing_reviews')) return {
        rows: state.reviews.filter(row => row.actor_id === params[0] && row.request_id === params[1]),
      };
      if (sql.startsWith('SELECT id,task_id,actor_id,task_revision')) return {rows: [...state.deliveries].sort((a, b) => b.task_revision - a.task_revision).slice(0, 1)};
      if (sql.startsWith('SELECT count(*)')) return {rows: [{total: state.reviews.length}]};
      if (sql.startsWith('SELECT id,task_id,delivery_id')) return {rows: structuredClone(state.reviews)};
      if (sql.startsWith('UPDATE tareas SET')) {
        if (state.task.revision !== params[1]) return {rows: []};
        state.task.estado = 'en_progreso'; state.task.revision++; state.task.updated_at = AFTER;
        Object.assign(state.task.propiedades_extra, {revision_aprobada: false, revision_aprobada_por: null,
          revision_aprobada_por_id: null, revision_aprobada_at: null, revision_aprobada_entrega_id: null, finalizada_at: null});
        const returning = sql.split('RETURNING')[1]; assert.ok(returning);
        return {rows: [Object.fromEntries(Object.entries(state.task).filter(([key]) => new RegExp(`\\b${key}\\b`).test(returning)))]};
      }
      if (sql.startsWith('WITH actual AS')) {
        const [task_id, actor_id, task_revision, delivery_id, id, notes, request_id, payload_hash] = params;
        assert.equal(actor_id, 4); assert.equal(task_revision, 6); assert.equal(delivery_id, DELIVERY);
        state.reviews.push({id, task_id, actor_id, task_revision, delivery_id, action: 'correcciones', notes,
          request_id, payload_hash, recorded_at: AFTER});
        return {rows: [{id}]};
      }
      assert.fail(`Unrecognized SQL in bounded correction notification fixture: ${sql}`);
    },
  };
  const pool = {connect: async () => db};
  const notifyAssignment = options => {
    assert.equal(committed, true); assert.ok(order.includes('json'), 'Hook follows confirmed201 response');
    order.push('notify'); notifications.push(options);
    if (notifierFault === 'throw') throw new Error('Synthetic notifier throw');
    if (notifierFault === 'reject') return Promise.reject(new Error('Synthetic notifier rejection'));
  };
  const router = {use() {}, get(path, fn) {routes.set(`GET ${path}`, fn);}, post(path, fn) {routes.set(`POST ${path}`, fn);}};
  createEditingReviewsRouter({express: {Router: () => router}, pool, ...(omittedNotifier ? {} : {notifyAssignment})});
  return {calls, order, notifications, pool, state: () => state, released: () => released,
    async run({method = 'POST', input = body()} = {}) {
      let status, payload; const next = [];
      const res = {status(value) {status = value; return this;}, json(value) {payload = value; order.push('json');}};
      await routes.get(method === 'POST' ? 'POST /:id/correcciones' : 'GET /:id/revisiones')({params: {id: '8'},
        query: {}, body: input, auth: {...user, nombre: 'FORGED request actor', usuario: 'FORGED request login'}}, res, error => next.push(error));
      await tick(); return {status, payload, next};
    },
  };
}

test('fresh correction notifies current owner/collaborator IDs postcommit with exact notes and current persisted task', async () => {
  const f = fixture(), result = await f.run();
  assert.equal(result.status, 201); assert.deepEqual(result.next, []);
  assert.equal(f.notifications.length, 1, 'Missing canonical correction notification hook');
  const notice = f.notifications[0];
  assert.strictEqual(notice.pool, f.pool); assert.equal(notice.motivo, 'correcciones');
  assert.equal(notice.detalle, 'Corregir audio\nConservar el cierre.');
  assert.deepEqual(notice.destinatarioIds, [12, 13]);
  assert.equal(notice.destinatarioIds.includes(3), false, 'Old delivery author is not a current recipient');
  assert.equal(notice.actorId, 4); assert.equal(notice.actor, 'Same display name');
  assert.equal(Object.hasOwn(notice, 'nombresDestinatarios'), false, 'No display-name recipient fallback');
  for (const key of ['id', 'revision', 'estado', 'titulo', 'cliente_id', 'prioridad', 'fecha_vencimiento', 'updated_at', 'propiedades_extra'])
    assert.deepEqual(notice.tarea[key], f.state().task[key], `Current task snapshot ${key}`);
  assert.equal(f.state().reviews[0].action, 'correcciones');
  assert.equal(f.calls.some(({sql}) => /INSERT INTO tarea_comentarios/.test(sql)), false, 'Decision is not a synthetic comment');
  assert.ok(f.order.indexOf('COMMIT') < f.order.indexOf('notify')); assert.equal(f.released(), true);
});

test('same actor display name as current assignee does not suppress ID-bound correction notification', async () => {
  const f = fixture({members: [{usuario_id: 12, tipo: 'responsable'}]}), result = await f.run();
  assert.equal(result.status, 201); assert.equal(f.notifications.length, 1);
  assert.deepEqual(f.notifications[0].destinatarioIds, [12]); assert.equal(f.notifications[0].actorId, 4);
});

test('no current assignment IDs means no notification and no inferred historical editor', async () => {
  const f = fixture({members: []}), result = await f.run();
  assert.equal(result.status, 201); assert.deepEqual(result.next, []); assert.deepEqual(f.notifications, []);
  assert.equal(f.state().task.propiedades_extra.edicion_responsable_id, 3);
});

test('replay and GET preserve original decision without a second notification or task update', async () => {
  const f = fixture(); const first = await f.run(); assert.equal(first.status, 201); assert.equal(f.notifications.length, 1);
  const checkpoint = f.calls.length;
  const replay = await f.run(); assert.equal(replay.status, 200); assert.equal(replay.payload.replayed, true);
  assert.equal(replay.payload.decision_id, first.payload.decision_id);
  assert.equal((await f.run({method: 'GET'})).status, 200);
  assert.equal(f.notifications.length, 1); assert.equal(f.state().reviews.length, 1);
  assert.equal(f.calls.slice(checkpoint).some(({sql}) => sql.startsWith('UPDATE tareas')), false);
});

test('retained actor label uses only current DB username or numeric fallback when name is absent', async () => {
  for (const [label, expected] of [[{nombre: '', usuario: 'qa396_renamed_admin'}, 'qa396_renamed_admin'],
    [{nombre: null, usuario: null}, 'Usuario #4']]) {
    const f = fixture({label}); assert.equal((await f.run()).status, 201);
    assert.equal(f.notifications.length, 1); assert.equal(f.notifications[0].actor, expected);
    assert.ok(f.calls.some(({sql}) => sql === 'SELECT nombre,usuario FROM usuarios WHERE id=$1'));
  }
});

for (const mode of ['throw', 'reject']) test(`notifier ${mode} cannot turn committed correction into error or rollback`, async () => {
  const f = fixture({notifierFault: mode}), result = await f.run();
  assert.equal(result.status, 201); assert.deepEqual(result.next, []); assert.equal(f.notifications.length, 1);
  assert.equal(f.state().reviews.length, 1); assert.equal(f.state().task.revision, 6);
  assert.equal(f.calls.some(({sql}) => sql === 'ROLLBACK'), false); assert.equal(f.released(), true);
});

test('stale task or wrong current delivery409 cannot notify or leave task/decision mutations', async () => {
  for (const input of [body({expected_revision: 4}), body({expected_entrega_id: OTHER})]) {
    const f = fixture(), before = structuredClone(f.state()), result = await f.run({input});
    assert.equal(result.status, 409); assert.deepEqual(result.next, []); assert.deepEqual(f.notifications, []);
    assert.deepEqual(f.state(), before); assert.ok(f.calls.some(({sql}) => sql === 'ROLLBACK'));
  }
});

for (const stage of ['WITH actual AS', 'COMMIT']) test(`failure at ${stage} rolls back without notification`, async () => {
  const f = fixture({fault: sql => sql.startsWith(stage)}), before = structuredClone(f.state()), result = await f.run();
  assert.equal(result.next.length, 1); assert.equal(result.status, undefined);
  assert.deepEqual(f.notifications, []); assert.deepEqual(f.state(), before); assert.equal(f.released(), true);
});

test('optional notifier omission retains successful correction contract', async () => {
  const f = fixture({omittedNotifier: true}), result = await f.run();
  assert.equal(result.status, 201); assert.deepEqual(result.next, []); assert.equal(f.state().reviews.length, 1);
});
