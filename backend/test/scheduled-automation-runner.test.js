import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runScheduledAutomations } from '../src/scheduled-automation-runner.js';

const env = () => ({ RENDER_AUTOMATIONS_MODE: 'scheduled-v1', RENDER_AUTOMATION_JOBS: 'editorial,wilson',
  RENDER_AUTOMATION_CONNECTION_MODE: 'direct',
  RENDER_DB_ENVIRONMENT: 'test', DATABASE_URL: 'postgresql://fixture@127.0.0.1:5432/example' });
const sanitized = error => {
  assert.equal(error.code, 'AUTOMATION_RUN_FAILED');
  assert.equal(error.message, 'No se pudo completar la automatización programada.');
  assert.deepEqual(Object.keys(error), ['code']);
  assert.equal(error.cause, undefined);
  return true;
};
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(overrides = {}) {
  const calls = [], releases = [], mutex = overrides.mutex ?? { owned: false };
  const checkpoints = overrides.checkpoints ?? new Set(), markers = [], checkpointReads = [];
  const db = new EventEmitter();
  db.query = async (sql, params) => {
    calls.push(sql);
    if (overrides.query) await overrides.query(sql, db);
    if (sql.includes('pg_try_advisory_lock')) {
      const acquired = !mutex.owned; if (acquired) mutex.owned = true;
      return { rows: [{ acquired }] };
    }
    if (sql.includes('pg_advisory_unlock')) {
      if (overrides.unlockError) throw Error('private unlock failure');
      const released = mutex.owned && overrides.unlockFalse !== true;
      mutex.owned = false;
      return { rows: [{ released }] };
    }
    if (sql.includes('current_database()')) return { rows: [{ database: 'example', username: 'fixture',
      port: 5432, address: '127.0.0.1', ...overrides.identity }] };
    if (sql.startsWith('SELECT 1 FROM public.integracion_auditoria')) {
      assert.equal(mutex.owned, true);
      checkpointReads.push(params);
      if (overrides.checkpointError) throw Error('private checkpoint failure');
      return { rows: checkpoints.has(JSON.stringify(params)) ? [{ '?column?': 1 }] : [] };
    }
    if (sql.startsWith('INSERT INTO public.integracion_auditoria')) {
      assert.equal(mutex.owned, true);
      if (overrides.markerError) throw Error('private marker failure');
      const detail = JSON.parse(params[0]); markers.push(detail);
      checkpoints.add(JSON.stringify([detail.job, detail.slot]));
      return { rows: [], rowCount: 1 };
    }
    return { rows: [] };
  };
  db.release = reason => { calls.push('release'); releases.push(reason); if (reason) mutex.owned = false; };
  const pool = new EventEmitter();
  pool.connect = async () => { calls.push('connect'); return db; };
  pool.end = async () => { calls.push('end'); if (overrides.endError) throw Error('private close failure'); };
  const options = { env: env(), createPool: async () => { calls.push('factory'); return pool; },
    inspectSchema: async client => { assert.equal(client, db); calls.push('inspect'); },
    now: () => new Date('2026-10-29T12:00:00Z'), handlers: {
      editorial: async (p, context) => { assert.equal(p, pool); assert.deepEqual(Object.keys(context), ['now']); calls.push('editorial'); return { secret: 'not returned' }; },
      wilson: async () => { calls.push('wilson'); },
    } };
  return { calls, releases, mutex, db, pool, options, checkpoints, markers, checkpointReads };
}

test('PAUSED touches no target, factory, handlers, clock or inspector', async () => {
  const options = { env: { RENDER_MAINTENANCE: 'true', get DATABASE_URL() { assert.fail('target accessed'); } } };
  for (const key of ['createPool', 'handlers', 'now', 'inspectSchema']) Object.defineProperty(options, key, { get() { assert.fail(key); } });
  assert.deepEqual(await runScheduledAutomations(options), { state: 'PAUSED', jobs: [] });
});

