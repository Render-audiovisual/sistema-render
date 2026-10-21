import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFeedbackNotesPage, readFeedbackNoteDetail, readLegacyFeedbackNotes, normalizeFeedbackNotesQuery, feedbackNoteMetadataDto } from '../src/feedback-notes-read.js';

const auth=()=>({id:7,rol:'custom_role',session_version:3});
const time='2026-10-21T12:00:00.000001Z';
const row=(id,patch={})=>({id,titulo:`Note ${id}`,contenido:'Known content',categoria:'general',feedback:{},creado_por:'Owner',modificado_por:'Editor',eliminado_at:null,created_at:'2026-10-01T12:00:00.000000Z',updated_at:time,...patch});
const rows=count=>Array.from({length:count},(_,index)=>row(count-index));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
test('shared ACK metadata projection drops legacy finance/private keys, preserves provenance and never mutates source',()=>{
  const allowed={cliente:'Acme',responsable:'Alex',responsables:['Alex','🌈'],referencia:'Literal <b>note</b>',estado:'pendiente',vigencia:'puntual',flujo:'feedback',origen:'wilson_telegram',confirmado_por:'Actor',confirmado_por_id:7,confirmado_at:'2026-10-21T00:00:00.000Z',provenance_version:1};
  const source={...allowed,financial:{salary:999},importe:100,metadata:{private:true},wilson_idempotency_key:'secret'},before=structuredClone(source);
  const projected=feedbackNoteMetadataDto(source);assert.deepEqual(projected,allowed);assert.deepEqual(source,before);
  assert.notEqual(projected.responsables,source.responsables);assert.deepEqual(feedbackNoteMetadataDto(null),{});assert.deepEqual(feedbackNoteMetadataDto(undefined),{});
  for(const invalid of [[],123,'bad',{cliente:{}},{responsables:['valid',{}]},{confirmado_por_id:'7'}])assert.throws(()=>feedbackNoteMetadataDto(invalid),error=>error.status===500);
});
// A leased-client double, not a claim of physical PG snapshot/concurrency proof.
function fixture({notes=rows(3),clients=['Acme'],actor={...auth(),activo:true},leaseGate,commitGate,failureAt,rollbackFails=false}={}){
  const calls=[],failure=Error('synthetic query failure'),rollbackError=Error('rollback failure');let leases=0;
  const db={async query(sql,params=[]){
    const compact=sql.replace(/\s+/g,' ').trim();calls.push({sql:compact,params:structuredClone(params)});
    if(compact==='ROLLBACK'){if(rollbackFails)throw rollbackError;return{rows:[]};}
    if(failureAt&&compact.includes(failureAt))throw failure;
    if(compact.startsWith('BEGIN'))return{rows:[]};
    if(compact==='COMMIT'){if(commitGate)await commitGate.promise;return{rows:[]};}
    if(compact.startsWith('SELECT id,rol,activo,session_version'))return{rows:actor?[structuredClone(actor)]:[]};
    const matching=notes.filter(note=>(note.eliminado_at!==null)===params[0]);
    if(compact.startsWith('SELECT nombre FROM clientes'))return{rows:[...new Set([...clients,...matching.map(note=>note.feedback?.cliente).filter(value=>typeof value==='string')])].map(nombre=>({nombre}))};
    if(compact.includes('FROM notas_compartidas WHERE')&&compact.includes('LIMIT 500')){
      assert.deepEqual(params.length,3);assert.doesNotMatch(compact,/OFFSET/);assert.match(compact,/\(updated_at,id\)<\(\$2::timestamptz,\$3::bigint\)/);
      const after=matching.filter(note=>!params[1]||note.updated_at<params[1]||note.updated_at===params[1]&&note.id<params[2]);
      return{rows:structuredClone(after.slice(0,500))};
    }
    if(compact.includes('FROM notas_compartidas WHERE')&&compact.endsWith('AND id=$2'))return{rows:structuredClone(matching.filter(note=>note.id===params[1]))};
    throw Error('Unexpected SQL '+compact);
  },release(error){calls.push({sql:'RELEASE',error});}};
  return{calls,failure,rollbackError,get leases(){return leases;},notes,clients,pool:{async connect(){leases++;if(leaseGate)await leaseGate.promise;return db;},query(){throw Error('escaped snapshot');}}};
}

