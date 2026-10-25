import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyFeedbackBrowserOperation, normalizeFeedbackBrowserOperation } from '../src/feedback-browser-write.js';
import { feedbackVersionIso } from '../src/feedback-receipts.js';
import { readFeedbackNoteDetail } from '../src/feedback-notes-read.js';

const key='11111111-2222-4333-8444-555555555555',otherKey='22222222-2222-4333-8444-555555555555';
const auth=()=>({id:7,rol:'custom_role',session_version:3,nombre:'Untrusted cached name'});
const stamp='2026-10-21T12:00:00.000001Z';
const note=()=>({id:1,titulo:'Original',contenido:' Original exact\n ',categoria:'general',feedback:{cliente:'Acme',responsable:'Owner',responsables:['Owner'],referencia:'Keep reference',estado:'pendiente',vigencia:'permanente',flujo:'feedback',origen:'wilson_telegram',confirmado_por:'DB person',confirmado_por_id:7,confirmado_at:'2026-10-01T00:00:00Z',provenance_version:1,financial:{private:999},wilson_idempotency_key:'private'},creado_por:'Original DB actor',modificado_por:'Previous',eliminado_at:null,created_at:'2026-10-01T12:00:00.000000Z',updated_at:stamp});
const create=(fields={titulo:'New',contenido:'Exact\n text ',feedback:{cliente:'Acme'}})=>({request_id:key,action:'create',fields});
const mutation=(action='edit',fields={contenido:'Changed'},version=stamp,request_id=key)=>({request_id,action,note_id:1,expected_updated_at:version,...(action==='edit'?{fields}:{})});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
function fixture({notes=[note()],current={id:7,rol:'custom_role',session_version:3,activo:true,nombre:'Current DB actor',usuario:'current'},recipients=[{id:9,usuario:'owner_login',nombre:'Owner'}],failAt,rollbackFails=false,leaseGate,commitGate,noVersionAdvance=false}={}){
  const calls=[],failure=Error('synthetic failure'),rollbackError=Error('rollback failed');let state={notes:structuredClone(notes),receipts:[],notifications:[]},staged,leases=0;
  const db={async query(sql,params=[]){
    const compact=sql.replace(/\s+/g,' ').trim();calls.push({sql:compact,params:structuredClone(params)});
    if(compact.startsWith('BEGIN')){staged=structuredClone(state);return{rows:[]};}
    if(compact==='ROLLBACK'){staged=null;if(rollbackFails)throw rollbackError;return{rows:[]};}
    if(failAt&&compact.startsWith(failAt))throw failure;
    if(compact==='COMMIT'){if(commitGate)await commitGate.promise;state=staged;staged=null;return{rows:[]};}
    if(compact.startsWith('SELECT pg_advisory'))return{rows:[]};
    if(compact.startsWith('SELECT id,rol,activo,session_version'))return{rows:current?[structuredClone(current)]:[]};
    if(compact==='SELECT id, usuario, nombre FROM usuarios WHERE activo IS TRUE')return{rows:structuredClone(recipients)};
    if(compact.startsWith('INSERT INTO mia_private_task_notifications')){
      assert.match(compact,/ON CONFLICT\(fingerprint\) DO NOTHING/);
      if(staged.notifications.some(row=>row.fingerprint===params[0]))return{rows:[]};
      const row={id:staged.notifications.length+1,fingerprint:params[0],feedback_id:params[3],details:JSON.parse(params[6])};
      staged.notifications.push(row);return{rows:[{id:row.id,fingerprint:row.fingerprint}]};
    }
    if(compact.includes('FROM feedback_browser_operations'))return{rows:staged.receipts.filter(receipt=>receipt.actor_user_id===params[0]&&receipt.request_id===params[1]).map(receipt=>({...receipt,note_id:String(receipt.note_id)}))};
    if(compact.startsWith('SELECT id FROM notas_compartidas'))return{rows:staged.notes.filter(row=>row.id===params[0]).map(({id})=>({id}))};
    if(compact.startsWith('SELECT id,titulo,contenido')){
      if(compact.includes('AND id=$2'))return{rows:structuredClone(staged.notes.filter(row=>row.id===params[1]&&(row.eliminado_at!==null)===params[0]))};
      return{rows:structuredClone(staged.notes.filter(row=>row.id===params[0]))};
    }
    if(compact.startsWith('SELECT nombre FROM clientes'))return{rows:[{nombre:'Acme'}]};
    if(compact.startsWith('INSERT INTO notas_compartidas')){
      const id=Math.max(0,...staged.notes.map(row=>row.id))+1;
      staged.notes.push({...note(),id,titulo:params[0],contenido:params[1],categoria:params[2],feedback:JSON.parse(params[3]),creado_por:params[4],modificado_por:params[4],updated_at:'2026-10-21T12:00:01.000000Z'});return{rows:[{id}],rowCount:1};
    }
    if(compact.startsWith('UPDATE notas_compartidas')){
      const id=compact.includes('WHERE id=$1')?params[0]:params.at(-1),row=staged.notes.find(row=>row.id===id);
      assert.ok(row);
      if(compact.includes('eliminado_at=now()'))row.eliminado_at='2026-10-21T12:00:02.000000Z';
      if(compact.includes('eliminado_at=NULL'))row.eliminado_at=null;
      for(const field of ['titulo','contenido','categoria','modificado_por']){
        const match=new RegExp(`${field}=\\$(\\d+)`).exec(compact);if(match)row[field]=params[Number(match[1])-1];
      }
      const feedback=/feedback=COALESCE\(feedback,'\{\}'::jsonb\)\|\|\$(\d+)::jsonb/.exec(compact);if(feedback)Object.assign(row.feedback,JSON.parse(params[Number(feedback[1])-1]));
      if(!noVersionAdvance)row.updated_at=new Date(Date.parse(feedbackVersionIso(row.updated_at))+1).toISOString().replace('Z','000Z');
      return{rows:[],rowCount:1};
    }
    if(compact.startsWith('DELETE FROM notas_compartidas')){staged.notes=staged.notes.filter(row=>row.id!==params[0]);return{rows:[],rowCount:1};}
    if(compact.startsWith('INSERT INTO feedback_browser_operations')){staged.receipts.push({actor_user_id:params[0],request_id:params[1],action:params[2],payload_hash:params[3],note_id:params[4],note_updated_at:params[5]});return{rows:[]};}
    throw Error('Unexpected SQL '+compact);
  },release(error){calls.push({sql:'RELEASE',error});}};
  return{calls,failure,rollbackError,get state(){return state;},get leases(){return leases;},pool:{async connect(){leases++;if(leaseGate)await leaseGate.promise;return db;},query(){throw Error('escaped lease');}}};
}

