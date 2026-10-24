import test from 'node:test';
import assert from 'node:assert/strict';
import { editGoalContent } from '../src/client-goals.js';

// Actual service, mocked transaction boundary: not a PostgreSQL locking proof.
const actor = extra => ({ id: 7, rol: 'custom', session_version: 3, ...extra });
const input = extra => ({ titulo: '  Título observado  ', copy: 'Copy observado',
  expected_updated_at: '2026-10-20T11:00:00.123Z', expected_revision: 6, ...extra });
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function fixture({ current = { ...actor(), activo: true }, task = { id: 19 }, conflict = false,
  failAt, rollbackFails = false, connectGate } = {}) {
  const calls = [], releases = [];
  const failure = new Error('Original database failure'), rollbackError = new Error('Rollback failure');
  const ack = { updated_at: '2026-10-20T12:00:00.123Z', revision: 7 };
  let leases = 0;
  const db = {
    async query(sql, values = []) {
      sql = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql, values: structuredClone(values) });
      if (sql === 'ROLLBACK') {
        if (rollbackFails) throw rollbackError;
        return { rows: [] };
      }
      if (failAt && sql.startsWith(failAt)) throw failure;
      if (sql.startsWith('BEGIN') || sql === 'COMMIT') return { rows: [] };
      if (/FROM usuarios WHERE id=\$1 FOR SHARE$/.test(sql)) return { rows: current ? [structuredClone(current)] : [] };
      if (sql.includes('FROM cliente_objetivo_piezas p')) return { rows: task ? [structuredClone(task)] : [] };
      if (sql.startsWith('UPDATE tareas SET')) return { rows: conflict ? [] : [ack] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release(discard) { releases.push(discard); },
  };
  return { calls, releases, failure, rollbackError, ack, get leases() { return leases; },
    pool: {
      async connect() { leases++; if (connectGate) await connectGate.promise; return db; },
      query() { throw new Error('Query escaped leased connection'); },
    } };
}
const status = expected => error => error.status === expected;
const domainCalls = f => f.calls.filter(c => /cliente_objetivo_piezas|UPDATE tareas/.test(c.sql));
function rolledBack(f) {
  assert.equal(f.calls.filter(c => c.sql === 'ROLLBACK').length, 1);
  assert.equal(f.calls.some(c => c.sql === 'COMMIT'), false);
  assert.equal(f.releases.length, 1);
}

test('invalid body is rejected before actor verification or connection', async () => {
  const f = fixture();
  await assert.rejects(editGoalContent(f.pool, 3, input({ copy: 42 }), actor({ id: null })), status(400));
  assert.equal(f.leases, 0); assert.deepEqual(f.calls, []);
});

for (const [field, values] of [
  ['id', [undefined, null, 0, -1, '7', 1.5, Number.MAX_SAFE_INTEGER + 1]],
  ['session_version', [undefined, null, 0, -1, '3', 1.5, Number.MAX_SAFE_INTEGER + 1]],
  ['rol', [undefined, null, '', 42, {}, []]],
]) {
  for (const value of values) {
    test(`invalid actor ${field}=${JSON.stringify(value)} fails 401 before leasing`, async () => {
      const f = fixture();
      await assert.rejects(editGoalContent(f.pool, 3, input(), actor({ [field]: value })), status(401));
      assert.equal(f.leases, 0); assert.deepEqual(f.calls, []); assert.deepEqual(f.releases, []);
    });
  }
}

for (const [label, current] of [
  ['missing', null], ['inactive', { ...actor(), activo: false }],
  ['truthy active is not active', { ...actor(), activo: 'true' }],
  ['wrong id', { ...actor({ id: 8 }), activo: true }],
  ['changed role', { ...actor({ rol: 'admin' }), activo: true }],
  ['changed session', { ...actor({ session_version: 4 }), activo: true }],
]) {
  test(`locked actor ${label}: rollback before any domain access`, async () => {
    const f = fixture({ current });
    await assert.rejects(editGoalContent(f.pool, 3, input(), actor()), status(401));
    assert.equal(f.calls[0].sql, 'BEGIN ISOLATION LEVEL READ COMMITTED');
    assert.match(f.calls[1].sql, /^SELECT id,rol,activo,session_version FROM usuarios WHERE id=\$1 FOR SHARE$/);
    assert.deepEqual(f.calls[1].values, [7]);
    assert.deepEqual(domainCalls(f), []); rolledBack(f);
    assert.equal(f.releases[0], undefined);
  });
}

