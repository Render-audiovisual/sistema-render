import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { captureReportActor, normalizeReportQuery, loadReportSnapshot } from '../src/report-snapshot.js';
import { SYSTEM_USER_ROLES } from '../src/user-roles.js';

const auth = () => ({id:7,rol:'admin',session_version:3});
const selectors = {mes_configuracion:'2026-10',desde:'2026-10-01',hasta:'2026-11-01'};
const deferred = () => {let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function fixture({actor={...auth(),activo:true},failureAt,rollbackFails=false,commitGate,leaseGate}={}) {
  const calls=[],failure=new Error('synthetic read failure'),rollbackError=new Error('synthetic rollback failure');
  let leases=0;
  const db={async query(sql,params=[]) {
    const compact=sql.replace(/\s+/g,' ').trim(); calls.push({sql:compact,params});
    if(compact==='ROLLBACK'){if(rollbackFails)throw rollbackError;return{rows:[]};}
    if(failureAt&&compact.includes(failureAt))throw failure;
    if(compact==='COMMIT'){if(commitGate)await commitGate.promise;return{rows:[]};}
    if(compact==='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')return{rows:[]};
    if(compact.startsWith('SELECT id,rol,activo,session_version FROM usuarios'))return{rows:actor?[structuredClone(actor)]:[]};
    if(compact.startsWith('SELECT t.id,t.cliente_id'))return{rows:[{id:compact.includes("workspace'='render_os'")?2:1,cliente_id:4,historia_id:10,publicacion_id:20,titulo:'Observed work',estado:'pendiente',tipo_tarea:'diseno',fecha_vencimiento:'2026-10-20',propiedades_extra:{workspace:'render_os',finance_secret:999}}]};
    if(compact.startsWith('SELECT id,cliente_id,estado'))return{rows:[{id:10,cliente_id:4,estado:'pendiente',fecha_programada:'2026-10-20'}]};
    if(compact.startsWith('SELECT id,cliente_id,tipo,estado'))return{rows:[{id:20,cliente_id:4,tipo:'carrusel',estado:'pendiente',fecha_programada:'2026-10-20'}]};
    if(compact.startsWith('SELECT c.id,c.nombre,c.activo'))return{rows:[{id:4,nombre:'Client',activo:true,cuota_reels:1,cuota_carruseles:2}]};
    if(compact==='SELECT id,usuario,nombre,rol FROM usuarios ORDER BY id')return{rows:[{id:7,usuario:'actor',nombre:'Actor',rol:actor.rol},{id:8,usuario:'peer',nombre:'Peer',rol:'diseno'}]};
    if(compact.startsWith('SELECT id,editor_clave'))return{rows:[{id:30,editor_clave:'legacy',importe:'999.99'}]};
    if(compact.startsWith('SELECT tarea_id, usuario_id, tipo'))return{rows:params[0].map(tarea_id=>({tarea_id,usuario_id:7,tipo:'responsable'}))};
    if(compact.startsWith('SELECT p.id AS piece_id'))return{rows:[]};
    if(compact.startsWith('SELECT v.id,v.tarea_origen_id'))return{rows:[{id:'11111111-1111-4111-8111-111111111111',cliente_id:4,cliente_nombre:'Client',fecha:'2026-10-20',titulo:'Visit',participante_ids:[7]}]};
    if(compact.startsWith('SELECT pv.id,pv.visita_id'))return{rows:[]};
    if(compact.startsWith('SELECT id,visita_id,tipo,estado FROM produccion_fotos'))return{rows:[]};
    throw Error('Unexpected SQL '+compact);
  },release(error){calls.push({sql:'RELEASE',error});}};
  const pool={async connect(){leases++;if(leaseGate)await leaseGate.promise;return db;},query(){throw Error('Report escaped leased snapshot');}};
  return{pool,calls,failure,rollbackError,get leases(){return leases;}};
}

test('query is closed, scalar, calendar-valid and bounded; omitted selectors retain monthly default',()=>{
  assert.deepEqual(normalizeReportQuery({},new Date(2026,9,21)),{mesConfiguracion:'2026-10-01',productionRange:{desde:'2026-10-01',hasta:'2026-11-01'}});
  assert.deepEqual(normalizeReportQuery({mes_configuracion:'2028-02'}).productionRange,{desde:'2028-02-01',hasta:'2028-03-01'});
  assert.deepEqual(normalizeReportQuery(selectors).productionRange,{desde:selectors.desde,hasta:selectors.hasta});
  for(const desde of ['2026-10-01\n','2026-10-01 ','0000-10-01'])assert.throws(()=>normalizeReportQuery({desde,hasta:'2026-11-01'}),error=>error.status===400);
  for(const query of [null,[],{extra:'x'},{'mes_configuracion[]':'2026-10'},...['','0000-01','2026-13','2026-10\n',202610,['2026-10'],{}].map(mes_configuracion=>({mes_configuracion})),{desde:'2026-10-01'},{hasta:'2026-11-01'},{desde:['2026-10-01'],hasta:'2026-11-01'},{desde:'2026-02-30',hasta:'2026-03-01'},{desde:'2026-10-01',hasta:'2026-10-01'},{desde:'2026-01-01',hasta:'2027-01-03'}])assert.throws(()=>normalizeReportQuery(query),error=>error.status===400);
});

test('malformed identity/query fail before leasing, with no cached admin authority fallback',async()=>{
  const f=fixture();
  for(const patch of [{id:'7'},{id:2147483648},{session_version:0},{session_version:'3'},{rol:null}])await assert.rejects(loadReportSnapshot(f.pool,{...auth(),...patch},selectors),error=>error.status===401);
  await assert.rejects(loadReportSnapshot(f.pool,auth(),{mes_configuracion:['2026-10']}),error=>error.status===400);
  assert.equal(f.leases,0);assert.deepEqual(f.calls,[]);
  assert.deepEqual(captureReportActor({...auth(),nombre:'not authority'}),auth());
});

test('all original base/assignment/evidence/production reads use one leased RR readonly snapshot and preserve result shape',async()=>{
  const f=fixture(),result=await loadReportSnapshot(f.pool,auth(),selectors);
  assert.equal(f.leases,1);assert.equal(f.calls[0].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.deepEqual(f.calls[1].params,[7]);assert.match(f.calls[1].sql,/FROM usuarios WHERE id=\$1$/);
  assert.deepEqual(Object.keys(result).sort(),['clientes','entregasEdicion','historias','producciones','publicaciones','resumenRenderOsPorDia','tareas','tareasRenderOs','usuarios'].sort());
  assert.equal(result.tareas[0].asignado_a_id,7);assert.equal(result.tareasRenderOs[0].asignado_a_id,7);
  assert.equal(result.historias[0].publicacion_evidencia.revision,0);assert.equal(result.publicaciones[0].publicacion_evidencia.classification,'no_publicada');
  assert.equal(result.entregasEdicion[0].importe,undefined,'Owner reports are operational, not financial');
  assert.equal(result.producciones.visitas.length,1);
  assert.ok(f.calls.some(call=>call.sql.startsWith('SELECT tarea_id, usuario_id')));
  assert.equal(f.calls.filter(call=>call.sql.startsWith('SELECT p.id AS piece_id')).length,2);
  assert.ok(f.calls.some(call=>call.sql.includes('FROM produccion_fotos')));
  assert.deepEqual(f.calls.slice(-2).map(call=>call.sql),['COMMIT','RELEASE']);
  assert.equal(f.calls.some(call=>/^(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)|FOR (UPDATE|SHARE)/.test(call.sql)),false);
});

test('operational roles share team reports while nonadmin DTO strips financial/raw bags',async()=>{
  for(const rol of SYSTEM_USER_ROLES){
    const f=fixture({actor:{...auth(),rol,activo:true}}),result=await loadReportSnapshot(f.pool,{...auth(),rol},selectors);
    assert.doesNotMatch(JSON.stringify(result),/finance_secret|999\.99|"importe"/);
    assert.deepEqual(result.usuarios.map(user=>user.id),[7,8]);
    assert.equal(result.tareasRenderOs.length,1);assert.equal(result.clientes.length,1);
    assert.equal(result.entregasEdicion.length,1);assert.equal(result.entregasEdicion[0].editor_id,undefined);
  }
});

test('missing/inactive/revoked/wrong ID or changed role reject before report queries; custom role retains safe existing projection',async()=>{
  for(const actor of [null,{...auth(),activo:false},{...auth(),activo:true,id:8},{...auth(),activo:true,session_version:4},{...auth(),activo:true,rol:'diseno'}]){
    const f=fixture({actor});await assert.rejects(loadReportSnapshot(f.pool,auth(),selectors),error=>error.status===401);
    assert.deepEqual(f.calls.map(call=>call.sql).slice(2),['ROLLBACK','RELEASE']);
  }
  const f=fixture({actor:{...auth(),activo:true,rol:'unknown'}});
  const result=await loadReportSnapshot(f.pool,{...auth(),rol:'unknown'},selectors);
  assert.deepEqual(result.usuarios.map(user=>user.id),[7]);
  for(const key of ['tareas','tareasRenderOs','historias','publicaciones','clientes','entregasEdicion'])assert.deepEqual(result[key],[]);
  assert.deepEqual(result.resumenRenderOsPorDia,{});
  assert.equal(result.producciones.visitas.length,1,'shared safe production registry remains available under existing policy');
  assert.doesNotMatch(JSON.stringify(result),/finance_secret|999\.99|"importe"/);
  assert.deepEqual(f.calls.slice(-2).map(call=>call.sql),['COMMIT','RELEASE']);
});

test('identity/epoch/role and query primitives are captured before waiting for pool lease',async()=>{
  const leaseGate=deferred(),f=fixture({leaseGate}),actor=auth(),query={...selectors};
  const pending=loadReportSnapshot(f.pool,actor,query);actor.id=8;actor.session_version=4;actor.rol='diseno';query.mes_configuracion='2027-01';query.desde='2027-01-01';
  leaseGate.resolve();await pending;
  assert.deepEqual(f.calls[1].params,[7]);
  assert.deepEqual(f.calls.find(call=>call.sql.startsWith('SELECT c.id,c.nombre,c.activo')).params,['2026-10-01']);
  assert.deepEqual(f.calls.find(call=>call.sql.startsWith('SELECT v.id,v.tarea_origen_id')).params,['2026-10-01','2026-11-01']);
});

test('no result before COMMIT settles and no postcommit query; read/annotation/commit failures roll back',async()=>{
  const commitGate=deferred(),f=fixture({commitGate});let settled=false;
  const pending=loadReportSnapshot(f.pool,auth(),selectors).then(value=>{settled=true;return value;});
  for(let i=0;i<30;i++)await Promise.resolve();
  assert.equal(f.calls.at(-1).sql,'COMMIT');assert.equal(settled,false);
  commitGate.resolve();await pending;assert.equal(f.calls.at(-1).sql,'RELEASE');
  for(const failureAt of ['BEGIN','SELECT t.id,t.cliente_id','SELECT tarea_id, usuario_id','SELECT p.id AS piece_id','FROM produccion_fotos','COMMIT']){
    const failed=fixture({failureAt});await assert.rejects(loadReportSnapshot(failed.pool,auth(),selectors),error=>error===failed.failure);
    assert.deepEqual(failed.calls.slice(-2).map(call=>call.sql),['ROLLBACK','RELEASE']);
  }
});

test('rollback failure discards leased client without replacing original fault; connection rejection is untouched',async()=>{
  const f=fixture({failureAt:'SELECT t.id,t.cliente_id',rollbackFails:true});
  await assert.rejects(loadReportSnapshot(f.pool,auth(),selectors),error=>error===f.failure);
  assert.equal(f.calls.at(-1).error,f.rollbackError);
  const connectError=new Error('lease unavailable');await assert.rejects(loadReportSnapshot({connect:async()=>{throw connectError;}},auth(),selectors),error=>error===connectError);
});

test('source has no pool query escape, response publication, write or runtime barrier switch',()=>{
  const source=readFileSync(new URL('../src/report-snapshot.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/pool\.query|res\.json|process\.env|FOR UPDATE|FOR SHARE|Promise\.all/);
  assert.ok(source.indexOf('filterReportDataForUser({')<source.indexOf("await db.query('COMMIT')"));
});
