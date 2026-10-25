import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { productionTaskClosure, adoptProductionTaskObservation } from './productionTaskClosure.js';
import { canonicalTaskState } from '../features/render-os/constants.js';
const id = '10000000-0000-4000-8000-000000000001';
const task = {id:5,revision:7,titulo:'Visita',tipo_tarea:'produccion',estado:'pendiente',asignado_a_id:8,colaborador_ids:[],
  propiedades_extra:{produccion_videos_previstos:3,produccion_registros:[{cantidad:99}]}};
const actor = {id:8,rol:'produccion'};
const registry = {ready:true,vinculo:{id,tipo:'origen',revision:4,finalizacion:{task_revision:7,previstos:3,grabados:3,total:3,habilitada:true}}};
test('only a complete current server observation offers closure; aggregate metadata is never evidence',()=>{
  const good = productionTaskClosure(task,registry,actor);
  assert.equal(good.complete,true); assert.equal(good.authorized,true);
  assert.deepEqual(good.expected,{id,revision:4}); assert.equal(Object.isFrozen(good.expected),true);
  for (const r of [{ready:false}, {ready:true,vinculo:null}, {...registry,ready:false},
    {ready:true,vinculo:{...registry.vinculo,tipo:'edicion'}},
    {ready:true,vinculo:{...registry.vinculo,finalizacion:undefined}}])
    assert.equal(productionTaskClosure(task,r,actor).complete,false);
  for (const patch of [{task_revision:6},{total:0,grabados:0},{grabados:2},{total:4},{previstos:4},{habilitada:false},
    {habilitada:'true'},{total:'3'},{previstos:-1},{total:NaN}]) {
    const r={ready:true,vinculo:{...registry.vinculo,finalizacion:{...registry.vinculo.finalizacion,...patch}}};
    assert.equal(productionTaskClosure(task,r,actor).complete,false,JSON.stringify(patch));
  }
});
test('role and ID membership remain required; completion does not invent authority',()=>{
  for(const user of [{id:9,rol:'produccion'},{id:8,rol:'diseno'},{rol:'admin'},{nombre:'Franco',rol:'admin'}])
    assert.equal(productionTaskClosure(task,registry,user).authorized,false);
  for(const rol of ['admin','community'])assert.equal(productionTaskClosure(task,registry,{id:9,rol}).authorized,true);
  assert.equal(productionTaskClosure({...task,estado:'finalizada'},registry,actor).finished,true);
});

