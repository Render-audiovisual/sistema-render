import test from 'node:test';
import assert from 'node:assert/strict';
import {BOARD_COLUMNS} from '../features/render-os/constants.js';
import {getTaskViewState,updateTaskViewUrl,taskQueryNotice} from '../features/render-os/utils/task-view-state.js';
import {buildTaskPageUrl} from '../features/render-os/services/render-os-api.js';

test('compact column roundtrips every actual presentation ID independently of estado and review scope',()=>{
  for(const column of BOARD_COLUMNS){
    const source=`https://render.test/workspace/tareas?view=board&sort=manual&client=27&responsible=id:91003&estado=en_revision&task=8&opaque=retained&board_column=${column.id}#detail`;
    const state=getTaskViewState(new URL(source).search);
    assert.equal(state.boardColumn,column.id);assert.equal(state.status,'en_revision');
    const url=updateTaskViewUrl(source,state),restored=getTaskViewState(url.search);
    assert.deepEqual(restored,state);assert.equal(url.searchParams.get('task'),'8');
    assert.equal(url.searchParams.get('opaque'),'retained');assert.equal(url.hash,'#detail');
    assert.equal(url.searchParams.get('board_column'),column.id==='pendiente'?null:column.id);
    assert.equal(url.searchParams.get('estado'),'en_revision');
  }
});
test('invalid, empty and duplicate columns normalize only presentation, never infer publication or server filters',()=>{
  for(const search of ['', '?board_column=', '?board_column=finalizada','?board_column=publicada',
    '?board_column=unknown','?board_column=en_progreso&board_column=en_progreso',
    '?board_column=en_revision&board_column=pendiente','?board_column=%20en_revision',
    '?board_column=%3Cscript%3E']){
    const state=getTaskViewState(search);assert.equal(state.boardColumn,'pendiente');assert.equal(state.status,'all');
    const url=updateTaskViewUrl(`https://render.test/workspace/tareas${search}`,state);
    assert.equal(url.searchParams.has('board_column'),false);assert.equal(taskQueryNotice(state,'diseno'),'');
  }
});
test('view/filter changes retain compact presentation and unrelated deep-link context; explicit reset removes it',()=>{
  const source='https://render.test/workspace/tareas?board_column=finalizadas&task=9&client=4#comments';
  const state=getTaskViewState(new URL(source).search);
  for(const view of ['board','list','calendar','clients','responsibles']){
    const next=updateTaskViewUrl(source,{...state,view,query:'QA exact context',status:'en_progreso'});
    assert.equal(next.searchParams.get('board_column'),'finalizadas');assert.equal(next.searchParams.get('task'),'9');assert.equal(next.hash,'#comments');
    assert.equal(getTaskViewState(next.search).status,'en_progreso');
  }
  const partial={...state};delete partial.boardColumn;
  assert.equal(updateTaskViewUrl(source,partial).searchParams.get('board_column'),'finalizadas');
  assert.equal(updateTaskViewUrl(source,{...state,boardColumn:'pendiente'}).searchParams.has('board_column'),false);
  for(const value of [null,{},'finalizada','unknown'])assert.equal(updateTaskViewUrl(source,{...state,boardColumn:value}).searchParams.has('board_column'),false);
});
test('column restore is URL-scoped with no implicit preference when a fresh URL omits it',()=>{
  const a=getTaskViewState('?board_column=en_progreso&responsible=id:91001');
  const b=getTaskViewState('?responsible=id:91004');
  assert.equal(a.boardColumn,'en_progreso');assert.equal(b.boardColumn,'pendiente');
  assert.equal(getTaskViewState('?board_column=aprobada&review_scope=personal').status,'en_revision');
  assert.equal(getTaskViewState('?board_column=aprobada&review_scope=personal').boardColumn,'aprobada');
});
test('actual task API serializer ignores presentation column and preserves explicit server state filter',()=>{
  const settings={sort:'manual',status:'en_revision',reviewScope:'',responsible:'id:91003',client:'27'};
  const baseline=buildTaskPageUrl(settings);
  for(const column of BOARD_COLUMNS){
    assert.equal(buildTaskPageUrl({...settings,boardColumn:column.id}),baseline);
    const parsed=new URL(buildTaskPageUrl({...settings,board_column:column.id}),'https://render.test');
    assert.equal(parsed.searchParams.get('estado'),'en_revision');
    assert.equal(parsed.searchParams.has('board_column'),false);
  }
});
