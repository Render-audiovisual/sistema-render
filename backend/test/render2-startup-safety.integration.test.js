import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { startLocalHarness, request } from '../scripts/render2-local-test.js';

test('principal actual startup and explicit CLI: no implicit writes and approved atomic migrations', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55605, clusterOnly: true });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own startup-safety fixture stopped and removed: ${fixture.root}`);
  });
  assert.equal(fixture.base, null, 'Cluster-only provisioning must not expose a listening application');
  // Mark controller SQL rather than trusting a pooled backend PID. Actual
  // server/CLI queries never receive this test-only statement marker.
  const controllerMarker = 'QA_STARTUP_CONTROLLER_STATEMENT';
  const query = fixture.query.bind(fixture);
  fixture.query = (sql, values) => query(`/* ${controllerMarker} */ ${sql}`, values);
  const { readMigrationIdentity, readMigrationStatus, buildMigrationPlan } = await import('../src/migrations.js');
  const db = { async query(sql, values) { return { rows: await fixture.query(sql, values) }; } };
  const plan = async () => {
    const identity = await readMigrationIdentity(db);
    const status = await readMigrationStatus(db);
    return { identity, status, hash: buildMigrationPlan({ environment: 'test', identity, status }) };
  };
  const snapshot = async () => {
    const tables = await fixture.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
    const rows = {};
    for (const { tablename } of tables) {
      const quoted = `"${tablename.replaceAll('"', '""')}"`;
      rows[tablename] = await fixture.query(`SELECT to_jsonb(t) AS row FROM public.${quoted} t ORDER BY to_jsonb(t)::text`);
    }
    return { rows,
      columns: await fixture.query(`SELECT table_name,column_name,data_type,is_nullable,column_default
        FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`),
      constraints: await fixture.query(`SELECT conrelid::regclass::text AS relation,conname,pg_get_constraintdef(oid) AS definition
        FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY relation,conname`),
      triggers: await fixture.query(`SELECT tgrelid::regclass::text AS relation,tgname,pg_get_triggerdef(oid) AS definition
        FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace)
        ORDER BY relation,tgname`),
      functions: await fixture.query(`SELECT proname,pg_get_functiondef(oid) AS definition FROM pg_proc
        WHERE pronamespace='public'::regnamespace AND prokind='f' ORDER BY proname,oid`),
    };
  };
  const diagnosticsSafe = output => {
    const text = `${output.stdout}\n${output.stderr}`;
    assert.ok(!/postgres(?:ql)?:\/\//i.test(text), 'Entrypoint diagnostics must not expose raw database URL');
    assert.ok(!text.includes(fixture.secret), 'Entrypoint diagnostics must not expose JWT secret');
  };
  const finish = async handle => {
    const timeout = setTimeout(() => { void handle.stop(); }, 18000);
    try {
      const result = await handle.done;
      diagnosticsSafe(result);
      return result;
    } finally { clearTimeout(timeout); }
  };
  const cli = async (args = [], extra = {}) => finish(await fixture.launchActual({ entry: 'migrate', args, ...extra }));
  const applyArgs = approved => ['apply', '--plan', approved.hash, '--database', approved.identity.database, '--user', approved.identity.username];
  const rejected = result => {
    assert.notEqual(result.code, 0, 'Rejected startup/apply must exit unsuccessfully');
    assert.equal(result.signal, null, 'Fail-closed result must be a deliberate exit, not timeout/kill');
  };
  const serverRejected = async (options = {}) => {
    const handle = await fixture.launchActual({ entry: 'server', ...options });
    await assert.rejects(handle.ready);
    const result = await finish(handle);
    rejected(result);
    assert.ok(!/Backend listening|render-startup-ready/.test(result.stdout));
    return result;
  };
  // Server/CLI connections opened later log all their statements. The existing
  // fixture controller connection remains outside this per-role default.
  await fixture.query("ALTER ROLE render2_fixture SET log_statement='all'");
  const log = () => readFile(`${fixture.root}/postgres.log`, 'utf8');
  const marker = 'QA_FORBIDDEN_IMPLICIT_STARTUP_WRITE';
  await fixture.query(`CREATE TABLE qa_startup_guard(enabled boolean NOT NULL);
    INSERT INTO qa_startup_guard VALUES (true);
    CREATE FUNCTION qa_startup_write_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF position('${controllerMarker}' in current_query())=0 AND EXISTS(SELECT 1 FROM qa_startup_guard WHERE enabled) THEN
      RAISE LOG '${marker}'; RAISE EXCEPTION '${marker}' USING ERRCODE='XX000';
    END IF; RETURN NULL; END $$;
    CREATE FUNCTION qa_startup_ddl_guard() RETURNS event_trigger LANGUAGE plpgsql AS $$
    BEGIN IF position('${controllerMarker}' in current_query())=0 AND EXISTS(SELECT 1 FROM qa_startup_guard WHERE enabled) THEN
      RAISE LOG '${marker}'; RAISE EXCEPTION '${marker}' USING ERRCODE='XX000';
    END IF; END $$;`);
  const guardedTables = await fixture.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'qa_startup_guard' ORDER BY tablename");
  for (const { tablename } of guardedTables) {
    const quoted = `"${tablename.replaceAll('"', '""')}"`;
    await fixture.query(`CREATE TRIGGER qa_startup_write_guard BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
      ON public.${quoted} FOR EACH STATEMENT EXECUTE FUNCTION qa_startup_write_guard()`);
  }
  await fixture.query('CREATE EVENT TRIGGER qa_startup_ddl_guard ON ddl_command_start EXECUTE FUNCTION qa_startup_ddl_guard()');
  const assertNoImplicitAttempts = async offset => {
    const text = (await log()).slice(offset);
    assert.ok(!text.includes(marker), 'Actual entrypoint attempted implicit DDL or an operational write');
  };

  await t.test('package entrypoints separate ordinary startup from explicit migration/install/seed', async () => {
    const backend = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    const root = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
    assert.equal(backend.scripts.start, 'node src/runtime-entrypoint.js');
    for (const script of [root.scripts.start, root.scripts['start:hostinger']]) {
      assert.equal(typeof script, 'string');
      assert.ok(!/migrat|seed|setup|install/.test(script));
    }
    assert.ok(!/install|seed|setup/.test(root.scripts.migrate));
  });

  await t.test('full-schema actual server serves loopback health despite legacy job flags without startup writes', async () => {
    const before = await snapshot(); const offset = (await log()).length;
    const handle = await fixture.launchActual({ entry: 'server', env: {
      MIA_SUPERVISOR_ENABLED: 'true', TASK_COMPLETED_CLEANUP_ENABLED: 'true',
    } });
    try {
      const { base } = await handle.ready;
      const address = new URL(base);
      assert.equal(address.hostname, '127.0.0.1');
      assert.ok(Number(address.port) > 0);
      const health = await request(base, '/health', {});
      assert.equal(health.status, 200);
      assert.equal(health.body.ok, true);
      await new Promise(resolve => setTimeout(resolve, 300));
      assert.ok(handle.output().stdout.includes(address.port), 'Actual ephemeral port must be logged');
      assert.deepEqual(handle.intervals(), [], 'No scheduler interval may be registered by normal startup');
    } finally { await handle.stop(); }
    diagnosticsSafe(await handle.done);
    assert.deepEqual(await snapshot(), before);
    await assertNoImplicitAttempts(offset);
  });
  await t.test('CLI default/help inspect no database; status is read-only and reports verified identity and plan', async () => {
    for (const args of [[], ['--help']]) {
      const offset = (await log()).length;
      const result = await cli(args);
      assert.equal(result.code, 0);
      const statements = (await log()).slice(offset);
      assert.ok(!/statement:|execute [^:]*:/i.test(statements), 'CLI help must not run any database query');
    }
    const before = await snapshot(); const offset = (await log()).length;
    const approved = await plan();
    const result = await cli(['status']);
    assert.equal(result.code, 0);
    const reported = JSON.parse(result.stdout);
    assert.deepEqual(reported.identity, approved.identity);
    assert.deepEqual(reported.status, approved.status);
    assert.equal(reported.planHash, approved.hash);
    assert.match(reported.planHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(await snapshot(), before);
    await assertNoImplicitAttempts(offset);
  });
  await t.test('missing configuration, unknown jobs/demo and production job opt-in fail before listening without writes', async () => {
    for (const options of [
      { omitDatabaseUrl: true },
      { env: { RENDER_DB_ENVIRONMENT: null } },
      { env: { RENDER_DB_ENVIRONMENT: 'invalid' } },
      { env: { SETUP_DEMO_DATA: 'true' } },
      { env: { RENDER_BACKGROUND_JOBS: 'editorial,editorial' } },
      { env: { RENDER_BACKGROUND_JOBS: 'unknown' } },
      { env: { RENDER_BACKGROUND_JOBS: 'editorial' } },
      { env: { RENDER_DB_ENVIRONMENT: 'production', RENDER_BACKGROUND_JOBS: 'editorial', RENDER_ALLOW_BACKGROUND_WRITES: 'true' } },
    ]) {
      const before = await snapshot(); const offset = (await log()).length;
      await serverRejected(options);
      assert.deepEqual(await snapshot(), before);
      await assertNoImplicitAttempts(offset);
    }
  });
  await t.test('missing, unknown and incompatible ledger fail closed and preserve all actual rows', async () => {
    await fixture.query('ALTER TABLE public._migrations RENAME TO qa_saved_migrations');
    try {
      const before = await snapshot(); const offset = (await log()).length;
      await serverRejected();
      assert.deepEqual(await snapshot(), before);
      await assertNoImplicitAttempts(offset);
    } finally { await fixture.query('ALTER TABLE public.qa_saved_migrations RENAME TO _migrations'); }
    await fixture.query("INSERT INTO public._migrations(nombre) VALUES ('999_qa_unknown.sql')");
    try {
      const before = await snapshot(); await serverRejected(); assert.deepEqual(await snapshot(), before);
    } finally { await fixture.query("DELETE FROM public._migrations WHERE nombre='999_qa_unknown.sql'"); }
    await fixture.query('ALTER TABLE public._migrations RENAME COLUMN nombre TO qa_invalid_nombre');
    try {
      const before = await snapshot(); await serverRejected(); assert.deepEqual(await snapshot(), before);
    } finally { await fixture.query('ALTER TABLE public._migrations RENAME COLUMN qa_invalid_nombre TO nombre'); }
  });
  await t.test('complete ledger with missing core task revision still fails closed without schema repair', async () => {
    const complete = await plan();
    assert.equal(complete.status.ledgerExists, true);
    assert.deepEqual(complete.status.pending, []);
    assert.deepEqual(complete.status.unknownApplied, []);
    await fixture.query('ALTER TABLE public.tareas RENAME COLUMN revision TO qa_missing_revision');
    try {
      const before = await snapshot();
      const offset = (await log()).length;
      await serverRejected();
      assert.deepEqual(await snapshot(), before, 'Ledger readiness must not hide missing core schema or authorize repair');
      await assertNoImplicitAttempts(offset);
    } finally {
      await fixture.query('ALTER TABLE public.tareas RENAME COLUMN qa_missing_revision TO revision');
    }
  });
  await t.test('complete public schema rejects an ambiguous effective role search path without routing to another schema', async () => {
    await fixture.query('CREATE SCHEMA qa_startup_shadow');
    try {
      await fixture.query('ALTER ROLE render2_fixture SET search_path=qa_startup_shadow,public');
      const before = await snapshot();
      const beforeSchemas = await fixture.query("SELECT nspname FROM pg_namespace WHERE nspname IN ('public','qa_startup_shadow') ORDER BY nspname");
      const offset = (await log()).length;
      await serverRejected();
      assert.deepEqual(await snapshot(), before, 'Startup must not repair or write through an ambiguous effective search path');
      assert.deepEqual(await fixture.query("SELECT nspname FROM pg_namespace WHERE nspname IN ('public','qa_startup_shadow') ORDER BY nspname"), beforeSchemas);
      assert.deepEqual(await fixture.query(`SELECT relname FROM pg_class
        WHERE relnamespace='qa_startup_shadow'::regnamespace ORDER BY relname`), [], 'Shadow schema must remain empty');
      await assertNoImplicitAttempts(offset);
    } finally {
      await fixture.query('ALTER ROLE render2_fixture RESET search_path');
      await fixture.query('DROP SCHEMA qa_startup_shadow');
    }
  });
  await t.test('malformed apply and production apply exit without connecting, despite safe fixture PG defaults', async () => {
    for (const [args, extra] of [
      [['unknown'], {}], [['apply'], {}],
      [['apply', '--plan', 'bad', '--database', 'render2_local_test', '--user', 'render2_fixture'], {}],
      [['apply', '--plan', 'a'.repeat(64), '--database', 'render2_local_test', '--user', 'render2_fixture'], { env: { RENDER_DB_ENVIRONMENT: 'production' } }],
      [['status'], { omitDatabaseUrl: true }],
    ]) {
      const before = await snapshot(); const offset = (await log()).length;
      rejected(await cli(args, extra));
      assert.ok(!/statement:|execute [^:]*:/i.test((await log()).slice(offset)), 'Invalid command/config must reject before query');
      assert.deepEqual(await snapshot(), before);
    }
  });
  // Remove only 061-owned empty fixture objects, then replay the real approved
  // SQL. No new migration files or historical database are introduced.
  const pendingName = '061_feedback_operation_receipts.sql';
  const [ledger] = await fixture.query('SELECT * FROM public._migrations WHERE nombre=$1', [pendingName]);
  const resetPending = async () => {
    assert.deepEqual(await fixture.query('SELECT * FROM feedback_operation_receipts'), []);
    await fixture.query(`DROP TRIGGER feedback_notes_monotonic_version ON notas_compartidas;
      DROP FUNCTION feedback_notes_monotonic_version(); DROP TABLE feedback_operation_receipts;
      DELETE FROM public._migrations WHERE nombre='061_feedback_operation_receipts.sql'`);
  };
  await resetPending();
  await t.test('actual pending migration prevents startup; status hashes real SQL without creating or applying it', async () => {
    const before = await snapshot(); const offset = (await log()).length;
    await serverRejected();
    const approved = await plan();
    assert.deepEqual(approved.status.pending.map(file => file.name), [pendingName]);
    const sql = await readFile(new URL(`../migrations/${pendingName}`, import.meta.url));
    assert.equal(approved.status.pending[0].sha256, createHash('sha256').update(sql).digest('hex'));
    const status = await cli(['status']); assert.equal(status.code, 0);
    const reported = JSON.parse(status.stdout);
    assert.deepEqual(reported.identity, approved.identity);
    assert.deepEqual(reported.status, approved.status);
    assert.equal(reported.planHash, approved.hash);
    assert.deepEqual(await snapshot(), before);
    await assertNoImplicitAttempts(offset);
  });
  await t.test('wrong approved identity or stale ledger-bound plan rejects before any DDL', async () => {
    const approved = await plan();
    for (const args of [
      ['apply', '--plan', approved.hash, '--database', 'qa_wrong_database', '--user', approved.identity.username],
      ['apply', '--plan', approved.hash, '--database', approved.identity.database, '--user', 'qa_wrong_user'],
    ]) {
      const before = await snapshot(); const offset = (await log()).length;
      rejected(await cli(args)); assert.deepEqual(await snapshot(), before); await assertNoImplicitAttempts(offset);
    }
    await fixture.query("INSERT INTO public._migrations(nombre) VALUES ('999_qa_stale_plan.sql')");
    try {
      const before = await snapshot(); const offset = (await log()).length;
      rejected(await cli(applyArgs(approved))); assert.deepEqual(await snapshot(), before); await assertNoImplicitAttempts(offset);
    } finally { await fixture.query("DELETE FROM public._migrations WHERE nombre='999_qa_stale_plan.sql'"); }
  });
  await fixture.query('UPDATE qa_startup_guard SET enabled=false');
  await t.test('concurrent actual approved CLI runners execute real pending SQL once, not ledger ON CONFLICT masking', async () => {
    const approved = await plan();
    const offset = (await log()).length;
    const results = await Promise.all([cli(applyArgs(approved)), cli(applyArgs(approved))]);
    assert.equal(results.filter(result => result.code === 0).length, 1);
    assert.equal(results.filter(result => result.code !== 0 && result.signal === null).length, 1);
    const applied = await fixture.query('SELECT * FROM public._migrations WHERE nombre=$1', [pendingName]);
    assert.equal(applied.length, 1);
    assert.ok(Number(applied[0].id) > Number(ledger.id));
    assert.equal(((await log()).slice(offset).match(/CREATE TABLE feedback_operation_receipts\s*\(/g) || []).length, 1,
      'PostgreSQL statement log must show only one execution of the real pending SQL');
    assert.deepEqual((await plan()).status.pending, []);
    assert.deepEqual(await fixture.query('SELECT * FROM feedback_operation_receipts'), []);
  });
  await resetPending();
  await t.test('failure after file DDL rolls back SQL plus ledger and next runner reacquires the chain lock', async () => {
    await fixture.query(`CREATE FUNCTION qa_startup_migration_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.nombre='061_feedback_operation_receipts.sql' THEN
        RAISE EXCEPTION 'QA migration ledger failure' USING ERRCODE='XX000'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER qa_startup_migration_fail BEFORE INSERT ON public._migrations
      FOR EACH ROW EXECUTE FUNCTION qa_startup_migration_fail()`);
    const approved = await plan();
    try {
      const before = await snapshot();
      const failed = await cli(applyArgs(approved)); rejected(failed);
      assert.ok(`${failed.stdout}\n${failed.stderr}`.includes(pendingName));
      assert.ok(!`${failed.stdout}\n${failed.stderr}`.includes('QA migration ledger failure'), 'Runner must sanitize raw SQL failure detail');
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(await fixture.query("SELECT to_regclass('public.feedback_operation_receipts') AS relation"), [{ relation: null }]);
    } finally {
      await fixture.query('DROP TRIGGER qa_startup_migration_fail ON public._migrations; DROP FUNCTION qa_startup_migration_fail()');
    }
    const retry = await cli(applyArgs(await plan()));
    assert.equal(retry.code, 0, 'Second process must reacquire safely after failed runner exits');
    assert.deepEqual((await plan()).status.pending, []);
  });
});
