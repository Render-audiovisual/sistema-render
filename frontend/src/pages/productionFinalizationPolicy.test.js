import test from 'node:test';
import assert from 'node:assert/strict';
import { canUserMoveTaskToState, canUserMoveTask } from '../features/render-os/utils/task-state.js';
import { taskTransitionError } from '../../../backend/src/workflow-contract.js';
const user={id:7,rol:'produccion'};
const task={id:1,asignado_a_id:7,colaborador_ids:[],tipo_tarea:'produccion',subtipo:'coordinacion',titulo:'Coordinar material',estado:'aprobada',propiedades_extra:{workspace:'render_os'}};

test('approved production non-visits cannot be finalized or reopened by a production employee',()=>{
  assert.equal(canUserMoveTaskToState(task,user,'finalizada'),false);
  assert.equal(taskTransitionError(task,'finalizada',user).status,403);
  for(const state of ['finalizada','publicada']) {
    const finished={...task,estado:state};
    assert.equal(canUserMoveTask(finished,user),false);
    assert.equal(canUserMoveTaskToState(finished,user,'pendiente'),false);
    assert.equal(taskTransitionError(finished,'pendiente',user).status,403);
  }
  assert.equal(canUserMoveTaskToState(task,{...user,rol:'admin'},'finalizada'),true);
  assert.equal(canUserMoveTaskToState(task,{...user,rol:'community'},'finalizada'),true);
});

test('an approved but incomplete visit is not offered finalization; complete assigned visits retain it',()=>{
  for(const role of ['produccion','admin','community']) {
    const actor={...user,rol:role};
    const visit={...task,subtipo:'visita',propiedades_extra:{workspace:'render_os',produccion_videos_previstos:2,
      produccion_registros:[{cantidad:1}]}};
    assert.equal(canUserMoveTaskToState(visit,actor,'finalizada'),false);
    visit.propiedades_extra.produccion_registros=[{cantidad:2}];
    assert.equal(canUserMoveTaskToState(visit,actor,'finalizada'),true);
    assert.equal(taskTransitionError(visit,'finalizada',actor),null);
  }
});
