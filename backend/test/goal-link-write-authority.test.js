import test from 'node:test';
import assert from 'node:assert/strict';
import { linkGoalTask, createClientGoalsRouter } from '../src/client-goals.js';
import { configuredOwnerProfiles, rememberOwnerProfileSession } from '../src/owner-profile-authority.js';
import { bindDatabaseAuthorityClient } from '../src/database-authority-context.js';

const stamp='2026-10-28T10:00:00Z';
const body=()=>({tarea_id:2,expected_tarea_updated_at:stamp,expected_pieza_updated_at:stamp});
const actor=()=>({id:91005,rol:'admin',session_version:3,nombre:'Untrusted token label'});
const ownerEnv={NODE_ENV:'test',RENDER_DB_ENVIRONMENT:'test',DATABASE_URL:'postgresql://qa@127.0.0.1:56019/fixture',
  RENDER_OWNER_PROFILES:JSON.stringify({accountId:91001,francoUserId:91005,agustinUserId:91006})};
function delegated(pool){const exp=Math.floor(Date.now()/1000)+3600,policy=configuredOwnerProfiles(ownerEnv,pool).policy;
  const auth={...actor(),root_id:91001,root_session_version:2,root_exp:exp,exp,owner_profile:'franco'};
  rememberOwnerProfileSession(auth,{...auth},policy);return auth;}
