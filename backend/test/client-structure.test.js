import test from 'node:test';
import assert from 'node:assert/strict';
import { CLIENT_STRUCTURE_UPSERT_SQL, saveClientStructure } from '../src/client-structure.js';

const MUTEX = 'SELECT pg_advisory_xact_lock(8142, 1)';
const ACTOR = 'SELECT id,rol,activo,session_version,nombre,usuario FROM usuarios WHERE id=$1 FOR SHARE';
const auth = Object.freeze({ id: 17, session_version: 3, rol: 'admin', nombre: 'Cached label' });
const actor = Object.freeze({ id: 17, session_version: 3, rol: 'admin', activo: true, nombre: 'Current label', usuario: 'qa_current' });
const body = Object.freeze({ cliente_id: 31, dia_semana: 0, tema: 'Tema', horario: '10:30', cta_fijo: 'CTA', tipo: 'historia' });
function fixture({ current = actor, faults = new Map() } = {}) {
  const calls = [], releases = [], saved = Object.freeze({ id: 73, ...body, activo: true }); let leases = 0;
  const db = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (faults.has(sql)) throw faults.get(sql);
      if (sql === ACTOR) return { rows: current === null ? [] : [current] };
      if (sql === CLIENT_STRUCTURE_UPSERT_SQL) return { rows: [saved] };
      assert.ok(['BEGIN', MUTEX, 'COMMIT', 'ROLLBACK'].includes(sql), `Unexpected unit SQL: ${sql}`);
      return { rows: [] };
    },
    release(reason) { releases.push(reason); },
  };
  const pool = { async connect() { leases++; return db; }, query() { assert.fail('Never write outside the leased transaction'); } };
  return { calls, releases, saved, db, pool, leases: () => leases };
}
const sqls = f => f.calls.map(call => call.sql);
const compact = value => value.replace(/\s+/g, ' ').trim();

test('UPSERT retains old columns, conflict key, optional COALESCE values and reactivation without unrelated writes', () => {
  assert.equal(compact(CLIENT_STRUCTURE_UPSERT_SQL), 'INSERT INTO estructura_cliente (cliente_id, dia_semana, tema, horario, cta_fijo, tipo) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (cliente_id, dia_semana) DO UPDATE SET tema = EXCLUDED.tema, horario = COALESCE(EXCLUDED.horario, estructura_cliente.horario), cta_fijo = COALESCE(EXCLUDED.cta_fijo, estructura_cliente.cta_fijo), tipo = COALESCE(EXCLUDED.tipo, estructura_cliente.tipo), activo = true RETURNING *');
  assert.doesNotMatch(CLIENT_STRUCTURE_UPSERT_SQL, /DELETE|INSERT INTO (?:tareas|publicaciones|historias)|UPDATE clientes/i);
});

test('valid current admin writes only after BEGIN, administration mutex and actor SHARE; result follows commit', async () => {
  const f = fixture();
  assert.equal(await saveClientStructure(f.pool, auth, body), f.saved);
  assert.deepEqual(sqls(f), ['BEGIN', MUTEX, ACTOR, CLIENT_STRUCTURE_UPSERT_SQL, 'COMMIT']);
  assert.deepEqual(f.calls[2].values, [17]);
  assert.deepEqual(f.calls[3].values, [31, 0, 'Tema', '10:30', 'CTA', 'historia']);
  assert.equal(Object.isFrozen(f.calls[3].values), true);
  assert.deepEqual(f.releases, [undefined]); assert.equal(f.leases(), 1);
});

test('invalid observed identity or epoch rejects401 before pool acquisition', async () => {
  for (const input of [null, {}, { ...auth, id: '17' }, { ...auth, id: 0 }, { ...auth, id: 2147483648 },
    { ...auth, session_version: '3' }, { ...auth, session_version: 0 }, { ...auth, session_version: 2147483648 }]) {
    const f = fixture(); await assert.rejects(saveClientStructure(f.pool, input, body), error => error.status === 401);
    assert.equal(f.leases(), 0); assert.deepEqual(f.calls, []); assert.deepEqual(f.releases, []);
  }
});

test('old missing-field rule rejects400 before a lease while preserving Sunday zero', async () => {
  for (const input of [null, undefined, {}, { dia_semana: 0 }, { cliente_id: null, dia_semana: 0 },
    { cliente_id: 0, dia_semana: 0 }, { cliente_id: '', dia_semana: 0 }, { cliente_id: 31 }, { cliente_id: 31, dia_semana: undefined }]) {
    const f = fixture();
    await assert.rejects(saveClientStructure(f.pool, auth, input), error => error.status === 400 && error.message === 'Faltan cliente_id o dia_semana.');
    assert.equal(f.leases(), 0); assert.deepEqual(f.calls, []); assert.deepEqual(f.releases, []);
  }
  const f = fixture(); await saveClientStructure(f.pool, auth, { cliente_id: 31, dia_semana: 0 });
  assert.deepEqual(f.calls[3].values, [31, 0, null, null, null, null]);
});

test('legacy optional value normalization preserves truthy values and maps empty/falsy values to null', async () => {
  for (const value of [undefined, null, '', false, 0]) {
    const f = fixture(); await saveClientStructure(f.pool, auth, { cliente_id: 31, dia_semana: 1, tema: value, horario: value, cta_fijo: value, tipo: value });
    assert.deepEqual(f.calls[3].values, [31, 1, null, null, null, null]);
  }
});

