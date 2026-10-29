import test from 'node:test';
import assert from 'node:assert/strict';
import { WORKING_BOARD_COLUMNS, STATUSES } from '../constants.js';
import { getWorkingTaskViewState, isWorkingTask } from './working-task-view.js';
import { buildTaskPageUrl } from '../services/render-os-api.js';

test('daily board has only three columns while finalization remains available', () => {
  assert.deepEqual(WORKING_BOARD_COLUMNS.map(c => c.id), ['pendiente', 'en_progreso', 'en_revision']);
  assert.ok(STATUSES.some(s => s.id === 'finalizada'));
});
test('stale completed/trash links return to live work without changing records', () => {
  const state = getWorkingTaskViewState('?mode=trash&estado=finalizada&board_column=finalizadas&client=17&task=2');
  assert.equal(state.archiveMode, 'active'); assert.equal(state.status, 'all');
  assert.equal(state.boardColumn, 'pendiente'); assert.equal(state.client, '17');
});
test('finished, historical published and archived/trash records never enter any working view', () => {
  for (const estado of ['finalizada', 'publicada', 'unknown', undefined]) assert.equal(isWorkingTask({ estado }), false);
  for (const estado of ['pendiente', 'en_progreso', 'en_revision', 'aprobada']) {
    const task = { estado, propiedades_extra: {} }, before = structuredClone(task);
    assert.equal(isWorkingTask(task), true); assert.deepEqual(task, before);
    for (const flag of ['archivada_render_os', 'papelera_render_os']) for (const value of [true, 'true'])
      assert.equal(isWorkingTask({ ...task, propiedades_extra: { [flag]: value } }), false);
  }
});
test('pagination scope travels to server on first and subsequent manual pages', () => {
  for (const offset of [0, 50]) {
    const url = new URL(buildTaskPageUrl({ workOnly: true, offset, sort: 'manual', ...(offset ? { expectedSnapshot: 'a'.repeat(64) } : {}) }), 'https://render.test');
    assert.equal(url.searchParams.get('trabajo_pendiente'), 'true');
    assert.equal(url.searchParams.get('offset'), String(offset));
  }
  assert.equal(new URL(buildTaskPageUrl(), 'https://render.test').searchParams.has('trabajo_pendiente'), false);
});
