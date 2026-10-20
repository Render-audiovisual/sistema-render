import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

const marker = 'QA_FEEDBACK_INVENTORY_PRIVATE_BODY_55675';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Author-only until parent explicitly runs the opted-in physical suite. SQL
// volume fixtures are declared synthetic; one separate flow uses real writers.
test('feedback task inventory HTTP: genuine artifacts/history, paginated shared scope and closed summaries', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55675 });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own feedback inventory fixture stopped and removed: ${fixture.root}`);
  });
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port: 55675,
    url: 'postgresql://render2_fixture@127.0.0.1:55675/render2_local_test', identity });
  const checked = (response, status = 200) => {
    assert.equal(response.status, status, 'HTTP status; private response bodies intentionally omitted'); return response.body;
  };
  const api = (path, token, method = 'GET', body) => request(fixture.base, `/api${path}`, { token, method, body });
  const login = async usuario => checked(await api('/login', undefined, 'POST', { usuario, password: fixturePassword })).token;
  const admin = await login('qa_franco'), editor = await login('qa_luciano');
  const accounts = [['admin', admin], ['edicion', editor], ['diseno', await login('qa_designer')]];
  for (const [index, role] of ['produccion', 'community', 'programacion', 'edicion'].entries()) {
    const id = 918751 + index, usuario = `qa_feedback_inventory_${index}`;
    await fixture.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,'QA feedback inventory reader',$3,password_hash,true,1 FROM usuarios WHERE id=91004`, [id, usuario, role]);
    accounts.push([role, await login(usuario)]);
  }
  const [clientA] = await fixture.query("INSERT INTO clientes(nombre,activo) VALUES ('QA Inventory client A',true) RETURNING id,nombre");
  const [clientB] = await fixture.query("INSERT INTO clientes(nombre,activo) VALUES ('QA Inventory needle client B',true) RETURNING id,nombre");
  const [inactive] = await fixture.query("INSERT INTO clientes(nombre,activo) VALUES ('QA Inventory inactive',false) RETURNING id,nombre");
  const modeled = new Map();
  let serial = 0;
  const inventory = (query = '', token = admin) => api(`/tareas-edicion/inventario-feedback${query ? `?${query}` : ''}`, token);
  const tables = ['tareas', 'tarea_asignaciones', 'tarea_comentarios', 'task_editing_deliveries', 'task_editing_reviews',
    'notas_compartidas', 'historias', 'publicaciones', 'editorial_publicacion_eventos', 'cliente_objetivo_piezas'];
  const snapshot = async () => {
    const state = {};
    for (const table of tables) state[table] = digest(await fixture.query(`SELECT * FROM ${table} r ORDER BY to_jsonb(r)::text`));
    return state;
  };
  const expected = ({ view = 'all', client, q = '' } = {}) => [...modeled.values()]
    .filter(row => row.visible && (view === 'all' ? row.awaiting || row.decision !== null : view === 'awaiting_review' ? row.awaiting : row.corrections)
      && (client === undefined || row.client?.id === client)
      && `${row.title} ${row.client?.nombre || ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.id - a.id);
  const assertPage = (body, rows, { offset = 0, limit = 20 } = {}) => {
    assert.deepEqual(Object.keys(body).sort(), ['version', 'offset', 'limit', 'total', 'has_more', 'items'].sort());
    assert.equal(body.version, 1); assert.equal(body.offset, offset); assert.equal(body.limit, limit);
    assert.equal(body.total, rows.length); assert.equal(body.has_more, offset + limit < rows.length);
    const wanted = rows.slice(offset, offset + limit);
    assert.deepEqual(body.items.map(row => row.task_id), wanted.map(row => row.id));
    assert.equal(new Set(body.items.map(row => row.task_id)).size, body.items.length);
    for (let index = 0; index < wanted.length; index += 1) {
      const item = body.items[index], row = wanted[index];
      assert.deepEqual(Object.keys(item).sort(), ['task_id', 'revision', 'titulo', 'estado', 'cliente',
        'latest_delivery', 'latest_decision', 'has_corrections', 'href'].sort());
      assert.equal(item.revision, row.revision); assert.equal(item.titulo, row.title); assert.equal(item.estado, row.state);
      assert.deepEqual(item.cliente, row.client); assert.equal(item.has_corrections, row.corrections);
      assert.equal(item.href, `/workspace/tareas?task=${row.id}`);
      for (const [key, proof] of [['latest_delivery', row.delivery], ['latest_decision', row.decision]]) {
        if (!proof) { assert.equal(item[key], null); continue; }
        const actual = item[key];
        assert.deepEqual(Object.keys(actual).sort(), (key === 'latest_delivery'
          ? ['id', 'task_revision', 'recorded_at'] : ['id', 'delivery_id', 'action', 'task_revision', 'recorded_at']).sort());
        assert.match(actual.id, uuid); assert.equal(actual.id, proof.id); assert.equal(actual.task_revision, proof.revision);
        assert.equal(new Date(actual.recorded_at).toISOString(), actual.recorded_at);
        if (key === 'latest_decision') { assert.equal(actual.action, proof.action); assert.equal(actual.delivery_id, proof.deliveryId); }
      }
    }
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes(marker), false);
    for (const forbidden of ['propiedades_extra', 'password_hash', 'payload_hash', 'request_id', 'notes', 'url', 'actor_id', 'resolved', 'resuelto'])
      assert.equal(new RegExp(`"${forbidden}"\\s*:`).test(serialized), false, `No private body or inferred ${forbidden}`);
  };
  // Synthetic ledger INSERTs for volume only: valid FK/action/revision pairs,
  // no trigger disabling, immutable-row UPDATE or pretend API provenance.
  const seed = async ({ state = 'en_revision', client = clientA, title, visible = true, sector = 'edicion',
    metadata = {}, deliveries = [1, 4], decisions = [], awaiting = true, correction = decisions.includes('correcciones'), approvalBinding } = {}) => {
    const artifacts = deliveries.map(revision => ({ id: randomUUID(), revision }));
    // Historical proof fixtures enter through INSERT. An UPDATE false→true in
    // en_revision correctly invalidates approval via the production trigger.
    const approval = approvalBinding ? { revision_aprobada: true,
      revision_aprobada_entrega_id: (approvalBinding === 'first' ? artifacts[0] : artifacts.at(-1)).id } : {};
    const [task] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,estado,tipo_tarea,cliente_id,revision,
      material_referencia,aclaraciones,propiedades_extra)
      VALUES ($1,'QA fixture label',$2,$3,$4,10,$5,$6,$7::jsonb) RETURNING id,revision`,
    [title || `QA genuine inventory ${++serial}`, state, sector, client?.id ?? null,
      `https://example.invalid/${marker}`, marker, JSON.stringify({ workspace: 'render_os', private_finance: { marker, amount: 987654.32 }, ...metadata, ...approval })]);
    for (const { id, revision } of artifacts) {
      await fixture.query(`INSERT INTO task_editing_deliveries(id,task_id,actor_id,request_id,payload_hash,task_revision,url,notes,recorded_at)
        VALUES ($1,$2,91003,$3,$4,$5,$6,$7,'2026-10-20T12:00:00Z')`,
      [id, task.id, randomUUID(), 'a'.repeat(64), revision, `https://example.invalid/${marker}`, marker]);
    }
    let last = null;
    for (const [index, action] of decisions.entries()) {
      const id = randomUUID(), revision = index + 2, deliveryId = artifacts[0].id;
      await fixture.query(`INSERT INTO task_editing_reviews(id,task_id,delivery_id,actor_id,action,task_revision,notes,request_id,payload_hash,recorded_at)
        VALUES ($1,$2,$3,91001,$4,$5,$6,$7,$8,'2026-10-20T13:00:00Z')`,
      [id, task.id, deliveryId, action, revision, action === 'correcciones' ? marker : '',
        action === 'correcciones' ? randomUUID() : null, action === 'correcciones' ? 'b'.repeat(64) : null]);
      last = { id, revision, action, deliveryId };
    }
    const row = { id: task.id, revision: task.revision, title: title || `QA genuine inventory ${serial}`, state, client,
      visible, awaiting, corrections: correction, delivery: artifacts.at(-1) || null, decision: last };
    modeled.set(row.id, row); return row;
  };
  for (let i = 0; i < 105; i += 1) await seed({ client: i % 7 === 0 ? clientB : clientA });
  for (const state of ['pendiente', 'en_progreso', 'aprobada', 'finalizada', 'publicada'])
    await seed({ state, decisions: ['correcciones', 'aprobada', 'correcciones'], awaiting: false });
  const approvedHistory = await seed({ state: 'finalizada', decisions: ['correcciones', 'aprobada'], awaiting: false });
  await seed({ state: 'aprobada', decisions: ['aprobada'], awaiting: false });
  await seed({ client: null });
  const orphanApproval = await seed({ metadata: { revision_aprobada: true } });
  const olderApproval = await seed({ approvalBinding: 'first' });
  const effectiveApproval = await seed({ awaiting: false, approvalBinding: 'latest' });
  const equalRevision = await seed({ deliveries: [10], approvalBinding: 'latest', awaiting: true });
  await seed({ deliveries: [11], awaiting: false }); // Future artifact revision is not eligible.
  await seed({ deliveries: [], awaiting: false, title: 'feedback only in title, raw material and comment', metadata: { feedback: marker } });
  await fixture.query('INSERT INTO tarea_comentarios(tarea_id,autor,contenido) VALUES ($1,$2,$3)', [
    [...modeled.keys()].at(-1), 'QA fixture', `feedback ${marker}`]);
  await seed({ deliveries: [], awaiting: false, state: 'aprobada', metadata: { revision_aprobada: true } });
  for (const options of [{ metadata: { archivada_render_os: true } }, { metadata: { papelera_render_os: true } },
    { metadata: { workspace: 'historical' } }, { sector: 'diseno' }, { client: inactive }])
    await seed({ ...options, visible: false, decisions: ['correcciones'] });

  await t.test('more than 100 qualifying tasks page exactly once, latest summaries do not multiply decisions, default and beyond-end counts are exact', async () => {
    const before = await snapshot(), rows = expected(); assert.ok(rows.length > 100);
    assertPage(checked(await inventory()), rows);
    const visited = [];
    for (let offset = 0; offset < rows.length; offset += 20) {
      const body = checked(await inventory(`limit=20&offset=${offset}`)); assertPage(body, rows, { offset });
      visited.push(...body.items.map(item => item.task_id));
    }
    assert.deepEqual(visited, rows.map(row => row.id)); assert.equal(new Set(visited).size, rows.length);
    assertPage(checked(await inventory('offset=1000000&limit=50')), rows, { offset: 1000000, limit: 50 });
    assertPage(checked(await inventory('limit=1')), rows, { limit: 1 });
    assertPage(checked(await inventory('limit=50')), rows, { limit: 50 });
    await unchanged(before);
  });
  async function unchanged(before) { assert.deepEqual(await snapshot(), before, 'Inventory reads cannot mutate operational/history tables'); }

  await t.test('views use real artifacts/effective approval, retain historical corrections and exclude text-only impostors', async () => {
    const review = checked(await inventory('view=awaiting_review&limit=50'));
    assertPage(review, expected({ view: 'awaiting_review' }), { limit: 50 });
    const corrections = checked(await inventory('view=with_corrections&limit=50'));
    assertPage(corrections, expected({ view: 'with_corrections' }), { limit: 50 });
    const historical = corrections.items.find(row => row.task_id === approvedHistory.id);
    assert.ok(historical); assert.equal(historical.estado, 'finalizada'); assert.equal(historical.latest_decision.action, 'aprobada');
    assert.equal(historical.has_corrections, true); assert.equal(Object.hasOwn(historical, 'resolved'), false);
    const allReviewIds = expected({ view: 'awaiting_review' }).map(row => row.id);
    for (const id of [orphanApproval.id, olderApproval.id, equalRevision.id]) assert.ok(allReviewIds.includes(id));
    assert.equal(allReviewIds.includes(effectiveApproval.id), false);
    // Fetch each proof edge through the real reader, not merely the fixture model.
    for (const row of [orphanApproval, olderApproval, equalRevision, effectiveApproval]) {
      const q = encodeURIComponent(row.title), body = checked(await inventory(`view=awaiting_review&q=${q}&limit=50`));
      assertPage(body, expected({ view: 'awaiting_review', q: row.title }), { limit: 50 });
    }
    assertPage(checked(await inventory('q=feedback')), expected({ q: 'feedback' }));
  });

  await t.test('client, text and view filters apply before pagination; missing filters return honest zero and beyond-end totals', async () => {
    for (const view of ['all', 'awaiting_review', 'with_corrections']) {
      const rows = expected({ view, client: clientB.id });
      assertPage(checked(await inventory(`view=${view}&cliente_id=${clientB.id}&limit=3&offset=2`)), rows, { limit: 3, offset: 2 });
    }
    const rows = expected({ q: 'needle client B' });
    assertPage(checked(await inventory('q=needle%20client%20B&limit=4&offset=1')), rows, { limit: 4, offset: 1 });
    assertPage(checked(await inventory(`cliente_id=${clientB.id}&offset=999999`)), expected({ client: clientB.id }), { offset: 999999 });
    assertPage(checked(await inventory('cliente_id=2147483647')), []);
    assertPage(checked(await inventory(`q=${encodeURIComponent("' OR 1=1 --")}`)), []);
  });

  await t.test('real delivery→correction→new delivery→approval→finalization remains history, never inferred resolved or published', async () => {
    const created = checked(await api('/tareas', admin, 'POST', { titulo: 'QA real inventory lifecycle unique', workspace: 'render_os',
      tipo_tarea: 'edicion', cliente_id: clientB.id, asignado_a_id: 91003, fecha_vencimiento: '2026-10-25' }), 201);
    const state = async () => (await fixture.query('SELECT revision,estado FROM tareas WHERE id=$1', [created.id]))[0];
    const query = 'q=QA%20real%20inventory%20lifecycle%20unique';
    assertPage(checked(await inventory(query)), []);
    const deliver = async () => checked(await api(`/tareas-edicion/${created.id}/entregas`, editor, 'POST', {
      request_id: randomUUID(), expected_revision: (await state()).revision, url: `https://example.invalid/${marker}`, notes: marker,
    }), 201).delivery_id;
    const first = await deliver();
    let row = (await inventory(query)).body.items[0]; assert.equal(row.task_id, created.id); assert.equal(row.latest_delivery.id, first);
    assert.equal(row.latest_decision, null); assert.equal(row.has_corrections, false);
    const correction = checked(await api(`/tareas-edicion/${created.id}/correcciones`, admin, 'POST', { request_id: randomUUID(),
      expected_revision: (await state()).revision, expected_entrega_id: first, notes: marker }), 201);
    row = checked(await inventory(query)).items[0]; assert.equal(row.latest_decision.id, correction.decision_id);
    assert.equal(row.estado, 'en_progreso'); assert.equal(row.has_corrections, true);
    assert.equal(checked(await inventory(`${query}&view=awaiting_review`)).total, 0);
    const second = await deliver();
    assert.equal(checked(await inventory(`${query}&view=awaiting_review`)).items[0].latest_delivery.id, second);
    checked(await api(`/tareas/${created.id}?workspace=render_os`, admin, 'PATCH', { expected_revision: (await state()).revision,
      estado: 'aprobada', expected_entrega_id: second }));
    checked(await api(`/tareas/${created.id}?workspace=render_os`, admin, 'PATCH', { expected_revision: (await state()).revision, estado: 'finalizada' }));
    const current = await state(), history = checked(await api(`/tareas-edicion/${created.id}/revisiones`, admin));
    modeled.set(created.id, { id: created.id, title: 'QA real inventory lifecycle unique', revision: current.revision, state: 'finalizada',
      client: clientB, visible: true, awaiting: false, corrections: true, delivery: { id: second, revision: history.latest_delivery.task_revision },
      decision: { id: history.decisions.at(-1).id, revision: history.decisions.at(-1).task_revision, action: 'aprobada', deliveryId: second } });
    assertPage(checked(await inventory(`${query}&view=with_corrections`)), expected({ q: 'QA real inventory lifecycle unique', view: 'with_corrections' }));
    assertPage(checked(await inventory(`${query}&view=awaiting_review`)), []);
    assert.equal(JSON.stringify(checked(await inventory(query))).includes(marker), false);
    assert.equal((await fixture.query('SELECT count(*)::int AS n FROM editorial_publicacion_eventos'))[0].n, 0);
  });

  await t.test('closed query rejects malformed/duplicate/identity filters without writes', async () => {
    const before = await snapshot();
    for (const query of ['limit=0', 'limit=51', 'limit=01', 'limit=-1', 'limit=1.5', 'limit=1&limit=2', 'offset=-1', 'offset=01',
      'offset=1000001', 'offset=9999999999999999999999', 'offset=0&offset=0', 'view=other', 'view=all&view=all',
      'cliente_id=0', 'cliente_id=01', 'cliente_id=2147483648', 'cliente_id=1&cliente_id=2', 'q=a&q=b',
      `q=${'x'.repeat(201)}`, 'q=%00', 'usuario_id=91003', 'asignado_a_id=91003', 'rol=admin', 'workspace=render_os', 'unknown=1'])
      checked(await inventory(query), 400);
    await unchanged(before);
  });

  await t.test('all current system roles share identical closed reads; anonymous, unknown, revoked and inactive fail closed', async () => {
    const before = await snapshot();
    for (const [, token] of accounts) assertPage(checked(await inventory('limit=50', token)), expected(), { limit: 50 });
    const http = await fetch(new URL('/api/tareas-edicion/inventario-feedback', fixture.base), {
      headers: { authorization: `Bearer ${editor}` }, signal: AbortSignal.timeout(5000),
    });
    assert.equal(http.status, 200); assert.equal(http.headers.get('cache-control'), 'no-store');
    assertPage(await http.json(), expected());
    checked(await api('/tareas-edicion/inventario-feedback', undefined), 401);
    await unchanged(before);
    const userId = 918754, usuario = 'qa_feedback_inventory_3', token = accounts.at(-1)[1];
    await fixture.query("UPDATE usuarios SET rol='qa_unknown' WHERE id=$1", [userId]);
    try { const clean = await snapshot(); checked(await inventory('', token), 403); await unchanged(clean); }
    finally { await fixture.query("UPDATE usuarios SET rol='edicion' WHERE id=$1", [userId]); }
    const revoked = await login(usuario); await fixture.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=$1', [userId]);
    let clean = await snapshot(); checked(await inventory('', revoked), 401); await unchanged(clean);
    const inactiveToken = await login(usuario); await fixture.query('UPDATE usuarios SET activo=false WHERE id=$1', [userId]);
    try { clean = await snapshot(); checked(await inventory('', inactiveToken), 401); await unchanged(clean); }
    finally { await fixture.query('UPDATE usuarios SET activo=true WHERE id=$1', [userId]); }
  });
});
