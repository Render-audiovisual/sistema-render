import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { createApplicationSession } from '../../frontend/src/shared/session/application-session.js';
import { createCapturedRequest } from '../../frontend/src/shared/session/captured-request.js';
import { createPersonalListSaveQueue } from '../../frontend/src/pages/personalListSaveQueue.js';

const origin = 'http://127.0.0.1:5195';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aElcAAAAASUVORK5CYII=';

// Actual document runtime, principal routes/password verification and fresh PG.
// Only the loopback URL adapter, cookie jar and cooperative mutex are simulated.
// NOT mounted React, native browser cookie/Web Locks policy, HTTPS/proxy/Google
// acceptance, a live provider test, or a claim that cutover is enabled in main.
test('QA124 cookie runtime composes canonical operational writes and exact actor/proof fences across modules', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const f = await startLocalHarness({ port: 55778, browserSessions: true });
  const runtimes = [], responses = new Set(), queues = new Set();
  t.after(async () => {
    for (const queue of queues) queue.dispose();
    for (const runtime of runtimes) runtime.dispose();
    await Promise.allSettled([...responses].filter(response => !response.bodyUsed && response.body && !response.body.locked)
      .map(response => response.body.cancel()));
    await f.cleanup(); await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`QA124 cleanup ENOENT: ${f.root}; PostgreSQL port55778`);
  });
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55778,
    url: 'postgresql://render2_fixture@127.0.0.1:55778/render2_local_test', identity });
  const jar = new Map(), network = [];
  let lockTail = Promise.resolve(), activeLocks = 0;
  const locks = { request(name, options, work) {
    assert.equal(name, 'render:browser-session:v1'); assert.equal(options.mode, 'exclusive');
    const operation = lockTail.then(async () => {
      assert.equal(activeLocks++, 0);
      try { return await work(); } finally { activeLocks--; }
    });
    lockTail = operation.catch(() => {}); return operation;
  } };
  const track = response => {
    responses.add(response);
    return new Proxy(response, { get(target, key) {
      if (key === 'clone') return () => track(target.clone());
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  };
  const rawFetch = async (input, init = {}) => {
    assert.equal(typeof input, 'string');
    const intended = new URL(input, origin);
    assert.ok(intended.origin === origin && intended.pathname.startsWith('/api/'), 'Adapter only accepts this fixture origin/API');
    const headers = new Headers(init.headers);
    assert.equal(headers.has('Authorization'), false, 'Cookie acceptance never injects bearer credentials');
    assert.equal(headers.has('Cookie'), false, 'Only the simulated jar supplies Cookie');
    headers.set('Origin', origin); headers.set('Sec-Fetch-Site', 'same-origin');
    if (jar.size) headers.set('Cookie', [...jar].map(([name, value]) => `${name}=${value}`).join('; '));
    const entry = { path: intended.pathname, method: (init.method || 'GET').toUpperCase(), status: null,
      context: headers.has('X-Render-Session-Context'), csrf: headers.has('X-Render-CSRF'), setCookie: false };
    network.push(entry);
    const response = await fetch(new URL(intended.pathname + intended.search, f.base), {
      ...init, headers, redirect: 'error', signal: init.signal || AbortSignal.timeout(20000),
    });
    entry.status = response.status;
    const cookies = response.headers.getSetCookie?.()
      || (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')] : []);
    entry.setCookie = cookies.length > 0;
    for (const cookie of cookies) {
      const pair = cookie.split(';')[0], split = pair.indexOf('=');
      assert.ok(split > 0, 'Valid fixture cookie pair');
      jar.set(pair.slice(0, split), pair.slice(split + 1));
    }
    return track(response);
  };
  const storage = new Proxy({}, { get() { throw Error('Browser runtime must never access Web Storage'); } });
  const makeRuntime = () => {
    const runtime = createApplicationSession({ mode: 'browser', location: { origin }, fetchImpl: rawFetch, locks, storage });
    runtimes.push(runtime); return runtime;
  };
  const runtime = makeRuntime();
  const login = async (owner, usuario, expectedId) => {
    const result = await owner.login({ kind: 'password', body: { usuario, password: fixturePassword } });
    assert.equal(result.ok, true); assert.equal(owner.getSession().usuario.id, expectedId);
    assert.equal(result.session, owner.getSession()); assert.equal(Object.hasOwn(result.session, 'token'), false);
    return result.session;
  };
  const capture = (owner = runtime) => {
    const session = owner.getSession();
    return { session, scope: createCapturedRequest({ session, readSession: owner.getSession, request: owner.fetch }) };
  };
  const call = async (path, { owner = runtime, captured = capture(owner), method = 'GET', body, status = 200 } = {}) => {
    // Encode once, before any await: mutations keep their original binding/body.
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    const response = await captured.scope.request(`/api${path}`, { method,
      ...(encoded === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: encoded }),
      signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, status, 'Actual principal status; never print credential/cookie bodies');
    assert.ok(response.headers.get('X-Render-Session-Context') === captured.session.session_context,
      'Every delivered operational response must prove the original cookie context');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) {
      const sent = network.at(-1);
      assert.ok(sent.context && sent.csrf, 'Positive runtime mutations must carry both original context and CSRF');
    }
    const result = response.status === 204 ? null : await response.json();
    captured.scope.assertCurrent(); return result;
  };
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  const snapshot = async (selected = tables) => {
    const rows = {};
    for (const table of selected) {
      assert.match(table, /^[a-zA-Z_][a-zA-Z_0-9]*$/);
      rows[table] = await f.query(`SELECT * FROM "${table}" t ORDER BY to_jsonb(t)::text`);
    }
    return rows;
  };
  const editorialTables = ['historias', 'publicaciones', 'editorial_publicacion_eventos',
    'editorial_publicacion_versiones', 'cliente_objetivo_piezas', 'cliente_objetivo_eventos'];
  const originalEditorial = await snapshot(editorialTables);
  const noPublication = async () => assert.deepEqual(await snapshot(editorialTables), originalEditorial,
    'Operational work must not invent pieces, goal slots or publication confirmation');
  const [clock] = await f.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM-DD') today");
  const dayAfter = days => new Date(Date.parse(`${clock.today}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  const marker = 'QA124_PRIVATE_FINANCIAL_CANARY';
  let clientId, taskId, listId, listVersion, feedbackId, referenceId, visitId;
  const videoIds = [], editingTasks = [];

  await t.test('one initial bootstrap then actual password login publishes a genuine cookie DTO, never a token or Storage snapshot', async () => {
    const started = runtime.start(); assert.equal(runtime.start(), started);
    assert.equal((await started).reason, 'anonymous');
    await login(runtime, 'qa_franco', 91001);
    assert.equal((await call('/inicio')).user.id, 91001);
    const challenges = network.filter(row => row.path === '/api/sesion/desafio');
    assert.equal(challenges.length, 1); assert.equal(challenges[0].setCookie, true);
    assert.ok(network.some(row => row.path === '/api/login/browser' && row.status === 200 && row.csrf && row.setCookie));
    assert.ok(network.some(row => row.path === '/api/sesion' && row.status === 200));
  });

  await t.test('cookie-bound client/task create and employee task PATCH persist exact IDs/CAS and preserve financial privacy', async () => {
    const client = await call('/clientes', { method: 'POST', body: { nombre: 'QA124 cookie operation client' }, status: 201 });
    clientId = client.id;
    const created = await call('/tareas', { method: 'POST', status: 201, body: {
      titulo: 'QA124 cookie operational task', workspace: 'render_os', tipo_tarea: 'edicion', subtipo: 'video',
      cliente_id: clientId, asignado_a_id: 91003, colaborador_ids: [], fecha_vencimiento: clock.today,
    } });
    taskId = created.id;
    assert.deepEqual(await f.query('SELECT tarea_id,usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1', [taskId]),
      [{ tarea_id: taskId, usuario_id: 91003, tipo: 'responsable' }]);
    await f.query('UPDATE tareas SET propiedades_extra=propiedades_extra||$2::jsonb WHERE id=$1',
      [taskId, JSON.stringify({ private_finance: { marker, importe: 817293.46 } })]);
    await login(runtime, 'qa_luciano', 91003);
    const observed = await call(`/tareas/${taskId}?workspace=render_os`);
    assert.equal(JSON.stringify(observed).includes(marker), false);
    const updated = await call(`/tareas/${taskId}?workspace=render_os`, { method: 'PATCH', body: {
      expected_revision: observed.revision, estado: 'en_progreso',
    } });
    assert.equal(updated.id, taskId); assert.equal(updated.revision, observed.revision + 1); assert.equal(updated.estado, 'en_progreso');
    const before = await snapshot();
    for (const route of ['/sueldos?periodo=2026-10', '/contratos', '/finanzas/pagos?periodo=2026-10']) {
      const denied = await call(route, { status: 403 });
      for (const key of ['finance', 'payroll', 'items', 'total_recorded_ars']) assert.equal(Object.hasOwn(denied, key), false);
      assert.equal(JSON.stringify(denied).includes(marker), false);
    }
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('three explicit registry videos yield exactly three ID-assigned editing tasks, stable on retry and independent of visit date', async () => {
    await login(runtime, 'qa_franco', 91001);
    const tasksBefore = (await f.query('SELECT id FROM tareas ORDER BY id')).map(row => row.id);
    const creation = { request_id: randomUUID(), cliente_id: clientId, fecha: clock.today,
      titulo: 'QA124 cookie three-video production', participante_ids: [91001, 91002, 91003], drive_url: '', observaciones: 'Explicit new work' };
    let visit = (await call('/producciones', { method: 'POST', body: creation, status: 201 })).visita;
    visitId = visit.id; assert.equal(visit.tarea_origen_id, null);
    for (let index = 0; index < 3; index++) {
      const title = `QA124 explicit video ${index + 1}`;
      visit = (await call(`/producciones/${visitId}/videos`, { method: 'POST', status: 201,
        body: { expected_revision: visit.revision, titulo: title, guion: `Literal script ${index + 1}`, estado: 'planificado' } })).visita;
      const video = visit.videos.find(row => row.titulo === title); assert.ok(video); videoIds.push(video.id);
      visit = (await call(`/producciones/${visitId}/videos/${video.id}`, { method: 'PATCH', body: {
        expected_revision: visit.revision, estado: 'grabado', material_url: `https://example.invalid/qa124/video-${index + 1}`,
      } })).visita;
    }
    assert.equal(new Set(videoIds).size, 3);
    assert.deepEqual((await f.query('SELECT id FROM tareas ORDER BY id')).map(row => row.id), tasksBefore);
    for (const [index, editorId] of [91001, 91002, 91003].entries()) {
      visit = (await call(`/producciones/${visitId}`)).visita;
      const body = { expected_revision: visit.revision, editor_id: editorId, fecha_entrega: dayAfter(index + 7) };
      const sent = await call(`/producciones/${visitId}/videos/${videoIds[index]}/enviar-edicion`, { method: 'POST', body, status: 201 });
      assert.equal(sent.created, true); assert.equal(sent.task.asignado_a_id, editorId);
      editingTasks.push({ id: sent.task.id, owner: editorId, due: body.fecha_entrega, videoId: videoIds[index] });
      const before = await snapshot(), replay = await call(`/producciones/${visitId}/videos/${videoIds[index]}/enviar-edicion`, { method: 'POST', body });
      assert.equal(replay.created, false); assert.equal(replay.task.id, sent.task.id); assert.deepEqual(await snapshot(), before);
    }
    assert.equal(new Set(editingTasks.map(row => row.id)).size, 3);
    assert.deepEqual((await f.query('SELECT id FROM tareas ORDER BY id')).map(row => row.id),
      [...tasksBefore, ...editingTasks.map(row => row.id)].sort((a, b) => a - b));
    for (const row of editingTasks) assert.deepEqual(await f.query('SELECT usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1', [row.id]),
      [{ usuario_id: row.owner, tipo: 'responsable' }]);
    const replay = (await call('/producciones', { method: 'POST', body: creation })).visita;
    assert.equal(replay.id, visitId); assert.equal(replay.videos.length, 3); assert.equal(replay.fecha, clock.today);
    for (const row of editingTasks) {
      const video = replay.videos.find(item => item.id === row.videoId);
      assert.equal(video.tarea_edicion_id, row.id); assert.equal(video.fecha_entrega_actual, row.due);
      assert.equal(video.publicacion_id, null); assert.equal(video.tarea_entrega_id, null);
    }
    await noPublication();
    for (const [name, id] of [['qa_franco', 91001], ['qa_agustin', 91002], ['qa_luciano', 91003]]) {
      await login(runtime, name, id);
      const own = editingTasks.find(row => row.owner === id), detail = await call(`/tareas/${own.id}?workspace=render_os`);
      assert.equal(detail.asignado_a_id, id); assert.equal(detail.fecha_vencimiento.slice(0, 10), own.due);
      assert.equal((await call('/inicio')).user.id, id);
      assert.equal((await call(`/producciones/${visitId}`)).visita.videos.length, 3);
    }
  });

  await t.test('canonical feedback operation create/edit/replay works through genuine employee cookie intent and closed historical metadata', async () => {
    const creation = { request_id: randomUUID(), action: 'create', fields: { titulo: 'QA124 cookie feedback',
      contenido: 'Explicit cookie correction', categoria: 'general', feedback: { cliente: 'QA124 cookie operation client',
        responsables: ['Luciano QA'], referencia: 'https://example.invalid/qa124/reference', flujo: 'feedback', estado: 'pendiente' } } };
    const created = await call('/notas/operaciones', { method: 'POST', body: creation, status: 201 });
    feedbackId = created.note.id; assert.equal(created.operation.replayed, false);
    await f.query('UPDATE notas_compartidas SET feedback=feedback||$2::jsonb WHERE id=$1',
      [feedbackId, JSON.stringify({ private_finance: { marker, importe: 817293.46 } })]);
    const observed = (await call(`/notas/${feedbackId}/detalle?papelera=false`)).item;
    assert.equal(JSON.stringify(observed).includes(marker), false);
    const edit = { request_id: randomUUID(), action: 'edit', note_id: feedbackId, expected_updated_at: observed.updated_at,
      fields: { contenido: 'QA124 persisted cookie feedback edit' } };
    const saved = await call('/notas/operaciones', { method: 'POST', body: edit });
    assert.equal(saved.note.contenido, edit.fields.contenido); assert.equal(saved.operation.replayed, false);
    assert.equal(JSON.stringify(saved).includes(marker), false);
    const before = await snapshot(), replay = await call('/notas/operaciones', { method: 'POST', body: edit });
    assert.equal(replay.note.id, feedbackId); assert.equal(replay.operation.replayed, true); assert.deepEqual(await snapshot(), before);
  });

  await t.test('category/reference/image/link operations persist through the cookie runtime without leaking task bags or inventing publication', async () => {
    await login(runtime, 'qa_franco', 91001);
    await call('/moodboards/boards/initialize', { method: 'POST', body: {} });
    const boards = await call('/moodboards/boards');
    const board = boards.find(row => row.clientes.some(client => client.id === clientId)); assert.ok(board);
    const observed = await call(`/moodboards/boards/${board.id}/category-snapshot`);
    const categoryChange = { request_id: randomUUID(), expected_revision: observed.revision,
      changes: [{ type: 'create', name: 'QA124 cookie category' }] };
    const category = (await call(`/moodboards/boards/${board.id}/category-changes`, { method: 'POST', body: categoryChange, status: 201 }))
      .categories.find(row => row.nombre === 'QA124 cookie category'); assert.ok(category);
    const creation = { request_id: randomUUID(), action: 'create', board_id: board.id, fields: {
      title: 'QA124 cookie image reference', note: 'Independent visual reference', category_id: category.id,
      tags: ['cookie-acceptance'], image_data: `data:image/png;base64,${png}`,
    } };
    const created = await call('/moodboards/reference-operations', { method: 'POST', body: creation, status: 201 });
    referenceId = created.reference.id; assert.equal(created.reference.revision, 0);
    const edit = { request_id: randomUUID(), action: 'edit', board_id: board.id, reference_id: referenceId,
      expected_revision: created.reference.revision, fields: { note: 'QA124 saved cookie reference edit', status: 'aprobada' } };
    const saved = await call('/moodboards/reference-operations', { method: 'POST', body: edit });
    assert.equal(saved.reference.estado, 'aprobada');
    await call(`/moodboards/references/${referenceId}/tasks/${taskId}`, { method: 'POST', status: 204 });
    const detail = (await call(`/moodboards/references/${referenceId}/detail`)).reference;
    assert.equal(detail.revision, saved.reference.revision); assert.deepEqual(detail.tareas, [{ id: taskId, titulo: 'QA124 cookie operational task' }]);
    assert.equal(JSON.stringify(detail).includes(marker), false);
    const captured = capture(), asset = await captured.scope.request(`/api/moodboards/assets/${detail.archivo_nombre}`);
    assert.equal(asset.status, 200); assert.ok(asset.headers.get('X-Render-Session-Context') === captured.session.session_context);
    assert.deepEqual(Buffer.from(await asset.arrayBuffer()), Buffer.from(png, 'base64')); captured.scope.assertCurrent();
    const before = await snapshot(), replay = await call('/moodboards/reference-operations', { method: 'POST', body: creation });
    assert.equal(replay.operation.replayed, true); assert.equal(replay.reference.id, referenceId);
    assert.equal(replay.reference.nota, edit.fields.note); assert.deepEqual(await snapshot(), before); await noPublication();
  });

  await t.test('personal-list BIGSERIAL IDs and the real save queue persist under cookie binding; other users never inherit private lists', async () => {
    const created = await call('/listas-personales', { method: 'POST', body: { request_id: randomUUID(), titulo: 'QA124 private administrator list', bloques: [] }, status: 201 });
    assert.equal(typeof created.id, 'string'); listId = created.id; listVersion = created.version;
    const saved = [], session = runtime.getSession();
    const queue = createPersonalListSaveQueue({ session, readSession: runtime.getSession, delayMs: 60000,
      request: async (url, options) => {
        const response = await runtime.fetch(url, options), body = await response.json();
        if (!response.ok) throw Object.assign(new Error('Fixture list save rejected'), { status: response.status });
        return body;
      }, onSaved: value => saved.push(value.row) });
    queues.add(queue);
    assert.equal(queue.schedule({ key: `list:${listId}`, url: `/api/listas-personales/${listId}`, version: listVersion,
      payload: { titulo: 'QA124 persisted cookie queue list' }, meta: { listId, recordId: listId } }), true);
    assert.equal(await queue.flush(), true); assert.equal(saved.length, 1); listVersion = saved[0].version;
    assert.deepEqual(await f.query('SELECT usuario_id,titulo,version FROM listas_personales WHERE id=$1', [listId]),
      [{ usuario_id: 91001, titulo: 'QA124 persisted cookie queue list', version: listVersion }]);
    assert.equal(queue.schedule({ key: `list:${listId}`, url: `/api/listas-personales/${listId}`, version: listVersion,
      payload: { titulo: 'QA124 old A draft must not become B' }, meta: { listId, recordId: listId } }), true);
    await login(runtime, 'qa_luciano', 91003);
    const before = await snapshot(), count = network.length;
    assert.equal(await queue.flush(), false); assert.equal(network.length, count); assert.deepEqual(await snapshot(), before);
    queue.dispose(); queues.delete(queue);
    const deniedBefore = await snapshot();
    await call(`/listas-personales/${listId}`, { method: 'PATCH', status: 404,
      body: { titulo: 'QA124 B cannot edit A private list', expected_version: listVersion } });
    assert.deepEqual(await snapshot(), deniedBefore);
    const catalog = await call('/listas-personales'); assert.equal(catalog.some(row => row.id === listId), false);
    const own = await call('/listas-personales', { method: 'POST', body: { request_id: randomUUID(), titulo: 'QA124 employee own list', bloques: [] }, status: 201 });
    assert.notEqual(own.id, listId); assert.equal((await f.query('SELECT usuario_id FROM listas_personales WHERE id=$1', [own.id]))[0].usuario_id, 91003);
  });

  await t.test('server CSRF/context rejection remains effective independently of the client wrapper, with no rebasing or SQL effects', async () => {
    const captured = capture();
    const body = { request_id: randomUUID(), action: 'create', fields: { titulo: 'QA124 CSRF must not write', contenido: 'Not permitted' } };
    const valid = captured.scope.options({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    for (const missing of ['X-Render-CSRF', 'X-Render-Session-Context']) {
      const headers = new Headers(valid.headers); headers.delete(missing); const before = await snapshot();
      // Deliberate direct HTTP negative probe bypasses only the client checks,
      // retaining the actual jar and server middleware. No fabricated cookie.
      const response = await rawFetch('/api/notas/operaciones', { ...valid, headers, credentials: 'same-origin' });
      assert.equal(response.status, missing === 'X-Render-CSRF' ? 403 : 409);
      const denied = await response.json(); assert.equal(Object.hasOwn(denied, 'note'), false);
      assert.deepEqual(await snapshot(), before);
    }
    const cookieB = makeRuntime(); await login(cookieB, 'qa_franco', 91001);
    const before = await snapshot();
    // Runtime invalidation makes the enclosing original request scope obsolete;
    // its public fence replaces the inner transport error, never rebases to B.
    await assert.rejects(call('/notas/operaciones', { captured, method: 'POST', body, status: 201 }),
      error => error.code === 'session_binding_obsolete');
    assert.deepEqual(await snapshot(), before); assert.equal(runtime.getSession(), null);
    assert.equal(cookieB.getSession().usuario.id, 91001);
    const crossed = network.at(-1); assert.equal(crossed.status, 409); assert.equal(crossed.context, true); assert.equal(crossed.csrf, true);
    assert.equal(crossed.setCookie, false);
  });

  await t.test('body proof rejects cookie B before data delivery, and old response/queued scopes never survive a fresh B bootstrap', async () => {
    await login(runtime, 'qa_franco', 91001);
    const captured = capture(), old = await captured.scope.request('/api/inicio');
    const cookieB = makeRuntime(); await login(cookieB, 'qa_luciano', 91003);
    const before = await snapshot();
    await assert.rejects(runtime.fetch('/api/inicio'), error => error.code === 'browser_response_context_changed');
    assert.equal(runtime.getSession(), null); assert.equal(cookieB.getSession().usuario.id, 91003);
    await assert.rejects(old.json(), error => error.code === 'browser_intent_obsolete');
    await login(runtime, 'qa_luciano', 91003);
    const count = network.length;
    await assert.rejects(call('/notas/operaciones', { captured, method: 'POST', status: 201,
      body: { request_id: randomUUID(), action: 'create', fields: { titulo: 'QA124 obsolete scope' } } }),
    error => error.code === 'session_binding_obsolete');
    assert.equal(network.length, count);
    // Login legitimately records its abuse bucket; operational tables do not change.
    const after = await snapshot(tables.filter(name => name !== 'auth_login_buckets'));
    const expected = { ...before }; delete expected.auth_login_buckets; assert.deepEqual(after, expected);
    assert.equal((await call('/inicio')).user.id, 91003);
  });

  await t.test('confirmed cookie logout revokes only its actor; old scope and still-present old cookie cannot restore or write', async () => {
    const captured = capture(), before = await snapshot();
    assert.equal(captured.session.usuario.id, 91003);
    assert.deepEqual(await runtime.logout(), { revoked: true }); assert.equal(runtime.getSession(), null);
    const after = await snapshot();
    const oldUser = before.usuarios.find(row => row.id === 91003), currentUser = after.usuarios.find(row => row.id === 91003);
    assert.equal(currentUser.session_version, oldUser.session_version + 1);
    assert.equal(currentUser.user_admin_version, oldUser.user_admin_version + 1);
    const withoutVersions = ({ session_version: _epoch, user_admin_version: _adminVersion, ...row }) => row;
    assert.deepEqual(withoutVersions(currentUser), withoutVersions(oldUser));
    assert.deepEqual(after.usuarios.filter(row => row.id !== 91003), before.usuarios.filter(row => row.id !== 91003));
    for (const table of tables.filter(name => name !== 'usuarios')) assert.deepEqual(after[table], before[table], table);
    const count = network.length;
    await assert.rejects(call('/listas-personales', { captured, method: 'POST', body: { request_id: randomUUID(), titulo: 'Old logout scope' }, status: 201 }),
      error => error.code === 'session_binding_obsolete');
    assert.equal(network.length, count);
    const unauthorized = await rawFetch('/api/sesion', { credentials: 'same-origin' });
    assert.equal(unauthorized.status, 401); assert.equal(unauthorized.headers.get('set-cookie'), null);
    assert.equal(network.filter(row => row.path === '/api/logout').at(-1).setCookie, false);
    assert.deepEqual(await snapshot(), after); await noPublication();
  });
});
