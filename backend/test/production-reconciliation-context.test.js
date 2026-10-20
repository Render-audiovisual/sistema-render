import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readProductionReconciliationContext, registerProductionReconciliationRoutes } from '../src/production-reconciliation.js';

// Injected DB protocol and actual legacy helper only; no physical DB/HTTP claim.
const begin='BEGIN ISOLATION LEVEL REPEATABLE READ';
const auth={id:7,rol:'untrusted',session_version:3};
const admin={id:7,rol:'admin',activo:true,session_version:3};
const visit='11111111-1111-4111-8111-111111111111';
const source=(patch={})=>({id:9,revision:4,titulo:'Visita histórica',tipo_tarea:'produccion',subtipo:'visita',
  cliente_id:3,context_client_id:3,cliente_nombre:'Cliente',cliente_activo:true,source_date:'2026-10-22',
  aclaraciones:'  Instrucciones\nexactas ',material_referencia:'javascript:literal',
  propiedades_extra:{workspace:'render_os',produccion_registros:[{cantidad:2},{cantidad:'3'}],
    produccion_videos_previstos:6,guiones:'Guion\n',material:'Material legado',feedback:'Feedback',horario:'Después de almorzar'},...patch});
function fake({user=admin,task=source(),registry=null,child=null,childRows,fail,rollbackFail=false}={}) {
  const calls=[];let connects=0,releases=0;
  const db={release(){releases++;},async query(sql,values){
    calls.push({sql,values});
    const kind=sql.includes('FROM usuarios')?'user':sql.includes('FROM tareas t LEFT JOIN clientes')?'source'
      :sql.includes('FROM produccion_visitas')?'registry':sql.includes("origen_visita_id")?'child':sql;
    if(kind===fail||(sql==='ROLLBACK'&&rollbackFail))throw new Error('Injected failure');
    if(kind==='user')return {rows:user?[user]:[]};
    if(kind==='source')return {rows:task?[task]:[]};
    if(kind==='registry')return {rows:registry?[{id:registry}]:[]};
    if(kind==='child')return {rows:sql.startsWith('SELECT id,revision,titulo,estado')?(childRows??(child?[{id:child,revision:2,titulo:'Edición original',estado:'finalizada'}]:[])):child?[{id:child}]:[]};
    assert.ok([begin,'COMMIT','ROLLBACK'].includes(sql));return {rows:[]};
  }};
  return {calls,get connects(){return connects;},get releases(){return releases;},pool:{async connect(){connects++;return db;}}};
}
const read=m=>readProductionReconciliationContext(m.pool,auth,'9');

test('current admin context uses RR snapshot with FOR SHARE and SELECT-only source inspection',async()=>{
  const m=fake(),result=await read(m);
  assert.equal(result.version,1);assert.equal(result.source.id,9);assert.equal(result.source.revision,4);
  assert.deepEqual(result.eligibility,{status:'ready',visita_id:null});
  assert.equal(m.calls[0].sql,begin);assert.match(m.calls[1].sql,/FROM usuarios WHERE id=\$1 FOR SHARE/);
  assert.deepEqual(m.calls[1].values,[7]);assert.equal(m.calls.at(-1).sql,'COMMIT');assert.equal(m.releases,1);
  for(const {sql} of m.calls)assert.doesNotMatch(sql,/\b(?:UPDATE|INSERT|DELETE|ALTER)\b|READ ONLY/i);
  assert.deepEqual(m.calls.find(call=>call.sql.includes('FROM tareas t LEFT JOIN clientes')).values,[9]);
});

test('canonical PG source ID and query-none contract reject before any DB connection',async()=>{
  for(const id of [undefined,null,9,'0','-1','09','9.0','9\n','2147483648','9007199254740992','9?role=admin']){
    const m=fake();await assert.rejects(readProductionReconciliationContext(m.pool,auth,id),{status:400});assert.equal(m.connects,0);
  }
  for(const query of [null,[],{user_id:'8'},{role:'admin'},{extra:''}]){
    const m=fake();await assert.rejects(readProductionReconciliationContext(m.pool,auth,'9',query),{status:400});assert.equal(m.connects,0);
  }
});

test('DB role, active state and session version gate context, never claimed role or name',async()=>{
  for(const user of [null,{...admin,activo:false},{...admin,session_version:4}]){
    const m=fake({user});await assert.rejects(read(m),{status:401});assert.equal(m.calls.at(-1).sql,'ROLLBACK');assert.equal(m.releases,1);
    assert.equal(m.calls.some(call=>call.sql.includes('FROM tareas t')),false);
  }
  for(const rol of ['produccion','diseno','edicion','community','programacion','unknown']){
    const m=fake({user:{...admin,rol}});await assert.rejects(readProductionReconciliationContext(m.pool,{...auth,rol:'admin',nombre:'Franco'},'9'),{status:403});
  }
  const missing=fake();await assert.rejects(readProductionReconciliationContext(missing.pool,{id:7},'9'),{status:401});
});

