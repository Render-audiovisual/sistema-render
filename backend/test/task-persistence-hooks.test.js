import test from 'node:test';
import assert from 'node:assert/strict';
import { persistAssignedTask } from '../src/task-persistence.js';

function fixture() {
  const calls = [];
  const db = { async query(sql) {
    calls.push(sql);
    if (sql.startsWith('INSERT INTO tareas ')) return { rows: [{ id: 1, revision: 1, titulo: 'Visita', propiedades_extra: {} }] };
    if (sql.includes('SELECT id FROM usuarios')) return { rows: [{ id: 2 }] };
    if (sql.includes('SELECT tarea_id, usuario_id, tipo')) return { rows: [{ tarea_id: 1, usuario_id: 2, tipo: 'responsable' }] };
    return { rows: [] };
  }, release() { calls.push('RELEASE'); } };
  return { calls, db, pool: { connect: async () => db } };
}
const assignment = { ownerId: 2, collaboratorIds: [] };

test('source registry hook uses the task transaction after stable memberships and before commit', async () => {
  const f = fixture();
  const result = await persistAssignedTask(f.pool, 'INSERT INTO tareas QA', [], assignment, async (db, task) => {
    assert.equal(db, f.db);
    assert.equal(task.id, 1);
    assert.ok(f.calls.some(sql => sql.startsWith('INSERT INTO tarea_asignaciones')));
    assert.equal(f.calls.includes('COMMIT'), false);
    await db.query('INSERT REGISTRY QA');
  });
  assert.equal(result.rows[0].asignado_a_id, 2);
  assert.ok(f.calls.indexOf('INSERT REGISTRY QA') < f.calls.indexOf('COMMIT'));
  assert.deepEqual(f.calls.slice(-2), ['COMMIT', 'RELEASE']);
});

test('source registry failure rolls back the task and memberships rather than committing partial creation', async () => {
  const f = fixture();
  await assert.rejects(persistAssignedTask(f.pool, 'INSERT INTO tareas QA', [], assignment, async () => {
    throw Object.assign(new Error('Source registry conflict'), { status: 409 });
  }), { status: 409 });
  assert.equal(f.calls.includes('COMMIT'), false);
  assert.deepEqual(f.calls.slice(-2), ['ROLLBACK', 'RELEASE']);
});
