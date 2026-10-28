import test from "node:test";
import assert from "node:assert/strict";
import { administerUser, withUserAdministration, withSelfIdentityChange } from "../src/user-administration.js";
import { configuredOwnerProfiles, parseOwnerProfilePolicy, rememberOwnerProfileSession } from '../src/owner-profile-authority.js';
import { bindDatabaseAuthorityClient } from '../src/database-authority-context.js';

const actor = { id: 2, session_version: 7 };

function fixture({ count = 1, target = { id: 1, rol: "admin", activo: true, user_admin_version:1 }, current = { id:2,session_version:7,rol:'admin',activo:true } } = {}) {
  const calls = [];
  const db = { async query(sql) {
    calls.push(sql);
    if (sql.includes('session_version')) return { rows: current ? [current] : [] };
    if (sql.startsWith("SELECT id")) return { rows: target ? [target] : [] };
    if (sql.startsWith("SELECT count")) return { rows: [{ count }] };
    return { rows: [] };
  }, release() { calls.push("release"); } };
  return { calls, pool: { async connect() { return db; } } };
}

test("all owner-removing operations retain the last active admin", async () => {
  for (const next of [{ delete: true }, { activo: false }, { rol: "diseno" }]) {
    const { pool, calls } = fixture();
    await assert.rejects(administerUser(pool, 1, {...next,expected_revision:'ua1:1:1'}, () => assert.fail("must not mutate"), actor), { status: 409 });
    assert.match(calls[1], /pg_advisory_xact_lock/);
    assert.deepEqual(calls.slice(-2), ["ROLLBACK", "release"]);
  }
});

test("permitted changes commit and propagate transaction failure", async () => {
  const { pool, calls } = fixture({ count: 2 });
  assert.equal(await administerUser(pool, 1, { activo: false,expected_revision:'ua1:1:1' }, async () => "saved", actor), "saved");
  assert.deepEqual(calls.slice(-2), ["COMMIT", "release"]);
  const broken = fixture();
  await assert.rejects(administerUser(broken.pool, 1, { rol: "admin",expected_revision:'ua1:1:1' }, async () => { throw Error("failure"); }, actor), /failure/);
  assert.deepEqual(broken.calls.slice(-2), ["ROLLBACK", "release"]);
});

test("missing user is not a successful mutation", async () => {
  const { pool } = fixture({ target: null });
  await assert.rejects(administerUser(pool, 99, {}, () => assert.fail(), actor), { status: 404 });
});

test('account mutation requires an observed ID and session epoch before acquiring a connection', async () => {
  const pool = { connect: () => assert.fail('Malformed authority must not open a transaction') };
  for (const invalid of [undefined,null,{}, {id:'2',session_version:7}, {id:2,session_version:0}, {id:2,session_version:'7'}]) {
    await assert.rejects(withUserAdministration(pool, invalid, () => assert.fail()), { status:401 });
    await assert.rejects(administerUser(pool,1,{},()=>assert.fail(),invalid),{status:401});
  }
});

test('missing, disabled and epoch-revoked actors cannot inspect the target or mutate it', async () => {
  for (const current of [null,{id:2,rol:'admin',activo:false,session_version:7}, {id:2,rol:'admin',activo:true,session_version:8}]) {
    const {pool,calls}=fixture({current});
    await assert.rejects(administerUser(pool,1,{},()=>assert.fail('must not mutate'),actor),{status:401,code:'USER_ADMIN_SESSION_REVOKED'});
    assert.equal(calls.some(sql=>sql.includes('FOR UPDATE')),false);
    assert.deepEqual(calls.slice(-2),['ROLLBACK','release']);
  }
});

test('role revalidation ignores cached administrator claims and rejects a current non-admin', async () => {
  const {pool,calls}=fixture({current:{id:2,rol:'diseno',activo:true,session_version:7}});
  await assert.rejects(withUserAdministration(pool,{...actor,rol:'admin'},()=>assert.fail()),{status:403,code:'USER_ADMIN_ROLE_CHANGED'});
  assert.equal(calls.some(sql=>sql.includes('FOR UPDATE')),false);
});

