import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

test('Home review full queue: exact team/personal membership, paginated snapshots and conservative invalidation', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const f = await startLocalHarness({ port: 55743 });
  t.after(async () => {
    await f.cleanup(); await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`QA106 cleanup verified ENOENT: ${f.root}; PostgreSQL port 55743`);
  });
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55743,
    url: 'postgresql://render2_fixture@127.0.0.1:55743/render2_local_test', identity });
  const api = (path, token, method = 'GET', body) => request(f.base, `/api${path}`, { token, method, body });
  const ok = (response, status = 200) => { assert.equal(response.status, status, 'Unexpected principal HTTP status'); return response.body; };
  const login = async usuario => ok(await api('/login', null, 'POST', { usuario, password: fixturePassword })).token;
  const admin = await login('qa_franco'); let secondAdmin = await login('qa_agustin');
  let employee = await login('qa_luciano'); const other = await login('qa_designer');
  const [client] = await f.query("INSERT INTO clientes(nombre,activo) VALUES ('QA106 active review client',true) RETURNING id");
  const [inactive] = await f.query("INSERT INTO clientes(nombre,activo) VALUES ('QA106 inactive review client',false) RETURNING id");
  const marker = 'QA106_FINANCIAL_PRIVATE_SENTINEL';
  let serial = 0;
  const seed = async ({ owner = 91004, collaborator = false, state = 'en_revision', clientId = client.id, props = {}, parent = null } = {}) => {
    const index = ++serial, due = index % 7 === 0 ? null : `2026-10-${String(21 + index % 5).padStart(2, '0')}`;
    const [row] = await f.query(`INSERT INTO tareas(titulo,asignado_a,estado,prioridad,tipo_tarea,cliente_id,tarea_padre_id,
      fecha_vencimiento,propiedades_extra) VALUES ($1,'QA106 same display name',$2,'media','edicion',$3,$4,$5,$6::jsonb) RETURNING id,revision`,
    [`QA106 review task ${index}`, state, clientId, parent, due,
      JSON.stringify({ workspace: 'render_os', future_finance: { amount: 817293.46, marker }, ...props })]);
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,$2,'responsable')", [row.id, owner]);
    if (collaborator) await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,91003,'colaborador')", [row.id]);
    return { ...row, due, owner, collaborator };
  };
  const eligible = [];
  for (let n = 0; n < 52; n++) eligible.push(await seed({ owner: n < 10 ? 91003 : 91004,
    collaborator: n >= 10 && n < 13, clientId: n === 51 ? null : client.id,
    props: n === 0 ? { revision_aprobada: 'true' } : {}, parent: n === 50 ? eligible[0].id : null }));
  const excluded = [await seed({ state: 'aprobada' }), await seed({ props: { revision_aprobada: true } }),
    await seed({ clientId: inactive.id }), await seed({ props: { archivada_render_os: true } }),
    await seed({ props: { papelera_render_os: true } }), await seed({ props: { workspace: 'legacy' } }),
    await seed({ state: 'finalizada' }), await seed({ state: 'publicada' }), await seed({ state: 'pendiente' }), await seed({ state: 'en_progreso' })];
  const personal = eligible.filter(row => row.owner === 91003 || row.collaborator);
  const snapshot = async () => ({
    tasks: await f.query('SELECT * FROM tareas ORDER BY id'),
    assignments: await f.query('SELECT * FROM tarea_asignaciones ORDER BY tarea_id,usuario_id'),
    clients: await f.query('SELECT * FROM clientes ORDER BY id'),
    publications: await f.query('SELECT * FROM publicaciones ORDER BY id'),
    history: await f.query('SELECT * FROM editorial_publicacion_eventos ORDER BY id'),
  });
  const page = async ({ token = admin, scope = 'team', offset = 0, limit = 50, observed, filters = {}, rawQuery } = {}) => {
    const query = new URLSearchParams({ workspace: 'render_os', ...(scope === null ? {} : { review_scope: scope }),
      offset: String(offset), limit: String(limit), ...filters });
    if (observed !== undefined) query.set('expected_review_snapshot', observed);
    const response = await fetch(new URL(`/api/tareas?${rawQuery ?? query.toString()}`, f.base), {
      headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(5000),
    });
    return { status: response.status, body: await response.json(), total: response.headers.get('x-total-count'),
      snapshot: response.headers.get('x-task-review-snapshot') };
  };
  const ids = rows => rows.map(row => row.id);
  const sortedIds = rows => ids(rows).sort((a, b) => a - b);
  const valid = result => { ok(result); assert.ok(Array.isArray(result.body)); assert.match(result.snapshot, /^[a-f0-9]{64}$/); return result; };
  const assertNoPrivate = value => {
    assert.equal(JSON.stringify(value).includes(marker), false); assert.equal(JSON.stringify(value).includes('817293.46'), false);
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(/password|session_version|abono|importe|future_finance/i.test(key), false); assertNoPrivate(child);
    }
  };
  const stale = result => {
    ok(result, 409); assert.equal(Array.isArray(result.body), false);
    assert.equal(Object.hasOwn(result.body, 'items'), false); assert.equal(Object.hasOwn(result.body, 'tareas'), false);
    assert.equal(JSON.stringify(result.body).includes('QA106 review task'), false);
  };

  await t.test('52 team reviews and 13 personal match Home totals beyond preview8, with unique complete pages', async () => {
    const before = await snapshot();
    const home = ok(await api('/inicio', admin)), ownHome = ok(await api('/inicio', employee));
    assert.equal(home.review.scope, 'team'); assert.equal(home.review.total, 52); assert.equal(home.review.items.length, 8);
    assert.equal(ownHome.review.scope, 'personal'); assert.equal(ownHome.review.total, 13); assert.equal(ownHome.review.items.length, 8);
    const first = valid(await page()); assert.equal(first.body.length, 50); assert.equal(Number(first.total), home.review.total);
    const second = valid(await page({ offset: 50, observed: first.snapshot })); assert.equal(second.body.length, 2);
    assert.equal(second.snapshot, first.snapshot); assert.equal(second.total, first.total);
    const combined = [...first.body, ...second.body]; assert.equal(new Set(ids(combined)).size, 52);
    assert.deepEqual(sortedIds(combined), sortedIds(eligible));
    for (const row of excluded) assert.equal(ids(combined).includes(row.id), false);
    for (const row of home.review.items) assert.ok(ids(combined).includes(row.id));
    const own = valid(await page({ token: employee, scope: 'personal' }));
    assert.equal(Number(own.total), ownHome.review.total); assert.deepEqual(sortedIds(own.body), sortedIds(personal));
    assertNoPrivate(own.body);
    const end = valid(await page({ offset: 999, observed: first.snapshot })); assert.deepEqual(end.body, []); assert.equal(Number(end.total), 52);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('valid filters intersect personal/team scopes; same-ID different filter context rejects old snapshot', async () => {
    const before = await snapshot();
    const filtered = valid(await page({ filters: { cliente_id: String(client.id) } }));
    const next = valid(await page({ filters: { cliente_id: String(client.id) }, offset: 50, observed: filtered.snapshot }));
    assert.equal(Number(filtered.total), 51); assert.equal(next.body.length, 1);
    const intersection = valid(await page({ token: employee, scope: 'personal', filters: { asignado_a_id: '91004' } }));
    assert.equal(Number(intersection.total), 3); assert.deepEqual(sortedIds(intersection.body), sortedIds(personal.filter(row => row.collaborator)));
    const q = valid(await page({ filters: { q: 'QA106' } })); assert.equal(Number(q.total), 52);
    stale(await page({ filters: { q: 'review' }, offset: 50, observed: q.snapshot }));
    stale(await page({ token: secondAdmin, offset: 50, observed: q.snapshot, filters: { q: 'QA106' } }));
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('strict review query validation never widens scope or mutates rows', async () => {
    const before = await snapshot(), token = valid(await page()).snapshot;
    const bad = [
      'workspace=render_os&review_scope=unknown', 'workspace=render_os&review_scope=team&review_scope=personal',
      'workspace=legacy&review_scope=team', 'review_scope=team',
      'workspace=render_os&review_scope=team&incluir_archivadas=true', 'workspace=render_os&review_scope=team&solo_archivadas=true',
      'workspace=render_os&review_scope=team&papelera=true', 'workspace=render_os&review_scope=team&estado=aprobada',
      'workspace=render_os&review_scope=team&sort=manual', 'workspace=render_os&review_scope=team&offset=50',
      'workspace=render_os&review_scope=team&expected_review_snapshot=invalid',
      `workspace=render_os&review_scope=team&expected_review_snapshot=${token}&expected_review_snapshot=${token}`,
      `workspace=render_os&expected_review_snapshot=${token}`,
    ];
    for (const rawQuery of bad) ok(await page({ rawQuery }), 400);
    ok(await page({ token: employee }), 403); ok(await page({ token: null }), 401);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('general effective-state filters separate legacy approved and preserve historical publicada alias', async () => {
    const before = await snapshot();
    const reviewed = ok(await page({ scope: null, filters: { estado: 'en_revision' }, limit: 500 }));
    assert.ok(ids(reviewed).includes(eligible[0].id), 'JSON string true is not boolean approval');
    assert.equal(ids(reviewed).includes(excluded[1].id), false);
    const approved = ok(await page({ scope: null, filters: { estado: 'aprobada' }, limit: 500 }));
    assert.ok(ids(approved).includes(excluded[0].id)); assert.ok(ids(approved).includes(excluded[1].id));
    const finalized = ok(await page({ scope: null, filters: { estado: 'finalizada' }, limit: 500 }));
    const legacy = ok(await page({ scope: null, filters: { estado: 'publicada' }, limit: 500 }));
    assert.deepEqual(sortedIds(finalized), sortedIds(legacy));
    assert.ok(ids(finalized).includes(excluded[6].id)); assert.ok(ids(finalized).includes(excluded[7].id));
    for (const rawQuery of ['workspace=render_os&estado=unknown', 'workspace=render_os&estado=en_revision&estado=aprobada'])
      ok(await page({ rawQuery }), 400);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('rename/homonym is not team authority; DB downgrade and session revocation are immediate', async () => {
    await f.query("UPDATE usuarios SET nombre='Franco' WHERE id=91003"); employee = await login('qa_luciano');
    let before = await snapshot();
    ok(await page({ token: employee }), 403);
    assert.deepEqual(sortedIds(valid(await page({ token: employee, scope: 'personal' })).body), sortedIds(personal));
    assert.deepEqual(await snapshot(), before);
    await f.query("UPDATE usuarios SET rol='edicion' WHERE id=91002");
    try { before = await snapshot(); ok(await page({ token: secondAdmin }), 403); assert.deepEqual(await snapshot(), before); }
    finally { await f.query("UPDATE usuarios SET rol='admin' WHERE id=91002"); }
    secondAdmin = await login('qa_agustin'); await f.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91002');
    before = await snapshot(); ok(await page({ token: secondAdmin }), 401); assert.deepEqual(await snapshot(), before);
  });

  await t.test('task state, membership, new task and client visibility invalidate old observation before returning later rows', async () => {
    let first = valid(await page()), before;
    await f.query("UPDATE tareas SET estado='en_progreso' WHERE id=$1", [eligible[1].id]); before = await snapshot();
    stale(await page({ offset: 50, observed: first.snapshot })); assert.deepEqual(await snapshot(), before);
    first = valid(await page({ token: employee, scope: 'personal' }));
    await f.query('DELETE FROM tarea_asignaciones WHERE tarea_id=$1 AND usuario_id=91003', [eligible[10].id]); before = await snapshot();
    stale(await page({ token: employee, scope: 'personal', offset: 50, observed: first.snapshot })); assert.deepEqual(await snapshot(), before);
    first = valid(await page()); await seed(); before = await snapshot();
    stale(await page({ offset: 50, observed: first.snapshot })); assert.deepEqual(await snapshot(), before);
    first = valid(await page()); await f.query('UPDATE clientes SET activo=false WHERE id=$1', [client.id]); before = await snapshot();
    stale(await page({ offset: 50, observed: first.snapshot })); assert.deepEqual(await snapshot(), before);
    const fresh = valid(await page()); assert.equal(Number(fresh.total), 1);
    assert.deepEqual(ids(fresh.body), [eligible[51].id]);
  });
});
