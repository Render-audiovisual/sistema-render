import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareGoal, editGoalContent } from '../src/client-goals.js';
import { lockGoalPreparer } from '../src/goal-preparation.js';
import { lockGoalQuotaReviewer } from '../src/goal-quota-review.js';
import { configuredOwnerProfiles, rememberOwnerProfileSession, bindCapturedOwnerProfileAuthority } from '../src/owner-profile-authority.js';
import { bindDatabaseAuthorityClient } from '../src/database-authority-context.js';

const ownerEnv = { NODE_ENV: 'test', RENDER_DB_ENVIRONMENT: 'test',
  DATABASE_URL: 'postgresql://fixture@127.0.0.1:56019/fixture',
  RENDER_OWNER_PROFILES: JSON.stringify({ accountId: 91001, francoUserId: 91005, agustinUserId: 91006 }) };
function delegated(pool) {
  const policy = configuredOwnerProfiles(ownerEnv, pool).policy;
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const auth = { id: 91005, rol: 'admin', session_version: 3, root_id: 91001,
    root_session_version: 2, root_exp: exp, exp, owner_profile: 'franco' };
  rememberOwnerProfileSession(auth, { ...auth }, policy); return auth;
}
const rows = () => [
  { id: 91001, rol: 'admin', activo: true, session_version: 2 },
  { id: 91005, rol: 'admin', activo: true, session_version: 3, nombre: 'Franco', usuario: 'internal' },
  { id: 91006, rol: 'admin', activo: true, session_version: 4 },
];
function fixture(users = rows()) {
  const calls = [], reached = new Error('DOMAIN_BOUNDARY');
  const db = { async query(sql, values) {
    calls.push({ sql, values });
    if (sql.includes('FROM usuarios') && sql.includes('ANY(')) return { rows: users };
    if (sql.includes('FROM usuarios') && sql.includes('WHERE id=$1')) return { rows: users.filter(u => u.id === values[0]) };
    if (/^BEGIN|^ROLLBACK|^COMMIT/.test(sql) || sql.includes('pg_advisory_xact_lock(8142, 1)')) return { rows: [] };
    throw reached;
  }, release() { calls.push({ sql: 'release' }); } };
  const pool = { async connect() { calls.push({ sql: 'connect' }); return db; } };
  bindDatabaseAuthorityClient(db, pool);
  return { calls, db, reached, pool };
}
const preparation = auth => ({ period: '2026-10', key: 'cliente-1', responsibleIds: [91005],
  preparation: { expected: 'a'.repeat(64), auth } });
const quota = auth => ({ period: '2026-10', key: 'cliente-1', responsibleIds: [91005],
  quotaReview: { expected: 'a'.repeat(64), auth } });
const body = () => ({ titulo: 'Test', copy: 'Copy', expected_updated_at: '2026-10-28T12:00:00Z', expected_revision: 1 });