test('closed normalizer requires UUID and noncreate ID/version; canonical millisecond version reuses bot normalizer',()=>{
  assert.throws(()=>normalizeFeedbackBrowserOperation({action:'create',fields:{}}),error=>error.status===428);
  assert.throws(()=>normalizeFeedbackBrowserOperation({request_id:key,action:'edit',note_id:1,fields:{titulo:'x'}}),error=>error.status===428);
  const value=normalizeFeedbackBrowserOperation(mutation());assert.equal(value.expected_updated_at,feedbackVersionIso(stamp));
  const equivalent=normalizeFeedbackBrowserOperation(mutation('edit',{contenido:'Changed'},'2026-10-21T09:00:00.000001-03:00'));assert.deepEqual(equivalent,value);
  const defaults=normalizeFeedbackBrowserOperation(create({}));assert.equal(defaults.fields.titulo,'Nueva nota');assert.equal(defaults.fields.contenido,'');assert.equal(defaults.fields.categoria,'general');
  for(const input of [{...create(),request_id:key+'\n'},{...create(),request_id:null},{...create(),extra:1},{...create(),note_id:1},{...mutation(),note_id:'1'},{...mutation(),note_id:2147483648},{...mutation(),expected_updated_at:'not date'},{...create(),fields:{importe:3}},{...create(),fields:{feedback:{origen:'spoof'}}},{...create(),fields:{contenido:{bad:true}}},mutation('edit',{}),mutation('edit',{feedback:{}}),{...mutation('trash'),fields:{}}])assert.throws(()=>normalizeFeedbackBrowserOperation(input),error=>error.status===400);
});