test('canonical query is closed/scalar, bounded and requires a snapshot before later offset; legacy cap is private',()=>{
  assert.deepEqual(normalizeFeedbackNotesQuery({}),{limit:50,offset:0,expected:null,context:{section:'all',papelera:false,categoria:null,q:''}});
  assert.equal(normalizeFeedbackNotesQuery({q:'  café  '}).context.q,'café');
  for(const query of [null,[],{limit:'0'},{limit:'500'},{limit:'01'},{limit:20},{offset:'1000001'},{offset:'1\n'},{offset:'-1'},{section:'fake'},{papelera:'yes'},{categoria:'salary'},{categoria:['general']},{q:'x'.repeat(201)},{q:'line\nnext'},{'q[]':'x'},{expected_snapshot:'A'.repeat(64)},{expected_snapshot:'a'.repeat(64)+'\n'},{legacy:'true'}])assert.throws(()=>normalizeFeedbackNotesQuery(query),error=>error.status===400);
  assert.throws(()=>normalizeFeedbackNotesQuery({offset:'1'}),error=>error.status===428);
  assert.equal(normalizeFeedbackNotesQuery({offset:'1000000',limit:'100',expected_snapshot:'a'.repeat(64)}).offset,1000000);
  assert.equal(normalizeFeedbackNotesQuery({},true).limit,500);
  assert.throws(()=>normalizeFeedbackNotesQuery({limit:'500'},true),error=>error.status===400);
});

test('full inventory >1000 scans exact microsecond keysets, total and snapshot permit next pages without hidden cap',async()=>{
  const f=fixture({notes:rows(1203)}),first=await readFeedbackNotesPage(f.pool,auth(),{limit:'100'});
  assert.equal(first.total,1203);assert.equal(first.items.length,100);assert.equal(first.items[0].id,1203);assert.equal(first.has_more,true);assert.match(first.snapshot,/^[0-9a-f]{64}$/);
  const scans=f.calls.filter(call=>call.sql.includes('LIMIT 500'));assert.equal(scans.length,3);
  assert.deepEqual(scans[1].params,[false,time,704]);assert.deepEqual(scans[2].params,[false,time,204]);
  assert.match(scans[0].sql,/HH24:MI:SS\.US/);
  const last=await readFeedbackNotesPage(f.pool,auth(),{offset:'1200',limit:'100',expected_snapshot:first.snapshot});
  assert.deepEqual(last.items.map(note=>note.id),[3,2,1]);assert.equal(last.has_more,false);assert.equal(last.total,1203);assert.equal(last.snapshot,first.snapshot);
  const beyond=await readFeedbackNotesPage(f.pool,auth(),{offset:'5000',expected_snapshot:first.snapshot});assert.deepEqual(beyond.items,[]);assert.equal(beyond.total,1203);assert.equal(beyond.has_more,false);
});

test('global explicit client names outside page classify title-only notes; normalized search spans safe business fields only',async()=>{
  const notes=rows(1002);notes[0].titulo='Pedido Órbita';notes[0].feedback={responsables:['Lucía'],referencia:'Revisar diseño',financial:{secret:'FORBIDDEN_SEARCH'}};
  notes[900].feedback={cliente:'Órbita'};
  const f=fixture({notes,clients:[]}),result=await readFeedbackNotesPage(f.pool,auth(),{section:'clients',q:'lucia'});
  assert.equal(result.total,1);assert.equal(result.items[0].resolved_client,'Órbita');assert.equal(result.items[0].section,'clients');
  assert.equal((await readFeedbackNotesPage(f.pool,auth(),{q:'diseno'})).total,1);
  assert.equal((await readFeedbackNotesPage(f.pool,auth(),{q:'FORBIDDEN_SEARCH'})).total,0);
  assert.doesNotMatch(JSON.stringify(result),/financial|FORBIDDEN_SEARCH/);
  const category=fixture({notes:[row(3,{categoria:'reunion'}),row(2,{categoria:'general'}),row(1,{categoria:'reunion'})]});
  assert.equal((await readFeedbackNotesPage(category.pool,auth(),{categoria:'reunion'})).total,2);
});

