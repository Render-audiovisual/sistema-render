import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareTaskApprovalNotification} from '../src/task-approval-notifications.js';

const actorSql = 'SELECT id,rol,activo,session_version,nombre,usuario FROM usuarios WHERE id=$1 FOR SHARE';
const memberSql = 'SELECT usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1 ORDER BY usuario_id,tipo';
const observed = () => ({id: 4, rol: 'admin', session_version: 2});
const task = patch => ({id: 8, revision: 6, estado: 'aprobada', titulo: 'QA397 current task',
  cliente_id: 7, prioridad: 'alta', fecha_vencimiento: '2026-10-29',
  updated_at: new Date('2026-10-25T12:00:00.000Z'), asignado_a: 'Same label',
  propiedades_extra: {workspace: 'render_os', revision_aprobada: true,
    edicion_responsable_id: 3, copy_trabajo: 'Keep draft', nested: ['original']}, ...patch});
function deferred() {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};}
function fixture({actor = {}, members = [{usuario_id: 12, tipo: 'responsable'}, {usuario_id: 13, tipo: 'colaborador'}],
  lease, missing = false, fault} = {}) {
  const calls = [];
  const db = {async query(sql, values) {
    calls.push({sql, values: structuredClone(values)});
    if (fault) throw fault;
    if (sql === actorSql) {
      if (lease) await lease;
      return {rows: missing ? [] : [{id: 4, rol: 'admin', session_version: 2, activo: true,
        nombre: 'Verified renamed admin', usuario: 'qa397_admin', ...actor}]};
    }
    if (sql === memberSql) return {rows: structuredClone(members)};
    assert.fail(`Unexpected query in data-only approval helper: ${sql}`);
  }};
  return {db, calls};
}

test('approval includes all current member IDs even without reassignment; current DB actor replaces labels', async () => {
  const f = fixture(), original = task(), before = structuredClone(original);
  const event = await prepareTaskApprovalNotification(f.db, original, observed());
  assert.deepEqual(event.destinatarioIds, [12, 13]);
  assert.equal(event.destinatarioIds.includes(3), false, 'Historical editor is not current membership');
  assert.equal(event.actorId, 4); assert.equal(event.actor, 'Verified renamed admin');
  assert.deepEqual(event.tarea, {...before, updated_at: before.updated_at.toISOString()});
  assert.deepEqual(original, before);
  assert.deepEqual(f.calls, [{sql: actorSql, values: [4]}, {sql: memberSql, values: [8]}]);
  assert.equal(Object.hasOwn(event, 'pool'), false); assert.equal(Object.hasOwn(event, 'motivo'), false);
});

test('actor and complete task intent are captured synchronously before the first awaited query', async () => {
  const waiting = deferred(), f = fixture({lease: waiting.promise}), original = task(), auth = observed();
  const pending = prepareTaskApprovalNotification(f.db, original, auth);
  assert.deepEqual(f.calls, [{sql: actorSql, values: [4]}]);
  auth.id = 99; auth.rol = 'edicion'; auth.session_version = 100;
  original.id = 99; original.estado = 'finalizada'; original.titulo = 'Late overwrite';
  original.propiedades_extra.workspace = 'other'; original.propiedades_extra.nested.push('late');
  original.updated_at.setUTCFullYear(2030);
  waiting.resolve(); const event = await pending;
  assert.equal(event.actorId, 4); assert.equal(event.tarea.id, 8); assert.equal(event.tarea.estado, 'aprobada');
  assert.equal(event.tarea.titulo, 'QA397 current task'); assert.equal(event.tarea.propiedades_extra.workspace, 'render_os');
  assert.deepEqual(event.tarea.propiedades_extra.nested, ['original']);
  assert.equal(event.tarea.updated_at, '2026-10-25T12:00:00.000Z');
  assert.deepEqual(f.calls[1], {sql: memberSql, values: [8]});
});

test('prepared event is deeply immutable and does not alias caller-owned task structures', async () => {
  const f = fixture(), original = task(), event = await prepareTaskApprovalNotification(f.db, original, observed());
  for (const value of [event, event.tarea, event.tarea.propiedades_extra, event.tarea.propiedades_extra.nested, event.destinatarioIds])
    assert.equal(Object.isFrozen(value), true);
  assert.throws(() => event.destinatarioIds.push(90), TypeError);
  assert.throws(() => {event.tarea.propiedades_extra.revision_aprobada = false;}, TypeError);
  original.propiedades_extra.nested[0] = 'caller changed';
  assert.deepEqual(event.tarea.propiedades_extra.nested, ['original']);
});

