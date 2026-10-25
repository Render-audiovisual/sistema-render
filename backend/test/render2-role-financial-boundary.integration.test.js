import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

test('five operational roles cannot read or write private finance; both current admins can read genuine amounts', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const f = await startLocalHarness({ port: 55838 });
  t.after(async () => {
    await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`QA180 isolated fixture cleanup ENOENT: ${f.root}; port55838`);
  });
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55838,
    url: 'postgresql://render2_fixture@127.0.0.1:55838/render2_local_test', identity });
  const api = (path, token, method = 'GET', body) => request(f.base, `/api${path}`, { token, method, body });
  const ok = (response, status = 200) => {
    assert.equal(response.status, status, 'Unexpected principal HTTP status');
    return response.body;
  };
  let logins = 0;
  const login = async usuario => {
    assert.ok(++logins < 20, 'Do not exhaust the fixture login throttle');
    const body = ok(await api('/login', null, 'POST', { usuario, password: fixturePassword }));
    assert.equal(typeof body.token, 'string');
    return body.token;
  };
  const admins = [await login('qa_franco'), await login('qa_agustin')];
  const actors = [
    { id: 91004, usuario: 'qa_designer', rol: 'diseno' },
    { id: 91003, usuario: 'qa_luciano', rol: 'edicion' },
  ];
  for (const rol of ['produccion', 'community', 'programacion']) {
    const usuario = `qa180_${rol}`;
    const created = ok(await api('/usuarios', admins[0], 'POST', {
      usuario, nombre: `QA180 ${rol}`, rol, password: fixturePassword,
      email_notificaciones: `${usuario}@example.invalid`,
    }), 201);
    assert.ok(Number.isSafeInteger(created.id) && created.id > 91004);
    assert.equal(created.usuario, usuario); assert.equal(created.rol, rol);
    actors.push({ id: created.id, usuario, rol });
  }
  for (const actor of actors) {
    const [stored] = await f.query('SELECT id,usuario,rol,activo FROM usuarios WHERE id=$1', [actor.id]);
    assert.deepEqual(stored, { ...actor, activo: true });
    actor.token = await login(actor.usuario);
  }
  assert.equal(logins, 7);
  assert.deepEqual(actors.map(actor => actor.rol).sort(), ['community', 'diseno', 'edicion', 'produccion', 'programacion']);

  // Financial canaries belong only to structured private data, never to a
  // public customer/task title. Values are distinct to identify each source.
  const amounts = { fee: '876543.21', contract: '765432.19', expense: '654321.87', payment: '543210.76', delivery: '432109.65' };
  const privateContract = 'QA180_PRIVATE_CONTRACT', privateExpense = 'QA180_PRIVATE_EXPENSE';
  const privateReference = 'QA180_PRIVATE_PAYMENT_REFERENCE';
  const privateEmail = 'qa180_admin_private@example.invalid';
  await f.query('UPDATE usuarios SET email_notificaciones=$1 WHERE id=91001', [privateEmail]);
  const client = ok(await api('/clientes', admins[0], 'POST', { nombre: 'QA180 operational client' }), 201);
  const configuration = {
    nombre: client.nombre, rubro: 'Servicios', vigente_desde: '2026-10',
    cuota_reels: 3, cuota_carruseles: 2, dias_historias: [1, 3], dias_reels: [2], dias_carruseles: [4],
    disenador_responsable: 'Augusto', abono_mensual: amounts.fee, expected_revision: client.agreement_revision,
  };
  ok(await api(`/clientes/${client.id}/configuraciones`, admins[0], 'POST', configuration));
  const catalog = ok(await api('/clientes?periodo=2026-10', admins[0]));
  const currentClient = catalog.find(row => row.id === client.id);
  assert.ok(currentClient); assert.equal(Number(currentClient.abono_mensual), Number(amounts.fee));
  assert.equal(currentClient.configuracion_completa, true);
  const [storedFee] = await f.query(`SELECT cc.abono_mensual,ca.importe FROM cliente_configuraciones cc
    JOIN cliente_abonos ca ON ca.cliente_id=cc.cliente_id AND ca.vigente_desde=cc.vigente_desde
    WHERE cc.cliente_id=$1 AND cc.vigente_desde='2026-10-01'`, [client.id]);
  assert.equal(Number(storedFee.abono_mensual), Number(amounts.fee));
  assert.equal(Number(storedFee.importe), Number(amounts.fee));
  const contractInput = { nombre: privateContract, importe_mensual: amounts.contract, inicia_el: '2026-09-01', finaliza_el: null };
  const contract = ok(await api('/contratos', admins[0], 'POST', contractInput), 201);
  await f.query(`INSERT INTO gastos_fijos_financieros(nombre,categoria,moneda,importe,dia_pago,inicia_el)
    VALUES ($1,'impuestos','ARS',$2,10,'2026-10-01')`, [privateExpense, amounts.expense]);
  const [clock] = await f.query(`SELECT to_char(now() AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM-DD') AS day,
    to_char(now() AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM') AS period`);
  const paymentInput = { operation_key: randomUUID(), recipient_id: actors[0].id, fecha_pago: clock.day,
    periodo_trabajo: clock.period, moneda: 'ARS', importe: amounts.payment,
    referencia: privateReference, drive_url: null, attestation: true };
  const paymentResult = ok(await api('/finanzas/pagos', admins[0], 'POST', paymentInput), 201);
  assert.equal(paymentResult.replayed, false);
  const payment = paymentResult.payment;
  assert.equal(payment.importe, amounts.payment);
  const assignmentUser = ok(await api('/usuarios', admins[0])).find(row => row.id === actors[0].id);
  assert.ok(assignmentUser.admin_revision);
  // Original report risk: historical editing deliveries contain their own
  // private amount, independently of the finance/payments endpoints.
  const [legacyDelivery] = await f.query(`INSERT INTO entregas_edicion
    (editor_clave,fecha_entrega,cliente_etiqueta,categoria,importe,fuente,fuente_item,confirmado_por)
    VALUES('qa_luciano','2026-10-20',$1,'A',$2,'qa180_role_boundary',1,'QA180 fixture') RETURNING id`,
  [client.nombre, amounts.delivery]);

  // Snapshot every public table (not just finance): denied authority writes
  // must not modify users, client history, receipts, tasks or editorial data.
  // Login setup is complete before taking any snapshots.
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  const snapshot = async () => {
    const result = {};
    for (const table of tables) {
      assert.match(table, /^[a-zA-Z_][a-zA-Z_0-9]*$/);
      const rows = await f.query(`SELECT * FROM "${table}" t ORDER BY to_jsonb(t)::text`);
      // Equality covers every row without exposing credential/hash columns if
      // an assertion fails. These digests are diagnostic, not authentication.
      result[table] = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    }
    return result;
  };
  const forbidden = new Set(['importe', 'importe_mensual', 'importeMensual', 'abono_mensual', 'sueldo_base',
    'tarifa_facil', 'tarifa_intermedia', 'tarifa_dificil', 'finance', 'previousFinance', 'payroll', 'payrollPending',
    'billingHistory', 'total_recorded_ars', 'password_hash', 'session_version', 'email_notificaciones',
    'google_email', 'google_id', 'whatsapp_id_hash', 'admin_revision', 'contract_revision']);
  const noPrivateData = body => {
    const walk = value => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        assert.equal(forbidden.has(key), false, `Private DTO key leaked: ${key}`);
        walk(child);
      }
    };
    walk(body);
    const text = JSON.stringify(body);
    for (const marker of [...Object.values(amounts), privateContract, privateExpense, privateReference, privateEmail]) {
      assert.equal(text.includes(marker), false, 'Private structured canary leaked');
    }
  };

  await t.test('both admins retain positive amount-bearing finance/catalog reads without writes', async () => {
    const before = await snapshot();
    for (const token of admins) {
      const clients = ok(await api('/clientes?periodo=2026-10', token));
      assert.equal(Number(clients.find(row => row.id === client.id).abono_mensual), Number(amounts.fee));
      const users = ok(await api('/usuarios', token));
      assert.equal(users.find(row => row.id === 91001).email_notificaciones, privateEmail);
      const contracts = ok(await api('/contratos', token));
      assert.equal(Number(contracts.find(row => row.id === contract.id).importe_mensual), Number(amounts.contract));
      const report = ok(await api('/reportes/datos?mes_configuracion=2026-10&desde=2026-10-01&hasta=2026-10-31', token));
      assert.ok(report.entregasEdicion.some(row=>row.id===legacyDelivery.id));
      noPrivateData(report);
      // The isolated harness blocks external fetch; this exercises real local
      // payroll projections, not a live exchange-rate/provider integration.
      const payroll = ok(await api('/sueldos?periodo=2026-10', token));
      assert.equal(payroll.finance.ingresos.find(row => row.nombre === privateContract).importeMensual, Number(amounts.contract));
      assert.equal(payroll.finance.gastos.find(row => row.nombre === privateExpense).importe, Number(amounts.expense));
      const context = ok(await api('/finanzas/pagos/contexto', token));
      assert.ok(context.recipients.some(row => row.id === actors[0].id));
      const ledger = ok(await api(`/finanzas/pagos?periodo=${clock.period}`, token));
      assert.equal(ledger.items.find(row => row.id === payment.id).importe, amounts.payment);
      assert.equal(Number(ledger.total_recorded_ars), Number(amounts.payment));
    }
    assert.deepEqual(await snapshot(), before, 'Authorized GETs must not persist anything');
  });

  for (const actor of actors) await t.test(`${actor.rol}: operational catalogues stay useful but never disclose private finance`, async () => {
    const before = await snapshot();
    const report = ok(await api('/reportes/datos?mes_configuracion=2026-10&desde=2026-10-01&hasta=2026-10-31', actor.token));
    noPrivateData(report);
    assert.ok(report.usuarios.some(row=>row.id===actor.id));
    assert.ok(report.usuarios.some(row=>row.id===91001),'Operational reports include the team, without private user fields');
    const clients = ok(await api('/clientes?periodo=2026-10', actor.token));
    noPrivateData(clients);
    const visibleClient = clients.find(row => row.id === client.id);
    assert.ok(visibleClient, 'Privacy is not an empty catalogue');
    assert.equal(visibleClient.cuota_reels, 3); assert.equal(visibleClient.cuota_carruseles, 2);
    const operation = ok(await api(`/clientes/${client.id}/operacion?periodo=2026-10`, actor.token));
    noPrivateData(operation);
    const users = ok(await api('/usuarios', actor.token));
    noPrivateData(users);
    assert.ok(users.some(row => row.id === actor.id && row.rol === actor.rol));
    assert.ok(users.some(row => row.id === 91001 && row.nombre === 'Franco QA'), 'Public assignment catalogue is not own-only');
    const home = ok(await api('/inicio', actor.token));
    noPrivateData(home); assert.equal(home.user.id, actor.id);
    assert.deepEqual(await snapshot(), before, `${actor.rol} operational reads made no domain writes`);
  });

  const deniedRoutes = () => [
    ['/sueldos?periodo=2026-10'], ['/contratos'], ['/finanzas/pagos/contexto'], [`/finanzas/pagos?periodo=${clock.period}`],
    ['/contratos', 'POST', { ...contractInput, nombre: 'QA180 denied contract' }],
    [`/contratos/${contract.id}`, 'PATCH', { importe_mensual: '111.23', expected_revision: contract.contract_revision }],
    [`/contratos/${contract.id}`, 'DELETE', { expected_revision: contract.contract_revision }],
    ['/finanzas/pagos', 'POST', { ...paymentInput, operation_key: randomUUID() }],
    [`/finanzas/pagos/${payment.id}/anular`, 'POST', { operation_key: randomUUID(),
      expected_revision: payment.revision, reason: 'QA180 denied void operation', attestation: true }],
    [`/clientes/${client.id}/configuraciones`, 'POST', { ...configuration, expected_revision: currentClient.agreement_revision }],
    [`/clientes/${client.id}/abono-proximo-mes`, 'POST', { importe: '111.23', expected_revision: currentClient.agreement_revision }],
    ['/clientes', 'POST', { nombre: 'QA180 denied client' }],
    ['/usuarios', 'POST', { usuario: 'qa180_denied', nombre: 'QA180 denied user', rol: 'diseno', password: fixturePassword }],
    [`/usuarios/${assignmentUser.id}`, 'PATCH', { nombre: assignmentUser.nombre, usuario: assignmentUser.usuario,
      rol: 'admin', expected_revision: assignmentUser.admin_revision }],
    [`/usuarios/${assignmentUser.id}/acceso`, 'PATCH', { activo: false, expected_revision: assignmentUser.admin_revision }],
  ];
  for (const actor of [...actors, { rol: 'anonymous', token: null }]) await t.test(`${actor.rol}: direct financial/admin authority is denied with zero persisted changes`, async () => {
    const before = await snapshot();
    for (const [path, method = 'GET', body] of deniedRoutes()) {
      const response = await api(path, actor.token, method, body);
      assert.equal(response.status, actor.token ? 403 : 401, `${actor.rol} ${method} ${path}`);
      noPrivateData(response.body);
    }
    assert.deepEqual(await snapshot(), before, `${actor.rol}: every domain/receipt/history table byte-preserved`);
  });
});
