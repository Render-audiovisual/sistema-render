import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { legacyPieceSelection, normalizeEditorialPiecePatch, readLegacyEditorialPiece, writeEditorialPiece } from '../src/editorial-piece-write.js';

const auth = () => ({id:7,rol:'admin',session_version:2});
const error = status => value => value.status === status;

test('legacy identity is exact, explicit for writes and cannot interpolate a table',()=>{
  assert.deepEqual(legacyPieceSelection('3',{}),{id:3,domain:null});
  assert.deepEqual(legacyPieceSelection('3',{dominio:'historia'},true),{id:3,domain:'historia'});
  assert.throws(()=>legacyPieceSelection('3',{},true),error(428));
  for(const id of ['03','0','-1','3x','2147483648']) assert.throws(()=>legacyPieceSelection(id,{}),error(400));
  for(const query of [{dominio:['historia','publicacion']},{dominio:'historias'},{dominio:'__proto__'},{dominio:'publicacion',extra:'x'}]) {
    assert.throws(()=>legacyPieceSelection('3',query),error(400));
  }
});

test('all writers require observed numeric revision; text clearing and null omission differ',()=>{
  assert.throws(()=>normalizeEditorialPiecePatch('historia',{copy:'x'}),error(428));
  for(const value of [-1,1.2,'0',null,Number.MAX_SAFE_INTEGER+1]) {
    assert.throws(()=>normalizeEditorialPiecePatch('historia',{copy:'x',expected_revision:value}),error(400));
  }
  assert.deepEqual(normalizeEditorialPiecePatch('historia',{copy:'',idea:null,expected_revision:0}),{
    expected_revision:0,fields:{copy:''},
  });
  assert.throws(()=>normalizeEditorialPiecePatch('historia',{copy:null,expected_revision:0}),error(400));
});

test('closed per-domain fields reject forged evidence, types, dates and invalid amounts',()=>{
  for(const [key,value] of [['fecha_publicación_real','2026-10-01'],['revision',9],['cliente_id',1],['metadata',{}]]) {
    assert.throws(()=>normalizeEditorialPiecePatch('historia',{expected_revision:0,[key]:value},true),error(400));
  }
  for(const fields of [{copy:{}},{copy:'a\0b'},{prioridad:'urgente'},{fecha_programada:'2026-02-30'},
    {fecha_programada:'2026-01-01T00:00:00Z'},{metadata:[]},{tipo:'flyer'},{duracion_segundos:'4'},
    {num_imagenes:-1},{estado:'unrecognized'}]) {
    assert.throws(()=>normalizeEditorialPiecePatch('publicacion',{expected_revision:0,...fields}),error(400));
  }
  assert.equal(normalizeEditorialPiecePatch('publicacion',{expected_revision:0,num_imagenes:0}).fields.num_imagenes,0);
  assert.throws(()=>normalizeEditorialPiecePatch('historia',{expected_revision:0,copy:'x'.repeat(1024*1024)}),error(413));
  assert.throws(()=>normalizeEditorialPiecePatch('publicacion',{expected_revision:0,estado:'publicada'}),error(409));
});

function fake({user=auth(),current={cliente_id:11,estado:'pendiente'},revision=0,collisions=null,fault=null}={}) {
  const trace=[];
  const db={
    async query(sql,params){
      trace.push([sql,params]);
      if(fault?.test(sql)) throw new Error('synthetic editorial failure');
      if(sql.includes('FROM usuarios')) return {rows:user?[{activo:true,...user}]:[]};
      if(sql.includes('UNION ALL'))return {rows:collisions??[{dominio:'historia'}]};
      if(sql.startsWith('SELECT cliente_id FROM'))return {rows:[{cliente_id:11}]};
      if(sql.startsWith('SELECT id FROM clientes'))return {rows:[{id:11}]};
      if(sql.includes('FOR UPDATE'))return {rows:[current]};
      if(sql.startsWith('SELECT revision FROM'))return {rows:revision?[{revision:String(revision)}]:[]};
      return {rows:[]};
    },
    release(discard){trace.push(['RELEASE',discard]);},
  };
  return {trace,db,pool:{connect:async()=>db}};
}

