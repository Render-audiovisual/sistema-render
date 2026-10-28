import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { configuredOwnerProfiles, parseOwnerProfilePolicy, ownerProfileLogoutSubject,
  retainOwnerProfileAuthority, captureOwnerProfileWriteAuthority,
  retainCapturedOwnerProfileAuthority, rememberOwnerProfileSession } from '../src/owner-profile-authority.js';
import { bindCapturedOwnerProfileAuthority, checkCapturedOwnerProfileAuthority } from '../src/owner-profile-authority.js';
import { configuredBrowserSessions, createPrincipalAuthentication } from '../src/browser-session-config.js';
import { issueUserToken } from '../src/auth.js';
import { withProductionAuthority } from '../src/production-authority.js';
import { withFinanceWrite } from '../src/finance-write-authority.js';
import { bindDatabaseAuthorityClient } from '../src/database-authority-context.js';

const secret = 'synthetic-owner-profile-unit-test-only-secret';
const origin = 'https://render.example.test';
const mapping = { accountId: 1, francoUserId: 31, agustinUserId: 32 };
const config = { NODE_ENV:'test',RENDER_DB_ENVIRONMENT:'test',DATABASE_URL:'postgresql://fixture@127.0.0.1:55989/render2_local_test',
  RENDER_OWNER_PROFILES:JSON.stringify(mapping),JWT_SECRET:secret,RENDER_BROWSER_SESSIONS:'true',RENDER_BROWSER_ORIGIN:origin };
const user = (id,nombre) => ({id,usuario:`synthetic-${id}`,nombre,rol:'admin',activo:true,session_version:1,foto_perfil:null});
const response = () => ({headers:{},statusCode:200,set(k,v){this.headers[k.toLowerCase()]=v;return this;},
  status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}});
function fixture(env={}) {
  const rows=[user(1,'Líder sin cambios'),user(31,'QA Franco'),user(32,'QA Agustín'),user(99,'Other admin')],calls=[];
  const db={async query(sql,params=[]){calls.push({sql,params});
    if(sql.includes('FROM usuarios WHERE id=ANY'))return {rows:rows.filter(r=>params[0].includes(r.id)).map(r=>({...r}))};
    if(sql.includes('FROM usuarios WHERE id=$1'))return {rows:rows.filter(r=>r.id===params[0]).map(r=>({...r}))};
    if(/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/.test(sql)||sql.includes('pg_advisory_xact_lock'))return {rows:[]};
    assert.fail('Unexpected SQL');},release(){}};
  const pool={query:db.query,async connect(){return db;}},settings={...config,...env};
  bindDatabaseAuthorityClient(db,pool);
  const transport=configuredBrowserSessions(settings,pool);
  const issued=(target=rows[0],options) => {const res=response(),context=transport.establishSession(target,res,options);
    const cookie=res.headers['set-cookie'].split(';')[0];return {res,context,cookie,claims:jwt.verify(cookie.split('=')[1],secret)};};
  const authenticate=async(current,{method='POST',headers={}}={})=>{
    const req={method,headers:{cookie:current.cookie,origin,'x-render-session-context':current.context.session_context,
      'x-render-csrf':current.context.csrf_token,...headers}},res=response();let continued=false,error;
    await transport.authenticate(req,res,e=>{error=e;continued=!e;});return {req,res,continued,error};
  };
  return {rows,calls,pool,transport,issued,authenticate};
}

