import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { reorderTaskBoard } from '../src/task-board-order.js';
import { reconcileProductionHistory, validateProductionReconciliation } from '../src/production-reconciliation.js';
import { configuredOwnerProfiles, rememberOwnerProfileSession } from '../src/owner-profile-authority.js';
import { bindDatabaseAuthorityClient } from '../src/database-authority-context.js';

const ownerEnv={NODE_ENV:'test',RENDER_DB_ENVIRONMENT:'test',DATABASE_URL:'postgresql://fixture@127.0.0.1:56019/fixture',
  RENDER_OWNER_PROFILES:JSON.stringify({accountId:91001,francoUserId:91005,agustinUserId:91006})};
const actor=()=>({id:91005,rol:'admin',session_version:3});
function delegated(pool){const exp=Math.floor(Date.now()/1000)+3600,auth={...actor(),root_id:91001,root_session_version:2,
  root_exp:exp,exp,owner_profile:'franco'};rememberOwnerProfileSession(auth,{...auth},configuredOwnerProfiles(ownerEnv,pool).policy);return auth;}
const uuid='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const boardInput=()=>({request_id:uuid,task_id:1,expected_revision:1,before_id:null,expected_before_revision:null,expected_order_revision:'1'});
const productionInput=(editing=false)=>({request_id:uuid,source_task_id:7,expected_source_revision:3,
  acknowledgement:'videos_identificados_manualmente',titulo:'Manual review',videos:[{titulo:'Reviewed video',estado:'grabado'}],
  ...(editing?{existing_editing:{task_id:8,expected_revision:2,video_ordinal:1,acknowledgement:'esta_tarea_edita_un_solo_video'}}:{})});