test('authorization reads after the mutex under READ COMMITTED and holds the actor through commit', async () => {
  const {pool,calls}=fixture();
  assert.equal(await withUserAdministration(pool,actor,async client=>{ await client.query('SYNTHETIC MUTATION'); return 'ack'; }),'ack');
  assert.deepEqual(calls,[
    'BEGIN ISOLATION LEVEL READ COMMITTED', 'SELECT pg_advisory_xact_lock(20261019, 1)',
    'SELECT id,rol,activo,session_version,usuario,google_email FROM usuarios WHERE id=$1 FOR SHARE', 'SYNTHETIC MUTATION','COMMIT','release',
  ]);
});

test('self identity changes require the active actor epoch but do not grant or require an admin role',async()=>{
  const current={id:2,rol:'edicion',activo:true,session_version:7,usuario:'self',google_email:null};
  const {pool,calls}=fixture({current});
  assert.equal(await withSelfIdentityChange(pool,actor,async(db,user)=>{assert.equal(user,current);await db.query('SYNTHETIC SELF WRITE');return 'saved';}),'saved');
  assert.deepEqual(calls.slice(0,3),['BEGIN ISOLATION LEVEL READ COMMITTED','SELECT pg_advisory_xact_lock(20261019, 1)',
    'SELECT id,rol,activo,session_version,usuario,google_email FROM usuarios WHERE id=$1 FOR UPDATE']);
  for(const changed of [null,{...current,session_version:8},{...current,activo:false}]) {
    const f=fixture({current:changed});
    await assert.rejects(withSelfIdentityChange(f.pool,actor,()=>assert.fail('must not write')),{status:401});
    assert.deepEqual(f.calls.slice(-2),['ROLLBACK','release']);
  }
});

test('held target revision must match before owner checks or mutation; no automatic rebase', async () => {
  for (const [expected_revision,status] of [[undefined,428],['ua1:2:1',409],['ua1:1:2',409],['invalid',400]]) {
    const {pool,calls}=fixture({count:2});
    await assert.rejects(administerUser(pool,1,{expected_revision},()=>assert.fail('must not mutate'),actor),{status});
    assert.equal(calls.some(sql=>sql.startsWith('SELECT count')),false);
    assert.deepEqual(calls.slice(-2),['ROLLBACK','release']);
  }
});

function delegatedAccount() {
  const env = { NODE_ENV: 'test', RENDER_DB_ENVIRONMENT: 'test',
    DATABASE_URL: 'postgresql://fixture@127.0.0.1:55989/render2_local_test',
    RENDER_OWNER_PROFILES: JSON.stringify({ accountId: 1, francoUserId: 31, agustinUserId: 32 }) };
  const exp = Math.floor(Date.now() / 1000) + 600;
  const auth = { id: 31, session_version: 7, root_id: 1, root_session_version: 3,
    owner_profile: 'franco', root_exp: exp, exp };
  const rows = [1,31,32].map(id => ({ id, session_version: id === 1 ? 3 : 7, activo: true, rol: 'admin' }));
  const calls = [];
  const db = { async query(sql, params) {
    calls.push(sql);
    if (sql.includes('id=ANY')) return { rows: rows.map(row => ({ ...row })) };
    if (sql.includes('id=$1')) return { rows: rows.filter(row => row.id === params[0]) };
    return { rows: [] };
  }, release() { calls.push('release'); } };
  const pool = { async connect() { return db; } };
  bindDatabaseAuthorityClient(db, pool);
  const policy = configuredOwnerProfiles(env, pool).policy;
  rememberOwnerProfileSession(auth, auth, policy);
  return { auth, rows, calls, db, pool };
}