test('config default off, closed mapping, no name inference and no root/target14 impersonation',()=>{
  assert.equal(configuredOwnerProfiles({},{}),null);
  assert.equal(parseOwnerProfilePolicy({RENDER_OWNER_PROFILES:''}),null);
  for(const m of [{...mapping,extra:true},{...mapping,accountId:99},{...mapping,francoUserId:14},
    {...mapping,francoUserId:1},{...mapping,francoUserId:'31'},{...mapping,agustinUserId:'Franco Romero'},
    {...mapping,agustinUserId:31}])assert.throws(()=>parseOwnerProfilePolicy({...config,RENDER_OWNER_PROFILES:JSON.stringify(m)}));
  for(const accountId of [91001,91002])assert.equal(parseOwnerProfilePolicy({...config,
    RENDER_OWNER_PROFILES:JSON.stringify({...mapping,accountId})}).accountId,accountId);
  assert.throws(()=>configuredBrowserSessions({...config,NODE_ENV:'production',RENDER_BROWSER_SESSIONS:'false'},{}));
  assert.throws(()=>parseOwnerProfilePolicy({...config,NODE_ENV:'development',RENDER_DB_ENVIRONMENT:'development',
    RENDER_OWNER_PROFILES:JSON.stringify({...mapping,accountId:91001})}));
});
for(const env of [{NODE_ENV:'production'},{RENDER_DB_ENVIRONMENT:'production'},
  {DATABASE_URL:'postgresql://fixture@remote.example.invalid/render'}, {NODE_ENV:undefined},
  {RENDER_DB_ENVIRONMENT:undefined}])test('configured delegation is rejected outside explicitly local runtime',()=>{
  assert.throws(()=>parseOwnerProfilePolicy({...config,...env}));
  assert.equal(parseOwnerProfilePolicy({...config,...env,RENDER_OWNER_PROFILES:undefined}),null);
});

test('root login keeps authenticated Leader ID and own identity until explicitly switching',async()=>{
  const f=fixture(),before=structuredClone(f.rows),current=f.issued(),auth=await f.authenticate(current);
  assert.equal(auth.continued,true);assert.equal(auth.req.auth.id,1);assert.equal(auth.req.auth.nombre,'Líder sin cambios');
  assert.deepEqual(await f.transport.ownerProfiles.describe(auth.req.auth),{principal_id:1,active:null,profiles:[
    {key:'franco',user_id:31,name:'Franco'},{key:'agustin',user_id:32,name:'Agustín'}]});
  assert.equal(await f.transport.ownerProfiles.describe({...auth.req.auth,id:99}),undefined);
  assert.deepEqual(f.rows,before);assert.equal(f.calls.some(c=>/\b(?:UPDATE|INSERT|DELETE)\b/.test(c.sql)),false);
});

test('main DTO material describe({...user,...delegation,exp:root_exp}) matches finalized API',async()=>{
  const f=fixture(),authenticated=await f.authenticate(f.issued());
  const {user,delegation}=await f.transport.ownerProfiles.switchProfile(authenticated.req.auth,'franco');
  const metadata=await f.transport.ownerProfiles.describe({...user,...delegation,exp:delegation.root_exp});
  assert.equal(metadata.principal_id,1);assert.equal(metadata.active,'franco');
  assert.deepEqual(metadata.profiles.map(p=>Object.keys(p)),[['key','user_id','name'],['key','user_id','name']]);
  assert.equal(f.issued(user,{delegation}).res.headers['x-render-session-context'].length,43);
});

test('root→Franco→Agustin signs real effective actors, preserves ceiling, rotates contexts and revalidates both IDs',async()=>{
  const f=fixture(),root=f.issued(),rootAuth=await f.authenticate(root);
  const first=await f.transport.ownerProfiles.switchProfile(rootAuth.req.auth,'franco');
  const franco=f.issued(first.user,{delegation:first.delegation}),fa=await f.authenticate(franco);
  assert.equal(fa.continued,true);assert.equal(fa.req.auth.id,31);assert.equal(fa.req.auth.root_id,1);
  assert.equal(fa.req.auth.rol,'admin');assert.equal(franco.claims.root_session_version,1);
  assert.equal(franco.claims.root_exp,root.claims.exp);assert.equal(franco.claims.exp,root.claims.exp);
  assert.notEqual(franco.context.session_context,root.context.session_context);
  assert.notEqual(franco.context.csrf_token,root.context.csrf_token);
  assert.match(franco.res.headers['set-cookie'],/HttpOnly; SameSite=Lax; Max-Age=\d+; Secure/);
  const second=await f.transport.ownerProfiles.switchProfile(fa.req.auth,'agustin');
  const agustin=f.issued(second.user,{delegation:second.delegation}),aa=await f.authenticate(agustin);
  assert.equal(aa.req.auth.id,32);assert.equal(agustin.claims.exp,root.claims.exp);
  assert.equal((await f.transport.ownerProfiles.describe(aa.req.auth)).active,'agustin');
  assert.deepEqual(ownerProfileLogoutSubject(aa.req.auth),{id:1,session_version:1});
  assert.ok(f.calls.some(c=>c.sql.includes('ORDER BY id FOR SHARE')));
});

