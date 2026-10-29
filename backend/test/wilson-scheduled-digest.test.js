import test from 'node:test';
import assert from 'node:assert/strict';
import { runWilsonScheduledDigest, scheduleWilsonMessages } from '../src/wilson-chat.js';

const friday = new Date('2026-08-21T13:00:00Z');
const task = (id, extra = {}) => ({ id, titulo: `Video ${id}`, estado: 'pendiente', cliente_nombre: 'Cliente', propiedades_extra: {}, ...extra });
const user = (id, extra = {}) => ({ id, usuario: `user${id}`, nombre: 'Mismo nombre', rol: 'admin', activo: true, ...extra });

// Transactional mock: claims, conversation upserts and messages only survive
// COMMIT. Every unrecognized statement fails, including any history deletion.
function fixture({ users = [user(9)], tasks = { 9: [task(101)] }, fail = () => false, discovered, onDiscovery } = {}) {
  let state = { claims: [], conversations: [{ id: 1, usuario_id: 9, periodo: '2025-01' }], messages: [{ id: 1, contenido: 'Historia conservada', conversacion_id: 1 }] };
  const log = [];
  const releases = [];
  const answer = rows => ({ rows, rowCount: rows.length });
  const pool = {
    async query(sql) {
      log.push({ lease: 'pool', sql });
      assert.equal(sql, 'SELECT id FROM usuarios WHERE activo IS TRUE ORDER BY id');
      onDiscovery?.();
      return answer(discovered ?? users.filter(u => u.activo).map(({ id }) => ({ id })));
    },
    async connect() {
      const lease = releases.length;
      releases.push(false);
      let tx;
      let recipient;
      return {
        async query(sql, values = []) {
          log.push({ lease, sql, values });
          if (sql.startsWith('BEGIN')) { tx = structuredClone(state); return answer([]); }
          if (sql === 'ROLLBACK') { tx = null; return answer([]); }
          if (sql === 'COMMIT') { if (fail(recipient, 'commit')) throw Error('SQL SECRET'); state = tx; tx = null; return answer([]); }
          assert.ok(tx, 'all recipient work uses a transaction');
          if (sql.includes('FROM usuarios WHERE id=$1 FOR SHARE')) {
            recipient = values[0];
            return answer(users.filter(u => u.id === recipient));
          }
          if (sql.includes('FROM tareas t')) {
            assert.deepEqual(values, [recipient], 'even admin/profile tasks scoped by stable ID');
            assert.match(sql, /tarea_asignaciones/);
            assert.match(sql, /usuario_id\s*=\s*\$1::integer/);
            assert.doesNotMatch(sql, /salario|sueldo|entregas_edicion|precio/i);
            if (fail(recipient, 'tasks')) throw Error('SQL SECRET');
            return answer(tasks[recipient] ?? []);
          }
          if (sql.includes('INSERT INTO wilson_envios_programados')) {
            assert.match(sql, /ON CONFLICT\(usuario_id,fecha,tipo\) DO NOTHING/);
            if (tx.claims.some(c => JSON.stringify(c) === JSON.stringify(values))) return answer([]);
            tx.claims.push(values);
            return answer([{ usuario_id: recipient }]);
          }
          if (sql.includes('INSERT INTO wilson_conversaciones')) {
            let row = tx.conversations.find(c => c.usuario_id === values[0] && c.periodo === values[1]);
            if (!row) { row = { id: tx.conversations.length + 1, usuario_id: values[0], periodo: values[1] }; tx.conversations.push(row); }
            return answer([row]);
          }
          if (sql.includes('INSERT INTO wilson_mensajes')) {
            if (fail(recipient, 'message')) throw Error('SQL SECRET');
            const row = { id: tx.messages.length + 1, conversacion_id: values[0], remitente: values[1], contenido: values[2], tipo: values[3], metadata: JSON.parse(values[4]) };
            tx.messages.push(row);
            return answer([row]);
          }
          throw Error(`Unexpected SQL: ${sql}`);
        },
        release(error) { releases[lease] = error || true; },
      };
    },
  };
  return { pool, log, releases, get state() { return structuredClone(state); } };
}

