import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

// Actual principal HTTP and physical PostgreSQL lock ordering. Discovery does
// not start a listener/DB. Connections are exclusively to the generated fixture.
test('user admin writers revalidate actor after advisory wait and hold authority through commit', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55703 });
  const clients = new Set();
  t.after(async () => {
    for (const client of clients) { await client.query('ROLLBACK').catch(() => {}); await client.end(); }
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic('Own user-authority fixture and dedicated PG clients stopped and removed.');
  });
  const url = 'postgresql://render2_fixture@127.0.0.1:55703/render2_local_test';
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port: 55703, url, identity });
  const connect = async () => {
    const client = new pg.Client({ connectionString: url, application_name: 'qa85-barrier', statement_timeout: 15000 });
    clients.add(client); await client.connect(); return client;
  };
  const close = async client => {
    try { await client.query('ROLLBACK'); } finally { await client.end(); clients.delete(client); }
  };
  const checked = (result, status = 200) => { assert.equal(result.status, status, 'Expected HTTP status'); return result.body; };
  const login = async usuario => {
    const body = checked(await request(fixture.base, '/api/login', { method: 'POST', body: { usuario, password: fixturePassword } }));
    assert.equal(typeof body.token, 'string'); return body.token;
  };
  // Longer bounded HTTP timeout than the general helper permits two independently
  // observed DB barriers without turning timeout/sleep into evidence of locking.
  const mutation = async (route, token, method, body) => {
    const response = await fetch(new URL(`/api${route}`, fixture.base), { method,
      signal: AbortSignal.timeout(20000), headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const noSecrets = body => {
    for (const key of ['password', 'password_hash', 'token', 'session_version', 'google_id', 'whatsapp_id_hash'])
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
  const waitFor = async (observer, sql, values, message) => {
    const deadline = Date.now() + 3500;
    do {
      const result = await observer.query(sql, values);
      if (result.rows.length) return result.rows[0];
      // Poll pacing only. Passing requires pg_locks/pg_blocking_pids evidence.
      await new Promise(resolve => setTimeout(resolve, 15));
    } while (Date.now() < deadline);
    assert.fail(message);
  };
  let sequence = 0;
  const newActor = async () => {
    const id = 98500 + ++sequence, usuario = `qa_authority85_${sequence}`;
    const rows = await fixture.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,'QA85 isolated admin','admin',password_hash,true,1 FROM usuarios WHERE id=91001 RETURNING id`, [id, usuario]);
    assert.deepEqual(rows, [{ id }]);
    return { id, usuario, token: await login(usuario) };
  };
  // Target and history are unrelated to each newly seeded actor. Copying the
  // password hash above is fixture-only; no environment account is consulted.
  const owner = await login('qa_franco');
  const task = checked(await request(fixture.base, '/api/tareas', { token: owner, method: 'POST', body: {
    titulo: 'QA85 authority preservation task', workspace: 'render_os', tipo_tarea: 'edicion', asignado_a_id: 91003,
  } }), 201);
  assert.ok(Number.isSafeInteger(task.id));
  await fixture.query('INSERT INTO tarea_comentarios(tarea_id,autor,contenido) VALUES($1,$2,$3)',
    [task.id, 'Luciano QA', 'Synthetic history must not change during denied administration']);

  const writers = [
    { name: 'create', method: 'POST', route: '/usuarios', body: () => ({ usuario: `qa85_denied_creation_${sequence}`,
      nombre: 'QA85 forbidden creation', rol: 'edicion', password: 'Synthetic-local-creation85!', email_notificaciones: 'denied85@example.invalid' }) },
    { name: 'access', method: 'PATCH', route: '/usuarios/91003/acceso', body: () => ({ activo: false }) },
    { name: 'identity', method: 'PATCH', route: '/usuarios/91003', body: () => ({ usuario: 'qa_luciano_changed85', nombre: 'Changed QA85', rol: 'produccion' }) },
    { name: 'notification contact', method: 'PATCH', route: '/usuarios/91003/email-notificaciones', body: () => ({ email_notificaciones: 'changed85@example.invalid' }) },
    { name: 'Google identity', method: 'PATCH', route: '/usuarios/91003/google-email', body: () => ({ google_email: 'changed-google85@example.invalid' }) },
    { name: 'WhatsApp contact', method: 'PATCH', route: '/usuarios/91003/whatsapp', body: () => ({ whatsapp: '5493794000085' }) },
  ];
  const losses = [
    { name: 'revoked epoch', status: 401, sql: 'UPDATE usuarios SET session_version=session_version+1 WHERE id=$1' },
    { name: 'inactive actor', status: 401, sql: 'UPDATE usuarios SET activo=false WHERE id=$1' },
    { name: 'current role downgrade', status: 403, sql: "UPDATE usuarios SET rol='edicion' WHERE id=$1" },
    { name: 'missing actor', status: 401, sql: 'DELETE FROM usuarios WHERE id=$1' },
  ];
  for (const writer of writers) for (const loss of losses) {
    await t.test(`${writer.name}: ${loss.name} after authentication/advisory wait denies without target/history writes`, async () => {
      const actor = await newActor();
      const holder = await connect(), changer = await connect(); let pending;
      try {
        await holder.query('BEGIN');
        await holder.query('SELECT pg_advisory_xact_lock(20261019,1)');
        const holderPid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        // Attach rejection handling immediately so even an unexpected timeout is
        // settled in finally, never an unhandled asynchronous test side effect.
        pending = mutation(writer.route, actor.token, writer.method, writer.body());
        void pending.catch(() => {});
        await waitFor(changer, `SELECT l.pid FROM pg_locks l WHERE l.locktype='advisory'
          AND l.classid=20261019::oid AND l.objid=1::oid AND l.objsubid=2 AND NOT l.granted
          AND $1::int=ANY(pg_blocking_pids(l.pid))`, [holderPid],
        'Actual HTTP writer must wait on the held administration advisory lock');
        // These are committed fixture SQL changes on a separate PG connection,
        // after HTTP middleware authenticated but before the transaction actor check.
        const changed = await changer.query(loss.sql, [actor.id]); assert.equal(changed.rowCount, 1);
        const afterLoss = await snapshot();
        await holder.query('COMMIT');
        const body = checked(await pending, loss.status); noSecrets(body);
        assert.deepEqual(await snapshot(), afterLoss, 'Rejected writer must not alter accounts or operational history');
      } finally {
        await holder.query('ROLLBACK').catch(() => {});
        if (pending) await Promise.allSettled([pending]);
        await close(changer); await close(holder);
      }
    });
  }

  await t.test('normal self-target contact, access and identity writes complete without lock upgrade deadlocks', async () => {
    const actor = await newActor(); let token = actor.token;
    const before = await snapshot();
    for (const [suffix, body, field, expected, revokes] of [
      ['email-notificaciones', { email_notificaciones: 'self-notices85@example.invalid' }, 'email_notificaciones', 'self-notices85@example.invalid', false],
      ['whatsapp', { whatsapp: '5493794000185' }, 'whatsapp_vinculado', true, false],
      ['google-email', { google_email: 'self-google85@example.invalid' }, 'google_email', 'self-google85@example.invalid', true],
      ['acceso', { activo: true }, 'activo', true, true],
    ]) {
      const old = token;
      const result = checked(await mutation(`/usuarios/${actor.id}/${suffix}`, token, 'PATCH', body));
      noSecrets(result); assert.equal(result.id, actor.id); assert.equal(result[field], expected);
      if (revokes) {
        checked(await request(fixture.base, '/api/inicio', { token: old }), 401);
        token = await login(actor.usuario);
      } else checked(await request(fixture.base, '/api/inicio', { token }));
    }
    const beforeDenied = await snapshot();
    checked(await mutation(`/usuarios/${actor.id}/acceso`, token, 'PATCH', { activo: false }), 409);
    assert.deepEqual(await snapshot(), beforeDenied);
    const renamed = `${actor.usuario}_renamed`, old = token;
    const result = checked(await mutation(`/usuarios/${actor.id}`, token, 'PATCH', {
      usuario: renamed, nombre: 'QA85 self renamed', rol: 'admin',
    }));
    noSecrets(result); assert.equal(result.id, actor.id); assert.equal(result.usuario, renamed);
    checked(await request(fixture.base, '/api/inicio', { token: old }), 401);
    token = await login(renamed); checked(await request(fixture.base, '/api/inicio', { token }));
    const after = await snapshot();
    assert.deepEqual(after.users.filter(row => row.id !== actor.id), before.users.filter(row => row.id !== actor.id));
    for (const key of ['tasks', 'assignments', 'comments', 'lists', 'blocks']) assert.deepEqual(after[key], before[key]);
    assert.deepEqual(await fixture.query('SELECT id,activo,rol FROM usuarios WHERE id=$1', [actor.id]),
      [{ id: actor.id, activo: true, rol: 'admin' }]);
  });

  await t.test('inverse order: actor revocation waits for valid writer holding actor SHARE until its target update commits', async () => {
    const actor = await newActor();
    const holder = await connect(), revoker = await connect(), observer = await connect();
    let pending, revocation;
    try {
      const before = await snapshot();
      const targetRest = await fixture.query("SELECT md5((to_jsonb(u)-'email_notificaciones')::text) AS fingerprint FROM usuarios u WHERE id=91003");
      await holder.query('BEGIN'); await holder.query('SELECT id FROM usuarios WHERE id=91003 FOR UPDATE');
      const holderPid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = mutation('/usuarios/91003/email-notificaciones', actor.token, 'PATCH', { email_notificaciones: 'committed-before-revoke85@example.invalid' });
      void pending.catch(() => {});
      const writer = await waitFor(observer, `SELECT l.pid FROM pg_locks l WHERE l.locktype='advisory'
        AND l.classid=20261019::oid AND l.objid=1::oid AND l.objsubid=2 AND l.granted
        AND $1::int=ANY(pg_blocking_pids(l.pid))`, [holderPid],
      'Writer must hold administration advisory lock while waiting for the separately locked target');
      const revokerPid = (await revoker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      revocation = revoker.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=$1 RETURNING id', [actor.id]);
      void revocation.catch(() => {});
      await waitFor(observer, `SELECT pid FROM pg_stat_activity WHERE pid=$1::int
        AND wait_event_type='Lock' AND $2::int=ANY(pg_blocking_pids(pid))`, [revokerPid, writer.pid],
      'Actual actor revocation must block on the valid writer, proving authority protection through commit');
      await holder.query('COMMIT');
      const body = checked(await pending); noSecrets(body); assert.equal(body.id, 91003);
      assert.equal(body.email_notificaciones, 'committed-before-revoke85@example.invalid');
      assert.equal((await revocation).rowCount, 1);
      assert.deepEqual(await fixture.query('SELECT id,session_version FROM usuarios WHERE id=$1', [actor.id]), [{ id: actor.id, session_version: 2 }]);
      assert.deepEqual(await fixture.query("SELECT md5((to_jsonb(u)-'email_notificaciones')::text) AS fingerprint FROM usuarios u WHERE id=91003"), targetRest);
      const after = await snapshot();
      assert.deepEqual(after.users.filter(row => row.id !== actor.id && row.id !== 91003), before.users.filter(row => row.id !== actor.id && row.id !== 91003));
      for (const key of ['tasks', 'assignments', 'comments', 'lists', 'blocks']) assert.deepEqual(after[key], before[key]);
      checked(await request(fixture.base, '/api/inicio', { token: actor.token }), 401);
    } finally {
      await holder.query('ROLLBACK').catch(() => {});
      await Promise.allSettled([pending, revocation].filter(Boolean));
      await close(observer); await close(revoker); await close(holder);
    }
  });

  await t.test('two queued self-demotions serialize and preserve exactly one active administrator', async () => {
    const actors = [await newActor(), await newActor()];
    // Last subtest only: isolate ownership inside this disposable DB. The
    // preservation baseline is taken AFTER this explicit fixture-only setup.
    await fixture.query('UPDATE usuarios SET activo=false WHERE id<>ALL($1::int[])', [actors.map(actor => actor.id)]);
    const before = await snapshot();
    assert.deepEqual(await fixture.query("SELECT id FROM usuarios WHERE rol='admin' AND activo IS TRUE ORDER BY id"),
      actors.map(actor => ({ id: actor.id })));
    const holder = await connect(), observer = await connect(); const pending = [];
    try {
      await holder.query('BEGIN'); await holder.query('SELECT pg_advisory_xact_lock(20261019,1)');
      const holderPid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      for (const actor of actors) {
        const operation = mutation(`/usuarios/${actor.id}`, actor.token, 'PATCH', {
          usuario: actor.usuario, nombre: 'QA85 isolated admin', rol: 'edicion',
        });
        void operation.catch(() => {}); pending.push(operation);
      }
      const observed = await waitFor(observer, `SELECT count(DISTINCT l.pid)::int AS count
        FROM pg_locks l WHERE l.locktype='advisory' AND l.classid=20261019::oid
        AND l.objid=1::oid AND l.objsubid=2 AND NOT l.granted
        AND $1::int=ANY(pg_blocking_pids(l.pid)) HAVING count(DISTINCT l.pid)=2`, [holderPid],
      'Both independently authenticated HTTP self-demotions must wait on the held advisory lock');
      assert.equal(observed.count, 2);
      await holder.query('COMMIT');
      const results = await Promise.all(pending);
      assert.deepEqual(results.map(result => result.status).sort((a, b) => a - b), [200, 409]);
      results.forEach(result => noSecrets(result.body));
      const winner = results.findIndex(result => result.status === 200), retained = 1 - winner;
      assert.equal(results[winner].body.id, actors[winner].id); assert.equal(results[winner].body.rol, 'edicion');
      assert.deepEqual(await fixture.query('SELECT id,rol,activo,session_version FROM usuarios WHERE id=ANY($1::int[]) ORDER BY id',
        [actors.map(actor => actor.id)]), actors.map((actor, index) => ({ id: actor.id,
        rol: index === winner ? 'edicion' : 'admin', activo: true, session_version: index === winner ? 2 : 1 })));
      assert.deepEqual(await fixture.query("SELECT id FROM usuarios WHERE rol='admin' AND activo IS TRUE"), [{ id: actors[retained].id }]);
      const after = await snapshot();
      assert.deepEqual(after.users.filter(row => row.id !== actors[winner].id), before.users.filter(row => row.id !== actors[winner].id));
      for (const key of ['tasks', 'assignments', 'comments', 'lists', 'blocks']) assert.deepEqual(after[key], before[key]);
    } finally {
      await holder.query('ROLLBACK').catch(() => {});
      await Promise.allSettled(pending);
      await close(observer); await close(holder);
    }
  });
});