test('closed DTO keeps allowed provenance and arbitrary Unicode literal text, never financial bags or idempotency keys',async()=>{
  const note=row(1,{titulo:'<img onerror=evil()> 😀',feedback:{cliente:'Client',responsables:['🌈'.repeat(200)],estado:'resuelto',vigencia:'permanente',origen:'mia_whatsapp',confirmado_por:'Human',confirmado_por_id:7,confirmado_at:'2026-10-20T00:00:00.000Z',provenance_version:1,wilson_idempotency_key:'private',money:900,metadata:{secret:true}}});
  const before=structuredClone(note),f=fixture({notes:[note]}),result=await readFeedbackNotesPage(f.pool,auth(),{});
  assert.equal(result.items[0].titulo,note.titulo);assert.equal(result.items[0].feedback.confirmado_por_id,7);assert.equal(result.items[0].feedback.responsables[0],note.feedback.responsables[0]);
  assert.doesNotMatch(JSON.stringify(result),/wilson_idempotency_key|"money"|metadata|secret/);assert.deepEqual(note,before);
  assert.deepEqual(Object.keys(result.items[0]).sort(),['id','titulo','contenido','categoria','feedback','creado_por','modificado_por','eliminado_at','created_at','updated_at','resolved_client','section'].sort());
});

test('microsecond-only update, membership context/actor/catalog changes409 instead of appending old snapshot',async()=>{
  const f=fixture(),first=await readFeedbackNotesPage(f.pool,auth(),{});
  f.notes[0].updated_at='2026-10-21T12:00:00.000002Z';
  await assert.rejects(readFeedbackNotesPage(f.pool,auth(),{offset:'1',expected_snapshot:first.snapshot}),error=>error.status===409&&error.code==='FEEDBACK_NOTES_SNAPSHOT_CHANGED');
  const fresh=await readFeedbackNotesPage(f.pool,auth(),{});assert.notEqual(fresh.snapshot,first.snapshot);
  f.clients.push('Other');await assert.rejects(readFeedbackNotesPage(f.pool,auth(),{offset:'1',expected_snapshot:fresh.snapshot}),error=>error.status===409);
  const current=await readFeedbackNotesPage(f.pool,auth(),{});
  await assert.rejects(readFeedbackNotesPage(f.pool,auth(),{offset:'1',section:'team',expected_snapshot:current.snapshot}),error=>error.status===409);
  const other=fixture({actor:{id:8,rol:'custom_role',session_version:3,activo:true}});
  await assert.rejects(readFeedbackNotesPage(other.pool,{id:8,rol:'custom_role',session_version:3},{offset:'1',expected_snapshot:current.snapshot}),error=>error.status===409);
});

test('legacy reader returns first500 envelope from a single RR scan, only old filters accepted',async()=>{
  const f=fixture({notes:rows(1001)}),result=await readLegacyFeedbackNotes(f.pool,auth(),{});
  assert.equal(result.limit,500);assert.equal(result.items.length,500);assert.equal(result.total,1001);assert.equal(result.has_more,true);assert.equal(f.leases,1);
  assert.equal(f.calls.filter(call=>call.sql.startsWith('BEGIN')).length,1);
  for(const query of [{section:'all'},{offset:'0'},{expected_snapshot:'a'.repeat(64)}])await assert.rejects(readLegacyFeedbackNotes(f.pool,auth(),query),error=>error.status===400);
});

