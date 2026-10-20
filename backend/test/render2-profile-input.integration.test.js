import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

// Actual principal HTTP, synthetic credentials and generated disposable PG only.
// Ordinary discovery neither connects to PostgreSQL nor opens any listener.
test('self-profile input contracts preserve legacy verification and enforce new credential policy', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55706 }), clients = new Set();
  t.after(async () => {
    for (const client of clients) { await client.query('ROLLBACK').catch(() => {}); await client.end(); }
    await fixture.cleanup(); await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic('Own profile-input fixture and barrier clients stopped and removed.');
  });
  const url = 'postgresql://render2_fixture@127.0.0.1:55706/render2_local_test';
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port: 55706, url, identity });
  const api = (route, options) => request(fixture.base, `/api${route}`, options);
  // No request credential, response token or raw account row enters diagnostics.
  const checked = (result, status = 200) => { assert.equal(result.status, status, 'Expected HTTP status'); return result.body; };
  const login = async (usuario, password = fixturePassword) => {
    const body = checked(await api('/login', { method: 'POST', body: { usuario, password } }));
    assert.equal(typeof body.token, 'string'); return { token: body.token, id: body.usuario.id };
  };
  const patch = (route, token, body) => api(`/usuarios/${route}`, { token, method: 'PATCH', body });
  const noSecrets = body => {
    for (const key of ['password', 'password_hash', 'password_actual', 'password_nueva', 'token', 'session_version', 'user_admin_version'])
      assert.equal(Object.hasOwn(body, key), false, `Forbidden profile response field: ${key}`);
  };
  const snapshot = async () => ({
    users: await fixture.query('SELECT id,md5(to_jsonb(u)::text) AS fingerprint FROM usuarios u ORDER BY id'),
    tasks: await fixture.query('SELECT id,md5(to_jsonb(t)::text) AS fingerprint FROM tareas t ORDER BY id'),
    assignments: await fixture.query('SELECT tarea_id,usuario_id,md5(to_jsonb(a)::text) AS fingerprint FROM tarea_asignaciones a ORDER BY tarea_id,usuario_id'),
    comments: await fixture.query('SELECT id,md5(to_jsonb(c)::text) AS fingerprint FROM tarea_comentarios c ORDER BY id'),
    lists: await fixture.query('SELECT id,md5(to_jsonb(l)::text) AS fingerprint FROM listas_personales l ORDER BY id'),
    blocks: await fixture.query('SELECT id,md5(to_jsonb(b)::text) AS fingerprint FROM lista_bloques b ORDER BY id'),
  });
  const unchanged = async (operation, status, code) => {
    const before = await snapshot(), body = checked(await operation(), status); noSecrets(body);
    if (code) assert.equal(body.code, code);
    assert.deepEqual(await snapshot(), before); return body;
  };
  const preservedOthers = async (before, id) => {
    const after = await snapshot();
    assert.deepEqual(after.users.filter(row => row.id !== id), before.users.filter(row => row.id !== id));
    for (const key of ['tasks', 'assignments', 'comments', 'lists', 'blocks']) assert.deepEqual(after[key], before[key]);
  };
  const owner = await login('qa_franco');
  let password = fixturePassword, session = await login('qa_luciano');
  const second = await login('qa_luciano');
  const task = checked(await api('/tareas', { token: owner.token, method: 'POST', body: {
    titulo: 'QA87 retained profile history', asignado_a_id: 91003, tipo_tarea: 'edicion', workspace: 'render_os',
  } }), 201);
  await fixture.query('INSERT INTO tarea_comentarios(tarea_id,autor,contenido) VALUES($1,$2,$3)', [task.id, 'Luciano QA', 'Synthetic preserved profile history']);

  const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
  const inputs = {
    foto: { usuario: 'qa_luciano', foto_perfil: photo },
    perfil: { usuario_actual: 'qa_luciano', password_actual: fixturePassword, usuario_nuevo: 'qa_profile87_new' },
    password: { usuario: 'qa_luciano', password_actual: fixturePassword, password_nueva: 'Synthetic-new-password87!' },
  };
  for (const route of ['foto', 'perfil', 'password']) await t.test(`${route}: closed required typed fields reject without any persisted change`, async () => {
    const body = inputs[route], invalid = [[], {}, { ...body, unexpected: true }];
    // JSON null is rejected by the shared strict parser before a route DTO
    // exists; its safe generic 400 is intentionally not a PROFILE_INPUT code.
    await unchanged(() => patch(route, session.token, null), 400);
    for (const key of Object.keys(body)) {
      const missing = { ...body }; delete missing[key]; invalid.push(missing);
      for (const value of [[], {}, false, 87]) invalid.push({ ...body, [key]: value });
      if (key !== 'foto_perfil') invalid.push({ ...body, [key]: null });
    }
    const userField = route === 'perfil' ? 'usuario_actual' : 'usuario';
    invalid.push({ ...body, [userField]: 'x'.repeat(16385) });
    if (route !== 'foto') invalid.push({ ...body, password_actual: '😀'.repeat(257) });
    if (route === 'perfil') invalid.push(...['', ' ', 'x'.repeat(129), '😀'.repeat(81), 'bad\nname'].map(usuario_nuevo => ({ ...body, usuario_nuevo })));
    for (const value of invalid) await unchanged(() => patch(route, session.token, value), 400, 'PROFILE_INPUT_INVALID');
    await unchanged(() => patch(route, session.token, { ...body, [userField]: 'qa_franco' }), 403);
    await unchanged(() => patch(route, session.token, { ...body, [userField]: 'name\u0000invalid' }), 403);
    await unchanged(() => patch(route, undefined, body), 401);
  });

  await t.test('new password 11 points, over 72 bytes, NUL, spaces and unpaired Unicode are policy errors, never writes', async () => {
    for (const candidate of ['x'.repeat(11), '😀'.repeat(11), 'x'.repeat(73), '😀'.repeat(19), ' '.repeat(12), 'valid-length\u0000suffix', 'valid-length\ud800suffix']) {
      await unchanged(() => patch('password', session.token, { ...inputs.password, password_nueva: candidate }), 400, 'NEW_PASSWORD_INVALID');
    }
  });

  await t.test('legacy current-password boundary is accepted as verification, while wrong password remains explicit 401', async () => {
    for (const route of ['perfil', 'password']) {
      for (const current of ['wrong', 'x'.repeat(1024), '😀'.repeat(256)]) {
        await unchanged(() => patch(route, session.token, { ...inputs[route], password_actual: current }), 401, 'current_password_invalid');
      }
    }
  });

  await t.test('photo update and explicit null/empty clearing keep ID and existing sessions usable', async () => {
    const before = await snapshot();
    const [epoch] = await fixture.query('SELECT session_version FROM usuarios WHERE id=91003');
    for (const value of [photo, null, photo, '']) {
      const result = checked(await patch('foto', session.token, { usuario: 'qa_luciano', foto_perfil: value }));
      noSecrets(result); assert.equal(result.id, 91003); assert.equal(result.foto_perfil, value || null);
      assert.deepEqual(await fixture.query('SELECT foto_perfil,session_version FROM usuarios WHERE id=91003'),
        [{ foto_perfil: value || null, session_version: epoch.session_version }]);
      checked(await api('/inicio', { token: session.token })); checked(await api('/inicio', { token: second.token }));
    }
    await preservedOthers(before, 91003);
  });

  await t.test('exact valid new password boundaries rotate credentials, revoke old sessions and retain identity/history', async () => {
    for (const candidate of ['x'.repeat(12), '😀'.repeat(12), 'y'.repeat(72), '😀'.repeat(18), '  unicode-87!  ']) {
      const before = await snapshot(), old = session.token;
      const [epoch] = await fixture.query('SELECT session_version FROM usuarios WHERE id=91003');
      const result = checked(await patch('password', old, { usuario: 'qa_luciano', password_actual: password, password_nueva: candidate }));
      noSecrets(result); assert.equal(result.ok, true);
      assert.equal((await fixture.query('SELECT session_version FROM usuarios WHERE id=91003'))[0].session_version, epoch.session_version + 1);
      checked(await api('/inicio', { token: old }), 401); checked(await api('/inicio', { token: second.token }), 401);
      checked(await api('/login', { method: 'POST', body: { usuario: 'qa_luciano', password } }), 401);
      session = await login('qa_luciano', candidate); password = candidate; assert.equal(session.id, 91003);
      if (candidate !== candidate.trim()) checked(await api('/login', { method: 'POST', body: { usuario: 'qa_luciano', password: candidate.trim() } }), 401);
      await preservedOthers(before, 91003);
    }
  });

  await t.test('Unicode username is trimmed with stable ID; legacy short existing credential can rotate to policy password', async () => {
    const short = 'qa7', id = 98701;
    // Fixture-only legacy hash deliberately bypasses NEW-account policy. This
    // proves old credentials remain verifiable, not permission to create them.
    await fixture.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      VALUES($1,'qa_profile87_legacy','QA87 legacy short account','edicion',$2,true,1)`, [id, await bcrypt.hash(short, 4)]);
    const old = await login('qa_profile87_legacy', short), oldSecond = await login('qa_profile87_legacy', short);
    const before = await snapshot(), renamed = `${'á'.repeat(127)}😀`;
    assert.equal([...renamed].length, 128); assert.ok(Buffer.byteLength(renamed, 'utf8') <= 320);
    const result = checked(await patch('perfil', old.token, { usuario_actual: 'qa_profile87_legacy', password_actual: short, usuario_nuevo: ` ${renamed} ` }));
    noSecrets(result); assert.equal(result.id, id); assert.equal(result.usuario, renamed);
    for (const token of [old.token, oldSecond.token]) checked(await api('/inicio', { token }), 401);
    const current = await login(renamed, short), next = 'Synthetic-valid-legacy-rotation87!';
    const changed = checked(await patch('password', current.token, { usuario: renamed, password_actual: short, password_nueva: next }));
    noSecrets(changed); assert.equal(changed.ok, true);
    checked(await api('/inicio', { token: current.token }), 401);
    checked(await api('/login', { method: 'POST', body: { usuario: renamed, password: short } }), 401);
    assert.equal((await login(renamed, next)).id, id); await preservedOthers(before, id);
  });

  await t.test('two credential changes from same observed epoch have one winner and one CAS-revoked response', async () => {
    const holder = new pg.Client({ connectionString: url, statement_timeout: 15000 });
    const observer = new pg.Client({ connectionString: url, statement_timeout: 15000 });
    clients.add(holder); clients.add(observer); await holder.connect(); await observer.connect();
    const before = await snapshot(), pending = [], candidates = ['Synthetic-race-A-password87!', 'Synthetic-race-B-password87!'];
    const [epoch] = await fixture.query('SELECT session_version FROM usuarios WHERE id=91003');
    try {
      await holder.query('BEGIN'); await holder.query('SELECT id FROM usuarios WHERE id=91003 FOR UPDATE');
      const holderPid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      for (const candidate of candidates) {
        const promise = fetch(new URL('/api/usuarios/password', fixture.base), { method: 'PATCH',
          signal: AbortSignal.timeout(15000), headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ usuario: 'qa_luciano', password_actual: password, password_nueva: candidate })
        }).then(async response => ({ status: response.status, body: await response.json() }));
        void promise.catch(() => {}); pending.push(promise);
      }
      let blocked = false; const deadline = Date.now() + 3500;
      while (Date.now() < deadline) {
        const result = await observer.query(`SELECT count(DISTINCT a.pid)::int AS count FROM pg_stat_activity a
          JOIN pg_locks l ON l.pid=a.pid WHERE a.pid<>$1::int AND a.wait_event_type='Lock'
          AND a.query LIKE 'UPDATE usuarios%' AND l.relation='usuarios'::regclass
          AND cardinality(pg_blocking_pids(a.pid))>0`, [holderPid]);
        if (result.rows[0].count === 2) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 15));
      }
      assert.ok(blocked, 'Both actual password UPDATEs must reach DB locks after verifying the same old epoch/password');
      await holder.query('COMMIT'); const results = await Promise.all(pending);
      assert.deepEqual(results.map(result => result.status).sort((a, b) => a - b), [200, 401]);
      results.forEach(result => noSecrets(result.body));
      const winner = results.findIndex(result => result.status === 200); assert.equal(results[winner].body.ok, true);
      assert.equal((await fixture.query('SELECT session_version FROM usuarios WHERE id=91003'))[0].session_version, epoch.session_version + 1);
      checked(await api('/inicio', { token: session.token }), 401);
      assert.equal((await login('qa_luciano', candidates[winner])).id, 91003);
      checked(await api('/login', { method: 'POST', body: { usuario: 'qa_luciano', password: candidates[1 - winner] } }), 401);
      await preservedOthers(before, 91003);
    } finally {
      await holder.query('ROLLBACK').catch(() => {}); await Promise.allSettled(pending);
      await observer.end(); clients.delete(observer); await holder.end(); clients.delete(holder);
    }
  });
});
