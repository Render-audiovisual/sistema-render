import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {resolveTaskSubtasks} from './taskSubtaskObservation.js';

const row=extra=>({id:8,revision:2,tarea_padre_id:7,titulo:'Observed child',estado:'future_state',...extra});
test('null and verified empty observations never borrow membership from the global board cache',()=>{
  const tasks=Object.freeze([Object.freeze(row())]);
  assert.deepEqual(resolveTaskSubtasks(null,tasks,7),[]);assert.deepEqual(resolveTaskSubtasks([],tasks,7),[]);
  assert.equal(tasks.length,1);
});
test('same-parent global observations replace only matching IDs at an equal/newer valid revision',()=>{
  const original=row(),observed=[original];
  for(const revision of [2,3,2147483647]){
    const current=row({revision,titulo:'Current'}),foreign=row({id:9});
    const result=resolveTaskSubtasks(observed,[current,foreign],7);assert.equal(result.length,1);assert.equal(result[0],current);
  }
  for(const revision of [undefined,null,0,-1,1,'3',3.1,2147483648]){
    assert.equal(resolveTaskSubtasks(observed,[row({revision,titulo:'Not authoritative'})],7)[0],original);
  }
});
test('only strictly newer global reparenting removes an observed member; missing/older/equal keeps it',()=>{
  const original=row();
  assert.equal(resolveTaskSubtasks([original],[],7)[0],original,'Paginated cache absence is not deletion');
  for(const revision of [1,2])assert.equal(resolveTaskSubtasks([original],[row({revision,tarea_padre_id:99})],7)[0],original);
  for(const tarea_padre_id of [99,null])assert.deepEqual(resolveTaskSubtasks([original],[row({revision:3,tarea_padre_id})],7),[]);
});
test('resolution preserves observed order, references and all input fields without mutating or deleting global rows',()=>{
  const a=Object.freeze(row()),b=Object.freeze(row({id:9})),extra=Object.freeze(row({id:10}));
  const observed=Object.freeze([b,a]),tasks=Object.freeze([a,extra,b]),before=JSON.stringify({observed,tasks});
  const result=resolveTaskSubtasks(observed,tasks,7);assert.deepEqual(result,[b,a]);assert.equal(result[0],b);assert.equal(result[1],a);
  assert.equal(JSON.stringify({observed,tasks}),before);assert.equal(tasks.length,3);
});

const source=readFileSync(new URL('./WorkspaceReadOnly.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('WorkspaceReadOnly.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function nodes(root,predicate){const result=[];function walk(node){if(predicate(node))result.push(node);ts.forEachChild(node,walk);}walk(root);return result;}
const detail=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='TaskDetail');assert.ok(detail);
const declaration=name=>nodes(detail,node=>ts.isVariableDeclaration(node)&&node.name.getText(tree)===name)[0];
test('actual TaskDetail binds membership observation to task and captured session owner before resolving cache rows',()=>{
  assert.equal(tree.parseDiagnostics.length,0);
  const observation=declaration('observedSubtasks'),subtasks=declaration('subtasks');assert.ok(observation&&subtasks);
  const captured=()=>{},other=()=>{},items=[row()];
  for(const subtaskObservation of [null,{taskId:99,captureRequest:captured,items},{taskId:7,captureRequest:other,items},{taskId:7,captureRequest:captured,items}]){
    const observed=Function('subtaskObservation','task','captureRequest',`return (${observation.initializer.getText(tree)});`)(subtaskObservation,{id:7},captured);
    assert.equal(observed,subtaskObservation?.taskId===7&&subtaskObservation.captureRequest===captured?items:null);
  }
  assert.equal(subtasks.initializer.getText(tree),'resolveTaskSubtasks(observedSubtasks,tasks,task.id)');
});
test('actual organization offers explicit refresh and only verified idle success claims an empty collection',()=>{
  const section=nodes(detail,node=>ts.isJsxElement(node)&&node.openingElement.tagName.getText(tree)==='section'
    &&node.openingElement.attributes.properties.some(attr=>attr.name?.getText(tree)==='className'&&attr.initializer?.text==='ros-work-block ros-work-organization'))[0];assert.ok(section);
  const compiled=ts.transpileModule(`const result=(${section.getText(tree)});`,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
  for(const [observation,state,empty] of [[null,{loading:true,error:''},false],[null,{loading:false,error:'Failed'},false],
    [[],{loading:true,error:''},false],[[],{loading:false,error:'Failed'},false],[[],{loading:false,error:''},true]]){
    const deps={React,origin:null,task:{id:7},subtaskRead:state,observedSubtasks:observation,subtasks:[],retrySubtasks(){},onOpen(){},STATUSES:[],canonicalTaskState:value=>value,formatDate:()=>''};
    const element=Function(...Object.keys(deps),`${compiled}\nreturn result;`)(...Object.values(deps)),html=renderToStaticMarkup(element);
    assert.equal(html.includes('Sin subtareas registradas.'),empty);
    assert.equal(html.includes('Actualizar subtareas'),!state.error);assert.equal(html.includes('Reintentar subtareas'),Boolean(state.error));
    assert.equal((html.match(/class="btn(?: disabled)?"/g)||[]).length,1,'Same single refresh action survives loading/error/empty');
    assert.equal(html.includes('aria-disabled="true"'),state.loading);assert.doesNotMatch(html,/\sdisabled=""/);
  }
  assert.doesNotMatch(detail.getText(tree),/addEventListener\(['"]render-os:related-tasks/,'No implicit refresh loop on its own read publication');
});