test('immutable original fields preserve Unicode/whitespace and partial feedback never installs omitted defaults',()=>{
  const input=mutation('edit',{contenido:' 🌈 Exact\n ',feedback:{estado:'resuelto'}}),before=structuredClone(input),normalized=normalizeFeedbackBrowserOperation(input);
  assert.deepEqual(normalized.fields,{contenido:input.fields.contenido,feedback:{estado:'resuelto'}});assert.deepEqual(input,before);assert.ok(Object.isFrozen(normalized.fields.feedback));
  assert.deepEqual(normalizeFeedbackBrowserOperation(mutation('edit',{feedback:{responsables:['Renamed']}})).fields.feedback,{responsable:'Renamed',responsables:['Renamed']});
});

test('write order account mutex before current actor SHARE, receipt then note UPDATE lock; CAS and closed readback before commit',async()=>{
  const f=fixture(),result=await applyFeedbackBrowserOperation(f.pool,auth(),mutation());
  assert.equal(result.status,200);assert.equal(result.body.operation.replayed,false);assert.deepEqual(Object.keys(result.body.operation).sort(),['request_id','action','note_id','note_updated_at','replayed'].sort());
  const sql=f.calls.map(call=>call.sql);assert.deepEqual(sql.slice(0,2),['BEGIN ISOLATION LEVEL READ COMMITTED','SELECT pg_advisory_xact_lock(20261019,1)']);assert.match(sql[2],/FROM usuarios WHERE id=\$1 FOR SHARE$/);
  assert.ok(sql.findIndex(value=>value.includes('FROM feedback_browser_operations'))<sql.findIndex(value=>value.includes('FROM notas_compartidas')&&value.endsWith('FOR UPDATE')));
  assert.deepEqual(sql.slice(-2),['COMMIT','RELEASE']);assert.equal(result.body.note.modificado_por,'Current DB actor');assert.equal(result.body.operation.note_updated_at,'2026-10-21T12:00:00.001Z');
  assert.equal(f.state.notes[0].feedback.financial.private,999);assert.equal(f.state.notes[0].feedback.wilson_idempotency_key,'private');assert.doesNotMatch(JSON.stringify(result),/financial|wilson_idempotency_key|999/);
  assert.match(f.state.receipts[0].payload_hash,/^[0-9a-f]{64}$/);assert.equal(f.state.receipts.length,1);
});

test('partial business state patch preserves existing client/reference/responsibles/provenance and enforces effective flow under lock',async()=>{
  const f=fixture(),result=await applyFeedbackBrowserOperation(f.pool,auth(),mutation('edit',{feedback:{estado:'resuelto'}}));
  assert.equal(result.body.note.feedback.estado,'resuelto');for(const field of ['cliente','referencia','responsable','vigencia','origen','confirmado_at'])assert.equal(f.state.notes[0].feedback[field],note().feedback[field]);
  assert.deepEqual(f.state.notes[0].feedback.responsables,['Owner']);
  const invalid=fixture();await assert.rejects(applyFeedbackBrowserOperation(invalid.pool,auth(),mutation('edit',{feedback:{responsables:[]}})),error=>error.status===422);assert.deepEqual(invalid.state.notes,[note()]);assert.equal(invalid.state.receipts.length,0);
  const legacy=fixture({notes:[{...note(),feedback:{...note().feedback,responsables:[]}}]});await applyFeedbackBrowserOperation(legacy.pool,auth(),mutation('edit',{titulo:'New title'}));assert.deepEqual(legacy.state.notes[0].feedback.responsables,[],'valid legacy singular responsible is not rewritten on unrelated edit');
});

