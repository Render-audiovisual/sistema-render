import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredOwnerProfiles, rememberOwnerProfileSession, bindCapturedOwnerProfileAuthority } from '../src/owner-profile-authority.js';
import { bindDatabaseAuthorityClient } from '../src/database-authority-context.js';
import { withPersonalListWrite } from '../src/personal-list-write-authority.js';
import { createPersonalListWithReceipt, findPersonalListCreation } from '../src/personal-list-create-receipts.js';
import { createPersonalListBlockWithReceipt, findPersonalListBlockCreation } from '../src/personal-list-block-create-receipts.js';
import { createTaskComment, findTaskCommentCreation } from '../src/task-comment-receipts.js';
import { applyFeedbackBrowserOperation } from '../src/feedback-browser-write.js';

// Transaction doubles only: no database, server, credentials or production gate.
const key = '10000000-0000-4000-8000-000000000001';
const env = { NODE_ENV: 'test', RENDER_DB_ENVIRONMENT: 'test',
  DATABASE_URL: 'postgresql://synthetic@127.0.0.1:55989/render2_local_test',
  RENDER_OWNER_PROFILES: JSON.stringify({ accountId: 1, francoUserId: 31, agustinUserId: 32 }) };
function session(pool) {
  const policy = configuredOwnerProfiles(env,pool).policy;
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const auth = { id: 31, session_version: 1, rol: 'admin', root_id: 1,
    root_session_version: 1, root_exp: exp, exp, owner_profile: 'franco' };
  rememberOwnerProfileSession(auth, auth, policy);
  return auth;
}
const cases = [
  { name: 'personal list mutation', mode: 'UPDATE', run: (p,a) => withPersonalListWrite(p,a,{},async db => db.query('DOMAIN')) },
  { name: 'personal list create/replay', mode: 'UPDATE', run: (p,a) => createPersonalListWithReceipt(p,a,{requestId:key,payload:{titulo:'QA',emoji:'',bloques:[]}}) },
  { name: 'personal list receipt lookup', mode: 'SHARE', run: (p,a) => findPersonalListCreation(p,a,key) },
  { name: 'block create/replay', mode: 'UPDATE', run: (p,a) => createPersonalListBlockWithReceipt(p,a,{requestId:key,listId:'8',payload:{tipo:'texto',contenido:{texto:'QA'}}}) },
  { name: 'block receipt lookup', mode: 'SHARE', run: (p,a) => findPersonalListBlockCreation(p,a,'8',key) },
  { name: 'comment create/replay', mode: 'SHARE', run: (p,a) => createTaskComment(p,a,{taskId:8,workspace:'render_os',requestId:key,payload:{autor:'QA',contenido:'QA'}}) },
  { name: 'comment receipt lookup', mode: 'SHARE', run: (p,a) => findTaskCommentCreation(p,a,{taskId:8,workspace:'render_os',requestId:key}) },
  { name: 'feedback operation/replay', mode: 'SHARE', mutex: true, run: (p,a) => applyFeedbackBrowserOperation(p,a,{request_id:key,action:'create',fields:{titulo:'QA'}}) },
];
function fixture(onConnect = () => {}) {
  const users = [1,31,32].map(id => ({id,session_version:1,rol:'admin',activo:true,nombre:`QA ${id}`}));
  const calls = [], releases = [], domain = new Error('domain boundary reached');
  let leases = 0;
  const db = { async query(sql, params = []) {
    const compact = sql.replace(/\s+/g,' ').trim(); calls.push({sql:compact,params});
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(compact) || compact.startsWith('SELECT pg_advisory_xact_lock')) return {rows:[]};
    if (compact.includes('FROM usuarios WHERE id=ANY')) return {rows:users.map(u=>({...u}))};
    if (compact.includes('FROM usuarios WHERE id=$1')) return {rows:users.filter(u=>u.id===params[0]).map(u=>({...u}))};
    throw domain;
  }, release(error) { releases.push(error); } };
  const pool = {async connect(){leases++;await onConnect(users);return db;}};
  bindDatabaseAuthorityClient(db,pool);
  return {users,calls,releases,domain,get leases(){return leases;},pool};
}

