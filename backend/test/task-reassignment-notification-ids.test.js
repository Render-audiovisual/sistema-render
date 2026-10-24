import test from 'node:test';
import assert from 'node:assert/strict';
import { persistAssignedTask } from '../src/task-persistence.js';

const taskId = 73;
const update = 'UPDATE tareas SET asignado_a=$1 WHERE id=$2 RETURNING *';
const member = (usuario_id, tipo = 'responsable') => ({ usuario_id, tipo });
const options = () => ({ assignmentNotificationActor: { id: 9, rol: 'admin', session_version: 3 }, assignmentNotificationTaskId: taskId });
const assignment = (ownerId = 12, collaboratorIds = []) => ({ ownerId, ownerName: 'Same label', collaboratorIds, collaboratorNames: collaboratorIds.map(() => 'Same label') });

function fixture({ previous = [member(11)], actor = {}, commitError, writeError, rollbackError, lease } = {}) {
  const calls = [];
  let members = previous.map(row => ({ ...row }));
  let result;
  const db = {
    async query(sql, values) {
      calls.push({ sql, values: structuredClone(values) });
      if (sql === 'BEGIN' || sql === 'ROLLBACK') {
        if (sql === 'ROLLBACK' && rollbackError) throw rollbackError;
        return { rows: [] };
      }
      if (sql === 'COMMIT') {
        assert.equal(Object.hasOwn(result, 'assignmentNotification'), false, 'no event exposed before commit');
        if (commitError) throw commitError;
        return { rows: [] };
      }
      if (sql === 'SELECT id,rol,activo,session_version,nombre,usuario FROM usuarios WHERE id=$1 FOR SHARE') {
        assert.deepEqual(values, [9]);
        return { rows: [{ id: 9, rol: 'admin', activo: true, session_version: 3, nombre: 'Real database actor', usuario: 'actor-login', ...actor }] };
      }
      if (sql === 'SELECT id FROM usuarios WHERE id=ANY($1::integer[]) AND activo=TRUE FOR SHARE') return { rows: values[0].map(id => ({ id })) };
      if (sql === 'SELECT id FROM tareas WHERE id=$1 FOR UPDATE') {
        assert.deepEqual(values, [taskId]);
        return { rows: [{ id: taskId }] };
      }
      if (sql === 'SELECT usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1 ORDER BY usuario_id,tipo') {
        assert.deepEqual(values, [taskId]);
        return { rows: members.map(row => ({ ...row })) };
      }
      if (sql === update) {
        if (writeError) throw writeError;
        assert.deepEqual(values, ['Same label', taskId]);
        result = { rows: [{ id: taskId, asignado_a: values[0], revision: 2, propiedades_extra: { nested: ['original'] } }] };
        return result;
      }
      if (sql === 'DELETE FROM tarea_asignaciones WHERE tarea_id = $1') {
        assert.deepEqual(values, [taskId]);
        members = [];
        return { rows: [] };
      }
      if (sql.startsWith('INSERT INTO tarea_asignaciones (tarea_id, usuario_id, tipo)')) {
        assert.equal(values[0], taskId);
        members = values[1].map((id, index) => member(id, values[2][index]));
        return { rows: [] };
      }
      if (sql.startsWith('SELECT tarea_id, usuario_id, tipo FROM tarea_asignaciones')) {
        assert.deepEqual(values, [[taskId]]);
        return { rows: members.map(row => ({ ...row, tarea_id: taskId })) };
      }
      assert.fail(`Unexpected SQL: ${sql}`);
    },
    release(error) { calls.push({ sql: 'RELEASE', error }); },
  };
  return { calls, getResult: () => result, pool: { async connect() { if (lease) await lease(); return db; } } };
}

const save = (f, next = assignment(), opts = options()) => persistAssignedTask(f.pool, update, ['Same label', taskId], next, null, null, opts);