test('CSRF/context/origin failures on switch POST never reach authority action',async()=>{
  const f=fixture(),root=f.issued();
  for(const headers of [{'x-render-csrf':'bad'},{'x-render-session-context':'bad'},
    {origin:'https://evil.example.invalid'},{authorization:'Bearer synthetic'}]){
    const result=await f.authenticate(root,{headers});assert.equal(result.continued,false);assert.ok([400,403,409].includes(result.res.statusCode));
  }
  const auth=await f.authenticate(root),material=await f.transport.ownerProfiles.switchProfile(auth.req.auth,'franco');
  const next=f.issued(material.user,{delegation:material.delegation});
  assert.equal((await f.authenticate(next,{headers:{'x-render-session-context':root.context.session_context}})).res.statusCode,409);
});

for(const [id,patch] of [[1,{activo:false}],[1,{rol:'edicion'}],[1,{session_version:2}],
  [31,{activo:false}],[31,{rol:'edicion'}],[31,{session_version:2}]])test(`root/actor revocation ${id}/${Object.keys(patch)[0]} invalidates delegated request`,async()=>{
  const f=fixture(),auth=await f.authenticate(f.issued()),material=await f.transport.ownerProfiles.switchProfile(auth.req.auth,'franco');
  const current=f.issued(material.user,{delegation:material.delegation});Object.assign(f.rows.find(r=>r.id===id),patch);
  const result=await f.authenticate(current);assert.equal(result.continued,false);assert.equal(result.res.statusCode,401);
});