for (const c of cases) {
  test(`${c.name}: captures authenticated session synchronously before pool wait`, async () => {
    let auth;
    const f = fixture(() => { auth.id=99;auth.session_version=9;auth.root_id=99;auth.root_exp=0; });
    auth = session(f.pool);
    await assert.rejects(c.run(f.pool,auth),error=>error===f.domain);
    const principal = f.calls.find(q=>q.sql.includes('FROM usuarios WHERE id=ANY'));
    assert.deepEqual(principal.params,[[1,31,32]]);
    assert.deepEqual(f.calls.find(q=>q.sql.includes('FROM usuarios WHERE id=$1')).params,[31]);
  });

  test(`${c.name}: trusted recapture retains principal before actor/domain, with ${c.mode} locks`, async () => {
    let auth;
    const f = fixture(() => { auth.id=99;auth.root_session_version=999;auth.root_exp=0; });
    auth = session(f.pool);
    const captured = bindCapturedOwnerProfileAuthority(auth,Object.freeze({id:31,session_version:1,rol:'admin'}));
    const recaptured = bindCapturedOwnerProfileAuthority(captured,Object.freeze({...captured}));
    assert.deepEqual(Object.keys(recaptured),['id','session_version','rol']);
    await assert.rejects(c.run(f.pool,recaptured),error=>error===f.domain);
    const principal = f.calls.findIndex(q=>q.sql.includes('FROM usuarios WHERE id=ANY'));
    const actor = f.calls.findIndex(q=>q.sql.includes('FROM usuarios WHERE id=$1'));
    assert.equal(principal,c.mutex?2:1);
    assert.match(f.calls[principal].sql,new RegExp(`ORDER BY id FOR ${c.mode}$`));
    assert.deepEqual(f.calls[principal].params,[[1,31,32]]);
    assert.ok(actor>principal);
    assert.equal(f.calls.at(-1).sql,'ROLLBACK');
    assert.deepEqual(f.releases,[undefined]);
  });

  for (const [name, revoke] of [
    ['root epoch',u=>u[0].session_version++],
    ['root disabled',u=>u[0].activo=false],
    ['root demoted',u=>u[0].rol='edicion'],
    ['actor epoch',u=>u[1].session_version++],
  ]) test(`${c.name}: ${name} changed during pool wait rejects before actor/domain/replay`, async () => {
    const f = fixture(revoke);
    await assert.rejects(c.run(f.pool,session(f.pool)),{status:401});
    assert.equal(f.calls.some(q=>q.sql.includes('FROM usuarios WHERE id=$1')),false);
    assert.equal(f.calls.at(-1).sql,'ROLLBACK');
    assert.equal(f.calls.some(q=>q.sql==='COMMIT'),false);
    assert.deepEqual(f.releases,[undefined]);
  });

  test(`${c.name}: copied delegation cannot reach the pool`, async () => {
    const f = fixture(), forged = {...session(f.pool)};
    await assert.rejects(c.run(f.pool,forged),{status:401});
    assert.equal(f.leases,0);
  });
}

test('personal list callback receives unchanged immutable scalar DTO and commits after principal retention', async () => {
  const f = fixture(), auth = session(f.pool), expected = {saved:true};
  assert.equal(await withPersonalListWrite(f.pool,auth,{version:7},async (_db,input,observed) => {
    assert.deepEqual(observed,{id:31,rol:'admin',session_version:1});
    assert.equal(Object.isFrozen(observed),true);
    assert.deepEqual(input,{version:7});
    return expected;
  }),expected);
  assert.equal(f.calls.at(-1).sql,'COMMIT');
});
