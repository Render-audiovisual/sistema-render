import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

test('self-profile HTTP preserves ID and enforces current session CAS without cross-account writes', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55670 });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own profile-session fixture stopped and removed: ${fixture.root}`);
  });
  const url = 'postgresql://render2_fixture@127.0.0.1:55670/render2_local_test';
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port: 55670, url, identity });
  const api = (route, options) => request(fixture.base, `/api${route}`, options);
  // Never include response bodies, tokens, password hashes or request credentials in assertion diagnostics.
  const checked = (response, status = 200) => { assert.equal(response.status, status, 'HTTP status'); return response.body; };
  const login = async (usuario, password = fixturePassword) => {
    const body = checked(await api('/login', { method: 'POST', body: { usuario, password } }));
    assert.equal(body.usuario.id, 91003); assert.equal(typeof body.token, 'string'); return body.token;
  };
  const patch = (route, token, body) => api(`/usuarios/${route}`, { token, method: 'PATCH', body });
  const fingerprint = async () => fixture.query(`SELECT id,md5(to_jsonb(u)::text) AS fingerprint FROM usuarios u ORDER BY id`);
  const noWrite = async (operation, status) => {
    const before = await fingerprint(); const body=checked(await operation(), status); assert.deepEqual(await fingerprint(), before);return body;
  };
  const noSecrets = body => {
    for (const key of ['token', 'password', 'password_hash', 'password_actual', 'password_nueva'])
      assert.equal(Object.hasOwn(body, key), false, `No ${key} in self-profile response`);
  };
  let name = 'qa_luciano', token = await login(name), second = await login(name);
  assert.ok(token !== second, 'Independent logins must have distinct credentials');
  const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';

  await t.test('photo returns stable ID, persists only own photo and keeps both sessions valid', async () => {
    const before = await fingerprint();
    const original = (await fixture.query('SELECT session_version FROM usuarios WHERE id=91003'))[0];
    const body = checked(await patch('foto', token, { usuario: name, foto_perfil: photo }));
    noSecrets(body); assert.equal(body.id, 91003); assert.equal(body.foto_perfil, photo);
    assert.deepEqual((await fingerprint()).filter(row => row.id !== 91003), before.filter(row => row.id !== 91003));
    assert.deepEqual(await fixture.query('SELECT foto_perfil,session_version FROM usuarios WHERE id=91003'),
      [{ foto_perfil: photo, session_version: original.session_version }]);
    for (const session of [token, second]) checked(await api('/inicio', { token: session }));
  });
  await t.test('wrong password, duplicate username and another-account bodies cannot write any account', async () => {
    assert.equal((await noWrite(() => patch('perfil', token, { usuario_actual: name, password_actual: 'QA-wrong-only', usuario_nuevo: 'qa_profile_never' }), 401)).code,'current_password_invalid');
    await noWrite(() => patch('perfil', token, { usuario_actual: name, password_actual: fixturePassword, usuario_nuevo: 'qa_franco' }), 409);
    await noWrite(() => patch('perfil', token, { usuario_actual: 'qa_franco', password_actual: fixturePassword, usuario_nuevo: 'qa_profile_never' }), 403);
    await noWrite(() => patch('foto', token, { usuario: 'qa_franco', foto_perfil: photo }), 403);
    await noWrite(() => patch('password', token, { usuario: 'qa_franco', password_actual: fixturePassword, password_nueva: 'QA-unused-private-2026!' }), 403);
    assert.equal((await noWrite(() => patch('password', token, { usuario: name, password_actual: 'QA-wrong-only', password_nueva: 'QA-unused-private-2026!' }), 401)).code,'current_password_invalid');
    await noWrite(() => patch('foto', undefined, { usuario: name, foto_perfil: photo }), 401);
  });
  await t.test('username change keeps ID, returns no replacement token and revokes both old sessions', async () => {
    const before = await fingerprint();
    const version = (await fixture.query('SELECT session_version FROM usuarios WHERE id=91003'))[0].session_version;
    const nextName = 'qa_profile_renamed_55670';
    const body = checked(await patch('perfil', token, { usuario_actual: name, password_actual: fixturePassword, usuario_nuevo: nextName }));
    noSecrets(body); assert.equal(body.id, 91003); assert.equal(body.usuario, nextName);
    assert.deepEqual((await fingerprint()).filter(row => row.id !== 91003), before.filter(row => row.id !== 91003));
    assert.deepEqual(await fixture.query('SELECT usuario,session_version,foto_perfil FROM usuarios WHERE id=91003'),
      [{ usuario: nextName, session_version: version + 1, foto_perfil: photo }]);
    for (const old of [token, second]) checked(await api('/inicio', { token: old }), 401);
    name = nextName; token = await login(name); second = await login(name);
    checked(await api('/inicio', { token }));
  });
  await t.test('password change revokes both sessions; old password fails and new password authenticates same ID', async () => {
    const nextPassword = 'QA-local-profile-new-password-55670!';
    const before = await fingerprint();
    const version = (await fixture.query('SELECT session_version FROM usuarios WHERE id=91003'))[0].session_version;
    const body = checked(await patch('password', token, { usuario: name, password_actual: fixturePassword, password_nueva: nextPassword }));
    noSecrets(body); assert.equal(body.ok, true);
    assert.deepEqual((await fingerprint()).filter(row => row.id !== 91003), before.filter(row => row.id !== 91003));
    assert.equal((await fixture.query('SELECT session_version FROM usuarios WHERE id=91003'))[0].session_version, version + 1);
    for (const old of [token, second]) checked(await api('/inicio', { token: old }), 401);
    checked(await api('/login', { method: 'POST', body: { usuario: name, password: fixturePassword } }), 401);
    token = await login(name, nextPassword); checked(await api('/inicio', { token }));
  });
  await t.test('late logout cannot revoke a newer epoch after waiting on an actual row lock', async () => {
    const barrier = new pg.Client({ connectionString: url }); await barrier.connect();
    let pending;
    try {
      await barrier.query('BEGIN');
      await barrier.query('SELECT id FROM usuarios WHERE id=91003 FOR UPDATE');
      const pid = (await barrier.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = api('/logout', { token, method: 'POST' });
      let blocked = false;
      const deadline = Date.now() + 2500;
      while (Date.now() < deadline) {
        if ((await barrier.query('SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))', [pid])).rowCount) {
          blocked = true; break;
        }
        await new Promise(resolve => setTimeout(resolve, 15));
      }
      assert.ok(blocked, 'Logout must reach the held account row lock');
      await barrier.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91003');
      await barrier.query('COMMIT');
      const newerEpoch = await fingerprint();
      // A new login is issued while the earlier logout is already in flight.
      token = await login(name, 'QA-local-profile-new-password-55670!');
      checked(await pending, 401);
      assert.deepEqual(await fingerprint(), newerEpoch);
      checked(await api('/inicio', { token }));
    } finally {
      await barrier.query('ROLLBACK');
      await Promise.allSettled([pending].filter(Boolean));
      await barrier.end();
    }
  });
  await t.test('photo CAS rechecks actor version after waiting on an actual row lock', async () => {
    const barrier = new pg.Client({ connectionString: url }); await barrier.connect();
    let pending;
    try {
      await barrier.query('BEGIN');
      await barrier.query('SELECT id FROM usuarios WHERE id=91003 FOR UPDATE');
      const pid = (await barrier.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = patch('foto', token, { usuario: name, foto_perfil: '' });
      let blocked = false;
      const deadline = Date.now() + 2500;
      while (Date.now() < deadline) {
        if ((await barrier.query('SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))', [pid])).rowCount) {
          blocked = true; break;
        }
        await new Promise(resolve => setTimeout(resolve, 15));
      }
      assert.ok(blocked, 'Photo write must reach the held actor row lock');
      await barrier.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91003');
      await barrier.query('COMMIT');
      const revoked = await fingerprint();
      checked(await pending, 401); assert.deepEqual(await fingerprint(), revoked);
      assert.equal((await fixture.query('SELECT foto_perfil FROM usuarios WHERE id=91003'))[0].foto_perfil, photo);
      checked(await api('/inicio', { token }), 401);
    } finally {
      await barrier.query('ROLLBACK');
      await Promise.allSettled([pending].filter(Boolean));
      await barrier.end();
    }
  });
  await t.test('current logout revokes all same-account sessions but preserves other accounts', async () => {
    const password = 'QA-local-profile-new-password-55670!';
    const current = await login(name, password), otherSession = await login(name, password);
    const owner = checked(await api('/login', { method: 'POST', body: { usuario: 'qa_franco', password: fixturePassword } })).token;
    const before = await fingerprint();
    const version = (await fixture.query('SELECT session_version FROM usuarios WHERE id=91003'))[0].session_version;
    assert.equal(checked(await api('/logout', { token: current, method: 'POST' })).ok, true);
    assert.equal((await fixture.query('SELECT session_version FROM usuarios WHERE id=91003'))[0].session_version, version + 1);
    assert.deepEqual((await fingerprint()).filter(row => row.id !== 91003), before.filter(row => row.id !== 91003));
    for (const old of [current, otherSession]) checked(await api('/inicio', { token: old }), 401);
    checked(await api('/inicio', { token: owner }));
    const after = await fingerprint();
    checked(await api('/logout', { token: current, method: 'POST' }), 401);
    assert.deepEqual(await fingerprint(), after);
  });
});
