import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { loginProductionCookieSession, productionCookieRequest } from './helpers/production-cookie-session.js';
import { readCalendar } from '../src/calendar.js';

// Independent principal HTTP contract. Bulk SQL below is synthetic fixture data,
// not a replacement calendar implementation or fabricated publication proof.
test('cookie calendar pagination: complete inventory, closed previews and observation-bound pages beyond the legacy cap', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 300000,
}, async t => {
  const f = await startLocalHarness({ port: 55824, browserSessions: true });
  let pool;
  t.after(async () => {
    try { await pool?.end(); } finally { await f.cleanup(); }
    await assert.rejects(access(f.root), e => e.code === 'ENOENT');
    t.diagnostic(`QA159 fixture removed ENOENT: ${f.root}; port55824`);
  });
  const [identity] = await f.query(`SELECT current_database() database,current_user username,
    host(inet_server_addr()) address,inet_server_port() port,current_setting('data_directory') directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55824,
    url: 'postgresql://render2_fixture@127.0.0.1:55824/render2_local_test', identity });
  const login = name => loginProductionCookieSession(f.base, name, fixturePassword);
  const admin = await login('qa_franco'), editor = await login('qa_luciano'), outsider = await login('qa_designer');
  const api = (path, session = admin, method = 'GET', body) => productionCookieRequest(f.base, `/api${path}`, { session, method, body });
  const ok = (r, status = 200) => { assert.equal(r.status, status, 'Unexpected fixture HTTP status'); return r.body; };
  const keys = (row, expected) => assert.deepEqual(Object.keys(row).sort(), [...expected].sort());
  const marker = 'QA159_PRIVATE_FINANCE_NOT_CALENDAR';
  const [client] = await f.query("INSERT INTO clientes(nombre,activo) VALUES ('QA159 calendar volume',true) RETURNING id,nombre");
  const [other] = await f.query("INSERT INTO clientes(nombre,activo) VALUES ('QA159 calendar other',true) RETURNING id,nombre");
  const bulk = await f.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,tipo_tarea,estado,fecha_vencimiento,propiedades_extra)
    SELECT 'QA159 bulk '||n,'Same legacy label',$1,'edicion','pendiente','2026-07-15',
      jsonb_build_object('workspace','render_os','private_finance',$2::text)
    FROM generate_series(1,2107) n RETURNING id`, [client.id, marker]);
  await f.query(`INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo)
    SELECT unnest($1::int[]),91003,'responsable'`, [bulk.map(r => r.id)]);
  const expected = bulk.map(r => ({ key: `tarea:tarea:${r.id}`, date: '2026-07-15', kind: 'tarea' }));
  const seedTask = async (date, clientId = client.id, props = { workspace: 'render_os' }) => {
    const [row] = await f.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,tipo_tarea,estado,fecha_vencimiento,propiedades_extra)
      VALUES('QA159 boundary','Same legacy label',$1,'edicion','pendiente',$2,$3::jsonb) RETURNING id`, [clientId, date, JSON.stringify(props)]);
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91003,'responsable')", [row.id]);
    return row;
  };
  for (const [date, id] of [['2026-07-01', client.id], ['2026-07-31', client.id], ['2026-07-15', null], ['2026-07-15', other.id]]) {
    const row = await seedTask(date, id); expected.push({ key: `tarea:tarea:${row.id}`, date, kind: 'tarea' });
  }
  const excluded = [];
  for (const [date, props] of [['2026-06-30', { workspace: 'render_os' }], ['2026-08-01', { workspace: 'render_os' }],
    ['2026-07-15', { workspace: 'private' }], ['2026-07-15', { workspace: 'render_os', archivada_render_os: true }],
    ['2026-07-15', { workspace: 'render_os', papelera_render_os: true }]]) excluded.push((await seedTask(date, client.id, props)).id);

  const visit = ok(await api('/producciones', admin, 'POST', { request_id: randomUUID(), cliente_id: client.id,
    fecha: '2026-07-15', titulo: 'QA159 one visit', participante_ids: [91003] }), 201).visita;
  expected.push({ key: `visita:visita:${visit.id}`, date: '2026-07-15', kind: 'visita' });
  // Project/hito are only volume-fixture setup; all constraints remain enabled.
  const projectId = randomUUID(), milestoneId = randomUUID();
  await f.query(`INSERT INTO proyectos(id,titulo,cliente_id,responsable_id,tipo,creado_por_id,actualizado_por_id,request_id,request_hash)
    VALUES($1,'QA159 project',$2,91003,'web',91001,91001,$3,$4)`, [projectId, client.id, randomUUID(), 'a'.repeat(64)]);
  await f.query("INSERT INTO proyecto_hitos(id,proyecto_id,titulo,fecha) VALUES($1,$2,'QA159 milestone','2026-07-31')", [milestoneId, projectId]);
  expected.push({ key: `hito:hito:${milestoneId}`, date: '2026-07-31', kind: 'hito' });
  const pieces = [];
  for (const domain of ['historia', 'publicacion']) {
    const table = domain === 'historia' ? 'historias' : 'publicaciones';
    const [row] = await f.query(`INSERT INTO ${table}(cliente_id,${domain === 'publicacion' ? 'tipo,' : ''}estado,fecha_programada,idea,metadata)
      VALUES($1,${domain === 'publicacion' ? "'video'," : ''}'lista','2026-07-15','QA159 real proof',$2::jsonb) RETURNING id`,
    [client.id, JSON.stringify({ private_finance: marker })]);
    const task = ok(await api('/tareas', admin, 'POST', { titulo: 'QA159 editorial assignment', workspace: 'render_os',
      cliente_id: client.id, asignado_a_id: 91003, tipo_tarea: 'edicion', subtipo: 'video', fecha_vencimiento: '2026-08-02',
      [domain === 'historia' ? 'historia_id' : 'publicacion_id']: row.id }), 201);
    assert.ok(task.id);
    const observed = ok(await api(`/editorial-publicacion/${domain}/${row.id}`));
    const receipt = ok(await api(`/editorial-publicacion/${domain}/${row.id}/confirmar`, admin, 'POST', {
      request_id: randomUUID(), expected_revision: observed.piece.revision,
      occurred_at: domain === 'historia' ? '2026-08-01T02:59:59.000Z' : '2026-08-01T03:00:00.000Z',
    }), 201);
    pieces.push({ domain, id: row.id, receipt });
    expected.push({ key: `programacion:${domain}:${row.id}`, date: '2026-07-15', kind: 'programacion' });
    if (domain === 'historia') expected.push({ key: `publicacion:${domain}:${row.id}`, date: '2026-07-31', kind: 'publicacion' });
  }
  const [historical] = await f.query(`INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada,"fecha_publicación_real",idea,metadata)
    VALUES($1,'video','publicada','2026-07-15','2026-07-15T12:00:00Z','QA159 historical is not proof',$2::jsonb) RETURNING id`,
  [client.id, JSON.stringify({ private_finance: marker, publicacion_evidencia: { classification: 'confirmada_manualmente' } })]);
  expected.push({ key: `programacion:publicacion:${historical.id}`, date: '2026-07-15', kind: 'programacion' });

  const base = { desde: '2026-07-01', hasta: '2026-08-01', scope: 'team', kind: 'all' };
  const url = options => `/calendario?${new URLSearchParams({ ...base, ...options })}`;
  const read = async (options = {}, session = admin) => ok(await api(url({ limit: '200', ...options }), session));
  const compare = (a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  expected.sort(compare);
  const eventKeys = ['key', 'kind', 'source', 'source_id', 'date', 'title', 'cliente_id', 'cliente_nombre', 'estado', 'href', 'responsable_ids', 'evidence'];
  const validateEvent = event => {
    keys(event, eventKeys); assert.equal(event.key, `${event.kind}:${event.source}:${event.source_id}`);
    assert.ok(typeof event.title === 'string' && event.title.length <= 160);
    assert.ok(Array.isArray(event.responsable_ids)); assert.ok(event.href.startsWith('/') && !event.href.startsWith('//'));
    if (event.kind !== 'publicacion') assert.equal(event.evidence, null);
    else {
      keys(event.evidence, ['classification', 'revision', 'confirmation']);
      assert.equal(event.evidence.classification, 'confirmada_manualmente');
      keys(event.evidence.confirmation, ['id', 'actor_id', 'occurred_at', 'recorded_at', 'source']);
      assert.equal(event.evidence.confirmation.source, 'manual'); assert.equal(event.evidence.confirmation.actor_id, 91001);
      const piece = pieces.find(p => p.domain === event.source && p.id === event.source_id); assert.ok(piece);
      assert.equal(event.evidence.confirmation.id, piece.receipt.operation.id);
    }
  };
  const validate = (dto, { limit = 200, offset = 0, day = null, total = expected.length } = {}) => {
    keys(dto, ['range', 'scope', 'kind', 'timezone', 'clients', 'events', 'truncated', 'pagination']);
    keys(dto.pagination, ['version', 'limit', 'offset', 'total', 'has_more', 'snapshot', 'day', 'days']);
    const p = dto.pagination;
    assert.equal(p.version, 1); assert.equal(p.limit, limit); assert.equal(p.offset, offset); assert.equal(p.total, total); assert.equal(p.day, day);
    assert.match(p.snapshot, /^c1:[0-9a-f]{64}$/); assert.equal(p.has_more, offset + dto.events.length < total);
    assert.equal(dto.truncated, dto.events.length < total); assert.equal(dto.events.length, Math.min(limit, Math.max(0, total - offset)));
    assert.equal(dto.timezone, 'America/Argentina/Cordoba'); assert.deepEqual(dto.range, { desde: base.desde, hasta: base.hasta });
    dto.clients.forEach(c => keys(c, ['id', 'nombre']));
    dto.events.forEach(validateEvent); assert.deepEqual(dto.events, [...dto.events].sort(compare));
    for (const row of p.days) {
      keys(row, ['date', 'total', 'preview']); assert.ok(Number.isSafeInteger(row.total) && row.total > 0);
      assert.equal(row.preview.length, Math.min(2, row.total)); row.preview.forEach(validateEvent);
      assert.ok(row.preview.every(e => e.date === row.date));
    }
    assert.equal(JSON.stringify(dto).includes(marker), false);
  };
  const names = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_migrations' ORDER BY tablename")).map(r => r.tablename);
  assert.ok(names.every(n => /^[a-z_][a-z0-9_]*$/.test(n)));
  const snapshot = async () => createHash('sha256').update(JSON.stringify(await f.query(`SELECT * FROM (${names.map(n =>
    `SELECT '${n}' name,COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) rows FROM "${n}" r`).join(' UNION ALL ')}) s ORDER BY name`))).digest('hex');

  await t.test('all >2000 events traverse once, page sizes may change, full day counts/previews are independent of page', async () => {
    const before = await snapshot(), first = await read(); validate(first);
    const all = [...first.events]; let offset = all.length;
    while (offset < expected.length) {
      const limit = offset === 200 ? 1 : 500;
      const dto = await read({ limit: String(limit), offset: String(offset), expected_snapshot: first.pagination.snapshot });
      validate(dto, { limit, offset }); assert.equal(dto.pagination.snapshot, first.pagination.snapshot);
      if (dto.events.length) assert.ok(compare(all.at(-1), dto.events[0]) < 0, 'Strict cross-page C ordering');
      assert.deepEqual(dto.pagination.days, first.pagination.days); all.push(...dto.events); offset += dto.events.length;
    }
    assert.deepEqual(all.map(e => ({ key: e.key, date: e.date, kind: e.kind })), expected);
    assert.equal(new Set(all.map(e => e.key)).size, expected.length);
    for (const id of excluded) assert.equal(all.some(e => e.key === `tarea:tarea:${id}`), false);
    assert.ok(all.some(e => e.cliente_id === null));
    const days = [...new Set(expected.map(e => e.date))].map(date => {
      const events = all.filter(e => e.date === date); return { date, total: events.length, preview: events.slice(0, 2) };
    });
    assert.deepEqual(first.pagination.days, days);
    assert.equal(days.reduce((n, row) => n + row.total, 0), expected.length);
    assert.deepEqual(first.clients, await f.query('SELECT id,nombre FROM clientes WHERE activo IS DISTINCT FROM FALSE ORDER BY nombre,id'));
    const empty = await read({ offset: String(expected.length + 20), expected_snapshot: first.pagination.snapshot });
    validate(empty, { offset: expected.length + 20 }); assert.deepEqual(empty.events, []);
    const safeEnd = await read({ offset: String(Number.MAX_SAFE_INTEGER), expected_snapshot: first.pagination.snapshot });
    validate(safeEnd, { offset: Number.MAX_SAFE_INTEGER });
    const legacy = ok(await api(url({}))); assert.equal(legacy.events.length, 2000); assert.equal(legacy.truncated, true);
    assert.equal(Object.hasOwn(legacy, 'pagination'), false); assert.deepEqual(await snapshot(), before);
  });

  await t.test('small mixed global page is exactly the legacy operational projection, including genuine annotated proof', async () => {
    const before = await snapshot();
    const filters = { desde: '2026-07-31', hasta: '2026-08-01', cliente_id: String(client.id) };
    const legacy = ok(await api(url(filters))), paged = await read({ ...filters, limit: '500' });
    assert.equal(Object.hasOwn(legacy, 'pagination'), false);
    assert.equal(paged.pagination.day, null); assert.equal(paged.pagination.total, 3);
    assert.equal(paged.pagination.has_more, false); assert.equal(paged.truncated, false);
    assert.deepEqual(paged.events, legacy.events);
    assert.deepEqual([...new Set(paged.events.map(e => e.kind))].sort(), ['hito', 'publicacion', 'tarea']);
    for (const field of ['range', 'scope', 'kind', 'timezone', 'clients', 'truncated']) assert.deepEqual(paged[field], legacy[field]);
    paged.events.forEach(validateEvent);
    assert.deepEqual(paged.pagination.days, [{ date: '2026-07-31', total: 3, preview: paged.events.slice(0, 2) }]);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('private metadata changes do not enter the operational fingerprint or leak into a page', async () => {
    const first = await read();
    await f.query(`UPDATE tareas SET propiedades_extra=propiedades_extra||jsonb_build_object('private_finance',$2::text)
      WHERE id=$1`, [bulk[0].id, `${marker}_changed`]);
    const committed = await snapshot();
    const second = await read({ offset: '200', expected_snapshot: first.pagination.snapshot });
    validate(second, { offset: 200 }); assert.equal(second.pagination.snapshot, first.pagination.snapshot);
    assert.deepEqual(second.pagination.days, first.pagination.days); assert.deepEqual(await snapshot(), committed);
  });

  await t.test('EXPLAIN ANALYZE BUFFERS runs the real generated paged SELECT only on this verified fixture', async () => {
    pool = new pg.Pool({ connectionString: 'postgresql://render2_fixture@127.0.0.1:55824/render2_local_test',
      max: 1, statement_timeout: 25000, application_name: 'qa159-own-calendar-explain' });
    let captured;
    const observedPool = { async connect() {
      const db = await pool.connect();
      return { query(sql, values) {
        if (typeof sql === 'string' && /^\s*WITH\s/i.test(sql) && /candidates AS MATERIALIZED/.test(sql)) {
          assert.equal(captured, undefined, 'One real candidate/page statement');
          captured = { sql, values: [...values] };
        }
        return db.query(sql, values);
      }, release(error) { db.release(error); } };
    } };
    const before = await snapshot();
    const actual = await readCalendar(observedPool, { id: 91001, rol: 'admin', session_version: 1 }, { ...base, limit: '200' });
    validate(actual); assert.ok(captured, 'Capture actual SQL, never reproduce its generator in the test');
    const db = await pool.connect();
    try {
      await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const { rows } = await db.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${captured.sql}`, captured.values);
      const plan = rows[0]['QUERY PLAN'][0];
      assert.ok(Number.isFinite(plan['Execution Time']) && plan['Execution Time'] >= 0);
      const nodes = node => [node, ...(node.Plans || []).flatMap(nodes)];
      const limits = nodes(plan.Plan).filter(n => n['Node Type'] === 'Limit');
      assert.ok(limits.length > 0, 'Paging must limit in PostgreSQL, not download all candidates to JS');
      assert.ok(limits.some(n => n['Actual Rows'] <= 200));
      assert.ok(nodes(plan.Plan).some(n => Object.hasOwn(n, 'Shared Hit Blocks')));
      t.diagnostic(`QA159 own-fixture EXPLAIN: execution_ms=${plan['Execution Time']}; shared_hits=${plan.Plan['Shared Hit Blocks'] ?? 0}; shared_reads=${plan.Plan['Shared Read Blocks'] ?? 0}`);
      await db.query('COMMIT');
    } catch (error) { await db.query('ROLLBACK'); throw error; }
    finally { db.release(); }
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('selected day is complete beyond 2000 and retains full-range counts; scope/client/kind/range are intersections', async () => {
    const before = await snapshot(), day = '2026-07-15', selected = expected.filter(e => e.date === day);
    const first = await read({ dia: day, limit: '500' }); validate(first, { limit: 500, day, total: selected.length });
    const rows = [...first.events];
    while (rows.length < selected.length) {
      const offset = rows.length, dto = await read({ dia: day, limit: '500', offset: String(offset), expected_snapshot: first.pagination.snapshot });
      validate(dto, { limit: 500, offset, day, total: selected.length }); rows.push(...dto.events);
    }
    assert.deepEqual(rows.map(e => e.key), selected.map(e => e.key));
    assert.deepEqual(first.pagination.days, (await read()).pagination.days);
    // The raw historical piece deliberately has no task membership. Shared
    // team visibility does not fabricate a personal editorial assignment.
    const mine = await read({ scope: 'mine' }, editor); validate(mine, { total: expected.length - 1 });
    assert.equal(mine.pagination.days.reduce((n, row) => n + row.total, 0), expected.length - 1);
    const none = await read({ scope: 'mine' }, outsider); validate(none, { total: 0 }); assert.deepEqual(none.pagination.days, []);
    const otherOnly = await read({ cliente_id: String(other.id) }); validate(otherOnly, { total: 1 });
    assert.ok(otherOnly.events.every(e => e.cliente_id === other.id));
    const visits = await read({ kind: 'visita' }); validate(visits, { total: 1 }); assert.equal(visits.events[0].source_id, visit.id);
    const july = await read({ kind: 'publicacion' }); validate(july, { total: 1 }); assert.equal(july.events[0].source, 'historia');
    const august = await read({ desde: '2026-08-01', hasta: '2026-08-02', kind: 'publicacion' });
    assert.equal(august.pagination.total, 1); assert.equal(august.events[0].source, 'publicacion'); validateEvent(august.events[0]);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('snapshot binds actor and every query context, but not page size; mismatches return409 without rows or writes', async () => {
    const before = await snapshot(), first = await read(), token = first.pagination.snapshot;
    for (const [options, actor] of [[{ scope: 'mine' }, admin], [{ kind: 'tarea' }, admin], [{ dia: '2026-07-15' }, admin],
      [{ cliente_id: String(client.id) }, admin], [{ desde: '2026-07-02' }, admin], [{}, editor]]) {
      const result = await api(url({ limit: '200', offset: '200', expected_snapshot: token, ...options }), actor);
      const body = ok(result, 409); assert.equal(Object.hasOwn(body, 'events'), false); assert.equal(JSON.stringify(body).includes(marker), false);
    }
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('invalid pagination/query syntax rejects before DML; a later page always requires observation', async () => {
    const before = await snapshot(), prefix = `${url({})}&`;
    const invalid = ['limit=0', 'limit=501', 'limit=01', 'limit=-1', 'limit=1.0', 'limit=1&limit=2', 'limit[]=1',
      'limit=200&offset=-1', 'limit=200&offset=01', 'limit=200&offset=1e2', 'limit=200&offset=9007199254740992',
      'limit=200&offset=0&offset=1', 'limit=200&offset=1', 'offset=1',
      'limit=200&dia=2026-02-30', 'limit=200&dia=2026-06-30', 'limit=200&dia=2026-08-01',
      'limit=200&dia=2026-07-15&dia=2026-07-16', 'limit=200&expected_snapshot=bad',
      `limit=200&expected_snapshot=c1:${'A'.repeat(64)}`, `limit=200&expected_snapshot=c1:${'a'.repeat(64)}&expected_snapshot=c1:${'b'.repeat(64)}`];
    for (const query of invalid) ok(await api(prefix + query), 400);
    ok(await request(f.base, `/api${url({ limit: '200' })}`), 401);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('payload, date, membership, client visibility and actual proof changes invalidate pages without read-side DML', async () => {
    const cases = [
      () => f.query("UPDATE tareas SET titulo=titulo||' changed' WHERE id=$1", [bulk[0].id]),
      () => f.query("UPDATE tareas SET fecha_vencimiento='2026-07-16' WHERE id=$1", [bulk[1].id]),
      () => f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91004,'colaborador')", [bulk[2].id]),
      () => f.query('UPDATE clientes SET activo=false WHERE id=$1', [other.id]),
      async () => {
        const p = pieces[0], observed = ok(await api(`/editorial-publicacion/${p.domain}/${p.id}`));
        ok(await api(`/editorial-publicacion/${p.domain}/${p.id}/retirar`, admin, 'POST', {
          request_id: randomUUID(), expected_revision: observed.piece.revision,
        }));
      },
    ];
    for (const mutate of cases) {
      const first = await read(); await mutate(); const committed = await snapshot();
      const stale = ok(await api(url({ limit: '200', offset: '200', expected_snapshot: first.pagination.snapshot })), 409);
      assert.equal(Object.hasOwn(stale, 'events'), false); assert.deepEqual(await snapshot(), committed);
      const fresh = await read(); assert.notEqual(fresh.pagination.snapshot, first.pagination.snapshot);
      assert.deepEqual(await snapshot(), committed);
    }
  });

  await t.test('current role, epoch and active status revoke cookie access rather than accepting a held snapshot', async () => {
    for (const [sql, values] of [["UPDATE usuarios SET rol='qa_unknown' WHERE id=$1", [91004]],
      ['UPDATE usuarios SET session_version=session_version+1 WHERE id=$1', [91003]],
      ['UPDATE usuarios SET activo=false WHERE id=$1', [91002]]]) {
      const id = values[0], session = id === 91004 ? outsider : id === 91003 ? editor : await login('qa_agustin');
      const observed = await read({}, session); await f.query(sql, values); const committed = await snapshot();
      // Principal auth re-reads the current role. Unsupported current role is
      // 403; revoked epoch/inactive account are authentication failures (401).
      const result = await api(url({ limit: '200', offset: '200', expected_snapshot: observed.pagination.snapshot }), session);
      ok(result, id === 91004 ? 403 : 401); assert.deepEqual(await snapshot(), committed);
    }
  });
});
