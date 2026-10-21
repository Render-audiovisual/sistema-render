// Principal backend only. Never accepts a database URL or an existing data directory.
import { mkdtemp, rm } from 'node:fs/promises';
import { execFileSync, fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import path from 'node:path';
import { existsSync } from 'node:fs';

const self = fileURLToPath(import.meta.url);
export const fixtureAccounts = Object.freeze([
  { id: 91001, usuario: 'qa_franco', nombre: 'Franco QA', rol: 'admin' },
  { id: 91002, usuario: 'qa_agustin', nombre: 'Agustin QA', rol: 'admin' },
  { id: 91003, usuario: 'qa_luciano', nombre: 'Luciano QA', rol: 'edicion' },
  { id: 91004, usuario: 'qa_designer', nombre: 'Designer QA', rol: 'diseno' },
]);
export const fixturePassword = 'Local-only-fixture-2026!';

export function assertFixtureIdentity({ root, cwd, port, url, identity }) {
  if (!/^\/private\/tmp\/render2-local-[A-Za-z0-9]+$/.test(root || '') || cwd !== root)
    throw new Error('Not a generated fixture directory');
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/render2_local_test'
    || parsed.username !== 'render2_fixture' || parsed.password || parsed.search
    || parsed.port !== String(port) || !Number.isInteger(Number(port))) throw new Error('Unsafe fixture URL');
  if (identity && (identity.database !== 'render2_local_test' || identity.username !== 'render2_fixture'
    || identity.address !== '127.0.0.1' || Number(identity.port) !== Number(port)
    || identity.directory !== path.join(root, 'data'))) throw new Error(`PostgreSQL fixture identity mismatch: ${JSON.stringify(identity)}`);
}

export function cleanEnvironment() {
  return { PATH: '/opt/homebrew/bin:/usr/bin:/bin', TMPDIR: '/private/tmp',
    LANG: 'en_US.UTF-8', NODE_ENV: 'test', DOTENV_CONFIG_PATH: '/dev/null',
    RENDER_DISABLE_SERVER_START: 'true' };
}

