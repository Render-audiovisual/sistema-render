import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProjectsRouter, normalizeProjectChild, projectChildCreationHash } from '../src/projects.js';
import { CORE_SCHEMA_COLUMNS, assertCoreSchemaReady } from '../src/startup-schema.js';

const P='aaaaaaaa-0000-4000-8000-000000000001';
const R='bbbbbbbb-0000-4000-8000-000000000002';
const actor={id:7,rol:'admin',activo:true,session_version:3};
const input=()=>({request_id:R,expected_revision:1,titulo:'Primera entrega'});

// Actual router callbacks and transaction wrapper; only SQL transport is mocked.
function fixture(){
  const routes=new Map(), calls=[];
  let receipt=null, children=[], revision=1, archived=false, cap=0, fault='', auth={...actor}, requestAuth={...actor}, ownerId=7, releases=[];
  const db={release(error){releases.push(error);},async query(sql,params=[]){
    calls.push({sql,params});
    if(fault && sql.includes(fault))throw new Error('synthetic storage failure');
    if(sql.includes('FROM usuarios WHERE id=$1'))return{rows:[auth]};
    if(sql.includes('FROM proyectos WHERE id=$1 FOR UPDATE'))return{rows:[{id:P,responsable_id:ownerId,archivado:archived,revision}]};
    if(sql.includes('FROM project_child_create_receipts WHERE'))return{rows:receipt&&receipt.actor_id===params[0]&&receipt.request_id===params[1]?[{...receipt}]:[]};
    if(sql.startsWith('SELECT id FROM proyecto_')&&sql.includes('FOR SHARE'))return{rows:children.filter(c=>c.id===params[1]&&c.proyecto_id===params[0]).map(c=>({id:c.id}))};
    if(sql.startsWith('SELECT count(*)'))return{rows:[{total:cap}]};
    if(sql.startsWith('SELECT COALESCE(max'))return{rows:[{posicion:0}]};
    if(sql.startsWith('INSERT INTO project_child_create_receipts')){receipt=Object.fromEntries(['actor_id','request_id','proyecto_id','recurso_tipo','recurso_id','expected_revision','payload_hash'].map((key,i)=>[key,params[i]]));return{rows:[]};}
    if(sql.startsWith('INSERT INTO proyecto_')&&!sql.includes('proyecto_actividad')){children.push({id:params[0],proyecto_id:params[1],titulo:params[2],estado:'pendiente',url:'',observaciones:'',contenido_revision:1,entregable_revision:1,table:sql.match(/^INSERT INTO (\w+)/)[1]});return{rows:[]};}
    if(sql.startsWith('UPDATE proyectos')){revision++;return{rows:[{revision}]};}
    if(sql.startsWith('SELECT p.id,p.titulo'))return{rows:[{id:P,titulo:'Proyecto',cliente_id:1,cliente_nombre:'Cliente',responsable_id:7,responsable_nombre:'Actor',tipo:'web',estado:'en_curso',archivado:archived,revision,tareas:0,tareas_visibles:0,finalizadas:0,hitos:0,entregables:0}]};
    if(sql.startsWith('SELECT id,titulo,posicion'))return{rows:children.filter(c=>c.table==='proyecto_etapas')};
    if(sql.startsWith('SELECT id,etapa_id,titulo'))return{rows:children.filter(c=>c.table==='proyecto_hitos')};
    if(sql.startsWith('SELECT d.id,d.titulo'))return{rows:children.filter(c=>c.table==='proyecto_entregables')};
    if(sql==='ROLLBACK'){return{rows:[]};}
    return{rows:[]};
  }};
  const router={use(){},get(path,fn){routes.set(`GET ${path}`,fn);},post(path,fn){routes.set(`POST ${path}`,fn);},patch(){},put(){},delete(){}};
  createProjectsRouter({express:{Router:()=>router},pool:{connect:async()=>db}});
  return{calls,releases,get receipt(){return receipt;},get children(){return children;},
    setReceipt(value){receipt=value;},setChildren(value){children=value;},setRevision(value){revision=value;},setArchived(value){archived=value;},setActor(value){auth=value;},setRequestActor(value){requestAuth=value;},setOwner(value){ownerId=value;},setCap(value){cap=value;},setFault(value){fault=value;},
    async send(kind='etapas',body=input(),projectId=P){const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.body=value;}};
      let error;await routes.get(`POST /:id/${kind}`)({auth:{...requestAuth},params:{id:projectId},body},res,e=>{error=e;});return{...res,error};}
  };
}
const writes=calls=>calls.filter(c=>/^(INSERT|UPDATE|DELETE)/.test(c.sql));

