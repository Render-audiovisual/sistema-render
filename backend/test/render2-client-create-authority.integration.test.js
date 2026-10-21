import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, assertFixtureIdentity, request, fixturePassword } from '../scripts/render2-local-test.js';

const port = 55741;
const tables = ['clientes', 'cliente_configuraciones', 'cliente_abonos'];
const revocations = [
  { name: 'role reduction', sql: "UPDATE usuarios SET rol='edicion' WHERE id=$1", status: 403 },
  { name: 'session epoch', sql: 'UPDATE usuarios SET session_version=session_version+1 WHERE id=$1', status: 401 },
  { name: 'inactive account', sql: 'UPDATE usuarios SET activo=false WHERE id=$1', status: 401 },
];

test('canonical client creation and basic identity PATCH linearize actor authority before agreement locks', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const f = await startLocalHarness({ port });
  t.after(async () => {
    await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own client-authority fixture stopped and removed: ${f.root}`);
  });
  const url = `postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`;
  const auxiliary = async () => {
    const connection = new pg.Client({ connectionString: url, statement_timeout: 8000, lock_timeout: 6000,
      application_name: 'qa105-client-authority' });
    try {
      await connection.connect();
      const identity = (await connection.query(`SELECT current_database() database,current_user username,
        host(inet_server_addr()) address,inet_server_port() port,current_setting('data_directory') directory`)).rows[0];
      assertFixtureIdentity({ root: f.root, cwd: f.root, port, url, identity });
      connection.pid = (await connection.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      return connection;
    } catch (error) { await connection.end().catch(() => {}); throw error; }
  };
  const observed = promise => {
    const state = { settled: false, promise };
    promise.then(value => { state.settled = true; state.value = value; }, error => { state.settled = true; state.error = error; });
    return state;
  };
  const waitFor = async (read, pending, label) => {
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      if (pending?.settled) {
        if (pending.error) throw pending.error;
        assert.fail(`${label}: operation ended before the expected PostgreSQL wait (${pending.value?.status ?? 'SQL completed'})`);
      }
      const value = await read();
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    assert.fail(`${label}: bounded PostgreSQL wait not observed`);
  };
  const blocked = async (monitor, blockerPid, pattern) => (await monitor.query(`SELECT a.pid FROM pg_stat_activity a
    WHERE a.datname='render2_local_test' AND a.usename='render2_fixture' AND a.state='active'
      AND $1::int=ANY(pg_blocking_pids(a.pid)) AND a.query ILIKE $2`, [blockerPid, pattern])).rows[0]?.pid;
  const snapshot = async () => {
    const result = {};
    for (const table of tables) result[table] = await f.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`);
    return result;
  };
  const [clock] = await f.query("SELECT to_char(current_date,'YYYY-MM') period");
  let serial = 0;
  const body = (kind, name) => kind === 'basic' ? { nombre: name } : {
    nombre: name, rubro: 'Servicios', vigente_desde: clock.period, cuota_reels: 2, cuota_carruseles: 1,
    dias_historias: [1, 3], dias_reels: [2], dias_carruseles: [4], disenador_responsable: 'Augusto', abono_mensual: 817293.46,
  };
  const actor = async () => {
    const id = 105100 + ++serial, usuario = `qa105_create_${serial}`;
    await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,$3,'admin',password_hash,true,1 FROM usuarios WHERE id=91001`, [id, usuario, `QA105 creator ${serial}`]);
    const login = await request(f.base, '/api/login', { method: 'POST', body: { usuario, password: fixturePassword } });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    assert.equal(typeof login.body.token, 'string');
    return { id, token: login.body.token };
  };
  const create = (user, input) => request(f.base, '/api/clientes', { token: user.token, method: 'POST', body: input });
  const close = async connections => {
    for (const connection of connections) await connection.query('ROLLBACK').catch(() => {});
    await Promise.all(connections.map(connection => connection.end()));
  };
  const assertSaved = async (response, input, user, kind) => {
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const rows = await f.query('SELECT id,nombre FROM clientes WHERE nombre=$1', [input.nombre]);
    assert.equal(rows.length, 1); assert.equal(response.body.id, rows[0].id);
    assert.equal(response.body.configuracion_completa, kind === 'full');
    const configs = await f.query('SELECT * FROM cliente_configuraciones WHERE cliente_id=$1', [rows[0].id]);
    const fees = await f.query('SELECT * FROM cliente_abonos WHERE cliente_id=$1', [rows[0].id]);
    assert.equal(configs.length, kind === 'full' ? 1 : 0); assert.equal(fees.length, kind === 'full' ? 1 : 0);
    if (kind === 'full') {
      assert.equal(Number(configs[0].abono_mensual), input.abono_mensual);
      assert.equal(Number(fees[0].importe), input.abono_mensual);
      assert.equal(fees[0].creado_por, `QA105 fresh actor ${user.id}`);
    }
  };

  // CurrentIdentity may have passed before the barrier, but the transactional
  // actor SHARE must wait and then see the committed revocation, not that read.
  for (const kind of ['basic', 'full']) for (const revoke of revocations) {
    await t.test(`${kind}: ${revoke.name} committed before actor SHARE denies all client/config/fee writes`, async () => {
      const user = await actor(), input = body(kind, `QA105 denied ${serial}`), before = await snapshot();
      const barrier = await auxiliary(), monitor = await auxiliary(); let pending;
      try {
        await barrier.query('BEGIN');
        await barrier.query('SELECT id FROM usuarios WHERE id=$1 FOR UPDATE', [user.id]);
        pending = observed(create(user, input));
        await waitFor(() => blocked(monitor, barrier.pid, '%usuarios%FOR SHARE%'), pending, 'create actor SHARE');
        await barrier.query(revoke.sql, [user.id]);
        await barrier.query('COMMIT');
        const response = await pending.promise;
        assert.equal(response.status, revoke.status, JSON.stringify(response.body));
        assert.deepEqual(await snapshot(), before);
      } finally {
        await barrier.query('ROLLBACK').catch(() => {});
        if (pending) await Promise.allSettled([pending.promise]);
        await close([barrier, monitor]);
      }
    });
  }

  for (const revoke of revocations) await t.test(`basic identity PATCH: ${revoke.name} before actor SHARE preserves identity/configuration/fees`, async () => {
    const user = await actor(), input = body('full', `QA105 PATCH original ${serial}`);
    const created = await create(user, input);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    // Observe the canonical current revision once. The PATCH has only basic
    // identity fields: no configuration/fee POST, retries or silent CAS rebase.
    const read = await request(f.base, `/api/clientes?periodo=${clock.period}`, { token: user.token });
    assert.equal(read.status, 200, JSON.stringify(read.body));
    const current = read.body.find(row => row.id === created.body.id);
    assert.ok(current); assert.equal(current.configuracion_completa, true);
    assert.equal(typeof current.agreement_revision, 'string');
    const patch = { nombre: `${input.nombre} renamed`, activo: false, expected_revision: current.agreement_revision };
    const before = await snapshot(), barrier = await auxiliary(), monitor = await auxiliary(); let pending;
    try {
      await barrier.query('BEGIN');
      await barrier.query('SELECT id FROM usuarios WHERE id=$1 FOR UPDATE', [user.id]);
      pending = observed(request(f.base, `/api/clientes/${current.id}`, { token: user.token, method: 'PATCH', body: patch }));
      await waitFor(() => blocked(monitor, barrier.pid, '%usuarios%FOR SHARE%'), pending, 'basic PATCH actor SHARE');
      await barrier.query(revoke.sql, [user.id]);
      await barrier.query('COMMIT');
      const response = await pending.promise;
      assert.equal(response.status, revoke.status, JSON.stringify(response.body));
      assert.deepEqual(await snapshot(), before);
      const [unchanged] = await f.query('SELECT nombre,activo FROM clientes WHERE id=$1', [current.id]);
      assert.deepEqual(unchanged, { nombre: input.nombre, activo: true });
      assert.equal((await f.query('SELECT id FROM cliente_configuraciones WHERE cliente_id=$1', [current.id])).length, 1);
      assert.equal((await f.query('SELECT id FROM cliente_abonos WHERE cliente_id=$1', [current.id])).length, 1);
    } finally {
      await barrier.query('ROLLBACK').catch(() => {});
      if (pending) await Promise.allSettled([pending.promise]);
      await close([barrier, monitor]);
    }
  });

  for (const kind of ['basic', 'full']) await t.test(`${kind}: actor held while waiting advisory; queued epoch revocation follows successful commit`, async () => {
    const user = await actor(), input = body(kind, `QA105 advisory held ${serial}`);
    const barrier = await auxiliary(), revoker = await auxiliary(), monitor = await auxiliary(); let pending, revocation;
    try {
      await barrier.query('BEGIN'); await barrier.query('SELECT pg_advisory_xact_lock(8142, 1)');
      pending = observed(create(user, input));
      const createPid = await waitFor(() => blocked(monitor, barrier.pid, '%pg_advisory_xact_lock(8142, 1)%'), pending, 'create advisory');
      revocation = observed(revoker.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=$1', [user.id]));
      await waitFor(async () => (await monitor.query(`SELECT 1 FROM pg_stat_activity
        WHERE pid=$1 AND $2::int=ANY(pg_blocking_pids(pid)) AND query LIKE 'UPDATE usuarios SET session_version%'`,
      [revoker.pid, createPid])).rowCount > 0, revocation, 'revocation behind exact create PID');
      assert.equal(pending.settled, false);
      await barrier.query('COMMIT');
      const response = await pending.promise;
      assert.equal((await revocation.promise).rowCount, 1);
      // A fresh database name, changed after HTTP authentication but before its
      // actor lock, must be used for fee attribution (seeded below in the next case).
      if (kind === 'full') {
        const fees = await f.query('SELECT creado_por FROM cliente_abonos WHERE cliente_id=$1', [response.body.id]);
        assert.equal(fees[0]?.creado_por, `QA105 creator ${serial}`);
      }
      const saved = await snapshot();
      assert.equal(response.status, 201, JSON.stringify(response.body));
      const rows = await f.query('SELECT id FROM clientes WHERE nombre=$1', [input.nombre]);
      assert.equal(rows.length, 1); assert.equal(rows[0].id, response.body.id);
      for (const table of ['cliente_configuraciones', 'cliente_abonos']) {
        assert.equal((await f.query(`SELECT id FROM ${table} WHERE cliente_id=$1`, [rows[0].id])).length, kind === 'full' ? 1 : 0);
      }
      assert.equal((await create(user, body(kind, `${input.nombre} revoked`))).status, 401);
      assert.deepEqual(await snapshot(), saved);
    } finally {
      await barrier.query('ROLLBACK').catch(() => {});
      await Promise.allSettled([pending?.promise, revocation?.promise].filter(Boolean));
      await close([barrier, revoker, monitor]);
    }
  });

  await t.test('full: actor lock survives INSERT trigger sleep through commit; later revocation denies the next POST', async () => {
    const user = await actor(), input = body('full', `QA105 sleeping insert ${serial}`);
    const barrier = await auxiliary(), revoker = await auxiliary(), monitor = await auxiliary(); let pending, revocation;
    try {
      await f.query(`CREATE FUNCTION qa105_sleep_client_insert() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.nombre LIKE 'QA105 sleeping insert %' THEN PERFORM pg_sleep(3); END IF; RETURN NEW; END $$`);
      await f.query('CREATE TRIGGER qa105_client_insert_sleep BEFORE INSERT ON clientes FOR EACH ROW EXECUTE FUNCTION qa105_sleep_client_insert()');
      await barrier.query('BEGIN');
      await barrier.query('SELECT id FROM usuarios WHERE id=$1 FOR UPDATE', [user.id]);
      pending = observed(create(user, input));
      await waitFor(() => blocked(monitor, barrier.pid, '%usuarios%FOR SHARE%'), pending, 'create actor SHARE before name refresh');
      await barrier.query('UPDATE usuarios SET nombre=$2 WHERE id=$1', [user.id, `QA105 fresh actor ${user.id}`]);
      await barrier.query('COMMIT');
      const createPid = await waitFor(async () => (await monitor.query(`SELECT pid FROM pg_stat_activity
        WHERE datname='render2_local_test' AND usename='render2_fixture' AND state='active'
        AND query ILIKE '%INSERT INTO clientes%' AND wait_event='PgSleep'`)).rows[0]?.pid, pending, 'actual INSERT trigger sleep');
      revocation = observed(revoker.query('UPDATE usuarios SET activo=false,session_version=session_version+1 WHERE id=$1', [user.id]));
      await waitFor(async () => (await monitor.query(`SELECT 1 FROM pg_stat_activity
        WHERE pid=$1 AND $2::int=ANY(pg_blocking_pids(pid)) AND query LIKE 'UPDATE usuarios SET activo=false%'`,
      [revoker.pid, createPid])).rowCount > 0, revocation, 'actor revocation blocked by exact INSERT PID');
      await assertSaved(await pending.promise, input, user, 'full');
      assert.equal((await revocation.promise).rowCount, 1);
      const saved = await snapshot();
      assert.equal((await create(user, body('full', `${input.nombre} revoked`))).status, 401);
      assert.deepEqual(await snapshot(), saved);
    } finally {
      await barrier.query('ROLLBACK').catch(() => {});
      await Promise.allSettled([pending?.promise, revocation?.promise].filter(Boolean));
      await close([barrier, revoker, monitor]);
      await f.query('DROP TRIGGER IF EXISTS qa105_client_insert_sleep ON clientes');
      await f.query('DROP FUNCTION IF EXISTS qa105_sleep_client_insert()');
    }
  });
});