function fixture(kind,body){
  const calls=[],users=[{id:91001,rol:'admin',activo:true,session_version:2},{...actor(),activo:true},{id:91006,rol:'admin',activo:true,session_version:4}];
  const hash=kind==='production'?createHash('sha256').update(JSON.stringify(validateProductionReconciliation(body))).digest('hex'):null;
  const db={async query(sql,values=[]){calls.push({sql,values});
    if(sql.includes('FROM usuarios')&&sql.includes('ANY('))return{rows:users};
    if(sql.startsWith('SELECT id,rol,activo,session_version FROM usuarios'))return{rows:users.filter(u=>u.id===values[0])};
    if(/^BEGIN|^COMMIT|^ROLLBACK/.test(sql)||sql.includes('pg_advisory_xact_lock'))return{rows:[]};
    if(kind==='production'){
      if(sql.startsWith('SELECT id,visita_id,payload_hash FROM produccion_reconciliaciones'))return{rows:[{id:'receipt',visita_id:'visit',payload_hash:hash}]};
      if(sql.startsWith('SELECT video_id FROM produccion_reconciliacion_videos'))return{rows:[{video_id:'video'}]};
    }else{
      if(sql.includes('FROM task_board_order\n'))return{rows:[{revision:'1',task_ids:[1]}]};
      if(sql.includes('FROM task_board_order_receipts'))return{rows:[]};
      if(sql.startsWith('SELECT t.id,t.revision,t.estado'))return{rows:[{id:1,revision:1,estado:'pendiente',propiedades_extra:{workspace:'render_os'}}]};
      if(sql.startsWith('SELECT t.id FROM tareas'))return{rows:[{id:1}]};
      if(sql.startsWith('INSERT INTO task_board_order_receipts'))return{rows:[]};
    }
    throw Error('Unexpected scoped writer SQL');
  },release(error){calls.push({sql:'RELEASE',discard:error});}};
  const pool={async connect(){return db;}};bindDatabaseAuthorityClient(db,pool);
  return{calls,users,db,pool};
}
const mutationCalls=f=>f.calls.filter(c=>/^(INSERT|UPDATE|DELETE)/.test(c.sql));
for(const kind of ['board','production']){
  const input=()=>kind==='board'?boardInput():productionInput();
  const run=(f,auth,body=input())=>kind==='board'?reorderTaskBoard(f.pool,auth,body):reconcileProductionHistory(f.pool,auth,body);
  for(const reason of ['root revoked','root inactive','profile inactive','root role changed'])test(`${kind}: ${reason} during pool wait rejects before actor/domain/DML`,async()=>{
    const body=input(),f=fixture(kind,body),auth=delegated(f.pool);let resume;
    f.pool.connect=()=>new Promise(resolve=>{resume=()=>resolve(f.db);});const pending=run(f,auth,body);
    if(reason==='root revoked')f.users[0].session_version++;
    if(reason==='root inactive')f.users[0].activo=false;
    if(reason==='profile inactive')f.users[1].activo=false;
    if(reason==='root role changed')f.users[0].rol='edicion';
    resume();await assert.rejects(pending,{status:401});assert.deepEqual(mutationCalls(f),[]);
    assert.equal(f.calls[0].sql,'BEGIN ISOLATION LEVEL READ COMMITTED');
    assert.deepEqual(f.calls[1].values,[[91001,91005,91006]]);
    assert.match(f.calls[1].sql,/ORDER BY id FOR SHARE/);
    assert.equal(f.calls.some(c=>c.sql.includes('WHERE id=$1 FOR SHARE')),false);
    assert.equal(f.calls.some(c=>c.sql==='ROLLBACK'),true);
  });
  test(`${kind}: wrong-pool opaque delegation rejects without principal or business access`,async()=>{
    const body=input(),origin=fixture(kind,body),destination=fixture(kind,body),auth=delegated(origin.pool);
    await assert.rejects(run(destination,auth,body),{status:401});assert.deepEqual(mutationCalls(destination),[]);
    assert.equal(destination.calls.some(c=>c.sql.includes('FROM usuarios')),false);
  });
  test(`${kind}: forged claims reject synchronously before pool wait`,async()=>{
    const body=input(),f=fixture(kind,body),auth={...delegated(f.pool)};
    f.pool.connect=()=>assert.fail('No lease for forged delegation');await assert.rejects(run(f,auth,body),{status:401});
    assert.deepEqual(f.calls,[]);
  });
  test(`${kind}: plain actor default behavior does not invent principal locks`,async()=>{
    const body=input(),f=fixture(kind,body),result=await run(f,actor(),body);
    assert.equal(f.calls.some(c=>c.sql.includes('ANY($1::int[]) ORDER BY id FOR SHARE')),false);
    assert.equal(f.calls[1].sql,'SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1 FOR SHARE');
    if(kind==='board'){assert.equal(result.changed,false);assert.equal(mutationCalls(f).length,1);}
    else{assert.equal(result.created,false);assert.deepEqual(mutationCalls(f),[]);}
  });
  test(`${kind}: trusted captured actor survives caller mutation while pool is pending`,async()=>{
    const body=input(),f=fixture(kind,body),auth=delegated(f.pool);let resume;
    f.pool.connect=()=>new Promise(resolve=>{resume=()=>resolve(f.db);});const pending=run(f,auth,body);
    auth.id=91006;auth.session_version=999;auth.root_session_version=999;resume();await pending;
    const principal=f.calls.findIndex(c=>c.sql.includes('ANY($1::int[]) ORDER BY id FOR SHARE'));
    const current=f.calls.findIndex(c=>c.sql.includes('WHERE id=$1 FOR SHARE'));
    assert.ok(principal>0&&current>principal);assert.deepEqual(f.calls[current].values,[91005]);
  });
}
test('production adoption takes existing global editing mutex before delegated principal and actor, including replay',async()=>{
  const body=productionInput(true),f=fixture('production',body);
  assert.equal((await reconcileProductionHistory(f.pool,delegated(f.pool),body)).created,false);
  assert.match(f.calls[1].sql,/hashtext\('vinculo-objetivo-mensual'\)/);
  assert.deepEqual(f.calls[2].values,[[91001,91005,91006]]);
  assert.deepEqual(f.calls[3].values,[91005]);assert.deepEqual(mutationCalls(f),[]);
});
test('production rollback failure discards the lease without hiding principal revocation',async()=>{
  const body=productionInput(),f=fixture('production',body),auth=delegated(f.pool),query=f.db.query.bind(f.db),failure=new Error('rollback');
  f.users[0].session_version++;f.db.query=async(sql,values)=>{if(sql==='ROLLBACK')throw failure;return query(sql,values);};
  await assert.rejects(reconcileProductionHistory(f.pool,auth,body),{status:401});assert.equal(f.calls.at(-1).discard,failure);
});