test('empty assignment remains an empty event, never inferred from legacy names or editor IDs', async () => {
  const f = fixture({members: []}), event = await prepareTaskApprovalNotification(f.db, task(), observed());
  assert.deepEqual(event.destinatarioIds, []); assert.equal(event.actorId, 4);
  assert.equal(f.calls.length, 2);
});

test('all current IDs are sorted/deduplicated independently of display labels and role names', async () => {
  const f = fixture({members: [{usuario_id: 19, tipo: 'colaborador'}, {usuario_id: 12, tipo: 'responsable'},
    {usuario_id: 13, tipo: 'colaborador'}, {usuario_id: 19, tipo: 'colaborador'}]});
  assert.deepEqual((await prepareTaskApprovalNotification(f.db, task(), observed())).destinatarioIds, [12, 13, 19]);
});

test('only captured admin role may prepare approval notices; invalid captures fail before SQL', async () => {
  for (const rol of ['edicion', 'diseno', 'produccion', 'community', 'programacion']) {
    const f = fixture();
    await assert.rejects(prepareTaskApprovalNotification(f.db, task(), {...observed(), rol}), {status: 403});
    assert.deepEqual(f.calls, []);
  }
  for (const auth of [null, {id: '4', rol: 'admin', session_version: 2}, {...observed(), session_version: 0}]) {
    const f = fixture(); await assert.rejects(prepareTaskApprovalNotification(f.db, task(), auth), {status: 401});
    assert.deepEqual(f.calls, []);
  }
});

test('revoked, demoted, different or stale current DB actor rejects before reading memberships', async () => {
  for (const options of [{missing: true}, {actor: {activo: false}}, {actor: {rol: 'edicion'}},
    {actor: {session_version: 3}}, {actor: {id: 5}}]) {
    const f = fixture(options);
    await assert.rejects(prepareTaskApprovalNotification(f.db, task(), observed()), {status: 401});
    assert.deepEqual(f.calls, [{sql: actorSql, values: [4]}]);
  }
  const f = fixture({actor: {nombre: '', usuario: 'qa397_current_login'}});
  assert.equal((await prepareTaskApprovalNotification(f.db, task(), observed())).actor, 'qa397_current_login');
});

test('hidden, noncanonical, nonapproved or invalid revision cannot prepare an event or query DB', async () => {
  const base = task();
  const invalid = [task({estado: 'en_revision'}), task({estado: 'finalizada'}),
    ...[0, -1, '6', 1.5, Number.MAX_SAFE_INTEGER + 1].map(revision => task({revision})),
    ...[false, 'true', undefined].map(revision_aprobada => task({propiedades_extra: {...base.propiedades_extra, revision_aprobada}})),
    task({propiedades_extra: {...base.propiedades_extra, workspace: 'other'}}),
    ...['archivada_render_os', 'papelera_render_os'].flatMap(key => [true, 'true'].map(value =>
      task({propiedades_extra: {...base.propiedades_extra, [key]: value}})))];
  for (const value of invalid) {
    const f = fixture(); await assert.rejects(prepareTaskApprovalNotification(f.db, value, observed()), {status: 409});
    assert.deepEqual(f.calls, []);
  }
});

test('ambiguous or malformed memberships fail closed, without DML or notification side effects', async () => {
  for (const members of [[{usuario_id: 12, tipo: 'responsable'}, {usuario_id: 13, tipo: 'responsable'}],
    [{usuario_id: 12, tipo: 'responsable'}, {usuario_id: 12, tipo: 'colaborador'}],
    [{usuario_id: '12', tipo: 'responsable'}], [{usuario_id: 12, tipo: 'unknown'}]]) {
    const f = fixture({members});
    await assert.rejects(prepareTaskApprovalNotification(f.db, task(), observed()), {status: 409});
    assert.deepEqual(f.calls.map(call => call.sql), [actorSql, memberSql]);
  }
});

test('database errors propagate unchanged to the caller-owned transaction', async () => {
  const error = new Error('Synthetic database failure'), f = fixture({fault: error});
  await assert.rejects(prepareTaskApprovalNotification(f.db, task(), observed()), actual => actual === error);
  assert.deepEqual(f.calls.map(call => call.sql), [actorSql]);
});
