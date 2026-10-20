import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import pg from 'pg';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

// Discovery is safe: no application/database module or resolver import before opt-in.
test('principal login identity HTTP and real PostgreSQL first-binding CAS', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const { resolveGoogleLoginIdentity, findPasswordLoginIdentity } = await import('../src/login-identity.js');
  const fixture = await startLocalHarness({ port: 55628 });
  let pool;
  t.after(async () => {
    try { if (pool) await pool.end(); }
    finally { await fixture.cleanup(); }
    await assert.rejects(access(fixture.root, constants.F_OK), { code: 'ENOENT' });
    t.diagnostic(`Own login-identity fixture stopped and removed: ${fixture.root}`);
  });
  // Never use a configured connection string or import src/db.js in this process.
  const url = 'postgresql://render2_fixture@127.0.0.1:55628/render2_local_test';
  const guard = { root: fixture.root, cwd: fixture.root, port: 55628, url };
  assertFixtureIdentity(guard);
  pool = new pg.Pool({ connectionString: url, max: 4, statement_timeout: 10000, connectionTimeoutMillis: 5000 });
  const identity = await pool.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ ...guard, identity: identity.rows[0] });
  const api = (route, options) => request(fixture.base, `/api${route}`, options);
  const login = (usuario, password = fixturePassword) => api('/login', { method: 'POST', body: { usuario, password } });
  const ok = result => { assert.equal(result.status, 200); return result.body; };
  const admin = ok(await login('qa_franco')).token;
  const patch = (id, suffix, body, token = admin) => api(`/usuarios/${id}/${suffix}`, { method: 'PATCH', token, body });
  const accountRevision = async id => {
    const revision = ok(await api('/usuarios', { token: admin })).find(row => row.id === id)?.admin_revision;
    assert.match(revision, new RegExp(`^ua1:${id}:[0-9]+$`));
    return revision;
  };
  let sequence = 119000;
  const account = async (overrides = {}) => {
    const id = ++sequence;
    const row = { id, usuario: `qa_identity_${id}`, email: `qa-identity-${id}@example.invalid`, ...overrides };
    await pool.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version,google_email)
      SELECT $1,$2,'QA identity homonym','diseno',password_hash,TRUE,1,$3 FROM usuarios WHERE id=91004`,
    [id, row.usuario, row.email]);
    return row;
  };
  const claims = (row, sub = `qa-sub-${row.id}`) => ({ sub, email: row.email, email_verified: true });
  const stored = async id => (await pool.query('SELECT * FROM usuarios WHERE id=$1', [id])).rows[0];
  const expectStatus = (promise, status) => assert.rejects(promise, error => {
    assert.equal(error.status, status); return true;
  });
  // Execute every resolver query unchanged. Inject only once, immediately before
  // the real conditional UPDATE, after a real candidate SELECT has completed.
  const beforeBinding = mutation => {
    let reads = 0, writes = 0;
    return {
      async query(sql, values) {
        const text = typeof sql === 'string' ? sql : sql.text;
        if (/^\s*UPDATE\s+usuarios\b/i.test(text)) {
          assert.ok(reads > 0, 'binding must follow a real lookup');
          assert.equal(++writes, 1, 'resolver must not retry a binding write');
          await mutation();
        }
        const result = await pool.query(sql, values);
        if (/^\s*SELECT\b/i.test(text) && /google_email/i.test(text) && result.rows.length) reads++;
        return result;
      },
      assertBoundAttempt() { assert.equal(writes, 1); },
    };
  };
  // Nonempty business sentinel plus full ordered snapshots, not just row counts.
  await pool.query("INSERT INTO tareas(titulo,estado,asignado_a) VALUES ('QA login identity history sentinel','pendiente','Designer QA')");
  const business = async () => {
    const result = {};
    for (const table of ['tareas', 'publicaciones', 'historias', 'cliente_objetivo_eventos', 'entregas_edicion'])
      result[table] = (await pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
    return result;
  };
  const history = await business();

  await t.test('HTTP notification routing never becomes or shadows login identity', async () => {
    const a = await account();
    const b = await account({ usuario: 'qa-canonical-shadow@example.invalid' });
    const session = ok(await login(a.usuario)).token;
    ok(await patch(a.id, 'email-notificaciones', { expected_revision: await accountRevision(a.id), email_notificaciones: 'qa-notify-only@example.invalid' }));
    assert.equal((await login('qa-notify-only@example.invalid')).status, 401);
    assert.equal(ok(await login(`  ${a.usuario.toUpperCase()}  `)).usuario.id, a.id);
    assert.equal(ok(await login(a.email.toUpperCase())).usuario.id, a.id);
    assert.equal((await login(a.usuario, 'wrong synthetic password')).status, 401);
    ok(await patch(a.id, 'email-notificaciones', { expected_revision: await accountRevision(a.id), email_notificaciones: b.usuario }));
    assert.equal(ok(await login(b.usuario)).usuario.id, b.id);
    assert.equal(ok(await api('/sesion', { token: session })).usuario.id, a.id);
    assert.equal((await patch(b.id, 'google-email', { google_email: 'qa-denied@example.invalid' }, session)).status, 403);
    assert.equal((await patch(b.id, 'email-notificaciones', { email_notificaciones: 'qa-denied@example.invalid' }, session)).status, 403);
    assert.equal((await findPasswordLoginIdentity(pool, 'qa-notify-only@example.invalid')), null);
  });

  await t.test('HTTP configured email reset revokes sessions and preserves canonical identity', async () => {
    const a = await account();
    const token = ok(await login(a.usuario)).token;
    await pool.query('UPDATE usuarios SET google_id=$1 WHERE id=$2', ['qa-old-subject', a.id]);
    const nextEmail = 'qa-admin-reconfigured@example.invalid';
    ok(await patch(a.id, 'google-email', { expected_revision: await accountRevision(a.id), google_email: nextEmail }));
    assert.equal((await stored(a.id)).google_id, null);
    assert.equal((await stored(a.id)).session_version, 2);
    assert.equal((await api('/sesion', { token })).status, 401);
    assert.equal((await login(a.email)).status, 401);
    assert.equal(ok(await login(nextEmail)).usuario.id, a.id);
    const fresh = ok(await login(a.usuario)).token;
    await pool.query("UPDATE usuarios SET rol='edicion' WHERE id=$1", [a.id]);
    assert.equal(ok(await api('/sesion', { token: fresh })).usuario.rol, 'edicion');
    ok(await patch(a.id, 'acceso', { expected_revision: await accountRevision(a.id), activo: false }));
    assert.equal((await api('/sesion', { token: fresh })).status, 401);
    assert.equal((await login(a.usuario)).status, 401);
  });

  await t.test('HTTP and helper deny cross-column ambiguity', async () => {
    const a = await account();
    await account({ usuario: a.email });
    assert.equal((await login(a.email)).status, 401);
    assert.equal(await findPasswordLoginIdentity(pool, a.email), null);
  });

  await t.test('real SQL defensive claims, unknown, inactive, subject-first and current RETURNING', async () => {
    const a = await account();
    for (const invalid of [{ ...claims(a), email_verified: false }, { ...claims(a), email_verified: 'true' },
      { ...claims(a), sub: [] }, { ...claims(a), sub: '' }, { ...claims(a), email: 'invalid' }])
      await expectStatus(resolveGoogleLoginIdentity(pool, invalid), 401);
    await expectStatus(resolveGoogleLoginIdentity(pool, { sub: 'qa-unknown', email: 'qa-unknown@example.invalid', email_verified: true }), 403);
    assert.equal((await stored(a.id)).google_id, null);
    const wrapped = beforeBinding(() => pool.query("UPDATE usuarios SET nombre='QA current returned identity',rol='edicion' WHERE id=$1", [a.id]));
    const bound = await resolveGoogleLoginIdentity(wrapped, claims(a));
    wrapped.assertBoundAttempt();
    assert.equal(bound.id, a.id);
    assert.equal(bound.nombre, 'QA current returned identity');
    assert.equal(bound.rol, 'edicion');
    assert.equal(bound.password_hash, undefined);
    const b = await account();
    const subjectFirst = await resolveGoogleLoginIdentity(pool, { ...claims(a), email: b.email });
    assert.equal(subjectFirst.id, a.id);
    assert.equal((await stored(b.id)).google_id, null);
    await pool.query('UPDATE usuarios SET activo=FALSE WHERE id=$1', [a.id]);
    await expectStatus(resolveGoogleLoginIdentity(pool, claims(a)), 403);
    await pool.query('UPDATE usuarios SET activo=FALSE WHERE id=$1', [b.id]);
    await expectStatus(resolveGoogleLoginIdentity(pool, claims(b)), 403);
  });

  for (const kind of ['email reset', 'session revoke', 'deactivate', 'conflicting subject']) {
    await t.test(`real SQL CAS refuses intervening admin ${kind}`, async () => {
      const a = await account();
      let afterAdmin;
      const wrapped = beforeBinding(async () => {
        if (kind === 'email reset') ok(await patch(a.id, 'google-email', { expected_revision: await accountRevision(a.id), google_email: `qa-reset-${a.id}@example.invalid` }));
        if (kind === 'session revoke') await pool.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=$1', [a.id]);
        if (kind === 'deactivate') ok(await patch(a.id, 'acceso', { expected_revision: await accountRevision(a.id), activo: false }));
        if (kind === 'conflicting subject') await pool.query('UPDATE usuarios SET google_id=$1 WHERE id=$2', ['qa-competing-subject', a.id]);
        afterAdmin = await stored(a.id);
      });
      await expectStatus(resolveGoogleLoginIdentity(wrapped, claims(a)), 409);
      wrapped.assertBoundAttempt();
      assert.deepEqual(await stored(a.id), afterAdmin, 'stale resolver must not overwrite any committed admin state');
    });
  }

  await t.test('row-lock waiter rechecks CAS after admin commits email and version change', async () => {
    const a = await account();
    let locker, resolverClient, observer, outcome, timer;
    let releaseUpdate;
    const updateGate = new Promise(resolve => { releaseUpdate = resolve; });
    let reachedUpdate;
    const atUpdate = new Promise(resolve => { reachedUpdate = resolve; });
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Row-lock regression deadline exceeded')), 8000);
    });
    // Register a handler even if setup fails before the first bounded wait.
    deadline.catch(() => {});
    const bounded = promise => Promise.race([promise, deadline]);
    try {
      locker = await pool.connect();
      resolverClient = await pool.connect();
      observer = await pool.connect();
      const lockerPid = (await locker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const resolverPid = (await resolverClient.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await locker.query('BEGIN');
      await locker.query("SET LOCAL idle_in_transaction_session_timeout='15000ms'");
      await locker.query('SELECT id FROM usuarios WHERE id=$1 FOR UPDATE', [a.id]);
      let reads = 0, writes = 0, bindingSql;
      const wrapped = {
        async query(sql, values) {
          const text = typeof sql === 'string' ? sql : sql.text;
          if (/^\s*UPDATE\s+usuarios\b/i.test(text)) {
            assert.ok(reads > 0, 'candidate lookup must complete under the held row lock');
            assert.equal(++writes, 1, 'no binding retry');
            bindingSql = text;
            reachedUpdate();
            await updateGate;
          }
          const result = await resolverClient.query(sql, values);
          if (/^\s*SELECT\b/i.test(text) && /google_email/i.test(text) && result.rows.length) reads++;
          return result;
        },
      };
      // Attach rejection handling immediately, including failures before the gate.
      outcome = resolveGoogleLoginIdentity(wrapped, claims(a)).then(
        value => ({ value }), error => ({ error }));
      await bounded(Promise.race([atUpdate, outcome.then(() => { throw new Error('Resolver exited before UPDATE barrier'); })]));
      releaseUpdate();
      let blocked;
      // Poll actual server state, not elapsed-time assumptions. Each autocommit
      // observation gets a fresh statistics snapshot; deadline only bounds failure.
      while (!blocked) {
        const observation = await bounded(observer.query(`SELECT a.pid,a.wait_event_type,a.query
          FROM pg_stat_activity a WHERE a.pid=$1 AND a.state='active'
          AND a.wait_event_type='Lock' AND a.query=$3
          AND $2::int=ANY(pg_blocking_pids(a.pid))
          AND EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid=a.pid AND NOT l.granted)`,
        [resolverPid, lockerPid, bindingSql]));
        blocked = observation.rows[0];
      }
      assert.equal(blocked.pid, resolverPid);
      assert.equal(blocked.wait_event_type, 'Lock');
      const changed = await locker.query(`UPDATE usuarios SET session_version=session_version+1,
        google_email=$1,google_id=NULL WHERE id=$2 RETURNING *`,
      [`qa-lock-reset-${a.id}@example.invalid`, a.id]);
      await locker.query('COMMIT');
      const result = await bounded(outcome);
      assert.ok(result.error, 'stale binding must not succeed after row-lock wait');
      assert.equal(result.error.status, 409);
      assert.equal(writes, 1);
      assert.deepEqual(await stored(a.id), changed.rows[0]);
      assert.equal((await stored(a.id)).google_id, null);
    } finally {
      clearTimeout(timer);
      releaseUpdate();
      // Unlock before awaiting the pending resolver, even on observation failure.
      try { if (locker) await locker.query('ROLLBACK'); }
      finally {
        try { if (outcome) await outcome; }
        finally { observer?.release(); resolverClient?.release(); locker?.release(); }
      }
    }
  });

  await t.test('real PostgreSQL unique-subject violation becomes 409 without retry', async () => {
    const a = await account(), b = await account();
    const payload = claims(a);
    const wrapped = beforeBinding(() => pool.query('UPDATE usuarios SET google_id=$1 WHERE id=$2', [payload.sub, b.id]));
    await expectStatus(resolveGoogleLoginIdentity(wrapped, payload), 409);
    wrapped.assertBoundAttempt();
    assert.equal((await stored(a.id)).google_id, null);
    assert.equal((await stored(b.id)).google_id, payload.sub);
  });

  await t.test('two real SQL first-bindings of identical subject rendezvous before UPDATE', async () => {
    const a = await account();
    let arrivals = 0, release;
    const barrier = new Promise(resolve => { release = resolve; });
    const timer = setTimeout(release, 5000);
    const wrapped = beforeBinding(async () => { if (++arrivals === 2) release(); await barrier; });
    const other = beforeBinding(async () => { if (++arrivals === 2) release(); await barrier; });
    try {
      const results = await Promise.allSettled([resolveGoogleLoginIdentity(wrapped, claims(a)), resolveGoogleLoginIdentity(other, claims(a))]);
      assert.equal(arrivals, 2, 'both callers must reach UPDATE from unbound lookup');
      wrapped.assertBoundAttempt(); other.assertBoundAttempt();
      assert.ok(results.some(result => result.status === 'fulfilled'));
      for (const result of results) {
        if (result.status === 'fulfilled') assert.equal(result.value.id, a.id);
        else assert.equal(result.reason.status, 409);
      }
      assert.equal((await stored(a.id)).google_id, claims(a).sub);
      assert.equal((await stored(a.id)).session_version, 1);
      assert.equal((await pool.query('SELECT id FROM usuarios WHERE google_id=$1', [claims(a).sub])).rows.length, 1);
    } finally { clearTimeout(timer); release(); }
  });
  assert.deepEqual(await business(), history, 'login/admin identity operations must preserve business history');
});