test('class/scope mismatch is 404; unavailable outranks existing links and legacy children',async()=>{
  for(const task of [null,source({tipo_tarea:'edicion'}),source({titulo:'Otra tarea',subtipo:''}),
    source({propiedades_extra:{workspace:'other'}})])await assert.rejects(read(fake({task})),{status:404});
  for(const patch of [{cliente_activo:false},{cliente_activo:null},{context_client_id:null},
    {source_date:null},{source_date:'2026-02-29'},
    ...['archivada_render_os','papelera_render_os'].flatMap(key=>[true,'true'].map(value=>({propiedades_extra:{...source().propiedades_extra,[key]:value}})))]){
    const value=await read(fake({task:source(patch),registry:visit,child:33}));
    assert.equal(value.eligibility.status,'unavailable');
  }
  const missingClient=await read(fake({task:source({context_client_id:null,cliente_nombre:null,source_date:null})}));
  assert.equal(missingClient.source.cliente,null);assert.equal(missingClient.source.fecha,null);
});

test('eligibility prioritizes linked registry then editing child then actual legacy helper',async()=>{
  assert.deepEqual((await read(fake({registry:visit,child:33}))).eligibility,{status:'already_linked',visita_id:visit});
  assert.equal((await read(fake({child:33}))).eligibility.status,'legacy_editing');
  assert.equal((await read(fake({task:source({propiedades_extra:{workspace:'render_os'}})}))).eligibility.status,'not_historical');
  assert.equal((await read(fake({task:source({propiedades_extra:{workspace:'render_os',produccion_confirmada_at:'historical'}})}))).eligibility.status,'ready');
  // Malformed historical records remain historical, never silently convertible/empty.
  assert.equal((await read(fake({task:source({propiedades_extra:{workspace:'render_os',produccion_registros:{bad:true}}})}))).eligibility.status,'ready');
});

test('closed content permits only strings, preserves exact text and never returns raw records/private bags',async()=>{
  const original=source();original.propiedades_extra.finance={secret:999};original.private='hidden';
  const before=JSON.stringify(original),result=await read(fake({task:original}));
  assert.deepEqual(Object.keys(result),['version','source','history','eligibility','legacy_editing_tasks']);
  assert.deepEqual(Object.keys(result.source),['id','revision','titulo','cliente','fecha','content']);
  assert.deepEqual(result.source.content,{instructions:'  Instrucciones\nexactas ',script:'Guion\n',material:'javascript:literal',
    recorded_material:'Material legado',feedback:'Feedback',schedule:'Después de almorzar'});
  assert.deepEqual(result.history,{records_count:2,recorded_count:5,declared_count:6,confirmed:false});
  assert.doesNotMatch(JSON.stringify(result),/secret|finance|private|propiedades_extra|cantidad|produccion_registros|child/);
  assert.equal(JSON.stringify(original),before);
  const scalar=source({aclaraciones:null,material_referencia:null,propiedades_extra:{workspace:'render_os',guiones:{bad:true},material:'',Material:'Uppercase',feedback:[1],horario:null}});
  assert.deepEqual((await read(fake({task:scalar}))).source.content,{instructions:'',script:'',material:'',recorded_material:'Uppercase',feedback:'',schedule:''});
});

