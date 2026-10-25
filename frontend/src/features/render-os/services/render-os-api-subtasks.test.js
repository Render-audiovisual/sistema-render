import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {apiSubtasks} from './render-os-api.js';
import {requireTaskSubtaskParentId,verifyTaskSubtasks} from './task-subtask-collection.js';

const parent=7,row=extra=>({id:8,revision:1,tarea_padre_id:parent,titulo:'QA child',estado:'pendiente',...extra});
const invalidIds=[undefined,null,0,-1,1.5,'7',true,{},[],NaN,Infinity,2147483648,Number.MAX_SAFE_INTEGER];
const invalidRows=[null,[],{},row({id:0}),row({id:'8'}),row({id:parent}),row({id:2147483648}),
  row({revision:0}),row({revision:-1}),row({revision:'1'}),row({revision:1.5}),row({revision:2147483648}),
  row({tarea_padre_id:9}),row({tarea_padre_id:'7'}),row({tarea_padre_id:null}),
  row({titulo:{text:'not string'}}),row({titulo:null}),row({estado:[]}),row({estado:undefined})];

test('pure validator preserves original array/rows/all fields, empty history text and future states without mutation',()=>{
  const empty=Object.freeze([]);assert.equal(verifyTaskSubtasks(empty,parent),empty);
  const nested=Object.freeze({future:'retained'});
  const rows=Object.freeze([Object.freeze(row({titulo:'',estado:'',future:nested})),
    Object.freeze(row({id:9,revision:2147483647,titulo:'  Historical title  ',estado:'future_state',propiedades_extra:nested}))]);
  const before=JSON.stringify(rows);assert.equal(verifyTaskSubtasks(rows,parent),rows);
  assert.equal(verifyTaskSubtasks(rows,parent)[0],rows[0]);assert.equal(rows[0].future,nested);assert.equal(JSON.stringify(rows),before);
  assert.equal(requireTaskSubtaskParentId(1),1);assert.equal(requireTaskSubtaskParentId(2147483647),2147483647);
});

test('pure validator rejects invalid parent, foreign/self/duplicate or malformed rows as a whole, never filtering',()=>{
  for(const id of invalidIds){assert.throws(()=>requireTaskSubtaskParentId(id));assert.throws(()=>verifyTaskSubtasks([],id));}
  for(const input of [null,{},'[]',false,7])assert.throws(()=>verifyTaskSubtasks(input,parent));
  for(const invalid of invalidRows){
    const items=[row({id:10}),invalid],before=structuredClone(items);
    assert.throws(()=>verifyTaskSubtasks(items,parent));assert.deepEqual(items,before);
  }
  const duplicate=[row(),row({titulo:'Same ID, another title'})];assert.throws(()=>verifyTaskSubtasks(duplicate,parent));
});

async function fetchFixture(body,run){
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>body};};
  try{await run(calls);}finally{globalThis.fetch=original;}
}
test('actual apiSubtasks rejects invalid parent before any fetch and preserves caller options for valid reads',async()=>{
  await fetchFixture([],async calls=>{
    for(const id of invalidIds)await assert.rejects(apiSubtasks(id));assert.equal(calls.length,0);
    const options={signal:new AbortController().signal,cache:'no-store'},items=await apiSubtasks(parent,options);
    assert.deepEqual(items,[]);assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/tareas/7/subtareas?workspace=render_os');
    assert.equal(calls[0].options,options);
  });
});
test('actual apiSubtasks rejects the whole malformed collection with one request and returns valid original references',async()=>{
  for(const items of invalidRows.map(invalid=>[row({id:10}),invalid]).concat([[row(),row()]], [null,{},'[]'])){
    await fetchFixture(items,async calls=>{await assert.rejects(apiSubtasks(parent));assert.equal(calls.length,1);});
  }
  const items=[row({titulo:'',estado:'future_state'}),row({id:9,estado:''})];
  await fetchFixture(items,async calls=>{assert.equal(await apiSubtasks(parent),items);assert.equal(calls.length,1);});
});

const source=readFileSync(new URL('../../../pages/WorkspaceReadOnly.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('WorkspaceReadOnly.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function nodes(root,predicate){const result=[];function walk(node){if(predicate(node))result.push(node);ts.forEachChild(node,walk);}walk(root);return result;}
const declaration=nodes(tree,node=>ts.isVariableDeclaration(node)&&node.name.getText(tree)==='loadSubtasks')[0];assert.ok(declaration);
const callback=declaration.initializer.arguments[0];
const compile=deps=>Function(...Object.keys(deps),`return (${callback.getText(tree)});`)(...Object.values(deps));
test('active callback uses validated API adapter and checks live guard after response before incorporating rows',async()=>{
  assert.equal(tree.parseDiagnostics.length,0);
  const trace=[],items=[row()],options={signal:new AbortController().signal};
  const fn=compile({apiSubtasks:async(id,passed)=>{trace.push(['api',id,passed]);return items;},
    captureRequest:adapter=>({request:async(url,passed)=>{trace.push(['request',url]);return adapter(url,passed);},assertCurrent:()=>trace.push(['guard'])}),
    incorporateRelatedTasks:rows=>trace.push(['merge',rows])});
  assert.equal(await fn(parent,options),items);
  assert.deepEqual(trace,[['request','/api/tareas/7/subtareas?workspace=render_os'],['api',parent,options],['guard'],['merge',items]]);
});
test('active callback cannot merge malformed response, retired guard or aborted request',async()=>{
  for(const mode of ['malformed','retired','aborted']){
    const options={signal:new AbortController().signal};if(mode==='aborted'){const controller=new AbortController();controller.abort();options.signal=controller.signal;}
    const merges=[],reason=new Error('QA obsolete scope');
    const fn=compile({apiSubtasks:async()=>{if(mode==='malformed')return verifyTaskSubtasks([row({tarea_padre_id:99})],parent);return [row()];},
      captureRequest:adapter=>({request:(url,passed)=>adapter(url,passed),assertCurrent:()=>{if(mode==='retired')throw reason;}}),
      incorporateRelatedTasks:items=>merges.push(items)});
    if(mode==='aborted')assert.deepEqual(await fn(parent,options),[row()]);else await assert.rejects(fn(parent,options));
    assert.deepEqual(merges,[]);
  }
});