test('invalid policy, duplicate/trash jobs and missing callbacks reject before connection', async () => {
  for (const patch of [{ RENDER_AUTOMATIONS_MODE: '' }, { RENDER_AUTOMATION_JOBS: 'editorial,editorial' },
    { RENDER_AUTOMATION_CONNECTION_MODE: undefined }, { RENDER_AUTOMATION_CONNECTION_MODE: 'transaction' },
    { RENDER_AUTOMATION_JOBS: 'trash' }, { RENDER_AUTOMATION_JOBS: 'wilson,unknown' }, { RENDER_DB_ENVIRONMENT: '' }]) {
    const f = fixture(); Object.assign(f.options.env, patch);
    await assert.rejects(runScheduledAutomations(f.options), sanitized); assert.deepEqual(f.calls, []);
  }
  const f = fixture(); delete f.options.handlers.wilson;
  await assert.rejects(runScheduledAutomations(f.options), sanitized); assert.deepEqual(f.calls, []);
});

test('BUSY owns no lock, runs no preflight/jobs and closes its invocation pool', async () => {
  const f = fixture({ mutex: { owned: true } });
  assert.deepEqual(await runScheduledAutomations(f.options), { state: 'BUSY', jobs: [] });
  assert.deepEqual(f.calls, ['factory', 'connect', 'SELECT pg_try_advisory_lock(728194, 1) AS acquired', 'release', 'end']);
  assert.deepEqual(f.releases, [undefined]); assert.equal(f.mutex.owned, true);
});

test('serial jobs follow read-only preflight, keep release mutex until finish and return no payload', async () => {
  const f = fixture();
  assert.deepEqual(await runScheduledAutomations(f.options), { state: 'COMPLETED', jobs: ['editorial', 'wilson'] });
  assert.match(f.calls[3], /^BEGIN .*READ ONLY$/);
  assert.ok(f.calls.indexOf('inspect') < f.calls.indexOf('COMMIT'));
  assert.ok(f.calls.indexOf('COMMIT') < f.calls.indexOf('editorial'));
  assert.ok(f.calls.indexOf('editorial') < f.calls.indexOf('wilson'));
  assert.deepEqual(f.calls.slice(-3), ['SELECT pg_advisory_unlock(728194, 1) AS released', 'release', 'end']);
  assert.deepEqual(f.releases, [undefined]);
});

test('jobs/callbacks/target/time captured before factory await; handler Date mutation cannot affect next job', async () => {
  const f = fixture(), originalFactory = f.options.createPool;
  let clockCalls = 0;
  f.options.now = () => { clockCalls++; return new Date('2026-10-29T12:00:00Z'); };
  f.options.handlers.editorial = async (_pool, { now }) => { now.setFullYear(2000); };
  f.options.handlers.wilson = async (_pool, { now }) => assert.equal(now.toISOString(), '2026-10-29T12:00:00.000Z');
  f.options.createPool = async () => {
    f.options.env.RENDER_AUTOMATION_JOBS = 'trash'; f.options.env.DATABASE_URL = 'invalid';
    f.options.handlers.wilson = () => assert.fail('callback changed');
    return originalFactory();
  };
  assert.deepEqual((await runScheduledAutomations(f.options)).jobs, ['editorial', 'wilson']);
  assert.equal(clockCalls, 1);
});

test('invalid clock rejects before pool; identity mismatch/nonlocal test target rolls back before schema/jobs', async () => {
  for (const value of [new Date(NaN), '2026-10-29', null]) {
    const f = fixture(); f.options.now = () => value;
    await assert.rejects(runScheduledAutomations(f.options), sanitized); assert.deepEqual(f.calls, []);
  }
  for (const identity of [{ username: 'other' }, { database: 'other' }, { port: 6543 }, { address: '192.0.2.1' }]) {
    const f = fixture({ identity });
    await assert.rejects(runScheduledAutomations(f.options), sanitized);
    assert.equal(f.calls.includes('inspect'), false); assert.equal(f.calls.includes('editorial'), false);
    assert.ok(f.calls.includes('ROLLBACK')); assert.ok(f.releases[0] instanceof Error);
  }
});