test('closed create validation requires exact UUID and canonicalizes uppercase without coercion',()=>{
  for(const kind of ['etapas','hitos','entregables']){
    const absent={...input()};delete absent.request_id;
    assert.throws(()=>normalizeProjectChild(kind,absent,{create:true}),{status:428});
    for(const request_id of [null,1,{},[R],R+'\n',' '+R,R+' '])assert.throws(()=>normalizeProjectChild(kind,{...input(),request_id},{create:true}),{status:400});
    assert.equal(normalizeProjectChild(kind,{...input(),request_id:R.toUpperCase()},{create:true}).request_id,R);
  }
  assert.throws(()=>normalizeProjectChild('etapas',{...input(),actor_id:7},{create:true}),{status:400});
  assert.throws(()=>normalizeProjectChild('etapas',input()),{status:400},'edits do not accept creation keys');
});
test('normalized immutable hash binds project, kind, original revision and content, not request key/order',()=>{
  const n=normalizeProjectChild('hitos',input(),{create:true});const hash=projectChildCreationHash(P,'hitos',n);
  assert.match(hash,/^[a-f0-9]{64}$/);
  assert.equal(hash,projectChildCreationHash(P,'hitos',{titulo:n.titulo,expected_revision:1,request_id:P}));
  for(const [project,kind,body]of [[R,'hitos',n],[P,'etapas',n],[P,'hitos',{...n,expected_revision:2}],[P,'hitos',{...n,titulo:'Otra'}]])assert.notEqual(hash,projectChildCreationHash(project,kind,body));
});
for(const kind of ['etapas','hitos','entregables'])test(`${kind}: fresh atomic receipt then current-state replay without duplicate writes/activity or cap/CAS`,async()=>{
  const f=fixture(),fresh=await f.send(kind);assert.equal(fresh.error,undefined);assert.equal(fresh.statusCode,201,JSON.stringify(fresh.body));
  const c=fresh.body.creacion;
  assert.deepEqual(c,{actor_id:7,request_id:R,proyecto_id:P,recurso_tipo:kind,recurso_id:f.children[0].id,expected_revision:1});
  assert.equal(fresh.body.replayed,false);assert.equal(fresh.body.proyecto.revision,2);
  const sql=f.calls.map(c=>c.sql);
  assert.equal(sql[0],'BEGIN ISOLATION LEVEL READ COMMITTED');
  const actor=sql.findIndex(s=>s.startsWith('SELECT id,nombre,rol,activo,session_version FROM usuarios'));
  const objective=sql.findIndex(s=>s.includes("hashtext('vinculo-objetivo-mensual')"));
  const mutex=sql.findIndex(s=>s.includes("hashtext('proyecto-vinculos')"));
  assert.ok(objective>0 && objective<mutex && mutex<actor);
  assert.ok(sql[actor].endsWith('FOR SHARE'));
  assert.ok(actor<sql.findIndex(s=>s.includes('FROM proyectos WHERE')));
  assert.ok(sql.findIndex(s=>s.includes('pg_advisory_xact_lock'))<sql.findIndex(s=>s.includes('FROM proyectos WHERE')));
  assert.ok(sql.findIndex(s=>s.startsWith('INSERT INTO project_child_create_receipts'))<sql.indexOf('COMMIT'));
  assert.equal(f.calls.filter(c=>c.sql.startsWith('INSERT INTO proyecto_actividad')).length,1);
  f.setRevision(9);f.setCap(999);f.setChildren(f.children.map(c=>({...c,titulo:'Cambió después'})));
  const start=f.calls.length,replay=await f.send(kind);
  assert.equal(replay.statusCode,200);assert.equal(replay.body.replayed,true);assert.deepEqual(replay.body.creacion,c);
  assert.equal(replay.body.proyecto.revision,9);assert.equal(replay.body.proyecto[kind][0].titulo,'Cambió después');
  assert.equal(writes(f.calls.slice(start)).length,0);assert.ok(!f.calls.slice(start).some(c=>c.sql.startsWith('SELECT count(*)')));
  assert.ok(f.calls.slice(start).some(c=>c.sql.includes(`FROM proyecto_${kind} WHERE proyecto_id=$1 AND id=$2 FOR SHARE`)));
});
test('same key mismatching original revision, payload, project or kind returns409 before any domain DML',async()=>{
  for(const mode of ['revision','payload','project','kind']){
    const f=fixture();await f.send();const start=f.calls.length;
    const body={...input(),...(mode==='revision'?{expected_revision:2}:mode==='payload'?{titulo:'Otra'}:{})};
    const result=await f.send(mode==='kind'?'hitos':'etapas',body,mode==='project'?R:P);
    assert.equal(result.statusCode,409,mode);assert.equal(writes(f.calls.slice(start)).length,0);assert.equal(f.calls.at(-1).sql,'ROLLBACK');
  }
});
test('current role, epoch, inactive account and archived/removed ownership block replay before receipt exposure',async()=>{
  for(const mode of ['role','epoch','inactive','archive','owner']){
    const f=fixture();await f.send();const start=f.calls.length;
    if(mode==='role')f.setActor({...actor,rol:'edicion'});
    if(mode==='epoch')f.setActor({...actor,session_version:4});
    if(mode==='inactive')f.setActor({...actor,activo:false});
    if(mode==='archive')f.setArchived(true);
    // A valid current staff session lost structural responsibility after creation.
    if(mode==='owner'){f.setActor({...actor,rol:'diseno'});f.setRequestActor({...actor,rol:'diseno'});f.setOwner(8);}
    const result=await f.send();
    assert.equal(result.statusCode,['archive','owner'].includes(mode)?403:401,mode);
    assert.equal(writes(f.calls.slice(start)).length,0);
    assert.ok(!f.calls.slice(start).some(c=>c.sql.includes('FROM project_child_create_receipts')));
  }
});
test('receipt key is actor scoped; another authorized actor may intentionally create with the same UUID',async()=>{
  const f=fixture();assert.equal((await f.send()).statusCode,201);
  f.setActor({...actor,id:8});f.setRequestActor({...actor,id:8});
  const result=await f.send('etapas',{...input(),expected_revision:2});
  assert.equal(result.statusCode,201);assert.equal(result.body.creacion.actor_id,8);assert.equal(f.children.length,2);
});
test('strict project UUID rejects newline before project locks/receipt or DML',async()=>{
  const f=fixture();const result=await f.send('etapas',input(),P+'\n');
  assert.equal(result.statusCode,400);assert.equal(writes(f.calls).length,0);
  assert.ok(!f.calls.some(c=>c.sql.includes('pg_advisory_xact_lock')));
});
test('receipt tombstone with missing child is409, never recreated',async()=>{
  const f=fixture();await f.send();f.setChildren([]);const start=f.calls.length;
  const result=await f.send();assert.equal(result.statusCode,409);assert.equal(writes(f.calls.slice(start)).length,0);
});
test('new key with stale revision fails CAS; equal content with distinct fresh keys creates intentionally distinct resources',async()=>{
  const f=fixture();await f.send();let start=f.calls.length;
  assert.equal((await f.send('etapas',{...input(),request_id:P})).statusCode,409);assert.equal(writes(f.calls.slice(start)).length,0);
  assert.equal((await f.send('etapas',{...input(),request_id:P,expected_revision:2})).statusCode,201);
  assert.equal(f.children.length,2);assert.notEqual(f.children[0].id,f.children[1].id);
});
test('receipt insertion/readback faults roll back and release, never ACK a partial creation',async()=>{
  for(const fault of ['INSERT INTO project_child_create_receipts','SELECT p.id,p.titulo']){
    const f=fixture();f.setFault(fault);const result=await f.send();assert.ok(result.error);
    assert.equal(result.body,undefined);assert.equal(f.calls.at(-1).sql,'ROLLBACK');assert.equal(f.releases.length,1);
    assert.ok(!f.calls.some(c=>c.sql==='COMMIT'));
  }
});
test('readiness requires088 columns/types and enabled immutable trigger binding without repair',async()=>{
  assert.deepEqual(CORE_SCHEMA_COLUMNS.project_child_create_receipts,{actor_id:'integer',request_id:'uuid',proyecto_id:'uuid',recurso_tipo:'text',recurso_id:'uuid',expected_revision:'integer',payload_hash:'text',committed_at:'timestamp with time zone'});
  const rows=Object.entries(CORE_SCHEMA_COLUMNS).flatMap(([table,cols])=>Object.entries(cols).map(([column,type])=>({table_name:table,column_name:column,data_type:type})));
  for(const mode of ['ok','missing','wrongtype','trigger']){
    const queries=[];const db={async query(sql,params){queries.push({sql,params});
      if(sql.includes('current_schemas'))return{rows:[{schemas:['public']}]};
      if(sql.includes('editing_progress_ready'))return{rows:[{editing_progress_ready:true}]};
      if(sql.includes('pg_constraint'))return{rows:[{comment_actor_ready:true}]};
      if(sql.includes('information_schema'))return{rows:rows.flatMap(r=>r.table_name==='project_child_create_receipts'&&r.column_name==='payload_hash'?(mode==='missing'?[]:mode==='wrongtype'?[{...r,data_type:'jsonb'}]:[r]):[r])};
      assert.match(sql,/project_child_create_receipts'::regclass/);assert.match(sql,/t\.tgtype=27/);assert.equal(params[3],'project_child_create_receipt_immutable');
      return{rows:[{ready:true,reference_ready:true,personal_list_receipt_ready:true,project_child_receipt_ready:mode!=='trigger',task_comment_receipt_ready:true,block_receipt_ready:true}]};
    }};
    if(mode==='ok')await assertCoreSchemaReady(db);else await assert.rejects(assertCoreSchemaReady(db));
    assert.equal(writes(queries).length,0);
  }
  const migration=readFileSync(new URL('../migrations/088_project_child_create_receipts.sql',import.meta.url),'utf8');
  assert.match(migration,/PRIMARY KEY\(actor_id,request_id\)/);assert.match(migration,/BEFORE UPDATE OR DELETE/);
  assert.doesNotMatch(migration,/recurso_id UUID[^\n]*REFERENCES|ON DELETE CASCADE/);
});