test('homonymous owner IDs 11 -> 12 notify 12 after commit, independently of display labels', async () => {
  const f = fixture();
  const result = await save(f);
  assert.deepEqual(result.assignmentNotification.destinatarioIds, [12]);
  assert.equal(result.assignmentNotification.actorId, 9);
  assert.equal(result.assignmentNotification.actor, 'Real database actor');
  assert.equal(result.assignmentNotification.tarea.asignado_a_id, 12);
  const sql = f.calls.map(call => call.sql);
  assert.ok(sql.findIndex(value => value.includes('FROM usuarios WHERE id=$1 FOR SHARE')) < sql.indexOf(update));
  assert.ok(sql.indexOf('SELECT id FROM tareas WHERE id=$1 FOR UPDATE') < sql.indexOf(update));
  assert.ok(sql.indexOf('SELECT usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1 ORDER BY usuario_id,tipo') < sql.indexOf(update));
  assert.deepEqual(sql.slice(-2), ['COMMIT', 'RELEASE']);
  assert.ok(Object.isFrozen(result.assignmentNotification));
  assert.ok(Object.isFrozen(result.assignmentNotification.destinatarioIds));
  assert.ok(Object.isFrozen(result.assignmentNotification.tarea.propiedades_extra.nested));
  result.rows[0].propiedades_extra.nested.push('later');
  assert.deepEqual(result.assignmentNotification.tarea.propiedades_extra.nested, ['original']);
});

test('same ID with renamed label produces no recipient', async () => {
  const result = await save(fixture({ previous: [member(12)] }), { ...assignment(), ownerName: 'Renamed person' });
  assert.deepEqual(result.assignmentNotification.destinatarioIds, []);
});

test('collaborator promoted to owner receives a role-change notification', async () => {
  const result = await save(fixture({ previous: [member(11), member(12, 'colaborador')] }));
  assert.deepEqual(result.assignmentNotification.destinatarioIds, [12]);
});

test('removal alone notifies nobody; newly added collaborators are ID-deduplicated', async () => {
  const removal = await save(fixture({ previous: [member(12), member(11, 'colaborador')] }));
  assert.deepEqual(removal.assignmentNotification.destinatarioIds, []);
  const addition = await save(fixture({ previous: [member(12)] }), assignment(12, [14, 13, 14]));
  assert.deepEqual(addition.assignmentNotification.destinatarioIds, [13, 14]);
});

for (const actor of [{ session_version: 4 }, { activo: false }, { rol: 'disenador' }]) {
  test(`revoked actor fails before task mutation: ${JSON.stringify(actor)}`, async () => {
    const f = fixture({ actor });
    await assert.rejects(save(f), { status: 401 });
    assert.equal(f.calls.some(call => call.sql === update || call.sql.includes('FROM tareas')), false);
    assert.deepEqual(f.calls.slice(-2).map(call => call.sql), ['ROLLBACK', 'RELEASE']);
  });
}

for (const phase of ['writeError', 'commitError']) {
  test(`${phase} rejects with original error and exposes no notification result`, async () => {
    const error = new Error(phase);
    const f = fixture({ [phase]: error });
    await assert.rejects(save(f), thrown => thrown === error);
    assert.equal(Object.hasOwn(f.getResult() || {}, 'assignmentNotification'), false);
    assert.deepEqual(f.calls.slice(-2).map(call => call.sql), ['ROLLBACK', 'RELEASE']);
  });
}

test('rollback failure preserves original commit error and discards the connection', async () => {
  const commitError = new Error('commit failed');
  const rollbackError = new Error('rollback failed');
  const f = fixture({ commitError, rollbackError });
  await assert.rejects(save(f), thrown => thrown === commitError);
  assert.equal(f.calls.at(-1).error, rollbackError);
});

test('authority, explicit task ID and assignment are captured before connection lease', async () => {
  const next = assignment(12, [13]);
  const opts = options();
  const f = fixture({ lease() {
    opts.assignmentNotificationActor.id = 999;
    opts.assignmentNotificationActor.session_version = 999;
    opts.assignmentNotificationTaskId = 999;
    next.ownerId = 999;
    next.collaboratorIds.push(999);
  } });
  const result = await save(f, next, opts);
  assert.deepEqual(result.assignmentNotification.destinatarioIds, [12, 13]);
  assert.equal(result.assignmentNotification.actorId, 9);
  assert.equal(result.assignmentNotification.tarea.id, taskId);
});

test('missing explicit task ID rejects before leasing; task ID is never inferred from SQL values', async () => {
  let leased = false;
  const f = fixture({ lease() { leased = true; } });
  const opts = options();
  delete opts.assignmentNotificationTaskId;
  await assert.rejects(save(f, assignment(), opts), { status: 400 });
  assert.equal(leased, false);
});