test('create first201, replay200 returns CURRENT edited/trashed record with original operation version and no repeated DML',async()=>{
  const f=fixture({notes:[]}),intent=create(),first=await applyFeedbackBrowserOperation(f.pool,auth(),intent);
  assert.equal(first.status,201);assert.equal(first.body.note.creado_por,'Current DB actor');
  f.state.notes[0].contenido='Peer edit';f.state.notes[0].eliminado_at='2026-10-21T12:00:03.000000Z';f.state.notes[0].updated_at='2026-10-21T12:00:04.000000Z';
  const start=f.calls.length,replay=await applyFeedbackBrowserOperation(f.pool,auth(),intent);
  assert.equal(replay.status,200);assert.equal(replay.body.operation.replayed,true);assert.equal(replay.body.note.contenido,'Peer edit');assert.ok(replay.body.note.eliminado_at);assert.equal(replay.body.operation.note_updated_at,first.body.operation.note_updated_at);
  assert.equal(f.calls.slice(start).some(call=>/^(INSERT|UPDATE|DELETE)/.test(call.sql)),false);
  await assert.rejects(applyFeedbackBrowserOperation(f.pool,auth(),create({titulo:'Other'})),error=>error.status===409&&error.code==='FEEDBACK_OPERATION_REPLAY_MISMATCH');
  await assert.rejects(applyFeedbackBrowserOperation(f.pool,auth(),mutation('trash',undefined,first.body.note.updated_at)),error=>error.status===409&&error.code==='FEEDBACK_OPERATION_REPLAY_MISMATCH');
  assert.equal(f.state.notes.length,1);assert.equal(f.state.receipts.length,1);
});

test('trash/restore preserve exact business data; purge only trashed with CAS, replay remains null without recreation',async()=>{
  const f=fixture(),trashed=await applyFeedbackBrowserOperation(f.pool,auth(),mutation('trash'));
  assert.ok(trashed.body.note.eliminado_at);assert.deepEqual(f.state.notes[0].feedback,note().feedback);
  const restored=await applyFeedbackBrowserOperation(f.pool,auth(),mutation('restore',undefined,trashed.body.note.updated_at,otherKey));assert.equal(restored.body.note.eliminado_at,null);
  const active=fixture();await assert.rejects(applyFeedbackBrowserOperation(active.pool,auth(),mutation('purge')),error=>error.status===409);assert.equal(active.state.notes.length,1);
  const gone=fixture({notes:[{...note(),eliminado_at:'2026-10-21T11:00:00.000000Z'}]}),intent=mutation('purge'),first=await applyFeedbackBrowserOperation(gone.pool,auth(),intent);
  assert.equal(first.body.note,null);assert.equal(gone.state.notes.length,0);assert.equal(gone.state.receipts.length,1);
  const before=gone.calls.length,replay=await applyFeedbackBrowserOperation(gone.pool,auth(),intent);assert.equal(replay.body.note,null);assert.equal(replay.body.operation.replayed,true);assert.equal(gone.calls.slice(before).some(call=>/^(INSERT|UPDATE|DELETE)/.test(call.sql)),false);
});

test('stale noncreate intents conflict with zero DML, no auto rebase/retry; absent note404',async()=>{
  for(const action of ['edit','trash','restore','purge']){
    const f=fixture();await assert.rejects(applyFeedbackBrowserOperation(f.pool,auth(),mutation(action,undefined,'2026-10-21T11:59:59Z')),error=>error.status===409&&error.code==='FEEDBACK_BROWSER_VERSION_CONFLICT');
    assert.equal(f.calls.some(call=>/^(INSERT|UPDATE|DELETE)/.test(call.sql)),false);assert.equal(f.leases,1);
  }
  const empty=fixture({notes:[]});await assert.rejects(applyFeedbackBrowserOperation(empty.pool,auth(),mutation()),error=>error.status===404);
});

test('captures original ID/epoch/role/body before lease and current account name only; revoked actor cannot replay',async()=>{
  const leaseGate=deferred(),f=fixture({leaseGate}),held=auth(),intent=mutation();const pending=applyFeedbackBrowserOperation(f.pool,held,intent);
  held.id=8;held.session_version=4;held.rol='admin';intent.fields.contenido='Late body';leaseGate.resolve();const result=await pending;assert.equal(result.body.note.contenido,'Changed');assert.equal(result.body.note.modificado_por,'Current DB actor');assert.deepEqual(f.calls[2].params,[7]);
  for(const current of [null,{id:7,rol:'custom_role',activo:false,session_version:3},{id:7,rol:'admin',activo:true,session_version:3},{id:7,rol:'custom_role',activo:true,session_version:4}]){
    const denied=fixture({current});await assert.rejects(applyFeedbackBrowserOperation(denied.pool,auth(),create()),error=>error.status===401);assert.equal(denied.calls.some(call=>call.sql.includes('FROM feedback_browser_operations')),false);assert.equal(denied.state.receipts.length,0);
  }
});

