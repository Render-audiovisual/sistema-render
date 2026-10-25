import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeRelatedTasks} from '../workspace-task-state.js';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

test('a delayed related-task read cannot replace a newer confirmed task revision', async () => {
  let finishRead;
  const pending = new Promise(resolve => { finishRead = resolve; });
  const old = {id:2,revision:1,titulo:'Anterior',estado:'pendiente',tarea_padre_id:1};
  const latest = Object.freeze({...old,revision:2,titulo:'Confirmada',estado:'en_progreso',tarea_padre_id:3});
  let tasks = [old];
  const read = pending.then(items => { tasks = mergeRelatedTasks(tasks,items); });
  tasks = [latest];
  finishRead([old]);
  await read;
  assert.equal(tasks[0],latest);
  assert.equal(tasks[0].tarea_padre_id,3);
});

test('related merges retain membership and newer data without mutating inputs', () => {
  const current = Object.freeze([{id:2,revision:3,titulo:'Current',__renderOsDirectOnly:false}].map(Object.freeze));
  const incoming = Object.freeze([{id:2,revision:2,titulo:'Old'},{id:4,revision:1,titulo:'Child'}].map(Object.freeze));
  const merged = mergeRelatedTasks(current,incoming);
  assert.equal(merged[0],current[0]);
  assert.equal(merged[1].__renderOsDirectOnly,true);
  assert.equal(current.length,1);
  assert.equal(incoming[1].__renderOsDirectOnly,undefined);
  const newer = mergeRelatedTasks(merged,[{id:2,revision:4,titulo:'New'}]);
  assert.equal(newer[0].titulo,'New');
  assert.equal(newer[0].__renderOsDirectOnly,false);
  const equal = mergeRelatedTasks(newer,[{id:2,revision:4,cliente_nombre:'Context'}]);
  assert.equal(equal[0].cliente_nombre,'Context');
  assert.equal(equal[0].titulo,'New');
});

test('the active related-task event uses the latest React state with the revision-aware merge', () => {
  const source = readFileSync(new URL('./WorkspaceReadOnly.jsx',import.meta.url),'utf8');
  const tree = ts.createSourceFile('WorkspaceReadOnly.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  let callback;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree)==='incorporate'
      && node.initializer?.getText(tree).includes('mergeRelatedTasks')) callback=node.initializer;
    ts.forEachChild(node,visit);
  };
  visit(tree); assert.ok(callback);
  const current={id:2,revision:3,estado:'en_revision'};
  let state=[current], publications=0, active=true;
  const handler=Function('guard','tasksRef','markReviewQueueStale','setTasks','mergeRelatedTasks',`return (${callback.getText(tree)});`)(
    {current:()=>active},{current:state},()=>{},updater=>{state=updater(state);publications++;},mergeRelatedTasks);
  handler({detail:[{id:2,revision:1,estado:'pendiente'}]});
  assert.equal(state[0],current);
  active=false;
  handler({detail:[{id:2,revision:4,estado:'finalizada'}]});
  assert.equal(publications,1); assert.equal(state[0],current);
});
