import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { runScheduledAutomations } from '../src/scheduled-automation-runner.js';
import { readMigrationStatus } from '../src/migrations.js';
import { assertStartupMigrationStatus } from '../src/startup-policy.js';
import { assertCoreSchemaReady } from '../src/startup-schema.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error('Synthetic worker barrier timeout')), 7000);
  })]); } finally { clearTimeout(timer); }
}
const sanitized = error => error.code === 'AUTOMATION_RUN_FAILED'
  && error.message === 'No se pudo completar la automatización programada.' && error.cause === undefined;

test('scheduled runner: real full-schema PostgreSQL guard/checkpoints, isolated local fixture only', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const port = 55796, fixture = await startLocalHarness({ port, clusterOnly: true });
  const pools = new Set(); let control;
  t.after(async () => {
    try {
      for (const pool of pools) if (!pool.ended) await pool.end();
      if (control) await control.end();
    } finally { await fixture.cleanup(); }
    await assert.rejects(access(fixture.root), { code: 'ENOENT' });
  });
  const url = `postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`;
  const config = { connectionString: url, max: 4, statement_timeout: 8000,
    lock_timeout: 3000, connectionTimeoutMillis: 3000, idleTimeoutMillis: 1000 };
  control = new pg.Pool(config);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port, url,
    identity: (await control.query(`SELECT current_database() AS database,current_user AS username,
      host(inet_server_addr()) AS address,inet_server_port() AS port,
      current_setting('data_directory') AS directory`)).rows[0] });
  const initialLedger = (await control.query('SELECT * FROM public._migrations ORDER BY nombre')).rows;
  assertStartupMigrationStatus(await readMigrationStatus(control));
  await assertCoreSchemaReady(control);
  // Synthetic effects only, never actual editorial, notification or AI handlers.
  await control.query('CREATE TABLE public.qa_scheduled_effects(id text PRIMARY KEY)');
  const policy = { NODE_ENV: 'test', RENDER_DB_ENVIRONMENT: 'test', DATABASE_URL: url,
    RENDER_AUTOMATIONS_MODE: 'scheduled-v1', RENDER_AUTOMATION_CONNECTION_MODE: 'direct',
    RENDER_AUTOMATION_JOBS: 'editorial,wilson,supervisor', MIA_SUPERVISOR_ENABLED: 'true' };
  function invocation(time, handlers = {}, jobs = 'editorial,wilson,supervisor') {
    let ownedPool;
    return { options: { env: { ...policy, RENDER_AUTOMATION_JOBS: jobs }, now: () => new Date(time),
      createPool: () => { ownedPool = new pg.Pool(config); pools.add(ownedPool); return ownedPool; },
      handlers: { editorial: async () => {}, wilson: async () => {}, supervisor: async () => {}, ...handlers } },
    ended: () => assert.equal(ownedPool?.ended, true) };
  }
  const checkpoints = async () => (await control.query(`SELECT canal,actor_id,actor_nombre,detalles
    FROM public.integracion_auditoria WHERE integracion='render_automations'
      AND accion='scheduled_complete' ORDER BY id`)).rows;
  const markerCount = async slot => Number((await control.query(`SELECT count(*) AS n
    FROM public.integracion_auditoria WHERE integracion='render_automations' AND accion='scheduled_complete'
      AND canal='system' AND actor_id='render-worker' AND detalles->>'slot'=$1`, [slot])).rows[0].n);

  await t.test('paused bypasses even factory/handler property access', async () => {
    const options = { env: { RENDER_MAINTENANCE: 'true' } };
    for (const field of ['createPool', 'handlers', 'inspectSchema', 'now']) Object.defineProperty(options, field,
      { get() { assert.fail(`Paused worker accessed ${field}`); } });
    const before = pools.size;
    assert.deepEqual(await runScheduledAutomations(options), { state: 'PAUSED', jobs: [] });
    assert.equal(pools.size, before); assert.deepEqual(await checkpoints(), []);
  });

  await t.test('default real schema preflight, serial independent transactions and exact safe audit checkpoint', async () => {
    const order = [], stamp = '2026-10-29T01:04:00Z';
    const handlers = Object.fromEntries(['editorial', 'wilson', 'supervisor'].map(job => [job, async (pool, context) => {
      assert.deepEqual(Object.keys(context), ['now']); assert.equal(context.now.toISOString(), '2026-10-29T01:04:00.000Z');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('INSERT INTO public.qa_scheduled_effects VALUES($1)', [`initial-${job}`]);
        await client.query('COMMIT'); order.push(job);
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
      return { privateDomainPayload: 'must not escape' };
    }]));
    const run = invocation(stamp, handlers);
    assert.deepEqual(await runScheduledAutomations(run.options), { state: 'COMPLETED', jobs: ['editorial', 'wilson', 'supervisor'] });
    run.ended(); assert.deepEqual(order, ['editorial', 'wilson', 'supervisor']);
    assert.equal((await control.query('SELECT count(*)::int AS n FROM public.qa_scheduled_effects')).rows[0].n, 3);
    const rows = await checkpoints(); assert.equal(rows.length, 3);
    for (const [index, row] of rows.entries()) {
      assert.equal(row.canal, 'system'); assert.equal(row.actor_id, 'render-worker');
      assert.equal(row.actor_nombre, 'Render · Automatizaciones');
      assert.deepEqual(row.detalles, { version: 1, job: order[index], slot: '2026-10-29T01:00:00.000Z' });
    }
  });

  await t.test('new pools replay same slot without handlers; five-minute/hour boundaries remain distinct', async () => {
    const forbid = () => assert.fail('Completed slot must not run again');
    const repeat = invocation('2026-10-29T01:04:59Z', { editorial: forbid, wilson: forbid, supervisor: forbid });
    assert.deepEqual(await runScheduledAutomations(repeat.options), { state: 'COMPLETED', jobs: [] }); repeat.ended();
    const five = invocation('2026-10-29T01:05:00Z', { editorial: forbid, wilson: forbid });
    assert.deepEqual(await runScheduledAutomations(five.options), { state: 'COMPLETED', jobs: ['supervisor'] }); five.ended();
    const hour = invocation('2026-10-29T02:00:00Z');
    assert.deepEqual((await runScheduledAutomations(hour.options)).jobs, ['editorial', 'wilson', 'supervisor']); hour.ended();
    assert.equal(await markerCount('2026-10-29T01:00:00.000Z'), 3);
    assert.equal(await markerCount('2026-10-29T01:05:00.000Z'), 1);
  });

  await t.test('release-executor transaction mutex makes worker BUSY without handlers/checkpoints', async () => {
    const release = await control.connect();
    try {
      await release.query('BEGIN'); await release.query('SELECT pg_advisory_xact_lock(728194, 1)');
      const forbid = () => assert.fail('Release owns mutex');
      const run = invocation('2026-10-29T03:00:00Z', { editorial: forbid, wilson: forbid, supervisor: forbid });
      assert.deepEqual(await runScheduledAutomations(run.options), { state: 'BUSY', jobs: [] }); run.ended();
      assert.equal(await markerCount('2026-10-29T03:00:00.000Z'), 0);
    } finally { await release.query('ROLLBACK'); release.release(); }
  });

  await t.test('concurrent worker is BUSY and release mutex remains held until awaited handler completes', async () => {
    const entered = deferred(), finish = deferred(); let calls = 0;
    const first = invocation('2026-10-29T04:00:00Z', { editorial: async pool => {
      calls++; await pool.query("INSERT INTO public.qa_scheduled_effects VALUES('concurrent-first')");
      entered.resolve(); await finish.promise;
    } }, 'editorial');
    const pending = runScheduledAutomations(first.options);
    pending.catch(() => {});
    try {
      await bounded(Promise.race([entered.promise, pending.then(() => assert.fail('Worker exited before barrier'))]));
      assert.equal(await markerCount('2026-10-29T04:00:00.000Z'), 0);
      const other = invocation('2026-10-29T04:00:00Z', { editorial: () => assert.fail('Concurrent worker ran') }, 'editorial');
      assert.deepEqual(await runScheduledAutomations(other.options), { state: 'BUSY', jobs: [] }); other.ended();
      const release = await control.connect();
      try {
        await release.query('BEGIN');
        assert.equal((await release.query('SELECT pg_try_advisory_xact_lock(728194, 1) AS acquired')).rows[0].acquired, false);
      } finally { await release.query('ROLLBACK'); release.release(); }
    } finally { finish.resolve(); await pending; }
    first.ended(); assert.equal(calls, 1); assert.equal(await markerCount('2026-10-29T04:00:00.000Z'), 1);
    const replay = invocation('2026-10-29T04:00:00Z', { editorial: () => assert.fail('Restart repeated job') }, 'editorial');
    assert.deepEqual(await runScheduledAutomations(replay.options), { state: 'COMPLETED', jobs: [] }); replay.ended();
    const available = await control.connect();
    try {
      await available.query('BEGIN');
      assert.equal((await available.query('SELECT pg_try_advisory_xact_lock(728194, 1) AS acquired')).rows[0].acquired, true);
    } finally { await available.query('ROLLBACK'); available.release(); }
  });

  await t.test('domain rollback leaves no checkpoint and no later handler; a fresh invocation may retry', async () => {
    const fail = invocation('2026-10-29T05:00:00Z', {
      editorial: async pool => {
        const db = await pool.connect();
        try {
          await db.query('BEGIN'); await db.query("INSERT INTO public.qa_scheduled_effects VALUES('must-rollback')");
          throw Error('synthetic private payload must be sanitized');
        } catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
      }, wilson: () => assert.fail('Failure must stop subsequent jobs'), supervisor: () => assert.fail('Failure must stop subsequent jobs'),
    });
    await assert.rejects(runScheduledAutomations(fail.options), sanitized); fail.ended();
    assert.equal(await markerCount('2026-10-29T05:00:00.000Z'), 0);
    assert.equal((await control.query("SELECT count(*)::int AS n FROM public.qa_scheduled_effects WHERE id='must-rollback'")).rows[0].n, 0);
    const retry = invocation('2026-10-29T05:00:00Z', {}, 'editorial');
    assert.deepEqual(await runScheduledAutomations(retry.options), { state: 'COMPLETED', jobs: ['editorial'] }); retry.ended();
    assert.equal(await markerCount('2026-10-29T05:00:00.000Z'), 1);
  });

  await t.test('audit INSERT failure rejects without checkpoint or next job despite committed domain effect', async () => {
    await control.query(`CREATE FUNCTION public.qa_reject_scheduled_marker() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.integracion='render_automations' AND NEW.detalles->>'slot'='2026-10-29T06:00:00.000Z' THEN
        RAISE EXCEPTION 'synthetic private checkpoint failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER qa_reject_scheduled_marker BEFORE INSERT ON public.integracion_auditoria
        FOR EACH ROW EXECUTE FUNCTION public.qa_reject_scheduled_marker()`);
    try {
      const run = invocation('2026-10-29T06:00:00Z', { editorial: async pool => {
        await pool.query("INSERT INTO public.qa_scheduled_effects VALUES('domain-committed-without-marker')");
      }, wilson: () => assert.fail('Marker failure must stop next job') });
      await assert.rejects(runScheduledAutomations(run.options), sanitized); run.ended();
      assert.equal(await markerCount('2026-10-29T06:00:00.000Z'), 0);
      assert.equal((await control.query("SELECT count(*)::int AS n FROM public.qa_scheduled_effects WHERE id='domain-committed-without-marker'")).rows[0].n, 1);
    } finally {
      await control.query('DROP TRIGGER qa_reject_scheduled_marker ON public.integracion_auditoria; DROP FUNCTION public.qa_reject_scheduled_marker()');
    }
  });

  assert.deepEqual((await control.query('SELECT * FROM public._migrations ORDER BY nombre')).rows, initialLedger,
    'Runner never applies or edits migrations');
  await assertCoreSchemaReady(control);
  for (const pool of pools) assert.equal(pool.ended, true, 'Every invocation owns and closes its pool');
});
