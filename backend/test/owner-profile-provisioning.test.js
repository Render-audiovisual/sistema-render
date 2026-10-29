import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prepareOwnerProfileProvisioning as prepare, applyOwnerProfileProvisioning as apply } from '../src/owner-profile-provisioning.js';

const PASSWORD='!RENDER_OWNER_PROFILE_V1_NO_LOGIN';
const usernames=['render.owner.franco','render.owner.agustin'];
const types={id:['integer',true],usuario:['text',true],nombre:['text',true],rol:['text',true],password_hash:['text',true],
  google_id:['text',false],google_email:['text',false],email_notificaciones:['text',false],activo:['boolean',true],
  session_version:['integer',true],user_admin_version:['integer',true],whatsapp_id_hash:['character(64)',false],whatsapp_habilitado:['boolean',true]};
const user=(id,extra={})=>({id,usuario:`source.${id}`,nombre:`Source ${id}`,rol:'admin',password_hash:'PRIVATE_SOURCE_PASSWORD',
  google_id:'PRIVATE_GOOGLE',google_email:'PRIVATE_EMAIL',email_notificaciones:'PRIVATE_NOTIFICATION',activo:true,session_version:2,
  user_admin_version:4,whatsapp_id_hash:'PRIVATE_WHATSAPP',whatsapp_habilitado:true,created_at:'2026-10-01',...extra});
const internal=(id,index,extra={})=>user(id,{usuario:usernames[index],nombre:index===0?'Franco':'Agustín',password_hash:PASSWORD,
  google_id:null,google_email:null,email_notificaciones:null,session_version:1,user_admin_version:1,
  whatsapp_id_hash:null,whatsapp_habilitado:false,...extra});
