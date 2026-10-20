import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

// Opt-in principal HTTP + disposable PostgreSQL only. No configured DB, mail
// provider, forged authentication, schema changes or production credentials.
test('user administration preserves identities/history and current-session authority', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55701 });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic('Own user-administration fixture stopped and removed.');
  });
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port: 55701,
    url: 'postgresql://render2_fixture@127.0.0.1:55701/render2_local_test', identity });
  const api = (route, options) => request(fixture.base, `/api${route}`, options);
  // Assertion diagnostics deliberately never include login bodies, submitted
  // passwords, tokens, contacts or raw account records/password hashes.
  const checked = (result, status = 200) => { assert.equal(result.status, status, 'Expected HTTP status'); return result.body; };
  const login = async (usuario, password = fixturePassword) => {
    const body = checked(await api('/login', { method: 'POST', body: { usuario, password } }));
    assert.equal(typeof body.token, 'string'); return body.token;
  };
  const noSecrets = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(['password', 'password_hash', 'password_actual', 'password_nueva', 'token', 'google_id',
        'whatsapp_id_hash', 'session_version'].includes(key), false, `Forbidden response field: ${key}`);
      noSecrets(child);
    }
  };
  const snapshot = async () => ({
    users: await fixture.query('SELECT id,md5(to_jsonb(u)::text) AS fingerprint FROM usuarios u ORDER BY id'),
    tasks: await fixture.query('SELECT id,md5(to_jsonb(t)::text) AS fingerprint FROM tareas t ORDER BY id'),
    assignments: await fixture.query('SELECT tarea_id,usuario_id,md5(to_jsonb(a)::text) AS fingerprint FROM tarea_asignaciones a ORDER BY tarea_id,usuario_id'),
    comments: await fixture.query('SELECT id,md5(to_jsonb(c)::text) AS fingerprint FROM tarea_comentarios c ORDER BY id'),
    personalLists: await fixture.query('SELECT id,md5(to_jsonb(l)::text) AS fingerprint FROM listas_personales l ORDER BY id'),
    personalBlocks: await fixture.query('SELECT id,md5(to_jsonb(b)::text) AS fingerprint FROM lista_bloques b ORDER BY id'),
  });
  const unchanged = async (operation, status) => {
    const before = await snapshot(); const body = checked(await operation(), status);
    noSecrets(body); assert.deepEqual(await snapshot(), before); return body;
  };
  const history = async () => {
    const { users, ...rest } = await snapshot(); void users; return rest;
  };
  await fixture.query(`UPDATE usuarios SET email_notificaciones=$1,google_email=$2,google_id=$3,
    whatsapp_id_hash=$4,whatsapp_habilitado=true WHERE id=91003`,
  ['private-notices-84@example.invalid', 'private-google-84@example.invalid', 'synthetic-private-google-subject-84', 'synthetic-private-whatsapp-hash-84']);
  const admin = await login('qa_franco'), secondAdmin = await login('qa_agustin');
  let employee = await login('qa_luciano');
  const employeeSecond = await login('qa_luciano');
  const task = checked(await api('/tareas', { token: admin, method: 'POST', body: {
    titulo: 'QA84 retained employee history', workspace: 'render_os', tipo_tarea: 'edicion',
    asignado_a_id: 91003, colaborador_ids: [91004], fecha_vencimiento: '2026-10-25',
  } }), 201);
  assert.ok(Number.isSafeInteger(task.id));
  // Historical content fixture only; not a claim of exercising comment creation.
  await fixture.query('INSERT INTO tarea_comentarios(tarea_id,autor,contenido) VALUES($1,$2,$3)',
    [task.id, 'Luciano QA', 'Synthetic retained history 84']);

  await t.test('employee catalog is active-only and closed, without private contact or authentication material', async () => {
    const rows = await unchanged(() => api('/usuarios', { token: employee }), 200);
    assert.ok(Array.isArray(rows)); assert.ok(rows.some(row => row.id === 91003));
    const keys = ['id', 'usuario', 'nombre', 'rol', 'activo', 'foto_perfil', 'created_at'].sort();
    for (const row of rows) { assert.deepEqual(Object.keys(row).sort(), keys); assert.equal(row.activo, true); }
    const adminRows = checked(await api('/usuarios', { token: admin })); noSecrets(adminRows);
    const target = adminRows.find(row => row.id === 91003);
    assert.equal(typeof target.email_notificaciones, 'string'); assert.equal(typeof target.google_email, 'string');
    assert.equal(target.whatsapp_vinculado, true);
    await unchanged(() => api('/usuarios'), 401);
  });

  const validCreate = { usuario: 'qa_user84_new', nombre: 'QA84 new account', rol: 'edicion',
    password: 'Synthetic-only-new-account84!', email_notificaciones: 'new-account84@example.invalid' };
  await t.test('every administrative mutation rejects employee and anonymous callers without account/history writes', async () => {
    const actions = [
      ['/usuarios', 'POST', validCreate],
      ['/usuarios/91003', 'PATCH', { usuario: 'qa_luciano', nombre: 'Changed', rol: 'admin' }],
      ['/usuarios/91003/acceso', 'PATCH', { activo: false }],
      ['/usuarios/91003/email-notificaciones', 'PATCH', { email_notificaciones: 'blocked84@example.invalid' }],
      ['/usuarios/91003/google-email', 'PATCH', { google_email: 'blocked84@example.invalid' }],
      ['/usuarios/91003/whatsapp', 'PATCH', { whatsapp: '5493794000084' }],
      ['/usuarios/91003/invitacion', 'POST', {}],
      ['/usuarios/91003', 'DELETE', undefined],
    ];
    for (const [route, method, body] of actions) {
      for (const [token, status] of [[employee, 403], [undefined, 401]]) {
        await unchanged(() => api(route, { token, method, body }), status);
      }
    }
  });

  await t.test('closed typed account creation rejects invalid data without hashes/secrets in errors or writes', async () => {
    const invalid = [
      null, [], {}, { ...validCreate, usuario: null }, { ...validCreate, usuario: 84 },
      { ...validCreate, usuario: ' ' }, { ...validCreate, usuario: 'u'.repeat(129) },
      { ...validCreate, nombre: [] }, { ...validCreate, nombre: ' ' }, { ...validCreate, nombre: 'n'.repeat(201) },
      { ...validCreate, rol: [] }, { ...validCreate, rol: 'x' },
      { ...validCreate, password: null }, { ...validCreate, password: 123456789012 },
      { ...validCreate, password: 'x'.repeat(11) }, { ...validCreate, password: 'x'.repeat(73) },
      { ...validCreate, password: '😀'.repeat(11) }, { ...validCreate, password: '😀'.repeat(19) },
      { ...validCreate, email_notificaciones: [] }, { ...validCreate, email_notificaciones: 'not-an-email' },
      ...['activo', 'google_email', 'session_version', 'password_hash', 'whatsapp'].map(key => ({ ...validCreate, [key]: 'unexpected' })),
    ];
    for (const body of invalid) await unchanged(() => api('/usuarios', { token: admin, method: 'POST', body }), 400);
    await unchanged(() => api('/usuarios', { token: admin, method: 'POST', body: { ...validCreate, usuario: 'qa_franco' } }), 409);
  });

  const createdIds = [];
  await t.test('valid creation trims names/login, returns safe access DTO and authenticates the exact new ID', async () => {
    // ASCII and multibyte password boundaries are synthetic fixture values.
    const passwords = ['x'.repeat(12), 'y'.repeat(72), '😀'.repeat(12), '😀'.repeat(18)];
    for (let i = 0; i < passwords.length; i++) {
      const usuario = `qa_user84_valid_${i}`;
      const body = checked(await api('/usuarios', { token: admin, method: 'POST', body: {
        ...validCreate, usuario: ` ${usuario} `, nombre: ' QA84 valid account ',
        password: passwords[i], email_notificaciones: `valid${i}-84@example.invalid`,
      } }), 201);
      noSecrets(body); assert.ok(Number.isSafeInteger(body.id)); createdIds.push(body.id);
      assert.equal(body.usuario, usuario); assert.equal(body.nombre, 'QA84 valid account');
      assert.equal(body.activo, true); assert.equal(body.google_email, null); assert.equal(body.whatsapp_vinculado, false);
      const session = checked(await api('/login', { method: 'POST', body: { usuario, password: passwords[i] } }));
      assert.equal(session.usuario.id, body.id);
      const [persisted] = await fixture.query(`SELECT id,activo,length(password_hash)>0 AS has_hash,
        password_hash<>$2 AS not_plaintext FROM usuarios WHERE id=$1`, [body.id, passwords[i]]);
      assert.equal(persisted.has_hash, true); assert.equal(persisted.not_plaintext, true); assert.equal(persisted.activo, true);
    }
  });

  await t.test('admin contact changes are explicit and Google identity change revokes old sessions', async () => {
    const target = createdIds[0], token = await login('qa_user84_valid_0', 'x'.repeat(12));
    for (const [suffix, body, expectedField] of [
      ['email-notificaciones', { email_notificaciones: 'updated-notices84@example.invalid' }, 'email_notificaciones'],
      ['whatsapp', { whatsapp: '5493794000084' }, 'whatsapp_vinculado'],
      ['google-email', { google_email: 'configured-google84@example.invalid' }, 'google_email'],
    ]) {
      const result = checked(await api(`/usuarios/${target}/${suffix}`, { token: admin, method: 'PATCH', body }));
      noSecrets(result); assert.equal(result.id, target); assert.ok(Object.hasOwn(result, expectedField));
    }
    checked(await api('/inicio', { token }), 401);
    const current = await login('qa_user84_valid_0', 'x'.repeat(12)); checked(await api('/inicio', { token: current }));
  });

  await t.test('disabled deletion preserves an unassigned new user and its cascading personal list/block', async () => {
    const user = checked(await api('/usuarios', { token: admin, method: 'POST', body: {
      ...validCreate, usuario: 'qa_user84_cascade_only', nombre: 'QA84 retained personal lists',
      email_notificaciones: 'cascade-only84@example.invalid',
    } }), 201);
    noSecrets(user); assert.ok(Number.isSafeInteger(user.id));
    // Synthetic history seeded only inside this disposable fixture, using the
    // actual 040/041 tables, defaults and FK cascade topology without alterations.
    const [list] = await fixture.query(`INSERT INTO listas_personales(usuario_id,titulo,emoji,posicion)
      VALUES($1,$2,$3,0) RETURNING id`, [user.id, 'QA84 list retained on disabled delete', '📝']);
    const [block] = await fixture.query(`INSERT INTO lista_bloques(lista_id,tipo,contenido,posicion)
      VALUES($1,'checklist',$2::jsonb,0) RETURNING id`, [list.id, JSON.stringify({
      titulo: 'Retained synthetic checklist', items: [{ id: 'qa84-kept-item', texto: 'Must survive DELETE denial', completado: false }],
    })]);
    const [assignments] = await fixture.query('SELECT count(*)::int AS count FROM tarea_asignaciones WHERE usuario_id=$1', [user.id]);
    assert.equal(assignments.count, 0, 'No restrictive task assignment can explain this DELETE denial');
    const cascades = await fixture.query(`SELECT conrelid::regclass::text AS child,confdeltype AS action
      FROM pg_constraint WHERE contype='f' AND
        ((conrelid='listas_personales'::regclass AND confrelid='usuarios'::regclass)
        OR (conrelid='lista_bloques'::regclass AND confrelid='listas_personales'::regclass))
      ORDER BY child`);
    assert.deepEqual(cascades, [{ child: 'lista_bloques', action: 'c' }, { child: 'listas_personales', action: 'c' }]);
    const body = await unchanged(() => api(`/usuarios/${user.id}`, { token: admin, method: 'DELETE' }), 409);
    assert.equal(body.code, 'USER_DELETION_DISABLED');
    assert.deepEqual(await fixture.query('SELECT id,activo FROM usuarios WHERE id=$1', [user.id]), [{ id: user.id, activo: true }]);
    assert.deepEqual(await fixture.query('SELECT id,usuario_id FROM listas_personales WHERE id=$1', [list.id]), [{ id: list.id, usuario_id: user.id }]);
    assert.deepEqual(await fixture.query('SELECT id,lista_id FROM lista_bloques WHERE id=$1', [block.id]), [{ id: block.id, lista_id: list.id }]);
    for (const invalid of ['0', '-1', '01', 'not-an-id', '9007199254740992']) {
      await unchanged(() => api(`/usuarios/${invalid}`, { token: admin, method: 'DELETE' }), 400);
    }
    const absent = await unchanged(() => api('/usuarios/2147483647', { token: admin, method: 'DELETE' }), 409);
    assert.equal(absent.code, 'USER_DELETION_DISABLED', 'Valid IDs are blocked even without an existing row');
  });

  await t.test('provider-disabled invitation is honestly not sent and leaves account/history unchanged', async () => {
    // Harness cleanEnvironment has no SMTP credentials and denies external fetch.
    // SMTP absence is the mail safety boundary (fetch denial alone is not SMTP).
    const body = await unchanged(() => api('/usuarios/91003/invitacion', { token: admin, method: 'POST', body: {} }), 409);
    assert.equal(body.ok, undefined); assert.equal(body.destinatario, undefined);
    assert.match(body.error, /correo.*no.*configurado/i);
  });

  await t.test('self-disable is rejected and deactivation keeps the user, task, assignments and comments intact', async () => {
    await unchanged(() => api('/usuarios/91001/acceso', { token: admin, method: 'PATCH', body: { activo: false } }), 409);
    const beforeHistory = await history();
    const beforeUsers = (await snapshot()).users;
    const [before] = await fixture.query('SELECT id,session_version FROM usuarios WHERE id=91003');
    const body = checked(await api('/usuarios/91003/acceso', { token: admin, method: 'PATCH', body: { activo: false } }));
    noSecrets(body); assert.equal(body.id, 91003); assert.equal(body.activo, false);
    assert.deepEqual(await history(), beforeHistory);
    assert.deepEqual((await snapshot()).users.filter(row => row.id !== 91003), beforeUsers.filter(row => row.id !== 91003));
    assert.deepEqual(await fixture.query('SELECT id,activo,session_version FROM usuarios WHERE id=91003'),
      [{ id: 91003, activo: false, session_version: before.session_version + 1 }]);
    for (const token of [employee, employeeSecond]) await unchanged(() => api('/inicio', { token }), 401);
    checked(await api('/login', { method: 'POST', body: { usuario: 'qa_luciano', password: fixturePassword } }), 401);
    const designer = await login('qa_designer');
    const catalog = checked(await api('/usuarios', { token: designer })); assert.equal(catalog.some(row => row.id === 91003), false);
    const adminCatalog = checked(await api('/usuarios', { token: admin }));
    assert.equal(adminCatalog.find(row => row.id === 91003).activo, false);
  });

  await t.test('reactivation preserves history and cannot revive either pre-deactivation token', async () => {
    const beforeHistory = await history();
    const [before] = await fixture.query('SELECT session_version FROM usuarios WHERE id=91003');
    const result = checked(await api('/usuarios/91003/acceso', { token: admin, method: 'PATCH', body: { activo: true } }));
    noSecrets(result); assert.equal(result.id, 91003); assert.equal(result.activo, true);
    assert.equal((await fixture.query('SELECT session_version FROM usuarios WHERE id=91003'))[0].session_version, before.session_version + 1);
    assert.deepEqual(await history(), beforeHistory);
    for (const token of [employee, employeeSecond]) await unchanged(() => api('/inicio', { token }), 401);
    employee = await login('qa_luciano'); checked(await api('/inicio', { token: employee }));
    // Physical deletion is disabled regardless of restrictive assignments.
    const denied = await unchanged(() => api('/usuarios/91003', { token: admin, method: 'DELETE' }), 409);
    assert.equal(denied.code, 'USER_DELETION_DISABLED');
  });

  await t.test('current DB role and revoked epoch reject administrative writes despite earlier admin login', async () => {
    const target = createdIds[1];
    // Role-only downgrade simulates a current-DB authority change without relying
    // on the route's separate session_version bump to prove role revalidation.
    await fixture.query("UPDATE usuarios SET rol='edicion' WHERE id=91002");
    await unchanged(() => api(`/usuarios/${target}/acceso`, { token: secondAdmin, method: 'PATCH', body: { activo: false } }), 403);
    await fixture.query("UPDATE usuarios SET rol='admin',session_version=session_version+1 WHERE id=91002");
    await unchanged(() => api(`/usuarios/${target}/acceso`, { token: secondAdmin, method: 'PATCH', body: { activo: false } }), 401);
  });

  await t.test('last active owner cannot be demoted or deleted even by its own valid admin session', async () => {
    checked(await api('/usuarios/91002/acceso', { token: admin, method: 'PATCH', body: { activo: false } }));
    const [owners] = await fixture.query("SELECT count(*)::int AS count FROM usuarios WHERE rol='admin' AND activo IS TRUE");
    assert.equal(owners.count, 1);
    await unchanged(() => api('/usuarios/91001', { token: admin, method: 'PATCH', body: {
      usuario: 'qa_franco', nombre: 'Franco QA', rol: 'edicion',
    } }), 409);
    await unchanged(() => api('/usuarios/91001', { token: admin, method: 'DELETE' }), 409);
    checked(await api('/inicio', { token: admin }));
  });
});
