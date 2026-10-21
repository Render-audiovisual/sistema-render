import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createProductionCreateIntent} from './productionCreateIntent.js';
import {createCapturedRequest} from '../shared/session/captured-request.js';
import {verifiedProductionDraftVisit} from './productionDraft.js';
const uuid='11111111-1111-4111-8111-111111111111';
const visit={id:uuid,revision:1,cliente_id:7,cliente_nombre:'QA',fecha:'2026-10-20',titulo:'Actual',observaciones:'',drive_url:'',participante_ids:[],videos:[],fotos:[]};
const input=()=>({cliente_id:7,fecha:'2026-10-20',titulo:'Intent',participante_ids:[9],observaciones:'',drive_url:'',tarea_origen_id:null});
function fixture(request){let live={token:'a',usuario:{id:7,rol:'admin',activo:true}},active=true,ids=0,captures=0;const original=live,calls=[];
 const model=createProductionCreateIntent({capture(){captures++;return createCapturedRequest({session:original,readSession:()=>live,isActive:()=>active,request:async()=>{}})},randomUUID:()=>{ids++;return uuid},request:async(body,scope)=>{calls.push({body,scope});return request(body,scope,calls.length)}});
 return{model,calls,get ids(){return ids},get captures(){return captures},switch(){live={token:'b',usuario:{id:8,rol:'admin',activo:true}}},unmount(){active=false}};
}
test('lost response keeps immutable body/UUID/original guard; only explicit verify dispatches again and accepts CURRENT aggregate',async()=>{
 const f=fixture(async(body,scope,n)=>{if(n===1)throw Error('lost response');return{visita:{...visit,revision:8,titulo:'Edited after creation'}}}),data=input();
 await assert.rejects(f.model.submit(data));data.participante_ids.push(99);data.titulo='Changed';
 assert.deepEqual(f.model.snapshot,{locked:true,busy:false,uncertain:true,blocked:false});assert.equal(f.calls.length,1);
 await assert.rejects(f.model.submit(data));assert.equal(f.calls.length,1);
 const result=await f.model.verify();assert.equal(result.revision,8);assert.equal(result.titulo,'Edited after creation');
 assert.equal(f.calls[0].body,f.calls[1].body);assert.equal(f.calls[0].scope,f.calls[1].scope);assert.equal(f.captures,1);assert.equal(f.ids,1);
 assert.deepEqual(JSON.parse(f.calls[1].body),{...input(),request_id:uuid});assert.equal(f.model.snapshot.locked,false);
});
test('malformed full ACK is uncertain, never clears intent; safe400 alone permits corrected new intent',async()=>{
 const malformed=fixture(async()=>({visita:{id:uuid}}));await assert.rejects(malformed.model.submit(input()));assert.equal(malformed.model.snapshot.uncertain,true);
 const f=fixture(async(body,scope,n)=>{if(n===1)throw Object.assign(Error('invalid'),{status:400});return{visita:visit}});
 await assert.rejects(f.model.submit(input()));assert.equal(f.model.snapshot.locked,false);await f.model.submit(input());assert.equal(f.ids,2);
});
test('401/403/collision409 lock manual recovery; session change/unmount never recaptures or resends old payload',async()=>{
 for(const status of [401,403,409]){const f=fixture(async()=>{throw Object.assign(Error('denied'),{status})});await assert.rejects(f.model.submit(input()));assert.equal(f.model.snapshot.blocked,true);await assert.rejects(f.model.verify());assert.equal(f.calls.length,1)}
 for(const action of ['switch','unmount']){const f=fixture(async()=>{throw Error('lost')});await assert.rejects(f.model.submit(input()));f[action]();await assert.rejects(f.model.verify(),{code:'session_binding_obsolete'});assert.equal(f.calls.length,1);assert.equal(f.captures,1)}
});
test('synchronous busy guard denies duplicate submission/verification; no secure UUID means zero dispatch',async()=>{
 let resolve;const f=fixture(()=>new Promise(yes=>{resolve=yes})),pending=f.model.submit(input());assert.equal(f.model.snapshot.busy,true);
 await assert.rejects(f.model.submit(input()));await assert.rejects(f.model.verify());assert.equal(f.calls.length,1);resolve({visita:visit});await pending;
 for(const randomUUID of [()=>{throw Error('unavailable')},()=> 'insecure',()=>`${uuid}\n`]){let calls=0;const model=createProductionCreateIntent({capture:()=>({assertCurrent(){}}),request:()=>{calls++},randomUUID});await assert.rejects(model.submit(input()));assert.equal(calls,0);assert.equal(model.snapshot.locked,false)}
});
test('pending response body remains bound to original session/lifetime and cannot become a verified success',async()=>{
 for(const action of ['switch','unmount']){
  let resolve;const f=fixture(()=>new Promise(yes=>{resolve=yes})),pending=f.model.submit(input());
  f[action]();resolve({visita:visit});await assert.rejects(pending,{code:'session_binding_obsolete'});
  assert.equal(f.model.snapshot.locked,true);assert.equal(f.model.snapshot.blocked,true);
  await assert.rejects(f.model.verify());assert.equal(f.calls.length,1);assert.equal(f.captures,1);
 }
});
const source=readFileSync(new URL('./Productions.jsx',import.meta.url),'utf8'),file=ts.createSourceFile('Productions.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function callback(name,deps){let found;function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(file)===name)found=node.initializer;ts.forEachChild(node,visit)}visit(file);return new Function(...Object.keys(deps),`return (${found.getText(file)});`)(...Object.values(deps))}
test('actual create transport validates full ACK before returning; stale session cannot paint or acknowledge',async()=>{
 for(const malformed of [false,true]){const effects=[],guard={assertCurrent(){},current:()=>true,request:async()=>malformed?{visita:{id:uuid}}:{visita:visit}},deps={writeLock:{current:false},setBusy:value=>effects.push(value),verifiedProductionDraftVisit};
  const create=callback('createVisit',deps);if(malformed)await assert.rejects(create('{}',guard));else assert.equal(await create('{}',guard),visit);
  assert.deepEqual(effects,[true,false]);assert.equal(deps.writeLock.current,false);
 }
 let resolve,active=true;const effects=[],guard={assertCurrent(){if(!active)throw Error('obsolete')},current:()=>active,request:()=>new Promise(yes=>{resolve=yes})};
 const create=callback('createVisit',{writeLock:{current:false},setBusy:value=>effects.push(value),verifiedProductionDraftVisit});const pending=create('{}',guard);active=false;resolve({visita:visit});await assert.rejects(pending,/obsolete/);assert.deepEqual(effects,[true]);
});
test('actual confirmed callback validates before navigation and describes current version; UI recovery is explicit and memory-only',()=>{
 const effects=[],deps={verifiedProductionDraftVisit,writeProductionLocation:value=>effects.push(['url',value])};
 for(const name of ['Creating','Selected','Month','Day','Reload','Notice'])deps[`set${name}`]=value=>effects.push([name,value]);
 const saved=callback('createdVisit',deps),guard={assertCurrent(){}};assert.throws(()=>saved({id:uuid},guard));assert.deepEqual(effects,[]);
 saved(visit,guard);assert.ok(effects.some(([name,value])=>name==='Notice'&&value==='Visita guardada. Se muestra la versión actual.'));
 assert.equal(file.parseDiagnostics.length,0);assert.match(source,/Verificar creación/);assert.match(source,/disabled=\{locked\}/);assert.match(source,/se pierde esta clave de recuperación/);
 assert.match(source,/onCreated=\{createdVisit\}/);assert.doesNotMatch(readFileSync(new URL('./productionCreateIntent.js',import.meta.url),'utf8'),/localStorage|Math.random|setTimeout/);
});
test('actual form submit explicitly verifies locked intent instead of constructing a new submission',async()=>{
 const owner=file.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='CreateVisit');let submit;
 function find(node){if(ts.isVariableDeclaration(node)&&node.name.getText(file)==='submit')submit=node.initializer;ts.forEachChild(node,find)}find(owner);
 const effects=[],scope={assertCurrent:()=>effects.push('scope')},deps={model:{current:{snapshot:{busy:false,locked:true},verify:async()=>{effects.push('verify');return visit},submit:()=>assert.fail('must not create new intent')}},originalScope:{current:scope},mounted:{current:true},setError:value=>effects.push(['error',value]),render:()=>{},onDirty:(...args)=>effects.push(['dirty',...args]),onCreated:(value,guard)=>{assert.equal(value,visit);assert.equal(guard,scope);effects.push('saved')},draft:null};
 scope.current=()=>true;
 const run=new Function(...Object.keys(deps),`return (${submit.getText(file)});`)(...Object.values(deps));
 await run({preventDefault(){}});assert.deepEqual(effects,[['error',''],'verify','scope',['dirty','create',false],'saved']);
});
test('actual form capture pins rendered A; current B before first submit cannot receive A draft',async()=>{
 const owner=file.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='CreateVisit');let capture;
 function find(node){if(ts.isPropertyAssignment(node)&&node.name.getText(file)==='capture')capture=node.initializer;ts.forEachChild(node,find)}find(owner);
 const sesion={token:'a',usuario:{id:7,rol:'admin',activo:true}},live={token:'b',usuario:{id:8,rol:'admin',activo:true}};
 let reads=0,requests=0,uuidCalls=0;
 const deps={sesion,getSesion:()=>{reads++;return live},createCapturedRequest,apiRequest:()=>{requests++;},mounted:{current:true},originalScope:{current:null}};
 const actualCapture=new Function(...Object.keys(deps),`return (${capture.getText(file)});`)(...Object.values(deps));
 const model=createProductionCreateIntent({capture:actualCapture,request:()=>{requests++},randomUUID:()=>{uuidCalls++;return uuid}});
 await assert.rejects(model.submit(input()),{code:'session_binding_obsolete'});
 assert.equal(requests,0);assert.equal(uuidCalls,0);assert.ok(reads>0);assert.equal(model.snapshot.locked,false);
 assert.match(source,/<CreateVisit key="create"[^>]*sesion=\{sesion\}/);
 assert.doesNotMatch(capture.getText(file),/session:getSesion\(\)/);
});
