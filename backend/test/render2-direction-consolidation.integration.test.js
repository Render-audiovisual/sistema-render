import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

// Bounded replacement-service HTTP proof, not a browser/router retirement claim.
// Both harness child paths deny external fetch before actual server imports.
test('direction consolidation: personal identity, global work/escalations/editorial and existing private finance', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55656, clusterOnly: true });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own direction-consolidation fixture stopped and removed: ${fixture.root}`);
  });
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port: 55656,
    url: 'postgresql://render2_fixture@127.0.0.1:55656/render2_local_test', identity });
  const [dates] = await fixture.query(`SELECT
    to_char(statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM-DD') AS today,
    to_char((statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba')::date-1,'YYYY-MM-DD') AS yesterday,
    to_char(statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM') AS period,
    to_char(date_trunc('month',statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba')-interval '1 month','YYYY-MM-DD') AS work_first`);
  const [client] = await fixture.query("INSERT INTO clientes(nombre,activo) VALUES ('QA Direction active',true) RETURNING id,nombre");
  const [inactive] = await fixture.query("INSERT INTO clientes(nombre,activo) VALUES ('QA Direction inactive',false) RETURNING id");
  const marker = 'QA_DIRECTION_FINANCE_PRIVATE_55656', amount = 732819.47;
  await fixture.query(`INSERT INTO cliente_abonos(cliente_id,vigente_desde,importe,creado_por)
    VALUES ($1,$2,$3,'QA fixture only')`, [client.id, dates.work_first, amount]);
  // /sueldos billing uses contracts, not cliente_abonos. Seed its actual source.
  const contractName = 'QA Direction private contract';
  await fixture.query(`INSERT INTO contratos_financieros(nombre,importe_mensual,inicia_el)
    VALUES ($1,$2,$3)`, [contractName, amount, dates.work_first]);
  const tasks = [];
  const task = async ({ owner = 91001, collaborators = [], state = 'pendiente', due = dates.today,
    target = null, clientId = client.id, props = {}, visible = true } = {}) => {
    const [row] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,subtipo,prioridad,
      cliente_id,fecha_vencimiento,propiedades_extra)
      VALUES ($1,'Franco QA',$2,'diseno','carrusel','media',$3,$4,$5::jsonb) RETURNING id,revision`,
    [`QA Direction task ${tasks.length}`, state, clientId, due, JSON.stringify({ workspace: 'render_os',
      escalada_a: target, motivo: marker, importe: amount, future_finance: { nested: [{ marker, importe: amount }] },
      ...props })]);
    if (owner !== null) await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,$2,'responsable')", [row.id, owner]);
    for (const id of [...new Set(collaborators)].filter(id => id !== owner))
      await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,$2,'colaborador')", [row.id, id]);
    const result = { id: row.id, revision: row.revision, state, due, target, visible,
      members: new Set([owner, ...collaborators].filter(id => id !== null)) };
    tasks.push(result); return result;
  };
  const pending = await task({ due: dates.yesterday, target: 'Franco' });
  await task({ state: 'aprobada' });
  const review = await task({ owner: 91002, state: 'en_revision', target: 'Agustín' });
  const shared = await task({ owner: 91003, collaborators: [91001, 91002, 91002], due: dates.yesterday, target: 'Líder' });
  const unassigned = await task({ owner: null, due: dates.yesterday, target: 'Franco' });
  await task({ owner: 91003, state: 'finalizada' });
  await task({ owner: 91003, state: 'publicada' });
  for (const props of [{ archivada_render_os: true }, { papelera_render_os: true }, { workspace: 'historical' }])
    await task({ props, target: 'Franco', due: dates.yesterday, visible: false });
  await task({ clientId: inactive.id, target: 'Franco', visible: false });
  const pieces = [];
  for (const [domain, table] of [['historia', 'historias'], ['publicacion', 'publicaciones']]) {
    for (const [state, date] of [['lista', dates.today], ['publicada', dates.today],
      ['bloqueada', dates.today], ['lista', dates.yesterday], ['bloqueada', dates.yesterday]]) {
      const [row] = await fixture.query(`INSERT INTO ${table}
        (cliente_id,${domain === 'publicacion' ? 'tipo,' : ''}estado,fecha_programada,idea,metadata)
        VALUES ($1,${domain === 'publicacion' ? "'video'," : ''}$2,$3,'QA Direction editorial idea',$4::jsonb) RETURNING id`,
      [client.id, state, date, JSON.stringify({ finance: { importe: amount, nested: [{ marker }] },
        publication_classification: 'confirmada_manualmente',
        publicacion_evidencia: { classification: 'confirmada_manualmente' } })]);
      pieces.push({ domain, id: row.id, state, date });
    }
  }
  const actual = await fixture.launchActual({ entry: 'server' });
  const { base } = await actual.ready;
  const api = (route, options) => request(base, `/api${route}`, options);
  const expect = (result, status = 200) => { assert.equal(result.status, status, JSON.stringify(result.body)); return result.body; };
  const login = async usuario => {
    const body = expect(await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } }));
    assert.ok(body.token); return body.token;
  };
  const owners = [{ id: 91001, usuario: 'qa_franco', nombre: 'Franco QA' },
    { id: 91002, usuario: 'qa_agustin', nombre: 'Agustin QA' }];
  for (const owner of owners) owner.token = await login(owner.usuario);
  const employee = await login('qa_luciano');
  const noFinance = value => {
    const payload = JSON.stringify(value);
    assert.ok(!payload.includes(marker) && !payload.includes(String(amount)));
    const visit = object => {
      if (!object || typeof object !== 'object') return;
      for (const [key, nested] of Object.entries(object)) {
        assert.ok(!['importe', 'importe_mensual', 'abono_mensual', 'sueldo_base', 'tarifa_facil', 'tarifa_intermedia',
          'finance', 'future_finance', 'finance_sentinel'].includes(key), `Private field leaked: ${key}`);
        visit(nested);
      }
    };
    visit(value);
  };
  const safe = result => { const body = expect(result); noFinance(body); return body; };
  const snapshot = async () => {
    const result = {};
    for (const table of ['usuarios', 'clientes', 'cliente_abonos', 'contratos_financieros', 'gastos_fijos_financieros',
      'empleado_compensaciones', 'empleado_pagos_mensuales', 'empleado_pagos_historial', 'entregas_edicion',
      'tareas', 'tarea_asignaciones', 'historias', 'publicaciones', 'editorial_publicacion_versiones', 'editorial_publicacion_eventos'])
      result[table] = await fixture.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`);
    return result;
  };
  const open = tasks.filter(t => t.visible && !['finalizada', 'publicada'].includes(t.state));
  const overdue = t => t.due !== null && t.due < dates.today;
  await t.test('two independent admin sessions keep personal home distinct from exact global workload', async () => {
    assert.notEqual(owners[0].token, owners[1].token);
    const before = await snapshot();
    for (const owner of owners) {
      assert.equal(expect(await api('/sesion', { token: owner.token })).usuario.id, owner.id);
      const home = safe(await api('/inicio', { token: owner.token }));
      const mine = open.filter(t => t.members.has(owner.id));
      assert.equal(home.user.id, owner.id); assert.equal(home.summary.open, mine.length);
      assert.equal(home.summary.overdue, mine.filter(overdue).length);
      assert.deepEqual(home.tasks.map(t => t.id).sort((a, b) => a - b), mine.map(t => t.id).sort((a, b) => a - b));
      assert.ok(!home.tasks.some(t => t.id === unassigned.id));
      const team = safe(await api('/inicio/equipo', { token: owner.token }));
      assert.equal(team.total_tasks, 5); assert.equal(team.total_overdue, 3); assert.equal(team.total_people, 3);
      assert.deepEqual(team.unassigned, { open: 1, overdue: 1 });
      assert.deepEqual(team.items, [
        { user: { id: 91001, nombre: 'Franco QA', activo: true }, open: 3, overdue: 2, review: 0, approved: 1 },
        { user: { id: 91002, nombre: 'Agustin QA', activo: true }, open: 2, overdue: 1, review: 1, approved: 0 },
        { user: { id: 91003, nombre: 'Luciano QA', activo: true }, open: 1, overdue: 1, review: 0, approved: 0 },
      ]);
    }
    assert.deepEqual(await snapshot(), before, 'Personal/team GETs preserve all fixture business/finance rows');
  });
  await t.test('pending/review label queue and cross-domain editorial buckets preserve historical truth without proof writes', async () => {
    const before = await snapshot();
    for (const owner of owners) {
      const escalation = safe(await api('/inicio/escalaciones', { token: owner.token }));
      assert.equal(escalation.total, 4);
      assert.deepEqual(new Set(escalation.items.map(item => item.id)), new Set([pending.id, review.id, shared.id, unassigned.id]));
      assert.equal(escalation.items.find(item => item.id === pending.id).estado, 'pendiente');
      assert.equal(escalation.items.find(item => item.id === review.id).estado, 'en_revision');
      for (const bucket of ['today', 'overdue', 'blocked']) {
        const selected = pieces.filter(p => bucket === 'today' ? p.date === dates.today
          : bucket === 'overdue' ? p.date < dates.today && p.state !== 'publicada' : p.state === 'bloqueada');
        const editorial = safe(await api(`/editorial-control?bucket=${bucket}`, { token: owner.token }));
        assert.deepEqual(editorial.summary, { today: 6, overdue: 4, blocked: 4, upcoming_ready: 0 });
        assert.equal(editorial.total, selected.length);
        assert.deepEqual(new Set(editorial.items.map(p => `${p.domain}:${p.id}`)), new Set(selected.map(p => `${p.domain}:${p.id}`)));
        for (const item of editorial.items) assert.equal(item.publication_classification,
          item.estado === 'publicada' ? 'historica_sin_confirmacion' : 'no_publicada');
      }
    }
    assert.deepEqual(await fixture.query('SELECT * FROM editorial_publicacion_eventos'), []);
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('both owners retain actual private payroll/contract access with explicit fixture fallback provenance', async () => {
    const before = await snapshot();
    const results = [];
    for (const owner of owners) {
      const payroll = expect(await api(`/sueldos?periodo=${dates.period}`, { token: owner.token }));
      assert.deepEqual(Object.keys(payroll).sort(), ['finance', 'previousFinance', 'exchangeRate', 'payroll', 'payrollPending', 'billingHistory'].sort());
      assert.equal(payroll.finance.period, dates.period);
      assert.equal(payroll.finance.workPeriod, dates.work_first.slice(0, 7));
      const income = payroll.finance.ingresos.find(item => item.nombre === contractName);
      assert.ok(income); assert.equal(income.importeMensual, amount);
      assert.equal(income.importe, Math.round(amount)); assert.equal(income.prorrateado, false);
      assert.equal(payroll.exchangeRate.fallback, true);
      assert.equal(payroll.exchangeRate.source, 'Cotización de respaldo');
      assert.equal(payroll.exchangeRate.updatedAt, null);
      assert.ok(Number.isFinite(payroll.exchangeRate.rounded) && payroll.exchangeRate.rounded > 0);
      results.push(payroll);
    }
    assert.deepEqual(results[0], results[1], 'Independent authorized admins receive the same finance snapshot on stable data');
    expect(await api(`/sueldos?periodo=${dates.period}`, { token: employee }), 403);
    // Source inspection: payroll/report readers issue SELECTs only. Exchange
    // rate fallback/cache has no DB writes, and the fixture denies external fetch.
    assert.deepEqual(await snapshot(), before);
    t.diagnostic('Finance verified against contratos_financieros; cliente_abonos alone is not this billing source. Exchange rate is fixture fallback, never a live quote.');
  });
  await t.test('employee operational/report DTOs stay private while team/finance ACLs remain denied', async () => {
    const before = await snapshot();
    const home = safe(await api('/inicio', { token: employee }));
    assert.equal(home.user.id, 91003); assert.deepEqual(home.tasks.map(t => t.id), [shared.id]);
    expect(await api('/inicio/equipo', { token: employee }), 403);
    expect(await api('/inicio/escalaciones', { token: employee }), 403);
    for (const bucket of ['today', 'overdue', 'blocked']) safe(await api(`/editorial-control?bucket=${bucket}`, { token: employee }));
    const report = safe(await api(`/reportes/datos?mes_configuracion=${dates.period}`, { token: employee }));
    assert.ok(report.tareasRenderOs.some(t => t.id === shared.id && t.asignado_a_id === 91003));
    expect(await api(`/sueldos?periodo=${dates.period}`, { token: employee }), 403);
    assert.deepEqual(await snapshot(), before);
    // Existing admin report contract deliberately retains private/raw task and
    // editing-delivery data. Do not invent a new admin report privacy contract.
  });
  await t.test('fresh login and current DB downgrade/revocation preserve existing service ACL boundaries', async () => {
    const second = owners[1];
    const fresh = await login(second.usuario);
    assert.equal(safe(await api('/inicio', { token: fresh })).user.id, second.id);
    await fixture.query("UPDATE usuarios SET rol='diseno' WHERE id=91002");
    try {
      const before = await snapshot();
      expect(await api('/inicio/equipo', { token: fresh }), 403);
      expect(await api(`/sueldos?periodo=${dates.period}`, { token: fresh }), 403);
      safe(await api('/editorial-control', { token: fresh }));
      assert.equal(safe(await api('/inicio', { token: fresh })).user.id, second.id);
      assert.deepEqual(await snapshot(), before);
    } finally { await fixture.query("UPDATE usuarios SET rol='admin' WHERE id=91002"); }
    const revoked = await login(second.usuario);
    await fixture.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91002');
    const before = await snapshot();
    for (const route of ['/inicio', '/inicio/equipo', '/inicio/escalaciones', '/editorial-control', `/sueldos?periodo=${dates.period}`])
      expect(await api(route, { token: revoked }), 401);
    assert.deepEqual(await snapshot(), before);
  });
});