export async function request(base, route, { token, method = 'GET', body } = {}) {
  const response = await fetch(new URL(route, base), {
    method, signal: AbortSignal.timeout(5000),
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

export function fixtureWilsonEnvironment(config = {}) {
  const allowed = new Set(['publicKey', 'telegramUserBindings', 'allowedTelegramIds', 'allowedWhatsappIds', 'allowedWhatsappGroups', 'systemActorId']);
  for (const key of Object.keys(config)) if (!allowed.has(key)) throw new Error('Unsupported fixture integration option');
  const result = {};
  const fields = { publicKey: 'WILSON_PUBLIC_KEY', telegramUserBindings: 'WILSON_TELEGRAM_USER_BINDINGS',
    allowedTelegramIds: 'WILSON_ALLOWED_TELEGRAM_IDS', allowedWhatsappIds: 'WILSON_ALLOWED_WHATSAPP_IDS',
    allowedWhatsappGroups: 'WILSON_ALLOWED_WHATSAPP_GROUP_IDS', systemActorId: 'WILSON_SYSTEM_ACTOR_ID' };
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== 'string' || value.length > 12000) throw new Error('Invalid fixture integration option');
    result[fields[key]] = value;
  }
  return result;
}

export async function startLocalHarness({ port = 55594, deferUserAdminMigration = false, deferGoalMigration = false, deferAssignmentMigration = false, deferTaskStateMigration = false, deferProductionRegistryMigration = false, deferProductionEditorialMigration = false, deferFeedbackReceiptsMigration = false, deferTaskReceiptsMigration = false, deferProjectsMigration = false, deferEditorialConfirmationMigration = false, deferEditingDeliveriesMigration = false, deferEditingApprovalMigration = false, deferLoginAbuseMigration = false, deferEditingReviewsMigration = false, clusterOnly = false, supervisorEnabled = false, browserSessions = false, deferProductionCreateReceiptsMigration = false, deferTaskBoardOrderMigration = false, deferGoalQuotaReviewMigration = false, deferProductionHistoryBatchMigration = false, deferProjectDeliverableApprovalMigration = false, wilson = {} } = {}) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
  if (typeof deferUserAdminMigration !== 'boolean') throw new Error('Invalid account observation migration fixture option');
  if (typeof deferProductionCreateReceiptsMigration !== 'boolean') throw new Error('Invalid production creation receipt migration fixture option');
  if (typeof deferTaskBoardOrderMigration !== 'boolean') throw new Error('Invalid task board order migration fixture option');
  if (typeof deferGoalQuotaReviewMigration !== 'boolean') throw new Error('Invalid goal quota review migration fixture option');
  if (typeof deferProductionHistoryBatchMigration !== 'boolean') throw new Error('Invalid production batch migration fixture option');
  if (typeof deferProjectDeliverableApprovalMigration !== 'boolean') throw new Error('Invalid project deliverable approval migration fixture option');
  if (typeof supervisorEnabled !== 'boolean') throw new Error('Invalid supervisor fixture option');
  if (typeof clusterOnly !== 'boolean') throw new Error('Invalid cluster-only fixture option');
  if (typeof browserSessions !== 'boolean') throw new Error('Invalid browser-session fixture option');
  const wilsonEnv = fixtureWilsonEnvironment(wilson);
  const root = await mkdtemp('/private/tmp/render2-local-');
  const data = `${root}/data`;
  const env = cleanEnvironment();
  const command = (name, args) => execFileSync(`/opt/homebrew/bin/${name}`, args,
    { env, cwd: root, timeout: 35000, stdio: 'pipe' });
  let child;
  let startAttempted = false;
  let closed = false;
  const entryChildren = new Set();
  const cleanup = async () => {
    if (closed) return;
    closed = true;
    await Promise.all([...entryChildren].map(entry => entry.stop()));
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      const kill = setTimeout(() => child.kill('SIGKILL'), 3000);
      await exited;
      clearTimeout(kill);
    }
    // pg_ctl addresses this exact fresh data directory, never a port or foreign cluster.
    if (startAttempted) {
      try {
        try { command('pg_ctl', ['-D', data, '-m', 'immediate', '-w', '-t', '10', 'stop']); }
        catch (error) {
          // A failed startup can mean another cluster owns the port. Only an
          // explicit pg_ctl status=3 and no PID file establish ours is stopped.
          try { command('pg_ctl', ['-D', data, 'status']); throw new Error('Cluster still running'); }
          catch (status) { if (status.status !== 3 || existsSync(`${data}/postmaster.pid`)) throw error; }
        }
      }
      catch (error) {
        // Keep files for recovery if shutdown could not be confirmed.
        throw new Error(`Cluster cleanup unconfirmed; retained ${root}: ${error.message}`);
      }
    }
    await rm(root, { recursive: true, force: true });
  };
  try {
    command('initdb', ['-D', data, '-U', 'render2_fixture', '--auth-local=trust', '--auth-host=trust', '--no-locale']);
    startAttempted = true;
    command('pg_ctl', ['-D', data, '-l', `${root}/postgres.log`, '-o',
      `-h 127.0.0.1 -p ${port} -k ${root}`, '-w', '-t', '20', 'start']);
    command('createdb', ['-h', '127.0.0.1', '-p', String(port), '-U', 'render2_fixture', 'render2_local_test']);
    const url = `postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`;
    const secret = randomBytes(32).toString('hex');
    child = fork(self, ['--fixture-child'], { cwd: root, execArgv: [],
      env: { ...env, ...wilsonEnv, MIA_SUPERVISOR_ENABLED: String(supervisorEnabled), DATABASE_URL: url, JWT_SECRET: secret, RENDER2_FIXTURE_ROOT: root,
        ...(browserSessions ? { RENDER_BROWSER_SESSIONS: 'true', RENDER_BROWSER_ORIGIN: 'http://127.0.0.1:5195', RENDER_BROWSER_ALLOW_LOCAL_HTTP: 'true' } : {}),
        RENDER2_FIXTURE_PORT: String(port), RENDER2_DEFER_GOAL_MIGRATION: String(deferGoalMigration),
        RENDER2_DEFER_USER_ADMIN_MIGRATION: String(deferUserAdminMigration),
        RENDER2_DEFER_PRODUCTION_CREATE_RECEIPTS_MIGRATION: String(deferProductionCreateReceiptsMigration),
        RENDER2_DEFER_TASK_BOARD_ORDER_MIGRATION: String(deferTaskBoardOrderMigration),
        RENDER2_DEFER_GOAL_QUOTA_REVIEW_MIGRATION: String(deferGoalQuotaReviewMigration),
        RENDER2_DEFER_PRODUCTION_HISTORY_BATCH_MIGRATION: String(deferProductionHistoryBatchMigration),
        RENDER2_DEFER_PROJECT_DELIVERABLE_APPROVAL_MIGRATION: String(deferProjectDeliverableApprovalMigration),
        RENDER2_DEFER_ASSIGNMENT_MIGRATION: String(deferAssignmentMigration),
        RENDER2_DEFER_TASK_STATE_MIGRATION: String(deferTaskStateMigration),
        RENDER2_DEFER_PRODUCTION_REGISTRY_MIGRATION: String(deferProductionRegistryMigration),
        RENDER2_DEFER_PRODUCTION_EDITORIAL_MIGRATION: String(deferProductionEditorialMigration),
        RENDER2_DEFER_FEEDBACK_RECEIPTS_MIGRATION: String(deferFeedbackReceiptsMigration),
        RENDER2_DEFER_TASK_RECEIPTS_MIGRATION: String(deferTaskReceiptsMigration),
        RENDER2_DEFER_PROJECTS_MIGRATION: String(deferProjectsMigration),
        RENDER2_DEFER_EDITORIAL_CONFIRMATION_MIGRATION: String(deferEditorialConfirmationMigration),
        RENDER2_DEFER_EDITING_DELIVERIES_MIGRATION: String(deferEditingDeliveriesMigration),
        RENDER2_DEFER_EDITING_APPROVAL_MIGRATION: String(deferEditingApprovalMigration),
        RENDER2_DEFER_LOGIN_ABUSE_MIGRATION: String(deferLoginAbuseMigration),
        RENDER2_DEFER_EDITING_REVIEWS_MIGRATION: String(deferEditingReviewsMigration),
        RENDER2_FIXTURE_CLUSTER_ONLY: String(clusterOnly),
        PGOPTIONS: '-c statement_timeout=15000' }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Fixture startup timeout')), 90000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Fixture exited: ${code}`)); });
      child.once('message', message => {
        clearTimeout(timer);
        message.error ? reject(new Error(message.error)) : resolve(message);
      });
    });
    let sequence = 0;
    const launchActual = async ({ entry, args = [], env: overrides = {}, omitDatabaseUrl = false } = {}) => {
      if (closed || child.exitCode !== null || child.signalCode !== null) throw new Error('Fixture is not running');
      if (!['server', 'migrate'].includes(entry) || !Array.isArray(args)
        || args.some(value => typeof value !== 'string' || value.length > 2000 || value.includes('\0'))) throw new Error('Invalid fixture entrypoint');
      const allowed = new Set(['RENDER_DB_ENVIRONMENT', 'RENDER_BACKGROUND_JOBS', 'RENDER_ALLOW_BACKGROUND_WRITES',
        'SETUP_DEMO_DATA', 'MIA_SUPERVISOR_ENABLED', 'TASK_COMPLETED_CLEANUP_ENABLED']);
      if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)
        || Object.entries(overrides).some(([key, value]) => !allowed.has(key) || (value !== null && typeof value !== 'string'))) throw new Error('Invalid fixture entrypoint environment');
      if (typeof omitDatabaseUrl !== 'boolean') throw new Error('Invalid fixture URL omission');
      const launchEnv = { ...env, DATABASE_URL: url, JWT_SECRET: secret, HOST: '127.0.0.1', PORT: '0',
        RENDER_DISABLE_SERVER_START: 'false', RENDER_DB_ENVIRONMENT: 'test', RENDER_BACKGROUND_JOBS: '',
        RENDER_ALLOW_BACKGROUND_WRITES: 'false', SETUP_DEMO_DATA: 'false',
        RENDER2_FIXTURE_ROOT: root, RENDER2_FIXTURE_PORT: String(port), RENDER2_FIXTURE_ENTRY: entry,
        // Even a regression that falls back to pg defaults stays inside this fixture.
        PGHOST: '127.0.0.1', PGPORT: String(port), PGUSER: 'render2_fixture', PGDATABASE: 'render2_local_test',
        PGOPTIONS: '-c statement_timeout=15000' };
      for (const [key, value] of Object.entries(overrides)) value === null ? delete launchEnv[key] : launchEnv[key] = value;
      if (omitDatabaseUrl) delete launchEnv.DATABASE_URL;
      const processHandle = fork(self, ['--entry-child', ...args], { cwd: root, execArgv: [], env: launchEnv, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      let stdout = '', stderr = '', readyResolve, readyReject, finished = false;
      const intervalEvents = [];
      processHandle.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-200000); });
      processHandle.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-200000); });
      const readyPromise = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
      readyPromise.catch(() => {}); // CLI exits are observed through done, not ready.
      const timer = setTimeout(() => readyReject(new Error('Fixture entrypoint readiness timeout')), 20000);
      processHandle.on('message', message => {
        if (message?.type === 'render-fixture-interval') intervalEvents.push({ delay: message.delay });
        if (message?.type === 'render-startup-ready' && Number.isInteger(message.port) && message.port > 0) {
          clearTimeout(timer); readyResolve({ base: `http://127.0.0.1:${message.port}` });
        }
      });
      const done = new Promise(resolve => {
        processHandle.once('error', error => {
          finished = true; clearTimeout(timer); stderr += error.message;
          readyReject(new Error('Fixture entrypoint could not start'));
          resolve({ code: null, signal: null, stdout, stderr });
        });
        processHandle.once('exit', (code, signal) => {
          finished = true; clearTimeout(timer); readyReject(new Error('Fixture entrypoint exited before readiness'));
          resolve({ code, signal, stdout, stderr });
        });
      });
      const handle = { ready: readyPromise, done, output: () => ({ stdout, stderr }), intervals: () => intervalEvents.slice(),
        async stop() {
          if (!finished) {
            const kill = setTimeout(() => processHandle.kill('SIGKILL'), 3000);
            processHandle.kill('SIGTERM'); await done; clearTimeout(kill);
          }
          entryChildren.delete(handle);
          return done;
        } };
      entryChildren.add(handle);
      done.then(() => entryChildren.delete(handle));
      return handle;
    };
    return { ...ready, secret, root, cleanup, launchActual,
      query(sql, values = []) {
        const id = ++sequence;
        return new Promise((resolve, reject) => {
          const onMessage = message => {
            if (message.id !== id) return;
            clearTimeout(timer); child.off('message', onMessage);
            message.error ? reject(new Error(message.error)) : resolve(message.rows);
          };
          const timer = setTimeout(() => { child.off('message', onMessage); reject(new Error('Fixture query timeout')); }, 20000);
          child.on('message', onMessage);
          child.send({ id, sql, values });
        });
      },
    };
  } catch (error) { await cleanup(); throw error; }
}

