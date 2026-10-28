import test from 'node:test';
import assert from 'node:assert/strict';
import { captureClientCreator, lockCurrentClientCreator } from '../src/client-create-authority.js';
import { lockClientAdministration } from '../src/client-agreement.js';
import { configuredOwnerProfiles, rememberOwnerProfileSession } from '../src/owner-profile-authority.js';
import { bindDatabaseAuthorityClient } from '../src/database-authority-context.js';

const observed = () => ({ id: 11, session_version: 7 });
const current = () => ({ ...observed(), activo: true, rol: 'admin', nombre: 'Current synthetic owner', usuario: 'current-synthetic' });
const invalidSession = error => error.status === 401 && error.code === 'CLIENT_CREATOR_SESSION_INVALID';
const forbidden = error => error.status === 403 && error.code === 'CLIENT_CREATOR_FORBIDDEN';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function database(row = current()) {
  const calls = [];
  return { calls, query: async (sql, params) => { calls.push({sql, params}); return { rows: row ? [row] : [] }; } };
}

test('capture is a fresh frozen identity/epoch observation without role, names or body data', () => {
  const auth = { ...observed(), rol: 'admin', nombre: 'Stale name', usuario: 'stale-alias', password_hash: 'private-value' };
  const captured = captureClientCreator(auth);
  assert.deepEqual(captured, observed()); assert.equal(Object.isFrozen(captured), true); assert.notEqual(captured, auth);
  auth.id = 12; auth.session_version = 9; auth.nombre = 'Changed request';
  assert.deepEqual(captured, observed());
  assert.throws(() => { captured.session_version = 9; }, TypeError);
});

test('invalid identity or epoch rejects before pool or SQL, without coercion or name fallback', async () => {
  const bad = [undefined,null,{}, { id:'11',session_version:7 }, { id:11,session_version:'7' },
    ...[0,-1,1.1,NaN,Infinity,2147483648,Number.MAX_SAFE_INTEGER+1].flatMap(value => [
      { id:value,session_version:7 },{ id:11,session_version:value },
    ])];
  const db = database();
  for (const value of bad) {
    assert.throws(() => captureClientCreator(value),invalidSession);
    await assert.rejects(lockCurrentClientCreator(db,value),invalidSession);
  }
  assert.deepEqual(db.calls,[]);
  assert.deepEqual(captureClientCreator({ id:2147483647,session_version:2147483647 }),{ id:2147483647,session_version:2147483647 });
});

test('capture survives a pending pool lease and rejects an epoch changed while queued', async () => {
  const auth = { ...observed(),rol:'admin' }, captured = captureClientCreator(auth), lease = deferred();
  const db = database({ ...current(),session_version:8 });
  const pending = (async () => { const acquired = await lease.promise; return lockCurrentClientCreator(acquired,captured); })();
  auth.session_version = 8; lease.resolve(db);
  await assert.rejects(pending,invalidSession);
  assert.deepEqual(db.calls[0].params,[11]); assert.deepEqual(captured,observed());
});

test('absent, inactive, mismatched ID or revoked epoch returns generic typed401', async () => {
  for (const row of [null,{...current(),id:12},{...current(),activo:false},{...current(),activo:null},
    {...current(),activo:'true'},{...current(),session_version:8},{...current(),session_version:'7'}]) {
    const db = database(row);
    await assert.rejects(lockCurrentClientCreator(db,captureClientCreator(observed())),error => {
      assert.equal(invalidSession(error),true);
      assert.doesNotMatch(error.message,/Current synthetic|current-synthetic|password|hash|11|12/);
      assert.deepEqual(Object.keys(error).sort(),['code','status']); return true;
    });
    assert.equal(db.calls.length,1); assert.match(db.calls[0].sql,/FROM usuarios WHERE id=\$1 FOR SHARE$/);
  }
});

test('fresh current role decides403 independently of cached role and mutable names', async () => {
  for (const rol of ['edicion','programacion','community','admin ','unknown',null]) {
    const db = database({ ...current(),rol });
    await assert.rejects(lockCurrentClientCreator(db,captureClientCreator({ ...observed(),rol:'admin' })),error => {
      assert.equal(forbidden(error),true); assert.equal(error.message,'Solo administración puede gestionar clientes.'); return true;
    });
  }
  const db = database();
  const actor = await lockCurrentClientCreator(db,captureClientCreator({ ...observed(),rol:'edicion',nombre:'Stale label' }));
  assert.equal(actor.rol,'admin'); assert.equal(actor.nombre,'Current synthetic owner');
});

