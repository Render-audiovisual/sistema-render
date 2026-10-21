import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { strictAgreementMoney, strictAgreementPeriod, parseFirstAgreement, readFirstAgreement, startFirstAgreement, createMonthlyAgreementRouter, validateLegacyConfigurationRequest } from '../src/monthly-agreement.js';

const auth={id:7,session_version:2,rol:'admin'};
const body=()=>({vigente_desde:'2026-11',cuota_reels:2,cuota_carruseles:1,abono_mensual:'12345.6',dias_historias:[3,1],dias_reels:[],dias_carruseles:[5],disenador_responsable:'Augusto',rubro:' Estudio ',expected_revision:'a1:1:1:0:0'});
test('month and money never use implicit fallbacks or numeric coercions',()=>{
  assert.equal(strictAgreementPeriod('2026-11'),'2026-11-01');
  for(const value of [undefined,null,'2026-1','2026-00','0000-01','2026-11\n',[],202611])assert.throws(()=>strictAgreementPeriod(value),{status:400});
  for(const [value,expected] of [['0','0.00'],['0.1','0.10'],['12345.6','12345.60'],['999999999999.99','999999999999.99']])assert.equal(strictAgreementMoney(value),expected);
  for(const value of [undefined,null,'',' ','01','-0','+2','1e2','1,00','2.001','1000000000000.00','1.00\n',true,0,{}])assert.throws(()=>strictAgreementMoney(value),{status:400});
  assert.equal(strictAgreementMoney(12.5,{numeric:true}),'12.50');
  assert.throws(()=>strictAgreementMoney(0.001,{numeric:true}),{status:400});
});
test('closed first agreement requires every explicit field, allows chosen zero and copies sorted day arrays',()=>{
  const input=body(),before=structuredClone(input),result=parseFirstAgreement(input);assert.deepEqual(input,before);
  assert.equal(result.rubro,'Estudio');assert.equal(result.abono_mensual,'12345.60');assert.deepEqual(result.dias_historias,[1,3]);
  assert.notEqual(result.dias_historias,input.dias_historias);
  assert.equal(parseFirstAgreement({...body(),cuota_reels:0,cuota_carruseles:0,abono_mensual:'0'}).abono_mensual,'0.00');
  const missing=body();delete missing.expected_revision;assert.throws(()=>parseFirstAgreement(missing),{status:428});
  for(const patch of [{actor_id:7},{nombre:'Rename'},{automaticObservation:'bypass'},{cuota_reels:'2'},{cuota_reels:101},{cuota_carruseles:null},{abono_mensual:0},{rubro:' '},{rubro:'bad\nlabel'},{dias_historias:[]},{dias_reels:undefined},{dias_carruseles:[5,5]},{dias_historias:['1']},{dias_reels:[7]},{disenador_responsable:'Franco'}])assert.throws(()=>parseFirstAgreement({...body(),...patch}),{status:400});
});
test('existing editor compatibility never silently coerces blanks/null/booleans into monetary, quota or weekday zeros',()=>{
  const compatible={...body(),cuota_reels:'2',cuota_carruseles:'1',abono_mensual:12.5,dias_historias:[5,'1',1]};delete compatible.dias_reels;delete compatible.dias_carruseles;
  assert.doesNotThrow(()=>validateLegacyConfigurationRequest(compatible));
  for(const patch of [{cuota_reels:''},{cuota_reels:false},{abono_mensual:null},{abono_mensual:''},{dias_historias:[false]},{dias_historias:['']},{dias_historias:{}},{dias_reels:null},{dias_carruseles:[{}]},{rubro:{}},{vigente_desde:undefined},{actor_id:7}])assert.throws(()=>validateLegacyConfigurationRequest({...compatible,...patch}),{status:400});
});
function fixture(overrides={}) {
  const calls=[];let mutations=0,revision=1,released;
  const user={...auth,activo:true,nombre:'Current administrator',usuario:'synthetic',...overrides.user};
  const row={id:1,nombre:'Basic client',activo:true,rubro:null,fecha_inicio:null,fecha_fin:null,grupo_feed_id:null,cuota_reels:0,cuota_carruseles:0,has_configuration:false,has_fee:false,...overrides.client};
  const db={release:value=>{released=value||true;},query:async(sql,values)=>{
    const normalized=sql.replace(/\s+/g,' ').trim();calls.push([normalized,values]);
    if(overrides.fail&&normalized.includes(overrides.fail))throw Error('fixture failure');
    if(normalized.startsWith('SELECT id,rol,activo,session_version'))return{rows:overrides.missingUser?[]:[user]};
    if(normalized.startsWith('SELECT c.id,c.nombre'))return{rows:overrides.missingClient?[]:[row]};
    if(normalized.startsWith('SELECT c.nombre,c.activo'))return{rows:[{nombre:row.nombre,activo:true,rubro:'Estudio',fecha_inicio:'2026-11-01',grupo_feed_id:null,cuota_reels:2,cuota_carruseles:1,configuration_reels:2,configuration_carousels:1,dias_historias:[1,3],dias_reels:[],dias_carruseles:[5],disenador_responsable:'Augusto',abono_mensual:'12345.60',fee_amount:'12345.60',...overrides.saved}]};
    if(normalized.startsWith('SELECT id,grupo_feed_id FROM public.clientes'))return{rowCount:1,rows:[{id:1,grupo_feed_id:null}]};
    if(normalized.includes('AS agreement_revision'))return{rowCount:1,rows:[{agreement_revision:`a1:1:${revision}:0:0`}]};
    if(/^(INSERT|UPDATE)/.test(normalized)){mutations++;revision++;return{rows:[],rowCount:1};}
    return{rows:[],rowCount:0};
  }};
  return{pool:{connect:async()=>db},calls,get mutations(){return mutations;},get released(){return released;}};
}
test('GET is one read-only coherent observation and never includes financial history values',async()=>{
  const f=fixture(),result=await readFirstAgreement(f.pool,auth,'1');
  assert.deepEqual(result,{version:1,eligible:true,agreement_revision:'a1:1:1:0:0',cliente:{id:1,nombre:'Basic client',activo:true,rubro:null,fecha_inicio:null}});
  assert.equal(f.mutations,0);assert.match(f.calls[0][0],/REPEATABLE READ READ ONLY/);assert.equal(f.calls.at(-1)[0],'COMMIT');assert.equal(f.released,true);
});
test('POST holds real authority after mutex, checks CAS/history, inserts atomically without UPSERT or operational writes',async()=>{
  const f=fixture(),result=await startFirstAgreement(f.pool,auth,'1',body());assert.equal(f.mutations,3);
  assert.equal(result.cliente.abono_mensual,'12345.60');assert.equal(result.cliente.fecha_inicio,'2026-11-01');assert.equal(result.cliente.agreement_revision,'a1:1:4:0:0');
  const sql=f.calls.map(([value])=>value),clientLock=sql.findIndex(value=>value.includes('8142, 1')),actorLock=sql.findIndex(value=>value.includes('usuarios WHERE id=$1 FOR SHARE'));
  assert.ok(clientLock<actorLock);assert.ok(actorLock<sql.findIndex(value=>value.includes('FROM public.clientes WHERE')));
  assert.doesNotMatch(sql.join('\n'),/ON CONFLICT|INSERT INTO (?:tareas|publicaciones|historias|cliente_objetivos|pagos)/);
  assert.equal(sql.at(-1),'COMMIT');assert.equal(f.calls.find(([value])=>value.startsWith('INSERT INTO cliente_abonos'))[1][3],'Current administrator');
});
test('constructed input alone cannot acknowledge a mismatching persisted configuration',async()=>{
  for(const saved of [{fee_amount:'0.00'},{abono_mensual:'0.00'},{configuration_reels:0},{dias_historias:[6]},{nombre:'Changed'}]){
    const f=fixture({saved});await assert.rejects(startFirstAgreement(f.pool,auth,'1',body()),/verificar el acuerdo/);assert.equal(f.calls.at(-1)[0],'ROLLBACK');
  }
});
test('inactive, historic, future, shared and quota-bearing clients cannot be silently reinterpreted',async()=>{
  for(const patch of [{activo:false},{fecha_inicio:'2026-01-01'},{fecha_fin:'2026-12-31'},{grupo_feed_id:2},{cuota_reels:1},{cuota_carruseles:1},{has_configuration:true},{has_fee:true}]) {
    const f=fixture({client:patch});await assert.rejects(startFirstAgreement(f.pool,auth,'1',body()),{status:409});assert.equal(f.mutations,0);assert.equal(f.calls.at(-1)[0],'ROLLBACK');
  }
  for(const patch of [{user:{session_version:3}},{user:{activo:false}},{missingUser:true}])await assert.rejects(readFirstAgreement(fixture(patch).pool,auth,'1'),{status:401});
  await assert.rejects(readFirstAgreement(fixture({user:{rol:'community'}}).pool,auth,'1'),{status:403});
  await assert.rejects(readFirstAgreement(fixture({missingClient:true}).pool,auth,'1'),{status:404});
});
test('malformed IDs/payloads open no connection and failed rollback discards the leased client',async()=>{
  const pool={connect:()=>assert.fail('no lease')};
  for(const id of ['0','01','1\n','2147483648',{},undefined])await assert.rejects(readFirstAgreement(pool,auth,id),{status:400});
  await assert.rejects(startFirstAgreement(pool,auth,'1',{...body(),abono_mensual:''}),{status:400});
  const f=fixture({fail:'ROLLBACK'});await assert.rejects(startFirstAgreement(f.pool,auth,'1',{...body(),expected_revision:'a1:1:2:0:0'}),{status:409});assert.ok(f.released instanceof Error);assert.equal(f.mutations,0);
});
test('router exposes only scoped GET/POST and canonical principal mounts it after authentication',()=>{
  const routes=[],express={Router:()=>({get:(...args)=>routes.push(['GET',...args]),post:(...args)=>routes.push(['POST',...args])})};createMonthlyAgreementRouter({express,pool:{}});
  assert.deepEqual(routes.map(([method,path])=>[method,path]),[['GET','/:id/acuerdo-mensual/iniciar'],['POST','/:id/acuerdo-mensual/iniciar']]);
  const source=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');assert.ok(source.indexOf('router.use(createPrincipalAuthentication')<source.indexOf("router.use('/clientes', createMonthlyAgreementRouter"));
  const legacy=source.slice(source.indexOf('router.post("/clientes/:id/configuraciones"'),source.indexOf('router.patch("/clientes/:id"'));
  assert.match(legacy,/captureClientCreator\(req.auth\)/);assert.match(legacy,/strictAgreementPeriod\(req.body.vigente_desde\)/);assert.match(legacy,/validateLegacyConfigurationRequest/);
  assert.ok(legacy.indexOf('await lockClientAdministration')<legacy.indexOf('await lockCurrentClientCreator'));
});