test('off schedule and invalid dates never lease or query', async () => {
  const f = fixture();
  assert.deepEqual(await runWilsonScheduledDigest(f.pool, { now: new Date('2026-08-21T12:59:00Z') }), { due: false, date: null, type: null, sent: 0, duplicates: 0, skipped: 0, failed: 0 });
  await assert.rejects(runWilsonScheduledDigest(f.pool, { now: new Date(NaN) }), TypeError);
  await assert.rejects(runWilsonScheduledDigest(f.pool, { now: '2026-08-21' }), TypeError);
  assert.equal(f.log.length, 0);
});

test('all writes use the same lease after active-user SHARE and personal task eligibility', async () => {
  const f = fixture();
  await runWilsonScheduledDigest(f.pool, { now: friday });
  const statements = f.log.filter(({ lease }) => lease !== 'pool');
  assert.deepEqual([...new Set(statements.map(({ lease }) => lease))], [0]);
  assert.equal(statements.length, 7);
  for (const [index, pattern] of [
    /^BEGIN ISOLATION LEVEL READ COMMITTED$/,
    /FROM usuarios WHERE id=\$1 FOR SHARE$/,
    /FROM tareas t/,
    /INSERT INTO wilson_envios_programados/,
    /INSERT INTO wilson_conversaciones/,
    /INSERT INTO wilson_mensajes/,
    /^COMMIT$/,
  ].entries()) assert.match(statements[index].sql, pattern);
});

test('no early claim: newly eligible tasks can send in the same scheduling window', async () => {
  const tasks = { 9: [] };
  const f = fixture({ tasks });
  assert.equal((await runWilsonScheduledDigest(f.pool, { now: friday })).skipped, 1);
  assert.deepEqual(f.state.claims, []);
  tasks[9] = [task(42)];
  assert.equal((await runWilsonScheduledDigest(f.pool, { now: friday })).sent, 1);
  assert.deepEqual(f.state.messages[1].metadata.task_ids, [42]);
  assert.equal((await runWilsonScheduledDigest(f.pool, { now: friday })).duplicates, 1);
  assert.equal(f.state.messages.length, 2);
});

for (const discovered of [[{ id: '9' }], [{ id: 0 }], [{ id: 9 }, { id: 9 }]]) {
  test(`invalid recipient discovery fails before any lease: ${JSON.stringify(discovered)}`, async () => {
    const f = fixture({ discovered });
    await assert.rejects(runWilsonScheduledDigest(f.pool, { now: friday }), { code: 'WILSON_DIGEST_FAILED' });
    assert.equal(f.releases.length, 0);
    assert.equal(f.state.messages.length, 1);
    assert.deepEqual(f.state.claims, []);
  });
}

test('no active recipients is a due run with no writes or leases', async () => {
  const f = fixture({ users: [user(9, { activo: false })] });
  assert.deepEqual(await runWilsonScheduledDigest(f.pool, { now: friday }), {
    due: true, date: '2026-08-21', type: 'semanal', sent: 0, duplicates: 0, skipped: 0, failed: 0,
  });
  assert.equal(f.releases.length, 0);
});

for (const [date, type, prefix] of [
  ['2026-08-21T13:00:00Z', 'semanal', 'Cierre de semana'],
  ['2026-08-28T13:59:00Z', 'semanal_mensual', 'Cierre semanal y mensual'],
  ['2026-09-28T13:00:00Z', 'mensual', 'Cierre del mes'],
]) test(`Córdoba ${type}: atomic append, exact prefix, history preserved, replay idempotent`, async () => {
  const f = fixture();
  const options = { now: new Date(date) };
  const result = await runWilsonScheduledDigest(f.pool, options);
  assert.equal(result.sent, 1);
  assert.equal(result.type, type);
  assert.equal(result.date, date.slice(0, 10));
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(f.state.claims, [[9, date.slice(0, 10), type]]);
  assert.equal(f.state.messages[1].contenido, `${prefix}: tenés que priorizar esto:\n1. Video 101 — Cliente\nSi algún registro está mal, decime y lo revisamos.`);
  assert.deepEqual(f.state.messages[1].metadata, { task_ids: [101] });
  assert.equal(f.state.conversations[1].periodo, date.slice(0, 7));
  const before = f.state;
  assert.equal((await runWilsonScheduledDigest(f.pool, options)).duplicates, 1);
  assert.deepEqual(f.state, before);
  assert.equal(f.state.messages[0].contenido, 'Historia conservada');
  assert.ok(f.log.every(({ sql }) => !/DELETE|TRUNCATE/.test(sql)));
  assert.ok(f.releases.every(Boolean));
});

