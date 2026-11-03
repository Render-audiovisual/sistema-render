import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isWorkingTask, projectPendingTaskUpdate, isTaskUpdatePending} from '../features/render-os/utils/working-task-view.js';
const source=readFileSync(new URL('./WorkspaceReadOnly.jsx',import.meta.url),'utf8');
const task={id:1,revision:4,estado:'en_revision',propiedades_extra:{workspace:'render_os'}};
test('completion paints immediately without fabricating closure evidence',()=>{
 for(const estado of ['finalizada','publicada']) {
  const projected=projectPendingTaskUpdate(task,{estado});
  assert.equal(projected.estado,estado);
  assert.equal(isTaskUpdatePending(projected),true);
  assert.equal(isWorkingTask(projected),true);
  assert.equal(projected.propiedades_extra.finalizada_at,undefined);
  assert.equal(task.estado,'en_revision');
  assert.equal(isWorkingTask(JSON.parse(JSON.stringify(projected))),false);
 }
});
test('ACK and reverse move preserve visibility and canonical revisions',()=>{
 const confirmed={...task,estado:'finalizada',revision:5,propiedades_extra:{workspace:'render_os',finalizada_at:'2026-11-03T15:00:00.000Z'}};
 assert.equal(isWorkingTask(confirmed),true);
 assert.equal(isTaskUpdatePending(confirmed),false);
 const returning=projectPendingTaskUpdate(confirmed,{estado:'en_revision'});
 assert.equal(isWorkingTask(returning),true);
 assert.equal(returning.estado,'en_revision');
 assert.equal(returning.revision,5);
 assert.equal(isTaskUpdatePending(task),false);
});
test('pending visibility never admits deleted or archived tasks',()=>{
 for(const flag of ['papelera_render_os','archivada_render_os'])
  assert.equal(isWorkingTask(projectPendingTaskUpdate({...task,propiedades_extra:{[flag]:true}},{estado:'finalizada'})),false);
});
test('repeat moves are guarded and auxiliary history cannot block ACK',()=>{
 const update=source.slice(source.indexOf('  const updateTask ='),source.indexOf('  const createTask ='));
 assert.match(update,/projectPendingTaskUpdate\(task, changes\)/);
 assert.doesNotMatch(update,/await logActivity/);
 assert.match(update,/expected_revision: previous.revision/);
 assert.match(source,/orderState.locked \|\| isTaskUpdatePending\(task\)/);
 assert.match(source,/role="status">Guardando…/);
 assert.match(update,/task.id === id \? previous : task/);
});
