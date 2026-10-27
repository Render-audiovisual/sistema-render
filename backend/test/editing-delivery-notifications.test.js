import test from 'node:test';
import assert from 'node:assert/strict';
import {createEditingDeliveriesRouter} from '../src/editing-deliveries.js';
import {getStateNotification} from '../src/task-workflow.js';
import {EDITING_PROGRESS_SCHEMA} from '../src/editing-progress-ledger.js';

const KEY = '10000000-0000-4000-8000-000000000395';
const BEFORE = '2026-10-25T10:00:00.000Z', AFTER = '2026-10-25T11:00:00.000Z';
const input = patch => ({request_id: KEY, expected_revision: 2,
  url: 'https://example.invalid/qa395/final.mp4', notes: 'Synthetic delivery', ...patch});
const tick = () => new Promise(resolve => setImmediate(resolve));

// Actual Express-style route handlers, retained DB actor and SQL result shapes.
// No server, database, email or WhatsApp provider is started by these tests.
function fixture({estado = 'en_progreso', approval = false, user = {}, assigned = true,
  fault, notifierFault, omittedNotifier = false} = {}) {
  const calls = [], notifications = [], routes = new Map(), order = [];
  const actor = {id: 4, rol: 'edicion', activo: true, session_version: 3,
    nombre: 'Verified renamed actor', usuario: 'qa395_editor', ...user};
  let committed = false, released = false, saved;
  let state = {task: {id: 8, revision: 2, estado, tipo_tarea: 'edicion', workspace: 'render_os',
    archived: 'false', trashed: 'false', assigned, titulo: 'QA395 editing video', cliente_id: 7,
    prioridad: 'alta', fecha_vencimiento: '2026-10-29', updated_at: BEFORE,
    propiedades_extra: {workspace: 'render_os', keep: 'private draft unchanged', revision_aprobada: approval}}, deliveries: [], progress: []};
  const db = {
    release() {released = true; order.push('release');},
    async query(sql, params = []) {
      calls.push({sql, params: structuredClone(params)}); order.push(sql);
      if (fault?.(sql)) throw new Error('Synthetic database failure');
      if (sql.startsWith('BEGIN')) {saved = structuredClone(state); committed = false; return {rows: []};}
      if (sql === 'ROLLBACK') {state = saved; return {rows: []};}
      if (sql === 'COMMIT') {committed = true; return {rows: []};}
      if (sql.includes('AS columns') && sql.includes('FROM pg_constraint')) return {rows: [{
        columns: Object.entries(EDITING_PROGRESS_SCHEMA.columns).map(([name, [type, notNull]]) => ({name, type, notNull})),
        constraints: Object.entries(EDITING_PROGRESS_SCHEMA.constraints).map(([name, definition]) => ({name, definition, validated: true, deferred: false})),
      }]};
      if (sql.includes('FROM public.progreso_edicion_entregas LIMIT 0')) return {rows: []};
      if (sql.startsWith('SELECT id,revision,estado,tipo_tarea,titulo,cliente_id,propiedades_extra')) return {rows: [structuredClone(state.task)]};
      if (sql.startsWith('SELECT id,task_id,task_revision,recorded_at')) return {rows: state.deliveries.slice(-1)};
      if (sql.startsWith('SELECT tarea_id,editor_user_id,origen_registro,delivery_id,task_revision')) return {rows: structuredClone(state.progress)};
      if (sql.startsWith('SELECT a.usuario_id,a.tipo,u.activo')) return {rows: assigned ? [{usuario_id: actor.id, tipo: 'responsable', activo: true}] : []};
      if (sql.startsWith('INSERT INTO public.progreso_edicion_entregas')) {
        assert.equal(state.progress.length, 0, 'Unique task credit');
        const [tarea_id, editor_clave, titulo_snapshot, cliente_id, estado_actual, entregada_at, editor_user_id, delivery_id, task_revision] = params;
        assert.ok(state.deliveries.some(d => d.task_id === tarea_id && d.id === delivery_id));
        state.progress.push({tarea_id, editor_clave, titulo_snapshot, cliente_id, estado_actual, entregada_at, editor_user_id,
          origen_registro: 'canonical_delivery', delivery_id, task_revision, activa: true, baja_at: null});
        return {rows: []};
      }
      if (sql.startsWith('UPDATE public.progreso_edicion_entregas')) {
        const row = state.progress.find(p => p.tarea_id === params[0]); assert.ok(row);
        Object.assign(row, {delivery_id: params[1], task_revision: params[2], estado_actual: params[3], activa: true, baja_at: null});
        return {rows: []};
      }
      if (/^SELECT id,rol,activo,session_version(?:,usuario,nombre)? FROM usuarios/.test(sql)) {
        // Do not supply labels the production SELECT did not actually request.
        const row = {id: actor.id, rol: actor.rol, activo: actor.activo, session_version: actor.session_version};
        if (sql.includes(',usuario,nombre')) Object.assign(row, {usuario: actor.usuario, nombre: actor.nombre});
        return {rows: [row]};
      }
      if (sql.startsWith('SELECT pg_advisory_xact_lock')) return {rows: []};
      if (sql.startsWith('SELECT id,publicacion_id FROM tareas')) return {rows: [{id: 8, publicacion_id: null}]};
      if (sql.startsWith('SELECT s.id,s.tarea_id') || sql.startsWith('SELECT v.id,v.tarea_origen_id')) return {rows: []};
      if (sql.startsWith('SELECT id FROM tareas WHERE id=ANY')) return {rows: [{id: 8}]};
      if (sql.startsWith('SELECT t.id,t.revision,t.estado,t.tipo_tarea')) {
        const {id, revision, estado, tipo_tarea, workspace, archived, trashed, assigned} = state.task;
        const row = {id, revision, estado, tipo_tarea, workspace, archived, trashed, assigned};
        for (const key of ['titulo', 'cliente_id', 'prioridad', 'fecha_vencimiento', 'updated_at', 'propiedades_extra']) {
          if (new RegExp(`t\\.${key}\\b${key === 'propiedades_extra' ? '(?!\\s*->)' : ''}`).test(sql)) row[key] = structuredClone(state.task[key]);
        }
        return {rows: [row]};
      }
      if (sql.startsWith('SELECT id,payload_hash FROM task_editing_deliveries')) return {
        rows: state.deliveries.filter(row => row.actor_id === params[0] && row.request_id === params[1]),
      };
      if (sql.startsWith('UPDATE tareas SET')) {
        if (state.task.revision !== params[1]) return {rows: []};
        state.task.estado = 'en_revision'; state.task.revision++; state.task.updated_at = AFTER;
        Object.assign(state.task.propiedades_extra, {revision_aprobada: false, revision_aprobada_por: null,
          revision_aprobada_por_id: null, revision_aprobada_at: null, finalizada_at: null, revision_aprobada_entrega_id: null});
        const returning = sql.split('RETURNING')[1]; assert.ok(returning);
        return {rows: [Object.fromEntries(Object.entries(state.task).filter(([key]) => new RegExp(`\\b${key}\\b`).test(returning)))]};
      }
      if (sql.startsWith('INSERT INTO task_editing_deliveries')) {
        const [id, task_id, actor_id, request_id, payload_hash, task_revision, url, notes] = params;
        state.deliveries.push({id, task_id, actor_id, request_id, payload_hash, task_revision, url, notes, recorded_at: AFTER});
        return {rows: []};
      }
      if (sql.startsWith('SELECT id,task_id,actor_id,task_revision')) return {rows: [...state.deliveries].reverse()};
      assert.fail(`Unrecognized SQL in bounded notification fixture: ${sql}`);
    },
  };
  const pool = {connect: async () => db};
  const notifyAssignment = options => {
    order.push('notify');
    assert.equal(committed, true, 'Notification must follow a successful COMMIT');
    assert.equal(order.includes('json'), true, 'Notification must not delay or replace the201 response');
    notifications.push(options);
    if (notifierFault === 'throw') throw new Error('Synthetic notifier throw');
    if (notifierFault === 'reject') return Promise.reject(new Error('Synthetic notifier rejection'));
  };
  const router = {use() {}, get(path, handler) {routes.set(`GET ${path}`, handler);}, post(path, handler) {routes.set(`POST ${path}`, handler);}};
  createEditingDeliveriesRouter({express: {Router: () => router}, pool, ...(omittedNotifier ? {} : {notifyAssignment})});
  return {calls, notifications, order, pool, state: () => state, released: () => released,
    async run({method = 'POST', body = input(), auth = {id: 4, rol: 'edicion', session_version: 3, nombre: 'FORGED request label', usuario: 'FORGED login'}} = {}) {
      let status, payload; const next = [];
      const res = {status(value) {status = value; return this;}, json(value) {order.push('json'); payload = value;}};
      await routes.get(`${method} /:id/entregas`)({params: {id: '8'}, query: {}, body, auth}, res, error => next.push(error));
      await tick(); return {status, payload, next};
    },
  };
}

