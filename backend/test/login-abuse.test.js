import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
import { reserveLoginAttempt, normalizeLoginPeer, normalizeLoginIdentifier, loginAbuseBucketKey,
  loginAttemptBuckets, LOGIN_PEER_LIMIT, LOGIN_IDENTIFIER_LIMIT, LOGIN_WINDOW_SECONDS, LOGIN_PRUNE_LIMIT,
  LOGIN_ACQUIRE_TIMEOUT_MS, LOGIN_QUERY_TIMEOUT_MS, LOGIN_PENDING_ACQUISITION_LIMIT, LOGIN_PRUNE_SQL, LOGIN_RESERVE_SQL } from '../src/login-abuse.js';

const SECRET = 'unit-only-noncredential-HMAC-key';
const INPUT = { peer: '192.0.2.1', identifier: ' Test.Person ' };

test('policy constants match contract', () => {
  assert.equal(LOGIN_PEER_LIMIT, 120);
  assert.equal(LOGIN_IDENTIFIER_LIMIT, 20);
  assert.equal(LOGIN_WINDOW_SECONDS, 900);
  assert.equal(LOGIN_PRUNE_LIMIT, 100);
  assert.equal(LOGIN_ACQUIRE_TIMEOUT_MS, 2000);
  assert.equal(LOGIN_QUERY_TIMEOUT_MS, 3000);
  assert.equal(LOGIN_PENDING_ACQUISITION_LIMIT, 32);
});

test('direct peer canonicalizes IPv4-mapped/equivalent IPv6 without DNS or proxy headers', () => {
  for (const peer of ['192.0.2.1', '::ffff:192.0.2.1', '::FFFF:C000:0201', '0:0:0:0:0:ffff:c000:201']) assert.equal(normalizeLoginPeer(peer), '192.0.2.1');
  for (const peer of ['2001:db8::1', '2001:0DB8:0000:0000:0000:0000:0000:0001']) assert.equal(normalizeLoginPeer(peer), '2001:db8::1');
  assert.equal(normalizeLoginPeer('::1'), '::1');
  const sentinel = normalizeLoginPeer(undefined);
  for (const peer of [null, {}, [], '', 'localhost', '192.0.2.1, 198.51.100.1', '192.0.2.1:443', ' 192.0.2.1 ', '127.000.000.001', '[::1]', 'fe80::1%eth0', 'not-ip']) assert.equal(normalizeLoginPeer(peer), sentinel);
});

test('identifier normalization is trim/lowercase only, UTF8 bounded and no type coercion', () => {
  assert.equal(normalizeLoginIdentifier(' Test.Person '), 'test.person');
  assert.equal(normalizeLoginIdentifier('JOSÉ'), 'josé');
  assert.notEqual(normalizeLoginIdentifier('José'), normalizeLoginIdentifier('Jose'));
  assert.equal(normalizeLoginIdentifier('é'.repeat(160)).length, 160);
  for (const value of ['é'.repeat(161), 'x'.repeat(321), '', '  ', 'a\0b', 'a\nb', 'a\u0085b', {}, null, 1]) assert.throws(() => normalizeLoginIdentifier(value), { status: 503 });
});

test('HMAC keys are opaque/domain-separated/secret-bound; missing peers share one sentinel', () => {
  const peer = loginAbuseBucketKey('peer', INPUT.peer, SECRET);
  const identifier = loginAbuseBucketKey('identifier', INPUT.peer, SECRET);
  assert.match(peer, /^[a-f0-9]{64}$/);
  assert.notEqual(peer, identifier);
  assert.notEqual(peer, loginAbuseBucketKey('peer', INPUT.peer, 'different-unit-key'));
  assert.equal(peer, loginAbuseBucketKey('peer', '::ffff:192.0.2.1', SECRET));
  assert.equal(loginAbuseBucketKey('identifier', ' TEST.PERSON ', SECRET), loginAbuseBucketKey('identifier', 'test.person', SECRET));
  assert.equal(loginAbuseBucketKey('peer', undefined, SECRET), loginAbuseBucketKey('peer', 'invalid', SECRET));
  const buckets = loginAttemptBuckets(INPUT, SECRET);
  assert.deepEqual(buckets.map(b => b.key), [...buckets.map(b => b.key)].sort());
  assert.deepEqual(buckets.map(b => b.limit).sort((a, b) => a - b), [20, 120]);
  assert.doesNotMatch(JSON.stringify(buckets), /192\.0\.2\.1|test\.person|unit-only/);
  assert.equal(loginAttemptBuckets({ peer: INPUT.peer }, SECRET).length, 1);
});

