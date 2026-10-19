import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const start = source.indexOf('async function confirmProductionVisit(');
const body = source.slice(start, source.indexOf('\nrouter.post(', start));
const editingStart = source.indexOf('async function crearTareaEdicionDesdeVisita(');
const editingBody = source.slice(editingStart, source.indexOf('\nrouter.patch(', editingStart));
function fixture({ failInsert = false } = {}) {
  const queries = [], notices = [];
  const task = { id: 1951, cliente_id: 9, propiedades_extra: {}, material_referencia: 'drive', prioridad: 'alta' };
  const client = { async query(sql) {
    queries.push(sql);
    if (sql.includes('FROM tareas')) return { rows: [task] };
    if (sql.includes('FROM clientes')) return { rows: [{ nombre: 'Litoral Maq' }] };
    if (sql.includes('INSERT INTO tareas')) {
      if (failInsert) throw new Error('insert failed');
      return { rows: [{ id: 2000, asignado_a: 'Luciano', tarea_padre_id: 1951 }] };
    }
    return { rows: [task] };
  }, release() { queries.push('RELEASE'); } };
  const pool = { async connect() { return client; }, async query() { throw new Error('Cross-connection query would block on parent FK'); } };
  const run = new Function('pool', 'isProductionVisitTask', 'validateProductionHandoff', 'getProductionProgress', 'notificarAsignacionSinInterrumpir', `${editingBody}\n${body}\nreturn confirmProductionVisit;`)(pool, () => true, () => null, () => ({ recorded: 4 }), x => notices.push(x));
  return { run, client, queries, notices };
}
test('standalone handoff inserts linked child on locked parent connection and notifies after commit', async () => {
  const f = fixture(); const result = await f.run(1951, 'Franco');
  assert.equal(result.editing_task.tarea_padre_id, 1951);
  assert.equal(f.queries[0], 'BEGIN');
  assert.deepEqual(f.queries.slice(-2), ['COMMIT', 'RELEASE']);
  assert.equal(f.notices.length, 1);
});
test('WhatsApp transaction remains owned by confirmation route, without early notification', async () => {
  const f = fixture(); await f.run(1951, 'Franco', f.client);
  assert.ok(f.queries.some(q => q.includes('INSERT INTO tareas')));
  assert.ok(!f.queries.some(q => ['BEGIN', 'COMMIT', 'RELEASE'].includes(q)));
  assert.equal(f.notices.length, 0);
});
test('insert failure rolls back standalone parent update and emits no assignment', async () => {
  const f = fixture({ failInsert: true });
  await assert.rejects(f.run(1951, 'Franco'), /insert failed/);
  assert.deepEqual(f.queries.slice(-2), ['ROLLBACK', 'RELEASE']);
  assert.ok(!f.queries.includes('COMMIT')); assert.equal(f.notices.length, 0);
});
test('insert failure propagates to WhatsApp transaction owner', async () => {
  const f = fixture({ failInsert: true });
  await assert.rejects(f.run(1951, 'Franco', f.client), /insert failed/);
  assert.ok(!f.queries.includes('RELEASE')); assert.equal(f.notices.length, 0);
});
