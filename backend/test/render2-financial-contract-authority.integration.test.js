import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

test('financial contract writers: current admin authority after real mutex waits and held actor through contract commit', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const f = await startLocalHarness({ port: 55755 });
  const clients = new Set();
  t.after(async () => {
    for (const db of clients) { await db.query('ROLLBACK').catch(() => {}); await db.end(); }
    await f.cleanup(); await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`QA113 cleanup ENOENT: ${f.root}; PostgreSQL port55755`);
  });
  const url = 'postgresql://render2_fixture@127.0.0.1:55755/render2_local_test';
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55755, url, identity });
  const connect = async () => {
    const db = new pg.Client({ connectionString: url, application_name: 'qa113-own-contract-barrier', statement_timeout: 20000 });
    clients.add(db); await db.connect(); return db;
  };
  const close = async db => { await db.query('ROLLBACK').catch(() => {}); await db.end(); clients.delete(db); };
  const api = (path, token, method = 'GET', body) => request(f.base, `/api${path}`, { token, method, body });
  const http = async (path, token, method = 'GET', body) => {
    const response = await fetch(new URL(`/api${path}`, f.base), { method, signal: AbortSignal.timeout(25000),
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json(), cacheControl: response.headers.get('cache-control') };
  };
  const ok = (result, status = 200) => { assert.equal(result.status, status, 'Unexpected principal HTTP status'); return result.body; };
  const login = async usuario => ok(await api('/login', null, 'POST', { usuario, password: fixturePassword })).token;
  const admin = await login('qa_franco'), otherAdmin = await login('qa_agustin'), employee = await login('qa_luciano');
  const input = { nombre: 'QA113 PRIVATE synthetic contract', importe_mensual: '1000.25', inicia_el: '2026-09-01', finaliza_el: null };
  const created = ok(await api('/contratos', admin, 'POST', input), 201);
  const rowKeys = ['id', 'nombre', 'importe_mensual', 'inicia_el', 'finaliza_el', 'activo', 'contract_revision'];
  const checkRow = row => {
    assert.deepEqual(Object.keys(row).sort(), [...rowKeys].sort());
    assert.ok(Number.isSafeInteger(row.id)); assert.match(row.contract_revision, new RegExp(`^fc1:${row.id}:[1-9][0-9]*$`));
    return row;
  };
  checkRow(created);
  const read = async (id = created.id, token = admin) => {
    const response = await http('/contratos', token), rows = ok(response);
    assert.equal(response.cacheControl, 'no-store'); assert.ok(Array.isArray(rows));
    for (const row of rows) checkRow(row);
    const current = rows.find(row => row.id === id); assert.ok(current); return current;
  };
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  const snapshot = async () => {
    const result = {};
    for (const table of tables) {
      assert.match(table, /^[a-zA-Z_][a-zA-Z_0-9]*$/);
      result[table] = await f.query(`SELECT * FROM "${table}" t ORDER BY to_jsonb(t)::text`);
    }
    return result;
  };
  const waitFor = async (db, sql, values, message) => {
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      const { rows } = await db.query(sql, values); if (rows.length) return rows[0];
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    assert.fail(message);
  };
  let sequence = 0;
  const actor = async () => {
    const id = 991300 + ++sequence, usuario = `qa113_actor_${id}`;
    await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,'QA113 isolated owner','admin',password_hash,true,1 FROM usuarios WHERE id=91001`, [id, usuario]);
    return { id, token: await login(usuario) };
  };
  const writers = [
    { name: 'create', method: 'POST', path: '/contratos', make: () => ({ ...input, nombre: `QA113 forbidden create ${sequence}` }) },
    { name: 'PATCH', method: 'PATCH', path: `/contratos/${created.id}`, make: current => ({ importe_mensual: '999.99', expected_revision: current.contract_revision }) },
    { name: 'soft archive', method: 'DELETE', path: `/contratos/${created.id}`, make: current => ({ expected_revision: current.contract_revision }) },
  ];
  const losses = [
    { name: 'epoch revocation', sql: 'UPDATE usuarios SET session_version=session_version+1 WHERE id=$1', status: 401 },
    { name: 'current role downgrade', sql: "UPDATE usuarios SET rol='edicion' WHERE id=$1", status: 403 },
    { name: 'inactive actor', sql: 'UPDATE usuarios SET activo=false WHERE id=$1', status: 401 },
  ];

  await t.test('both current owners read the same closed no-store contract projection; staff/anonymous direct CRUD cannot disclose or mutate it', async () => {
    const before = await snapshot();
    assert.deepEqual(await read(created.id, admin), created); assert.deepEqual(await read(created.id, otherAdmin), created);
    for (const [token, status] of [[employee, 403], [null, 401]]) {
      for (const [path, method, body] of [
        ['/contratos', 'GET'], ['/contratos', 'POST', input],
        [`/contratos/${created.id}`, 'PATCH', { importe_mensual: '1.00', expected_revision: created.contract_revision }],
        [`/contratos/${created.id}`, 'DELETE', { expected_revision: created.contract_revision }],
      ]) {
        const result = ok(await http(path, token, method, body), status);
        assert.equal(JSON.stringify(result).includes(input.nombre), false);
        assert.equal(JSON.stringify(result).includes('1000.25'), false);
        for (const key of ['id', 'importe_mensual', 'contract_revision']) assert.equal(Object.hasOwn(result, key), false);
      }
    }
    assert.deepEqual(await snapshot(), before);
  });

  for (const writer of writers) for (const loss of losses) {
    await t.test(`${writer.name}: ${loss.name} committed after actual account-mutex wait denies all business DML`, async () => {
      const user = await actor(), held = await read(created.id, user.token), payload = writer.make(held);
      const holder = await connect(), changer = await connect(); let pending;
      try {
        await holder.query('BEGIN'); await holder.query('SELECT pg_advisory_xact_lock(20261019,1)');
        const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        pending = http(writer.path, user.token, writer.method, payload); void pending.catch(() => {});
        await waitFor(changer, `SELECT l.pid FROM pg_locks l WHERE l.locktype='advisory'
          AND l.classid=20261019::oid AND l.objid=1::oid AND l.objsubid=2 AND NOT l.granted
          AND $1::int=ANY(pg_blocking_pids(l.pid))`, [pid], 'Authenticated actual HTTP must wait on the account-admin mutex');
        await changer.query(loss.sql, [user.id]);
        const before = await snapshot();
        await holder.query('COMMIT');
        const denied = ok(await pending, loss.status);
        assert.equal(JSON.stringify(denied).includes(input.nombre), false);
        assert.equal(Object.hasOwn(denied, 'contract_revision'), false);
        ok(await http('/contratos', user.token), loss.status);
        assert.deepEqual(await snapshot(), before);
        assert.deepEqual(await read(), held, 'Rejected writer must preserve target ID, amount, history and version');
      } finally {
        await holder.query('ROLLBACK').catch(() => {}); if (pending) await Promise.allSettled([pending]);
        await close(changer); await close(holder);
      }
    });
  }

  for (const method of ['PATCH', 'DELETE']) await t.test(`${method}: valid writer holds actor SHARE while awaiting contract row; revocation commits only after valid write`, async () => {
    const user = await actor();
    const target = ok(await api('/contratos', admin, 'POST', { ...input, nombre: `QA113 inverse ${method}` }), 201);
    const held = await read(target.id, user.token), holder = await connect(), revoker = await connect(), observer = await connect();
    const payload = { expected_revision: held.contract_revision, ...(method === 'PATCH' ? { importe_mensual: '2000.50' } : {}) };
    let pending, revoke;
    try {
      await holder.query('BEGIN'); await holder.query('SELECT id FROM contratos_financieros WHERE id=$1 FOR UPDATE', [target.id]);
      const holderPid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const before = await snapshot();
      pending = http(`/contratos/${target.id}`, user.token, method, payload); void pending.catch(() => {});
      const writer = await waitFor(observer, `SELECT pid FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND $1::int=ANY(pg_blocking_pids(pid))
        AND query ILIKE '%UPDATE contratos_financieros%'`, [holderPid], 'Actual contract writer must block on the held target row');
      const revokerPid = (await revoker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      revoke = revoker.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=$1', [user.id]); void revoke.catch(() => {});
      await waitFor(observer, `SELECT pid FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock'
        AND $2::int=ANY(pg_blocking_pids(pid))`, [revokerPid, writer.pid], 'Actor revocation must actually wait on the authorized writer actor SHARE');
      assert.deepEqual(await snapshot(), before, 'Neither waiting operation may have committed business changes yet');
      await holder.query('COMMIT');
      const ack = checkRow(ok(await pending)); assert.equal((await revoke).rowCount, 1);
      assert.equal(ack.id, target.id); assert.notEqual(ack.contract_revision, held.contract_revision);
      if (method === 'PATCH') { assert.equal(Number(ack.importe_mensual), 2000.50); assert.equal(ack.activo, true); }
      else { assert.equal(ack.activo, false); assert.ok(ack.finaliza_el); assert.equal(ack.importe_mensual, held.importe_mensual); }
      assert.equal(Number(ack.contract_revision.split(':')[2]), Number(held.contract_revision.split(':')[2]) + 1);
      const after = await snapshot();
      for (const table of tables.filter(name => !['usuarios', 'contratos_financieros'].includes(name))) assert.deepEqual(after[table], before[table], table);
      assert.deepEqual(after.usuarios.filter(row => row.id !== user.id), before.usuarios.filter(row => row.id !== user.id));
      assert.deepEqual(after.contratos_financieros.filter(row => row.id !== target.id), before.contratos_financieros.filter(row => row.id !== target.id));
      ok(await http(`/contratos/${target.id}`, user.token, method, payload), 401);
      assert.deepEqual(await snapshot(), after, 'Revoked retry cannot advance version or alter the committed contract');
      assert.deepEqual(await read(target.id), ack);
    } finally {
      await holder.query('ROLLBACK').catch(() => {});
      if (pending) await Promise.allSettled([pending]); if (revoke) await Promise.allSettled([revoke]);
      await close(observer); await close(revoker); await close(holder);
    }
  });

  await t.test('current-owner CAS remains exact; stale edits and historical soft archive never overwrite another committed amount', async () => {
    const current = await read();
    const results = await Promise.all([admin, otherAdmin].map((token, i) => http(`/contratos/${current.id}`, token, 'PATCH',
      { importe_mensual: i ? '3200.25' : '3100.25', expected_revision: current.contract_revision })));
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const winner = checkRow(results.find(result => result.status === 200).body);
    assert.equal(results.find(result => result.status === 409).body.code, 'CONTRACT_REVISION_CONFLICT');
    assert.deepEqual(await read(), winner);
    const before = await snapshot();
    ok(await http(`/contratos/${current.id}`, admin, 'DELETE', { expected_revision: current.contract_revision }), 409);
    assert.deepEqual(await snapshot(), before);
    const projectedBefore = ok(await api('/sueldos?periodo=2026-10', admin));
    const archived = checkRow(ok(await http(`/contratos/${winner.id}`, otherAdmin, 'DELETE', { expected_revision: winner.contract_revision })));
    assert.equal(archived.id, winner.id); assert.equal(archived.activo, false); assert.equal(archived.importe_mensual, winner.importe_mensual);
    const committed = await snapshot();
    const projectedAfter = ok(await api('/sueldos?periodo=2026-10', admin));
    assert.equal(projectedAfter.finance.facturacion, projectedBefore.finance.facturacion);
    assert.deepEqual(await snapshot(), committed);
  });

  await t.test('late SQL fault rolls back version and fields, releases authority locks and allows a healthy exact-CAS retry', async () => {
    const target = ok(await api('/contratos', admin, 'POST', { ...input, nombre: 'QA113 rollback contract' }), 201);
    const payload = { importe_mensual: '500.25', expected_revision: target.contract_revision };
    await f.query(`CREATE FUNCTION qa113_contract_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.id=${target.id} THEN RAISE EXCEPTION 'QA113 synthetic late SQL failure'; END IF; RETURN NEW; END $$`);
    await f.query('CREATE TRIGGER qa113_contract_fault AFTER UPDATE ON contratos_financieros FOR EACH ROW EXECUTE FUNCTION qa113_contract_fault()');
    try { const before = await snapshot(); ok(await http(`/contratos/${target.id}`, admin, 'PATCH', payload), 500); assert.deepEqual(await snapshot(), before); }
    finally { await f.query('DROP TRIGGER qa113_contract_fault ON contratos_financieros'); await f.query('DROP FUNCTION qa113_contract_fault()'); }
    const saved = checkRow(ok(await http(`/contratos/${target.id}`, admin, 'PATCH', payload)));
    assert.equal(Number(saved.importe_mensual), 500.25); assert.equal(saved.contract_revision, `fc1:${target.id}:2`);
    assert.deepEqual(await read(target.id, otherAdmin), saved);
  });
});
