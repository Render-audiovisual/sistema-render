import test from 'node:test';
import assert from 'node:assert/strict';
import { USER_CATALOG_PUBLIC_SQL, USER_CATALOG_ADMIN_SQL, loadUserCatalogSnapshot } from '../src/user-catalog.js';

const BEGIN = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY';
const ACTOR = 'SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1';
const observed = Object.freeze({ id: 17, rol: 'admin', session_version: 3 });
const current = Object.freeze({ ...observed, activo: true });
const compact = value => value.replace(/\s+/g, ' ').trim();
function fixture({ actor = current, rows = Object.freeze([{ id: 17, nombre: 'QA' }]), faults = new Map() } = {}) {
  const calls = [], releases = [];
  let connects = 0;
  const db = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (faults.has(sql)) throw faults.get(sql);
      if (sql === ACTOR) return { rows: actor === null ? [] : [actor] };
      if ([USER_CATALOG_ADMIN_SQL, USER_CATALOG_PUBLIC_SQL].includes(sql)) return { rows };
      assert.ok([BEGIN, 'COMMIT', 'ROLLBACK'].includes(sql), `Unexpected unit SQL: ${sql}`);
      return { rows: [] };
    },
    release(reason) { releases.push(reason); },
  };
  const pool = { async connect() { connects++; return db; }, query() { assert.fail('All statements must use the leased transaction, not pool.query'); } };
  return { db, pool, calls, releases, rows, connects: () => connects };
}
const sqls = f => f.calls.map(call => call.sql);

test('public and admin SQL retain explicit separate field sets, active filtering and no secret/raw-row projection', () => {
  assert.equal(compact(USER_CATALOG_PUBLIC_SQL), 'SELECT id, usuario, nombre, rol, activo, foto_perfil, created_at FROM usuarios WHERE activo IS TRUE ORDER BY id');
  assert.equal(compact(USER_CATALOG_ADMIN_SQL), "SELECT id, usuario, nombre, rol, activo, email_notificaciones, google_email, foto_perfil, (whatsapp_id_hash IS NOT NULL AND whatsapp_habilitado IS TRUE) AS whatsapp_vinculado, created_at, concat('ua1:',id,':',user_admin_version) AS admin_revision FROM usuarios ORDER BY id");
  assert.doesNotMatch(USER_CATALOG_PUBLIC_SQL, /email_notificaciones|google_email|whatsapp|admin_revision|user_admin_version/i);
  for (const sql of [USER_CATALOG_PUBLIC_SQL, USER_CATALOG_ADMIN_SQL]) {
    assert.doesNotMatch(sql, /\*|password|session_version|access_token|refresh_token|to_json/i);
    assert.match(sql, /ORDER BY id\s*$/);
  }
});

test('invalid observed identity/epoch/role rejects401 before acquiring any connection', async () => {
  const invalid = [null, undefined, {}, { ...observed, rol: null }, { ...observed, rol: 1 }, { ...observed, rol: '' }, { ...observed, rol: ' \n' }];
  for (const key of ['id', 'session_version']) for (const value of [undefined, null, '17', 0, -1, 1.5, NaN, Infinity, 2147483648, Number.MAX_SAFE_INTEGER + 1]) invalid.push({ ...observed, [key]: value });
  for (const actor of invalid) {
    const f = fixture();
    await assert.rejects(loadUserCatalogSnapshot(f.pool, actor), error => error.status === 401);
    assert.equal(f.connects(), 0); assert.deepEqual(f.calls, []); assert.deepEqual(f.releases, []);
  }
});

test('verified admin selects its exact catalog only after actor validation, commits then releases once', async () => {
  const f = fixture();
  assert.equal(await loadUserCatalogSnapshot(f.pool, observed), f.rows);
  assert.deepEqual(sqls(f), [BEGIN, ACTOR, USER_CATALOG_ADMIN_SQL, 'COMMIT']);
  assert.deepEqual(f.calls[1].values, [17]);
  assert.equal(f.connects(), 1); assert.deepEqual(f.releases, [undefined]);
});

test('verified non-admin and custom roles receive public SQL without a new role whitelist', async () => {
  for (const rol of ['edicion', 'diseno', 'produccion', 'community', 'programacion', 'qa_custom', ' admin ']) {
    const actor = { ...current, rol }, f = fixture({ actor });
    assert.equal(await loadUserCatalogSnapshot(f.pool, { ...observed, rol }), f.rows);
    assert.deepEqual(sqls(f), [BEGIN, ACTOR, USER_CATALOG_PUBLIC_SQL, 'COMMIT']);
    assert.ok(!sqls(f).includes(USER_CATALOG_ADMIN_SQL));
    assert.deepEqual(f.releases, [undefined]);
  }
});

test('int32 upper boundaries are valid when the exact current actor matches', async () => {
  const actor = { id: 2147483647, rol: 'qa_custom', activo: true, session_version: 2147483647 };
  const f = fixture({ actor });
  await loadUserCatalogSnapshot(f.pool, actor);
  assert.deepEqual(f.calls[1].values, [2147483647]);
  assert.deepEqual(sqls(f), [BEGIN, ACTOR, USER_CATALOG_PUBLIC_SQL, 'COMMIT']);
});