test('disabled/remapped config and bearer replay reject signed delegation, while direct legacy identity survives',async()=>{
  const f=fixture(),auth=await f.authenticate(f.issued()),material=await f.transport.ownerProfiles.switchProfile(auth.req.auth,'franco');
  const current=f.issued(material.user,{delegation:material.delegation});
  for(const env of [{RENDER_OWNER_PROFILES:undefined},{RENDER_OWNER_PROFILES:JSON.stringify({...mapping,francoUserId:33})}]){
    const other=fixture(env);assert.equal((await other.authenticate(current)).res.statusCode,401);
  }
  const previous=process.env.JWT_SECRET;process.env.JWT_SECRET=secret;
  try{const req={method:'GET',headers:{authorization:`Bearer ${current.cookie.split('=')[1]}`}},res=response();
    await createPrincipalAuthentication({browserTransport:f.transport,pool:f.pool})(req,res,()=>assert.fail('Bearer cannot replay delegation'));
    assert.equal(res.statusCode,401);
  }finally{if(previous===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=previous;}
  const other=fixture({RENDER_OWNER_PROFILES:undefined});assert.equal((await other.authenticate(other.issued(other.rows[3]))).req.auth.id,99);
});

test('unverified auth/unknown keys/forged material cannot mint delegation',async()=>{
  const f=fixture(),auth=await f.authenticate(f.issued());
  for(const key of ['Franco','14','root','',null,{}])await assert.rejects(f.transport.ownerProfiles.switchProfile(auth.req.auth,key),{status:403});
  await assert.rejects(f.transport.ownerProfiles.switchProfile({...auth.req.auth},'franco'),{status:403});
  assert.throws(()=>f.issued(f.rows[1],{delegation:{root_id:1,root_session_version:1,root_exp:9999999999,owner_profile:'franco'}}));
});

test('original root expiry cannot be extended and malformed partial/overceiling claims fail',async()=>{
  const f=fixture();
  const make=claims=>{const token=jwt.sign(claims,secret,{issuer:'render',audience:'render-api',jwtid:'11111111-1111-4111-8111-111111111111'});
    // GET omits context comparison, but always validates claims/current authority.
    return f.authenticate({cookie:`__Host-render_session=${token}`,context:{}},{method:'GET'});};
  const future=Math.floor(Date.now()/1000)+60;
  for(const claim of [{id:31,session_version:1,root_id:1,exp:future},
    {id:31,session_version:1,root_id:1,root_session_version:1,owner_profile:'franco',root_exp:future,exp:future+60},
    {id:31,session_version:1,root_id:1,root_session_version:1,owner_profile:'agustin',root_exp:future,exp:future}])
    assert.equal((await make(claim)).res.statusCode,401);
  const rootToken=jwt.sign({id:1,session_version:1,exp:future},secret,
    {issuer:'render',audience:'render-api',jwtid:'11111111-1111-4111-8111-111111111111'});
  const req=await f.authenticate({cookie:`__Host-render_session=${rootToken}`,context:{}},{method:'GET'});
  const material=await f.transport.ownerProfiles.switchProfile(req.req.auth,'franco');
  assert.equal(f.issued(material.user,{delegation:material.delegation}).claims.exp,future);
});

test('transaction root guard observes revocation after middleware (production remains config-blocked)',async()=>{
  const f=fixture(),auth=await f.authenticate(f.issued()),material=await f.transport.ownerProfiles.switchProfile(auth.req.auth,'franco');
  const delegated=await f.authenticate(f.issued(material.user,{delegation:material.delegation}));
  f.rows[0].session_version++;
  await assert.rejects(retainOwnerProfileAuthority(f.pool,delegated.req.auth,f.transport.ownerProfiles.policy),{status:401});
  assert.ok(f.calls.at(-1).sql.includes('FOR SHARE'));
  assert.deepEqual(ownerProfileLogoutSubject({id:99,session_version:4}),{id:99,session_version:4});
});

test('captured delegation cannot be forged and survives caller mutation while observing current revocation', async()=>{
  const f=fixture(),root=await f.authenticate(f.issued());
  assert.equal(captureOwnerProfileWriteAuthority(root.req.auth),null);
  const material=await f.transport.ownerProfiles.switchProfile(root.req.auth,'franco');
  const delegated=await f.authenticate(f.issued(material.user,{delegation:material.delegation}));
  const auth=delegated.req.auth;
  assert.throws(()=>captureOwnerProfileWriteAuthority({...auth}),{status:401});
  const handle=captureOwnerProfileWriteAuthority(auth);
  assert.deepEqual(Object.keys(handle),[]);
  await assert.rejects(retainCapturedOwnerProfileAuthority(f.pool,{}),{status:401});
  await assert.rejects(retainCapturedOwnerProfileAuthority(f.pool,undefined),{status:401});
  auth.root_session_version=999;
  await retainCapturedOwnerProfileAuthority(f.pool,handle);
  assert.match(f.calls.at(-1).sql,/ORDER BY id FOR SHARE/);
  f.rows[0].session_version++;
  await assert.rejects(retainCapturedOwnerProfileAuthority(f.pool,handle),{status:401});
  await retainCapturedOwnerProfileAuthority(f.pool,null);
});

test('verified delegation cannot be changed to its sibling or stripped before capture',async()=>{
  for(const mutate of [a=>{a.id=32;a.owner_profile='agustin';},a=>{a.root_session_version++;},
    a=>{for(const key of ['root_id','root_session_version','root_exp','owner_profile'])delete a[key];}]){
    const f=fixture(),root=await f.authenticate(f.issued());
    const material=await f.transport.ownerProfiles.switchProfile(root.req.auth,'franco');
    const delegated=await f.authenticate(f.issued(material.user,{delegation:material.delegation}));
    mutate(delegated.req.auth);
    assert.throws(()=>captureOwnerProfileWriteAuthority(delegated.req.auth),{status:401});
  }
});

test('shorter delegated expiry is checked again after waiting for principal locks',async()=>{
  const f=fixture(),now=Date.now,instant=now();
  const auth={id:31,session_version:1,root_id:1,root_session_version:1,owner_profile:'franco',
    exp:Math.floor(instant/1000)+10,root_exp:Math.floor(instant/1000)+120};
  rememberOwnerProfileSession(auth,auth,f.transport.ownerProfiles.policy);
  const captured=captureOwnerProfileWriteAuthority(auth);
  try {
    const db={async query(...args){const result=await f.pool.query(...args);Date.now=()=>instant+11000;return result;}};
    bindDatabaseAuthorityClient(db,f.pool);
    await assert.rejects(retainCapturedOwnerProfileAuthority(db,captured),{status:401});
  } finally {Date.now=now;}
});

test('immutable scalar projections preserve principal on recapture and read-only checks never lock',async()=>{
  const f=fixture(),root=await f.authenticate(f.issued());
  const material=await f.transport.ownerProfiles.switchProfile(root.req.auth,'franco');
  const delegated=(await f.authenticate(f.issued(material.user,{delegation:material.delegation}))).req.auth;
  const first=bindCapturedOwnerProfileAuthority(delegated,Object.freeze({id:31,session_version:1}));
  const next=bindCapturedOwnerProfileAuthority(first,Object.freeze({...first}));
  assert.throws(()=>bindCapturedOwnerProfileAuthority(first,{...first}),{status:401});
  assert.throws(()=>bindCapturedOwnerProfileAuthority(first,Object.freeze({...first,id:32})),{status:401});
  const handle=captureOwnerProfileWriteAuthority(next);
  await checkCapturedOwnerProfileAuthority(f.pool,handle);
  assert.doesNotMatch(f.calls.at(-1).sql,/FOR SHARE|FOR UPDATE/);
  await retainCapturedOwnerProfileAuthority(f.pool,handle,{lockMode:'update'});
  assert.match(f.calls.at(-1).sql,/ORDER BY id FOR UPDATE/);
  await assert.rejects(retainCapturedOwnerProfileAuthority(f.pool,handle,{lockMode:'invalid'}),{status:401});
  f.rows[0].session_version++;
  await assert.rejects(checkCapturedOwnerProfileAuthority(f.pool,handle),{status:401});
});

test('matching user IDs and epochs in another pool never authorize a delegated operation',async()=>{
  const f=fixture(),other=fixture(),root=await f.authenticate(f.issued());
  const material=await f.transport.ownerProfiles.switchProfile(root.req.auth,'franco');
  const delegated=(await f.authenticate(f.issued(material.user,{delegation:material.delegation}))).req.auth;
  const handle=captureOwnerProfileWriteAuthority(delegated),before=other.calls.length;
  await assert.rejects(retainCapturedOwnerProfileAuthority(other.pool,handle),{status:401});
  await assert.rejects(checkCapturedOwnerProfileAuthority(other.pool,handle),{status:401});
  await assert.rejects(retainOwnerProfileAuthority(other.pool,delegated,f.transport.ownerProfiles.policy),{status:401});
  assert.equal(other.calls.length,before,'Wrong destination rejected before SQL');
});

for (const [name,write] of [
  ['production',(pool,auth,mutate)=>withProductionAuthority(pool,auth,false,mutate)],
  ['finance',withFinanceWrite],
]) test(`${name} retains delegated principal before domain writes and rejects revocation during connection wait`,async()=>{
  for (const revoked of [false,true]) {
    const f=fixture(),root=await f.authenticate(f.issued());
    const material=await f.transport.ownerProfiles.switchProfile(root.req.auth,'franco');
    const delegated=await f.authenticate(f.issued(material.user,{delegation:material.delegation}));
    f.calls.length=0;
    const pool={async connect(){
      const db=await f.pool.connect();
      if(revoked)f.rows[0].session_version++;
      return db;
    }};
    let mutations=0;
    const work=write(pool,delegated.req.auth,async()=>{mutations++;return 'saved';});
    if(revoked) {
      await assert.rejects(work,{status:401});assert.equal(mutations,0);
      assert.ok(f.calls.some(c=>c.sql==='ROLLBACK'));
      assert.equal(f.calls.some(c=>c.sql==='COMMIT'),false);
    } else {assert.equal(await work,'saved');assert.equal(mutations,1);}
    const principal=f.calls.findIndex(c=>c.sql.includes('ORDER BY id FOR SHARE'));
    assert.ok(principal>0);
    const actor=f.calls.findIndex(c=>c.sql.includes('WHERE id=$1 FOR SHARE'));
    if(!revoked)assert.ok(actor>principal);
    if(name==='finance')assert.ok(f.calls.findIndex(c=>c.sql.includes('pg_advisory_xact_lock'))<principal);
  }
});
