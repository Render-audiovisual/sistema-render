import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startLocalHarness, cleanEnvironment, assertFixtureIdentity, fixturePassword } from '../../scripts/render2-local-test.js';

export const OWNER_PROFILE_QA_MAPPING = Object.freeze({ accountId: 91001, francoUserId: 91005, agustinUserId: 91006 });
export const OWNER_PROFILE_QA_ORIGIN = 'http://127.0.0.1:52922';
const self = fileURLToPath(import.meta.url);
const proof = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

export async function ownerProfileHttp(base, route, { session, method = 'GET', body, headers = {} } = {}) {
  const target = new URL(route, base);
  assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.protocol, 'http:');
  assert.ok(target.pathname.startsWith('/api/')); assert.equal(target.origin, new URL(base).origin);
  const response = await fetch(target, { method, redirect: 'error', signal: AbortSignal.timeout(7000),
    headers: { origin: OWNER_PROFILE_QA_ORIGIN, 'sec-fetch-site': 'same-origin',
      ...(session ? { cookie: session.cookie, 'x-render-session-context': session.context, 'x-render-csrf': session.csrf } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text(); let data;
  try { data = text ? JSON.parse(text) : null; } catch { throw Error('Owner-profile QA expected actual JSON response.'); }
  return { status: response.status, body: data, cookie: response.headers.get('set-cookie'),
    context: response.headers.get('x-render-session-context'), cache: response.headers.get('cache-control') };
}
export function ownerSessionFromResponse(response) {
  assert.equal(response.status, 200, 'Expected successful browser-session issuance');
  assert.ok(typeof response.cookie === 'string' && response.cookie.startsWith('render_dev_session='));
  assert.ok(proof(response.body?.session_context) && proof(response.body?.csrf_token));
  assert.equal(response.context, response.body.session_context);
  assert.equal(response.cache, 'no-store');
  return { cookie: response.cookie.split(';')[0], context: response.body.session_context, csrf: response.body.csrf_token,
    user: response.body.usuario, ownerProfiles: response.body.owner_profiles };
}
export async function loginOwnerFixture(base, usuario = 'qa_franco') {
  const challenge = await ownerProfileHttp(base, '/api/sesion/desafio');
  assert.equal(challenge.status, 200); assert.ok(proof(challenge.body?.csrf_token));
  const response = await ownerProfileHttp(base, '/api/login/browser', { method: 'POST',
    body: { usuario, password: fixturePassword }, headers: { cookie: challenge.cookie.split(';')[0], 'x-render-csrf': challenge.body.csrf_token } });
  return ownerSessionFromResponse(response);
}

// Fresh generated cluster only. No shared harness changes, production config,
// previously restored copies, old52920 runtime, providers or password intake.
export async function startOwnerProfilesFixture({ httpPort = 0, pgPort = 55991, frontendReady = false } = {}) {
  if (![0, 52922].includes(httpPort) || ![55991,55630].includes(pgPort) || (httpPort === 52922 && (frontendReady !== true || pgPort !== 55991))) throw Error('Owner fixture needs explicit local build readiness.');
  const f = await startLocalHarness({ port: pgPort, clusterOnly: true });
  const children = new Set(); let closed = false;
  const cleanup = async () => {
    if (closed) return; closed = true;
    for (const app of [...children]) await app.stop();
    await f.cleanup(); await assert.rejects(access(f.root), { code: 'ENOENT' });
  };
  try {
    assertFixtureIdentity({ root: f.root, cwd: f.root, port: pgPort,
      url: `postgresql://render2_fixture@127.0.0.1:${pgPort}/render2_local_test`,
      identity: (await f.query(`SELECT current_database() AS database,current_user AS username,host(inet_server_addr()) AS address,
        inet_server_port() AS port,current_setting('data_directory') AS directory`))[0] });
    await f.query("UPDATE usuarios SET nombre='Cuenta Render' WHERE id=91001");
    for (const [id, name] of [[91005, 'Franco'], [91006, 'Agustín']]) {
      await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version,google_id,google_email)
        VALUES($1,$2,$3,'admin',$4,true,1,NULL,NULL)`, [id, `qa_internal_owner_${id}`, name, `!QA_INTERNAL_NONLOGIN_${randomBytes(32).toString('hex')}`]);
    }
    const tasks = {};
    for (const [key, owner] of [['leader', 91001], ['franco', 91005], ['agustin', 91006], ['otherAdmin', 91002], ['employee', 91003]]) {
      const [task] = await f.query(`INSERT INTO tareas(titulo,asignado_a,tipo_tarea,estado,prioridad,fecha_vencimiento,propiedades_extra)
        VALUES($1,'QA shared display label','diseno','pendiente','media',CURRENT_DATE,
          '{"workspace":"render_os","qa_owner_profiles_local":true}') RETURNING id`, [`QA LOCAL ONLY: ${key} own task`]);
      await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,$2,'responsable')", [task.id, owner]);
      tasks[key] = task.id;
    }
    const startApp = async ({ mapping = OWNER_PROFILE_QA_MAPPING, port = 0 } = {}) => {
      if (closed || ![0, 52922].includes(port)) throw Error('Owner fixture is not available.');
      const child = fork(self, ['--owner-app-child'], { cwd: f.root, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: {
        ...cleanEnvironment(), DATABASE_URL: `postgresql://render2_fixture@127.0.0.1:${pgPort}/render2_local_test`, JWT_SECRET: f.secret,
        RENDER_DB_ENVIRONMENT: 'test', RENDER_BACKGROUND_JOBS: '', RENDER_ALLOW_BACKGROUND_WRITES: 'false', SETUP_DEMO_DATA: 'false',
        MIA_SUPERVISOR_ENABLED: 'false', TASK_COMPLETED_CLEANUP_ENABLED: 'false',
        RENDER_BROWSER_SESSIONS: 'true', RENDER_BROWSER_ALLOW_LOCAL_HTTP: 'true', RENDER_BROWSER_ORIGIN: OWNER_PROFILE_QA_ORIGIN,
        RENDER_OWNER_PROFILES: mapping === null ? '' : JSON.stringify(mapping),
        RENDER2_OWNER_FIXTURE_ROOT: f.root, RENDER2_OWNER_PG_PORT: String(pgPort), RENDER2_OWNER_HTTP_PORT: String(port),
      } });
      // Drain output without exposing config, tokens or SQL diagnostic payloads.
      child.stdout.resume(); child.stderr.resume();
      let stopped = false;
      const app = { child, async stop() {
        if (stopped) return; stopped = true;
        if (child.exitCode === null && child.signalCode === null) {
          const exit = once(child, 'exit'); child.kill('SIGTERM');
          const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 4000);
          try { await exit; } finally { clearTimeout(timer); }
        }
        children.delete(app);
      } };
      children.add(app);
      try {
        const ready = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(Error('Owner fixture app readiness timeout.')), 15000);
          const message = value => {
            if (value?.type === 'owner-profile-qa-ready') { clearTimeout(timer); child.off('message', message); resolve(value); }
            if (value?.type === 'owner-profile-qa-failed') { clearTimeout(timer); child.off('message', message); reject(Error('Owner fixture app startup rejected.')); }
          };
          child.on('message', message); child.once('error', () => { clearTimeout(timer); reject(Error('Owner fixture child failed.')); });
          child.once('exit', () => { clearTimeout(timer); reject(Error('Owner fixture child exited before readiness.')); });
        });
        assert.ok(Number.isInteger(ready.port) && ready.port > 0);
        return Object.assign(app, { base: `http://127.0.0.1:${ready.port}` });
      } catch (error) { await app.stop(); throw error; }
    };
    const app = await startApp({ port: httpPort });
    return { ...f, base: app.base, tasks: Object.freeze(tasks), cleanup, startApp };
  } catch (error) { await cleanup(); throw error; }
}