test('missing/current-inactive/id/role/epoch mismatches rollback401 before either catalog query', async () => {
  for (const actor of [null, { ...current, id: 18 }, { ...current, id: '17' }, { ...current, rol: 'edicion' },
    { ...current, session_version: 4 }, { ...current, session_version: '3' },
    { ...current, activo: false }, { ...current, activo: null }, { ...current, activo: 'true' }]) {
    const f = fixture({ actor });
    await assert.rejects(loadUserCatalogSnapshot(f.pool, observed), error => error.status === 401);
    assert.deepEqual(sqls(f), [BEGIN, ACTOR, 'ROLLBACK']);
    assert.deepEqual(f.releases, [undefined]);
  }
});

test('caller mutation during connect cannot redirect actor ID, role or epoch or promote a public catalog', async () => {
  for (const originalRole of ['admin', 'edicion']) {
    let resume, entered;
    const ready = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { resume = resolve; });
    const actor = { ...current, rol: originalRole }, f = fixture({ actor });
    const input = { ...observed, rol: originalRole };
    f.pool.connect = async () => { entered(); await gate; return f.db; };
    const pending = loadUserCatalogSnapshot(f.pool, input);
    try {
      await ready;
      input.id = 91001; input.rol = originalRole === 'admin' ? 'edicion' : 'admin'; input.session_version = 999;
    } finally { resume(); }
    assert.equal(await pending, f.rows);
    assert.deepEqual(f.calls[1].values, [17]);
    assert.deepEqual(sqls(f), [BEGIN, ACTOR, originalRole === 'admin' ? USER_CATALOG_ADMIN_SQL : USER_CATALOG_PUBLIC_SQL, 'COMMIT']);
  }
});

test('a revoked original observation cannot be repaired by mutating auth while waiting for its lease', async () => {
  const f = fixture({ actor: { ...current, session_version: 4 } }), input = { ...observed };
  f.pool.connect = async () => { await Promise.resolve(); input.session_version = 4; return f.db; };
  await assert.rejects(loadUserCatalogSnapshot(f.pool, input), error => error.status === 401);
  assert.deepEqual(sqls(f), [BEGIN, ACTOR, 'ROLLBACK']);
  assert.deepEqual(f.releases, [undefined]);
});

test('no returned catalog is acknowledged before COMMIT settles', async () => {
  const f = fixture(); let entered, resume, fulfilled = false;
  const ready = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { resume = resolve; });
  const query = f.db.query;
  f.db.query = async (...args) => { const result = await query(...args); if (args[0] === 'COMMIT') { entered(); await gate; } return result; };
  const pending = loadUserCatalogSnapshot(f.pool, observed).then(rows => { fulfilled = true; return rows; });
  try {
    await Promise.race([ready, pending.then(() => { throw Error('Expected COMMIT barrier'); })]);
    assert.equal(fulfilled, false); assert.deepEqual(f.releases, []);
  } finally { resume(); }
  assert.equal(await pending, f.rows); assert.equal(fulfilled, true); assert.deepEqual(f.releases, [undefined]);
});

for (const failedSql of [BEGIN, ACTOR, USER_CATALOG_ADMIN_SQL, 'COMMIT']) {
  test(`failure at ${failedSql === USER_CATALOG_ADMIN_SQL ? 'admin catalog SELECT' : failedSql} preserves original error and rolls back/releases`, async () => {
    const failure = new Error('Synthetic unit SQL failure'), f = fixture({ faults: new Map([[failedSql, failure]]) });
    await assert.rejects(loadUserCatalogSnapshot(f.pool, observed), error => error === failure);
    const expected = [BEGIN, ACTOR, USER_CATALOG_ADMIN_SQL, 'COMMIT'];
    assert.deepEqual(sqls(f), [...expected.slice(0, expected.indexOf(failedSql) + 1), 'ROLLBACK']);
    assert.deepEqual(f.releases, [undefined]);
  });
}

test('public catalog failure also rolls back without escalating to an admin query', async () => {
  const failure = new Error('Synthetic public query failure');
  const f = fixture({ actor: { ...current, rol: 'edicion' }, faults: new Map([[USER_CATALOG_PUBLIC_SQL, failure]]) });
  await assert.rejects(loadUserCatalogSnapshot(f.pool, { ...observed, rol: 'edicion' }), error => error === failure);
  assert.deepEqual(sqls(f), [BEGIN, ACTOR, USER_CATALOG_PUBLIC_SQL, 'ROLLBACK']);
  assert.deepEqual(f.releases, [undefined]);
});

test('rollback failure discards the connection using that error, preserving the original failure', async () => {
  const original = new Error('Original catalog fault'), rollback = new Error('Unconfirmed transaction');
  const f = fixture({ faults: new Map([[USER_CATALOG_ADMIN_SQL, original], ['ROLLBACK', rollback]]) });
  await assert.rejects(loadUserCatalogSnapshot(f.pool, observed), error => error === original);
  assert.deepEqual(sqls(f), [BEGIN, ACTOR, USER_CATALOG_ADMIN_SQL, 'ROLLBACK']);
  assert.deepEqual(f.releases, [rollback]);
});

test('connection acquisition failure propagates without querying or attempting to release an unleased client', async () => {
  const failure = new Error('No lease available'), f = fixture();
  f.pool.connect = async () => { throw failure; };
  await assert.rejects(loadUserCatalogSnapshot(f.pool, observed), error => error === failure);
  assert.deepEqual(f.calls, []); assert.deepEqual(f.releases, []);
});