test('legacy editing dossier projects only stable task references and never copies evidence or private bags',async()=>{
  const childRows=[{id:33,revision:2,titulo:'Edición original',estado:'finalizada',en_workspace:true,propiedades_extra:{finance:'PRIVATE'},salary:999},
    {id:34,revision:1,titulo:'Corrección histórica',estado:'en_revision',en_workspace:false,approval:'not-a-video-approval'}];
  const m=fake({childRows}),value=await read(m);
  assert.equal(value.eligibility.status,'legacy_editing');
  assert.deepEqual(value.legacy_editing_tasks,childRows.map(({id,revision,titulo,estado,en_workspace})=>({id,revision,titulo,estado,en_workspace})));
  assert.doesNotMatch(JSON.stringify(value),/PRIVATE|salary|approval|propiedades_extra/);
  assert.match(m.calls.find(({sql})=>sql.startsWith('SELECT id,revision,titulo,estado')).sql,/ORDER BY id LIMIT 51$/);
  assert.equal((await read(fake())).legacy_editing_tasks.length,0);
  for(const {sql}of m.calls)assert.doesNotMatch(sql,/\b(?:UPDATE|INSERT|DELETE|ALTER)\b/i);
});
test('invalid or oversized dossier fails explicitly without truncating or returning partial task references',async()=>{
  const base={id:33,revision:1,titulo:'Original',estado:'finalizada'};
  for(const row of [{...base,id:'33'},{...base,revision:0},{...base,titulo:null},{...base,estado:{} }])
    await assert.rejects(read(fake({childRows:[row]})),{status:409});
  for(const childRows of [Array.from({length:51},(_,i)=>({...base,id:i+1})),[{...base,titulo:'a'.repeat(20001)}],[{...base,estado:'a'.repeat(101)}]]) {
    const m=fake({childRows});await assert.rejects(read(m),{status:413});
    assert.equal(m.calls.at(-1).sql,'ROLLBACK');assert.equal(m.releases,1);
  }
});
test('malformed/overflow historical quantities are null, not inferred counts; unknown history is not split',async()=>{
  const cases=[
    [{produccion_registros:null},{records_count:0,recorded_count:0,declared_count:null,confirmed:false}],
    [{produccion_registros:'malformed'},{records_count:null,recorded_count:null,declared_count:null,confirmed:false}],
    [{produccion_registros:[{cantidad:'unknown'}],produccion_videos_previstos:'bad'},
      {records_count:1,recorded_count:null,declared_count:null,confirmed:false}],
    [{produccion_registros:[{cantidad:Number.MAX_SAFE_INTEGER},{cantidad:1}],produccion_videos_previstos:'6',produccion_confirmada_at:'historical'},
      {records_count:2,recorded_count:null,declared_count:6,confirmed:true}],
  ];
  for(const [metadata,expected]of cases){
    const value=await read(fake({task:source({propiedades_extra:{workspace:'render_os',...metadata}})}));assert.deepEqual(value.history,expected);
  }
});

test('oversized projected fields fail 413 without silent slicing; exact limits succeed',async()=>{
  for(const [field,max,root]of [['aclaraciones',20000,true],['guiones',20000,false],['material_referencia',4000,true],
    ['material',4000,false],['feedback',20000,false],['horario',20000,false]]){
    const task=source();if(root)task[field]='x'.repeat(max);else task.propiedades_extra[field]='x'.repeat(max);
    await read(fake({task}));
    if(root)task[field]+='x';else task.propiedades_extra[field]+='x';
    const m=fake({task});await assert.rejects(read(m),{status:413});assert.equal(m.calls.at(-1).sql,'ROLLBACK');assert.equal(m.releases,1);
  }
});

test('query/commit failures roll back and release even when rollback itself fails',async()=>{
  for(const fail of [begin,'user','source','registry','child','COMMIT']){
    const m=fake({fail,rollbackFail:true});await assert.rejects(read(m),/Injected/);
    assert.equal(m.calls.at(-1).sql,'ROLLBACK');assert.equal(m.releases,1);
  }
});

test('GET route is closed no-store and retains POST registration; context source has no writes',async()=>{
  const handlers=new Map(),m=fake();
  const router={get(path,handler){handlers.set(`GET ${path}`,handler);},post(path,handler){handlers.set(`POST ${path}`,handler);}};
  registerProductionReconciliationRoutes(router,{pool:m.pool,handle:fn=>fn});
  assert.ok(handlers.has('POST /reconciliaciones'));
  const handler=handlers.get('GET /reconciliaciones/origen/:sourceId');assert.ok(handler);
  const res={headers:{},set(k,v){this.headers[k]=v;return this;},json(value){this.body=value;return this;}};
  await handler({auth,params:{sourceId:'9'},query:{}},res);assert.equal(res.headers['Cache-Control'],'no-store');assert.equal(res.body.version,1);
  const code=readFileSync(new URL('../src/production-reconciliation.js',import.meta.url),'utf8');
  const reader=code.slice(code.indexOf('export async function readProductionReconciliationContext'),code.indexOf('export function registerProductionReconciliationRoutes'));
  assert.match(reader,/await currentAdmin\(db,auth\)/);assert.match(reader,/await hasLegacyProductionSource\(db,source.id,source\)/);
  assert.doesNotMatch(reader,/\b(?:UPDATE|INSERT|DELETE)\b|\.slice\(|\.substring\(|SELECT \*/);
  const post=code.slice(code.indexOf('export async function reconcileProductionHistory'),code.indexOf('\nfunction contextText')).trim();
  // Snapshot only of the pre-existing POST function; context addition cannot
  // silently alter reconciliation writes, revision/receipt gates or replay.
  assert.equal(createHash('sha256').update(post).digest('hex'),'b2e00c2128f4ff2d039f9c1a2f51d10ec7c5e59079da2d0d2e490b7640432d1e');
});
