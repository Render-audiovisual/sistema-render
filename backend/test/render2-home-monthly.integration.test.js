import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

// Discovery is inert; only explicit opt-in launches our physical fresh fixture.
test('personal home monthly work progress: current-ID membership, Córdoba month and closed aggregates', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55636, clusterOnly: true });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own monthly-home fixture stopped and removed: ${fixture.root}`);
  });
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port: 55636,
    url: 'postgresql://render2_fixture@127.0.0.1:55636/render2_local_test', identity });
  const [clock] = await fixture.query(`SELECT
    to_char(statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM') AS period,
    to_char(date_trunc('month',statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba'),'YYYY-MM-DD') AS first,
    to_char(date_trunc('month',statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba')-interval '1 month','YYYY-MM-DD') AS previous,
    to_char(date_trunc('month',statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba')+interval '1 month','YYYY-MM-DD') AS next`);
  // Deliberately conflicting session timezone. The endpoint must specify Córdoba.
  await fixture.query("ALTER ROLE render2_fixture SET timezone='UTC'");
  const accounts = [
    { id: 91001, usuario: 'qa_franco', role: 'admin' },
    { id: 91003, usuario: 'qa_luciano', role: 'edicion' },
    { id: 91004, usuario: 'qa_designer', role: 'diseno' },
    ...['produccion', 'community', 'programacion'].map((role, n) => ({ id: 98601 + n, usuario: `qa_monthly_${role}`, role })),
    { id: 98604, usuario: 'qa_monthly_homonym', role: 'edicion' },
    { id: 98605, usuario: 'qa_monthly_empty', role: 'diseno' },
  ];
  for (const account of accounts.filter(a => a.id >= 98601)) {
    const inserted = await fixture.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,$3,$4,password_hash,true,1 FROM usuarios WHERE id=91004 RETURNING id`,
    [account.id, account.usuario, account.id === 98604 ? 'Luciano QA' : `QA Monthly ${account.role}`, account.role]);
    assert.deepEqual(inserted, [{ id: account.id }]);
  }
  const [client] = await fixture.query("INSERT INTO clientes(nombre,activo) VALUES ('QA Monthly active',true) RETURNING id");
  const [inactive] = await fixture.query("INSERT INTO clientes(nombre,activo) VALUES ('QA Monthly inactive',false) RETURNING id");
  const secret = 'QA_MONTHLY_PRIVATE_55636';
  await fixture.query(`INSERT INTO cliente_abonos(cliente_id,vigente_desde,importe,creado_por)
    VALUES ($1,$2,764321.89,'QA fixture')`, [client.id, clock.first]);
  const rows = [];
  let serial = 0;
  const seed = async ({ sector = 'edicion', state = 'pendiente', owner = 91003, collaborators = [],
    due = clock.first, updated = `${clock.first}T12:00:00Z`, clientId = client.id,
    props = {}, included = true } = {}) => {
    const [row] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,tipo_tarea,estado,cliente_id,
      fecha_vencimiento,updated_at,aclaraciones,propiedades_extra)
      VALUES ($1,'Luciano QA',$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id`,
    [`QA Monthly ${++serial}`, sector, state, clientId, due, updated, secret,
      JSON.stringify({ workspace: 'render_os', motivo: secret, private_finance: { importe: 764321.89 },
        colaboradores: ['Luciano QA', 'Luciano QA'], ...props })]);
    if (owner !== null) await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,$2,'responsable')", [row.id, owner]);
    for (const id of collaborators.filter(id => id !== owner)) {
      await fixture.query(`INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,$2,'colaborador')
        ON CONFLICT (tarea_id,usuario_id) DO NOTHING`, [row.id, id]);
    }
    // Expectations are declared at seed time, not derived by copying server SQL.
    const model = { id: row.id, sector: sector ?? 'sin_sector', state, included,
      client: clientId === null ? null : { id: clientId, nombre: clientId === client.id ? 'QA Monthly active' : 'QA Monthly inactive' },
      members: new Set([owner, ...collaborators].filter(id => id !== null)) };
    rows.push(model);
    return model;
  };
  const sectors = ['administracion', 'community', 'desarrollo', 'diseno', 'edicion', 'produccion', null];
  for (const sector of sectors) {
    await seed({ sector, state: 'finalizada' });
    await seed({ sector, state: 'pendiente', collaborators: [91004, 91004] });
  }
  const legacyPublished = await seed({ state: 'publicada', sector: 'diseno', clientId: null });
  const approved = await seed({ state: 'aprobada' });
  const legacyApproved = await seed({ state: 'en_revision', props: { revision_aprobada: true } });
  await seed({ state: 'programada' }); // Valid historical 058 state, not completed.
  for (const account of accounts.filter(a => ![91003, 98605].includes(a.id))) {
    await seed({ owner: account.id, sector: 'produccion', state: 'finalizada' });
  }
  await seed({ owner: 98604, collaborators: [91003, 91003], sector: 'community', state: 'publicada' });
  await seed({ owner: null, sector: 'desarrollo', state: 'finalizada' }); // Labels alone grant no membership.
  // Explicit UTC instants straddle Córdoba's midnight at 03:00Z.
  await seed({ due: null, updated: `${clock.first}T02:59:59Z`, included: false });
  await seed({ due: null, updated: `${clock.first}T03:00:00Z`, state: 'finalizada' });
  await seed({ due: null, updated: `${clock.next}T02:59:59Z`, sector: 'diseno' });
  await seed({ due: null, updated: `${clock.next}T03:00:00Z`, included: false });
  // Due date wins over updated_at in either direction.
  await seed({ due: clock.previous, updated: `${clock.first}T12:00:00Z`, included: false });
  await seed({ due: clock.next, updated: `${clock.first}T12:00:00Z`, included: false });
  await seed({ due: clock.first, updated: `${clock.previous}T12:00:00Z`, sector: null, state: 'finalizada' });
  for (const props of [{ workspace: 'historical' }, { workspace: null },
    { archivada_render_os: true }, { archivada_render_os: 'true' },
    { papelera_render_os: true }, { papelera_render_os: 'true' }]) await seed({ props, included: false, state: 'finalizada' });
  await seed({ clientId: inactive.id, state: 'finalizada', included: false });
  const launched = await fixture.launchActual({ entry: 'server' });
  const { base } = await launched.ready;
  const api = (route, options) => request(base, `/api${route}`, options);
  const ok = result => { assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body; };
  const login = async usuario => ok(await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } })).token;
  const tokens = new Map();
  for (const account of accounts) tokens.set(account.id, await login(account.usuario));
  const keys = (object, expected) => assert.deepEqual(Object.keys(object).sort(), [...expected].sort());
  const expected = id => {
    const selected = rows.filter(row => row.included && row.members.has(id));
    const groups = new Map();
    for (const row of selected) {
      const group = groups.get(row.sector) || { sector: row.sector, total: 0, completed: 0 };
      group.total++;
      if (['finalizada', 'publicada'].includes(row.state)) group.completed++;
      groups.set(row.sector, group);
    }
    const by_sector = [...groups.values()].sort((a, b) => a.sector.localeCompare(b.sector));
    const productionRows = selected.filter(row => row.sector === 'produccion');
    const clientGroups = new Map();
    for (const row of productionRows) {
      const key = row.client?.id ?? null;
      const group = clientGroups.get(key) || { client: row.client, total: 0, completed: 0 };
      group.total++; if (['finalizada', 'publicada'].includes(row.state)) group.completed++;
      clientGroups.set(key, group);
    }
    const production = { total: productionRows.length,
      completed: productionRows.filter(row => ['finalizada', 'publicada'].includes(row.state)).length,
      client_count: clientGroups.size,
      clients: [...clientGroups.values()].sort((a,b) => b.total-a.total || (a.client?.id ?? Infinity)-(b.client?.id ?? Infinity)).slice(0,8) };
    return { period: clock.period, total: selected.length,
      completed: by_sector.reduce((sum, group) => sum + group.completed, 0), by_sector, production };
  };
  const check = async (id, token = tokens.get(id)) => {
    const home = ok(await api('/inicio', { token }));
    keys(home, ['version', 'generated_at', 'today', 'user', 'summary', 'tasks', 'review', 'clients', 'visits',
      'activity', 'projects', 'capabilities', 'list_totals', 'monthly_progress']);
    assert.equal(home.version, 1); assert.equal(home.user.id, id);
    const monthly = home.monthly_progress;
    assert.ok(monthly, 'Actual endpoint must expose monthly_progress');
    keys(monthly, ['period', 'total', 'completed', 'by_sector', 'production']);
    assert.deepEqual(monthly, expected(id));
    assert.match(monthly.period, /^\d{4}-\d{2}$/);
    assert.equal(monthly.period, home.today.slice(0, 7));
    for (const group of monthly.by_sector) {
      keys(group, ['sector', 'total', 'completed']);
      assert.ok(group.total > 0 && Number.isSafeInteger(group.total));
      assert.ok(Number.isSafeInteger(group.completed) && group.completed >= 0 && group.completed <= group.total);
    }
    assert.deepEqual(monthly.by_sector.map(g => g.sector), [...monthly.by_sector.map(g => g.sector)].sort());
    assert.equal(home.review.scope, id === 91001 ? 'team' : 'personal');
    const payload = JSON.stringify(home);
    assert.ok(!payload.includes(secret) && !payload.includes('764321.89'));
    assert.ok(!JSON.stringify(monthly).includes('publicacion'), 'Work completion is not piece-publication evidence');
    return home;
  };
  const snapshot = async () => {
    const result = {};
    for (const table of ['tareas', 'tarea_asignaciones', 'clientes', 'cliente_abonos', 'historias', 'publicaciones'])
      result[table] = await fixture.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`);
    return result;
  };

  await t.test('exact seven-sector aggregates for all current roles, homonyms, collaborators and empty identity', async () => {
    const before = await snapshot();
    for (const account of accounts) await check(account.id);
    const main = await check(91003);
    assert.deepEqual(main.monthly_progress.by_sector.map(g => g.sector),
      ['administracion', 'community', 'desarrollo', 'diseno', 'edicion', 'produccion', 'sin_sector']);
    assert.notDeepEqual(main.monthly_progress, (await check(98604)).monthly_progress, 'Homonyms are distinct IDs');
    assert.deepEqual((await check(98605)).monthly_progress, { period: clock.period, total: 0, completed: 0, by_sector: [],
      production: { total: 0, completed: 0, client_count: 0, clients: [] } });
    assert.equal((await check(91001)).monthly_progress.total, 1, 'Admin does not receive global monthly totals');
    const duplicates = await fixture.query(`SELECT count(*)::int AS n FROM tarea_asignaciones
      WHERE tarea_id=$1 AND usuario_id=91004`, [rows[1].id]);
    assert.equal(duplicates[0].n, 1, 'Duplicate collaborator inputs remain one stable binding');
    assert.deepEqual(await snapshot(), before, 'Monthly reads preserve history, finance and editorial rows');
  });
  await t.test('Córdoba month edges, date fallback and due-date precedence are exact without rewriting approval/history', async () => {
    await check(91003);
    for (const item of [legacyPublished, approved, legacyApproved]) {
      const [stored] = await fixture.query('SELECT estado,propiedades_extra FROM tareas WHERE id=$1', [item.id]);
      assert.equal(stored.estado, item.state);
      if (item === legacyApproved) assert.equal(stored.propiedades_extra.revision_aprobada, true);
    }
    // Exact monthly totals count only finalizada/publicada, never approval.
    // Do not require a particular row in the independently bounded home lists.
  });
  await t.test('actual API lifecycle/month changes appear immediately and after fresh login without publication', async () => {
    const editorial = await fixture.query('SELECT to_jsonb(p) AS row FROM publicaciones p ORDER BY id');
    const result = await api('/tareas', { token: tokens.get(91001), method: 'POST', body: {
      titulo: 'QA Monthly API lifecycle', workspace: 'render_os', asignado_a_id: 91003,
      colaborador_ids: [91004, 91004], tipo_tarea: 'diseno', subtipo: 'carrusel', fecha_vencimiento: clock.first,
    } });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    const created = result.body;
    const model = { id: created.id, sector: 'diseno', state: 'pendiente', included: true, members: new Set([91003, 91004]) };
    rows.push(model);
    const patch = async body => {
      const current = ok(await api(`/tareas/${created.id}?workspace=render_os`, { token: tokens.get(91001) }));
      return ok(await api(`/tareas/${created.id}?workspace=render_os`, { token: tokens.get(91001), method: 'PATCH',
        body: { expected_revision: current.revision, ...body } }));
    };
    await check(91003); await check(91004);
    for (const state of ['en_revision', 'aprobada', 'finalizada', 'en_progreso']) {
      await patch({ estado: state }); model.state = state;
      await check(91003, await login('qa_luciano')); await check(91004);
    }
    await patch({ fecha_vencimiento: clock.next }); model.included = false;
    await check(91003, await login('qa_luciano')); await check(91004);
    await patch({ fecha_vencimiento: clock.first }); model.included = true;
    await check(91003); await check(91004, await login('qa_designer'));
    assert.deepEqual(await fixture.query('SELECT to_jsonb(p) AS row FROM publicaciones p ORDER BY id'), editorial);
  });
  await t.test('current DB role/session remains authoritative and identity query overrides are rejected', async () => {
    assert.equal((await api('/inicio')).status, 401);
    for (const query of ['usuario_id=91001', 'user_id=91001', 'rol=admin', 'period=2020-01'])
      assert.equal((await api(`/inicio?${query}`, { token: tokens.get(91003) })).status, 400);
    await fixture.query("UPDATE usuarios SET rol='admin' WHERE id=98601");
    try {
      const home = ok(await api('/inicio', { token: tokens.get(98601) }));
      assert.equal(home.review.scope, 'team');
      assert.deepEqual(home.monthly_progress, expected(98601), 'Current admin still gets only ID-bound monthly tasks');
    } finally { await fixture.query("UPDATE usuarios SET rol='produccion' WHERE id=98601"); }
    await fixture.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=98601');
    assert.equal((await api('/inicio', { token: tokens.get(98601) })).status, 401);
    await check(98601, await login('qa_monthly_produccion'));
  });
});
