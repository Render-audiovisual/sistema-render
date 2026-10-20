import test from 'node:test';
import assert from 'node:assert/strict';
import { withProductionAuthority } from '../src/production-authority.js';

// Real helper, injected DB protocol only: no pool module, socket or service.
const observed = () => ({ id: 7, session_version: 3, rol: 'admin' });
const actor = changes => ({ id: 7, rol: 'admin', activo: true, session_version: 3, ...changes });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture({ current = actor(), failStage = null, connection = null, commit = null, rollbackError = null } = {}) {
  const calls = [], failure = new Error(`Synthetic ${failStage || 'DB'} failure`);
  const state = { current };
  const client = {
    async query(sql, values) {
      calls.push({ kind: 'query', sql, values: values && [...values] });
      if (sql === 'ROLLBACK' && rollbackError) throw rollbackError;
      if (failStage === 'begin' && /^BEGIN/i.test(sql)) throw failure;
      if (/^SELECT/i.test(sql)) {
        if (failStage === 'read') throw failure;
        return { rows: state.current ? [state.current] : [] };
      }
      if (sql === 'COMMIT') {
        if (commit) await commit.promise;
        if (failStage === 'commit') throw failure;
      }
      return { rows: [] };
    },
    release(error) { calls.push({ kind: 'release', error }); },
  };
  const pool = { async connect() {
    calls.push({ kind: 'connect' });
    if (connection) await connection.promise;
    if (failStage === 'connect') throw failure;
    return client;
  } };
  return { calls, client, pool, state, failure };
}
const queries = f => f.calls.filter(call => call.kind === 'query');
const released = f => f.calls.filter(call => call.kind === 'release').length;
const sqls = f => queries(f).map(call => call.sql);

test('missing or malformed observed ID/epoch denies before acquiring a connection', async () => {
  const invalid = [undefined, null, {}, { id: 7 }, { session_version: 3 }];
  for (const value of [0, -1, 1.5, NaN, Infinity, '7', true, {}, [], Number.MAX_SAFE_INTEGER + 1]) {
    invalid.push({ id: value, session_version: 3 }, { id: 7, session_version: value });
  }
  for (const auth of invalid) {
    const f = fixture();
    await assert.rejects(withProductionAuthority(f.pool, auth, false, () => assert.fail('Must not invoke callback')), error => error.status === 401);
    assert.deepEqual(f.calls, []);
  }
});

test('requireAdmin must be an explicit boolean before any connection, not a truthy/falsy coercion', async () => {
  for (const flag of [undefined, null, 0, 1, '', 'true', 'false', {}, [], new Boolean(false), () => true]) {
    const f = fixture();
    await assert.rejects(withProductionAuthority(f.pool, observed(), flag, () => assert.fail()), TypeError);
    assert.deepEqual(f.calls, []);
  }
});

test('READ COMMITTED actor FOR SHARE precedes callback; exact DB actor and result pass through with no mutex', async () => {
  const current = Object.freeze(actor()), f = fixture({ current });
  const result = Object.freeze({ receipt: 'synthetic-result' }); let count = 0;
  const saved = await withProductionAuthority(f.pool, Object.freeze(observed()), true, async (client, live) => {
    count++; assert.equal(client, f.client); assert.equal(live, current);
    assert.equal(released(f), 0); assert.equal(sqls(f).includes('COMMIT'), false);
    f.calls.push({ kind: 'mutation' }); return result;
  });
  assert.equal(saved, result); assert.equal(count, 1);
  assert.deepEqual(f.calls.map(call => call.kind), ['connect', 'query', 'query', 'mutation', 'query', 'release']);
  const sql = queries(f);
  assert.match(sql[0].sql, /^BEGIN ISOLATION LEVEL READ COMMITTED$/i);
  assert.match(sql[1].sql, /^SELECT\s+id\s*,\s*rol\s*,\s*activo\s*,\s*session_version\s+FROM usuarios WHERE id\s*=\s*\$1\s+FOR SHARE$/i);
  assert.deepEqual(sql[1].values, [7]); assert.equal(sql[2].sql, 'COMMIT');
  assert.equal(sqls(f).some(value => /advisory|FOR UPDATE|LOCK TABLE/i.test(value)), false);
  assert.equal(released(f), 1);
  assert.equal(f.calls.at(-1).error, undefined, 'Successful transaction releases reusable client normally');
});

for (const currentEpoch of [3, 4]) test(`caller mutation during connect wait cannot replace observed ID/epoch (DB epoch ${currentEpoch})`, async () => {
  const connection = deferred(), f = fixture({ current: actor({ session_version: currentEpoch }), connection });
  const auth = observed(); let callbacks = 0;
  const pending = withProductionAuthority(f.pool, auth, true, () => { callbacks++; return 'saved'; });
  void pending.catch(() => {});
  assert.deepEqual(f.calls.map(call => call.kind), ['connect']);
  auth.id = 8; auth.session_version = currentEpoch; auth.rol = 'edicion';
  connection.resolve();
  if (currentEpoch === 3) { assert.equal(await pending, 'saved'); assert.equal(callbacks, 1); }
  else { await assert.rejects(pending, error => error.status === 401); assert.equal(callbacks, 0); }
  assert.deepEqual(queries(f).find(call => /^SELECT/.test(call.sql)).values, [7]);
  assert.equal(released(f), 1);
});