for (const run of [withUserAdministration, withSelfIdentityChange]) {
  test(`${run.name} retains delegated principals UPDATE after mutex and before actor/write`, async () => {
    const f = delegatedAccount();
    // Mutation while waiting for the lease must not rewrite captured authority.
    f.pool.connect = async () => { f.auth.root_session_version = 999; f.auth.id = 32; return f.db; };
    assert.equal(await run(f.pool, f.auth, async (db, current) => {
      assert.equal(current.id, 31);
      await db.query('SYNTHETIC WRITE'); return 'saved';
    }), 'saved');
    assert.deepEqual(f.calls.slice(0,2), ['BEGIN ISOLATION LEVEL READ COMMITTED', 'SELECT pg_advisory_xact_lock(20261019, 1)']);
    assert.match(f.calls[2], /id=ANY.*ORDER BY id FOR UPDATE$/);
    assert.match(f.calls[3], /id=\$1 FOR (SHARE|UPDATE)$/);
    assert.deepEqual(f.calls.slice(-3), ['SYNTHETIC WRITE', 'COMMIT', 'release']);
  });

  test(`${run.name} rolls back delegated root/actor revocation before actor/target/write`, async () => {
    for (const id of [1,31]) for (const patch of [{ activo: false }, { rol: 'edicion' }, { session_version: 99 }]) {
      const f = delegatedAccount();
      f.pool.connect = async () => { Object.assign(f.rows.find(row => row.id === id), patch); return f.db; };
      await assert.rejects(run(f.pool, f.auth, () => assert.fail('revoked authority cannot write')), { status: 401 });
      assert.match(f.calls[2], /ORDER BY id FOR UPDATE$/);
      assert.equal(f.calls.some(sql => sql.includes('id=$1')), false);
      assert.deepEqual(f.calls.slice(-2), ['ROLLBACK', 'release']);
    }
  });
}

test('account authority rejects pre-capture delegated claim tampering before leasing', async () => {
  const f = delegatedAccount();
  f.auth.id = 32; f.auth.owner_profile = 'agustin';
  f.pool.connect = () => assert.fail('tampered authority must not lease');
  await assert.rejects(withUserAdministration(f.pool, f.auth, () => assert.fail()), { status: 401 });
  assert.deepEqual(f.calls, []);
});

test('owner aliases and cached admin claims never promote a current non-admin account', async () => {
  for (const nombre of ['Líder', 'Franco', 'Agustín', 'Franco Romero']) {
    const f = fixture({ current: { id: 2, session_version: 7, activo: true, rol: 'programacion', nombre, usuario: nombre } });
    await assert.rejects(withUserAdministration(f.pool, { ...actor, rol: 'admin', nombre, usuario: nombre },
      () => assert.fail('aliases must not promote')), { status: 403, code: 'USER_ADMIN_ROLE_CHANGED' });
    assert.deepEqual(f.calls.slice(-2), ['ROLLBACK', 'release']);
  }
});

test('QA owner mapping is rejected for production runtime or database environment', () => {
  const base = { NODE_ENV: 'test', RENDER_DB_ENVIRONMENT: 'test',
    DATABASE_URL: 'postgresql://fixture@127.0.0.1:55989/render2_local_test' };
  for (const accountId of [1, 91001, 91002]) {
    const configured = { ...base, RENDER_OWNER_PROFILES: JSON.stringify({ accountId, francoUserId: 91005, agustinUserId: 91006 }) };
    for (const override of [{ NODE_ENV: 'production' }, { RENDER_DB_ENVIRONMENT: 'production' }]) {
      assert.throws(() => parseOwnerProfilePolicy({ ...configured, ...override }), { status: 403 });
    }
  }
});

test('account authority retains its transaction until an asynchronous delivery callback completes', async () => {
  const f = delegatedAccount();
  let complete, entered;
  const delivery = new Promise(resolve => { complete = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const pending = withUserAdministration(f.pool, f.auth, async () => { entered(); return delivery; });
  await started;
  assert.match(f.calls[2], /ORDER BY id FOR UPDATE$/);
  assert.equal(f.calls.includes('COMMIT'), false);
  assert.equal(f.calls.includes('release'), false);
  complete('delivered');
  assert.equal(await pending, 'delivered');
  assert.deepEqual(f.calls.slice(-2), ['COMMIT', 'release']);
});

test('account authority rejects another pool lease before actor or writes and rolls back', async () => {
  const source = delegatedAccount(), destination = delegatedAccount();
  source.pool.connect = async () => destination.db;
  await assert.rejects(withUserAdministration(source.pool, source.auth,
    () => assert.fail('cross-pool authority cannot write')), { status: 401 });
  assert.deepEqual(destination.calls, ['BEGIN ISOLATION LEVEL READ COMMITTED',
    'SELECT pg_advisory_xact_lock(20261019, 1)', 'ROLLBACK', 'release']);
});