function storage({ existing = new Map(), now = 1000, fault, afterRowLock } = {}) {
  const calls = [], releases = [];
  let snapshot, clock = now;
  const state = { rows: existing };
  const client = { release(destroy) { releases.push(destroy); }, async query(config) {
    assert.equal(typeof config, 'object');
    assert.equal(config.query_timeout, LOGIN_QUERY_TIMEOUT_MS);
    const { text: sql, values } = config;
    calls.push(config);
    const error = fault?.(sql);
    if (error) throw error instanceof Error ? error : new Error('raw driver secret detail');
    if (sql.startsWith('BEGIN')) snapshot = structuredClone(state.rows);
    if (sql === 'ROLLBACK') state.rows = snapshot;
    if (sql === LOGIN_PRUNE_SQL) {
      const candidates = [...state.rows.entries()].filter(([key, row]) => row.expires <= clock && !values[0].includes(key))
        .sort(([a, x], [b, y]) => x.expires - y.expires || a.localeCompare(b)).slice(0, 100);
      for (const [key, row] of candidates) if (!row.locked) state.rows.delete(key);
    }
    if (sql.startsWith('SELECT bucket_key FROM auth_login_buckets WHERE bucket_key=$1')) {
      if (afterRowLock) clock = afterRowLock(clock);
      return { rows: state.rows.has(values[0]) ? [{ bucket_key: values[0] }] : [] };
    }
    if (sql === LOGIN_RESERVE_SQL) {
      const [key, window, cap] = values, previous = state.rows.get(key);
      const row = !previous || previous.expires <= clock ? { attempts: 1, start: clock, expires: clock + window }
        : { ...previous, attempts: Math.min(previous.attempts + 1, cap) };
      state.rows.set(key, row);
      return { rows: [{ attempts: row.attempts }] };
    }
    if (sql.startsWith('SELECT bucket_key,attempts,')) {
      return { rows: values[0].filter(k => state.rows.has(k)).map(k => ({ bucket_key: k, attempts: state.rows.get(k).attempts, retry_after: Math.max(1, Math.ceil(state.rows.get(k).expires - clock)) })) };
    }
    return { rows: [] };
  } };
  return { calls, releases, client, state, pool: { connect: async () => client }, setClock(value) { clock = value; } };
}

test('ordered current advisory locks precede bounded try-lock/SKIP LOCKED prune and ordered upserts', async () => {
  const h = storage();
  assert.deepEqual(await reserveLoginAttempt(h.pool, INPUT, SECRET), { allowed: true, retryAfter: 1 });
  assert.deepEqual(h.calls.slice(0, 3).map(c => c.text), ['BEGIN ISOLATION LEVEL READ COMMITTED', "SET LOCAL lock_timeout='1000ms'", "SET LOCAL statement_timeout='2000ms'"]);
  const buckets = loginAttemptBuckets(INPUT, SECRET), prune = h.calls.findIndex(c => c.text === LOGIN_PRUNE_SQL);
  const locks = h.calls.filter(c => c.text.startsWith('SELECT pg_advisory_xact_lock'));
  assert.deepEqual(locks.map(c => c.values[0]), buckets.map(b => b.key));
  assert.ok(h.calls.indexOf(locks.at(-1)) < prune);
  const upserts = h.calls.filter(c => c.text === LOGIN_RESERVE_SQL);
  assert.deepEqual(upserts.map(c => c.values[0]), buckets.map(b => b.key));
  assert.ok(prune < h.calls.indexOf(upserts[0]));
  for (const upsert of upserts) {
    const previous = h.calls[h.calls.indexOf(upsert) - 1];
    assert.match(previous.text, /WHERE bucket_key=\$1 FOR UPDATE$/);
    assert.equal(previous.values[0], upsert.values[0]);
    assert.deepEqual(upsert.values.slice(1), [900, buckets.find(b => b.key === upsert.values[0]).limit + 1]);
  }
  assert.equal(h.calls.at(-1).text, 'COMMIT');
  assert.deepEqual(h.releases, [false]);
  assert.doesNotMatch(JSON.stringify(h.calls), /192\.0\.2\.1|Test.Person|test.person|unit-only/);
});

test('identifier20 then denial21 commits bounded counters on every later attempt', async () => {
  const h = storage();
  for (let n = 1; n <= 24; n += 1) {
    const result = await reserveLoginAttempt(h.pool, INPUT, SECRET);
    assert.equal(result.allowed, n <= 20);
    assert.equal(result.retryAfter, n <= 20 ? 1 : 900);
    assert.equal(h.calls.at(-1).text, 'COMMIT');
  }
  const key = loginAbuseBucketKey('identifier', INPUT.identifier, SECRET);
  assert.equal(h.state.rows.get(key).attempts, 21);
  assert.equal(h.calls.some(c => c.text === 'ROLLBACK'), false);
});