test('schema failure rolls back and disposes; rollback failure still unlocks/releases/ends', async () => {
  for (const brokenRollback of [false, true]) {
    const f = fixture({ query: async sql => { if (brokenRollback && sql === 'ROLLBACK') throw Error('private rollback'); } });
    f.options.inspectSchema = async () => { throw Error('private schema detail'); };
    await assert.rejects(runScheduledAutomations(f.options), sanitized);
    assert.ok(f.calls.includes('ROLLBACK')); assert.equal(f.calls.includes('editorial'), false);
    assert.deepEqual(f.calls.slice(-3), ['SELECT pg_advisory_unlock(728194, 1) AS released', 'release', 'end']);
    assert.ok(f.releases[0] instanceof Error);
  }
});

test('guard error during awaited job stops later jobs, rejects sanitized and discards lease', async () => {
  const f = fixture(), entered = deferred(), finish = deferred();
  f.options.handlers.editorial = async () => { entered.resolve(); await finish.promise; };
  const pending = runScheduledAutomations(f.options);
  const rejected = assert.rejects(pending, sanitized);
  await entered.promise; f.db.emit('error', Error('private lost connection')); finish.resolve();
  await rejected; assert.equal(f.calls.includes('wilson'), false);
  assert.ok(f.releases[0] instanceof Error); assert.equal(f.calls.at(-1), 'end');
});

test('handler failure does not retry or start next job and closes owned lock/pool', async () => {
  const f = fixture(); let attempts = 0;
  f.options.handlers.editorial = async () => { attempts++; throw Error('private business data'); };
  await assert.rejects(runScheduledAutomations(f.options), sanitized);
  assert.equal(attempts, 1); assert.equal(f.calls.includes('wilson'), false);
  assert.deepEqual(f.calls.slice(-3), ['SELECT pg_advisory_unlock(728194, 1) AS released', 'release', 'end']);
});

test('false/failed unlock cannot report success; close failure also rejects', async () => {
  for (const patch of [{ unlockFalse: true }, { unlockError: true }, { endError: true }]) {
    const f = fixture(patch); await assert.rejects(runScheduledAutomations(f.options), sanitized);
    assert.equal(f.calls.at(-1), 'end');
    if (!patch.endError) assert.ok(f.releases[0] instanceof Error);
  }
});

test('shared mutex prevents overlapping workers and an already-held release-executor lock', async () => {
  const mutex = { owned: false }, a = fixture({ mutex }), b = fixture({ mutex });
  const entered = deferred(), finish = deferred();
  a.options.handlers.editorial = async () => { entered.resolve(); await finish.promise; };
  const first = runScheduledAutomations(a.options); await entered.promise;
  assert.equal(mutex.owned, true);
  assert.equal((await runScheduledAutomations(b.options)).state, 'BUSY');
  finish.resolve(); assert.equal((await first).state, 'COMPLETED');
  const c = fixture({ mutex }); mutex.owned = true; // release executor's xact lock
  assert.equal((await runScheduledAutomations(c.options)).state, 'BUSY');
  assert.ok(c.calls.includes('SELECT pg_try_advisory_lock(728194, 1) AS acquired'));
});

test('connect/lock acquisition failure closes pool and discards any unknown guard lease', async () => {
  const f = fixture(); f.pool.connect = async () => { throw Error('private connection URL'); };
  await assert.rejects(runScheduledAutomations(f.options), sanitized); assert.equal(f.calls.at(-1), 'end');
  const g = fixture({ query: async sql => { if (sql.includes('pg_try_advisory_lock')) throw Error('private lock error'); } });
  await assert.rejects(runScheduledAutomations(g.options), sanitized);
  assert.equal(g.calls.some(sql => sql.includes('pg_advisory_unlock')), false);
  assert.ok(g.releases[0] instanceof Error); assert.equal(g.calls.at(-1), 'end');
});

