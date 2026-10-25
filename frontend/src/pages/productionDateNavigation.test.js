import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import { notifyViewPreferenceChange } from '../shared/navigation/viewPreferenceEvent.js';

const source=readFileSync(new URL('./Productions.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('Productions.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function find(predicate){let result;function walk(node){if(predicate(node))result=node;ts.forEachChild(node,walk)}walk(tree);assert.ok(result);return result;}
const evaluate=(node,deps)=>Function(...Object.keys(deps),`return (${node.getText(tree)});`)(...Object.values(deps));
const callback=find(node=>ts.isVariableDeclaration(node)&&node.name.getText(tree)==='writeVisit').initializer;
const original={id:'11111111-1111-4111-8111-111111111111',revision:1,fecha:'2026-10-20'};
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes});return{promise,resolve}};
function harness({date='2026-11-03',failWrite,failRead,read}={}){
 const events=[],fresh={...original,revision:2,fecha:date};let active=true;
 const guard={current:()=>active,assertCurrent(){if(!active)throw new Error('obsolete');},request(){assert.fail('Injected productionWrite owns transport');}};
 const deps={sesion:{},getSesion:()=>({}),apiRequest:()=>assert.fail('No raw transport'),
  readEpoch:{current:0},openVersion:{current:0},writeLock:{current:false},batchDraft:{current:{busy:false}},resultDraft:{current:{busy:false,locked:false}},
  createCapturedRequest:()=>guard,clientId:'7',tab:'calendar',positiveId:value=>Number.isSafeInteger(value)&&value>0,visitDTO:value=>value?.visita||value,
  productionWrite:async()=>{events.push(['write']);if(failWrite)throw failWrite;return{visita:fresh}},
  refreshVisit:async(id,observed)=>{assert.equal(id,original.id);assert.equal(observed,guard);events.push(['read']);if(failRead)throw new Error('read unavailable');return read?await read:fresh},
  writeProductionLocation:value=>events.push(['url',value])};
 for(const name of ['Month','Day','Reload','Notice','Busy'])deps[`set${name}`]=value=>events.push([name,value]);
 return{write:evaluate(callback,deps),events,fresh,obsolete:()=>{active=false},moves:()=>events.filter(([name])=>['Month','Day','url'].includes(name))};
}
for(const date of ['2026-10-25','2026-11-03'])test(`actual callback follows verified explicit date edit ${date}`,async()=>{
 const h=harness({date}),data={fecha:date};assert.equal(await h.write(original,'','PATCH',data),h.fresh);
 assert.deepEqual(h.moves(),[['Month',date.slice(0,7)],['Day',date],['url',{id:original.id,month:date.slice(0,7),day:date,clientId:'7',tab:'calendar',replace:true}]]);
 assert.ok(h.events.findIndex(([name])=>name==='read')<h.events.findIndex(([name])=>name==='Month'));
 assert.ok(h.events.findIndex(([name])=>name==='url')<h.events.findIndex(([name])=>name==='Reload'));
 assert.deepEqual(data,{fecha:date});
});
for(const [label,path,method,data,date] of [
 ['unchanged','','PATCH',{fecha:original.fecha},original.fecha],
 ['date absent','','PATCH',{titulo:'Edit'},'2026-11-03'],
 ['inherited date','','PATCH',Object.create({fecha:'2026-11-03'}),'2026-11-03'],
 ['video','/videos/video-a','PATCH',{fecha:'2026-11-03'},'2026-11-03'],
 ['delivery','/videos/video-a/enviar-edicion','POST',{fecha_entrega:'2026-11-03'},'2026-11-03'],
 ['other method','','POST',{fecha:'2026-11-03'},'2026-11-03']
])test(`actual callback does not navigate for ${label}`,async()=>{
 const h=harness({date});await h.write(original,path,method,data);assert.deepEqual(h.moves(),[]);
});
test('failed full readback cannot navigate despite confirmed mutation ACK',async()=>{
 const h=harness({failRead:true});await assert.rejects(h.write(original,'','PATCH',{fecha:'2026-11-03'}),error=>error.productionSaved===true);
 assert.deepEqual(h.moves(),[]);assert.equal(h.events.some(([name])=>name==='Reload'),false);
});
test('409 cannot move or trigger readback/retry at writeVisit boundary',async()=>{
 const error=Object.assign(new Error('conflict'),{status:409}),h=harness({failWrite:error});
 await assert.rejects(h.write(original,'','PATCH',{fecha:'2026-11-03'}),error);
 assert.deepEqual(h.moves(),[]);assert.equal(h.events.filter(([name])=>name==='write').length,1);assert.equal(h.events.some(([name])=>name==='read'),false);
});
test('pending readback has no speculative movement; obsolete guard rejects late date',async()=>{
 const held=deferred(),h=harness({read:held.promise}),pending=h.write(original,'','PATCH',{fecha:'2026-11-03'});
 await Promise.resolve();await Promise.resolve();assert.deepEqual(h.moves(),[]);
 h.obsolete();held.resolve(h.fresh);await assert.rejects(pending,/obsolete/);assert.deepEqual(h.moves(),[]);
 assert.equal(h.events.some(([name])=>name==='Reload'),false);
});
test('actual location writer replaces month while preserving unrelated query/hash and history state',()=>{
 const calls=[],window={location:{href:'https://render.test/producciones?mes=2026-10&cliente=7&visita=old&tab=pending&other=keep#detail'},history:{state:{held:true},replaceState(...args){calls.push(args)},pushState(){assert.fail('Reschedule must replace')}}};
 const writer=evaluate(find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='writeProductionLocation'),{window,notifyViewPreferenceChange});
 writer({id:original.id,month:'2026-11',clientId:'7',tab:'pending',replace:true});
 assert.equal(calls.length,1);assert.equal(calls[0][0],window.history.state);
 const url=calls[0][2];assert.equal(url.searchParams.get('other'),'keep');assert.equal(url.hash,'#detail');
 assert.equal(url.searchParams.get('mes'),'2026-11');assert.equal(url.searchParams.get('visita'),original.id);assert.equal(url.searchParams.get('tab'),'pending');
});
