import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, assertFixtureIdentity, request, fixturePassword } from '../scripts/render2-local-test.js';

const port = 55750;
const tables = ['clientes', 'cliente_configuraciones', 'cliente_abonos', 'grupos_feed', 'tareas',
  'publicaciones', 'historias', 'cliente_objetivos_mensuales', 'cliente_objetivo_piezas',
  'cliente_objetivo_eventos', 'cliente_objetivo_responsables'];

test('canonical configuration, next-month fee and empty-client deletion revalidate authority after client mutex', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const f = await startLocalHarness({ port });
  t.after(async () => {
    await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own configuration-authority fixture stopped and removed: ${f.root}`);
  });
  const url = `postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`;
  const assertIdentity = identity => assertFixtureIdentity({ root: f.root, cwd: f.root, port, url, identity });
  const identitySql = `SELECT current_database() database,current_user username,host(inet_server_addr()) address,
    inet_server_port() port,current_setting('data_directory') directory`;
  assertIdentity((await f.query(identitySql))[0]);
  const auxiliary = async () => {
    const connection = new pg.Client({ connectionString: url, statement_timeout: 8000, lock_timeout: 6000,
      application_name: 'qa109-configuration-authority' });
    try {
      await connection.connect(); assertIdentity((await connection.query(identitySql)).rows[0]);
      connection.pid = (await connection.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      return connection;
    } catch (error) { await connection.end().catch(() => {}); throw error; }
  };
  const api = (path, token, method = 'GET', body) => request(f.base, `/api${path}`, { token, method, body });
  const ok = (response, status = 200) => {
    assert.equal(response.status, status, typeof response.body?.error === 'string' ? response.body.error : 'Unexpected fixture response');
    return response.body;
  };
  const login = async usuario => {
    const result = ok(await api('/login', null, 'POST', { usuario, password: fixturePassword }));
    assert.equal(typeof result.token, 'string'); return result.token;
  };
  const admin = await login('qa_franco'), employee = await login('qa_luciano');
  const [clock] = await f.query("SELECT to_char(current_date,'YYYY-MM') period,to_char(date_trunc('month',current_date)+interval '1 month','YYYY-MM-DD') next_month");
  const seed = { nombre: 'QA109 existing configured client', rubro: 'Servicios', vigente_desde: clock.period,
    cuota_reels: 2, cuota_carruseles: 1, dias_historias: [1, 3], dias_reels: [2], dias_carruseles: [4],
    disenador_responsable: 'Augusto', abono_mensual: 817293.46 };
  const client = ok(await api('/clientes', admin, 'POST', seed), 201);
  const endpoint = `/clientes/${client.id}/configuraciones`;
  const read = async (id = client.id) => {
    const rows = ok(await api(`/clientes?periodo=${clock.period}`, admin));
    assert.ok(Array.isArray(rows));
    const row = rows.find(item => item.id === id); assert.ok(row);
    assert.match(row.agreement_revision, /^a1:[1-9]\d*:[1-9]\d*:(?:0|[1-9]\d*):(?:0|[1-9]\d*)$/);
    return row;
  };
  const input = async changes => ({ ...seed, expected_revision: (await read()).agreement_revision, ...changes });
  const snapshot = async () => {
    const result = {};
    for (const table of tables) result[table] = await f.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`);
    return result;
  };
  let serial = 0;
  const actor = async () => {
    const id = 109100 + ++serial, usuario = `qa109_config_${serial}`, name = `QA109 original actor ${id}`;
    await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,$3,'admin',password_hash,true,1 FROM usuarios WHERE id=91001`, [id, usuario, name]);
    return { id, name, token: await login(usuario) };
  };
  const observed = promise => {
    const state = { promise, settled: false };
    promise.then(value => { state.value = value; state.settled = true; }, error => { state.error = error; state.settled = true; });
    return state;
  };
  const waitFor = async (predicate, pending, label) => {
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      if (pending?.settled) {
        if (pending.error) throw pending.error;
        assert.fail(`${label}: HTTP ended before the expected PostgreSQL barrier (${pending.value?.status})`);
      }
      const result = await predicate(); if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    assert.fail(`${label}: bounded PostgreSQL barrier not observed`);
  };
  const blockedRequest = async (monitor, barrier) => (await monitor.query(`SELECT pid FROM pg_stat_activity
    WHERE datname='render2_local_test' AND usename='render2_fixture' AND state='active'
      AND $1::int=ANY(pg_blocking_pids(pid)) AND query LIKE '%pg_advisory_xact_lock(8142, 1)%'`, [barrier.pid])).rows[0]?.pid;
  const close = async connections => {
    for (const connection of connections) await connection.query('ROLLBACK').catch(() => {});
    await Promise.all(connections.map(connection => connection.end()));
  };

  for (const revoke of [
    { name: 'epoch revoked', sql: 'UPDATE usuarios SET session_version=session_version+1 WHERE id=$1', status: 401 },
    { name: 'role downgraded', sql: "UPDATE usuarios SET rol='edicion' WHERE id=$1", status: 403 },
    { name: 'account disabled', sql: 'UPDATE usuarios SET activo=false WHERE id=$1', status: 401 },
  ]) await t.test(`${revoke.name} while waiting for actual client mutex denies configuration with zero business writes`, async () => {
    const user = await actor(), body = await input({ nombre: `QA109 forbidden ${serial}`, abono_mensual: 918273.45 });
    const before = await snapshot(), barrier = await auxiliary(), revoker = await auxiliary(), monitor = await auxiliary();
    let pending, revocation;
    try {
      await barrier.query('BEGIN'); await barrier.query('SELECT pg_advisory_xact_lock(8142, 1)');
      pending = observed(api(endpoint, user.token, 'POST', body));
      const requestPid = await waitFor(() => blockedRequest(monitor, barrier), pending, 'configuration mutex wait');
      revocation = observed(revoker.query(revoke.sql, [user.id]));
      await waitFor(async () => { if (revocation.error) throw revocation.error; return revocation.settled; }, pending, 'revocation commits before mutex release');
      assert.equal((await revocation.promise).rowCount, 1);
      assert.equal(await blockedRequest(monitor, barrier), requestPid, 'Exact configuration request must still be behind the held mutex');
      assert.deepEqual(await snapshot(), before);
      await barrier.query('COMMIT');
      ok(await pending.promise, revoke.status);
      assert.deepEqual(await snapshot(), before);
    } finally {
      await barrier.query('ROLLBACK').catch(() => {});
      await Promise.allSettled([pending?.promise, revocation?.promise].filter(Boolean));
      await close([barrier, revoker, monitor]);
    }
  });

  await t.test('current database actor name after HTTP authentication, before actor SHARE, owns the saved fee attribution', async () => {
    const user = await actor(), body = await input({ nombre: 'QA109 renamed client', abono_mensual: 918273.45 });
    const name = `QA109 fresh database actor ${user.id}`;
    const barrier = await auxiliary(), renamer = await auxiliary(), monitor = await auxiliary(); let pending, rename;
    try {
      await barrier.query('BEGIN'); await barrier.query('SELECT pg_advisory_xact_lock(8142, 1)');
      pending = observed(api(endpoint, user.token, 'POST', body));
      const requestPid = await waitFor(() => blockedRequest(monitor, barrier), pending, 'configuration waits after HTTP identity read');
      rename = observed(renamer.query('UPDATE usuarios SET nombre=$2 WHERE id=$1', [user.id, name]));
      await waitFor(async () => { if (rename.error) throw rename.error; return rename.settled; }, pending, 'name refresh commits without actor lock');
      assert.equal((await rename.promise).rowCount, 1); assert.equal(await blockedRequest(monitor, barrier), requestPid);
      await barrier.query('COMMIT');
      const ack = ok(await pending.promise); assert.equal(ack.id, client.id);
      assert.notEqual(ack.agreement_revision, body.expected_revision);
      const fees = await f.query('SELECT importe,creado_por FROM cliente_abonos WHERE cliente_id=$1 AND vigente_desde=$2::date', [client.id, `${clock.period}-01`]);
      assert.equal(fees.length, 1); assert.equal(Number(fees[0].importe), body.abono_mensual);
      assert.equal(fees[0].creado_por, name); assert.notEqual(fees[0].creado_por, user.name);
      assert.equal((await read()).nombre, body.nombre);
    } finally {
      await barrier.query('ROLLBACK').catch(() => {});
      await Promise.allSettled([pending?.promise, rename?.promise].filter(Boolean));
      await close([barrier, renamer, monitor]);
    }
  });

  await t.test('invalid explicit month, raw money/quotas and weekday inputs return400 without changing any business snapshot', async () => {
    const body = await input(), before = await snapshot();
    const invalid = [];
    for (const vigente_desde of [undefined, null, '', ' ', '2026-00', '2026-13', '0000-10', '2026-1', '2026-10-01', '2026-10\n', 202610, [], {}]) invalid.push({ ...body, vigente_desde });
    for (const abono_mensual of [undefined, null, '', ' ', '\t', false, [], {}, '-1', '1.001', '01', '1e3']) invalid.push({ ...body, abono_mensual });
    for (const key of ['cuota_reels', 'cuota_carruseles']) for (const value of [undefined, null, '', ' ', false, [], {}, -1, 1.5, '01', '1e2', '2147483648']) invalid.push({ ...body, [key]: value });
    for (const dias_historias of [undefined, null, [], [true], [null], [''], ['01'], [7], [0, 1, 2, 3, 4, 5, 6, 0]]) invalid.push({ ...body, dias_historias });
    for (const key of ['dias_reels', 'dias_carruseles']) for (const value of [null, [false], [' ']]) invalid.push({ ...body, [key]: value });
    invalid.push({ ...body, unexpected_configuration_field: true });
    for (const value of invalid) {
      ok(await api(endpoint, admin, 'POST', value), 400);
      assert.deepEqual(await snapshot(), before);
    }
    // Read-only compatibility intentionally retains its legacy month fallback.
    const fallback = ok(await api('/clientes?periodo=not-a-month', admin));
    assert.ok(Array.isArray(fallback)); assert.ok(fallback.some(row => row.id === client.id));
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('valid admin configuration preserves numeric-string quota and optional weekday normalization; stale CAS409 cannot overwrite it', async () => {
    const body = await input({ cuota_reels: '3', cuota_carruseles: '2', abono_mensual: '912345.67',
      dias_historias: ['3', '1', '3'], dias_reels: undefined, dias_carruseles: undefined });
    const ack = ok(await api(endpoint, admin, 'POST', body));
    assert.equal(ack.id, client.id); assert.equal(ack.cuota_reels, 3); assert.equal(ack.cuota_carruseles, 2);
    assert.equal(Number(ack.abono_mensual), 912345.67); assert.deepEqual(ack.dias_historias, [1, 3]);
    assert.deepEqual(ack.dias_reels, []); assert.deepEqual(ack.dias_carruseles, []);
    assert.notEqual(ack.agreement_revision, body.expected_revision);
    const current = await read(); assert.equal(current.agreement_revision, ack.agreement_revision);
    assert.equal(current.cuota_reels, 3); assert.equal(current.cuota_carruseles, 2); assert.equal(Number(current.abono_mensual), 912345.67);
    const saved = await snapshot();
    const stale = await api(endpoint, admin, 'POST', { ...body, nombre: 'QA109 stale overwrite', abono_mensual: '1.00' });
    ok(stale, 409); assert.equal(stale.body.code, 'CLIENT_AGREEMENT_CONFLICT');
    assert.deepEqual(await snapshot(), saved);
  });

  await t.test('employees cannot use a current real agreement observation to configure a client', async () => {
    const body = await input(), before = await snapshot();
    ok(await api(endpoint, employee, 'POST', body), 403);
    assert.deepEqual(await snapshot(), before);
  });

  const feeEndpoint = `/clientes/${client.id}/abono-proximo-mes`;
  for (const kind of ['fee', 'delete']) for (const revoke of [
    { name: 'epoch revoked', sql: 'UPDATE usuarios SET session_version=session_version+1 WHERE id=$1', status: 401 },
    { name: 'role downgraded', sql: "UPDATE usuarios SET rol='edicion' WHERE id=$1", status: 403 },
  ]) await t.test(`${kind}: ${revoke.name} during actual mutex wait rejects with zero business writes`, async () => {
    const user = await actor();
    // Only this harness's newly created, genuinely empty client is ever a
    // deletion target; the configured/history-bearing client stays protected.
    const target = kind === 'delete' ? ok(await api('/clientes', admin, 'POST', { nombre: `QA109 empty deletion target ${user.id}` }), 201) : client;
    const current = await read(target.id);
    const path = kind === 'delete' ? `/clientes/${target.id}` : feeEndpoint;
    const method = kind === 'delete' ? 'DELETE' : 'POST';
    const body = { expected_revision: current.agreement_revision, ...(kind === 'fee' ? { importe: '123456.78' } : {}) };
    const before = await snapshot(), barrier = await auxiliary(), revoker = await auxiliary(), monitor = await auxiliary();
    let pending, revocation;
    try {
      await barrier.query('BEGIN'); await barrier.query('SELECT pg_advisory_xact_lock(8142, 1)');
      pending = observed(api(path, user.token, method, body));
      const requestPid = await waitFor(() => blockedRequest(monitor, barrier), pending, `${kind} mutex wait`);
      revocation = observed(revoker.query(revoke.sql, [user.id]));
      await waitFor(async () => { if (revocation.error) throw revocation.error; return revocation.settled; }, pending, `${kind} revocation commits before mutex release`);
      assert.equal((await revocation.promise).rowCount, 1);
      assert.equal(await blockedRequest(monitor, barrier), requestPid);
      assert.deepEqual(await snapshot(), before);
      await barrier.query('COMMIT');
      ok(await pending.promise, revoke.status);
      assert.deepEqual(await snapshot(), before);
      assert.equal((await f.query('SELECT id FROM clientes WHERE id=$1', [target.id])).length, 1);
    } finally {
      await barrier.query('ROLLBACK').catch(() => {});
      await Promise.allSettled([pending?.promise, revocation?.promise].filter(Boolean));
      await close([barrier, revoker, monitor]);
    }
  });

  await t.test('next-month fee uses current DB name after authenticated request waits on mutex', async () => {
    const user = await actor(), name = `QA109 fee current actor ${user.id}`;
    const body = { importe: '123456.78', expected_revision: (await read()).agreement_revision };
    const barrier = await auxiliary(), renamer = await auxiliary(), monitor = await auxiliary(); let pending, rename;
    try {
      await barrier.query('BEGIN'); await barrier.query('SELECT pg_advisory_xact_lock(8142, 1)');
      pending = observed(api(feeEndpoint, user.token, 'POST', body));
      const requestPid = await waitFor(() => blockedRequest(monitor, barrier), pending, 'fee mutex wait after authentication');
      rename = observed(renamer.query('UPDATE usuarios SET nombre=$2 WHERE id=$1', [user.id, name]));
      await waitFor(async () => { if (rename.error) throw rename.error; return rename.settled; }, pending, 'fee actor rename commits');
      assert.equal((await rename.promise).rowCount, 1); assert.equal(await blockedRequest(monitor, barrier), requestPid);
      await barrier.query('COMMIT');
      const ack = ok(await pending.promise);
      assert.equal(ack.cliente_id, client.id); assert.equal(ack.vigente_desde, clock.next_month);
      const [fee] = await f.query('SELECT importe,creado_por FROM cliente_abonos WHERE cliente_id=$1 AND vigente_desde=$2::date', [client.id, ack.vigente_desde]);
      assert.equal(Number(fee.importe), 123456.78); assert.equal(fee.creado_por, name); assert.notEqual(fee.creado_por, user.name);
      assert.notEqual(ack.agreement_revision, body.expected_revision);
    } finally {
      await barrier.query('ROLLBACK').catch(() => {});
      await Promise.allSettled([pending?.promise, rename?.promise].filter(Boolean));
      await close([barrier, renamer, monitor]);
    }
  });

  await t.test('fee input is closed and rejects blank/null/bool coercion without writes', async () => {
    const expected_revision = (await read()).agreement_revision, before = await snapshot();
    const bodies = [null, [], { importe: '1.00', expected_revision, extra: true }];
    for (const importe of [undefined, null, '', ' ', '\t', false, true, [], {}, '-1', '01', '1e3', '1.001']) bodies.push({ importe, expected_revision });
    for (const body of bodies) {
      ok(await api(feeEndpoint, admin, 'POST', body), 400);
      assert.deepEqual(await snapshot(), before);
    }
  });

  await t.test('explicit numeric/string zero fee is valid, preserves history and rejects stale CAS or employee writes', async () => {
    const currentFees = await f.query('SELECT * FROM cliente_abonos WHERE cliente_id=$1 AND vigente_desde<>$2::date ORDER BY id', [client.id, clock.next_month]);
    const configurations = await f.query('SELECT * FROM cliente_configuraciones ORDER BY id');
    let sent;
    for (const importe of [0, '0', '0.00']) {
      sent = { importe, expected_revision: (await read()).agreement_revision };
      const ack = ok(await api(feeEndpoint, admin, 'POST', sent));
      assert.equal(Number(ack.importe), 0); assert.equal(ack.vigente_desde, clock.next_month);
      const rows = await f.query('SELECT importe FROM cliente_abonos WHERE cliente_id=$1 AND vigente_desde=$2::date', [client.id, clock.next_month]);
      assert.equal(rows.length, 1); assert.equal(Number(rows[0].importe), 0);
    }
    assert.deepEqual(await f.query('SELECT * FROM cliente_abonos WHERE cliente_id=$1 AND vigente_desde<>$2::date ORDER BY id', [client.id, clock.next_month]), currentFees);
    assert.deepEqual(await f.query('SELECT * FROM cliente_configuraciones ORDER BY id'), configurations);
    const before = await snapshot();
    const stale = await api(feeEndpoint, admin, 'POST', { ...sent, importe: '999.00' });
    ok(stale, 409); assert.equal(stale.body.code, 'CLIENT_AGREEMENT_CONFLICT');
    ok(await api(feeEndpoint, employee, 'POST', { importe: '1.00', expected_revision: (await read()).agreement_revision }), 403);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('deletion remains limited to genuinely empty synthetic clients; configured history is never removed', async () => {
    const current = await read(), before = await snapshot();
    const denied = await api(`/clientes/${client.id}`, admin, 'DELETE', { expected_revision: current.agreement_revision });
    ok(denied, 409); assert.equal(denied.body.code, 'CLIENT_HAS_HISTORY');
    assert.deepEqual(await snapshot(), before);
    const empty = ok(await api('/clientes', admin, 'POST', { nombre: 'QA109 actual empty disposable client' }), 201);
    const observedEmpty = await read(empty.id);
    const beforeEmployee = await snapshot();
    ok(await api(`/clientes/${empty.id}`, employee, 'DELETE', { expected_revision: observedEmpty.agreement_revision }), 403);
    assert.deepEqual(await snapshot(), beforeEmployee);
    const removed = ok(await api(`/clientes/${empty.id}`, admin, 'DELETE', { expected_revision: observedEmpty.agreement_revision }));
    assert.equal(removed.ok, true); assert.equal(removed.cliente.id, empty.id);
    assert.deepEqual(await f.query('SELECT id FROM clientes WHERE id=$1', [empty.id]), []);
    assert.equal((await f.query('SELECT id FROM clientes WHERE id=$1', [client.id])).length, 1);
  });
});
