import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProductionTaskFinalization, normalizeExpectedProductionVisit } from '../src/production-task-finalization.js';
import { canEmployeePatchTask } from '../src/task-access.js';
const observation = { id: '11111111-2222-4333-8444-555555555555', revision: 5 };

const task = { id: 7, revision: 3, tipo_tarea: 'produccion', titulo: 'Visita', propiedades_extra: { produccion_videos_previstos: 3 } };
function fixture(states, linked = true) {
  const calls = [];
  return { calls, query: async (sql, values) => {
    calls.push({ sql, values });
    return { rows: sql.includes('FROM produccion_visitas') ? (linked ? [observation] : []) : states.map(estado => ({ estado })) };
  } };
}
test('canonical completion uses identified recorded videos, not legacy counts or completion markers', async () => {
  for (const states of [[], ['grabado'], ['grabado','grabado','pendiente'], ['grabado','grabado','repetir'], ['grabado','grabado','planificado']]) {
    const db = fixture(states);
    await assert.rejects(assertProductionTaskFinalization(db, { ...task, propiedades_extra: { ...task.propiedades_extra,
      produccion_finalizada_at: '2026-10-01', produccion_registros: [{ cantidad: 99 }] } }, task, observation), { status: 400 });
    assert.match(db.calls[0].sql, /FOR UPDATE/);
    assert.deepEqual(db.calls[0].values, [7]);
    assert.deepEqual(db.calls[1].values, [observation.id]);
  }
  for (const count of [3,4]) await assertProductionTaskFinalization(fixture(Array(count).fill('grabado')), task, task, observation);
  const unplanned = { ...task, propiedades_extra: {} };
  await assertProductionTaskFinalization(fixture(['grabado']), unplanned, unplanned, observation);
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
  await assert.rejects(assertProductionTaskFinalization(fixture(['grabado']), renamed, task, observation), { status: 400 });
  await assert.rejects(assertProductionTaskFinalization(fixture(['grabado','grabado','grabado']), {
    ...task, propiedades_extra: { produccion_videos_previstos: 4 } }, task, observation), { status: 400 });
});

test('visit observation is closed UUID/positive integer, normalized and frozen', () => {
  assert.equal(normalizeExpectedProductionVisit(undefined), null);
  const normalized = normalizeExpectedProductionVisit({ ...observation, id: observation.id.toUpperCase() });
  assert.deepEqual(normalized, observation); assert.equal(Object.isFrozen(normalized), true);
  for (const value of [null, [], {}, { ...observation, extra: true }, { revision: 5 }, { id: observation.id },
    { ...observation, id: 'visit' }, { ...observation, id: observation.id + '\n' },
    ...[0, -1, 1.5, '5', true, Number.MAX_SAFE_INTEGER + 1].map(revision => ({ ...observation, revision }))])
    assert.throws(() => normalizeExpectedProductionVisit(value), { status: 400 });
});
test('canonical missing observation is400 and mismatched ID/revision409 before media lookup', async () => {
  for (const [expected, status] of [[undefined, 400], [{ ...observation, revision: 4 }, 409],
    [{ ...observation, id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }, 409]]) {
    const db = fixture(['grabado', 'grabado', 'grabado']);
    await assert.rejects(assertProductionTaskFinalization(db, task, task, expected), { status });
    assert.equal(db.calls.length, 1); assert.match(db.calls[0].sql, /SELECT id,revision.*FOR UPDATE/);
  }
});
test('an observation cannot manufacture a binding on legacy or a nonproduction task', async () => {
  await assert.rejects(assertProductionTaskFinalization(fixture([], false), task, task, observation), { status: 409 });
  const other = { ...task, tipo_tarea: 'edicion' }, db = fixture([]);
  await assert.rejects(assertProductionTaskFinalization(db, other, other, observation), { status: 409 });
  assert.equal(db.calls.length, 0);
});
test('employee render_os state patch admits observation field without granting historical business edits', () => {
  const body = { estado: 'finalizada', expected_revision: 3, expected_production_visit: observation };
  assert.equal(canEmployeePatchTask(body, { workspace: 'render_os', role: 'produccion' }), true);
  assert.equal(canEmployeePatchTask(body, { workspace: 'historical', role: 'produccion' }), false);
});
