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

export async function startLocalHarness({ port = 55594, deferGoalMigration = false, deferAssignmentMigration = false, deferTaskStateMigration = false, deferProductionRegistryMigration = false, deferProductionEditorialMigration = false, deferFeedbackReceiptsMigration = false, supervisorEnabled = false, wilson = {} } = {}) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
  if (typeof supervisorEnabled !== 'boolean') throw new Error('Invalid supervisor fixture option');
  const wilsonEnv = fixtureWilsonEnvironment(wilson);
  const root = await mkdtemp('/private/tmp/render2-local-');
  const data = `${root}/data`;
  const env = cleanEnvironment();
  const command = (name, args) => execFileSync(`/opt/homebrew/bin/${name}`, args,
    { env, cwd: root, timeout: 35000, stdio: 'pipe' });
  let child;
  let startAttempted = false;
  let closed = false;
  const cleanup = async () => {
    if (closed) return;
    closed = true;
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
        RENDER2_FIXTURE_PORT: String(port), RENDER2_DEFER_GOAL_MIGRATION: String(deferGoalMigration),
        RENDER2_DEFER_ASSIGNMENT_MIGRATION: String(deferAssignmentMigration),
        RENDER2_DEFER_TASK_STATE_MIGRATION: String(deferTaskStateMigration),
        RENDER2_DEFER_PRODUCTION_REGISTRY_MIGRATION: String(deferProductionRegistryMigration),
        RENDER2_DEFER_PRODUCTION_EDITORIAL_MIGRATION: String(deferProductionEditorialMigration),
        RENDER2_DEFER_FEEDBACK_RECEIPTS_MIGRATION: String(deferFeedbackReceiptsMigration),
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
    return { ...ready, secret, root, cleanup,
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
  const { runMigrations } = await import('../src/migrations.js');
  // Upgrade-invariance test only: leave the real 048 trigger installed until
  // the test snapshots populated rows and applies the actual forward SQL.
  // No migration ledger entry is forged; all other baseline files run normally.
  const deferredMigrations = [
    ...(process.env.RENDER2_DEFER_FEEDBACK_RECEIPTS_MIGRATION === 'true' ? ['061_feedback_operation_receipts.sql'] : []),
    ...(process.env.RENDER2_DEFER_GOAL_MIGRATION === 'true' ? ['055_decouple_goal_publication.sql'] : []),
    ...(process.env.RENDER2_DEFER_ASSIGNMENT_MIGRATION === 'true' ? ['056_task_assignments.sql'] : []),
    ...(process.env.RENDER2_DEFER_TASK_STATE_MIGRATION === 'true' || process.env.RENDER2_DEFER_GOAL_MIGRATION === 'true'
      ? ['058_task_work_states.sql'] : []),
    ...(process.env.RENDER2_DEFER_PRODUCTION_REGISTRY_MIGRATION === 'true' ? ['059_production_registry.sql'] : []),
    ...(process.env.RENDER2_DEFER_PRODUCTION_REGISTRY_MIGRATION === 'true' || process.env.RENDER2_DEFER_GOAL_MIGRATION === 'true' || process.env.RENDER2_DEFER_TASK_STATE_MIGRATION === 'true' || process.env.RENDER2_DEFER_PRODUCTION_EDITORIAL_MIGRATION === 'true' ? ['060_production_editorial_links.sql'] : []),
  ];
  const migrationPool = deferredMigrations.length ? {
    connect: () => pool.connect(),
    async query(sql, ...args) {
      const result = await pool.query(sql, ...args);
      if (sql === 'SELECT nombre FROM _migrations') return { ...result,
        rows: [...result.rows, ...deferredMigrations.map(nombre => ({ nombre }))] };
      return result;
    },
  } : pool;
  await runMigrations(migrationPool);
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
  const { app } = await import('../src/server.js');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  process.on('message', async ({ id, sql, values }) => {
    try { const result = await pool.query(sql, values); process.send({ id, rows: result.rows }); }
    catch (error) { process.send({ id, error: error.message }); }
  });
  const shutdown = () => { server.closeAllConnections(); server.close(async () => { await pool.end(); process.exit(0); }); };
  process.once('SIGTERM', shutdown);
  process.once('disconnect', shutdown);
  process.send({ base: `http://127.0.0.1:${server.address().port}` });
}

if (process.argv[1] === self) {
  if (process.argv[2] === '--fixture-child') {
    fixtureChild().catch(error => { process.send?.({ error: error.message }); process.exit(1); });
  } else {
    const fixture = await startLocalHarness();
    console.log(`Local principal HTTP QA: ${fixture.base}; fixture ${fixture.root}; expires in 10 minutes`);
    const finish = async () => { await fixture.cleanup(); process.exit(0); };
    process.once('SIGINT', finish); process.once('SIGTERM', finish);
    setTimeout(finish, 600000);
  }
}
