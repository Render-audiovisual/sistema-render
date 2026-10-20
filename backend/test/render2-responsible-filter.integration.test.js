import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

// No configured DB/server import. Starting services is confined to explicit opt-in.
test('responsible-ID task list HTTP membership, pagination, rename stability and write isolation', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55638 });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own responsible-filter fixture stopped and removed: ${fixture.root}`);
  });
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port: 55638,
    url: 'postgresql://render2_fixture@127.0.0.1:55638/render2_local_test', identity });
  const ids = { a: 98701, b: 98702, empty: 98703, absent: 2147483647 };
  const sharedName = 'QA Responsible Homonym';
  for (const [key, id] of Object.entries(ids).filter(([key]) => key !== 'absent')) {
    const inserted = await fixture.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,$3,'edicion',password_hash,true,1 FROM usuarios WHERE id=91004 RETURNING id`,
    [id, `qa_responsible_${key}`, key === 'empty' ? 'QA Responsible Empty' : sharedName]);
    assert.deepEqual(inserted, [{ id }]);
  }
  const api = (route, options) => request(fixture.base, `/api${route}`, options);
  const expect = (result, status) => { assert.equal(result.status, status, JSON.stringify(result.body)); return result.body; };
  const login = async usuario => {
    const body = expect(await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } }), 200);
    assert.ok(body.token);
    return body.token;
  };
  const admin = await login('qa_franco');
  const a = await login('qa_responsible_a');
  const b = await login('qa_responsible_b');
  const reader = await login('qa_designer');
  const secret = 'QA_RESPONSIBLE_PRIVATE_55638';
  const rows = [];
  let serial = 0;
  const seed = async ({ owner = ids.a, collaborators = [], due = null, props = {}, visible = true } = {}) => {
    const [row] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,prioridad,
      fecha_vencimiento,propiedades_extra,created_at)
      VALUES ($1,$2,'pendiente','diseno','media',$3,$4::jsonb,$5) RETURNING id,revision`,
    [`QA Responsible task ${++serial}`, sharedName, due,
      JSON.stringify({ workspace: 'render_os', colaboradores: [sharedName, sharedName],
        private_finance: { importe: 658213.47, marker: secret }, unknown_private_field: secret, ...props }),
      // Deliberately unrelated creation order to expose accidental created_at sorting.
      `2026-01-${String(1 + serial % 20).padStart(2, '0')}T12:00:00Z`]);
    if (owner !== null) await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,$2,'responsable')", [row.id, owner]);
    for (const id of collaborators.filter(id => id !== owner)) await fixture.query(`INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo)
      VALUES ($1,$2,'colaborador') ON CONFLICT(tarea_id,usuario_id) DO NOTHING`, [row.id, id]);
    const model = { id: row.id, due, visible, members: new Set([owner, ...collaborators].filter(id => id !== null)) };
    rows.push(model);
    return model;
  };
  // 123 matching rows plus API membership force >50 results and three pages.
  for (let n = 0; n < 123; n++) await seed({
    owner: n % 2 ? ids.b : ids.a,
    collaborators: n % 2 ? [ids.a, ids.a] : n % 5 === 0 ? [ids.b, ids.b] : [],
    due: n % 9 === 0 ? null : `2026-10-${String(20 + n % 3).padStart(2, '0')}`,
  });
  for (let n = 0; n < 7; n++) await seed({ owner: ids.b, due: '2026-10-19' });
  const legacy = await seed({ owner: null, due: '2026-10-18' });
  for (const props of [{ workspace: 'historical' }, { workspace: null },
    { archivada_render_os: true }, { papelera_render_os: true }]) {
    await seed({ props, due: '2026-10-17', visible: false });
  }
  const created = expect(await api('/tareas', { token: admin, method: 'POST', body: {
    titulo: 'QA Responsible API owner and collaborator', workspace: 'render_os', asignado_a_id: ids.b,
    colaborador_ids: [ids.a, ids.a], tipo_tarea: 'diseno', fecha_vencimiento: '2026-10-16',
  } }), 201);
  assert.equal(created.asignado_a_id, ids.b);
  assert.deepEqual(created.colaborador_ids, [ids.a]);
  rows.push({ id: created.id, due: '2026-10-16', visible: true, members: new Set([ids.a, ids.b]) });
  const selected = id => rows.filter(row => row.visible && row.members.has(id)).sort((left, right) =>
    Number(left.due === null) - Number(right.due === null)
    || (left.due || '').localeCompare(right.due || '') || right.id - left.id);
  // Scoped direct GET is intentional: the shared request helper drops headers.
  const get = async (query, token = reader) => {
    const response = await fetch(new URL(`/api/tareas?workspace=render_os&${query}`, fixture.base), {
      signal: AbortSignal.timeout(5000), headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    return { status: response.status, body: await response.json(), total: response.headers.get('X-Total-Count') };
  };
  const privacy = items => {
    const encoded = JSON.stringify(items);
    assert.ok(!encoded.includes(secret) && !encoded.includes('658213.47'));
    for (const item of items) {
      assert.ok(!Object.hasOwn(item, 'private_finance') && !Object.hasOwn(item, 'unknown_private_field'));
      assert.ok(!Object.hasOwn(item.propiedades_extra || {}, 'private_finance'));
      assert.ok(!Object.hasOwn(item.propiedades_extra || {}, 'unknown_private_field'));
      assert.ok(Number.isSafeInteger(item.id) && item.id > 0);
    }
  };
  const checkPage = async (id, offset, limit, token = reader, extra = '') => {
    const response = await get(`asignado_a_id=${id}&limit=${limit}&offset=${offset}${extra}`, token);
    expect(response, 200);
    assert.ok(Array.isArray(response.body));
    const expected = selected(id);
    assert.equal(response.total, String(expected.length), 'X-Total-Count is pre-pagination membership total');
    assert.deepEqual(response.body.map(item => item.id), expected.slice(offset, offset + limit).map(row => row.id));
    assert.equal(new Set(response.body.map(item => item.id)).size, response.body.length);
    if (token !== admin) privacy(response.body); // Existing DTO intentionally differs for admins.
    return response.body;
  };
  const snapshot = async () => ({
    tasks: await fixture.query('SELECT to_jsonb(t) AS row FROM tareas t ORDER BY id'),
    assignments: await fixture.query('SELECT * FROM tarea_asignaciones ORDER BY tarea_id,usuario_id'),
  });

  await t.test('ID-only filter separates homonyms and includes owner/collaborator exactly once on every page', async () => {
    const before = await snapshot();
    const collected = [];
    for (const offset of [0, 50, 100]) collected.push(...await checkPage(ids.a, offset, 50));
    assert.equal(selected(ids.a).length, 124);
    assert.deepEqual(collected.map(item => item.id), selected(ids.a).map(row => row.id));
    assert.equal(new Set(collected.map(item => item.id)).size, 124);
    assert.ok(collected.some(item => item.id === created.id), 'Collaborator is included, not only owner');
    assert.ok(!collected.some(item => item.id === legacy.id), 'Name-only legacy labels do not establish membership');
    const other = await checkPage(ids.b, 0, 500, b);
    assert.notDeepEqual(other.map(item => item.id), collected.map(item => item.id));
    await checkPage(ids.a, 0, 50, admin);
    // A conflicting legacy name must not narrow or broaden an explicit ID.
    await checkPage(ids.a, 0, 50, reader, '&asignado_a=Unrelated%20Name');
    assert.deepEqual(await snapshot(), before, 'Shared list reads never rewrite legacy labels/bindings');
  });
  await t.test('same ID survives display-name change without task-label rewrite or fresh-login selection drift', async () => {
    const before = await snapshot();
    await fixture.query("UPDATE usuarios SET nombre='QA Responsible Renamed' WHERE id=$1", [ids.a]);
    const fresh = await login('qa_responsible_a');
    for (const offset of [0, 50, 100]) {
      await checkPage(ids.a, offset, 50, a);
      await checkPage(ids.a, offset, 50, fresh);
    }
    await checkPage(ids.b, 0, 500, reader);
    assert.deepEqual(await snapshot(), before, 'Renaming the account does not infer/migrate task membership');
  });
  await t.test('valid empty and nonexistent catalog IDs return empty arrays and zero total', async () => {
    assert.equal((await fixture.query('SELECT id FROM usuarios WHERE id=$1', [ids.absent])).length, 0);
    for (const id of [ids.empty, ids.absent]) await checkPage(id, 0, 50);
  });
  await t.test('invalid or repeated IDs reject with 400 rather than coercion, SQL errors or global fallback', async () => {
    const before = await snapshot();
    for (const value of ['', '0', '-1', '+1', '%2B1', '01', '1.0', '1e2', 'Infinity', 'NaN',
      '2147483648', '9007199254740991', '9007199254740992', '%201', '1%20', 'null', 'undefined', '%00', '١']) {
      expect(await get(`asignado_a_id=${value}&limit=50&offset=0`), 400);
    }
    for (const query of [`asignado_a_id=${ids.a}&asignado_a_id=${ids.a}`,
      `asignado_a_id=${ids.a}&asignado_a_id=${ids.b}`]) {
      expect(await get(`${query}&limit=50&offset=0`), 400);
    }
    // Express's current simple parser treats asignado_a_id[] / asignado_a_id[x]
    // as literal unknown keys, not array/object values of asignado_a_id. Unknown
    // query-key rejection is not this endpoint's contract, so do not assert 400
    // for those spellings. Repeated actual ID keys above exercise array rejection;
    // HTTP object coercion would require a separately configured extended parser.
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('nonadmin shared reads and responsible filters never grant write access to another task', async () => {
    const visible = await checkPage(ids.b, 0, 50, reader);
    assert.ok(visible.some(item => item.id === created.id));
    const before = await snapshot();
    const denied = await api(`/tareas/${created.id}?workspace=render_os&asignado_a_id=${ids.b}`, {
      token: reader, method: 'PATCH', body: { titulo: 'Denied shared-reader mutation', expected_revision: created.revision },
    });
    assert.ok([403, 404].includes(denied.status), JSON.stringify(denied.body));
    assert.deepEqual(await snapshot(), before);
    const noAuth = await get(`asignado_a_id=${ids.a}&limit=50&offset=0`, null);
    expect(noAuth, 401);
  });
});