test('peer120 shared across password/peer-only Google; cap121 and no success reset path', async () => {
  const h = storage();
  for (let n = 1; n <= 123; n += 1) {
    const request = n % 2 ? { peer: INPUT.peer, identifier: `account-${n}` } : { peer: INPUT.peer };
    assert.equal((await reserveLoginAttempt(h.pool, request, SECRET)).allowed, n <= 120);
  }
  assert.equal(h.state.rows.get(loginAbuseBucketKey('peer', INPUT.peer, SECRET)).attempts, 121);
});

test('denied retry-after is max of denied buckets only, minimum1', async () => {
  const buckets = loginAttemptBuckets(INPUT, SECRET), rows = new Map();
  for (const b of buckets) rows.set(b.key, { attempts: b.limit, start: 100, expires: b.limit === 20 ? 1010.1 : 1020.1 });
  const h = storage({ existing: rows });
  assert.deepEqual(await reserveLoginAttempt(h.pool, INPUT, SECRET), { allowed: false, retryAfter: 21 });
  const peer = buckets.find(b => b.limit === 120);
  h.state.rows.get(peer.key).attempts = 1;
  assert.deepEqual(await reserveLoginAttempt(h.pool, INPUT, SECRET), { allowed: false, retryAfter: 11 });
});

test('database clock is captured after existing-row wait, expired bucket resets atomically', async () => {
  const key = loginAbuseBucketKey('peer', INPUT.peer, SECRET);
  const h = storage({ existing: new Map([[key, { attempts: 121, start: 0, expires: 1001 }]]), now: 1000, afterRowLock: time => time + 2 });
  assert.deepEqual(await reserveLoginAttempt(h.pool, { peer: INPUT.peer }, SECRET), { allowed: true, retryAfter: 1 });
  assert.deepEqual(h.state.rows.get(key), { attempts: 1, start: 1002, expires: 1902 });
  assert.match(LOGIN_RESERVE_SQL, /stamp AS MATERIALIZED \(SELECT clock_timestamp\(\) AS now\)/);
  assert.doesNotMatch(LOGIN_RESERVE_SQL, /NOW\(\)|statement_timestamp|transaction_timestamp|Date/);
});

test('pruning excludes live/current buckets, caps100 candidates and preserves locked expired rows', async () => {
  const rows = new Map();
  for (let n = 0; n < 120; n += 1) rows.set(n.toString(16).padStart(64, '0'), { attempts: 1, start: 0, expires: 500, locked: n === 0 });
  const current = loginAbuseBucketKey('peer', INPUT.peer, SECRET);
  rows.set(current, { attempts: 121, start: 0, expires: 500 });
  const live = 'f'.repeat(64); rows.set(live, { attempts: 1, start: 500, expires: 1500 });
  const h = storage({ existing: rows });
  await reserveLoginAttempt(h.pool, { peer: INPUT.peer }, SECRET);
  assert.equal(h.state.rows.has('0'.repeat(64)), true);
  assert.equal(h.state.rows.has(live), true);
  assert.equal(h.state.rows.get(current).attempts, 1);
  assert.equal(h.state.rows.size, 23);
  assert.match(LOGIN_PRUNE_SQL, /candidates AS MATERIALIZED/);
  const candidateSql = LOGIN_PRUNE_SQL.slice(0, LOGIN_PRUNE_SQL.indexOf('eligible AS MATERIALIZED'));
  assert.match(candidateSql, /expires_at <= CURRENT_TIMESTAMP/);
  assert.doesNotMatch(candidateSql, /clock_timestamp\(\)/);
  assert.match(LOGIN_PRUNE_SQL, /LIMIT 100/);
  assert.match(LOGIN_PRUNE_SQL, /pg_try_advisory_xact_lock/);
  assert.match(LOGIN_PRUNE_SQL, /FOR UPDATE OF b SKIP LOCKED/);
  assert.ok(LOGIN_PRUNE_SQL.indexOf('pg_try_advisory_xact_lock') < LOGIN_PRUNE_SQL.indexOf('FOR UPDATE OF b SKIP LOCKED'));
  assert.match(LOGIN_PRUNE_SQL, /bucket_key <> ALL\(\$1::text\[\]\)/);
});

test('independent helper calls/clients keep storage state, no process-local counter fallback', async () => {
  const shared = new Map();
  const a = storage({ existing: shared }), b = storage({ existing: shared });
  await reserveLoginAttempt(a.pool, INPUT, SECRET);
  await reserveLoginAttempt(b.pool, INPUT, SECRET);
  for (const row of shared.values()) assert.equal(row.attempts, 2);
});

