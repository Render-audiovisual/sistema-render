import test from 'node:test';
import assert from 'node:assert/strict';
import {blankTeamPaymentDraft,buildTeamPaymentBody,parseTeamPayment,parseTeamPaymentContext,parseTeamPayments,formatTeamPaymentARS,safePaymentDriveUrl,verifyTeamPaymentAck,createTeamPaymentsController} from './teamPayments.js';
import {createCapturedRequest} from '../shared/session/captured-request.js';
import {createBrowserSessionState} from '../shared/session/browser-session-state.js';
const key='11111111-2222-4333-8444-555555555555';
const recipients=[{id:11,nombre:'Alex',usuario:'alex',rol:'diseno'},{id:3,nombre:'Owner',usuario:'owner',rol:'admin'}];
const row=(patch={})=>({id:7,recipient_id:11,recipient_name:'Alex DB',recorded_by_id:3,recorded_by_name:'Owner DB',fecha_pago:'2026-10-20',periodo_trabajo:'2026-09',moneda:'ARS',importe:'125.50',referencia:'Comprobante manual',drive_url:null,provenance:'manual',status:'recorded',revision:'pay1:7:1',created_at:'2026-10-21T10:00:00.000Z',voided_at:null,voided_by_id:null,void_reason:null,...patch});
const form=()=>({recipient_id:'11',fecha_pago:'2026-10-20',periodo_trabajo:'2026-09',importe:'125.5',referencia:' Comprobante manual ',drive_url:''});
const list=(items=[])=>({version:1,periodo:'2026-10',items,total_recorded_ars:items.length?'125.50':'0.00'});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
test('display labels preserve backend Unicode and legacy username projections without UTF-16 caps',()=>{
 const nombre='😀'.repeat(126),usuario='🧑'.repeat(200)+' legacy';
 const input={version:1,recipients:[{id:11,nombre,usuario,rol:'diseno'}]},before=structuredClone(input);
 assert.deepEqual(parseTeamPaymentContext(input),input.recipients);assert.deepEqual(input,before);
 const payment=row({recipient_name:nombre,recorded_by_name:'🌈'.repeat(200)});
 assert.deepEqual(parseTeamPayment(payment),payment);
 assert.equal(parseTeamPayments(list([payment]),'2026-10').items[0].recipient_name,nombre);
 for(const invalid of ['', '  ',null,123]){
  assert.throws(()=>parseTeamPaymentContext({version:1,recipients:[{...input.recipients[0],nombre:invalid}]}));
  assert.throws(()=>parseTeamPayment({...payment,recipient_name:invalid}));
  assert.throws(()=>parseTeamPayment({...payment,recorded_by_name:invalid}));
 }
 assert.throws(()=>parseTeamPaymentContext({version:1,recipients:[{...input.recipients[0],usuario:null}]}));
 assert.throws(()=>parseTeamPaymentContext({version:1,recipients:[{...input.recipients[0],id:'11'}]}));
 assert.throws(()=>parseTeamPaymentContext({version:1,recipients:[{...input.recipients[0],rol:null}]}));
});
function fixture(transport){
 const store=createBrowserSessionState(),accept=id=>store.acceptBootstrap(store.beginBootstrap(),{usuario:{id,rol:'admin',nombre:'QA',usuario:'qa'},session_context:'a'.repeat(43),csrf_token:'b'.repeat(43)});accept(3);const session=store.getSession();let epoch=0,active=true,keys=0;const calls=[],states=[];
 const capture=()=>{const observed=epoch;return createCapturedRequest({session,readSession:store.getSession,isActive:()=>active&&epoch===observed,request:async(url,opts)=>{calls.push({url,opts});if(opts.method==='GET')return url.endsWith('/contexto')?{version:1,recipients}:list();return transport(url,opts);}});};
 const controller=createTeamPaymentsController({actorId:3,capture,onChange:state=>states.push(state),randomUUID:()=>{keys++;return key;},today:()=> '2026-10-21'});
 return{controller,calls,states,capture,keys:()=>keys,replace(){accept(4);},aba(){epoch++;},unmount(){active=false;controller.dispose();}};
}
test('manual form starts blank, positive money/date/ID/UUID/Drive validation and closed body never infer a salary',()=>{
 assert.ok(Object.values(blankTeamPaymentDraft()).every(value=>value===''));
 const draft=form(),before=structuredClone(draft),body=buildTeamPaymentBody({...draft,salary:999,recipient_name:'spoof'},recipients,'2026-10-21',key);assert.deepEqual(draft,before);assert.deepEqual(body,{operation_key:key,recipient_id:11,fecha_pago:'2026-10-20',periodo_trabajo:'2026-09',moneda:'ARS',importe:'125.50',referencia:'Comprobante manual',drive_url:null,attestation:true});
 for(const patch of [{recipient_id:'Alex'},{recipient_id:'011'},{recipient_id:'12'},{importe:''},{importe:'0'},{importe:'01.00'},{importe:'1e3'},{importe:'1.234'},{importe:'1000000000000'},{fecha_pago:'2026-10-22'},{fecha_pago:'2026-02-30'},{periodo_trabajo:'0000-01'},{referencia:'xx'},{referencia:'hello\nworld'}])assert.throws(()=>buildTeamPaymentBody({...form(),...patch},recipients,'2026-10-21',key));
 for(const invalidKey of [key+'\n',key.toUpperCase(),'11111111-2222-5333-8444-555555555555',null]){if(invalidKey===key)continue;assert.throws(()=>buildTeamPaymentBody(form(),recipients,'2026-10-21',invalidKey));}
 for(const url of ['javascript:alert(1)','data:text/html,x','/drive','https://drive.google.com.evil.test/x','https://user@drive.google.com/x','https://drive.google.com:443/x','http://drive.google.com/x','https://drive.google.com/\nx'])assert.equal(safePaymentDriveUrl(url),null);
 assert.equal(safePaymentDriveUrl('https://drive.google.com/file/d/123/view'),'https://drive.google.com/file/d/123/view');
});
test('closed list preserves history/voids, exact order/domain IDs and BigInt totals above safe numeric cents without hidden cap',()=>{
 const raw=row(),before=structuredClone(raw);assert.deepEqual(parseTeamPayment({...raw,metadata:{secret:1}}),raw);assert.deepEqual(raw,before);
 const history=row({fecha_pago:'2020-02-29'});assert.equal(parseTeamPayments({version:1,periodo:'2020-02',items:[history],total_recorded_ars:'125.50'},'2020-02').items.length,1);
 const rows=Array.from({length:100},(_,index)=>row({id:100-index,revision:`pay1:${100-index}:1`,importe:'999999999999.99'}));const total='99999999999999.00';assert.equal(parseTeamPayments({version:1,periodo:'2026-10',items:rows,total_recorded_ars:total},'2026-10').items.length,100);assert.equal(formatTeamPaymentARS(total),'ARS 99.999.999.999.999,00');
 const voided=row({status:'voided',revision:'pay1:7:2',voided_at:'2026-10-21T11:00:00.000Z',voided_by_id:4,void_reason:'Registro duplicado'});assert.equal(parseTeamPayments(list([voided])&&{...list([voided]),total_recorded_ars:'0.00'},'2026-10').items[0].status,'voided');
 for(const patch of [{status:'paid'},{recipient_id:'11'},{importe:'125.5'},{provenance:'bank'},{revision:'pay1:8:1'},{revision:'pay1:7:1\n'},{created_at:'2026-02-30T12:00:00Z'},{voided_by_id:4}])assert.throws(()=>parseTeamPayment({...row(),...patch}));
 assert.throws(()=>parseTeamPayments(list([row(),row()]),'2026-10'));assert.throws(()=>parseTeamPayments({...list([row()]),total_recorded_ars:'125.51'},'2026-10'));
 assert.throws(()=>parseTeamPayments({...list([row({id:6,revision:'pay1:6:1'}),row()]),total_recorded_ars:'251.00'},'2026-10'));
 assert.equal(parseTeamPaymentContext({version:1,recipients:[{...recipients[0],rol:'custom_role',financial:'DROP'}]})[0].financial,undefined);
});
test('unknown create recovers only SAME key/body/original cookie and accepts CURRENT voided replay without claiming new recorded status',async()=>{
 let attempt=0;const f=fixture(async()=>{if(++attempt===1)throw Error('lost');return{version:1,replayed:true,payment:row({status:'voided',revision:'pay1:7:2',voided_at:'2026-10-21T11:00:00.000Z',voided_by_id:4,void_reason:'Peer corrected'})};});await f.controller.load('2026-10');assert.ok(f.calls[0].opts.sessionIntent);assert.equal(f.calls[0].opts.headers.Authorization,undefined);
 await f.controller.create(form(),true);assert.equal(f.controller.snapshot.uncertain,true);const body=f.calls.at(-1).opts.body;await f.controller.create({...form(),importe:'999'},true);assert.equal(attempt,1);assert.equal(f.controller.reset(),false);const result=await f.controller.verify();assert.equal(result.payment.status,'voided');assert.equal(result.replayed,true);assert.equal(f.calls.at(-1).opts.body,body);assert.equal(f.keys(),1);assert.equal(attempt,2);
});
test('void uses held CAS plus independent attestation, preserves original, duplicate click dispatches once and no stale retry',async()=>{
 const wait=deferred(),f=fixture(()=>wait.promise);await f.controller.load('2026-10');await f.controller.voidPayment(row(),'Registro duplicado',false);assert.equal(f.calls.filter(c=>c.opts.method==='POST').length,0);
 const pending=f.controller.voidPayment(row(),'Registro duplicado',true);await f.controller.voidPayment(row(),'Again',true);const call=f.calls.at(-1);assert.equal(call.url,'/api/finanzas/pagos/7/anular');assert.deepEqual(JSON.parse(call.opts.body),{operation_key:key,expected_revision:'pay1:7:1',reason:'Registro duplicado',attestation:true});
 wait.resolve({version:1,replayed:false,payment:row({status:'voided',revision:'pay1:7:2',voided_at:'2026-10-21T11:00:00.000Z',voided_by_id:3,void_reason:'Registro duplicado'})});assert.equal((await pending).payment.status,'voided');
 const conflict=fixture(async()=>{throw Object.assign(Error('stale'),{status:409});});await conflict.controller.load('2026-10');await conflict.controller.voidPayment(row(),'Registro duplicado',true);await conflict.controller.verify();assert.equal(conflict.calls.filter(c=>c.opts.method==='POST').length,1);assert.equal(conflict.controller.snapshot.status,'conflict');
});
test('malformed/foreign ACK is uncertain not success; exact immutable business fields and actor checked',()=>{
 const intent={kind:'create',actorId:3,body:JSON.stringify(buildTeamPaymentBody(form(),recipients,'2026-10-21',key))};assert.equal(verifyTeamPaymentAck({version:1,replayed:false,payment:row()},intent).payment.id,7);
 for(const patch of [{recipient_id:12},{recorded_by_id:4},{importe:'1.00'},{fecha_pago:'2026-10-19'},{referencia:'Wrong'}, {drive_url:'https://drive.google.com/other'}])assert.throws(()=>verifyTeamPaymentAck({version:1,replayed:true,payment:row(patch)},intent));
});
test('stale session/context ABA/unmount never publishes a late write nor retries under new identity; denied read purges',async()=>{
 for(const action of ['replace','aba','unmount'])for(const reject of [true,false]){const wait=deferred(),f=fixture(()=>wait.promise);await f.controller.load('2026-10');const pending=f.controller.create(form(),true);f[action]();const count=f.states.length;reject?wait.reject(Error('late')):wait.resolve({version:1,replayed:false,payment:row()});await pending;assert.equal(f.states.length,count);await f.controller.verify();assert.equal(f.calls.filter(c=>c.opts.method==='POST').length,1);}
 const f=fixture(async()=>{throw Object.assign(Error('private'),{status:403});});await f.controller.load('2026-10');await f.controller.create(form(),true);assert.equal(f.controller.snapshot.status,'denied');assert.deepEqual(f.controller.snapshot.recipients,[]);assert.equal(f.controller.snapshot.list,null);assert.equal(f.controller.snapshot.result,null);await f.controller.verify();await f.controller.load('2026-10');assert.equal(f.calls.filter(c=>c.opts.method==='POST').length,1);
});
