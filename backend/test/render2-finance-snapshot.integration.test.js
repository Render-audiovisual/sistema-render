import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { withFinanceSnapshot } from '../src/finance-snapshot.js';

test('finance principal HTTP and physical RR helper: private projections, strict periods and no payment writes', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const f = await startLocalHarness({ port: 55752 });
  let pool;
  t.after(async () => {
    await pool?.end(); await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`QA110 cleanup ENOENT: ${f.root}; PostgreSQL port55752`);
  });
  const url = 'postgresql://render2_fixture@127.0.0.1:55752/render2_local_test';
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55752, url, identity });
  pool = new pg.Pool({ connectionString: url, max: 3, application_name: 'qa110-own-snapshot', statement_timeout: 15000 });
  const api = (path, token, method = 'GET', body) => request(f.base, `/api${path}`, { token, method, body });
  const ok = (response, status = 200) => { assert.equal(response.status, status, 'Unexpected principal HTTP status'); return response.body; };
  const login = async usuario => ok(await api('/login', null, 'POST', { usuario, password: fixturePassword })).token;
  const admin = await login('qa_franco'), secondAdmin = await login('qa_agustin'), employee = await login('qa_luciano');
  const name = 'QA110_PRIVATE_CONTRACT', expenseName = 'QA110_PRIVATE_EXPENSE';
  const [contract] = await f.query(`INSERT INTO contratos_financieros(nombre,importe_mensual,inicia_el)
    VALUES ($1,123456.78,'2026-09-01') RETURNING id`, [name]);
  const [expense] = await f.query(`INSERT INTO gastos_fijos_financieros(nombre,categoria,moneda,importe,dia_pago,inicia_el)
    VALUES ($1,'impuestos','ARS',321.09,10,'2026-10-01') RETURNING id`, [expenseName]);
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  const snapshot = async () => {
    const result = {};
    for (const table of tables) {
      assert.match(table, /^[a-zA-Z_][a-zA-Z_0-9]*$/);
      result[table] = await f.query(`SELECT * FROM "${table}" t ORDER BY to_jsonb(t)::text`);
    }
    return result;
  };
  const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
  const httpFinance = async (token, query = 'periodo=2026-10') => {
    const response = await fetch(new URL(`/api/sueldos?${query}`, f.base), {
      headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(15000),
    });
    return { status: response.status, body: await response.json(), cacheControl: response.headers.get('cache-control') };
  };

  await t.test('independent current admins receive genuine contract/expense projections, fallback provenance and no-store without DML', async () => {
    const before = await snapshot();
    for (const token of [admin, secondAdmin]) {
      const result = await httpFinance(token), body = ok(result);
      assert.equal(result.cacheControl, 'no-store');
      keys(body, ['finance', 'previousFinance', 'exchangeRate', 'payroll', 'payrollPending', 'billingHistory']);
      assert.equal(body.finance.period, '2026-10'); assert.equal(body.finance.workPeriod, '2026-09');
      assert.equal(body.previousFinance.period, '2026-09'); assert.equal(body.previousFinance.workPeriod, '2026-08');
      const income = body.finance.ingresos.find(item => item.nombre === name); assert.ok(income);
      assert.equal(income.importeMensual, 123456.78); assert.equal(income.importe, 123457);
      assert.equal(income.diasActivos, 30); assert.equal(income.diasDelMes, 30); assert.equal(income.prorrateado, false);
      assert.equal(body.previousFinance.ingresos.some(item => item.nombre === name), false);
      const tax = body.finance.gastos.find(item => item.nombre === expenseName); assert.ok(tax);
      assert.equal(tax.importe, 321.09); assert.equal(tax.moneda, 'ARS'); assert.equal(tax.categoria, 'impuestos');
      assert.equal(body.exchangeRate.fallback, true); assert.equal(body.exchangeRate.source, 'Cotización de respaldo');
      assert.equal(body.exchangeRate.updatedAt, null); assert.ok(body.exchangeRate.rounded > 0);
      assert.ok(Array.isArray(body.payroll)); assert.ok(Array.isArray(body.billingHistory));
      // Projection is not a payment receipt, paid status, or publication evidence.
      assert.equal(Object.hasOwn(body, 'payments'), false); assert.equal(Object.hasOwn(body, 'paid'), false);
    }
    assert.deepEqual(await snapshot(), before, 'All business tables, including payment ledgers, remain unchanged');
  });

  await t.test('employee/anonymous denials disclose no finance and malformed, duplicate, array or unknown queries reject read-only', async () => {
    const before = await snapshot();
    for (const [token, status] of [[employee, 403], [null, 401]]) {
      const body = ok(await httpFinance(token), status);
      for (const key of ['finance', 'payroll', 'exchangeRate', 'billingHistory']) assert.equal(Object.hasOwn(body, key), false);
      for (const marker of [name, expenseName, '123456.78', '321.09']) assert.equal(JSON.stringify(body).includes(marker), false);
    }
    for (const query of ['', 'periodo=', 'periodo=0000-10', 'periodo=2026-08', 'periodo=2026-00', 'periodo=2026-13',
      'periodo=2026-1', 'periodo=2026-10%0A', 'periodo=2026-10&periodo=2026-10', 'periodo[]=2026-10',
      'periodo[x]=2026-10', 'periodo=2026-10&usuario=Franco', 'periodo=2026-10&offset=0']) {
      const body = ok(await httpFinance(admin, query), 400);
      assert.equal(Object.hasOwn(body, 'finance'), false);
    }
    // September is the inclusive supported lower boundary, not an invalid month.
    assert.equal((await httpFinance(admin, 'periodo=2026-09')).status, 200);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('actual helper uses one physical read-only RR snapshot across independently committed financial changes', async () => {
    const before = await snapshot();
    const expectedContract = before.contratos_financieros.find(row => row.id === contract.id).importe_mensual;
    const expectedExpense = before.gastos_fijos_financieros.find(row => row.id === expense.id).importe;
    const result = await withFinanceSnapshot(pool, { id: 91001, session_version: 1 }, async db => {
      const settings = (await db.query(`SELECT current_setting('transaction_isolation') AS isolation,
        current_setting('transaction_read_only') AS readonly,pg_backend_pid() AS pid`)).rows[0];
      assert.equal(settings.isolation, 'repeatable read'); assert.equal(settings.readonly, 'on');
      const initial = (await db.query('SELECT importe_mensual FROM contratos_financieros WHERE id=$1', [contract.id])).rows[0];
      const external = await pool.connect();
      try {
        assert.notEqual((await external.query('SELECT pg_backend_pid() AS pid')).rows[0].pid, settings.pid);
        await external.query('BEGIN');
        await external.query('UPDATE contratos_financieros SET importe_mensual=223456.78 WHERE id=$1', [contract.id]);
        await external.query('UPDATE gastos_fijos_financieros SET importe=654.32 WHERE id=$1', [expense.id]);
        await external.query('COMMIT');
      } catch (error) { await external.query('ROLLBACK').catch(() => {}); throw error; }
      finally { external.release(); }
      const later = (await db.query(`SELECT c.importe_mensual,g.importe FROM contratos_financieros c
        CROSS JOIN gastos_fijos_financieros g WHERE c.id=$1 AND g.id=$2`, [contract.id, expense.id])).rows[0];
      assert.equal(initial.importe_mensual, expectedContract); assert.equal(later.importe_mensual, expectedContract);
      assert.equal(later.importe, expectedExpense); return settings.pid;
    });
    assert.ok(Number.isSafeInteger(result));
    const after = await snapshot();
    for (const table of tables.filter(table => !['contratos_financieros', 'gastos_fijos_financieros'].includes(table)))
      assert.deepEqual(after[table], before[table], table);
    assert.equal(Number(after.contratos_financieros.find(row => row.id === contract.id).importe_mensual), 223456.78);
    assert.equal(Number(after.gastos_fijos_financieros.find(row => row.id === expense.id).importe), 654.32);
    const fresh = ok(await httpFinance(admin));
    assert.equal(fresh.finance.ingresos.find(row => row.nombre === name).importeMensual, 223456.78);
    assert.equal(fresh.finance.gastos.find(row => row.nombre === expenseName).importe, 654.32);
    assert.deepEqual(await snapshot(), after, 'Fresh HTTP projection must not record the observed changes as payments');
  });

  await t.test('read-only transaction rejects SQL mutation and rolls back without changing any business rows', async () => {
    const before = await snapshot();
    await assert.rejects(withFinanceSnapshot(pool, { id: 91001, session_version: 1 }, db =>
      db.query('UPDATE contratos_financieros SET importe_mensual=0 WHERE id=$1', [contract.id])), error => error.code === '25006');
    assert.deepEqual(await snapshot(), before);
    const healthy = await withFinanceSnapshot(pool, { id: 91001, session_version: 1 }, async db => (await db.query('SELECT 1 AS ok')).rows[0].ok);
    assert.equal(healthy, 1);
  });

  for (const [index, loss] of [
    { name: 'epoch revocation', sql: 'UPDATE usuarios SET session_version=session_version+1 WHERE id=$1', status: 401 },
    { name: 'current role downgrade', sql: "UPDATE usuarios SET rol='edicion' WHERE id=$1", status: 403 },
    { name: 'inactive account', sql: 'UPDATE usuarios SET activo=false WHERE id=$1', status: 401 },
  ].entries()) await t.test(`${loss.name} before snapshot lease denies callback and financial disclosure`, async () => {
    const id = 991101 + index, usuario = `qa110_actor_${id}`;
    await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,'QA110 isolated owner','admin',password_hash,true,1 FROM usuarios WHERE id=91001`, [id, usuario]);
    const token = await login(usuario);
    let releaseLease, entered;
    const leaseGate = new Promise(resolve => { releaseLease = resolve; });
    const connectionEntered = new Promise(resolve => { entered = resolve; });
    // Delay only the lease observation; the DB client and all auth queries are
    // genuine. This proves pre-transaction revalidation, not a row-lock race.
    const delayedPool = { connect: async () => { entered(); await leaseGate; return pool.connect(); } };
    const observed = { id, session_version: 1, rol: 'admin' }; let calls = 0;
    const pending = withFinanceSnapshot(delayedPool, observed, async () => { calls++; return { forbidden: true }; });
    void pending.catch(() => {});
    try {
      await connectionEntered;
      await f.query(loss.sql, [id]);
      // Mutating the supplied object cannot retarget the captured operation to
      // a different still-valid admin while the lease is delayed.
      observed.id = 91001; observed.session_version = 1;
      const before = await snapshot(); releaseLease();
      await assert.rejects(pending, error => error.status === loss.status); assert.equal(calls, 0);
      const rejected = ok(await httpFinance(token), loss.status);
      assert.equal(Object.hasOwn(rejected, 'finance'), false); assert.equal(JSON.stringify(rejected).includes(name), false);
      assert.deepEqual(await snapshot(), before);
    } finally { releaseLease(); await Promise.allSettled([pending]); }
  });
});
