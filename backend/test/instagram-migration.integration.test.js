import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, createHash } from 'node:crypto';
import pg from 'pg';
import { startLocalHarness, cleanEnvironment } from '../scripts/render2-local-test.js';
import { readMigrationStatus } from '../src/migrations.js';
import { readApplicationObjectInventory, protectNewApplicationObjects } from '../src/application-object-security.js';
import { inspectInstagramMigration, executeInstagramMigration, INSTAGRAM_MIGRATIONS } from '../src/instagram-migration.js';
import { readInstagramPanel } from '../src/instagram-panel.js';
import { executeProductionRelease } from '../src/production-release-executor.js';

const enabled = process.env.RENDER2_RUN_INSTAGRAM_ARCHIVE_REHEARSAL === 'true';
const run = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const migrationNames = INSTAGRAM_MIGRATIONS.map(m => m.name);

test('Instagram-only atomic migration on a restored archived copy, including a postbackup task', {
  skip: !enabled, timeout: 240000,
}, async t => {
  // This is an explicitly identified local archive, not a configured URL,
  // live database or replacement of production. All private SQL errors are hidden.
  const backup = process.env.RENDER2_INSTAGRAM_REHEARSAL_ARCHIVE;
  assert.match(backup || '', /^\/private\/tmp\/render-production-snapshot-[A-Za-z0-9-]+\/[A-Za-z0-9-]+\/database-public\.dump$/);
  assert.equal(await realpath(backup), backup);
  const archiveBytes = await readFile(backup), archiveHash = hash(archiveBytes);
  const fixture = await startLocalHarness({ port: 55992, clusterOnly: true, postgres18: true });
  let pool;
  t.after(async () => { await pool?.end(); await fixture.cleanup(); await assert.rejects(access(fixture.root), { code: 'ENOENT' }); });
  const database = `ig_restore_${randomBytes(6).toString('hex')}`;
  assert.match(database, /^ig_restore_[a-f0-9]{12}$/);
  await fixture.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
  pool = new pg.Pool({ host: '127.0.0.1', port: 55992, database, user: 'render2_fixture',
    max: 3, connectionTimeoutMillis: 5000, statement_timeout: 30000 });
  const identity = (await pool.query(`SELECT current_database() AS database,current_setting('data_directory') AS directory,
    host(inet_server_addr()) AS address,inet_server_port() AS port`)).rows[0];
  assert.deepEqual(identity, { database, directory: `${fixture.root}/data`, address: '127.0.0.1', port: 55992 });
  await pool.query('DROP SCHEMA public'); // Only the verified, freshly created empty copy.
  try {
    await run('/opt/homebrew/opt/postgresql@18/bin/pg_restore', ['--exit-on-error', '--single-transaction',
      '--no-owner', '--no-privileges', '--no-publications', '--no-subscriptions',
      '-h', '127.0.0.1', '-p', '55992', '-U', 'render2_fixture', '-d', database, backup],
    { env: cleanEnvironment(), timeout: 60000, maxBuffer: 1000000 });
  } catch { throw new Error('Archive restoration failed; private row values suppressed.'); }
  const originalTasks = (await pool.query('SELECT count(*)::int AS n FROM tareas')).rows[0].n;
  assert.ok(originalTasks > 0);
  // Prepare the already-deployed historical baseline ONLY on this archived
  // copy. Do not run the old release executor, infer owners or repartition tasks.
  const status = await readMigrationStatus(pool);
  assert.equal(status.unknownApplied.length, 0);
  const historical = status.pending.filter(m => !migrationNames.includes(m.name));
  assert.ok([0, 41].includes(historical.length), 'Archive must be the deployed baseline or the known pre-Render2 baseline');
  t.diagnostic(`Archived baseline: ${originalTasks} tasks; ${historical.length} historical migrations pending in this disposable copy.`);
  const db = await pool.connect();
  try {
    await db.query('BEGIN'); const inventory = await readApplicationObjectInventory(db);
    for (const file of historical) {
      const bytes = await readFile(new URL(`../migrations/${file.name}`, import.meta.url));
      assert.equal(hash(bytes), file.sha256);
      await db.query(bytes.toString('utf8')); await db.query('INSERT INTO _migrations(nombre) VALUES($1)', [file.name]);
    }
    await protectNewApplicationObjects(db, inventory); await db.query('COMMIT');
  } catch { await db.query('ROLLBACK'); throw new Error('Archived baseline preparation failed; private values suppressed.'); }
  finally { db.release(); }

  // Reproduce permissive platform defaults, then prove the new objects are
  // protected in the SAME transaction that creates them.
  await pool.query('CREATE ROLE anon NOLOGIN'); await pool.query('CREATE ROLE authenticated NOLOGIN');
  await pool.query('ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon,authenticated');
  await pool.query('ALTER DEFAULT PRIVILEGES GRANT ALL ON SEQUENCES TO anon,authenticated');
  await pool.query('ALTER DEFAULT PRIVILEGES GRANT ALL ON FUNCTIONS TO anon,authenticated');
  let plan = await inspectInstagramMigration(pool, { environment: 'test' });
  const approval = () => ({ plan, expiresAt: Date.now() + 300000, backupSha256: archiveHash,
    restorationEvidenceSha256: hash(JSON.stringify({ archiveHash, database, restored: true, originalTasks })),
    maintenance: { writesPaused: true, jobsPaused: true, exclusiveSchema: true } });
  const options = { environment: 'test', consumeApproval: async () => true };
  await t.test('new plan contains exactly 094/095, separate from the historical publicator', async () => {
    assert.deepEqual(plan.sql.map(m => m.name), migrationNames);
    assert.equal(plan.scope, 'instagram-094-095');
    await assert.rejects(executeProductionRelease(pool, { approval: plan }), { code: 'INVALID_SCOPE' });
  });
  await t.test('a task added after the backup invalidates the old approval, without consuming it', async () => {
    // Clone one row only in the disposable copy; no real task is changed.
    const cols = (await pool.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='tareas' AND is_generated='NEVER' ORDER BY ordinal_position`)).rows
      .map(r => r.column_name).filter(c => c !== 'id');
    const quote = value => '"' + value.replaceAll('"', '""') + '"';
    await pool.query(`INSERT INTO tareas(${cols.map(quote).join(',')}) SELECT ${cols.map(quote).join(',')} FROM tareas ORDER BY id LIMIT 1`);
    let consumed = 0;
    await assert.rejects(executeInstagramMigration(pool, approval(), { environment: 'test', consumeApproval: async () => { consumed++; return true; } }), { code: 'INSTAGRAM_PLAN_CHANGED' });
    assert.equal(consumed, 0);
    plan = await inspectInstagramMigration(pool, { environment: 'test' });
  });
  await t.test('missing authority, expiration, wrong target and rejected approval cannot execute DDL', async () => {
    await assert.rejects(executeInstagramMigration(pool, approval(), { environment: 'test' }), { code: 'INSTAGRAM_APPROVAL_REQUIRED' });
    await assert.rejects(executeInstagramMigration(pool, { ...approval(), expiresAt: 0 }, options), { code: 'INSTAGRAM_APPROVAL_REQUIRED' });
    await assert.rejects(executeInstagramMigration(pool, approval(), { ...options, environment: 'production' }), { code: 'INSTAGRAM_APPROVAL_REQUIRED' });
    await assert.rejects(executeInstagramMigration(pool, approval(), { ...options, consumeApproval: async () => false }), { code: 'INSTAGRAM_APPROVAL_REJECTED' });
    assert.deepEqual(await inspectInstagramMigration(pool, { environment: 'test' }), plan);
  });
  await t.test('late failure during the second migration rolls back the first migration and both ledger entries', async () => {
    const faultPool = { async connect() {
      const connection = await pool.connect();
      return { release: value => connection.release(value), query(sql, params) {
        if (typeof sql === 'string' && sql.includes('CREATE TABLE instagram_reportes')) throw new Error('Synthetic second migration failure');
        return connection.query(sql, params);
      } };
    } };
    await assert.rejects(executeInstagramMigration(faultPool, approval(), options), { code: 'INSTAGRAM_EXECUTION_FAILED' });
    assert.deepEqual(await inspectInstagramMigration(pool, { environment: 'test' }), plan);
    assert.equal((await pool.query("SELECT to_regclass('public.instagram_cuentas') AS relation")).rows[0].relation, null);
  });
  await t.test('commit preserves every original row and the extra task; new objects are private', async () => {
    const sequenceState = async () => (await pool.query(`SELECT sequencename,last_value FROM pg_sequences
      WHERE schemaname='public' AND sequencename NOT LIKE 'instagram_%' AND sequencename<>'_migrations_id_seq'
      ORDER BY sequencename`)).rows;
    const originalSequences = await sequenceState();
    const result = await executeInstagramMigration(pool, approval(), options);
    assert.equal(result.state, 'COMMITTED'); assert.equal(result.existingDataUnchanged, true);
    assert.deepEqual(result.migrations, migrationNames);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM tareas')).rows[0].n, originalTasks + 1);
    assert.deepEqual(await sequenceState(), originalSequences, 'Business ID generators remain unchanged');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM _migrations WHERE nombre=ANY($1)', [migrationNames])).rows[0].n, 2);
    const tables = (await pool.query("SELECT relrowsecurity FROM pg_class WHERE relname=ANY($1::text[])",
      [['instagram_cuentas','instagram_cuenta_seguidores','instagram_media','instagram_media_metricas','instagram_reportes']])).rows;
    assert.equal(tables.length, 5); assert.ok(tables.every(r => r.relrowsecurity));
    const leaks = (await pool.query(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,
      LATERAL aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a
      WHERE n.nspname='public' AND c.relname LIKE 'instagram_%'
      AND a.grantee IN (0,(SELECT oid FROM pg_roles WHERE rolname='anon'),(SELECT oid FROM pg_roles WHERE rolname='authenticated'))`)).rows[0].n;
    assert.equal(leaks, 0);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
      LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname='public'
      AND p.proname='instagram_media_metricas_inmutables'
      AND a.grantee IN (0,(SELECT oid FROM pg_roles WHERE rolname='anon'),(SELECT oid FROM pg_roles WHERE rolname='authenticated'))`)).rows[0].n, 0);
    await assert.rejects(inspectInstagramMigration(pool, { environment: 'test' }), { code: 'INSTAGRAM_MIGRATION_SCOPE_CHANGED' });
    // Compare the archive bytes as well; original backup was never rewritten.
    assert.equal(hash(await readFile(backup)), archiveHash);
    t.diagnostic(`Archived copy only: originalTasks=${originalTasks}; finalTasks=${originalTasks + 1}; preservedTables=${result.preservedTables}; no production access.`);
  });
  await t.test('panel is readable for an existing owner and forbidden for an employee on the upgraded copy', async () => {
    const users = (await pool.query('SELECT id,rol,session_version FROM usuarios WHERE activo IS TRUE ORDER BY id')).rows;
    const owner = users.find(u => u.rol === 'admin'), employee = users.find(u => u.rol !== 'admin');
    assert.ok(owner && employee);
    const panel = await readInstagramPanel(pool, owner, { periodo: '2026-10' });
    assert.ok(Array.isArray(panel.clientes));
    await assert.rejects(readInstagramPanel(pool, employee, { periodo: '2026-10' }), { status: 403 });
  });
});