test('no eligible tasks: empty, blocked, waiting review, archived or finished do not claim', async () => {
  for (const tasks of [[], [task(1, { propiedades_extra: { bloqueada: true } })], [task(1, { estado: 'en_revision' })], [task(1, { propiedades_extra: { archivada_render_os: true } })], [task(1, { estado: 'finalizada' })]]) {
    const f = fixture({ tasks: { 9: tasks } });
    assert.equal((await runWilsonScheduledDigest(f.pool, { now: friday })).skipped, 1);
    assert.equal(f.state.claims.length, 0);
    assert.equal(f.state.messages.length, 1);
    assert.ok(!f.log.some(({ sql }) => sql.startsWith('INSERT')));
  }
});

test('inactive recipients excluded and discovered recipients revalidated under SHARE', async () => {
  const f = fixture({ users: [user(9, { activo: false }), user(10)], discovered: [{ id: 9 }, { id: 10 }, { id: 11 }], tasks: { 10: [task(2)] } });
  const result = await runWilsonScheduledDigest(f.pool, { now: friday });
  assert.equal(result.sent, 1);
  assert.equal(result.skipped, 2);
  assert.deepEqual(f.state.claims.map(c => c[0]), [10]);
  assert.equal(f.log.filter(({ sql }) => sql.includes('FOR SHARE')).length, 3);
  assert.equal(f.log.filter(({ sql }) => sql.includes('FROM tareas t')).length, 1);
});

for (const stage of ['tasks', 'message', 'commit']) test(`${stage} failure rolls back only its user; retry does not duplicate others`, async () => {
  let broken = true;
  const f = fixture({ users: [user(9), user(17)], tasks: { 9: [task(1)], 17: [task(2)] }, fail: (id, at) => broken && id === 9 && at === stage });
  await assert.rejects(runWilsonScheduledDigest(f.pool, { now: friday }), error => {
    assert.equal(error.code, 'WILSON_DIGEST_FAILED');
    assert.equal(error.result.failed, 1);
    assert.equal(error.result.sent, 1);
    assert.ok(!JSON.stringify(error).includes('SECRET'));
    assert.ok(!error.message.includes('SECRET'));
    return true;
  });
  assert.deepEqual(f.state.claims.map(c => c[0]), [17]);
  assert.deepEqual(f.state.messages.slice(1).map(m => m.metadata.task_ids), [[2]]);
  assert.ok(f.log.some(({ sql }) => sql === 'ROLLBACK'));
  broken = false;
  const result = await runWilsonScheduledDigest(f.pool, { now: friday });
  assert.equal(result.sent, 1);
  assert.equal(result.duplicates, 1);
  assert.equal(f.state.messages.length, 3);
});

test('independent profile IDs with identical names; five task limit and no financial serialization', async () => {
  const f = fixture({ users: [user(1), user(35), user(48)], tasks: { 1: [], 35: Array.from({ length: 7 }, (_, i) => task(100 + i, { propiedades_extra: { costo: 'FINANCIAL_SECRET' }, salario: 'FINANCIAL_SECRET' })), 48: [task(200)] } });
  assert.equal((await runWilsonScheduledDigest(f.pool, { now: friday })).sent, 2);
  assert.deepEqual(f.state.claims.map(c => c[0]), [35, 48]);
  assert.equal(f.state.messages[1].metadata.task_ids.length, 5);
  assert.deepEqual(f.state.messages[2].metadata.task_ids, [200]);
  assert.ok(!JSON.stringify(f.state).includes('FINANCIAL_SECRET'));
});