for (const [name, lock] of [['preparer', lockGoalPreparer], ['quota reviewer', lockGoalQuotaReviewer]]) {
  test(`${name}: bound scalar projection recaptures opaque delegation and locks principals before actor`, async () => {
    const f = fixture(), auth = delegated(f.pool), captured = bindCapturedOwnerProfileAuthority(auth,
      Object.freeze({ id: auth.id, session_version: auth.session_version, rol: auth.rol }));
    const result = await lock(f.db, captured);
    assert.equal(result.id, 91005); assert.equal(f.calls.length, 2);
    assert.deepEqual(f.calls[0].values, [[91001, 91005, 91006]]);
    assert.match(f.calls[0].sql, /ORDER BY id FOR SHARE/);
    assert.deepEqual(f.calls[1].values, [91005]);
    assert.match(f.calls[1].sql, /FOR SHARE/);
  });
  test(`${name}: fake root claims are denied without SQL`, async () => {
    const f = fixture(); await assert.rejects(lock(f.db, { ...delegated(f.pool) }), { status: 401 });
    assert.deepEqual(f.calls, []);
  });
}
for (const [name, options] of [['prepare', preparation], ['reconcile', quota]]) {
  for (const reason of ['revoked principal', 'inactive principal', 'inactive actor', 'changed principal role']) {
    test(`${name}: ${reason} after pool wait denies before actor/domain locks or DML`, async () => {
      const users = rows(), f = fixture(users), auth = delegated(f.pool);
      let resume; f.pool.connect = () => new Promise(resolve => { resume = () => resolve(f.db); });
      const pending = prepareGoal(f.pool, options(auth));
      if (reason === 'revoked principal') users[0].session_version++;
      if (reason === 'inactive principal') users[0].activo = false;
      if (reason === 'inactive actor') users[1].activo = false;
      if (reason === 'changed principal role') users[0].rol = 'edicion';
      resume(); await assert.rejects(pending, { status: 401 });
      assert.match(f.calls[0].sql, /^BEGIN/);
      assert.match(f.calls[1].sql, /pg_advisory_xact_lock\(8142, 1\)/);
      assert.deepEqual(f.calls[2].values, [[91001, 91005, 91006]]);
      assert.equal(f.calls.some(c => /WHERE id=\$1/.test(c.sql)), false);
      assert.equal(f.calls.some(c => /^(INSERT|UPDATE|DELETE)/.test(c.sql)), false);
      assert.ok(f.calls.some(c => c.sql === 'ROLLBACK'));
    });
  }
  test(`${name}: original auth mutations during pool wait cannot alter captured actor or delegation`, async () => {
    const f = fixture(), auth = delegated(f.pool); let resume;
    f.pool.connect = () => new Promise(resolve => { resume = () => resolve(f.db); });
    const pending = prepareGoal(f.pool, options(auth));
    auth.id = 91006; auth.session_version = 999; auth.root_session_version = 999;
    resume(); await assert.rejects(pending, error => error === f.reached);
    assert.deepEqual(f.calls.filter(c => /WHERE id=\$1/.test(c.sql)).map(c => c.values), [[91005]]);
  });
  test(`${name}: forged delegation is rejected before pool acquisition`, async () => {
    const f = fixture(); await assert.rejects(prepareGoal(f.pool, options({ ...delegated(f.pool) })), { status: 401 });
    assert.deepEqual(f.calls, []);
  });
}
test('content write retains captured principal before actor and domain even after connection wait', async () => {
  const users = rows(), f = fixture(users); let resume;
  f.pool.connect = () => new Promise(resolve => { resume = () => resolve(f.db); });
  const pending = editGoalContent(f.pool, 1, body(), delegated(f.pool)); users[0].session_version++;
  resume(); await assert.rejects(pending, { status: 401 });
  assert.equal(f.calls[0].sql, 'BEGIN ISOLATION LEVEL READ COMMITTED');
  assert.deepEqual(f.calls[1].values, [[91001, 91005, 91006]]);
  assert.equal(f.calls.some(c => /WHERE id=\$1|^(UPDATE|INSERT|DELETE)/.test(c.sql)), false);
});
test('content write with fake delegation never acquires a pool connection', async () => {
  const f = fixture(); await assert.rejects(editGoalContent(f.pool, 1, body(), { ...delegated(f.pool) }), { status: 401 });
  assert.deepEqual(f.calls, []);
});
test('internal automatic preparation keeps its existing no-session path, never fabricates principal locks', async () => {
  const f = fixture(); await assert.rejects(prepareGoal(f.pool, { period: '2026-10', key: 'cliente-1',
    responsibleIds: [91005], actor: 'Generación mensual automática', automaticObservation: 'a'.repeat(64) }), error => error === f.reached);
  assert.match(f.calls[2].sql, /pg_advisory_xact_lock\(8142, 1\)/);
  assert.equal(f.calls.some(c => c.sql.includes('FROM usuarios')), false);
});