async function childMain() {
  const root = process.env.RENDER2_OWNER_FIXTURE_ROOT, port = Number(process.env.RENDER2_OWNER_PG_PORT);
  assertFixtureIdentity({ root, cwd: process.cwd(), port, url: process.env.DATABASE_URL });
  assert.ok([55991,55630].includes(port)); assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.RENDER_DB_ENVIRONMENT, 'test'); assert.equal(process.env.DOTENV_CONFIG_PATH, '/dev/null');
  assert.equal(process.env.RENDER_DISABLE_SERVER_START, 'true');
  const { pool } = await import('../../src/db.js');
  const { app } = await import('../../src/server.js');
  const server = app.listen(Number(process.env.RENDER2_OWNER_HTTP_PORT), '127.0.0.1'); await once(server, 'listening');
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await pool.end(); process.exit(0);
  };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  process.send?.({ type: 'owner-profile-qa-ready', port: server.address().port });
}
if (process.argv[2] === '--owner-app-child') childMain().catch(() => { process.send?.({ type: 'owner-profile-qa-failed' }); process.exitCode = 1; });
if (process.argv[2] === '--interactive') {
  if (process.argv.length !== 4 || process.argv[3] !== '--frontend-ready') throw Error('Wait for frontend final build before interactive owner QA.');
  const fixture = await startOwnerProfilesFixture({ httpPort: 52922, frontendReady: true });
  const stop = async () => { await fixture.cleanup(); process.exit(0); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  console.log(JSON.stringify({ event: 'SYNTHETIC_LOCAL_OWNER_PROFILE_QA', base: fixture.base, pgPort: 55991,
    loginUsuario: 'qa_franco', password: fixturePassword, rootName: 'Cuenta Render', principalId: 91001,
    profiles: { franco: 91005, agustin: 91006 }, tasks: fixture.tasks, root: fixture.root,
    production: false, previous52920Untouched: true }));
}
