import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

// Migration 074 and actual principal routes; no schema patch, configured DB,
// provider, or physical startup unless explicitly opted in by the coordinator.
test('user administrative revisions fence concurrent owners and every account update', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55704, deferUserAdminMigration: true });
  const clients = new Set();
  t.after(async () => {
    for (const client of clients) { await client.query('ROLLBACK').catch(() => {}); await client.end(); }
    await fixture.cleanup(); await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic('Own user revision fixture and barrier clients stopped and removed.');
  });
  const url = 'postgresql://render2_fixture@127.0.0.1:55704/render2_local_test';
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port: 55704, url, identity });
  const api = (route, options) => request(fixture.base, `/api${route}`, options);
  const checked = (result, status = 200) => { assert.equal(result.status, status, 'Expected HTTP status'); return result.body; };
  const login = async usuario => {
    const result = checked(await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } }));
    assert.equal(typeof result.token, 'string'); return result.token;
  };
  const noSecrets = body => {
    for (const key of ['password', 'password_hash', 'google_id', 'whatsapp_id_hash', 'session_version', 'user_admin_version', 'token'])
      assert.equal(Object.hasOwn(body, key), false, `Forbidden response field: ${key}`);
  };
  const catalog = async () => checked(await api('/usuarios', { token: a }));
  const read = async (id = 91003) => {
    const row = (await catalog()).find(item => item.id === id); assert.ok(row);
    assert.match(row.admin_revision || '', new RegExp(`^ua1:${id}:[1-9]\\d*$`)); noSecrets(row); return row;
  };
  const version = revision => Number(revision.split(':')[2]);
  const patch = (suffix, body, revision, token = a, id = 91003) => api(`/usuarios/${id}${suffix}`, {
    token, method: 'PATCH', body: { ...body, ...(revision === undefined ? {} : { expected_revision: revision }) },
  });
  const snapshot = async () => ({
    users: await fixture.query('SELECT id,md5(to_jsonb(u)::text) AS fingerprint FROM usuarios u ORDER BY id'),
    tasks: await fixture.query('SELECT id,md5(to_jsonb(t)::text) AS fingerprint FROM tareas t ORDER BY id'),
    assignments: await fixture.query('SELECT tarea_id,usuario_id,md5(to_jsonb(a)::text) AS fingerprint FROM tarea_asignaciones a ORDER BY tarea_id,usuario_id'),
    comments: await fixture.query('SELECT id,md5(to_jsonb(c)::text) AS fingerprint FROM tarea_comentarios c ORDER BY id'),
    lists: await fixture.query('SELECT id,md5(to_jsonb(l)::text) AS fingerprint FROM listas_personales l ORDER BY id'),
    blocks: await fixture.query('SELECT id,md5(to_jsonb(b)::text) AS fingerprint FROM lista_bloques b ORDER BY id'),
  });
  const unchanged = async (operation, status) => {
    const before = await snapshot(), body = checked(await operation(), status);
    noSecrets(body); assert.deepEqual(await snapshot(), before); return body;
  };
  await t.test('actual 074 upgrade preserves populated pre-migration user rows and operational history byte-for-byte', async () => {
    const migration = '074_user_administration_versions.sql';
    assert.deepEqual(await fixture.query('SELECT nombre FROM _migrations WHERE nombre=$1', [migration]), []);
    assert.deepEqual(await fixture.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='usuarios' AND column_name='user_admin_version'`), []);
    // No auth requests before migration. Existing 000..073 schema/data are
    // populated with fixture-only users, contacts, task history and private blocks.
    await fixture.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version,email_notificaciones,google_email)
      SELECT 98601,'qa86_historical_inactive','QA86 historical inactive','edicion',password_hash,false,7,
        'old-notices86@example.invalid','old-google86@example.invalid' FROM usuarios WHERE id=91001`);
    const [oldTask] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,tipo_tarea,estado,propiedades_extra)
      VALUES('QA86 pre-074 historical task','QA86 historical inactive','edicion','pendiente',$1::jsonb) RETURNING id`,
    [JSON.stringify({ workspace: 'render_os', qa86_history: 'preserve preexisting metadata' })]);
    await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,98601,'responsable')", [oldTask.id]);
    await fixture.query("INSERT INTO tarea_comentarios(tarea_id,autor,contenido) VALUES($1,'QA86 historical inactive','Pre-migration retained comment')", [oldTask.id]);
    const [list] = await fixture.query("INSERT INTO listas_personales(usuario_id,titulo) VALUES(98601,'Pre-074 private list') RETURNING id");
    await fixture.query("INSERT INTO lista_bloques(lista_id,tipo,contenido) VALUES($1,'texto',$2::jsonb)", [list.id, JSON.stringify({ texto: 'Pre-074 retained private content' })]);
    // Raw serialized rows stay in memory only. Boolean assertions below avoid
    // printing password hashes/contacts if preservation ever fails.
    const originalUsers = await fixture.query('SELECT id,to_jsonb(u)::text AS serialized FROM usuarios u ORDER BY id');
    const before = await snapshot();
    await fixture.query(await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
    await fixture.query('INSERT INTO _migrations(nombre) VALUES($1)', [migration]);
    const afterUsers = await fixture.query("SELECT id,(to_jsonb(u)-'user_admin_version')::text AS serialized,user_admin_version FROM usuarios u ORDER BY id");
    assert.equal(afterUsers.length, originalUsers.length);
    for (let i = 0; i < originalUsers.length; i++) {
      assert.equal(afterUsers[i].id, originalUsers[i].id);
      assert.equal(afterUsers[i].serialized === originalUsers[i].serialized, true, 'Entire preexisting user row must be byte-identical except added observation column');
      assert.equal(afterUsers[i].user_admin_version, 1);
    }
    const after = await snapshot();
    for (const key of ['tasks', 'assignments', 'comments', 'lists', 'blocks']) assert.deepEqual(after[key], before[key]);
    assert.deepEqual(await fixture.query('SELECT nombre FROM _migrations WHERE nombre=$1', [migration]), [{ nombre: migration }]);
  });
  // Principal auth begins only after applying and recording actual 074.
  const a = await login('qa_franco'), b = await login('qa_agustin');
  let employee = await login('qa_luciano');
  await t.test('JSON parser rejects scalar and malformed canaries without echo or account/history writes', async () => {
    const canary = 'QA86_PRIVATE_BODY_CANARY';
    for (const rawBody of [JSON.stringify(canary), `{"canary":"${canary}",`]) {
      const before = await snapshot();
      const response = await fetch(new URL('/api/usuarios', fixture.base), {
        method: 'POST', signal: AbortSignal.timeout(5000),
        headers: { authorization: `Bearer ${a}`, 'content-type': 'application/json' }, body: rawBody,
      });
      assert.equal(response.status, 400);
      assert.match(response.headers.get('content-type') || '', /application\/json/);
      const text = await response.text();
      assert.equal(text.includes(canary), false, 'Parser error must not echo synthetic request content');
      const body = JSON.parse(text);
      assert.equal(typeof body.error, 'string');
      assert.deepEqual(Object.keys(body), ['error']);
      noSecrets(body); assert.deepEqual(await snapshot(), before);
    }
    // Coordinator separately checks captured child logs for this canary. This
    // HTTP assertion proves response/state boundaries, not log confidentiality.
  });
  const task = checked(await api('/tareas', { token: a, method: 'POST', body: {
    titulo: 'QA86 revision preserved history', tipo_tarea: 'edicion', asignado_a_id: 91003, workspace: 'render_os',
  } }), 201);
  await fixture.query('INSERT INTO tarea_comentarios(tarea_id,autor,contenido) VALUES($1,$2,$3)', [task.id, 'Luciano QA', 'Retained synthetic revision history']);

  await t.test('admin GET/CREATE expose bound revision while employee catalog omits revision/private fields', async () => {
    const original = await read();
    const [db] = await fixture.query('SELECT user_admin_version FROM usuarios WHERE id=91003');
    assert.equal(version(original.admin_revision), db.user_admin_version);
    const created = checked(await api('/usuarios', { token: a, method: 'POST', body: {
      usuario: 'qa_revision86_new', nombre: 'QA86 new account', rol: 'edicion', password: 'Synthetic-account86-only!',
    } }), 201);
    noSecrets(created); assert.equal(created.admin_revision, `ua1:${created.id}:1`);
    const rows = checked(await api('/usuarios', { token: employee }));
    for (const row of rows) {
      noSecrets(row);
      for (const key of ['admin_revision', 'email_notificaciones', 'google_email', 'whatsapp_vinculado']) assert.equal(Object.hasOwn(row, key), false);
    }
  });

  const operations = [
    { suffix: '/acceso', body: { activo: true }, invalid: [{}, { activo: null }, { activo: 'false' }, { activo: 1 }] },
    { suffix: '', body: { usuario: 'qa_luciano', nombre: 'Luciano QA', rol: 'edicion' }, invalid: [{}, { usuario: 'qa_luciano', nombre: 'Luciano QA' },
      { usuario: [], nombre: 'X', rol: 'edicion' }, { usuario: 'qa_luciano', nombre: null, rol: 'edicion' }, { usuario: 'qa_luciano', nombre: 'X', rol: {} }] },
    { suffix: '/email-notificaciones', body: { email_notificaciones: 'revision86@example.invalid' }, invalid: [{}, { email_notificaciones: [] }, { email_notificaciones: 1 }, { email_notificaciones: {} }, { email_notificaciones: 'invalid-email' }] },
    { suffix: '/google-email', body: { google_email: 'revision-google86@example.invalid' }, invalid: [{}, { google_email: [] }, { google_email: false }, { google_email: {} }, { google_email: 'invalid-email' }] },
    { suffix: '/whatsapp', body: { whatsapp: '5493794000086' }, invalid: [{}, { whatsapp: [] }, { whatsapp: 5493794000086 }, { whatsapp: {} }, { whatsapp: 'invalid-number' }] },
  ];
  for (const operation of operations) await t.test(`${operation.suffix || 'identity'} requires canonical bound precondition and closed typed body`, async () => {
    const revision = (await read()).admin_revision;
    const missing = await unchanged(() => patch(operation.suffix, operation.body), 428);
    assert.equal(missing.code, 'USER_ADMIN_REVISION_REQUIRED');
    for (const invalid of [null, '', 1, [], {}, 'ua1:91003:0', 'ua1:91003:01', 'ua1:91003:1\n', 'ua1:91003:2147483648']) {
      const body = await unchanged(() => patch(operation.suffix, operation.body, invalid), 400);
      assert.equal(body.code, 'USER_ADMIN_REVISION_INVALID');
    }
    const crossRevision = (await read(91004)).admin_revision;
    const cross = await unchanged(() => patch(operation.suffix, operation.body, crossRevision), 409);
    assert.equal(cross.code, 'USER_ADMIN_REVISION_CONFLICT');
    for (const invalid of [...operation.invalid, { ...operation.body, unexpected: true }])
      await unchanged(() => patch(operation.suffix, invalid, revision), 400);
    for (const body of [null, [], 'invalid-root'])
      await unchanged(() => api(`/usuarios/91003${operation.suffix}`, { token: a, method: 'PATCH', body }), 400);
    await unchanged(() => patch(operation.suffix, operation.body, revision, employee), 403);
    await unchanged(() => api(`/usuarios/91003${operation.suffix}`, { method: 'PATCH', body: { ...operation.body, expected_revision: revision } }), 401);
  });

  await t.test('two owners queued with same observed revision have one exact winner and one stale conflict', async () => {
    const original = await read(), before = await snapshot();
    const untouchedTarget = await fixture.query("SELECT md5((to_jsonb(u)-'user_admin_version'-'email_notificaciones')::text) AS fingerprint FROM usuarios u WHERE id=91003");
    const holder = new pg.Client({ connectionString: url, statement_timeout: 15000 });
    const observer = new pg.Client({ connectionString: url, statement_timeout: 15000 });
    clients.add(holder); clients.add(observer); await holder.connect(); await observer.connect();
    const pending = [];
    try {
      await holder.query('BEGIN'); await holder.query('SELECT pg_advisory_xact_lock(20261019,1)');
      const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      for (const [token, address] of [[a, 'owner-a86@example.invalid'], [b, 'owner-b86@example.invalid']]) {
        const promise = patch('/email-notificaciones', { email_notificaciones: address }, original.admin_revision, token);
        void promise.catch(() => {}); pending.push(promise);
      }
      let waiting = false; const deadline = Date.now() + 2500;
      while (Date.now() < deadline) {
        const result = await observer.query(`SELECT count(DISTINCT pid)::int AS count FROM pg_locks
          WHERE locktype='advisory' AND classid=20261019::oid AND objid=1::oid AND objsubid=2
          AND NOT granted AND $1::int=ANY(pg_blocking_pids(pid))`, [pid]);
        if (result.rows[0].count === 2) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 15));
      }
      assert.ok(waiting, 'Both actual HTTP updates must wait on the held advisory lock');
      await holder.query('COMMIT'); const results = await Promise.all(pending);
      assert.deepEqual(results.map(result => result.status).sort((x, y) => x - y), [200, 409]);
      const winner = results.findIndex(result => result.status === 200), saved = checked(results[winner]);
      assert.equal(results[1 - winner].body.code, 'USER_ADMIN_REVISION_CONFLICT');
      assert.equal(saved.admin_revision, `ua1:91003:${version(original.admin_revision) + 1}`);
      assert.equal(saved.email_notificaciones, winner === 0 ? 'owner-a86@example.invalid' : 'owner-b86@example.invalid');
      assert.equal((await read()).admin_revision, saved.admin_revision);
      assert.deepEqual(await fixture.query("SELECT md5((to_jsonb(u)-'user_admin_version'-'email_notificaciones')::text) AS fingerprint FROM usuarios u WHERE id=91003"), untouchedTarget);
      const after = await snapshot();
      assert.deepEqual(after.users.filter(row => row.id !== 91003), before.users.filter(row => row.id !== 91003));
      for (const key of ['tasks', 'assignments', 'comments', 'lists', 'blocks']) assert.deepEqual(after[key], before[key]);
    } finally {
      await holder.query('ROLLBACK').catch(() => {}); await Promise.allSettled(pending);
      await observer.end(); clients.delete(observer); await holder.end(); clients.delete(holder);
    }
  });

  await t.test('all valid PATCH ACKs advance revision, preserve exact fields and explicit null/empty contact unlinks', async () => {
    let revision = (await read()).admin_revision;
    const before = await snapshot();
    const changes = [
      ...operations,
      { suffix: '/email-notificaciones', body: { email_notificaciones: null } },
      { suffix: '/email-notificaciones', body: { email_notificaciones: '' } },
      { suffix: '/email-notificaciones', body: { email_notificaciones: '   ' } },
      { suffix: '/email-notificaciones', body: { email_notificaciones: ' Normalized86@Example.Invalid ' } },
      { suffix: '/google-email', body: { google_email: null } },
      { suffix: '/google-email', body: { google_email: '' } },
      { suffix: '/google-email', body: { google_email: '   ' } },
      { suffix: '/whatsapp', body: { whatsapp: null } }, { suffix: '/whatsapp', body: { whatsapp: '' } },
      { suffix: '/whatsapp', body: { whatsapp: '   ' } },
    ];
    for (const operation of changes) {
      const result = checked(await patch(operation.suffix, operation.body, revision)); noSecrets(result);
      assert.equal(result.id, 91003); assert.equal(version(result.admin_revision), version(revision) + 1);
      assert.equal(result.admin_revision, (await read()).admin_revision);
      for (const [key, value] of Object.entries(operation.body)) {
        if (key === 'whatsapp') assert.equal(result.whatsapp_vinculado, Boolean(value?.trim()));
        else if (key === 'email_notificaciones' || key === 'google_email') assert.equal(result[key], value?.trim().toLowerCase() || null);
        else assert.equal(result[key], value);
      }
      revision = result.admin_revision;
    }
    const after = await snapshot();
    assert.deepEqual(after.users.filter(row => row.id !== 91003), before.users.filter(row => row.id !== 91003));
    for (const key of ['tasks', 'assignments', 'comments', 'lists', 'blocks']) assert.deepEqual(after[key], before[key]);
  });

  await t.test('SQL no-op and ABA cannot restore revision, even if caller supplies an old counter', async () => {
    const original = await read();
    const business = await fixture.query("SELECT md5((to_jsonb(u)-'user_admin_version')::text) AS fingerprint FROM usuarios u WHERE id=91003");
    await fixture.query('UPDATE usuarios SET nombre=nombre,user_admin_version=1 WHERE id=91003');
    assert.equal(version((await read()).admin_revision), version(original.admin_revision) + 1);
    await fixture.query("UPDATE usuarios SET nombre='QA86 temporary name' WHERE id=91003");
    await fixture.query('UPDATE usuarios SET nombre=$1 WHERE id=91003', [original.nombre]);
    const current = await read(); assert.equal(current.nombre, original.nombre);
    assert.equal(version(current.admin_revision), version(original.admin_revision) + 3);
    assert.deepEqual(await fixture.query("SELECT md5((to_jsonb(u)-'user_admin_version')::text) AS fingerprint FROM usuarios u WHERE id=91003"), business);
    for (const operation of operations) {
      const body = await unchanged(() => patch(operation.suffix, operation.body, original.admin_revision), 409);
      assert.equal(body.code, 'USER_ADMIN_REVISION_CONFLICT');
    }
  });

  await t.test('real profile photo and epoch updates invalidate observed admin revision without history writes', async () => {
    employee = await login('qa_luciano');
    const beforePhoto = await read();
    checked(await api('/usuarios/foto', { token: employee, method: 'PATCH', body: {
      usuario: 'qa_luciano', foto_perfil: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
    } }));
    assert.equal(version((await read()).admin_revision), version(beforePhoto.admin_revision) + 1);
    await unchanged(() => patch('/email-notificaciones', { email_notificaciones: 'stale-photo86@example.invalid' }, beforePhoto.admin_revision), 409);
    const beforeEpoch = await read(); await fixture.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91003');
    assert.equal(version((await read()).admin_revision), version(beforeEpoch.admin_revision) + 1);
    await unchanged(() => patch('/whatsapp', { whatsapp: null }, beforeEpoch.admin_revision), 409);
    checked(await api('/inicio', { token: employee }), 401);
  });

  await t.test('last-owner protections remain effective with a valid current revision', async () => {
    const other = await read(91002);
    checked(await patch('/acceso', { activo: false }, other.admin_revision, a, 91002));
    const self = await read(91001);
    await unchanged(() => patch('', { usuario: self.usuario, nombre: self.nombre, rol: 'edicion' }, self.admin_revision, a, 91001), 409);
    await unchanged(() => patch('/acceso', { activo: false }, self.admin_revision, a, 91001), 409);
    assert.deepEqual(await fixture.query("SELECT id FROM usuarios WHERE rol='admin' AND activo IS TRUE"), [{ id: 91001 }]);
  });
});
