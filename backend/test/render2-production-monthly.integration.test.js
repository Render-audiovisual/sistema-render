import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

// Pure discovery is safe; physical PG and actual principal start only on opt-in.
test('monthly production HTTP: current-ID work, distinct clients and bounded private aggregates', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55658, clusterOnly: true });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own production-monthly fixture stopped and removed: ${fixture.root}`);
  });
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port: 55658,
    url: 'postgresql://render2_fixture@127.0.0.1:55658/render2_local_test', identity });
  const [dates] = await fixture.query(`SELECT
    to_char(statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM-DD') AS today,
    to_char(statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM') AS period,
    to_char(date_trunc('month',statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba'),'YYYY-MM-DD') AS first,
    to_char(date_trunc('month',statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba')-interval '1 month','YYYY-MM-DD') AS previous,
    to_char(date_trunc('month',statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba')+interval '1 month','YYYY-MM-DD') AS next`);
  await fixture.query("ALTER ROLE render2_fixture SET timezone='UTC'");
  const accounts = [{ id: 91001, usuario: 'qa_franco' }, { id: 91003, usuario: 'qa_luciano' }, { id: 91004, usuario: 'qa_designer' }];
  for (const [n, role] of ['produccion', 'produccion', 'community', 'programacion'].entries()) {
    const account = { id: 99101 + n, usuario: `qa_production_monthly_${n}` };
    const inserted = await fixture.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,$3,$4,password_hash,true,1 FROM usuarios WHERE id=91004 RETURNING id`,
    [account.id, account.usuario, n < 2 ? 'QA Production Same Name' : `QA Production ${role}`, role]);
    assert.deepEqual(inserted, [{ id: account.id }]); accounts.push(account);
  }
  const owner = 99101, homonym = 99102, clients = [];
  // clientes.nombre is UNIQUE in the physical schema. Keep distinct names and
  // verify stable ID grouping; hypothetical duplicate display names belong to
  // frontend parser tests, not a fabricated physical homonymous-client claim.
  for (let n = 0; n < 24; n++) clients.push((await fixture.query(`INSERT INTO clientes(nombre,activo)
    VALUES ($1,true) RETURNING id,nombre`, [`QA Production Client ${String(n).padStart(2, '0')}`]))[0]);
  const [inactive] = await fixture.query("INSERT INTO clientes(nombre,activo) VALUES ('QA Production inactive',false) RETURNING id,nombre");
  const secret = 'QA_PRODUCTION_MONTHLY_FINANCE_55658', amount = 756193.27;
  await fixture.query(`INSERT INTO cliente_abonos(cliente_id,vigente_desde,importe,creado_por)
    VALUES ($1,$2,$3,'QA fixture')`, [clients[0].id, dates.first, amount]);
  const rows = [];
  const seed = async ({ client = clients[0], user = owner, collaborators = [], state = 'pendiente', sector = 'produccion',
    due = dates.first, updated = `${dates.first}T12:00:00Z`, props = {}, included = true } = {}) => {
    const [row] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,subtipo,cliente_id,
      fecha_vencimiento,updated_at,propiedades_extra)
      VALUES ($1,'QA Production Same Name',$2,$3,'coordinacion',$4,$5,$6,$7::jsonb) RETURNING id`,
    [`QA Monthly Production task ${rows.length}`, state, sector, client?.id ?? null, due, updated,
      JSON.stringify({ workspace: 'render_os', colaboradores: ['QA Production Same Name', 'QA Production Same Name'],
        motivo: secret, future_finance: { nested: [{ importe: amount, marker: secret }] }, ...props })]);
    if (user !== null) await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,$2,'responsable')", [row.id, user]);
    for (const id of collaborators.filter(id => id !== user)) await fixture.query(`INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo)
      VALUES ($1,$2,'colaborador') ON CONFLICT(tarea_id,usuario_id) DO NOTHING`, [row.id, id]);
    const workMonth = due === null
      ? new Date(Date.parse(updated) - 3 * 60 * 60 * 1000).toISOString().slice(0, 7)
      : due.slice(0, 7);
    const visible = (props.workspace === undefined || props.workspace === 'render_os')
      && ![true, 'true'].includes(props.archivada_render_os) && ![true, 'true'].includes(props.papelera_render_os)
      && client?.id !== inactive.id;
    const model = { id: row.id, client, state, sector, included, visible, workMonth,
      members: new Set([user, ...collaborators].filter(id => id !== null)) };
    rows.push(model); return model;
  };
  for (const [index, client] of clients.entries()) {
    const collaborators = index < 2 ? [homonym, homonym] : [];
    await seed({ client, state: index % 2 ? 'publicada' : 'finalizada', collaborators });
    await seed({ client, collaborators });
  }
  await seed({ client: null, state: 'publicada', collaborators: [homonym, homonym] });
  await seed({ client: null, collaborators: [homonym] });
  await seed({ client: clients[23], state: 'aprobada' }); // More work, not completion.
  await seed({ client: clients[23], state: 'en_revision', props: { revision_aprobada: true } });
  await seed({ client: clients[23], state: 'programada' }); // Valid historical 058 state, not complete.
  await seed({ user: homonym, client: clients[2], state: 'finalizada' });
  await seed({ user: null, state: 'finalizada' }); // Name-only legacy task is not assigned.
  for (const id of [91001, 91003, 99103, 99104]) await seed({ user: id, state: 'finalizada' });
  for (const sector of ['diseno', 'edicion', 'community', 'administracion', 'desarrollo', null])
    await seed({ sector, state: 'finalizada' });
  for (const props of [{ workspace: 'historical' }, { workspace: null },
    { archivada_render_os: true }, { archivada_render_os: 'true' },
    { papelera_render_os: true }, { papelera_render_os: 'true' }]) await seed({ state: 'finalizada', props, included: false });
  await seed({ client: inactive, state: 'finalizada', included: false });
  // Córdoba UTC-03 month boundary, and due-date precedence in both directions.
  await seed({ due: null, updated: `${dates.first}T02:59:59Z`, state: 'finalizada', included: false });
  await seed({ due: null, updated: `${dates.first}T03:00:00Z`, state: 'finalizada' });
  await seed({ due: null, updated: `${dates.next}T02:59:59Z` });
  await seed({ due: null, updated: `${dates.next}T03:00:00Z`, state: 'finalizada', included: false });
  await seed({ due: dates.previous, updated: `${dates.first}T12:00:00Z`, included: false });
  await seed({ due: dates.next, updated: `${dates.first}T12:00:00Z`, included: false });
  await seed({ due: dates.first, updated: `${dates.previous}T12:00:00Z`, state: 'finalizada' });

  const actual = await fixture.launchActual({ entry: 'server' });
  const { base } = await actual.ready;
  const api = (route, options) => request(base, `/api${route}`, options);
  const expect = (result, status = 200) => { assert.equal(result.status, status, JSON.stringify(result.body)); return result.body; };
  const login = async usuario => {
    const body = expect(await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } }));
    assert.ok(body.token); return body.token;
  };
  const tokens = new Map(); for (const account of accounts) tokens.set(account.id, await login(account.usuario));
  const expected = (id, { period = dates.period, offset = 0, limit = 20 } = {}) => {
    const mine = rows.filter(row => row.visible && row.workMonth === period && row.sector === 'produccion' && row.members.has(id));
    const groups = new Map();
    for (const row of mine) {
      const key = row.client?.id ?? null;
      const group = groups.get(key) || { client: row.client, total: 0, completed: 0 };
      group.total++; if (['finalizada', 'publicada'].includes(row.state)) group.completed++;
      groups.set(key, group);
    }
    const sorted = [...groups.values()].sort((a, b) => b.total - a.total
      || Number(a.client === null) - Number(b.client === null) || (a.client?.id ?? 0) - (b.client?.id ?? 0));
    return { total: mine.length, completed: mine.filter(row => ['finalizada', 'publicada'].includes(row.state)).length,
      client_count: sorted.length, clients: sorted.slice(offset, offset + limit) };
  };
  const keys = (value, names) => assert.deepEqual(Object.keys(value).sort(), [...names].sort());
  const check = async (id, token = tokens.get(id)) => {
    const home = expect(await api('/inicio', { token }));
    assert.equal(home.user.id, id); assert.equal(home.monthly_progress.period, dates.period);
    const production = home.monthly_progress.production;
    assert.ok(production, 'Actual home response exposes production breakdown');
    keys(production, ['total', 'completed', 'client_count', 'clients']);
    assert.deepEqual(production, expected(id), 'Full aggregates and exact top-20 client-ID ordering');
    for (const group of production.clients) {
      keys(group, ['client', 'total', 'completed']);
      if (group.client !== null) keys(group.client, ['id', 'nombre']);
      assert.ok(Number.isSafeInteger(group.total) && group.total > 0);
      assert.ok(Number.isSafeInteger(group.completed) && group.completed >= 0 && group.completed <= group.total);
    }
    const encoded = JSON.stringify(home);
    assert.ok(!encoded.includes(secret) && !encoded.includes(String(amount)));
    for (const field of ['importe', 'future_finance', 'metadata', 'publication_classification', 'publicacion_evidencia'])
      assert.ok(!JSON.stringify(production).includes(`"${field}"`));
    const sector = home.monthly_progress.by_sector.find(group => group.sector === 'produccion');
    assert.equal(sector?.total ?? 0, production.total);
    assert.equal(sector?.completed ?? 0, production.completed);
    return home;
  };
  const snapshot = async () => {
    const result = {};
    for (const table of ['usuarios', 'clientes', 'cliente_abonos', 'tareas', 'tarea_asignaciones', 'historias', 'publicaciones',
      'editorial_publicacion_versiones', 'editorial_publicacion_eventos'])
      result[table] = await fixture.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`);
    return result;
  };
  await t.test('distinct client IDs, top 20 and full totals include the null-client group exactly once', async () => {
    const before = await snapshot();
    const home = await check(owner), production = home.monthly_progress.production;
    assert.equal(production.client_count, 25); assert.equal(production.clients.length, 20);
    for (const client of clients.slice(0, 2)) {
      const group = production.clients.find(group => group.client?.id === client.id);
      assert.ok(group); assert.deepEqual(group.client, client);
    }
    assert.notEqual(clients[0].nombre, clients[1].nombre);
    assert.equal(new Set(production.clients.map(group => group.client?.id ?? null)).size, production.clients.length);
    assert.ok(production.total > production.clients.reduce((sum, group) => sum + group.total, 0));
    assert.equal(production.clients[0].client.id, clients[0].id, 'Higher total beats name/id ordering');
    assert.ok(!production.clients.some(group => group.client === null), 'Null client follows all equal-total numeric client IDs at the cutoff');
    const other = (await check(homonym)).monthly_progress.production;
    assert.deepEqual(other.clients.map(group => group.client?.id ?? null),
      [clients[0].id, clients[1].id, null, clients[2].id], 'Equal totals order by client ID with null last; totals rank first');
    assert.equal(other.clients.at(-1).client.id, clients[2].id, 'Lower total remains last even with a smaller name');
    assert.ok(other.clients.some(group => group.client === null));
    assert.notDeepEqual(other, production, 'Homonymous account label does not merge identities');
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('Córdoba fallback, due precedence, sector and visibility exclusions preserve work/publication separation', async () => {
    const before = await snapshot();
    await check(owner);
    const legacy = rows.find(row => row.state === 'publicada' && row.sector === 'produccion');
    const [stored] = await fixture.query('SELECT estado FROM tareas WHERE id=$1', [legacy.id]);
    assert.equal(stored.estado, 'publicada');
    assert.deepEqual(await fixture.query('SELECT id FROM publicaciones'), []);
    assert.deepEqual(await fixture.query('SELECT id FROM editorial_publicacion_eventos'), []);
    assert.deepEqual(await snapshot(), before, 'Work completion never creates piece publication evidence or rewrites history');
  });
  await t.test('all current roles get only their ID-bound production; collaborators deduplicate and empty identities stay empty', async () => {
    const before = await snapshot();
    for (const account of accounts) await check(account.id);
    assert.deepEqual((await check(91004)).monthly_progress.production, { total: 0, completed: 0, client_count: 0, clients: [] });
    assert.equal((await check(91001)).monthly_progress.production.total, 1, 'Admin does not receive global production work');
    const [binding] = await fixture.query(`SELECT count(*)::int AS n FROM tarea_asignaciones
      WHERE tarea_id=$1 AND usuario_id=$2`, [rows[0].id, homonym]);
    assert.equal(binding.n, 1);
    await check(owner, await login('qa_production_monthly_0'));
    assert.equal((await api('/inicio')).status, 401);
    assert.deepEqual(await snapshot(), before);
  });

  const monthly = (query, token = tokens.get(owner)) => api(`/inicio/produccion-mensual${query ? `?${query}` : ''}`, { token });
  const checkMonthly = async (id, { period = dates.period, offset = 0, limit = 20,
    token = tokens.get(id), query = `period=${period}&offset=${offset}&limit=${limit}` } = {}) => {
    const body = expect(await monthly(query, token));
    keys(body, ['version', 'user', 'period', 'today', 'offset', 'limit', 'total', 'completed', 'client_count', 'has_more', 'clients']);
    keys(body.user, ['id']); assert.deepEqual(body.user, { id });
    assert.equal(body.version, 1); assert.equal(body.period, period); assert.equal(body.today, dates.today);
    assert.equal(body.offset, offset); assert.equal(body.limit, limit);
    const model = expected(id, { period, offset, limit });
    for (const field of ['total', 'completed', 'client_count', 'clients']) assert.deepEqual(body[field], model[field], field);
    assert.equal(body.has_more, offset + limit < model.client_count);
    for (const group of body.clients) {
      keys(group, ['client', 'total', 'completed']);
      if (group.client !== null) keys(group.client, ['id', 'nombre']);
    }
    const encoded = JSON.stringify(body);
    assert.ok(!encoded.includes(secret) && !encoded.includes(String(amount)));
    for (const field of ['importe', 'metadata', 'future_finance', 'publicacion_evidencia', 'publication_classification', 'token'])
      assert.ok(!encoded.includes(`"${field}"`));
    return body;
  };
  await t.test('period endpoint walks all 25 distinct client groups including null with exact unpaginated totals', async () => {
    const before = await snapshot();
    const first = await checkMonthly(owner, { query: `period=${dates.period}` });
    const second = await checkMonthly(owner, { offset: 20 });
    const combined = [...first.clients, ...second.clients];
    const full = expected(owner, { limit: 50 });
    assert.equal(first.client_count, 25); assert.equal(first.clients.length, 20); assert.equal(second.clients.length, 5);
    assert.deepEqual(combined, full.clients);
    assert.equal(new Set(combined.map(group => group.client?.id ?? null)).size, 25);
    assert.equal(combined.filter(group => group.client === null).length, 1);
    assert.equal(combined.reduce((sum, group) => sum + group.total, 0), first.total);
    assert.equal(combined.reduce((sum, group) => sum + group.completed, 0), first.completed);
    const singlePages = [];
    for (let offset = 0; offset < 25; offset++) singlePages.push(...(await checkMonthly(owner, { offset, limit: 1 })).clients);
    assert.deepEqual(singlePages, combined);
    await checkMonthly(owner, { limit: 50 });
    await checkMonthly(owner, { offset: 25, limit: 1 });
    await checkMonthly(owner, { offset: 1000000, limit: 50 });
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('explicit periods use due precedence and Córdoba fallback rather than current-month-only or global data', async () => {
    const before = await snapshot();
    for (const period of [dates.previous.slice(0, 7), dates.next.slice(0, 7)]) {
      assert.ok(expected(owner, { period }).total > 0, 'Fixture exercises a non-current work month');
      await checkMonthly(owner, { period });
      await checkMonthly(homonym, { period });
    }
    for (const account of accounts) await checkMonthly(account.id);
    const empty = await checkMonthly(91004);
    assert.deepEqual([empty.total, empty.completed, empty.client_count, empty.has_more, empty.clients], [0, 0, 0, false, []]);
    assert.equal((await checkMonthly(91001)).total, 1, 'Admin still receives current-ID work only');
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('period/pagination query is required, canonical and closed with no name/identity overrides or writes', async () => {
    const before = await snapshot();
    const invalid = ['', 'offset=0&limit=20',
      ...['', '0000-01', '2026-00', '2026-13', '2026-1', '2026-01-01', '2026-01T00:00:00Z',
        ' 2026-01', '2026-01 ', 'NaN', '10000-01'].map(value => `period=${encodeURIComponent(value)}`),
      `period=${dates.period}&period=${dates.period}`, `period[]=${dates.period}`,
      ...['offset=-1', 'offset=1000001', 'offset=01', 'offset=1.0', 'offset=1e2', 'offset=', 'offset=%2B1',
        'offset=%201', 'offset=9007199254740992', 'offset=0&offset=0', 'offset[]=0',
        'limit=0', 'limit=51', 'limit=-1', 'limit=01', 'limit=1.0', 'limit=1e1', 'limit=', 'limit=%2B1',
        'limit=9007199254740992', 'limit=20&limit=20', 'limit[x]=20',
        `id=${homonym}`, `usuario_id=${homonym}`, `user_id=${homonym}`, `asignado_a_id=${homonym}`,
        'usuario=QA', 'asignado_a=QA', 'rol=admin', 'cliente_id=1', 'workspace=render_os', 'bucket=today', 'unknown=1']
        .map(query => `period=${dates.period}&${query}`)];
    for (const query of invalid) expect(await monthly(query), 400);
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('period endpoint verifies current role, activity and session version on every HTTP request', async () => {
    expect(await api(`/inicio/produccion-mensual?period=${dates.period}`), 401);
    // Reuse one synthetic account only after all stable-fixture comparisons.
    const id = 99104, usuario = 'qa_production_monthly_3', old = tokens.get(id);
    await fixture.query("UPDATE usuarios SET rol='qa_unknown' WHERE id=$1", [id]);
    try {
      const before = await snapshot(); expect(await monthly(`period=${dates.period}`, old), 403);
      assert.deepEqual(await snapshot(), before);
    } finally { await fixture.query("UPDATE usuarios SET rol='programacion' WHERE id=$1", [id]); }
    const revoked = await login(usuario);
    await fixture.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=$1', [id]);
    let before = await snapshot(); expect(await monthly(`period=${dates.period}`, revoked), 401);
    assert.deepEqual(await snapshot(), before);
    const inactiveToken = await login(usuario);
    await fixture.query('UPDATE usuarios SET activo=false WHERE id=$1', [id]);
    try {
      before = await snapshot(); expect(await monthly(`period=${dates.period}`, inactiveToken), 401);
      assert.deepEqual(await snapshot(), before);
    } finally { await fixture.query('UPDATE usuarios SET activo=true WHERE id=$1', [id]); }
    await checkMonthly(id, { token: await login(usuario) });
  });
});
