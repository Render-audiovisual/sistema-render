import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

test('shared manual task order: ID authority, receipts, stable paginated snapshots and no business updates', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const f = await startLocalHarness({ port: 55724 });
  t.after(async () => {
    await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
  });
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55724,
    url: 'postgresql://render2_fixture@127.0.0.1:55724/render2_local_test', identity });
  const api = (path, options) => request(f.base, `/api${path}`, options);
  const checked = (response, status = 200) => {
    assert.equal(response.status, status, 'Unexpected principal HTTP status'); return response.body;
  };
  const login = async usuario => {
    const result = checked(await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } }));
    assert.equal(typeof result.token, 'string'); return result.token;
  };
  const admin = await login('qa_franco');
  let editor = await login('qa_luciano');
  const reader = await login('qa_designer');
  const [client] = await f.query("INSERT INTO clientes(nombre,activo) VALUES ('QA98 order client',true) RETURNING id");
  const seed = async ({ owner = 91003, state = 'pendiente', props = {}, parent = null } = {}) => {
    const [row] = await f.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,estado,tipo_tarea,
      tarea_padre_id,fecha_vencimiento,propiedades_extra) VALUES
      ('QA98 board task','QA98 shared name',$1,$2,'edicion',$3,'2026-10-25',$4::jsonb) RETURNING id,revision`,
    [client.id, state, parent, JSON.stringify({ workspace: 'render_os', ...props })]);
    if (owner) await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,$2,'responsable')", [row.id, owner]);
    return row;
  };
  const tasks = [];
  for (let n = 0; n < 63; n++) tasks.push(await seed({ owner: n % 2 ? 91004 : 91003 }));
  const child = await seed({ parent: tasks[0].id }); tasks.push(child);
  const differentState = await seed({ state: 'en_progreso' }); tasks.push(differentState);
  const hidden = [await seed({ props: { archivada_render_os: true } }),
    await seed({ props: { papelera_render_os: true } }), await seed({ props: { workspace: 'legacy' } })];
  const page = async ({ token = editor, manual = true, offset = 0, limit = 50, snapshot, filters = {} } = {}) => {
    const query = new URLSearchParams({ workspace: 'render_os', cliente_id: String(client.id),
      limit: String(limit), offset: String(offset), ...(manual ? { sort: 'manual' } : {}), ...filters });
    if (snapshot !== undefined) query.set('expected_snapshot', snapshot);
    const response = await fetch(new URL(`/api/tareas?${query}`, f.base), {
      headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(5000),
    });
    return { status: response.status, body: await response.json(),
      revision: response.headers.get('x-task-order-revision'), snapshot: response.headers.get('x-task-order-snapshot'),
      total: response.headers.get('x-total-count') };
  };
  const ids = response => response.body.map(row => row.id);
  const validPage = result => {
    checked(result); assert.ok(Array.isArray(result.body));
    assert.match(result.revision, /^[1-9][0-9]*$/);
    assert.match(result.snapshot, /^[0-9a-f]{64}$/); return result;
  };
  const collection = async (options = {}) => {
    const first = validPage(await page(options));
    const second = validPage(await page({ ...options, offset: 50, snapshot: first.snapshot }));
    assert.equal(second.snapshot, first.snapshot);
    assert.equal(second.revision, first.revision);
    const all = [...ids(first), ...ids(second)];
    assert.equal(new Set(all).size, all.length);
    assert.equal(Number(first.total), all.length);
    return { first, ids: all };
  };
  const post = (body, token = editor) => api('/tareas/orden', { token, method: 'POST', body });
  const intent = async (task = tasks[0], before = tasks[2], token = editor) => ({
    request_id: randomUUID(), task_id: task.id, expected_revision: task.revision,
    before_id: before?.id ?? null, expected_before_revision: before?.revision ?? null,
    expected_order_revision: validPage(await page({ token })).revision,
  });
  const business = async () => {
    const result = {};
    for (const name of ['tareas', 'tarea_asignaciones', 'publicaciones', 'historias', 'cliente_objetivo_piezas',
      'editorial_publicacion_versiones', 'editorial_publicacion_eventos'])
      result[name] = await f.query(`SELECT * FROM ${name} t ORDER BY to_jsonb(t)::text`);
    return result;
  };
  const orderSnapshot = () => f.query('SELECT * FROM task_board_order t ORDER BY to_jsonb(t)::text');
  const ack = (result, body, replayed) => {
    const value = checked(result);
    assert.deepEqual(Object.keys(value).sort(), ['before_id', 'changed', 'order_revision', 'replayed', 'task_id']);
    assert.equal(value.task_id, body.task_id); assert.equal(value.before_id, body.before_id);
    assert.equal(value.replayed, replayed); assert.equal(typeof value.changed, 'boolean');
    assert.match(value.order_revision, /^[1-9][0-9]*$/); return value;
  };

  await t.test('manual collection pages >50 include children, exclude ineligible rows, and agree across fresh identities', async () => {
    assert.deepEqual(await f.query('SELECT scope,revision::text AS revision,task_ids FROM task_board_order'),
      [{ scope: 'render_os', revision: '1', task_ids: [] }]);
    const before = await business();
    const mine = await collection(), theirs = await collection({ token: reader });
    assert.deepEqual(mine.ids, theirs.ids);
    assert.deepEqual([...mine.ids].sort((a, b) => a - b), tasks.map(row => row.id).sort((a, b) => a - b));
    for (const row of hidden) assert.equal(mine.ids.includes(row.id), false);
    checked(await page({ offset: 50 }), 400);
    assert.deepEqual(await business(), before);
  });

  await t.test('owner moves only their own row; shared order persists and default date sort is unchanged', async () => {
    const dateBefore = checked(await page({ manual: false, limit: 500 }));
    const before = await business(), body = await intent();
    const result = ack(await post(body), body, false);
    assert.equal(result.changed, true);
    editor = await login('qa_luciano');
    const fresh = await collection(), shared = await collection({ token: reader });
    assert.equal(fresh.ids.indexOf(body.task_id) + 1, fresh.ids.indexOf(body.before_id));
    assert.deepEqual(fresh.ids, shared.ids);
    assert.equal(fresh.first.revision, result.order_revision);
    assert.deepEqual(checked(await page({ manual: false, limit: 500 })), dateBefore);
    assert.deepEqual(await business(), before);
  });

  await t.test('nonmember/homonym cannot move; actual membership removal revokes authority', async () => {
    await f.query("UPDATE usuarios SET nombre='QA98 shared name' WHERE id=91003");
    editor = await login('qa_luciano');
    let body = await intent(tasks[1], tasks[2]);
    let before = await business(), order = await orderSnapshot();
    checked(await post(body), 404);
    assert.deepEqual(await business(), before); assert.deepEqual(await orderSnapshot(), order);
    body = await intent(tasks[0], tasks[4]);
    await f.query('DELETE FROM tarea_asignaciones WHERE tarea_id=$1 AND usuario_id=91003', [tasks[0].id]);
    before = await business(); order = await orderSnapshot();
    checked(await post(body), 404);
    assert.deepEqual(await business(), before); assert.deepEqual(await orderSnapshot(), order);
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,91003,'responsable')", [tasks[0].id]);
  });

  await t.test('two operations with one observed global revision have one winner and one conflict', async () => {
    const first = await intent(tasks[4], tasks[8]), second = { ...await intent(tasks[6], tasks[10]), expected_order_revision: first.expected_order_revision };
    const before = await business();
    const responses = await Promise.all([post(first), post(second)]);
    assert.deepEqual(responses.map(row => row.status).sort(), [200, 409]);
    assert.deepEqual(await business(), before);
  });

  await t.test('lost-result replay and payload collision; replay after later order returns original receipt, not current revision', async () => {
    const body = await intent(tasks[12], tasks[16]);
    const original = ack(await post(body), body, false); // Genuine committed HTTP ACK, deliberately not applied to a UI.
    const later = await intent(tasks[18], tasks[22]); ack(await post(later), later, false);
    const before = await business(), order = await orderSnapshot();
    const replay = ack(await post(body), body, true);
    assert.deepEqual(replay, { ...original, replayed: true });
    checked(await post({ ...body, before_id: tasks[24].id, expected_before_revision: tasks[24].revision }), 409);
    assert.deepEqual(await business(), before); assert.deepEqual(await orderSnapshot(), order);
    assert.notEqual(validPage(await page()).revision, original.order_revision);
  });

  await t.test('filtered pagination uses its own stable collection; new tasks invalidate old snapshot and remain discoverable', async () => {
    const first = validPage(await page({ filters: { asignado_a_id: '91003' }, limit: 10 }));
    const next = validPage(await page({ filters: { asignado_a_id: '91003' }, offset: 10, limit: 50, snapshot: first.snapshot }));
    const combined = [...ids(first), ...ids(next)];
    assert.equal(new Set(combined).size, combined.length);
    assert.equal(combined.length, Number(first.total));
    const old = validPage(await page());
    const added = await seed(); tasks.push(added);
    checked(await page({ offset: 50, snapshot: old.snapshot }), 409);
    const fresh = await collection();
    assert.ok(fresh.ids.includes(added.id)); assert.equal(fresh.ids.length, tasks.length);
  });

  await t.test('cross-column anchors, stale task revisions and revoked sessions cannot mutate order or business rows', async () => {
    for (const body of [await intent(tasks[2], differentState),
      { ...await intent(tasks[2], tasks[4]), expected_revision: tasks[2].revision + 100 }]) {
      const before = await business(), order = await orderSnapshot();
      checked(await post(body), 409);
      assert.deepEqual(await business(), before); assert.deepEqual(await orderSnapshot(), order);
    }
    const body = await intent(tasks[2], tasks[4]);
    await f.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91003');
    const before = await business(), order = await orderSnapshot();
    checked(await post(body), 401); checked(await post(body, null), 401);
    assert.deepEqual(await business(), before); assert.deepEqual(await orderSnapshot(), order);
    // Admin remains independently authenticated; never borrow a display name.
    validPage(await page({ token: admin }));
  });
});