test('failed receipt/readback/version check rolls back note writes, rollback failure discards client, commit is awaited',async()=>{
  for(const failAt of ['INSERT INTO feedback_browser_operations','SELECT nombre FROM clientes']){
    const f=fixture({failAt,rollbackFails:true});await assert.rejects(applyFeedbackBrowserOperation(f.pool,auth(),mutation()),error=>error===f.failure);assert.deepEqual(f.state.notes,[note()]);assert.equal(f.state.receipts.length,0);assert.equal(f.calls.at(-1).error,f.rollbackError);
  }
  const unchanged=fixture({noVersionAdvance:true});await assert.rejects(applyFeedbackBrowserOperation(unchanged.pool,auth(),mutation()),error=>error.status===500);assert.equal(unchanged.state.receipts.length,0);
  const commitGate=deferred(),f=fixture({commitGate});let settled=false;const pending=applyFeedbackBrowserOperation(f.pool,auth(),mutation()).then(value=>{settled=true;return value;});for(let i=0;i<100;i++)await Promise.resolve();assert.equal(f.calls.at(-1).sql,'COMMIT');assert.equal(settled,false);commitGate.resolve();await pending;
});

test('strict query and int32 detail ID fail before lease; DTO119 remains shared and no pool escape',async()=>{
  const f=fixture();await assert.rejects(applyFeedbackBrowserOperation(f.pool,auth(),create(),{unknown:'x'}),error=>error.status===400);
  await assert.rejects(readFeedbackNoteDetail(f.pool,auth(),'2147483648'),error=>error.status===400);assert.equal(f.leases,0);
  const source=readFileSync(new URL('../src/feedback-browser-write.js',import.meta.url),'utf8');assert.match(source,/feedbackVersionIso/);assert.match(source,/readFeedbackNoteFromClient/);assert.doesNotMatch(source,/pool\.query|Promise\.all|canonicalFeedbackIntent|feedbackIntentHash/);
});