test('row identity, strict active boolean and exact observed epoch must match before any mutation', async () => {
  for (const current of [null, actor({ id: 8 }), actor({ id: '7' }), actor({ activo: false }), actor({ activo: null }),
    actor({ activo: 'true' }), actor({ session_version: 2 }), actor({ session_version: 4 }), actor({ session_version: '3' }), actor({ session_version: undefined })]) {
    const f = fixture({ current });
    await assert.rejects(withProductionAuthority(f.pool, observed(), false, () => assert.fail('No stale callback')), error => error.status === 401);
    assert.deepEqual(sqls(f).slice(-1), ['ROLLBACK']); assert.equal(sqls(f).includes('COMMIT'), false);
    assert.equal(released(f), 1);
  }
});

test('admin authority follows current DB role, never cached role or display identity', async () => {
  for (const rol of ['edicion', 'diseno', 'produccion', 'community', 'programacion', 'Admin', null]) {
    const f = fixture({ current: actor({ rol }) });
    await assert.rejects(withProductionAuthority(f.pool, { ...observed(), rol: 'admin', nombre: 'Líder' }, true, () => assert.fail()), error => error.status === 403);
    assert.equal(released(f), 1); assert.equal(sqls(f).at(-1), 'ROLLBACK');
  }
  const f = fixture();
  assert.equal(await withProductionAuthority(f.pool, { ...observed(), rol: 'edicion', activo: false }, true, () => 'current-admin'), 'current-admin');
});

test('shared production writes explicitly allow valid current employees without granting cached admin authority', async () => {
  for (const rol of ['edicion', 'diseno', 'produccion', 'community', 'programacion']) {
    const current = actor({ rol }), f = fixture({ current });
    assert.equal(await withProductionAuthority(f.pool, { ...observed(), rol: 'admin' }, false, (_client, live) => {
      assert.equal(live.rol, rol); return 'shared-write';
    }), 'shared-write');
    assert.equal(sqls(f).at(-1), 'COMMIT'); assert.equal(released(f), 1);
  }
});

test('positive safe integer observation boundary is retained exactly without coercion', async () => {
  const max = Number.MAX_SAFE_INTEGER, f = fixture({ current: actor({ id: max, session_version: max }) });
  assert.equal(await withProductionAuthority(f.pool, { id: max, session_version: max }, false, () => 'saved'), 'saved');
  assert.deepEqual(queries(f)[1].values, [max]);
});

test('noop and replay callbacks still require a fresh valid actor on every invocation', async () => {
  for (const replay of [false, true]) {
    const f = fixture(), receipt = { created: false, replay }, auth = observed(); let callbacks = 0;
    const mutate = () => { callbacks++; return receipt; };
    assert.equal(await withProductionAuthority(f.pool, auth, false, mutate), receipt);
    f.state.current = actor({ session_version: 4 });
    await assert.rejects(withProductionAuthority(f.pool, auth, false, mutate), error => error.status === 401);
    assert.equal(callbacks, 1); assert.equal(queries(f).filter(call => /^SELECT/.test(call.sql)).length, 2);
    assert.equal(released(f), 2);
  }
});

for (const stage of ['begin', 'read', 'mutate', 'commit']) test(`${stage} failure rolls back and releases exactly once without reporting success or retry`, async () => {
  const f = fixture({ failStage: stage }); let callbacks = 0;
  await assert.rejects(withProductionAuthority(f.pool, observed(), true, () => {
    callbacks++; if (stage === 'mutate') throw f.failure; return 'must-not-escape';
  }), error => error === f.failure);
  assert.equal(callbacks, ['begin', 'read'].includes(stage) ? 0 : 1);
  assert.equal(sqls(f).at(-1), 'ROLLBACK'); assert.equal(released(f), 1);
  assert.equal(f.calls.filter(call => call.kind === 'connect').length, 1);
  assert.equal(sqls(f).filter(sql => sql === 'COMMIT').length, stage === 'commit' ? 1 : 0);
});

test('connection rejection propagates without a phantom callback, transaction or release', async () => {
  const f = fixture({ failStage: 'connect' });
  await assert.rejects(withProductionAuthority(f.pool, observed(), false, () => assert.fail()), error => error === f.failure);
  assert.deepEqual(f.calls, [{ kind: 'connect' }]);
});

test('callback result is not exposed and client not released before COMMIT acknowledgement', async () => {
  const commit = deferred(), f = fixture({ commit }); let finished = false;
  const pending = withProductionAuthority(f.pool, observed(), true, async () => 'receipt-after-commit');
  void pending.then(() => { finished = true; }); await settle();
  assert.equal(sqls(f).at(-1), 'COMMIT'); assert.equal(finished, false); assert.equal(released(f), 0);
  commit.resolve(); assert.equal(await pending, 'receipt-after-commit'); assert.equal(released(f), 1);
});

test('failed rollback discards the pooled client with rollback error while preserving original callback error', async () => {
  const rollbackError = new Error('Synthetic rollback failure');
  const f = fixture({ rollbackError }); let callbacks = 0;
  await assert.rejects(withProductionAuthority(f.pool, observed(), false, () => {
    callbacks++; throw f.failure;
  }), error => error === f.failure);
  assert.equal(callbacks, 1); assert.equal(sqls(f).at(-1), 'ROLLBACK');
  assert.equal(sqls(f).includes('COMMIT'), false); assert.equal(released(f), 1);
  assert.equal(f.calls.at(-1).error, rollbackError, 'Unconfirmed transaction must not return a reusable connection');
});