test('UTC checkpoints preserve hourly/five-minute frequencies across fresh invocation pools', async () => {
  const checkpoints = new Set();
  async function at(time) {
    const f = fixture({ checkpoints });
    f.options.env.RENDER_AUTOMATION_JOBS = 'supervisor,wilson,editorial';
    f.options.env.MIA_SUPERVISOR_ENABLED = 'true';
    f.options.handlers.supervisor = async () => { f.calls.push('supervisor'); };
    f.options.now = () => new Date(time);
    return { f, value: await runScheduledAutomations(f.options) };
  }
  const first = await at('2026-10-29T12:04:59Z');
  assert.deepEqual(first.value.jobs, ['editorial', 'wilson', 'supervisor']);
  assert.deepEqual(first.f.markers, [
    { version: 1, job: 'editorial', slot: '2026-10-29T12:00:00.000Z' },
    { version: 1, job: 'wilson', slot: '2026-10-29T12:00:00.000Z' },
    { version: 1, job: 'supervisor', slot: '2026-10-29T12:00:00.000Z' },
  ]);
  assert.deepEqual((await at('2026-10-29T12:04:59Z')).value, { state: 'COMPLETED', jobs: [] });
  assert.deepEqual((await at('2026-10-29T12:05:00Z')).value.jobs, ['supervisor']);
  assert.deepEqual((await at('2026-10-29T13:00:00Z')).value.jobs, ['editorial', 'wilson', 'supervisor']);
  // No created_at cutoff that could omit an existing slot after clock rollback.
  assert.deepEqual((await at('2026-10-29T12:00:01Z')).value.jobs, []);
});

test('checkpoint/marker failures stop later jobs; failed domain work creates no marker', async () => {
  for (const patch of [{ checkpointError: true }, { markerError: true }]) {
    const f = fixture(patch);
    await assert.rejects(runScheduledAutomations(f.options), sanitized);
    assert.equal(f.calls.includes('wilson'), false); assert.deepEqual(f.markers, []);
    assert.equal(f.calls.includes('editorial'), Boolean(patch.markerError));
    assert.ok(f.releases[0] instanceof Error); assert.equal(f.calls.at(-1), 'end');
  }
  const f = fixture(); f.options.handlers.editorial = async () => { throw Error('private domain failure'); };
  await assert.rejects(runScheduledAutomations(f.options), sanitized);
  assert.deepEqual(f.markers, []);
});

test('waiting second worker cannot checkpoint while first job is incomplete; restart skips completed jobs', async () => {
  const mutex = { owned: false }, checkpoints = new Set();
  const first = fixture({ mutex, checkpoints }), entered = deferred(), finish = deferred();
  first.options.handlers.editorial = async () => { entered.resolve(); await finish.promise; };
  const pending = runScheduledAutomations(first.options); await entered.promise;
  assert.deepEqual(first.markers, []);
  const second = fixture({ mutex, checkpoints });
  assert.equal((await runScheduledAutomations(second.options)).state, 'BUSY');
  assert.deepEqual(second.checkpointReads, []); assert.deepEqual(second.markers, []);
  finish.resolve(); await pending;
  const restarted = fixture({ mutex, checkpoints });
  assert.deepEqual(await runScheduledAutomations(restarted.options), { state: 'COMPLETED', jobs: [] });
  assert.deepEqual(restarted.markers, []);
});

test('lost guard during handler cannot append a completion checkpoint', async () => {
  const f = fixture();
  f.options.handlers.editorial = async () => { f.db.emit('error', Error('private disconnect')); };
  await assert.rejects(runScheduledAutomations(f.options), sanitized);
  assert.deepEqual(f.markers, []); assert.equal(f.calls.includes('wilson'), false);
});

test('default inspector rejects missing migration ledger before domain work without running migrations', async () => {
  const f = fixture(); delete f.options.inspectSchema;
  await assert.rejects(runScheduledAutomations(f.options), sanitized);
  assert.equal(f.calls.includes('editorial'), false); assert.deepEqual(f.markers, []);
  assert.equal(f.calls.some(sql => /CREATE|ALTER|INSERT/.test(sql)), false);
  assert.ok(f.calls.includes('ROLLBACK'));
});