function fixture(){
  const calls=[],users=[{id:91001,rol:'admin',activo:true,session_version:2},
    {...actor(),nombre:'Persisted Franco',usuario:'internal',activo:true},{id:91006,rol:'admin',activo:true,session_version:4}];
  const task={id:2,titulo:'Task',cliente_id:1,tipo_tarea:'edicion',subtipo:'reel',estado:'pendiente',asignado_a:'Editor',
    updated_at:stamp,publicacion_id:null,periodo_trabajo:'2026-10',propiedades_extra:{workspace:'render_os'}};
  const piece={id:1,objetivo_id:1,tarea_id:3,publicacion_id:null,tipo:'video',numero:1,periodo:'2026-10',cuentas:[{id:1}],
    reels:1,carruseles:0,estado:'pendiente',updated_at:stamp};
  const db={async query(sql,values=[]){calls.push({sql,values});
    if(sql.includes('FROM usuarios')&&sql.includes('ANY('))return{rows:users};
    if(sql.startsWith('SELECT id,rol,activo,session_version,nombre,usuario FROM usuarios'))return{rows:users.filter(u=>u.id===values[0])};
    if(sql.includes('SELECT p.tarea_id,p.publicacion_id,o.clave'))return{rows:[{tarea_id:piece.tarea_id,publicacion_id:piece.publicacion_id,clave:'cliente-1',periodo:'2026-10'}]};
    if(sql.startsWith('SELECT t.*,p.tipo pieza_tipo'))return{rows:[task]};
    if(sql.startsWith('SELECT p.*,to_char'))return{rows:[piece]};
    if(sql.includes('WHERE p.id<>$1'))return{rows:[]};
    if(sql.startsWith('SELECT t.estado,p.metadata'))return{rows:[{estado:'pendiente'}]};
    if(sql.startsWith('SELECT count(*) FILTER'))return{rows:[{completadas:0,total:1}]};
    if(sql.startsWith('UPDATE cliente_objetivo_piezas')){piece.tarea_id=values[1];return{rows:[]};}
    if(/^(BEGIN|COMMIT|ROLLBACK|SELECT pg_advisory|SELECT id FROM tareas|SELECT p.id FROM publicaciones|SELECT h.id FROM historias|INSERT INTO cliente_objetivo_vinculos)/.test(sql))return{rows:[]};
    throw Error('Unmodeled goal-link SQL');},release(error){calls.push({sql:'RELEASE',discard:error});}};
  const pool={async connect(){calls.push({sql:'CONNECT'});return db;}};
  bindDatabaseAuthorityClient(db,pool);
  return{calls,users,task,piece,db,pool};
}
const writes=f=>f.calls.filter(c=>/^(INSERT|UPDATE|DELETE)/.test(c.sql));
for(const invalid of [undefined,null,'QA',{id:91005,rol:'admin'}, {id:0,rol:'admin',session_version:3}])test(`link rejects missing/full-label fallback auth ${JSON.stringify(invalid)} before pool`,async()=>{
  const f=fixture();await assert.rejects(linkGoalTask(f.pool,1,body(),invalid),{status:401});assert.deepEqual(f.calls,[]);
});
for(const rol of ['community','edicion','qa_custom_role'])test(`link rejects ${rol} without granting admin linking`,async()=>{
  const f=fixture();await assert.rejects(linkGoalTask(f.pool,1,body(),{...actor(),rol}),{status:403});assert.deepEqual(f.calls,[]);
});
test('link retains client mutex -> delegated principals -> persisted actor -> goal locks; audit label is never token supplied',async()=>{
  const f=fixture();const result=await linkGoalTask(f.pool,1,body(),delegated(f.pool));assert.equal(result.tarea_id,2);
  const order=['BEGIN ISOLATION LEVEL READ COMMITTED','pg_advisory_xact_lock(8142, 1)','WHERE id=ANY($1::int[]) ORDER BY id FOR SHARE',
    'WHERE id=$1 FOR SHARE',"hashtext('vinculo-objetivo-mensual')",'SELECT id FROM tareas','INSERT INTO cliente_objetivo_vinculos','COMMIT'];
  const positions=order.map(part=>f.calls.findIndex(c=>part==='COMMIT'?c.sql===part:c.sql.includes(part)));assert.ok(positions.every(i=>i>=0));
  assert.deepEqual([...positions].sort((a,b)=>a-b),positions);
  assert.equal(writes(f).find(c=>c.sql.startsWith('INSERT INTO cliente_objetivo_vinculos')).values[4],'Persisted Franco');
  assert.equal(JSON.stringify(writes(f)).includes('Untrusted token label'),false);
  const before=writes(f).length;await assert.rejects(linkGoalTask(f.pool,1,body(),delegated(f.pool)),{status:409});assert.equal(writes(f).length,before);
});
for(const change of ['root epoch','root inactive','actor inactive','actor role','actor epoch'])test(`link denies ${change} after pool wait before domain/DML`,async()=>{
  const f=fixture(),auth=delegated(f.pool);let resume;
  f.pool.connect=()=>new Promise(resolve=>{resume=()=>resolve(f.db);});
  const pending=linkGoalTask(f.pool,1,body(),auth);
  if(change==='root epoch')f.users[0].session_version++;
  if(change==='root inactive')f.users[0].activo=false;
  if(change==='actor inactive')f.users[1].activo=false;
  if(change==='actor role')f.users[1].rol='edicion';
  if(change==='actor epoch')f.users[1].session_version++;
  resume();await assert.rejects(pending,{status:401});assert.deepEqual(writes(f),[]);
  assert.equal(f.calls.some(c=>c.sql.includes("hashtext('vinculo-objetivo-mensual')")),false);
  assert.equal(f.calls.some(c=>c.sql==='ROLLBACK'),true);
});
test('ordinary current actor epoch and role changes deny before goal locks',async()=>{
  for(const [field,value,status]of [['session_version',4,401],['rol','community',403],['activo',false,401]]){
    const f=fixture();f.users[1][field]=value;await assert.rejects(linkGoalTask(f.pool,1,body(),actor()),{status});
    assert.deepEqual(writes(f),[]);assert.equal(f.calls.some(c=>c.sql.includes("hashtext('vinculo-objetivo-mensual')")),false);
  }
});
test('forged delegated fields reject before connection',async()=>{
  const f=fixture();await assert.rejects(linkGoalTask(f.pool,1,body(),{...delegated(f.pool)}),{status:401});assert.deepEqual(f.calls,[]);
});
test('input/auth mutations while awaiting pool cannot change retained actor, body or audit label',async()=>{
  const f=fixture(),auth=delegated(f.pool),input=body();let resume;
  f.pool.connect=()=>new Promise(resolve=>{resume=()=>resolve(f.db);});const pending=linkGoalTask(f.pool,1,input,auth);
  input.tarea_id=999;input.expected_tarea_updated_at='2000-01-01';auth.id=91006;auth.session_version=999;resume();
  assert.equal((await pending).tarea_id,2);
  assert.deepEqual(f.calls.find(c=>c.sql.startsWith('SELECT id,rol,activo,session_version,nombre,usuario FROM usuarios')).values,[91005]);
});
test('stale CAS still rejects without writes under captured authority',async()=>{
  const f=fixture();await assert.rejects(linkGoalTask(f.pool,1,{...body(),expected_pieza_updated_at:'2000-01-01'},delegated(f.pool)),{status:409});assert.deepEqual(writes(f),[]);
});
test('route requires admin and passes the original trusted auth object through to the writer',async()=>{
  const f=fixture(),router=createClientGoalsRouter({pool:f.pool}),route=router.stack.find(l=>l.route?.path==='/piezas/:id/vincular').route;
  let code;const res={status(value){code=value;return this;},json(){}};
  route.stack[0].handle({auth:{...actor(),rol:'community'}},res,()=>assert.fail('community linking denied'));assert.equal(code,403);
  await route.stack.at(-1).handle({params:{id:'1'},body:body(),auth:delegated(f.pool)},res,error=>{throw error;});
  assert.equal(f.calls.some(c=>c.sql.includes('WHERE id=ANY($1::int[]) ORDER BY id FOR SHARE')),true);
  assert.equal(writes(f)[0].values[4],'Persisted Franco');
});
test('failed rollback discards leased client rather than returning a poisoned connection',async()=>{
  const f=fixture(),query=f.db.query.bind(f.db),rollback=new Error('rollback failed');
  f.users[0].session_version++;f.db.query=async(sql,values)=>{if(sql==='ROLLBACK')throw rollback;return query(sql,values);};
  await assert.rejects(linkGoalTask(f.pool,1,body(),delegated(f.pool)),{status:401});assert.equal(f.calls.at(-1).discard,rollback);
});
