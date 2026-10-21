import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeEditorialCreate,editorialCreateHash,createEditorialPiece} from '../src/editorial-piece-create.js';

const key='ab123456-1234-1234-1234-123456789abc';
const body=()=>({request_id:key,tipo:'historia',cliente_id:11,responsable_id:7,fecha_programada:'2026-10-22'});
const actor=()=>({id:7,session_version:2,rol:'admin'});
const status=n=>error=>error.status===n;

test('creation has a mandatory actor-scoped UUID and stable recipient ID, never a name default',()=>{
  const missing=body();delete missing.request_id;
  assert.throws(()=>normalizeEditorialCreate(missing),status(428));
  for(const request_id of [null,123,'bad','0'.repeat(37)])assert.throws(()=>normalizeEditorialCreate({...body(),request_id}),status(400));
  for(const responsable_id of [undefined,null,'7',0,-1,2147483648]) {
    assert.throws(()=>normalizeEditorialCreate({...body(),responsable:'Augusto',responsable_id}),status(400));
  }
  assert.equal(normalizeEditorialCreate({...body(),request_id:key.toUpperCase()}).requestId,key);
});

test('canonical defaults and key order are stable; labels/request IDs cannot alter the business hash',()=>{
  const a=normalizeEditorialCreate(body());
  const b=normalizeEditorialCreate({prioridad:'media',copy:'',...body(),estado:'pendiente',responsable:'Renamed owner'});
  assert.deepEqual(a.input,b.input);assert.equal(editorialCreateHash(a.input),editorialCreateHash(b.input));
  const reversed=Object.fromEntries(Object.entries(a.input).reverse());
  assert.equal(editorialCreateHash(a.input),editorialCreateHash(reversed));
  for(const patch of [{responsable_id:8},{cliente_id:12},{tipo:'video'},{idea:'changed'},
    {copy:'changed'},{material_referencia:'https://example.invalid'},{fecha_programada:'2026-10-23'}]) {
    assert.notEqual(editorialCreateHash(a.input),editorialCreateHash(normalizeEditorialCreate({...body(),...patch}).input));
  }
});

test('closed typed creation cannot fabricate publication, arbitrary metadata or normalized impossible dates',()=>{
  for(const patch of [{metadata:{}},{fecha_publicación_real:'2026-01-01'},
    {tipo:'reel'},{copy:{}},{idea:['x']},{copy:'a\0b'},{prioridad:'urgent'},
    {fecha_programada:'2026-02-30'},{fecha_programada:'0001-01-01'},{fecha_programada:'2026-10-22T00:00:00Z'},
    {cliente_id:'11'},{responsable:{}},{estado:'inventado'}]) {
    assert.throws(()=>normalizeEditorialCreate({...body(),...patch}),status(400));
  }
  assert.throws(()=>normalizeEditorialCreate({...body(),estado:'publicada'}),status(409));
  assert.throws(()=>normalizeEditorialCreate({...body(),copy:'x'.repeat(1024*1024)}),status(413));
  assert.equal(normalizeEditorialCreate({...body(),copy:''}).input.copy,'');
});

function deniedPool(user,{receipt=null,rollbackFault=false}={}) {
  const trace=[];
  const db={async query(sql,params){
    trace.push([sql,params]);
    if(sql.includes('FROM usuarios WHERE'))return{rows:user?[{id:7,rol:'admin',activo:true,session_version:2,...user}]:[]};
    if(sql.includes('FROM editorial_create_receipts'))return{rows:receipt?[receipt]:[]};
    if(sql==='ROLLBACK'&&rollbackFault)throw new Error('rollback unavailable');
    return{rows:[]};
  },release(error){trace.push(['RELEASE',error]);}};
  return{db,trace,pool:{connect:async()=>db}};
}

test('identity is captured before lease; rejected authority never reads receipts or writes',async()=>{
  for(const user of [null,{session_version:3},{activo:false},{rol:'community'}]) {
    const f=deniedPool(user);
    await assert.rejects(createEditorialPiece(f.pool,actor(),body()),e=>[401,403].includes(e.status));
    assert.equal(f.trace[0][0],'BEGIN ISOLATION LEVEL READ COMMITTED');
    assert.ok(f.trace[1][0].includes('pg_advisory_xact_lock(20261019, 1)'));
    assert.ok(f.trace[2][0].endsWith('FOR SHARE'));
    assert.equal(f.trace.some(([sql])=>sql.includes('FROM editorial_create_receipts')||sql.startsWith('INSERT')),false);
    assert.equal(f.trace.at(-2)[0],'ROLLBACK');assert.equal(f.trace.at(-1)[0],'RELEASE');
  }
  const observed=actor(),f=deniedPool({});
  f.pool.connect=async()=>{observed.id=9;observed.session_version=9;return f.db;};
  await assert.rejects(createEditorialPiece(f.pool,observed,body()));
  assert.deepEqual(f.trace.find(([sql])=>sql.includes('FROM usuarios WHERE'))[1],[7]);
});

test('a reused key with changed intent fails before recipient/client locks and preserves original error on rollback failure',async()=>{
  const f=deniedPool({},{receipt:{payload_hash:'different'},rollbackFault:true});
  await assert.rejects(createEditorialPiece(f.pool,actor(),body()),status(409));
  assert.equal(f.trace.some(([sql])=>sql.includes('ANY(')||sql.includes('FROM clientes')||sql.startsWith('INSERT')),false);
  assert.equal(f.trace.at(-1)[0],'RELEASE');assert.match(f.trace.at(-1)[1].message,/rollback unavailable/);
});

test('migration is additive, immutable and retains tombstone identities without cascading business deletion',()=>{
  const sql=readFileSync(new URL('../migrations/082_editorial_create_receipts.sql',import.meta.url),'utf8');
  assert.match(sql,/PRIMARY KEY \(actor_user_id,request_id\)/);
  assert.match(sql,/REFERENCES usuarios\(id\) ON DELETE RESTRICT/);
  assert.match(sql,/BEFORE UPDATE OR DELETE/);
  assert.doesNotMatch(sql,/ON DELETE CASCADE|REFERENCES (historias|publicaciones|tareas)|UPDATE (historias|publicaciones|tareas)|INSERT INTO/);
});

test('server delegates creation once; service commits receipt and business together without post-insert recipient resolution',()=>{
  const server=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  const from=server.indexOf('async function editorialCreateHandler'),block=server.slice(from,server.indexOf('\n}',from));
  assert.ok(block.includes('createEditorialPiece('));assert.ok(block.includes("res.set('Cache-Control','no-store')"));
  assert.doesNotMatch(block,/pool.query|INSERT INTO|crearTareaAuto/);
  for(const route of ['/piezas','/editorial-creaciones']) assert.ok(server.includes(`router.post("${route}", requireRole("admin"), editorialCreateHandler)`));
  const source=readFileSync(new URL('../src/editorial-piece-create.js',import.meta.url),'utf8');
  assert.equal(source.match(/await resolveTaskAssignments/g)?.length,1);
  assert.ok(source.indexOf('await resolveTaskAssignments')<source.indexOf('INSERT INTO ${table}'));
  assert.doesNotMatch(source,/UPDATE (historias|publicaciones|tareas)|INSERT INTO editorial_publicacion_eventos|fecha_publicación_real\s*=/);
});
