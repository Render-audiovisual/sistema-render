import test from "node:test";
import assert from "node:assert/strict";
import { administerUser, withUserAdministration } from "../src/user-administration.js";

const actor = { id: 2, session_version: 7 };

function fixture({ count = 1, target = { id: 1, rol: "admin", activo: true, user_admin_version:1 }, current = { id:2,session_version:7,rol:'admin',activo:true } } = {}) {
  const calls = [];
  const db = { async query(sql) {
    calls.push(sql);
    if (sql.includes('FOR SHARE')) return { rows: current ? [current] : [] };
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
    'SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1 FOR SHARE', 'SYNTHETIC MUTATION','COMMIT','release',
  ]);
});

test('held target revision must match before owner checks or mutation; no automatic rebase', async () => {
  for (const [expected_revision,status] of [[undefined,428],['ua1:2:1',409],['ua1:1:2',409],['invalid',400]]) {
    const {pool,calls}=fixture({count:2});
    await assert.rejects(administerUser(pool,1,{expected_revision},()=>assert.fail('must not mutate'),actor),{status});
    assert.equal(calls.some(sql=>sql.startsWith('SELECT count')),false);
    assert.deepEqual(calls.slice(-2),['ROLLBACK','release']);
  }
});