test('current missing/inactive/id/epoch mismatch denies401 before the structure UPSERT', async () => {
  for (const current of [null, { ...actor, id: 18 }, { ...actor, activo: false }, { ...actor, activo: 'true' },
    { ...actor, session_version: 4 }, { ...actor, session_version: '3' }]) {
    const f = fixture({ current });
    await assert.rejects(saveClientStructure(f.pool, auth, body), error => error.status === 401 && error.code === 'CLIENT_CREATOR_SESSION_INVALID');
    assert.deepEqual(sqls(f), ['BEGIN', MUTEX, ACTOR, 'ROLLBACK']); assert.deepEqual(f.releases, [undefined]);
  }
});

test('current non-admin denies403 despite cached admin, while current admin does not borrow the cached role/name', async () => {
  for (const rol of ['edicion', 'community', 'qa_custom']) {
    const f = fixture({ current: { ...actor, rol } });
    await assert.rejects(saveClientStructure(f.pool, auth, body), error => error.status === 403 && error.code === 'CLIENT_CREATOR_FORBIDDEN');
    assert.deepEqual(sqls(f), ['BEGIN', MUTEX, ACTOR, 'ROLLBACK']); assert.deepEqual(f.releases, [undefined]);
  }
  const f = fixture();
  assert.equal(await saveClientStructure(f.pool, { ...auth, rol: 'edicion', nombre: 'Not authority' }, body), f.saved);
});

test('auth and scalar body parameters are captured before awaiting the pool lease', async () => {
  let entered, resume;
  const ready = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { resume = resolve; });
  const f = fixture(), inputAuth = { ...auth }, inputBody = { ...body };
  f.pool.connect = async () => { entered(); await gate; return f.db; };
  const pending = saveClientStructure(f.pool, inputAuth, inputBody);
  try {
    await ready;
    Object.assign(inputAuth, { id: 91001, session_version: 99, rol: 'admin' });
    Object.assign(inputBody, { cliente_id: 99, dia_semana: 6, tema: 'New', horario: '', cta_fijo: 'Other', tipo: 'reel' });
  } finally { resume(); }
  assert.equal(await pending, f.saved);
  assert.deepEqual(f.calls[2].values, [17]); assert.deepEqual(f.calls[3].values, [31, 0, 'Tema', '10:30', 'CTA', 'historia']);
  assert.equal(Object.isFrozen(f.calls[3].values), true);
});

test('revocation while waiting cannot be repaired by updating the caller observation', async () => {
  const f = fixture({ current: { ...actor, session_version: 4 } }), input = { ...auth };
  f.pool.connect = async () => { await Promise.resolve(); input.session_version = 4; return f.db; };
  await assert.rejects(saveClientStructure(f.pool, input, body), error => error.status === 401);
  assert.deepEqual(sqls(f), ['BEGIN', MUTEX, ACTOR, 'ROLLBACK']);
});

test('pending COMMIT never publishes a successful save early', async () => {
  const f = fixture(); let entered, resume, acknowledged = false;
  const ready = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { resume = resolve; });
  const query = f.db.query;
  f.db.query = async (...args) => { const result = await query(...args); if (args[0] === 'COMMIT') { entered(); await gate; } return result; };
  const pending = saveClientStructure(f.pool, auth, body).then(value => { acknowledged = true; return value; });
  try {
    await Promise.race([ready, pending.then(() => { throw Error('Expected commit barrier'); })]);
    assert.equal(acknowledged, false); assert.deepEqual(f.releases, []);
  } finally { resume(); }
  assert.equal(await pending, f.saved); assert.equal(acknowledged, true); assert.deepEqual(f.releases, [undefined]);
});

for (const failedSql of ['BEGIN', MUTEX, ACTOR, CLIENT_STRUCTURE_UPSERT_SQL, 'COMMIT']) {
  test(`SQL failure at ${failedSql === CLIENT_STRUCTURE_UPSERT_SQL ? 'UPSERT' : failedSql} rolls back and releases without success`, async () => {
    const failure = new Error('Synthetic structure SQL failure'), f = fixture({ faults: new Map([[failedSql, failure]]) });
    await assert.rejects(saveClientStructure(f.pool, auth, body), error => error === failure);
    const order = ['BEGIN', MUTEX, ACTOR, CLIENT_STRUCTURE_UPSERT_SQL, 'COMMIT'];
    assert.deepEqual(sqls(f), [...order.slice(0, order.indexOf(failedSql) + 1), 'ROLLBACK']);
    assert.deepEqual(f.releases, [undefined]);
  });
}

test('rollback failure discards the client with rollback error while preserving the original write error', async () => {
  const original = new Error('Original write fault'), rollback = new Error('Failed transaction cleanup');
  const f = fixture({ faults: new Map([[CLIENT_STRUCTURE_UPSERT_SQL, original], ['ROLLBACK', rollback]]) });
  await assert.rejects(saveClientStructure(f.pool, auth, body), error => error === original);
  assert.deepEqual(sqls(f), ['BEGIN', MUTEX, ACTOR, CLIENT_STRUCTURE_UPSERT_SQL, 'ROLLBACK']);
  assert.deepEqual(f.releases, [rollback]);
});

test('failed pool acquisition does not query or release an unleased client', async () => {
  const failure = new Error('Synthetic lease failure'), f = fixture(); f.pool.connect = async () => { throw failure; };
  await assert.rejects(saveClientStructure(f.pool, auth, body), error => error === failure);
  assert.deepEqual(f.calls, []); assert.deepEqual(f.releases, []);
});
