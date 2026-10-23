import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCalendarQuery, readCalendar, createCalendarRouter } from '../src/calendar.js';

const query = { desde: '2026-10-01', hasta: '2026-11-01' };
const snapshot = `c1:${'a'.repeat(64)}`;
const auth = () => ({ id: 4, rol: 'edicion', session_version: 2 });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

test('paged query is explicit, canonical and immutable, with optional day scoped to the requested range', () => {
  const input = { ...query, limit: '200', dia: '2026-10-23' };
  const result = normalizeCalendarQuery(input);
  assert.deepEqual(result.pagination, { limit: 200, offset: 0, expected_snapshot: null, dia: input.dia });
  assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.pagination), true);
  input.limit = '5'; input.dia = '2026-10-24'; assert.equal(result.pagination.limit, 200); assert.equal(result.pagination.dia, '2026-10-23');
  assert.deepEqual(normalizeCalendarQuery({ ...query, limit: '500', offset: '9007199254740991', expected_snapshot: snapshot }).pagination,
    { limit: 500, offset: Number.MAX_SAFE_INTEGER, expected_snapshot: snapshot, dia: null });
  assert.equal(Object.hasOwn(normalizeCalendarQuery(query), 'pagination'), false);
});

test('invalid page shapes, coerced numbers, aliases, dates and unbound continuation reject before a lease', async () => {
  const invalid = [
    { offset: '0' }, { dia: '2026-10-23' }, { expected_snapshot: snapshot },
    { limit: '0' }, { limit: '501' }, { limit: '01' }, { limit: '1\n' }, { limit: '1e2' }, { limit: 200 },
    { limit: ['200'] }, { limit: '200', offset: '1' }, { limit: '200', offset: '-1' },
    { limit: '200', offset: '00' }, { limit: '200', offset: '1\n', expected_snapshot: snapshot },
    { limit: '200', offset: '9007199254740992', expected_snapshot: snapshot },
    { limit: '200', expected_snapshot: `${snapshot}\n` }, { limit: '200', expected_snapshot: snapshot.toUpperCase() },
    { limit: '200', expected_snapshot: '' }, { limit: '200', expected_snapshot: 'a'.repeat(64) },
    { limit: '200', dia: '2026-11-01' }, { limit: '200', dia: '2026-09-30' },
    { limit: '200', dia: '2026-10-00' }, { limit: '200', dia: '2026-10-32' },
    { limit: '200', dia: '2026-10-23T00:00:00Z' }, { limit: '200', dia: ['2026-10-23'] },
    { limit: '200', page: '0' }, { limit: '200', cliente_id: '7\n' },
  ];
  let leases = 0;
  for (const fields of invalid) {
    await assert.rejects(readCalendar({ connect() { leases++; throw Error('unexpected lease'); } }, auth(), { ...query, ...fields }), { status: 400 });
  }
  assert.equal(leases, 0);
});

test('invalid authority rejects before pool acquisition, not by a caller label', async () => {
  let leases = 0;
  for (const user of [null, { ...auth(), id: '4' }, { ...auth(), id: 0 }, { ...auth(), session_version: 0 },
    { ...auth(), session_version: 2147483648 }, { ...auth(), rol: null }]) {
    await assert.rejects(readCalendar({ connect() { leases++; } }, user, query), { status: 401 });
  }
  assert.equal(leases, 0);
});

test('actor and filters cannot be replaced while the pool lease is queued', async () => {
  const waiting = deferred(), user = auth(), input = { ...query }, calls = [];
  const db = { release() {}, async query(sql, values) {
    calls.push({ sql, values });
    if (sql.startsWith('SELECT id,rol,activo,session_version')) return { rows: [{ ...auth(), activo: true }] };
    return { rows: [] };
  } };
  const pending = readCalendar({ connect: () => waiting.promise }, user, input);
  user.id = 8; user.rol = 'admin'; user.session_version = 99; input.desde = '2026-10-20'; input.scope = 'team';
  waiting.resolve(db); const result = await pending;
  assert.equal(result.scope, 'mine'); assert.deepEqual(result.range, query);
  assert.deepEqual(calls.find(call => call.sql.startsWith('SELECT id,rol,activo,session_version')).values, [4]);
  const sources = calls.filter(call => call.values?.length === 5);
  assert.ok(sources.length); assert.ok(sources.every(call => JSON.stringify(call.values) === JSON.stringify([query.desde, query.hasta, null, 4, false])));
});

test('rollback failure discards the lease and preserves the original read error', async () => {
  const original = Error('read failed'), rollback = Error('rollback failed'); let discarded;
  const db = { release(error) { discarded = error; }, async query(sql) {
    if (sql === 'ROLLBACK') throw rollback;
    if (sql.startsWith('SELECT id,rol,activo,session_version')) throw original;
    return { rows: [] };
  } };
  await assert.rejects(readCalendar({ connect: async () => db }, auth(), query), error => error === original);
  assert.equal(discarded, rollback);
});

test('router forwards snapshot conflict as a bounded no-store409 response', async () => {
  const routes = new Map(), failure = Object.assign(Error('El calendario cambió. Actualizá desde el inicio.'), { status: 409 });
  createCalendarRouter({ express: { Router: () => ({ get: (path, handler) => routes.set(path, handler) }) },
    pool: { connect: async () => { throw failure; } } });
  let header, status, body;
  const res = { set(...value) { header = value; }, status(value) { status = value; return this; }, json(value) { body = value; } };
  await routes.get('/')({ auth: auth(), query }, res, () => assert.fail('409 must not reach500 handler'));
  assert.deepEqual(header, ['Cache-Control', 'no-store']); assert.equal(status, 409); assert.deepEqual(body, { error: failure.message });
});