test('production transaction port rejects before factory; explicit session mode can use verified identity', async () => {
  const f = fixture();
  Object.assign(f.options.env, { RENDER_DB_ENVIRONMENT: 'production', APP_URL: 'https://sistema.rendercorrientes.com',
    DATABASE_URL: 'postgresql://fixture@database.example.invalid:6543/example' });
  await assert.rejects(runScheduledAutomations(f.options), sanitized); assert.deepEqual(f.calls, []);
  const g = fixture({ identity: { address: '192.0.2.1' } });
  Object.assign(g.options.env, { RENDER_DB_ENVIRONMENT: 'production', APP_URL: 'https://sistema.rendercorrientes.com',
    RENDER_AUTOMATION_CONNECTION_MODE: 'session', DATABASE_URL: 'postgresql://fixture@database.example.invalid:5432/example' });
  // Injected mock factory: no actual connection and no TLS/pooler claim.
  assert.equal((await runScheduledAutomations(g.options)).state, 'COMPLETED');
});

test('pool error and release failure reject without exposing private diagnostics', async () => {
  const f = fixture();
  f.options.handlers.editorial = async () => { f.pool.emit('error', Error('private pool endpoint')); };
  await assert.rejects(runScheduledAutomations(f.options), sanitized);
  assert.deepEqual(f.markers, []); assert.equal(f.calls.includes('wilson'), false);
  const g = fixture();
  g.db.release = () => { throw Error('private release details'); };
  await assert.rejects(runScheduledAutomations(g.options), sanitized); assert.equal(g.calls.at(-1), 'end');
});

test('checkpoint lookup uses the existing canal/actor index prefix and matching insert identity', async () => {
  const f = fixture();
  await runScheduledAutomations(f.options);
  const lookup = f.calls.find(sql => sql.startsWith('SELECT 1 FROM public.integracion_auditoria'));
  assert.match(lookup, /canal='system' AND actor_id='render-worker'/);
  assert.match(lookup, /integracion='render_automations' AND accion='scheduled_complete'/);
  const insert = f.calls.find(sql => sql.startsWith('INSERT INTO public.integracion_auditoria'));
  assert.match(insert, /VALUES\('render_automations','system','render-worker','Render · Automatizaciones','scheduled_complete',\$1::jsonb\)/);
  assert.deepEqual(Object.keys(f.markers[0]), ['version', 'job', 'slot']);
});

test('supervisor adapter throws on busy: no checkpoint; next invocation retries the same slot', async () => {
  const checkpoints = new Set(); let busy = true, attempts = 0;
  const adapter = async () => {
    attempts++;
    const domainResult = { busy };
    if (domainResult.busy === true) throw Object.assign(new Error('private domain busy'), { code: 'AUTOMATION_RETRY_REQUIRED' });
  };
  function supervisorFixture() {
    const f = fixture({ checkpoints });
    f.options.env.RENDER_AUTOMATION_JOBS = 'supervisor';
    f.options.env.MIA_SUPERVISOR_ENABLED = 'true';
    f.options.handlers.supervisor = adapter;
    return f;
  }
  const first = supervisorFixture();
  await assert.rejects(runScheduledAutomations(first.options), sanitized);
  assert.deepEqual(first.markers, []); assert.equal(checkpoints.size, 0);
  assert.equal(first.calls.at(-1), 'end'); assert.ok(first.releases[0] instanceof Error);
  busy = false;
  const second = supervisorFixture();
  assert.deepEqual(await runScheduledAutomations(second.options), { state: 'COMPLETED', jobs: ['supervisor'] });
  assert.equal(attempts, 2); assert.equal(second.markers.length, 1);
  assert.deepEqual(await runScheduledAutomations(supervisorFixture().options), { state: 'COMPLETED', jobs: [] });
  assert.equal(attempts, 2);
});