test('fresh canonical delivery notifies once after commit/201 with current task and verified actor, preserving current recipient policy', async () => {
  const f = fixture(), result = await f.run();
  assert.equal(result.status, 201); assert.deepEqual(result.next, []);
  assert.equal(f.notifications.length, 1, 'Missing canonical delivery notification hook');
  const notice = f.notifications[0], event = getStateNotification(f.state().task, 'en_progreso');
  assert.strictEqual(notice.pool, f.pool); assert.equal(notice.motivo, event.motivo);
  assert.deepEqual(notice.nombresDestinatarios, event.recipients);
  assert.equal(notice.actorId, 4); assert.equal(notice.actor, 'Verified renamed actor');
  for (const key of ['id', 'revision', 'titulo', 'cliente_id', 'prioridad', 'fecha_vencimiento', 'estado', 'updated_at', 'propiedades_extra'])
    assert.deepEqual(notice.tarea[key], f.state().task[key], `Actual observed task field ${key}`);
  assert.equal(notice.tarea.propiedades_extra.revision_aprobada, false);
  assert.ok(f.order.indexOf('COMMIT') < f.order.indexOf('notify')); assert.equal(f.released(), true);
  assert.equal(f.state().progress.length, 1);
  assert.equal(f.state().progress[0].delivery_id, result.payload.delivery_id);
  assert.equal(f.state().progress[0].editor_user_id, 4);
});