const sha=value=>createHash('sha256').update(value).digest('hex');
function fixture(){
  const calls=[],state={users:[user(1),user(9,{rol:'edicion'}),user(14,{nombre:'Franco Romero'})],nextId:101,
    isolation:'read committed',readOnly:'off',transaction:true,insertError:false,mutateOriginal:false};
  const columns=Object.entries(types).map(([name,[type,notNull]])=>({name,type,notNull,compatible:true,identity:'',generated:'',
    primaryKey:name==='id',uniqueColumn:['id','usuario'].includes(name),sequence:'public.usuarios_id_seq',
    defaultSql:name==='id'?"nextval('usuarios_id_seq'::regclass)":name==='activo'?'true':['session_version','user_admin_version'].includes(name)?'1':''}));
  const original=structuredClone(state.users);
  const db={async query(sql,values=[]){calls.push({sql,values:structuredClone(values)});
    if(sql.includes('FROM pg_attribute a JOIN pg_class'))return{rows:structuredClone(columns)};
    if(sql.includes("current_setting('transaction_isolation')"))return{rows:[{isolation:state.isolation,readOnly:state.readOnly}]};
    if(sql.startsWith('SELECT pg_advisory_xact_lock'))return{rows:[]};
    if(sql.startsWith('LOCK TABLE')){if(!state.transaction)throw Error('LOCK requires transaction');return{rows:[]};}
    if(sql.startsWith('SELECT id FROM public.usuarios'))return{rows:state.users.filter(u=>u.id===1).map(u=>({id:u.id}))};
    if(sql.includes('AS "usersFingerprint"')){
      const root=state.users.find(u=>u.id===1),rows=state.users.filter(u=>!values[0].includes(u.id)).sort((a,b)=>a.id-b.id);
      const profiles=state.users.filter(u=>usernames.includes(u.usuario.toLowerCase())).map(u=>({username:u.usuario,id:u.id,
        canonical:usernames.includes(u.usuario)&&u.nombre===(u.usuario===usernames[0]?'Franco':'Agustín')&&u.rol==='admin'
          &&u.password_hash===PASSWORD&&u.google_id===null&&u.google_email===null&&u.email_notificaciones===null&&u.activo===true
          &&Number.isSafeInteger(u.session_version)&&u.session_version>0&&Number.isSafeInteger(u.user_admin_version)&&u.user_admin_version>0
          &&u.whatsapp_id_hash===null&&u.whatsapp_habilitado===false}));
      return{rows:[{root:root?{id:1,role:root.rol,active:root.activo,version:root.session_version}:null,
        usersCount:String(rows.length),usersFingerprint:sha(rows.map(u=>sha(JSON.stringify(u))).join('')),profiles}]};
    }
    if(sql.startsWith('INSERT INTO public.usuarios')){
      if(state.insertError)throw Error('private SQL error');
      assert.deepEqual(values,[...usernames,'Franco','Agustín',PASSWORD]);
      const added=[internal(state.nextId++,0),internal(state.nextId++,1)];state.users.push(...added);
      if(state.mutateOriginal)state.users[0].nombre='Unexpected trigger side effect';
      return{rows:added.map(u=>({id:u.id,usuario:u.usuario}))};
    }
    throw Error('Unmodeled provisioning query');
  }};
  return{db,calls,state,columns,original,callerRollback(){state.users=structuredClone(original);}};
}
const inserts=f=>f.calls.filter(c=>c.sql.startsWith('INSERT'));
test('prepare is SELECT-only, exact closed immutable plan with SQL all-row fingerprint and no secret fields',async()=>{
  const f=fixture(),plan=await prepare(f.db);
  assert.deepEqual(Object.keys(plan),['version','rootVersion','usersCount','usersFingerprint','profiles','sha256']);
  assert.equal(plan.rootVersion,2);assert.equal(plan.usersCount,'3');assert.match(plan.usersFingerprint,/^[a-f0-9]{64}$/);
  assert.deepEqual(plan.profiles,{francoUserId:null,agustinUserId:null});assert.ok(Object.isFrozen(plan)&&Object.isFrozen(plan.profiles));
  assert.ok(f.calls.every(c=>c.sql.startsWith('SELECT')));assert.match(f.calls[1].sql,/sha256\(convert_to\(to_jsonb\(u\)::text/);
  assert.doesNotMatch(JSON.stringify(plan),/PRIVATE_|password_hash|google|whatsapp/);assert.deepEqual(f.state.users,f.original);
});
test('apply uses account mutex, table lock, root lock and one two-row INSERT with SERIAL defaults only',async()=>{
  const f=fixture(),plan=await prepare(f.db);f.calls.length=0;
  const mapping=await apply(f.db,plan);
  assert.deepEqual(mapping,{accountId:1,francoUserId:101,agustinUserId:102});assert.ok(Object.isFrozen(mapping));
  assert.match(f.calls[0].sql,/current_setting\('transaction_isolation'\)/);
  assert.equal(f.calls[1].sql,'SELECT pg_advisory_xact_lock(20261019, 1)');
  assert.equal(f.calls[2].sql,'LOCK TABLE public.usuarios IN SHARE ROW EXCLUSIVE MODE');
  assert.match(f.calls[4].sql,/WHERE id=1 ORDER BY id FOR UPDATE/);assert.equal(inserts(f).length,1);
  assert.doesNotMatch(inserts(f)[0].sql,/\(id,|UPDATE|ON CONFLICT/);
  assert.deepEqual(f.state.users.filter(u=>[1,9,14].includes(u.id)),f.original);
  assert.equal(f.calls.some(c=>/^(BEGIN|COMMIT|ROLLBACK|UPDATE|DELETE|CREATE|ALTER)/.test(c.sql)),false);
  assert.equal(f.calls.some(c=>/\btareas\b|tarea_asignaciones/.test(c.sql)),false);
});
test('old pre-insert plan is stale; explicit reprepare verifies exact internal rows and permits no-insert replay',async()=>{
  const f=fixture(),old=await prepare(f.db),first=await apply(f.db,old);
  await assert.rejects(apply(f.db,old),{code:'OWNER_PROVISIONING_STALE',status:409});assert.equal(inserts(f).length,1);
  const receipt=await prepare(f.db);assert.deepEqual(receipt.profiles,{francoUserId:first.francoUserId,agustinUserId:first.agustinUserId});
  assert.deepEqual(await apply(f.db,receipt),first);assert.equal(inserts(f).length,1);
  assert.deepEqual(await apply(f.db,receipt),first);assert.equal(inserts(f).length,1);
});
for(const changed of ['password_hash','nombre','rol','session_version','new user'])test(`any original usuarios change invalidates fingerprint: ${changed}`,async()=>{
  const f=fixture(),plan=await prepare(f.db);
  if(changed==='new user')f.state.users.push(user(25));else f.state.users[1][changed]=changed==='session_version'?99:'Changed';
  await assert.rejects(apply(f.db,plan),{code:'OWNER_PROVISIONING_STALE'});assert.equal(inserts(f).length,0);
});
for(const change of ['missing','inactive','role','version'])test(`root ${change} rejects apply without INSERT`,async()=>{
  const f=fixture(),plan=await prepare(f.db);
  if(change==='missing')f.state.users.shift();if(change==='inactive')f.state.users[0].activo=false;
  if(change==='role')f.state.users[0].rol='community';if(change==='version')f.state.users[0].session_version++;
  await assert.rejects(apply(f.db,plan),{status:401});assert.equal(inserts(f).length,0);
});
for(const state of ['partial','collision','wrong case','edited canonical','source14'])test(`reserved ${state} is rejected, never promoted or renamed`,async()=>{
  const f=fixture();
  if(state==='partial')f.state.users.push(internal(101,0));
  if(state==='collision')f.state.users.push(internal(101,0,{password_hash:'existing account'}),internal(102,1));
  if(state==='wrong case')f.state.users.push(internal(101,0,{usuario:'Render.Owner.Franco'}),internal(102,1));
  if(state==='edited canonical')f.state.users.push(internal(101,0),internal(102,1,{password_hash:'changed login credential'}));
  if(state==='source14'){f.state.users=f.state.users.filter(u=>u.id!==14);f.state.users.push(internal(14,0),internal(102,1));}
  const before=structuredClone(f.state.users);
  await assert.rejects(prepare(f.db),{code:'OWNER_PROVISIONING_PARTIAL_OR_COLLISION'});
  assert.equal(inserts(f).length,0);assert.deepEqual(f.state.users,before);
});
for(const invalid of ['missing column','wrong type','nullable password','identity id','insert trigger','missing primary key','missing username unique','wrong session default'])test(`schema ${invalid} fails closed`,async()=>{
  const f=fixture(),column=name=>f.columns.find(c=>c.name===name);
  if(invalid==='missing column')f.columns.splice(f.columns.findIndex(c=>c.name==='google_id'),1);
  if(invalid==='wrong type')column('session_version').type='text';
  if(invalid==='nullable password')column('password_hash').notNull=false;
  if(invalid==='identity id')column('id').identity='a';
  if(invalid==='insert trigger')column('id').compatible=false;
  if(invalid==='missing primary key')column('id').primaryKey=false;
  if(invalid==='missing username unique')column('usuario').uniqueColumn=false;
  if(invalid==='wrong session default')column('session_version').defaultSql='2';
  await assert.rejects(prepare(f.db),{status:409});assert.equal(inserts(f).length,0);
});
test('missing table or failed SQL is sanitized and cannot expose secret error text',async()=>{
  const db={async query(){throw Error('PRIVATE_CREDENTIAL_CONNECTION_STRING');}};
  await assert.rejects(prepare(db),error=>error.code==='OWNER_PROVISIONING_SCHEMA'&&!error.message.includes('PRIVATE'));
});
test('tampered, open-shape and partial plans reject before querying',async()=>{
  const f=fixture(),plan=await prepare(f.db);f.calls.length=0;
  for(const bad of [null,{}, {...plan,extra:true},{...plan,rootVersion:999},{...plan,profiles:{francoUserId:101,agustinUserId:null}},
    {...plan,[Symbol('hidden')]:true},{...plan,usersCount:'3\n'},{...plan,usersFingerprint:plan.usersFingerprint+'\n'}])
    await assert.rejects(apply(f.db,bad),{code:'OWNER_PROVISIONING_PLAN',status:400});
  assert.deepEqual(f.calls,[]);
});
test('schema drift between preparation and application rejects before INSERT',async()=>{
  const f=fixture(),plan=await prepare(f.db);f.columns.find(c=>c.name==='id').primaryKey=false;
  await assert.rejects(apply(f.db,plan),{code:'OWNER_PROVISIONING_DEFAULTS'});assert.equal(inserts(f).length,0);
});
test('legitimate internal session/admin version increments and photo edits permit explicit reprepare, never version reset',async()=>{
  const f=fixture(),old=await prepare(f.db);await apply(f.db,old);const before=await prepare(f.db);
  const franco=f.state.users.find(u=>u.usuario===usernames[0]);franco.session_version=5;franco.user_admin_version=7;franco.foto_perfil='local-photo';
  await assert.rejects(apply(f.db,before),{code:'OWNER_PROVISIONING_STALE'});
  const snapshot=structuredClone(f.state.users),fresh=await prepare(f.db);
  assert.deepEqual(await apply(f.db,fresh),{accountId:1,francoUserId:101,agustinUserId:102});
  assert.deepEqual(f.state.users,snapshot);assert.equal(inserts(f).length,1);
});
for(const patch of [{session_version:0},{user_admin_version:0},{activo:false},{google_id:'external-login'},{email_notificaciones:'contact@example.invalid'}])
test(`internal invalid identity/contact remains fail-closed: ${JSON.stringify(patch)}`,async()=>{
  const f=fixture();f.state.users.push(internal(101,0,patch),internal(102,1));
  await assert.rejects(prepare(f.db),{code:'OWNER_PROVISIONING_PARTIAL_OR_COLLISION'});assert.equal(inserts(f).length,0);
});
test('reserved account appearing after preparation rejects rather than adopting or overwriting it',async()=>{
  const f=fixture(),plan=await prepare(f.db);f.state.users.push(user(101,{usuario:usernames[0]}));
  await assert.rejects(apply(f.db,plan),{code:'OWNER_PROVISIONING_PARTIAL_OR_COLLISION'});assert.equal(inserts(f).length,0);
});
for(const mode of ['read only','repeatable read','autocommit'])test(`${mode} cannot apply outside caller read-committed write transaction`,async()=>{
  const f=fixture(),plan=await prepare(f.db);
  if(mode==='read only')f.state.readOnly='on';if(mode==='repeatable read')f.state.isolation='repeatable read';if(mode==='autocommit')f.state.transaction=false;
  await assert.rejects(apply(f.db,plan),{status:409});assert.equal(inserts(f).length,0);
});
test('database failure leaves rollback solely to caller; same baseline can be reprepared after caller rollback',async()=>{
  const f=fixture(),plan=await prepare(f.db);f.state.insertError=true;
  await assert.rejects(apply(f.db,plan),{code:'OWNER_PROVISIONING_APPLY_FAILED'});
  assert.equal(f.calls.some(c=>/^(BEGIN|COMMIT|ROLLBACK)/.test(c.sql)),false);
  f.callerRollback();f.state.insertError=false;assert.deepEqual(await apply(f.db,await prepare(f.db)),{accountId:1,francoUserId:101,agustinUserId:102});
});
test('postinsert original-user drift rejects; caller must roll back both inserted users and drift',async()=>{
  const f=fixture(),plan=await prepare(f.db);f.state.mutateOriginal=true;
  await assert.rejects(apply(f.db,plan),{code:'OWNER_PROVISIONING_ORIGINAL_USERS_CHANGED'});
  assert.equal(f.state.users.length,5,'Mock changes remain pending: module does not pretend to own rollback');
  f.callerRollback();assert.deepEqual(f.state.users,f.original);
});
test('normal SERIAL allocation reaching protected14 rejects pending insertion; never reseeds or repurposes14',async()=>{
  const f=fixture();f.state.users=f.state.users.filter(u=>u.id!==14);const plan=await prepare(f.db);f.state.nextId=14;
  await assert.rejects(apply(f.db,plan),{code:'OWNER_PROVISIONING_INSERT'});
  assert.equal(f.calls.some(c=>/setval|ALTER SEQUENCE/.test(c.sql)),false);
});
test('plan is copied before awaiting database, so caller mutation cannot change approved snapshot',async()=>{
  const f=fixture(),plan=structuredClone(await prepare(f.db)),query=f.db.query.bind(f.db);let resume;
  f.db.query=(sql,args)=>sql.includes("current_setting('transaction_isolation')")?new Promise(resolve=>{resume=()=>resolve({rows:[{isolation:'read committed',readOnly:'off'}]});}):query(sql,args);
  const pending=apply(f.db,plan);plan.rootVersion=99;plan.profiles.francoUserId=999;resume();
  assert.deepEqual(await pending,{accountId:1,francoUserId:101,agustinUserId:102});
});