test('captures mutable now before awaiting discovery, including conversation month', async () => {
  const now = new Date('2026-09-28T13:00:00Z');
  const f = fixture({ onDiscovery() { now.setUTCMonth(11); } });
  assert.equal((await runWilsonScheduledDigest(f.pool, { now })).date, '2026-09-28');
  assert.equal(f.state.conversations[1].periodo, '2026-09');
});

test('recipient discovery failure is sanitized', async () => {
  await assert.rejects(runWilsonScheduledDigest({ async query() { throw Error('DATABASE_SECRET'); } }, { now: friday }), error => error.code === 'WILSON_DIGEST_FAILED' && error.result.failed === 1 && !error.message.includes('DATABASE_SECRET'));
});

test('explicit now also controls personal task ranking, not the machine date', async () => {
  const f = fixture({ tasks: { 9: [
    task(1, { fecha_vencimiento: '2026-08-20', prioridad: 'alta', created_at: '2026-08-01' }),
    task(2, { fecha_vencimiento: '2026-08-21', prioridad: 'alta', created_at: '2026-08-20' }),
  ] } });
  await runWilsonScheduledDigest(f.pool, { now: friday });
  // Today/high wins over overdue/high; with wall-clock October both would be
  // overdue and the older task would win instead.
  assert.deepEqual(f.state.messages[1].metadata.task_ids, [2, 1]);
});

test('failed pool lease remains sanitized and does not prevent later recipients', async () => {
  const f = fixture({ users: [user(9), user(17)], tasks: { 17: [task(2)] } });
  const connect = f.pool.connect;
  let first = true;
  f.pool.connect = async () => { if (first) { first = false; throw Error('LEASE_SECRET'); } return connect(); };
  await assert.rejects(runWilsonScheduledDigest(f.pool, { now: friday }), error => error.code === 'WILSON_DIGEST_FAILED' && error.result.sent === 1 && error.result.failed === 1 && !error.message.includes('LEASE_SECRET'));
  assert.deepEqual(f.state.claims.map(c => c[0]), [17]);
});

test('rollback failure discards the lease rather than returning an aborted client', async () => {
  const f = fixture({ fail: (_id, stage) => stage === 'message' });
  const connect = f.pool.connect;
  const rollbackError = Error('ROLLBACK_SECRET');
  f.pool.connect = async () => {
    const db = await connect();
    const query = db.query;
    db.query = async (sql, values) => { if (sql === 'ROLLBACK') throw rollbackError; return query(sql, values); };
    return db;
  };
  await assert.rejects(runWilsonScheduledDigest(f.pool, { now: friday }), { code: 'WILSON_DIGEST_FAILED' });
  assert.equal(f.releases[0], rollbackError);
  assert.equal(f.state.claims.length, 0);
});

test('local scheduler catches asynchronous failure and keeps its timer contract', async t => {
  const originalDate = globalThis.Date;
  const originalInterval = globalThis.setInterval;
  const originalError = console.error;
  const errors = [];
  let callback;
  let unref = false;
  globalThis.Date = class extends originalDate { constructor(...args) { super(...(args.length ? args : [friday.getTime()])); } };
  globalThis.setInterval = (fn, ms) => { assert.equal(ms, 3600000); callback = fn; return { unref() { unref = true; } }; };
  console.error = message => errors.push(message);
  t.after(() => { globalThis.Date = originalDate; globalThis.setInterval = originalInterval; console.error = originalError; });
  scheduleWilsonMessages({ async query() { throw Error('DATABASE_SECRET'); } });
  await new Promise(resolve => setImmediate(resolve));
  await callback();
  assert.equal(errors.length, 2);
  assert.ok(unref);
  assert.ok(errors.every(message => !message.includes('DATABASE_SECRET')));
});
