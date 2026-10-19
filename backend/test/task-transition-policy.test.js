import test from 'node:test';
import assert from 'node:assert/strict';
import { TASK_STATES, normalizeTaskState, taskTransitionError } from '../src/workflow-contract.js';

test('five task work states remain independent from editorial publication', () => {
  assert.deepEqual(Object.values(TASK_STATES), ['pendiente','en_progreso','en_revision','aprobada','finalizada']);
  assert.equal(normalizeTaskState('publicada'), 'finalizada');
  const historical = { estado: 'publicada', fecha_publicación_real: null };
  taskTransitionError(historical, 'en_revision', { rol: 'admin' });
  assert.deepEqual(historical, { estado: 'publicada', fecha_publicación_real: null });
});

test('approval is admin-only and requires actual review state', () => {
  for (const rol of ['diseno','edicion','produccion','community','programacion','lider']) {
    assert.equal(taskTransitionError({ estado:'en_revision' }, 'aprobada', {rol}).status, 403);
  }
  assert.equal(taskTransitionError({ estado:'pendiente' }, 'aprobada', {rol:'admin'}).status, 409);
  assert.equal(taskTransitionError({ estado:'en_revision' }, 'aprobada', {rol:'admin'}), null);
});

test('ordinary finalization requires approved work even for admins', () => {
  for (const estado of ['pendiente','en_progreso','en_revision']) {
    assert.equal(taskTransitionError({ estado,tipo_tarea:'edicion' }, 'finalizada', {rol:'admin'}).status, 409);
  }
  assert.equal(taskTransitionError({ estado:'aprobada' }, 'finalizada', {rol:'admin'}), null);
  assert.equal(taskTransitionError({ estado:'aprobada' }, 'finalizada', {rol:'community'}), null);
  assert.equal(taskTransitionError({ estado:'aprobada' }, 'finalizada', {rol:'edicion'}).status, 403);
});

test('production completion exception is explicit; reopening and legacy inputs retain permission checks', () => {
  assert.equal(taskTransitionError({ estado:'pendiente',tipo_tarea:'produccion',titulo:'Visita de grabación' }, 'finalizada', {rol:'produccion'}), null);
  assert.equal(taskTransitionError({ estado:'pendiente',tipo_tarea:'produccion',titulo:'Organizar material' }, 'finalizada', {rol:'admin'}).status, 409);
  assert.equal(taskTransitionError({ estado:'aprobada',tipo_tarea:'edicion' }, 'publicada', {rol:'edicion'}).status, 403);
  assert.equal(taskTransitionError({ estado:'publicada' }, 'en_progreso', {rol:'edicion'}).status, 403);
  assert.equal(taskTransitionError({ estado:'publicada' }, 'en_progreso', {rol:'admin'}), null);
  assert.equal(taskTransitionError({ estado:'pendiente' }, 'programada', {rol:'admin'}).status, 400);
});
