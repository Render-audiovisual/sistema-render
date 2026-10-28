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

test('historical non-render_os finalization retains its previous approval and role contract', () => {
  for (const estado of ['pendiente','en_progreso','en_revision']) {
    assert.equal(taskTransitionError({ estado,tipo_tarea:'edicion' }, 'finalizada', {rol:'admin'}).status, 409);
  }
  assert.equal(taskTransitionError({ estado:'aprobada' }, 'finalizada', {rol:'admin'}), null);
  assert.equal(taskTransitionError({ estado:'aprobada' }, 'finalizada', {rol:'community'}), null);
  assert.equal(taskTransitionError({ estado:'aprobada' }, 'finalizada', {rol:'edicion'}).status, 403);
});

for (const rol of ['admin','community','produccion','diseno','edicion','programacion','custom_authenticated_role']) {
  test(`render_os ${rol} completes unapproved work and reopens any work without fabricating approval`, () => {
    const auth = { id: 7, rol, activo: true, session_version: 2 };
    for (const estado of ['pendiente','en_progreso','en_revision','aprobada','finalizada','publicada']) {
      const task = Object.freeze({ id: 30, estado, tipo_tarea: 'edicion',
        propiedades_extra: Object.freeze({ workspace:'render_os' }) });
      for (const next of ['pendiente','en_progreso','en_revision','finalizada']) {
        assert.equal(taskTransitionError(task,next,auth),null,`${estado} -> ${next}`);
        assert.deepEqual(task.propiedades_extra,{workspace:'render_os'});
      }
      assert.equal(task.estado,estado);
    }
  });
}
test('render_os movement rejects missing/invalid IDs, inactive accounts and empty roles even on no-op', () => {
  const task={estado:'pendiente',propiedades_extra:{workspace:'render_os'}};
  for(const auth of [undefined,{}, {id:'7',rol:'admin'}, {id:0,rol:'admin'},
    {id:2147483648,rol:'admin'},{id:7,rol:''},{id:7,rol:' '},{id:7,rol:'edicion',activo:false}])
    for(const state of ['pendiente','finalizada'])assert.equal(taskTransitionError(task,state,auth).status,401);
});
test('shared movement does not grant approval evidence or erase production-specific writer responsibilities', () => {
  const task={estado:'en_revision',tipo_tarea:'produccion',titulo:'Visita de grabación',propiedades_extra:{workspace:'render_os'}};
  assert.equal(taskTransitionError(task,'finalizada',{id:7,rol:'custom_authenticated_role'}),null,
    'Transactional production readiness, not role, determines whether a visit can actually commit');
  assert.equal(taskTransitionError(task,'aprobada',{id:7,rol:'edicion'}).status,403);
  assert.equal(taskTransitionError({...task,estado:'pendiente'},'aprobada',{id:7,rol:'admin'}).status,409);
  assert.equal(taskTransitionError(task,'aprobada',{id:7,rol:'admin'}),null);
});

test('production completion exception is explicit; reopening and legacy inputs retain permission checks', () => {
  assert.equal(taskTransitionError({ estado:'pendiente',tipo_tarea:'produccion',titulo:'Visita de grabación' }, 'finalizada', {rol:'produccion'}), null);
  assert.equal(taskTransitionError({ estado:'pendiente',tipo_tarea:'produccion',titulo:'Organizar material' }, 'finalizada', {rol:'admin'}).status, 409);
  assert.equal(taskTransitionError({ estado:'aprobada',tipo_tarea:'edicion' }, 'publicada', {rol:'edicion'}).status, 403);
  assert.equal(taskTransitionError({ estado:'publicada' }, 'en_progreso', {rol:'edicion'}).status, 403);
  assert.equal(taskTransitionError({ estado:'publicada' }, 'en_progreso', {rol:'admin'}), null);
  assert.equal(taskTransitionError({ estado:'pendiente' }, 'programada', {rol:'admin'}).status, 400);
});