const notificationCreate=()=>create({titulo:'Feedback create',contenido:'Held body',feedback:{cliente:'Acme',responsables:['Owner'],flujo:'feedback'}});
test('browser feedback creation atomically enqueues on the same leased client before receipt/commit using the locked actor ID',async()=>{
  const f=fixture({notes:[]}),result=await applyFeedbackBrowserOperation(f.pool,auth(),notificationCreate());
  assert.equal(result.status,201);assert.equal(f.state.notes.length,1);assert.equal(f.state.receipts.length,1);assert.equal(f.state.notifications.length,1);
  assert.equal(f.state.notifications[0].feedback_id,result.body.note.id);
  assert.deepEqual(f.state.notifications[0].details,{cliente:'Acme',actor:'Current DB actor',destinatario_usuario_id:9,actor_usuario_id:7});
  const sql=f.calls.map(call=>call.sql),queue=sql.findIndex(value=>value.startsWith('INSERT INTO mia_private_task_notifications')),
    receipt=sql.findIndex(value=>value.startsWith('INSERT INTO feedback_browser_operations'));
  assert.ok(queue>sql.findIndex(value=>value.startsWith('INSERT INTO notas_compartidas')));
  assert.ok(queue<receipt&&receipt<sql.indexOf('COMMIT'));
  assert.equal(f.leases,1);assert.deepEqual(sql.slice(-2),['COMMIT','RELEASE']);
  assert.doesNotMatch(JSON.stringify(result.body.note.feedback),/destinatario_usuario_id|actor_usuario_id/,'Internal delivery IDs do not redefine note metadata/permissions');
  const start=f.calls.length,replay=await applyFeedbackBrowserOperation(f.pool,auth(),notificationCreate());
  assert.equal(replay.status,200);assert.equal(replay.body.operation.replayed,true);
  assert.equal(f.state.notes.length,1);assert.equal(f.state.receipts.length,1);assert.equal(f.state.notifications.length,1);
  assert.equal(f.calls.slice(start).some(call=>call.sql.startsWith('INSERT INTO')||call.sql==='SELECT id, usuario, nombre FROM usuarios WHERE activo IS TRUE'),false);
});
for(const failAt of ['INSERT INTO mia_private_task_notifications','INSERT INTO feedback_browser_operations','COMMIT']){
  test(`create failure at ${failAt} rolls back note, notification and receipt together`,async()=>{
    const f=fixture({notes:[],failAt});
    await assert.rejects(applyFeedbackBrowserOperation(f.pool,auth(),notificationCreate()),error=>error===f.failure);
    assert.deepEqual(f.state,{notes:[],receipts:[],notifications:[]});
    assert.deepEqual(f.calls.slice(-2).map(call=>call.sql),['ROLLBACK','RELEASE']);
    if(failAt!=='COMMIT')assert.equal(f.calls.some(call=>call.sql==='COMMIT'),false);
  });
}
test('queue error with failed rollback still preserves the original error and discards its connection',async()=>{
  const f=fixture({notes:[],failAt:'INSERT INTO mia_private_task_notifications',rollbackFails:true});
  await assert.rejects(applyFeedbackBrowserOperation(f.pool,auth(),notificationCreate()),error=>error===f.failure);
  assert.deepEqual(f.state,{notes:[],receipts:[],notifications:[]});assert.equal(f.calls.at(-1).error,f.rollbackError);
});
test('plain note creation and edits/state changes never enqueue Feedback creation notices',async()=>{
  const plain=fixture({notes:[]});await applyFeedbackBrowserOperation(plain.pool,auth(),create());assert.deepEqual(plain.state.notifications,[]);
  for(const action of ['edit','trash','restore','purge']){
    const f=fixture({notes:[{...note(),...(action==='restore'||action==='purge'?{eliminado_at:'2026-10-21T11:00:00.000000Z'}:{})}]});
    await applyFeedbackBrowserOperation(f.pool,auth(),mutation(action));assert.deepEqual(f.state.notifications,[]);
    assert.equal(f.calls.some(call=>call.sql.startsWith('INSERT INTO mia_private_task_notifications')),false);
  }
});
test('unresolvable or ambiguous recipient labels do not roll back an otherwise valid shared note',async()=>{
  for(const recipients of [[],[{id:9,usuario:'one',nombre:'Owner'},{id:10,usuario:'two',nombre:'Owner'}]]){
    const f=fixture({notes:[],recipients}),result=await applyFeedbackBrowserOperation(f.pool,auth(),notificationCreate());
    assert.equal(result.status,201);assert.equal(f.state.notes.length,1);assert.equal(f.state.receipts.length,1);assert.deepEqual(f.state.notifications,[]);
  }
});

test('085 validates enabled established061 before additive immutable receipts, no note FK/counter/history rewrite',()=>{
  const sql=readFileSync(new URL('../migrations/085_feedback_browser_operations.sql',import.meta.url),'utf8');
  assert.match(sql,/pg_trigger/);assert.match(sql,/feedback_notes_monotonic_version/);assert.match(sql,/t\.tgenabled IN \('O','A'\)/);assert.match(sql,/THEN RAISE EXCEPTION/);
  assert.match(sql,/t\.tgtype=19 AND t\.tgnargs=0/);
  assert.match(sql,/actor_user_id INTEGER NOT NULL REFERENCES usuarios\(id\) ON DELETE RESTRICT/);assert.match(sql,/note_id BIGINT NOT NULL CHECK/);assert.doesNotMatch(sql,/REFERENCES notas_compartidas|UPDATE notas_compartidas|ALTER TABLE notas_compartidas|INSERT INTO feedback_|CREATE.*SEQUENCE/i);
  assert.match(sql,/PRIMARY KEY \(actor_user_id,request_id\)/);assert.match(sql,/BEFORE UPDATE OR DELETE ON feedback_browser_operations/);
});
