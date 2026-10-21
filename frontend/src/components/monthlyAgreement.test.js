import test from 'node:test';
import assert from 'node:assert/strict';
import {blankMonthlyAgreementDraft,buildMonthlyAgreementPayload,parseMonthlyAgreementContext,parseStartedMonthlyAgreement,createMonthlyAgreementOperation,canStartMonthlyAgreement} from './monthlyAgreement.js';
import {createCapturedRequest} from '../shared/session/captured-request.js';
import {createBrowserSessionState} from '../shared/session/browser-session-state.js';

const context=()=>({version:1,eligible:true,agreement_revision:'a1:7:4:0:0',cliente:{id:7,nombre:'Cliente QA',activo:true,rubro:null,fecha_inicio:null}});
const draft=()=>({vigente_desde:'2026-11',cuota_reels:'2',cuota_carruseles:'1',abono_mensual:'125.5',dias_historias:[5,1],dias_reels:[],dias_carruseles:[2],disenador_responsable:'Augusto',rubro:'  Estudio  '});
const payload=()=>buildMonthlyAgreementPayload(draft(),context());
const ack=()=>({version:1,cliente:{id:7,nombre:'Cliente QA',activo:true,rubro:'Estudio',fecha_inicio:'2026-11-01',cuota_reels:2,cuota_carruseles:1,grupo_feed_id:null,configuracion_completa:true,configuracion_vigente_desde:'2026-11-01',abono_vigente_desde:'2026-11-01',abono_mensual:'125.50',dias_historias:[1,5],dias_reels:[],dias_carruseles:[2],disenador_responsable:'Augusto',agreement_revision:'a1:7:7:0:0'}});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
test('draft is blank and payload is closed, explicit including zero, canonical money and sorted days without mutating inputs',()=>{
 assert.deepEqual(blankMonthlyAgreementDraft(),{vigente_desde:'',cuota_reels:'',cuota_carruseles:'',abono_mensual:'',dias_historias:[],dias_reels:[],dias_carruseles:[],disenador_responsable:'',rubro:''});
 const form=draft(),before=structuredClone(form),body=buildMonthlyAgreementPayload({...form,nombre:'NEVER',activo:false,finance:{secret:1}},context());assert.deepEqual(form,before);
 assert.deepEqual(body,{vigente_desde:'2026-11',cuota_reels:2,cuota_carruseles:1,abono_mensual:'125.50',dias_historias:[1,5],dias_reels:[],dias_carruseles:[2],disenador_responsable:'Augusto',rubro:'Estudio',expected_revision:'a1:7:4:0:0'});
 assert.equal(buildMonthlyAgreementPayload({...form,cuota_reels:'0',cuota_carruseles:'0',abono_mensual:'0'},context()).abono_mensual,'0.00');
 for(const abono_mensual of ['',' ',0,'01','1e3','0x10','1,20','1.234','1000000000000','1\n','-1','Infinity'])assert.throws(()=>buildMonthlyAgreementPayload({...form,abono_mensual},context()));
 assert.equal(buildMonthlyAgreementPayload({...form,abono_mensual:'999999999999.99'},context()).abono_mensual,'999999999999.99');
 for(const patch of [{vigente_desde:''},{vigente_desde:'0000-01'},{vigente_desde:'2026-11\n'},{cuota_reels:''},{cuota_reels:'1e1'},{cuota_reels:'101'},{cuota_carruseles:'-1'},{rubro:''},{rubro:'bad\n'},{disenador_responsable:'id:7'},{dias_historias:[]},{dias_historias:[1,1]},{dias_reels:['1']},{dias_carruseles:[7]}])assert.throws(()=>buildMonthlyAgreementPayload({...form,...patch},context()));
});
test('fresh context is exact active target and canonical revision; projects no arbitrary financial history',()=>{
 const raw={...context(),financial:{secret:'CANARY'},cliente:{...context().cliente,metadata:{secret:'CANARY'}}};assert.deepEqual(parseMonthlyAgreementContext(raw,7),context());
 for(const patch of [{version:2},{eligible:false},{agreement_revision:'a1:8:4:0:0'},{agreement_revision:'a1:7:4:0:0\n'},{agreement_revision:'a1:7:4:1:1'}])assert.throws(()=>parseMonthlyAgreementContext({...context(),...patch},7));
 for(const patch of [{id:8},{id:'7'},{activo:false},{fecha_inicio:'2026-11-01'},{nombre:null}])assert.throws(()=>parseMonthlyAgreementContext({...context(),cliente:{...context().cliente,...patch}},7));
});
test('full ACK must confirm every field, same name/ID and newer revision, fixed money and exact sorted arrays',()=>{
 const raw=ack(),before=structuredClone(raw);raw.cliente.metadata={secret:'CANARY'};const parsed=parseStartedMonthlyAgreement(raw,context(),payload());assert.doesNotMatch(JSON.stringify(parsed),/metadata|CANARY/);delete raw.cliente.metadata;assert.deepEqual(raw,before);
 const patches=[{id:8},{nombre:'Renamed'},{activo:false},{rubro:'Other'},{cuota_reels:3},{cuota_carruseles:2},{abono_mensual:'125.5'},{fecha_inicio:'2026-12-01'},{configuracion_vigente_desde:'2026-12-01'},{abono_vigente_desde:'2026-12-01'},{grupo_feed_id:3},{configuracion_completa:false},{disenador_responsable:'Mariano Meza'},{dias_historias:[5,1]},{dias_reels:[1]},{dias_carruseles:[]},{agreement_revision:'a1:7:4:0:0'},{agreement_revision:'a1:8:7:0:0'}];
 for(const patch of patches)assert.throws(()=>parseStartedMonthlyAgreement({...ack(),cliente:{...ack().cliente,...patch}},context(),payload()));
 for(const key of Object.keys(ack().cliente)){const bad=ack();delete bad.cliente[key];assert.throws(()=>parseStartedMonthlyAgreement(bad,context(),payload()),key);}
 assert.throws(()=>parseStartedMonthlyAgreement({version:1,cliente:{id:7}},context(),payload()));
});
function fixture(request){
 const store=createBrowserSessionState();const accept=id=>store.acceptBootstrap(store.beginBootstrap(),{usuario:{id,rol:'admin',nombre:'QA',usuario:'qa'},session_context:'a'.repeat(43),csrf_token:'b'.repeat(43)});accept(11);
 const session=store.getSession();let current=session,active=true,epoch=0;const calls=[],states=[];
 const capture=()=>{const observed=epoch;return createCapturedRequest({session,readSession:()=>current,isActive:()=>active&&epoch===observed,request:(url,options)=>{calls.push({url,options});return request(url,options);}});};
 const model=createMonthlyAgreementOperation({clientId:7,capture,onChange:state=>states.push(state)});
 return{model,session,calls,states,replace(){accept(12);current=store.getSession();},unmount(){active=false;model.dispose();},aba(){epoch++;}};
}
test('actual operation requires fresh GET, original cookie intent, acknowledged explicit POST; immutable body and confirmed result only once',async()=>{
 const wait=deferred(),f=fixture((_url,opts)=>opts.method==='GET'?Promise.resolve(context()):wait.promise);
 assert.equal(await f.model.submit(draft(),true),null);assert.equal(f.calls.length,0);await f.model.load();
 assert.equal(f.calls[0].url,'/api/clientes/7/acuerdo-mensual/iniciar');assert.equal(f.calls[0].options.headers.Authorization,undefined);assert.ok(f.calls[0].options.signal);assert.ok(f.calls[0].options.sessionIntent);
 await f.model.submit(draft(),false);assert.equal(f.calls.length,1);
 const form=draft(),pending=f.model.submit(form,true);await f.model.submit(form,true);assert.equal(f.calls.length,2);assert.equal(f.model.snapshot.busy,true);form.abono_mensual='999';assert.equal(JSON.parse(f.calls[1].options.body).abono_mensual,'125.50');
 wait.resolve(ack());const result=await pending;assert.equal(result.cliente.id,7);assert.equal(result.guard.current(),true);assert.equal(f.model.snapshot.status,'saved');await f.model.load();await f.model.submit(draft(),true);assert.equal(f.calls.length,2);
});
test('unknown/409/500/malformed ACK freezes same attempt, keeps context and allows no reload-as-proof or second POST',async()=>{
 for(const response of [Error('lost response'),Object.assign(Error('stale'),{status:409}),Object.assign(Error('server'),{status:500}),{}, {version:1,cliente:{id:7}}]){
  const f=fixture(async(_url,options)=>{if(options.method==='GET')return context();if(response instanceof Error)throw response;return response;});await f.model.load();const form=draft(),before=structuredClone(form);assert.equal(await f.model.submit(form,true),null);assert.deepEqual(form,before);assert.equal(f.model.snapshot.status,'blocked');assert.ok(f.model.snapshot.context);assert.equal(f.model.snapshot.result,null);await f.model.submit(form,true);await f.model.load();assert.equal(f.calls.length,2);assert.equal(f.model.snapshot.attempted,true);
 }
});
test('denied GET/POST purges context/result and disables every subsequent request; ineligible GET never exposes a form',async()=>{
 for(const status of [401,403])for(const where of ['GET','POST']){
  const f=fixture(async(_url,options)=>{if(options.method===where)throw Object.assign(Error('PRIVATE'),{status});return context();});await f.model.load();if(where==='POST')await f.model.submit(draft(),true);assert.equal(f.model.snapshot.status,'denied');assert.equal(f.model.snapshot.context,null);assert.equal(f.model.snapshot.result,null);assert.equal(f.model.snapshot.attempted,false);assert.doesNotMatch(f.model.snapshot.error,/PRIVATE/);const count=f.calls.length;await f.model.load();await f.model.submit(draft(),true);assert.equal(f.calls.length,count);
 }
 const f=fixture(async()=>{throw Object.assign(Error('history private'),{status:409,code:'CLIENT_FIRST_AGREEMENT_INELIGIBLE'});});await f.model.load();assert.equal(f.model.snapshot.status,'ineligible');assert.equal(f.model.snapshot.context,null);assert.equal(await f.model.submit(draft(),true),null);assert.equal(f.calls.length,1);
});
test('session replacement, account/context ABA and disposal suppress late GET/POST success/error and no followup may cross identity',async()=>{
 for(const phase of ['GET','POST'])for(const event of ['replace','aba','unmount'])for(const fail of [true,false]){
  const wait=deferred(),f=fixture((_url,options)=>options.method===phase?wait.promise:Promise.resolve(context()));
  if(phase==='POST')await f.model.load();const pending=phase==='GET'?f.model.load():f.model.submit(draft(),true);f[event]();const count=f.states.length;fail?wait.reject(Object.assign(Error('late'),{status:403})):wait.resolve(phase==='GET'?context():ack());assert.equal(await pending,null);assert.equal(f.states.length,count);
 }
 const f=fixture(async()=>context());assert.equal(canStartMonthlyAgreement(f.session),true);assert.equal(canStartMonthlyAgreement({...f.session}),false);assert.equal(canStartMonthlyAgreement({token:'A',usuario:{id:1,rol:'community',activo:true}}),false);
});