for (const rol of ['custom', 'admin']) {
  test(`verified ${rol} actor SHARE precedes task UPDATE lock and successful CAS`, async () => {
    const f = fixture({ current: { ...actor({ rol }), activo: true } });
    assert.deepEqual(await editGoalContent(f.pool, 3, input(), actor({ rol })), f.ack);
    assert.equal(f.calls[0].sql, 'BEGIN ISOLATION LEVEL READ COMMITTED');
    assert.match(f.calls[1].sql, /FROM usuarios WHERE id=\$1 FOR SHARE$/);
    assert.deepEqual(f.calls[1].values, [7]);
    const locked = f.calls[2];
    assert.match(locked.sql, /FOR UPDATE OF t$/);
    assert.match(locked.sql, /workspace.*render_os/);
    assert.match(locked.sql, /papelera_render_os/);
    assert.match(locked.sql, /archivada_render_os/);
    assert.deepEqual(locked.values, rol === 'admin' ? [3] : [3, 7]);
    if (rol === 'custom') assert.match(locked.sql, /tarea_asignaciones ta.*ta.usuario_id = \$2::integer/);
    else assert.doesNotMatch(locked.sql, /tarea_asignaciones/);
    assert.match(f.calls[3].sql, /date_trunc\('milliseconds',updated_at\).*revision=\$5 RETURNING updated_at,revision/);
    assert.deepEqual(f.calls[3].values, ['Título observado', 'Copy observado', 19, input().expected_updated_at, 6]);
    assert.deepEqual(f.calls.slice(4).map(c => c.sql), ['COMMIT']);
    assert.deepEqual(f.releases, [undefined]);
  });
}

test('body and actor mutations while connect waits cannot change authority or CAS bindings', async () => {
  const connectGate = deferred(), f = fixture({ connectGate }), body = input(), observed = actor();
  const pending = editGoalContent(f.pool, 3, body, observed);
  assert.equal(f.leases, 1);
  Object.assign(body, input({ titulo: 'Injected', copy: 'Injected copy', expected_updated_at: '2026-10-21T00:00:00Z', expected_revision: 99 }));
  Object.assign(observed, { id: 8, rol: 'admin', session_version: 99 });
  connectGate.resolve();
  assert.deepEqual(await pending, f.ack);
  assert.deepEqual(f.calls[1].values, [7]);
  assert.deepEqual(f.calls[2].values, [3, 7]);
  assert.match(f.calls[2].sql, /tarea_asignaciones/);
  assert.deepEqual(f.calls[3].values, ['Título observado', 'Copy observado', 19, input().expected_updated_at, 6]);
});

for (const [label, options, expected] of [
  ['unavailable domain task', { task: null }, 404],
  ['CAS conflict', { conflict: true }, 409],
]) {
  test(`${label} rolls back without accidental COMMIT`, async () => {
    const f = fixture(options);
    await assert.rejects(editGoalContent(f.pool, 3, input(), actor()), status(expected));
    rolledBack(f); assert.equal(f.releases[0], undefined);
    assert.equal(f.calls.some(c => c.sql.startsWith('UPDATE tareas')), expected === 409);
  });
}

for (const failAt of ['SELECT id,rol', 'SELECT t.id', 'UPDATE tareas']) {
  for (const rollbackFails of [false, true]) {
    test(`${failAt} failure preserves original error; rollback failure=${rollbackFails}`, async () => {
      const f = fixture({ failAt, rollbackFails });
      await assert.rejects(editGoalContent(f.pool, 3, input(), actor()), error => error === f.failure);
      rolledBack(f);
      if (rollbackFails) assert.ok(f.releases[0], 'Failed rollback must discard the connection');
      else assert.equal(f.releases[0], undefined);
    });
  }
}

test('CAS conflict remains 409 even when rollback fails and connection is discarded', async () => {
  const f = fixture({ conflict: true, rollbackFails: true });
  await assert.rejects(editGoalContent(f.pool, 3, input(), actor()), status(409));
  rolledBack(f); assert.ok(f.releases[0]);
});
