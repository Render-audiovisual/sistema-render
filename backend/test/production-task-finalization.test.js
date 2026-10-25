import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProductionTaskFinalization } from '../src/production-task-finalization.js';

const task = { id: 7, tipo_tarea: 'produccion', titulo: 'Visita', propiedades_extra: { produccion_videos_previstos: 3 } };
function fixture(states, linked = true) {
  const calls = [];
  return { calls, query: async (sql, values) => {
    calls.push({ sql, values });
    return { rows: sql.includes('FROM produccion_visitas') ? (linked ? [{ id: 'visit' }] : []) : states.map(estado => ({ estado })) };
  } };
}
test('canonical completion uses identified recorded videos, not legacy counts or completion markers', async () => {
  for (const states of [[], ['grabado'], ['grabado','grabado','pendiente'], ['grabado','grabado','repetir'], ['grabado','grabado','planificado']]) {
    const db = fixture(states);
    await assert.rejects(assertProductionTaskFinalization(db, { ...task, propiedades_extra: { ...task.propiedades_extra,
      produccion_finalizada_at: '2026-10-01', produccion_registros: [{ cantidad: 99 }] } }), { status: 400 });
    assert.match(db.calls[0].sql, /FOR UPDATE/);
    assert.deepEqual(db.calls[0].values, [7]);
    assert.deepEqual(db.calls[1].values, ['visit']);
  }
  for (const count of [3,4]) await assertProductionTaskFinalization(fixture(Array(count).fill('grabado')), task);
  await assertProductionTaskFinalization(fixture(['grabado']), { ...task, propiedades_extra: {} });
});
test('unlinked legacy completion retains aggregate rule; other task types do not query production', async () => {
  await assert.rejects(assertProductionTaskFinalization(fixture([], false), task), { status: 400 });
  const db = fixture([], false);
  await assertProductionTaskFinalization(db, { ...task, propiedades_extra: { ...task.propiedades_extra, produccion_registros: [{ cantidad: 3 }] } });
  assert.equal(db.calls.length, 1);
  const other = fixture([]);
  await assertProductionTaskFinalization(other, { ...task, tipo_tarea: 'edicion' });
  assert.equal(other.calls.length, 0);
});
test('renaming or lowering planned quantity in the finalization patch cannot bypass source readiness', async () => {
  const renamed = { ...task, titulo: 'Material', subtipo: null, tipo_tarea: 'edicion', propiedades_extra: {
    produccion_videos_previstos: 1, produccion_registros: [{ cantidad: 1 }] } };
  await assert.rejects(assertProductionTaskFinalization(fixture([], false), renamed, task), { status: 400 });
  await assert.rejects(assertProductionTaskFinalization(fixture(['grabado']), renamed, task), { status: 400 });
  await assert.rejects(assertProductionTaskFinalization(fixture(['grabado','grabado','grabado']), {
    ...task, propiedades_extra: { produccion_videos_previstos: 4 } }, task), { status: 400 });
});
