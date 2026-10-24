import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { startLocalHarness, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

// Physical principal HTTP + isolated PostgreSQL + password verification.
// Node manually carries server-issued cookies: not a native-browser/TLS proof.
test('cookie financial boundary: five operational roles and two admins with current server sessions', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const f = await startLocalHarness({ port: 55853, browserSessions: true });
  t.after(async () => {
    await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`QA196 own fixture cleanup ENOENT: ${f.root}; PostgreSQL port55853`);
  });
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55853,
    url: 'postgresql://render2_fixture@127.0.0.1:55853/render2_local_test', identity });
  const origin = 'http://127.0.0.1:5195';
  const checked = (response, status = 200) => {
    assert.equal(response.status, status, 'Unexpected HTTP status; never print session/cookie payloads');
    return response.body;
  };
  async function raw(path, { method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(new URL(`/api${path}`, f.base), {
      method, redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { origin, 'sec-fetch-site': 'same-origin',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json(),
      cookie: response.headers.get('set-cookie'), context: response.headers.get('x-render-session-context') };
  }
  let loginCount = 0;
  async function login(usuario) {
    assert.ok(++loginCount <= 8, 'Bounded fixture password attempts');
    const proof = await raw('/sesion/desafio'); checked(proof);
    assert.ok(proof.cookie?.startsWith('render_dev_login='), 'Server-issued login challenge cookie');
    const response = await raw('/login/browser', { method: 'POST', body: { usuario, password: fixturePassword },
      headers: { cookie: proof.cookie.split(';')[0], 'x-render-csrf': proof.body.csrf_token } });
    const session = checked(response);
    assert.ok(response.cookie?.startsWith('render_dev_session='), 'Server-issued session cookie');
    assert.equal(Object.hasOwn(session, 'token'), false);
    assert.equal(typeof session.session_context, 'string'); assert.equal(typeof session.csrf_token, 'string');
    const jar = { cookie: response.cookie.split(';')[0], session };
    const boot = await call(jar, '/sesion');
    const observed = checked(boot);
    assert.ok(observed.session_context === session.session_context && observed.csrf_token === session.csrf_token,
      'Bootstrap verifies exact session context and CSRF, without logging either');
    assert.equal(observed.usuario.id, session.usuario.id);
    return jar;
  }
  async function call(jar, path, method = 'GET', body) {
    const headers = jar ? { cookie: jar.cookie,
      'x-render-session-context': jar.session.session_context, 'x-render-csrf': jar.session.csrf_token } : {};
    assert.equal(Object.hasOwn(headers, 'authorization'), false, 'Matrix is cookie-only');
    const response = await raw(path, { method, body, headers });
    if (jar && response.status === 200) assert.ok(response.context === jar.session.session_context,
      'Positive response proves the held cookie session');
    return response;
  }
  const admins = [await login('qa_franco'), await login('qa_agustin')];
  const actors = [
    { id: 91004, usuario: 'qa_designer', rol: 'diseno' },
    { id: 91003, usuario: 'qa_luciano', rol: 'edicion' },
  ];
  for (const rol of ['produccion', 'community', 'programacion']) {
    const usuario = `qa196_${rol}`;
    const created = checked(await call(admins[0], '/usuarios', 'POST', {
      usuario, nombre: `QA196 ${rol}`, rol, password: fixturePassword,
      email_notificaciones: `${usuario}@example.invalid`,
    }), 201);
    actors.push({ id: created.id, usuario, rol });
  }
  for (const actor of actors) {
    actor.jar = await login(actor.usuario);
    assert.equal(actor.jar.session.usuario.id, actor.id); assert.equal(actor.jar.session.usuario.rol, actor.rol);
  }
  assert.equal(loginCount, 7);
  // One explicit exception, never used by the matrix: mixed credentials must
  // be rejected, not silently upgraded to the admin bearer identity.
  const bearerResponse = await raw('/login', { method: 'POST', body: { usuario: 'qa_franco', password: fixturePassword } });
  const bearer = checked(bearerResponse).token;
  assert.equal(typeof bearer, 'string');

  const amounts = { fee: '876543.21', contract: '765432.19', expense: '654321.87', payment: '543210.76', delivery: '432109.65',
    salary: '321098.54', easy: '210987.43', intermediate: '109876.32' };
  const markers = ['QA196_PRIVATE_CONTRACT', 'QA196_PRIVATE_EXPENSE', 'QA196_PRIVATE_PAYMENT', 'qa196_private@example.invalid'];
  await f.query('UPDATE usuarios SET email_notificaciones=$1 WHERE id=91001', [markers[3]]);
  const client = checked(await call(admins[0], '/clientes', 'POST', { nombre: 'QA196 operational client' }), 201);
  const eligibleClient = checked(await call(admins[0], '/clientes', 'POST', { nombre: 'QA196 eligible first agreement' }), 201);
  const firstAgreement = checked(await call(admins[0], `/clientes/${eligibleClient.id}/acuerdo-mensual/iniciar`));
  assert.equal(firstAgreement.eligible, true);
  const firstAgreementInput = { vigente_desde: '2026-10', cuota_reels: 1, cuota_carruseles: 1,
    abono_mensual: amounts.fee, dias_historias: [1], dias_reels: [2], dias_carruseles: [3],
    disenador_responsable: 'Augusto', rubro: 'Servicios', expected_revision: firstAgreement.agreement_revision };
  const configuration = { nombre: client.nombre, rubro: 'Servicios', vigente_desde: '2026-10',
    cuota_reels: 3, cuota_carruseles: 2, dias_historias: [1, 3], dias_reels: [2], dias_carruseles: [4],
    disenador_responsable: 'Augusto', abono_mensual: amounts.fee, expected_revision: client.agreement_revision };
  checked(await call(admins[0], `/clientes/${client.id}/configuraciones`, 'POST', configuration));
  const currentClient = checked(await call(admins[0], '/clientes?periodo=2026-10')).find(row => row.id === client.id);
  assert.equal(Number(currentClient.abono_mensual), Number(amounts.fee));
  const contractInput = { nombre: markers[0], importe_mensual: amounts.contract, inicia_el: '2026-09-01', finaliza_el: null };
  const contract = checked(await call(admins[0], '/contratos', 'POST', contractInput), 201);
  await f.query(`INSERT INTO gastos_fijos_financieros(nombre,categoria,moneda,importe,dia_pago,inicia_el)
    VALUES ($1,'impuestos','ARS',$2,10,'2026-10-01')`, [markers[1], amounts.expense]);
  const [clock] = await f.query(`SELECT to_char(now() AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM-DD') AS day,
    to_char(now() AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM') AS period`);
  const paymentInput = { operation_key: randomUUID(), recipient_id: actors[0].id, fecha_pago: clock.day,
    periodo_trabajo: clock.period, moneda: 'ARS', importe: amounts.payment, referencia: markers[2], drive_url: null, attestation: true };
  const payment = checked(await call(admins[0], '/finanzas/pagos', 'POST', paymentInput), 201).payment;
  const assignmentUser = checked(await call(admins[0], '/usuarios')).find(row => row.id === actors[0].id);
  const [delivery] = await f.query(`INSERT INTO entregas_edicion
    (editor_clave,fecha_entrega,cliente_etiqueta,categoria,importe,fuente,fuente_item,confirmado_por)
    VALUES ('qa_luciano','2026-10-20',$1,'A',$2,'qa196_cookie_boundary',1,'QA196 fixture') RETURNING id`, [client.nombre, amounts.delivery]);
  for (const [key, modalidad, salary, easy, intermediate] of [
    ['german', 'mensual', amounts.salary, null, null],
    ['augusto', 'por_pieza', null, amounts.easy, amounts.intermediate],
  ]) await f.query(`INSERT INTO empleado_compensaciones(empleado_clave,vigente_desde,modalidad,sueldo_base,tarifa_facil,tarifa_intermedia)
    VALUES ($1,'2026-10-01',$2,$3,$4,$5) ON CONFLICT(empleado_clave,vigente_desde) DO UPDATE
    SET modalidad=EXCLUDED.modalidad,sueldo_base=EXCLUDED.sueldo_base,tarifa_facil=EXCLUDED.tarifa_facil,tarifa_intermedia=EXCLUDED.tarifa_intermedia`,
  [key, modalidad, salary, easy, intermediate]);
  for (const difficulty of ['facil', 'intermedio']) await f.query(`INSERT INTO tareas
    (titulo,asignado_a,cliente_id,estado,tipo_tarea,subtipo,fecha_vencimiento,propiedades_extra)
    VALUES ('QA196 carrusel','Augusto',$1,'finalizada','diseno','carrusel','2026-09-20',$2::jsonb)`,
  [client.id, JSON.stringify({ workspace: 'render_os', dificultad: difficulty })]);

  // All logins are finished. Hash every domain table; auth throttle state is
  // deliberately not used to infer domain immutability or compare user counts.
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"))
    .map(row => row.tablename).filter(name => !/^auth_|^browser_session/.test(name));
  const snapshot = async () => {
    const hashes = {};
    for (const table of tables) {
      assert.match(table, /^[a-zA-Z_][a-zA-Z_0-9]*$/);
      hashes[table] = createHash('sha256').update(JSON.stringify(await f.query(`SELECT * FROM "${table}" r ORDER BY to_jsonb(r)::text`))).digest('hex');
    }
    return hashes;
  };
  const forbidden = new Set(['importe','importe_mensual','importeMensual','abono_mensual','sueldo_base','tarifa_facil','tarifa_intermedia','tarifa_dificil',
    'finance','previousFinance','payroll','payrollPending','billingHistory','total_recorded_ars','password_hash','session_version',
    'email_notificaciones','google_email','google_id','whatsapp_id_hash','admin_revision','contract_revision','token','csrf_token','session_context']);
  function noPrivateData(body) {
    function walk(value) {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) { assert.equal(forbidden.has(key), false, `Forbidden DTO key: ${key}`); walk(child); }
    }
    walk(body);
    const text = JSON.stringify(body);
    for (const marker of [...Object.values(amounts), ...markers]) assert.equal(text.includes(marker), false, 'Private financial canary leaked');
  }
  const reportPath = '/reportes/datos?mes_configuracion=2026-10&desde=2026-10-01&hasta=2026-10-31';
  await t.test('both cookie admins see real financial canaries and compensation calculations', async () => {
    const before = await snapshot();
    for (const jar of admins) {
      assert.equal(Number(checked(await call(jar, '/clientes?periodo=2026-10')).find(row => row.id === client.id).abono_mensual), Number(amounts.fee));
      assert.equal(checked(await call(jar, '/usuarios')).find(row => row.id === 91001).email_notificaciones, markers[3]);
      assert.equal(Number(checked(await call(jar, '/contratos')).find(row => row.id === contract.id).importe_mensual), Number(amounts.contract));
      const report = checked(await call(jar, reportPath));
      assert.equal(Number(report.entregasEdicion.find(row => row.id === delivery.id).importe), Number(amounts.delivery));
      const payroll = checked(await call(jar, '/sueldos?periodo=2026-10'));
      assert.equal(payroll.finance.ingresos.find(row => row.nombre === markers[0]).importeMensual, Number(amounts.contract));
      assert.equal(payroll.finance.gastos.find(row => row.nombre === markers[1]).importe, Number(amounts.expense));
      assert.equal(payroll.payroll.find(row => row.name === 'Germán').total, Number(amounts.salary));
      assert.equal(payroll.payroll.find(row => row.name === 'Augusto').total, Number(amounts.easy) + Number(amounts.intermediate));
      assert.equal(checked(await call(jar, `/clientes/${eligibleClient.id}/acuerdo-mensual/iniciar`)).eligible, true);
      assert.ok(checked(await call(jar, '/finanzas/pagos/contexto')).recipients.some(row => row.id === actors[0].id));
      const ledger = checked(await call(jar, `/finanzas/pagos?periodo=${clock.period}`));
      assert.equal(ledger.items.find(row => row.id === payment.id).importe, amounts.payment);
    }
    assert.deepEqual(await snapshot(), before);
  });
  for (const actor of actors) await t.test(`${actor.rol}: useful cookie operational DTOs exclude private finance`, async () => {
    const before = await snapshot(), jar = actor.jar;
    const report = checked(await call(jar, reportPath)); noPrivateData(report);
    assert.deepEqual(report.usuarios.map(row => row.id), [actor.id]);
    const clients = checked(await call(jar, '/clientes?periodo=2026-10')); noPrivateData(clients);
    const visible = clients.find(row => row.id === client.id); assert.ok(visible);
    assert.equal(visible.cuota_reels, 3); assert.equal(visible.cuota_carruseles, 2);
    noPrivateData(checked(await call(jar, `/clientes/${client.id}/operacion?periodo=2026-10`)));
    const users = checked(await call(jar, '/usuarios')); noPrivateData(users);
    assert.ok(users.some(row => row.id === actor.id && row.rol === actor.rol));
    assert.ok(users.some(row => row.id === 91001 && row.nombre === 'Franco QA'));
    const home = checked(await call(jar, '/inicio')); noPrivateData(home); assert.equal(home.user.id, actor.id);
    assert.deepEqual(await snapshot(), before);
  });
  const deniedRoutes = () => [
    ['/sueldos?periodo=2026-10'], ['/contratos'], ['/finanzas/pagos/contexto'], [`/finanzas/pagos?periodo=${clock.period}`],
    [`/clientes/${eligibleClient.id}/acuerdo-mensual/iniciar`],
    [`/clientes/${eligibleClient.id}/acuerdo-mensual/iniciar`, 'POST', firstAgreementInput],
    ['/contratos', 'POST', { ...contractInput, nombre: 'QA196 denied contract' }],
    [`/contratos/${contract.id}`, 'PATCH', { importe_mensual: '111.23', expected_revision: contract.contract_revision }],
    [`/contratos/${contract.id}`, 'DELETE', { expected_revision: contract.contract_revision }],
    ['/finanzas/pagos', 'POST', { ...paymentInput, operation_key: randomUUID() }],
    [`/finanzas/pagos/${payment.id}/anular`, 'POST', { operation_key: randomUUID(), expected_revision: payment.revision, reason: 'QA196 denied void', attestation: true }],
    [`/clientes/${client.id}/configuraciones`, 'POST', { ...configuration, expected_revision: currentClient.agreement_revision }],
    [`/clientes/${client.id}/abono-proximo-mes`, 'POST', { importe: '111.23', expected_revision: currentClient.agreement_revision }],
    ['/clientes', 'POST', { nombre: 'QA196 denied client' }],
    ['/usuarios', 'POST', { usuario: 'qa196_denied', nombre: 'QA196 denied', rol: 'diseno', password: fixturePassword }],
    [`/usuarios/${assignmentUser.id}`, 'PATCH', { nombre: assignmentUser.nombre, usuario: assignmentUser.usuario, rol: 'admin', expected_revision: assignmentUser.admin_revision }],
    [`/usuarios/${assignmentUser.id}/acceso`, 'PATCH', { activo: false, expected_revision: assignmentUser.admin_revision }],
  ];
  for (const actor of [...actors, { rol: 'anonymous', jar: null }]) await t.test(`${actor.rol}: finance/admin denials with unchanged domain hashes`, async () => {
    const before = await snapshot();
    for (const [path, method = 'GET', body] of deniedRoutes()) {
      const response = await call(actor.jar, path, method, body);
      assert.equal(response.status, actor.jar ? 403 : 401, `${actor.rol} ${method} ${path}`);
      assert.notEqual(response.body?.code, 'browser_csrf_invalid', 'A transport denial cannot prove role authority');
      assert.notEqual(response.body?.code, 'browser_origin_invalid');
      assert.notEqual(response.body?.code, 'browser_session_changed');
      noPrivateData(response.body);
    }
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('the exact first-agreement payload rejected for employees succeeds for a current cookie admin', async () => {
    const saved = checked(await call(admins[0], `/clientes/${eligibleClient.id}/acuerdo-mensual/iniciar`, 'POST', firstAgreementInput));
    assert.equal(saved.cliente.id, eligibleClient.id);
    assert.notEqual(saved.cliente.agreement_revision, firstAgreement.agreement_revision);
    const stored = checked(await call(admins[0], '/clientes?periodo=2026-10')).find(row => row.id === eligibleClient.id);
    assert.equal(Number(stored.abono_mensual), Number(amounts.fee));
    assert.equal(stored.cuota_reels, 1); assert.equal(stored.cuota_carruseles, 1);
  });
  await t.test('employee cookie plus admin bearer is rejected without authority escalation or writes', async () => {
    const before = await snapshot(), jar = actors[0].jar;
    const response = await raw('/contratos', { headers: { cookie: jar.cookie, authorization: `Bearer ${bearer}`,
      'x-render-session-context': jar.session.session_context, 'x-render-csrf': jar.session.csrf_token } });
    checked(response, 400); assert.equal(response.body.code, 'browser_credentials_ambiguous');
    noPrivateData(response.body); assert.deepEqual(await snapshot(), before);
  });
  await t.test('revoked cookie epoch rejects old employee and admin sessions without domain writes', async () => {
    for (const jar of [actors[0].jar, admins[1]]) {
      await f.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=$1', [jar.session.usuario.id]);
      const before = await snapshot();
      for (const path of ['/sesion', '/inicio', '/contratos']) {
        const response = await call(jar, path); checked(response, 401); noPrivateData(response.body);
      }
      assert.deepEqual(await snapshot(), before);
    }
  });
});