async function fixtureChild() {
  // Deny external fetch even when a route accidentally attempts an integration.
  globalThis.fetch = async () => { throw new Error('External fetch disabled in local fixture'); };
  const guard = { root: process.env.RENDER2_FIXTURE_ROOT, cwd: process.cwd(),
    port: process.env.RENDER2_FIXTURE_PORT, url: process.env.DATABASE_URL };
  assertFixtureIdentity(guard);
  if (process.env.RENDER_DISABLE_SERVER_START !== 'true' || process.env.DOTENV_CONFIG_PATH !== '/dev/null')
    throw new Error('Unsafe startup environment');
  const { pool } = await import('../src/db.js');
  const checked = await pool.query(`SELECT current_database() AS database, current_user AS username,
    host(inet_server_addr()) AS address, inet_server_port() AS port, current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ ...guard, identity: checked.rows[0] });
  const tables = await pool.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public'");
  if (tables.rows[0].count !== 0) throw new Error('Fixture database is not brand new');
  const { runMigrations, readMigrationIdentity, readMigrationStatus, buildMigrationPlan } = await import('../src/migrations.js');
  // Upgrade-invariance test only: leave the real 048 trigger installed until
  // the test snapshots populated rows and applies the actual forward SQL.
  // No migration ledger entry is forged; all other baseline files run normally.
  const deferredMigrations = [
    ...(['RENDER2_DEFER_PROJECT_DELIVERABLE_APPROVAL_MIGRATION','RENDER2_DEFER_PROJECTS_MIGRATION',
      'RENDER2_DEFER_PRODUCTION_REGISTRY_MIGRATION','RENDER2_DEFER_GOAL_MIGRATION',
      'RENDER2_DEFER_TASK_STATE_MIGRATION','RENDER2_DEFER_PRODUCTION_EDITORIAL_MIGRATION']
      .some(key => process.env[key] === 'true') ? ['079_project_deliverable_approvals.sql'] : []),
    ...(['RENDER2_DEFER_PRODUCTION_REGISTRY_MIGRATION','RENDER2_DEFER_PRODUCTION_EDITORIAL_MIGRATION',
      'RENDER2_DEFER_PRODUCTION_HISTORY_BATCH_MIGRATION'].some(key => process.env[key] === 'true')
      ? ['078_production_history_batches.sql'] : []),
    ...(['RENDER2_DEFER_GOAL_MIGRATION','RENDER2_DEFER_GOAL_QUOTA_REVIEW_MIGRATION']
      .some(key => process.env[key] === 'true') ? ['077_goal_quota_reviews.sql'] : []),
    ...(process.env.RENDER2_DEFER_TASK_BOARD_ORDER_MIGRATION === 'true' ? ['076_task_board_order.sql'] : []),
    // Creation receipts reference the registry; preserve older populated
    // upgrade fixtures by deferring this dependent forward migration too.
    ...(['RENDER2_DEFER_PRODUCTION_REGISTRY_MIGRATION','RENDER2_DEFER_PRODUCTION_CREATE_RECEIPTS_MIGRATION']
      .some(key => process.env[key] === 'true') ? ['075_production_create_receipts.sql'] : []),
    ...(process.env.RENDER2_DEFER_USER_ADMIN_MIGRATION === 'true' ? ['074_user_administration_versions.sql'] : []),
    ...(process.env.RENDER2_DEFER_PRODUCTION_REGISTRY_MIGRATION === 'true' ? ['069_production_reconciliation.sql', '070_production_editing_adoptions.sql'] : []),
    ...(['RENDER2_DEFER_EDITING_REVIEWS_MIGRATION', 'RENDER2_DEFER_EDITING_DELIVERIES_MIGRATION']
      .some(key => process.env[key] === 'true') ? ['068_task_editing_reviews.sql'] : []),
    ...(process.env.RENDER2_DEFER_LOGIN_ABUSE_MIGRATION === 'true' ? ['067_auth_login_buckets.sql'] : []),
    ...(process.env.RENDER2_DEFER_EDITING_APPROVAL_MIGRATION === 'true' ? ['066_task_editing_approval.sql'] : []),
    ...(process.env.RENDER2_DEFER_EDITING_DELIVERIES_MIGRATION === 'true' ? ['065_task_editing_deliveries.sql'] : []),
    ...(process.env.RENDER2_DEFER_EDITORIAL_CONFIRMATION_MIGRATION === 'true' ? ['064_editorial_publication_confirmation.sql'] : []),
    // 085 validates the clock installed by061; historical upgrade fixtures must
    // defer both, then explicitly apply them in dependency order.
    ...(process.env.RENDER2_DEFER_FEEDBACK_RECEIPTS_MIGRATION === 'true' ? ['061_feedback_operation_receipts.sql', '085_feedback_browser_operations.sql'] : []),
    ...(process.env.RENDER2_DEFER_TASK_RECEIPTS_MIGRATION === 'true' ? ['062_task_operation_receipts.sql'] : []),
    // 063's reciprocal guards depend on the actual 060 relationship columns.
    // Older populated-upgrade fixtures must defer the dependent SQL as well.
    ...(['RENDER2_DEFER_PROJECTS_MIGRATION','RENDER2_DEFER_PRODUCTION_REGISTRY_MIGRATION',
      'RENDER2_DEFER_GOAL_MIGRATION','RENDER2_DEFER_TASK_STATE_MIGRATION','RENDER2_DEFER_PRODUCTION_EDITORIAL_MIGRATION']
      .some(key => process.env[key] === 'true') ? ['063_projects.sql'] : []),
    ...(process.env.RENDER2_DEFER_GOAL_MIGRATION === 'true' ? ['055_decouple_goal_publication.sql'] : []),
    ...(process.env.RENDER2_DEFER_ASSIGNMENT_MIGRATION === 'true' ? ['056_task_assignments.sql'] : []),
    ...(process.env.RENDER2_DEFER_TASK_STATE_MIGRATION === 'true' || process.env.RENDER2_DEFER_GOAL_MIGRATION === 'true'
      ? ['058_task_work_states.sql'] : []),
    ...(process.env.RENDER2_DEFER_PRODUCTION_REGISTRY_MIGRATION === 'true' ? ['059_production_registry.sql'] : []),
    ...(process.env.RENDER2_DEFER_PRODUCTION_REGISTRY_MIGRATION === 'true' || process.env.RENDER2_DEFER_GOAL_MIGRATION === 'true' || process.env.RENDER2_DEFER_TASK_STATE_MIGRATION === 'true' || process.env.RENDER2_DEFER_PRODUCTION_EDITORIAL_MIGRATION === 'true' ? ['060_production_editorial_links.sql'] : []),
  ];
  const identity = await readMigrationIdentity(pool);
  const status = await readMigrationStatus(pool, { deferredMigrations });
  const planHash = buildMigrationPlan({ environment: 'test', identity, status });
  await runMigrations(pool, console, { deferredMigrations, approval: { environment: 'test', expectedIdentity: identity,
    planHash, purpose: 'isolated-fixture', fixtureRoot: guard.root } });
  const { rows } = await pool.query("SELECT activo, session_version FROM usuarios LIMIT 0");
  void rows; // Missing 054 must fail before accepting HTTP requests; never patch schema here.
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(fixturePassword, 4);
  for (const account of fixtureAccounts) {
    await pool.query(`INSERT INTO usuarios (id,usuario,nombre,rol,password_hash,activo,session_version,google_id,google_email)
      VALUES ($1,$2,$3,$4,$5,true,1,NULL,NULL)`,
    [account.id, account.usuario, account.nombre, account.rol, hash]);
  }
  await pool.query("SELECT setval(pg_get_serial_sequence('usuarios','id'),(SELECT max(id) FROM usuarios))");
  let server;
  if (process.env.RENDER2_FIXTURE_CLUSTER_ONLY !== 'true') {
    const { app } = await import('../src/server.js');
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
  }
  process.on('message', async ({ id, sql, values }) => {
    try { const result = await pool.query(sql, values); process.send({ id, rows: result.rows }); }
    catch (error) { process.send({ id, error: error.message }); }
  });
  const shutdown = async () => {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await pool.end(); process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('disconnect', shutdown);
  process.send({ base: server ? `http://127.0.0.1:${server.address().port}` : null });
}

if (process.argv[1] === self) {
  if (process.argv[2] === '--entry-child') {
    globalThis.fetch = async () => { throw new Error('External fetch disabled in local entrypoint fixture'); };
    if (process.cwd() !== process.env.RENDER2_FIXTURE_ROOT
      || !/^\/private\/tmp\/render2-local-[A-Za-z0-9]+$/.test(process.cwd())
      || process.env.DOTENV_CONFIG_PATH !== '/dev/null') throw new Error('Unsafe fixture entrypoint');
    const entry = process.env.RENDER2_FIXTURE_ENTRY;
    if (!['server', 'migrate'].includes(entry)) throw new Error('Unknown fixture entrypoint');
    // Observe, never suppress, actual interval registration. All four principal
    // background services register setInterval; SQL guards cover first ticks.
    const actualSetInterval = globalThis.setInterval;
    globalThis.setInterval = (callback, delay, ...args) => {
      process.send?.({ type: 'render-fixture-interval', delay: typeof delay === 'number' ? delay : null });
      return actualSetInterval(callback, delay, ...args);
    };
    process.argv = [process.argv[0], fileURLToPath(new URL(entry === 'server' ? '../src/server.js' : './migrate.js', import.meta.url)), ...process.argv.slice(3)];
    await import(entry === 'server' ? '../src/server.js' : './migrate.js');
  } else if (process.argv[2] === '--fixture-child') {
    fixtureChild().catch(error => { process.send?.({ error: error.message }); process.exit(1); });
  } else {
    const fixture = await startLocalHarness();
    console.log(`Local principal HTTP QA: ${fixture.base}; fixture ${fixture.root}; expires in 10 minutes`);
    const finish = async () => { await fixture.cleanup(); process.exit(0); };
    process.once('SIGINT', finish); process.once('SIGTERM', finish);
    setTimeout(finish, 600000);
  }
}
