import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeEditorialArchiveInput,normalizeEditorialArchiveQuery,editorialArchiveHash,changeEditorialArchive,readEditorialArchive} from '../src/editorial-archive.js';
import {normalizeEditorialPiecePatch} from '../src/editorial-piece-write.js';

const key='11111111-1111-4111-8111-111111111111';
const input=()=>({request_id:key,expected_revision:0});
const auth=()=>({id:7,rol:'admin',session_version:2});
const status=n=>error=>error.status===n;

test('archive operation is typed, explicitly observed and bounds its audit reason',()=>{
  assert.deepEqual(normalizeEditorialArchiveInput('archivar',input()),{...input(),motivo:''});
  for(const body of [{request_id:key},{expected_revision:0}])assert.throws(()=>normalizeEditorialArchiveInput('archivar',body),status(428));
  for(const body of [{...input(),expected_revision:'0'},{...input(),expected_revision:-1},{...input(),request_id:'bad'},
    {...input(),motivo:[]},{...input(),motivo:'x'.repeat(1001)},{...input(),motivo:'a\0b'},{...input(),archived:true}]) {
    assert.throws(()=>normalizeEditorialArchiveInput('archivar',body),status(400));
  }
  assert.throws(()=>normalizeEditorialArchiveInput('delete',input()),status(400));
});

test('archive pagination requires one exact domain and closed canonical scalar filters',()=>{
  assert.deepEqual(normalizeEditorialArchiveQuery({dominio:'historia'}),{dominio:'historia',cliente_id:null,offset:0,limit:20});
  for(const query of [{},{dominio:['historia']},{dominio:'historias'},{dominio:'publicacion',cliente_id:'01'},
    {dominio:'historia',limit:'51'},{dominio:'historia',offset:'1.5'},{dominio:'historia',unknown:'x'}]) {
    assert.throws(()=>normalizeEditorialArchiveQuery(query),status(400));
  }
});

test('receipt hash binds domain, identity, action, observed revision and reason',()=>{
  const identity={domain:'historia',id:3},value=normalizeEditorialArchiveInput('archivar',input());
  const hash=editorialArchiveHash(identity,'archivar',value);assert.match(hash,/^[a-f0-9]{64}$/);
  for(const [piece,action,body] of [[{...identity,id:4},'archivar',value],[{...identity,domain:'publicacion'},'archivar',value],
    [identity,'restaurar',value],[identity,'archivar',{...value,expected_revision:1}],[identity,'archivar',{...value,motivo:'Changed'}]]) {
    assert.notEqual(editorialArchiveHash(piece,action,body),hash);
  }
});

test('ordinary metadata cannot bypass archive policy or forge archive attribution',()=>{
  for(const field of ['archivado_tablero','archivado_at','archivado_por','restaurado_por']) {
    assert.throws(()=>normalizeEditorialPiecePatch('publicacion',{expected_revision:0,metadata:{[field]:false}}),status(400));
  }
  assert.deepEqual(normalizeEditorialPiecePatch('historia',{expected_revision:0,metadata:{hora:'11:00'}}).fields,{metadata:{hora:'11:00'}});
});

function fake(user={id:7,rol:'admin',activo:true,session_version:2}) {
  const trace=[],db={async query(sql,params){
    trace.push([sql,params]);
    if(sql.includes('FROM usuarios WHERE'))return{rows:user?[user]:[]};
    if(sql.startsWith('SELECT count('))return{rows:[{total:0}]};
    return{rows:[]};
  },release(discard){trace.push(['RELEASE',discard]);}};
  return{trace,db,pool:{connect:async()=>db}};
}

test('write authority is captured before lease and held before any receipt or domain work',async()=>{
  for(const user of [null,{id:7,rol:'admin',activo:false,session_version:2},{id:7,rol:'community',activo:true,session_version:2},
    {id:7,rol:'admin',activo:true,session_version:3}]) {
    const f=fake(user);
    await assert.rejects(changeEditorialArchive(f.pool,auth(),'historia','3','archivar',input()),error=>[401,403].includes(error.status));
    assert.ok(f.trace[1][0].includes('pg_advisory_xact_lock(20261019, 1)'));
    assert.ok(f.trace[2][0].endsWith('FOR SHARE'));
    assert.equal(f.trace.some(([sql])=>sql.includes('FROM editorial_archive_events')||/^(INSERT|UPDATE|DELETE)/.test(sql)),false);
    assert.equal(f.trace.at(-2)[0],'ROLLBACK');assert.equal(f.trace.at(-1)[0],'RELEASE');
  }
  const f=fake(),observed=auth();f.pool.connect=async()=>{observed.id=8;return f.db;};
  await assert.rejects(changeEditorialArchive(f.pool,observed,'historia','3','archivar',input()),status(404));
  assert.deepEqual(f.trace.find(([sql])=>sql.includes('FROM usuarios WHERE'))[1],[7]);
});

test('read inventory is a read-only repeatable snapshot with admin check, no row locks or writes',async()=>{
  const f=fake();
  assert.deepEqual(await readEditorialArchive(f.pool,auth(),{dominio:'historia'}),{
    version:1,dominio:'historia',offset:0,limit:20,total:0,has_more:false,items:[],
  });
  assert.equal(f.trace[0][0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(f.trace.some(([sql])=>/FOR (SHARE|UPDATE)|^(INSERT|UPDATE|DELETE)/.test(sql)),false);
  const denied=fake({id:7,rol:'community',activo:true,session_version:2});
  await assert.rejects(readEditorialArchive(denied.pool,{...auth(),rol:'community'},{dominio:'historia'}),status(403));
  assert.equal(denied.trace.some(([sql])=>sql.includes('count(*)')),false);
});

test('source preserves history, uses version after piece wait and permanently retires legacy hard deletes',()=>{
  const source=readFileSync(new URL('../src/editorial-archive.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/DELETE FROM|UPDATE tareas|UPDATE cliente_objetivo|INSERT INTO editorial_publicacion_eventos|fecha_publicación_real\s*=/);
  assert.match(source,/if\(lock\)\s*\{[\s\S]*SELECT revision,current_event_id FROM editorial_publicacion_versiones/);
  const server=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  for(const route of ['/historias/:id','/publicaciones/:id']) {
    const start=server.indexOf(`router.delete("${route}"`),block=server.slice(start,server.indexOf('\n});',start));
    assert.match(block,/status\(410\)/);assert.doesNotMatch(block,/pool\.|DELETE FROM/);
  }
  const migration=readFileSync(new URL('../migrations/083_editorial_archive_events.sql',import.meta.url),'utf8');
  assert.match(migration,/UNIQUE\(actor_user_id,request_id\)/);assert.match(migration,/BEFORE UPDATE OR DELETE/);
  assert.match(migration,/result_revision > expected_revision/);
  assert.doesNotMatch(migration,/ON DELETE CASCADE|UPDATE (historias|publicaciones|tareas)|INSERT INTO/);
});