test('invalid config/input fails sanitized503 before connection, without exposing key material', async () => {
  let connected = 0;
  const pool = { connect() { connected += 1; throw new Error('must not connect'); } };
  for (const secret of [undefined, null, '', '  ', {}, Buffer.from('secret'), 'a\0b']) {
    await assert.rejects(reserveLoginAttempt(pool, INPUT, secret), error => error.status === 503 && !/secret|password|credential/i.test(error.message));
  }
  for (const input of [null, [], { ...INPUT, password: 'SECRET' }, { peer: INPUT.peer, identifier: {} }]) await assert.rejects(reserveLoginAttempt(pool, input, SECRET), { status: 503 });
  assert.equal(connected, 0);
});

test('storage/settings/commit failure rolls back with bounded queries and destroys client; no raw errors', async () => {
  for (const location of ['BEGIN', 'SET LOCAL lock_timeout', 'SET LOCAL statement_timeout', 'WITH candidates', 'WITH stamp', 'COMMIT']) {
    const h = storage({ fault: sql => sql.startsWith(location) && Object.assign(new Error('PASSWORD PRIVATE DATABASE_URL'), { code: '57014' }) });
    await assert.rejects(reserveLoginAttempt(h.pool, INPUT, SECRET), error => {
      assert.equal(error.status, 503);
      assert.doesNotMatch(error.message, /PASSWORD|PRIVATE|DATABASE_URL|57014/);
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(h.calls.at(-1).text, 'ROLLBACK');
    assert.deepEqual(h.releases, [true]);
  }
  const h = storage({ fault: sql => sql === LOGIN_RESERVE_SQL || sql === 'ROLLBACK' });
  await assert.rejects(reserveLoginAttempt(h.pool, INPUT, SECRET), { status: 503 });
  assert.deepEqual(h.releases, [true]);
});

test('connection rejection is sanitized and a 2s acquisition timeout observes/releases late clients and rejections', async () => {
  await assert.rejects(reserveLoginAttempt({ connect: async () => { throw new Error('RAW connection secret'); } }, INPUT, SECRET), error => error.status === 503 && !error.message.includes('RAW'));
  let lateResolve, lateReject, released;
  const slow = { connect: () => new Promise(resolve => { lateResolve = resolve; }) };
  const failing = { connect: () => new Promise((_, reject) => { lateReject = reject; }) };
  await Promise.all([
    assert.rejects(reserveLoginAttempt(slow, INPUT, SECRET), { status: 503 }),
    assert.rejects(reserveLoginAttempt(failing, INPUT, SECRET), { status: 503 }),
  ]);
  lateResolve({ release(destroy) { released = destroy; } });
  lateReject(new Error('late error must be observed'));
  await setImmediate();
  assert.equal(released, true);
});

test('source has no clock/cache/provider/env dependencies and result exposes only allowed/retryAfter', async () => {
  const source = readFileSync(new URL('../src/login-abuse.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Date\.now|new Date|fetch\(|bcrypt|verifyIdToken|process\.env|x-forwarded|setInterval|Promise\.race/);
  const result = await reserveLoginAttempt(storage().pool, INPUT, SECRET);
  assert.deepEqual(Object.keys(result), ['allowed', 'retryAfter']);
  assert.equal(typeof result.allowed, 'boolean');
  assert.ok(Number.isSafeInteger(result.retryAfter) && result.retryAfter > 0);
});

test('per-pool pending acquisitions cap32, retain timed-out slots until underlying settlement, then recover', async () => {
  const unresolved = [], released = [];
  let connects = 0, recovered = false;
  const healthy = storage();
  const pool = { connect() {
    connects += 1;
    if (recovered) return Promise.resolve(healthy.client);
    return new Promise((resolve, reject) => { unresolved.push({ resolve, reject }); });
  } };
  const waiting = Array.from({ length: 32 }, () => assert.rejects(reserveLoginAttempt(pool, INPUT, SECRET), { status: 503 }));
  await setImmediate();
  assert.equal(connects, 32);
  // The 33rd fails without entering connect(), before the first32 time out.
  await assert.rejects(reserveLoginAttempt(pool, INPUT, SECRET), { status: 503 });
  assert.equal(connects, 32);
  // A different pool has its own independent resource allowance.
  assert.equal((await reserveLoginAttempt(storage().pool, INPUT, SECRET)).allowed, true);
  await Promise.all(waiting);
  await assert.rejects(reserveLoginAttempt(pool, INPUT, SECRET), { status: 503 });
  assert.equal(connects, 32);
  for (let n = 0; n < unresolved.length; n += 1) {
    if (n % 2) unresolved[n].reject(new Error('late acquisition rejection'));
    else unresolved[n].resolve({ release(destroy) { released.push(destroy); } });
  }
  await setImmediate();
  assert.deepEqual(released, Array(16).fill(true));
  recovered = true;
  assert.equal((await reserveLoginAttempt(pool, INPUT, SECRET)).allowed, true);
  assert.equal(connects, 33);
  assert.deepEqual(healthy.releases, [false]);
});
