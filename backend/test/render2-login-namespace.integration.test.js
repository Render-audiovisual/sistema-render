import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { apiRequest } from '../../frontend/src/features/render-os/services/render-os-api.js';
import { createCapturedRequest } from '../../frontend/src/shared/session/captured-request.js';

// Actual principal HTTP + DB LOWER semantics, not a substitute resolver. No
// provider, configured DB or listeners during ordinary discovery.
test('login identifier namespace prevents new ambiguity without rewriting historical identities', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55708 }), clients = new Set();
  t.after(async () => {
    for (const client of clients) { await client.query('ROLLBACK').catch(() => {}); await client.end(); }
    await fixture.cleanup(); await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic('Own namespace fixture and dedicated barrier clients stopped and removed.');
  });
  const url = 'postgresql://render2_fixture@127.0.0.1:55708/render2_local_test';
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port: 55708, url, identity });
  const checked = (result, status = 200) => { assert.equal(result.status, status, 'Expected HTTP status'); return result.body; };
  const api = (route, options) => request(fixture.base, `/api${route}`, options);
  const login = async usuario => {
    const body = checked(await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } }));
    assert.equal(typeof body.token, 'string'); return { token: body.token, id: body.usuario.id };
  };
  const a = await login('qa_franco'), b = await login('qa_agustin');
  const read = async id => {
    const row = checked(await api('/usuarios', { token: a.token })).find(row => row.id === id);
    assert.ok(row); assert.match(row.admin_revision || '', new RegExp(`^ua1:${id}:[1-9]\\d*$`)); return row;
  };
  const patch = (id, suffix, body, revision, token = a.token) => api(`/usuarios/${id}${suffix}`, {
    token, method: 'PATCH', body: { ...body, expected_revision: revision },
  });
  const create = usuario => api('/usuarios', { token: a.token, method: 'POST', body: {
    usuario, nombre: 'QA88 created identity', rol: 'edicion', password: fixturePassword,
  } });
  const noSecrets = body => {
    for (const key of ['password', 'password_hash', 'token', 'session_version', 'google_id', 'whatsapp_id_hash', 'user_admin_version'])
      assert.equal(Object.hasOwn(body, key), false, `Forbidden response field: ${key}`);
  };
  const snapshot = async () => ({
    users: await fixture.query('SELECT id,md5(to_jsonb(u)::text) AS fingerprint FROM usuarios u ORDER BY id'),
    tasks: await fixture.query('SELECT id,md5(to_jsonb(t)::text) AS fingerprint FROM tareas t ORDER BY id'),
    assignments: await fixture.query('SELECT tarea_id,usuario_id,md5(to_jsonb(a)::text) AS fingerprint FROM tarea_asignaciones a ORDER BY tarea_id,usuario_id'),
    comments: await fixture.query('SELECT id,md5(to_jsonb(c)::text) AS fingerprint FROM tarea_comentarios c ORDER BY id'),
    lists: await fixture.query('SELECT id,md5(to_jsonb(l)::text) AS fingerprint FROM listas_personales l ORDER BY id'),
    blocks: await fixture.query('SELECT id,md5(to_jsonb(b)::text) AS fingerprint FROM lista_bloques b ORDER BY id'),
  });
  const preservedExcept = async (before, ids = []) => {
    const after = await snapshot();
    assert.deepEqual(after.users.filter(row => !ids.includes(row.id)), before.users.filter(row => !ids.includes(row.id)));
    for (const key of ['tasks', 'assignments', 'comments', 'lists', 'blocks']) assert.deepEqual(after[key], before[key]);
  };
  const denied = async operation => {
    const before = await snapshot(), body = checked(await operation(), 409);
    noSecrets(body); assert.deepEqual(Object.keys(body).sort(), ['code', 'error']);
    assert.equal(body.code, 'LOGIN_IDENTIFIER_UNAVAILABLE'); assert.equal(typeof body.error, 'string');
    assert.equal(body.error.includes('@'), false, 'Conflict must not disclose another account contact');
    assert.equal(/9880[12]|9881[01]/.test(body.error), false, 'Conflict must not disclose another account ID');
    await preservedExcept(before); return body;
  };
  const seed = async (id, usuario, { google = null, active = true, notices = null } = {}) => {
    await fixture.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version,google_email,email_notificaciones)
      SELECT $1,$2,'QA88 existing identity','edicion',password_hash,$3,1,$4,$5 FROM usuarios WHERE id=91001`,
    [id, usuario, active, google, notices]);
  };
  await seed(98801, 'occupied-user88@example.invalid', { google: 'occupied-google88@example.invalid', active: false });
  await seed(98802, 'qa88_own_alias');
  const task = checked(await api('/tareas', { token: a.token, method: 'POST', body: {
    titulo: 'QA88 retained namespace history', asignado_a_id: 91003, tipo_tarea: 'edicion', workspace: 'render_os',
  } }), 201);
  await fixture.query('INSERT INTO tarea_comentarios(tarea_id,autor,contenido) VALUES($1,$2,$3)', [task.id, 'Luciano QA', 'Synthetic namespace preservation history']);

  await t.test('all four identity writers reject another inactive account username or Google alias using DB LOWER equality', async () => {
    const self = await login('qa_luciano');
    const revision = (await read(91003)).admin_revision, googleRevision = (await read(91004)).admin_revision;
    for (const candidate of ['OCCUPIED-USER88@EXAMPLE.INVALID', 'OCCUPIED-GOOGLE88@EXAMPLE.INVALID']) {
      await denied(() => create(candidate));
      await denied(() => patch(91003, '', { usuario: candidate, nombre: 'Luciano QA', rol: 'edicion' }, revision));
      await denied(() => patch(91004, '/google-email', { google_email: candidate }, googleRevision));
      await denied(() => api('/usuarios/perfil', { token: self.token, method: 'PATCH', body: {
        usuario_actual: 'qa_luciano', password_actual: fixturePassword, usuario_nuevo: candidate,
      } }));
    }
  });

  await t.test('real frontend apiRequest and captured bearer scope preserve namespace HTTP conflict code without private fields or writes', async () => {
    // Retain the actual login DTO unchanged: no token-shaped substitute,
    // synthetic cookie registration, Response mock or replacement transport.
    const session = checked(await api('/login', { method: 'POST', body: { usuario: 'qa_franco', password: fixturePassword } }));
    assert.equal(session.usuario.id, 91001); assert.equal(typeof session.token, 'string');
    const scope = createCapturedRequest({ session, readSession: () => session, request: apiRequest });
    const target = await read(91003), before = await snapshot();
    assert.equal(scope.current(), true);
    await assert.rejects(scope.request(new URL('/api/usuarios/91003', fixture.base).href, {
      method: 'PATCH', signal: AbortSignal.timeout(5000), headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario: 'occupied-google88@example.invalid', nombre: target.nombre,
        rol: target.rol, expected_revision: target.admin_revision }),
    }), error => {
      assert.equal(error.status, 409); assert.equal(error.code, 'LOGIN_IDENTIFIER_UNAVAILABLE');
      assert.deepEqual(Object.keys(error).sort(), ['code', 'status']);
      assert.equal(error.message.includes('occupied-google88@example.invalid'), false);
      assert.equal(error.message.includes('98801'), false); noSecrets(error); return true;
    });
    assert.equal(scope.current(), true); scope.assertCurrent(); await preservedExcept(before);
    checked(await api('/inicio', { token: session.token }));
  });

  await t.test('notification address is excluded from namespace and cannot become that recipient identity', async () => {
    const alias = 'notice-only88@example.invalid', recipient = await read(91004);
    checked(await patch(91004, '/email-notificaciones', { email_notificaciones: alias }, recipient.admin_revision));
    const before = await snapshot();
    checked(await api('/login', { method: 'POST', body: { usuario: alias, password: fixturePassword } }), 401);
    await preservedExcept(before);
    const created = checked(await create(alias), 201); noSecrets(created); assert.notEqual(created.id, 91004);
    assert.equal((await login(alias)).id, created.id); assert.equal((await login('qa_designer')).id, 91004);
    await preservedExcept(before, [created.id]);
  });

  await t.test('own-ID username and Google aliases may coincide without another identity or inferred grant', async () => {
    const target = await read(98802), alias = 'own-login88@example.invalid';
    const google = checked(await patch(98802, '/google-email', { google_email: alias }, target.admin_revision));
    noSecrets(google); const self = await login('qa88_own_alias'), before = await snapshot();
    const changed = checked(await api('/usuarios/perfil', { token: self.token, method: 'PATCH', body: {
      usuario_actual: 'qa88_own_alias', password_actual: fixturePassword, usuario_nuevo: alias,
    } }));
    noSecrets(changed); assert.equal(changed.id, 98802); assert.equal(changed.usuario, alias);
    assert.equal((await login(alias)).id, 98802); checked(await api('/inicio', { token: self.token }), 401);
    await preservedExcept(before, [98802]);
    const current = await read(98802);
    checked(await patch(98802, '/google-email', { google_email: alias.toUpperCase() }, current.admin_revision));
  });

  await t.test('existing cross-field ambiguity stays denied and unchanged aliases still permit explicit role/name edits', async () => {
    const alias = 'legacy-ambiguous88@example.invalid';
    // Explicit physical legacy fixture: no API may create this new ambiguity.
    await seed(98810, alias);
    await seed(98811, 'qa88_legacy_google', { google: alias, active: false });
    const before = await snapshot();
    checked(await api('/login', { method: 'POST', body: { usuario: alias, password: fixturePassword } }), 401);
    await preservedExcept(before);
    const existing = await read(98810);
    const changed = checked(await patch(98810, '', { usuario: alias, nombre: 'QA88 explicit renamed display', rol: 'diseno' }, existing.admin_revision));
    assert.equal(changed.id, 98810); assert.equal(changed.usuario, alias); assert.equal(changed.rol, 'diseno');
    const google = await read(98811);
    const googleAck = checked(await patch(98811, '/google-email', { google_email: alias.toUpperCase() }, google.admin_revision));
    assert.equal(googleAck.google_email, alias); assert.equal(googleAck.id, 98811);
    const after = await snapshot();
    checked(await api('/login', { method: 'POST', body: { usuario: alias, password: fixturePassword } }), 401);
    await preservedExcept(after);
    assert.deepEqual(await fixture.query('SELECT id,usuario,google_email,activo FROM usuarios WHERE id=ANY($1::int[]) ORDER BY id', [[98810, 98811]]),
      [{ id: 98810, usuario: alias, google_email: null, activo: true }, { id: 98811, usuario: 'qa88_legacy_google', google_email: alias, activo: false }]);
    await preservedExcept(before, [98810, 98811]);
  });

  await t.test('Unicode availability follows actual database LOWER rather than JavaScript case folding', async () => {
    const stored = '\u0130d88@example.invalid', proposed = 'i\u0307d88@example.invalid';
    assert.equal(stored.toLowerCase(), proposed.toLowerCase(), 'Synthetic pair intentionally folds together in JS');
    await seed(98822, stored);
    const [comparison] = await fixture.query('SELECT lower($1::text)=lower($2::text) AS same', [stored, proposed]);
    const before = await snapshot();
    if (comparison.same) {
      await denied(() => create(proposed));
    } else {
      const created = checked(await create(proposed), 201); noSecrets(created);
      assert.notEqual(created.id, 98822); assert.equal((await login(proposed)).id, created.id);
      assert.equal((await login(stored)).id, 98822);
      await preservedExcept(before, [created.id]);
    }
    // Both branches assert PostgreSQL's real collation result, never skip or
    // substitute an in-memory resolver for HTTP identity selection.
  });

  const connect = async () => {
    const client = new pg.Client({ connectionString: url, statement_timeout: 15000 });
    clients.add(client); await client.connect(); return client;
  };
  const close = async client => { try { await client.query('ROLLBACK'); } finally { await client.end(); clients.delete(client); } };
  const raw = async (route, token, method, body) => {
    const response = await fetch(new URL(`/api${route}`, fixture.base), { method, signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const waiters = async (observer, pid, count) => {
    const deadline = Date.now() + 3500;
    do {
      const result = await observer.query(`SELECT count(DISTINCT pid)::int AS count FROM pg_locks
        WHERE locktype='advisory' AND classid=20261019::oid AND objid=1::oid AND objsubid=2 AND NOT granted
        AND $1::int=ANY(pg_blocking_pids(pid))`, [pid]);
      if (result.rows[0].count === count) return;
      await new Promise(resolve => setTimeout(resolve, 15));
    } while (Date.now() < deadline);
    assert.fail('Every intended HTTP writer must be observed waiting on the administration advisory lock');
  };
  for (const kind of ['admin create', 'self rename']) await t.test(`${kind} versus admin Google assignment has exactly one namespace winner`, async () => {
    const alias = kind === 'admin create' ? 'create-race88@example.invalid' : 'self-race88@example.invalid';
    let self;
    if (kind === 'self rename') { await seed(98820, 'qa88_self_race'); self = await login('qa88_self_race'); }
    const observed = await read(91004), before = await snapshot();
    const holder = await connect(), observer = await connect(), pending = [];
    try {
      await holder.query('BEGIN'); await holder.query('SELECT pg_advisory_xact_lock(20261019,1)');
      const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const first = kind === 'admin create'
        ? raw('/usuarios', a.token, 'POST', { usuario: alias, nombre: 'QA88 namespace race', rol: 'edicion', password: fixturePassword })
        : raw('/usuarios/perfil', self.token, 'PATCH', { usuario_actual: 'qa88_self_race', password_actual: fixturePassword, usuario_nuevo: alias });
      void first.catch(() => {}); pending.push(first);
      const second = raw('/usuarios/91004/google-email', b.token, 'PATCH', { google_email: alias, expected_revision: observed.admin_revision });
      void second.catch(() => {}); pending.push(second);
      await waiters(observer, pid, 2); await holder.query('COMMIT'); const results = await Promise.all(pending);
      const winner = results.findIndex(result => result.status !== 409), loser = 1 - winner;
      assert.ok(winner === 0 || winner === 1);
      checked(results[winner], winner === 0 && kind === 'admin create' ? 201 : 200);
      checked(results[loser], 409); noSecrets(results[0].body); noSecrets(results[1].body);
      assert.equal(results[loser].body.code, 'LOGIN_IDENTIFIER_UNAVAILABLE');
      const chosenId = results[winner].body.id;
      const candidates = await fixture.query('SELECT id FROM usuarios WHERE lower(usuario)=lower($1) OR lower(google_email)=lower($1) ORDER BY id', [alias]);
      assert.deepEqual(candidates, [{ id: chosenId }]); assert.equal((await login(alias)).id, chosenId);
      if (kind === 'self rename') {
        assert.equal((await api('/inicio', { token: self.token })).status, winner === 0 ? 401 : 200);
      }
      await preservedExcept(before, [chosenId]);
    } finally {
      await holder.query('ROLLBACK').catch(() => {}); await Promise.allSettled(pending);
      await close(observer); await close(holder);
    }
  });

  await t.test('self rename revalidates epoch after advisory wait before namespace mutation', async () => {
    await seed(98821, 'qa88_self_revoked'); const self = await login('qa88_self_revoked');
    const holder = await connect(), observer = await connect(); let pending;
    try {
      await holder.query('BEGIN'); await holder.query('SELECT pg_advisory_xact_lock(20261019,1)');
      const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = raw('/usuarios/perfil', self.token, 'PATCH', { usuario_actual: 'qa88_self_revoked', password_actual: fixturePassword, usuario_nuevo: 'qa88_should_not_save' });
      void pending.catch(() => {}); await waiters(observer, pid, 1);
      await observer.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=98821');
      const revoked = await snapshot(); await holder.query('COMMIT');
      const body = checked(await pending, 401); noSecrets(body); await preservedExcept(revoked);
    } finally {
      await holder.query('ROLLBACK').catch(() => {}); if (pending) await Promise.allSettled([pending]);
      await close(observer); await close(holder);
    }
  });
});