test('GET ambiguity rolls back before selecting one domain; invalid identity never leases',async()=>{
  const f=fake({collisions:[{dominio:'historia'},{dominio:'publicacion'}]});
  await assert.rejects(readLegacyEditorialPiece(f.pool,auth(),'3',{}),error(409));
  assert.ok(f.trace.some(([sql])=>sql==='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'));
  assert.equal(f.trace.some(([sql])=>sql.startsWith('SELECT p.*')),false);
  assert.equal(f.trace.at(-2)[0],'ROLLBACK'); assert.equal(f.trace.at(-1)[0],'RELEASE');
  let leased=false;
  await assert.rejects(readLegacyEditorialPiece({connect:async()=>{leased=true;}},{id:'7'},'3',{}),error(401));
  assert.equal(leased,false);
});

test('write captures identity before lease and denies missing, revoked, inactive or demoted actor before DML',async()=>{
  for(const user of [null,{id:7,rol:'admin',session_version:3},{id:7,rol:'community',session_version:2},{id:7,rol:'admin',session_version:2,activo:false}]) {
    const f=fake({user});
    await assert.rejects(writeEditorialPiece(f.pool,auth(),'historia','3',{copy:'new',expected_revision:0}),
      e=>[401,403].includes(e.status));
    assert.equal(f.trace.some(([sql])=>sql.startsWith('UPDATE ')),false);
    assert.ok(f.trace[1][0].includes('pg_advisory_xact_lock(20261019, 1)'));
    assert.ok(f.trace[2][0].endsWith('FOR SHARE'));
  }
  const identity=auth(), f=fake({revision:1});
  f.pool.connect=async()=>{identity.id=8;identity.session_version=3;return f.db;};
  await assert.rejects(writeEditorialPiece(f.pool,identity,'historia','3',{copy:'new',expected_revision:0}),error(409));
  assert.deepEqual(f.trace.find(([sql])=>sql.includes('FROM usuarios'))[1],[7]);
});

test('stale revision and published-state withdrawal reject without any write',async()=>{
  for(const options of [{revision:1},{current:{cliente_id:11,estado:'publicada'}}]) {
    const f=fake(options);
    await assert.rejects(writeEditorialPiece(f.pool,auth(),'historia','3',{estado:'pendiente',expected_revision:0}),error(409));
    assert.equal(f.trace.some(([sql])=>sql.startsWith('UPDATE ')),false);
    assert.equal(f.trace.at(-2)[0],'ROLLBACK');
  }
});

test('SQL fault cannot acknowledge success and releases after rollback',async()=>{
  const f=fake({fault:/^UPDATE historias/});
  await assert.rejects(writeEditorialPiece(f.pool,auth(),'historia','3',{copy:'',expected_revision:0}),/synthetic editorial failure/);
  assert.equal(f.trace.some(([sql])=>sql==='COMMIT'),false);
  assert.equal(f.trace.at(-2)[0],'ROLLBACK');assert.equal(f.trace.at(-1)[0],'RELEASE');
});

test('server uses one service for all three writers, no publication timestamp synthesis or separate task completion',()=>{
  const server=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  for(const path of ['/historias/:id','/publicaciones/:id','/piezas/:id']) {
    const from=server.indexOf(`router.patch("${path}"`), to=server.indexOf('\n});',from);
    const block=server.slice(from,to);
    assert.ok(block.includes('writeEditorialPiece('),path);
    assert.ok(block.includes("res.set('Cache-Control','no-store')"),path);
    assert.doesNotMatch(block,/pool\.query|completeLinkedAutoTasks|UPDATE publicaciones|UPDATE historias/);
  }
  const source=readFileSync(new URL('../src/editorial-piece-write.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/UPDATE tareas|INSERT INTO editorial_publicacion_eventos|fecha_publicación_real\s*=/);
  assert.ok(source.indexOf("await db.query('COMMIT')",source.indexOf('export async function writeEditorialPiece'))<source.lastIndexOf('return result'));
});