const file=ts.createSourceFile('WorkspaceReadOnly.jsx',readFileSync(new URL('./WorkspaceReadOnly.jsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function initializer(name){let result;function walk(n){if(ts.isVariableDeclaration(n)&&n.name.getText(file)===name)result=n.initializer;ts.forEachChild(n,walk);}walk(file);assert.ok(result);return result.getText(file);}
function fixture({current=true,dirty=false,busy=false,transport}={}) {
  const calls=[],effects=[],ref={current:false},closure=productionTaskClosure(task,registry,actor);
  const deps={captureRequest:()=>({current:()=>current,assertCurrent:()=>assert.ok(current)}),productionClosingRef:ref,
    productionClosureTaskRef:{current:task.id},taskWriteBusy:busy,taskDraftDirty:dirty,productionClosure:closure,task,
    briefDraftOwner:{current:{generation:0,baseline:task}},adoptProductionTaskObservation,canonicalTaskState,
    getUnifiedTaskContent:()=>'',setDraft:v=>effects.push(['draft',v]),setEditing:v=>effects.push(['editing',v]),
    onUpdate:async(...args)=>{calls.push(args);return transport?transport(...args):{...task,revision:8,estado:'finalizada'};},
    setClosingProduction:v=>effects.push(['busy',v]),setProductionCloseError:v=>effects.push(['error',v])};
  return {calls,effects,deps,run:()=>Function(...Object.keys(deps),`return (${initializer('closeRecordedProduction')});`)(...Object.values(deps))(),retire:()=>{current=false;}};
}
test('actual close handler captures exact visit/task versions once and blocks duplicate submission',async()=>{
  let finish;const pending=new Promise(resolve=>{finish=resolve;});const h=fixture({transport:()=>pending});
  const first=h.run();await h.run();assert.equal(h.calls.length,1);
  assert.deepEqual(h.calls[0],[5,{estado:'finalizada',expected_production_visit:{id,revision:4}},'finalizó la visita de producción',7]);
  h.deps.productionClosure.expected={id,revision:99};finish({...task,revision:8,estado:'finalizada'});await first;
  assert.equal(h.calls[0][1].expected_production_visit.revision,4);
  assert.equal(h.deps.productionClosingRef.current,false);
  assert.equal(h.effects.find(([key])=>key==='draft')[1].estado,'finalizada');
  assert.equal(h.deps.briefDraftOwner.current.baseline.revision,8);
});
test('actual close handler refuses dirty/busy/retired/incomplete/unauthorized views',async()=>{
  for(const opts of [{dirty:true},{busy:true},{current:false}]){const h=fixture(opts);await h.run();assert.equal(h.calls.length,0);}
  for(const key of ['complete','authorized']){const h=fixture();h.deps.productionClosure[key]=false;await h.run();assert.equal(h.calls.length,0);}
  const h=fixture();h.deps.productionClosure.finished=true;await h.run();assert.equal(h.calls.length,0);
});
test('conflict or unknown outcome never retries or silently replaces the observation',async()=>{
  for(const status of [409,undefined]){
    const h=fixture({transport:async()=>{throw Object.assign(new Error('no ack'),{status});}});
    await h.run();assert.equal(h.calls.length,1);assert.ok(h.effects.some(([key,value])=>key==='error'&&value.includes('Actualizá')));
  }
});
test('explicit refresh reads only, rejects stale/foreign acknowledgments, and ignores a retired task',async()=>{
  for(const result of [{...task,revision:8},{...task,id:99},{...task,revision:6}]) {
    const events=[],effects=[],calls=[];
    const deps={task,productionClosureTaskRef:{current:task.id},productionClosingRef:{current:false},taskWriteBusy:false,taskDraftDirty:false,
      captureRequest:()=>({current:()=>true,options:()=>({scope:'captured'})}),
      briefDraftOwner:{current:{generation:0,baseline:task}},adoptProductionTaskObservation,
      getUnifiedTaskContent:()=>'',setDraft:v=>effects.push(['draft',v]),setEditing:v=>effects.push(['editing',v]),
      apiTaskById:async(...args)=>{calls.push(args);return result;},
      window:{dispatchEvent:event=>events.push(event)},CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}},
      setClosingProduction:v=>effects.push(['busy',v]),setRegistryLookup:v=>effects.push(['lookup',v]),
      setRegistryRetry:v=>effects.push(['retry',v(0)]),setProductionCloseError:v=>effects.push(['error',v])};
    await Function(...Object.keys(deps),`return (${initializer('refreshProductionClosure')});`)(...Object.values(deps))();
    assert.deepEqual(calls,[[5,{scope:'captured'}]]);
    assert.equal(events.length,result.id===5&&result.revision>=7?1:0);
    assert.equal(deps.productionClosingRef.current,false);
  }
  let resolve;const waiting=new Promise(done=>{resolve=done;});const h=fixture({transport:()=>waiting});
  const pending=h.run();h.retire();resolve();await pending;
  assert.equal(h.effects.filter(([key])=>key==='busy').length,1,'Late ACK cannot publish UI state into retired identity');
});
test('closing or refresh acknowledgement adopts a clean draft but never overwrites edits made while waiting',async()=>{
  let finish;const pending=new Promise(resolve=>{finish=resolve;});const h=fixture({transport:()=>pending});
  const running=h.run();h.deps.briefDraftOwner.current.generation++;
  finish({...task,revision:8,estado:'finalizada'});await running;
  assert.equal(h.effects.some(([key])=>key==='draft'),false);
  assert.equal(h.deps.briefDraftOwner.current.baseline.revision,7);
  const owner={generation:2,baseline:task},adopted=[];
  assert.throws(()=>adoptProductionTaskObservation({...task,id:9},{taskId:5,minRevision:7,owner,generation:2,currentOwner:owner},v=>adopted.push(v)));
  assert.equal(adopted.length,0);
});
