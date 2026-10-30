import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('./CalendarLinkedTask.jsx',import.meta.url),'utf8');
const file=ts.createSourceFile('CalendarLinkedTask.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
let effect;const walk=node=>{if(ts.isCallExpression(node)&&node.expression.getText(file)==='useEffect')effect=node.arguments[0];ts.forEachChild(node,walk);};walk(file);
const compiled=ts.transpileModule(`const effect=${effect.getText(file)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function fixture(){
  let resolve,reject,current=true;const results=[],ids=[],calls=[];
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  const deps={event:{source_id:12},capture:()=>({current:()=>current,request:(url,options)=>{calls.push({url,options});return promise;}}),AbortController,
    setResult:value=>results.push(value),setTaskId:id=>ids.push(id),isSessionFailure:reason=>reason.status===401};
  const cleanup=new Function(...Object.keys(deps),`${compiled};return effect();`)(...Object.values(deps));
  return {resolve,reject,results,ids,calls,cleanup,retire:()=>{current=false;}};
}
const settle=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
test('single linked task opens automatically using its real ID and GET-only lookup',async()=>{
  const f=fixture();f.resolve([{id:42,titulo:'Edición real'}]);await settle();
  assert.deepEqual(f.ids,[42]);assert.equal(f.calls[0].url,'/api/publicaciones/12/tareas');assert.equal(f.calls[0].options.cache,'no-store');assert.equal(f.calls[0].options.method,undefined);f.cleanup();
});
test('multiple linked tasks require an explicit choice; absent task is honest and creates nothing',async()=>{
  for(const tasks of [[],[{id:1,titulo:'A'},{id:2,titulo:'B'}]]){const f=fixture();f.resolve(tasks);await settle();assert.deepEqual(f.ids,[]);assert.deepEqual(f.results.at(-1).tasks,tasks);assert.equal(f.results.at(-1).status,'ready');f.cleanup();}
});
test('late linkage response after close or session replacement cannot open any task',async()=>{
  for(const retire of [false,true]){const f=fixture();if(retire)f.retire();else f.cleanup();f.resolve([{id:42,titulo:'A'}]);await settle();assert.deepEqual(f.ids,[]);assert.equal(f.results.length,1);}
});
test('invalid linkage response or error does not fabricate task IDs',async()=>{
  for(const invalid of [null,[{id:-1,titulo:'A'}],[{id:1}]]){const f=fixture();f.resolve(invalid);await settle();assert.deepEqual(f.ids,[]);assert.equal(f.results.at(-1).status,'error');f.cleanup();}
});
test('shared task window stays available independently but publication agenda no longer opens it',()=>{
  assert.match(source,/detailOnlyTaskId=\{taskId\}/);assert.doesNotMatch(source,/history\.|location\.|method:.*(?:POST|PATCH|DELETE)/);
  const calendar=readFileSync(new URL('./Calendar.jsx',import.meta.url),'utf8');assert.doesNotMatch(calendar,/CalendarLinkedTask|setOpenedPublication/);
  const workspace=readFileSync(new URL('./WorkspaceReadOnly.jsx',import.meta.url),'utf8');assert.match(workspace,/if\(detailOnlyTaskId !== null\)/);assert.match(workspace,/onUpdate=\{updateTask\}/);
  const css=readFileSync(new URL('./Calendar.css',import.meta.url),'utf8');assert.match(css,/\.principal-calendar-grid>button\{border:1px solid/);
});
