import test from 'node:test';
import assert from 'node:assert/strict';
import { SYSTEM_USER_ROLES } from '../../../backend/src/user-roles.js';
import { canUserMoveTask, canUserMoveTaskToState, canUserEditTask, canUserDeleteTask } from '../workspace-task-state.js';

const row = { id: 5, estado: 'pendiente', tipo_tarea: 'edicion', asignado_a_id: 99, colaborador_ids: [],
  propiedades_extra: { workspace: 'render_os', revision_aprobada: false } };
test('all known and authenticated custom roles move any render_os task through four operational states, including direct completion and reopening', () => {
  for (const rol of [...SYSTEM_USER_ROLES, 'editor_externo_qa']) for (const estado of ['pendiente','en_progreso','en_revision','aprobada','finalizada','publicada']) {
    const task = { ...row, estado }, actor = { id: 7, rol, activo: true }, before = JSON.stringify(task);
    assert.equal(canUserMoveTask(task, actor), true);
    for (const next of ['pendiente','en_progreso','en_revision','finalizada']) assert.equal(canUserMoveTaskToState(task, actor, next), true, `${rol}:${estado}->${next}`);
    assert.equal(JSON.stringify(task), before, 'Movement admission cannot manufacture approval or publication metadata');
    assert.equal(canUserMoveTaskToState(task, actor, 'publicada'), false, 'Task alias is read-only, not an actual publication command');
    assert.equal(canUserMoveTaskToState(task, actor, 'programada'), false);
    assert.equal(canUserEditTask(task, actor), rol === 'admin'); assert.equal(canUserDeleteTask(task, actor), rol === 'admin');
  }
});
test('invalid IDs, inactive users and missing/malformed roles never gain state-only access from a matching name or ownership', () => {
  for (const id of [undefined,null,0,-1,'7',7.5,2147483648,true,Infinity]) for (const rol of SYSTEM_USER_ROLES)
    assert.equal(canUserMoveTaskToState(row, { id, rol }, 'finalizada'), false);
  for (const rol of [undefined,null,'','   ',7,{},[],true])
    assert.equal(canUserMoveTaskToState({ ...row, asignado_a_id:7 }, { id:7, rol, nombre:'Franco' }, 'en_progreso'), false);
  assert.equal(canUserMoveTask(row, { id:7, rol:'admin', activo:false }), false);
  for (const rol of ['custom_role_qa','administracion','lider']) assert.equal(canUserMoveTaskToState(row,{id:7,rol,activo:true},'finalizada'),true);
});
test('approval evidence retains explicit admin-review path; production visit completeness remains a domain invariant', () => {
  for (const rol of SYSTEM_USER_ROLES) {
    const actor = { id:7, rol }, visit = { ...row, titulo:'Visita QA', tipo_tarea:'produccion', propiedades_extra:{...row.propiedades_extra,
      produccion_videos_previstos:2, produccion_registros:[{cantidad:1}]} };
    assert.equal(canUserMoveTaskToState(visit,actor,'finalizada'),false);
    assert.equal(canUserMoveTaskToState({...visit,propiedades_extra:{...visit.propiedades_extra,produccion_registros:[{cantidad:2}]}},actor,'finalizada'),true);
    assert.equal(canUserMoveTaskToState({...row,estado:'en_revision'},actor,'aprobada'),rol==='admin');
  }
});
test('broad movement is scoped to render_os, not field edits or other workspaces', () => {
  const actor = { id:7, rol:'edicion' };
  for (const propiedades_extra of [undefined,{}, {workspace:'foreign'}]) assert.equal(canUserMoveTask({...row,propiedades_extra},actor),false);
});