test('detail uses same catalog/closed projection and collection; wrong trash mode404, no writes',async()=>{
  const f=fixture({notes:[row(2,{titulo:'Acme update'}),row(1,{eliminado_at:'2026-10-20T00:00:00.000000Z',feedback:{cliente:'Old client'}})]});
  const result=await readFeedbackNoteDetail(f.pool,auth(),'2',{});assert.equal(result.item.resolved_client,'Acme');assert.equal(result.item.section,'clients');
  await assert.rejects(readFeedbackNoteDetail(f.pool,auth(),'1',{}),error=>error.status===404);
  assert.equal((await readFeedbackNoteDetail(f.pool,auth(),1,{papelera:'true'})).item.id,1);
  await assert.rejects(readFeedbackNoteDetail(f.pool,auth(),'2',{q:'x'}),error=>error.status===400);
  for(const id of ['01','2\n','9007199254740992',0,1.1])await assert.rejects(readFeedbackNoteDetail(f.pool,auth(),id),error=>error.status===400);
  assert.equal(f.calls.some(call=>/^(INSERT|UPDATE|DELETE)/.test(call.sql)),false);
});

test('invalid rows fail closed, not partial success, including unsafe IDs, metadata types, timestamps and cursor order',async()=>{
  for(const patch of [{id:9007199254740992},{id:'1'},{categoria:'finance'},{titulo:{}},{feedback:{cliente:{financial:1}}},{feedback:{responsables:['ok',{}]}},{updated_at:'2026-10-21T12:00:00.000Z'},{updated_at:'2026-02-30T12:00:00.000001Z'}]){
    const f=fixture({notes:[row(1,patch)]});await assert.rejects(readFeedbackNotesPage(f.pool,auth(),{}),error=>error.status===500);assert.equal(f.calls.at(-2).sql,'ROLLBACK');
  }
  const f=fixture({notes:[row(1),row(2)]});await assert.rejects(readFeedbackNotesPage(f.pool,auth(),{}),error=>error.status===500);
});

test('actor ID/epoch/role captured before lease and all reads stay on one readonly client through commit',async()=>{
  const leaseGate=deferred(),f=fixture({leaseGate}),held=auth(),query={section:'team'};
  const pending=readFeedbackNotesPage(f.pool,held,query);held.id=8;held.rol='admin';held.session_version=4;query.section='clients';leaseGate.resolve();
  const result=await pending;assert.equal(result.context.section,'team');assert.deepEqual(f.calls[1].params,[7]);
  assert.equal(f.calls[0].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.deepEqual(f.calls.slice(-2).map(call=>call.sql),['COMMIT','RELEASE']);
  for(const actor of [null,{...auth(),activo:false},{...auth(),activo:true,id:8},{...auth(),activo:true,rol:'admin'},{...auth(),activo:true,session_version:4}]){
    const denied=fixture({actor});await assert.rejects(readFeedbackNotesPage(denied.pool,auth(),{}),error=>error.status===401);
    assert.equal(denied.calls.some(call=>call.sql.startsWith('SELECT nombre FROM clientes')),false);
  }
});

test('no result before COMMIT; rollback discards broken client and preserves original failure',async()=>{
  const commitGate=deferred(),f=fixture({commitGate});let settled=false;const pending=readFeedbackNotesPage(f.pool,auth(),{}).then(value=>{settled=true;return value;});
  for(let i=0;i<30;i++)await Promise.resolve();assert.equal(f.calls.at(-1).sql,'COMMIT');assert.equal(settled,false);commitGate.resolve();await pending;
  const broken=fixture({failureAt:'LIMIT 500',rollbackFails:true});await assert.rejects(readFeedbackNotesPage(broken.pool,auth(),{}),error=>error===broken.failure);assert.equal(broken.calls.at(-1).error,broken.rollbackError);
  const source=readFileSync(new URL('../src/feedback-notes-read.js',import.meta.url),'utf8');assert.doesNotMatch(source,/pool\.query|Promise\.all|FOR UPDATE|FOR SHARE|process\.env/);
});
