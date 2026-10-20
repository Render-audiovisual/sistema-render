import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { fetchAllTaskPages } from '../../frontend/src/shared/tasks/fetch-all-task-pages.js';

test('task list HTTP bounded pagination, exact filtered totals and existing access/DTO boundaries', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55642 });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own task-pagination fixture stopped and removed: ${fixture.root}`);
  });
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port: 55642,
    url: 'postgresql://render2_fixture@127.0.0.1:55642/render2_local_test', identity });
  const secret = 'QA_TASK_PAGE_PRIVATE_55642';
  const rows = [];
  const inserted = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,prioridad,
    fecha_vencimiento,created_at,propiedades_extra)
    SELECT 'QA page task '||n,CASE WHEN n%2=0 THEN 'Luciano QA' ELSE 'Designer QA' END,
      'pendiente','diseno',CASE WHEN n%3=0 THEN 'alta' ELSE 'media' END,
      CASE WHEN n%11=0 THEN NULL ELSE DATE '2026-10-20'+(n%3) END,
      TIMESTAMPTZ '2026-01-01T12:00:00Z'+(n%17)*INTERVAL '1 day',
      jsonb_build_object('workspace','render_os','private_finance',jsonb_build_object('importe',921387.64,'marker',$1::text),
        'unknown_private_field',$1::text,'colaboradores','[]'::jsonb)
    FROM generate_series(1,625) AS fixture_series(n)
    RETURNING id,titulo,asignado_a,prioridad,to_char(fecha_vencimiento,'YYYY-MM-DD') AS due`, [secret]);
  for (const row of inserted) {
    const n = Number(row.titulo.split(' ').at(-1));
    rows.push({ ...row, workspace: 'render_os', archived: false, trash: false,
      owner: n % 2 === 0 ? 91003 : 91004, collaborators: n % 2 === 0 && n % 5 === 0 ? [91004] : [] });
  }
  await fixture.query(`INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo)
    SELECT * FROM unnest($1::int[],$2::int[],$3::text[])`,
  [rows.flatMap(r => [r.id, ...r.collaborators.map(() => r.id)]),
    rows.flatMap(r => [r.owner, ...r.collaborators]),
    rows.flatMap(r => ['responsable', ...r.collaborators.map(() => 'colaborador')])]);
  const seed = async ({ workspace = 'render_os', archived = false, trash = false, owner = 91003 } = {}) => {
    const [row] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,prioridad,propiedades_extra)
      VALUES ('QA page special',$1,'pendiente','diseno','media',$2::jsonb) RETURNING id,titulo,asignado_a,prioridad`,
    [owner === 91003 ? 'Luciano QA' : 'Designer QA', JSON.stringify({ workspace,
      archivada_render_os: archived, papelera_render_os: trash,
      unknown_private_field: secret, private_finance: { importe: 921387.64 } })]);
    await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,$2,'responsable')", [row.id, owner]);
    const model = { ...row, due: null, workspace, archived, trash, owner, collaborators: [] };
    rows.push(model); return model;
  };
  for (let n = 0; n < 12; n++) await seed({ workspace: 'historical', owner: n % 2 ? 91003 : 91004 });
  for (let n = 0; n < 3; n++) { await seed({ archived: true }); await seed({ trash: true }); }
  const api = (route, options) => request(fixture.base, `/api${route}`, options);
  const expect = (result, status) => { assert.equal(result.status, status, JSON.stringify(result.body)); return result.body; };
  const login = async usuario => expect(await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } }), 200).token;
  const admin = await login('qa_franco'), editor = await login('qa_luciano'), designer = await login('qa_designer');
  const list = async (query = '', token = editor) => {
    const response = await fetch(new URL(`/api/tareas${query ? `?${query}` : ''}`, fixture.base), {
      signal: AbortSignal.timeout(5000), headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    return { status: response.status, body: await response.json(), total: response.headers.get('X-Total-Count') };
  };
  const member = (row, id) => row.owner === id || row.collaborators.includes(id);
  const sorted = candidates => [...candidates].sort((a, b) => Number(a.due === null) - Number(b.due === null)
    || (a.due || '').localeCompare(b.due || '') || b.id - a.id);
  const visible = () => rows.filter(r => r.workspace === 'render_os' && !r.archived && !r.trash);
  const check = async (query, expected, { token = editor, offset = 0, limit = 100 } = {}) => {
    const result = await list(query, token);
    expect(result, 200);
    assert.ok(Array.isArray(result.body));
    assert.equal(result.total, String(expected.length), 'Total includes matching rows before LIMIT/OFFSET, even on an empty page');
    assert.deepEqual(result.body.map(row => row.id), sorted(expected).slice(offset, offset + limit).map(row => row.id));
    assert.ok(result.body.length <= limit);
    assert.equal(new Set(result.body.map(row => row.id)).size, result.body.length);
    if (token !== admin) {
      const encoded = JSON.stringify(result.body);
      assert.ok(!encoded.includes(secret) && !encoded.includes('921387.64'));
      for (const row of result.body) {
        assert.ok(!Object.hasOwn(row.propiedades_extra || {}, 'private_finance'));
        assert.ok(!Object.hasOwn(row.propiedades_extra || {}, 'unknown_private_field'));
      }
    }
    return result.body;
  };
  const snapshot = async () => ({
    tasks: await fixture.query('SELECT to_jsonb(t) AS row FROM tareas t ORDER BY id'),
    assignments: await fixture.query('SELECT * FROM tarea_asignaciones ORDER BY tarea_id,usuario_id'),
    publications: await fixture.query('SELECT to_jsonb(p) AS row FROM publicaciones p ORDER BY id'),
  });

  await t.test('default limit is 100, max is 500 and every stable page follows due ASC NULLS LAST/id DESC', async () => {
    const before = await snapshot();
    assert.equal(visible().length, 625);
    await check('workspace=render_os', visible());
    await check('workspace=render_os&offset=100', visible(), { offset: 100 });
    await check('workspace=render_os&limit=500', visible(), { limit: 500, token: admin });
    const pages = [];
    for (const offset of [0, 100, 200, 300, 400, 500, 600]) pages.push(...await check(
      `workspace=render_os&limit=100&offset=${offset}`, visible(), { offset }));
    assert.deepEqual(pages.map(row => row.id), sorted(visible()).map(row => row.id));
    assert.equal(new Set(pages.map(row => row.id)).size, 625);
    await check('workspace=render_os&limit=1&offset=0', visible(), { limit: 1 });
    await check('workspace=render_os&limit=500&offset=1000000', visible(), { limit: 500, offset: 1000000 });
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('actual legacy array adapter retrieves every row over multiple bounded HTTP pages', async () => {
    const calls = [];
    const all = await fetchAllTaskPages('/api/tareas?workspace=render_os', {
      request: (url, options) => {
        calls.push(url);
        return fetch(new URL(url, fixture.base), { ...options, headers: { authorization: `Bearer ${editor}` } });
      },
    });
    assert.deepEqual(all.map(row => row.id), sorted(visible()).map(row => row.id));
    assert.equal(all.length, 625);
    assert.deepEqual(calls.map(url => new URL(url, fixture.base).searchParams.get('offset')), ['0', '500']);
    assert.ok(calls.every(url => new URL(url, fixture.base).searchParams.get('limit') === '500'));
    assert.ok(!JSON.stringify(all).includes(secret));
  });

  await t.test('empty-page fallback keeps exactly the same ID/name/workspace/access/archive filters', async () => {
    const cases = [
      { query: 'workspace=render_os&asignado_a_id=91003', expected: visible().filter(r => member(r, 91003)) },
      { query: 'workspace=render_os&asignado_a=Luciano%20QA', expected: visible().filter(r => r.asignado_a === 'Luciano QA') },
      { query: 'workspace=render_os&prioridad=alta', expected: visible().filter(r => r.prioridad === 'alta') },
      { query: 'workspace=render_os&solo_archivadas=true', expected: rows.filter(r => r.workspace === 'render_os' && r.archived && !r.trash) },
      { query: 'workspace=render_os&incluir_archivadas=true', expected: rows.filter(r => r.workspace === 'render_os' && !r.trash) },
      { query: 'workspace=render_os&papelera=true', expected: rows.filter(r => r.workspace === 'render_os' && r.trash) },
      { query: '', expected: rows.filter(r => r.workspace !== 'render_os' && member(r, 91003)) },
      { query: '', token: designer, expected: rows.filter(r => r.workspace !== 'render_os' && member(r, 91004)) },
      { query: '', token: admin, expected: rows.filter(r => r.workspace !== 'render_os') },
      { query: 'workspace=render_os&asignado_a_id=2147483647', expected: [] },
      { query: 'workspace=render_os&q=NoFixtureTaskMatchesThis', expected: [] },
    ];
    for (const item of cases) {
      for (const offset of [0, 1000000]) await check(`${item.query}${item.query ? '&' : ''}limit=50&offset=${offset}`,
        item.expected, { token: item.token || editor, limit: 50, offset });
    }
    // All assertions use stable fixture data. Separate page/fallback COUNT reads
    // are not asserted to form one atomic snapshot under concurrent mutations.
  });
  await t.test('malformed actual pagination parameters are 400 with no DB mutations', async () => {
    const before = await snapshot();
    const invalid = [
      ...['', '0', '-1', '+1', '%2B1', '01', '1.0', '1e2', '501', 'NaN', 'Infinity', '%201', '1%20',
        '9007199254740992', '999999999999999999999', '١', '%00'].map(value => `limit=${value}`),
      ...['', '-1', '+1', '%2B1', '01', '1.0', '1e2', '1000001', 'NaN', 'Infinity', '%201', '1%20',
        '9007199254740992', '999999999999999999999', '١', '%00'].map(value => `offset=${value}`),
      'limit=50&limit=50', 'limit=50&limit=100', 'offset=0&offset=0', 'offset=0&offset=1',
    ];
    for (const query of invalid) expect(await list(`workspace=render_os&${query}`), 400);
    // Repeated actual keys exercise parser arrays. Literal limit[]/offset[x]
    // are unknown keys under Express simple parsing, not those parameter values.
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('shared nonadmin reads do not grant writes; actual create/archive/delete update exact totals', async () => {
    const foreign = visible().find(r => r.owner === 91003 && !r.collaborators.includes(91004));
    await check('workspace=render_os', visible(), { token: designer });
    const before = await snapshot();
    const denied = await api(`/tareas/${foreign.id}?workspace=render_os`, {
      token: designer, method: 'PATCH', body: { titulo: 'Denied pagination-reader write', expected_revision: 1 },
    });
    assert.ok([403, 404].includes(denied.status), JSON.stringify(denied.body));
    assert.deepEqual(await snapshot(), before);
    expect(await list('workspace=render_os', null), 401);
    const created = expect(await api('/tareas', { token: admin, method: 'POST', body: {
      titulo: 'QA page lifecycle', workspace: 'render_os', asignado_a_id: 91003,
      tipo_tarea: 'diseno', fecha_vencimiento: '2026-10-15',
    } }), 201);
    const model = { id: created.id, due: '2026-10-15', workspace: 'render_os', archived: false,
      trash: false, owner: 91003, collaborators: [], asignado_a: 'Luciano QA', prioridad: 'media' };
    rows.push(model);
    await check('workspace=render_os&offset=1000000', visible(), { offset: 1000000 });
    expect(await api(`/tareas/${created.id}?workspace=render_os`, { token: admin, method: 'PATCH', body: {
      expected_revision: created.revision, propiedades_extra: { archivada_render_os: true },
    } }), 200);
    model.archived = true;
    await check('workspace=render_os&offset=1000000', visible(), { offset: 1000000 });
    expect(await api(`/tareas/${created.id}?workspace=render_os`, { token: admin, method: 'DELETE' }), 200);
    rows.splice(rows.indexOf(model), 1);
    await check('workspace=render_os', visible());
    await check('workspace=render_os&solo_archivadas=true&offset=1000000',
      rows.filter(r => r.workspace === 'render_os' && r.archived && !r.trash), { offset: 1000000 });
  });
});