test('exact replay and GET never notify again or create another delivery', async () => {
  const f = fixture(); assert.equal((await f.run()).status, 201);
  assert.equal(f.notifications.length, 1);
  const replay = await f.run(); assert.equal(replay.status, 200); assert.equal(replay.payload.replayed, true);
  assert.equal((await f.run({method: 'GET'})).status, 200);
  assert.equal(f.notifications.length, 1); assert.equal(f.state().deliveries.length, 1);
  assert.equal(f.state().progress.length, 1);
});

test('fresh replacement while already unapproved en_revision preserves first-effective-transition-only policy', async () => {
  for (const approval of [false, undefined, 'true', 'false']) {
    const f = fixture({estado: 'en_revision', approval}), result = await f.run();
    assert.equal(result.status, 201); assert.equal(f.notifications.length, 0); assert.deepEqual(result.next, []);
  }
});

test('historical strict boolean approval in raw en_revision transitions effectively back into review and notifies', async () => {
  const f = fixture({estado: 'en_revision', approval: true}), result = await f.run();
  assert.equal(result.status, 201); assert.equal(f.notifications.length, 1);
  assert.equal(f.notifications[0].motivo, 'revision'); assert.equal(f.notifications[0].tarea.propiedades_extra.revision_aprobada, false);
});

test('stored aprobada fresh delivery notifies the existing review event without implicit completion/publication', async () => {
  const f = fixture({estado: 'aprobada', approval: true}), result = await f.run();
  assert.equal(result.status, 201); assert.equal(f.notifications.length, 1);
  assert.equal(result.payload.task.estado, 'en_revision');
  assert.equal(f.calls.some(({sql}) => /INSERT INTO (?:publicaciones|publicacion_|produccion_)/.test(sql)), false);
});

for (const mode of ['throw', 'reject']) test(`postcommit notifier ${mode} cannot alter201, rollback or call next`, async () => {
  const f = fixture({notifierFault: mode}), result = await f.run();
  assert.equal(result.status, 201); assert.equal(f.notifications.length, 1); assert.deepEqual(result.next, []);
  assert.equal(f.state().deliveries.length, 1); assert.equal(f.state().task.estado, 'en_revision');
  assert.equal(f.calls.some(({sql}) => sql === 'ROLLBACK'), false); assert.equal(f.released(), true);
});

test('verified actor label falls back only to its retained username or numeric ID', async () => {
  for (const [user, expected] of [[{nombre: '', usuario: 'qa395_current_login'}, 'qa395_current_login'],
    [{nombre: null, usuario: null}, 'Usuario #4']]) {
    const f = fixture({user}); assert.equal((await f.run()).status, 201);
    assert.equal(f.notifications.length, 1); assert.equal(f.notifications[0].actor, expected); assert.equal(f.notifications[0].actorId, 4);
  }
});

test('stale CAS and assignment denial cannot enqueue, mutate or bypass rollback', async () => {
  for (const [options, body, expected] of [[{}, input({expected_revision: 1}), 409], [{assigned: false}, input(), 403]]) {
    const f = fixture(options), before = structuredClone(f.state()), result = await f.run({body});
    assert.equal(result.status, expected); assert.deepEqual(result.next, []);
    assert.deepEqual(f.notifications, []); assert.deepEqual(f.state(), before);
    assert.ok(f.calls.some(({sql}) => sql === 'ROLLBACK'));
  }
});

for (const stage of ['INSERT INTO task_editing_deliveries', 'INSERT INTO public.progreso_edicion_entregas', 'COMMIT']) test(`failure at ${stage} never notifies`, async () => {
  const f = fixture({fault: sql => sql.startsWith(stage)}), before = structuredClone(f.state()), result = await f.run();
  assert.equal(result.next.length, 1); assert.equal(result.status, undefined);
  assert.deepEqual(f.notifications, []); assert.deepEqual(f.state(), before); assert.equal(f.released(), true);
});

test('new version updates evidence once without moving first date, credit or emitting a second review transition', async () => {
  const f = fixture(); assert.equal((await f.run()).status, 201);
  const first = structuredClone(f.state().progress[0]);
  const next = await f.run({body: input({request_id: '20000000-0000-4000-8000-000000000395', expected_revision: 3})});
  assert.equal(next.status, 201); assert.equal(f.state().deliveries.length, 2); assert.equal(f.state().progress.length, 1);
  const current = f.state().progress[0];
  assert.equal(current.entregada_at, first.entregada_at); assert.equal(current.editor_user_id, first.editor_user_id);
  assert.equal(current.delivery_id, next.payload.delivery_id); assert.notEqual(current.delivery_id, first.delivery_id);
  assert.equal(f.notifications.length, 1);
});

test('optional notifier omission retains the existing successful route contract', async () => {
  const f = fixture({omittedNotifier: true}), result = await f.run();
  assert.equal(result.status, 201); assert.deepEqual(result.next, []); assert.equal(f.state().deliveries.length, 1);
});