test('successful actor is a frozen explicit safe projection for creado_por', async () => {
  const db = database({ ...current(), password_hash:'never-return',google_id:'never-return',nested:{secret:'never-return'} });
  const actor = await lockCurrentClientCreator(db,captureClientCreator(observed()));
  assert.deepEqual(actor,current()); assert.equal(Object.isFrozen(actor),true);
  assert.doesNotMatch(JSON.stringify(actor),/never-return/);
  assert.ok(db.calls.every(call => /^SELECT /.test(call.sql)));
});

test('caller order is BEGIN then global advisory then actor SHARE, without helper business writes', async () => {
  const db = database();
  await db.query('BEGIN');
  await lockClientAdministration(db);
  await lockCurrentClientCreator(db,captureClientCreator(observed()));
  assert.deepEqual(db.calls.map(call=>call.sql),['BEGIN',
    'SELECT pg_advisory_xact_lock(8142, 1)',
    'SELECT id,rol,activo,session_version,nombre,usuario FROM usuarios WHERE id=$1 FOR SHARE']);
  assert.equal(db.calls.some(call => /COMMIT|ROLLBACK|INSERT|UPDATE|DELETE/.test(call.sql)),false);
});

test('SQL failure propagates to caller cleanup without leaking into an authority success', async () => {
  const failure = new Error('synthetic database transport failure');
  const db = { query: async () => { throw failure; } };
  await assert.rejects(lockCurrentClientCreator(db,captureClientCreator(observed())),error=>error===failure);
});

function delegatedCreator() {
  const env = { NODE_ENV: 'test', RENDER_DB_ENVIRONMENT: 'test',
    DATABASE_URL: 'postgresql://fixture@127.0.0.1:55989/render2_local_test',
    RENDER_OWNER_PROFILES: JSON.stringify({ accountId: 1, francoUserId: 31, agustinUserId: 32 }) };
  const exp = Math.floor(Date.now() / 1000) + 600;
  const auth = { id: 31, session_version: 7, root_id: 1, root_session_version: 3,
    owner_profile: 'franco', root_exp: exp, exp };
  const rows = [1,31,32].map(id => ({ id, session_version: id === 1 ? 3 : 7,
    activo: true, rol: 'admin', nombre: `Synthetic ${id}`, usuario: `synthetic-${id}` }));
  const calls = [];
  const db = { async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes('id=ANY')) return { rows: rows.map(row => ({ ...row })) };
    if (sql.includes('id=$1')) return { rows: rows.filter(row => row.id === params[0]) };
    return { rows: [] };
  } };
  const pool = { async connect() { return db; } };
  bindDatabaseAuthorityClient(db, pool);
  const policy = configuredOwnerProfiles(env, pool).policy;
  rememberOwnerProfileSession(auth, auth, policy);
  return { auth, rows, calls, db, pool };
}

test('delegated creator preserves opaque authority through recapture and locks principals after mutex before actor', async () => {
  const f = delegatedCreator();
  const observed = captureClientCreator(captureClientCreator(f.auth));
  assert.deepEqual(observed, { id: 31, session_version: 7 });
  assert.deepEqual(Object.keys(observed), ['id', 'session_version']);
  f.auth.root_session_version = 999;
  await f.db.query('BEGIN');
  await lockClientAdministration(f.db);
  const actor = await lockCurrentClientCreator(f.db, observed);
  assert.equal(actor.id, 31);
  assert.equal(f.calls[1].sql, 'SELECT pg_advisory_xact_lock(8142, 1)');
  assert.match(f.calls[2].sql, /id=ANY.*ORDER BY id FOR SHARE$/);
  assert.deepEqual(f.calls[2].params, [[1,31,32]]);
  assert.match(f.calls[3].sql, /id=\$1 FOR SHARE$/);
});

test('delegated creator rejects root/actor revocation before actor or business reads', async () => {
  for (const id of [1,31]) for (const patch of [{ activo: false }, { rol: 'edicion' }, { session_version: 99 }]) {
    const f = delegatedCreator(), observed = captureClientCreator(f.auth);
    Object.assign(f.rows.find(row => row.id === id), patch);
    await assert.rejects(lockCurrentClientCreator(f.db, observed), { status: 401 });
    assert.equal(f.calls.length, 1);
    assert.match(f.calls[0].sql, /ORDER BY id FOR SHARE$/);
  }
});

test('delegated creator rejects claim mutation before initial capture without querying', () => {
  const f = delegatedCreator();
  f.auth.id = 32; f.auth.owner_profile = 'agustin';
  assert.throws(() => captureClientCreator(f.auth), { status: 401 });
  assert.deepEqual(f.calls, []);
});

test('delegated creator rejects a lease from another pool even with matching principal rows', async () => {
  const source = delegatedCreator(), destination = delegatedCreator();
  await assert.rejects(lockCurrentClientCreator(destination.db, captureClientCreator(source.auth)), { status: 401 });
  assert.deepEqual(destination.calls, []);
});
