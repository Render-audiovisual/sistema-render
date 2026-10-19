import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

// No server/db import or configured connection. Discovery does not start PG.
test('home escalation HTTP queue: exact historical targets, closed pages and current admin authority', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55634 });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own home escalation fixture stopped and removed: ${fixture.root}`);
  });
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port: 55634,
    url: 'postgresql://render2_fixture@127.0.0.1:55634/render2_local_test', identity });
  const api = (route, options) => request(fixture.base, `/api${route}`, options);
  const expect = (result, status) => {
    assert.equal(result.status, status, JSON.stringify(result.body));
    return result.body;
  };
  const login = async usuario => {
    const body = expect(await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } }), 200);
    assert.ok(body.token);
    return body.token;
  };
  const admin = await login('qa_franco');
  const employee = await login('qa_luciano');
  // An existing employee's display name is a label, not an administrator grant.
  await fixture.query("UPDATE usuarios SET nombre='Franco' WHERE id=91004");
  const namedFranco = await login('qa_designer');
  const [client] = await fixture.query("INSERT INTO clientes(nombre,activo) VALUES ('QA Escalations active',true) RETURNING id,nombre");
  const [inactive] = await fixture.query("INSERT INTO clientes(nombre,activo) VALUES ('QA Escalations inactive',false) RETURNING id,nombre");
  const secret = 'QA_ESCALATION_PRIVATE_55634';
  await fixture.query(`INSERT INTO cliente_abonos(cliente_id,vigente_desde,importe,creado_por)
    VALUES ($1,'2026-01-01',873429.19,'QA fixture only')`, [client.id]);
  let serial = 0;
  const expected = [], excluded = [];
  const targets = ['Líder', 'Agustín', 'Franco'];
  const seed = async ({ state = 'pendiente', priority = 'media', due = null, clientId = client.id,
    props = {}, eligible = true } = {}) => {
    const title = `QA escalation fixture ${++serial}`;
    const metadata = { workspace: 'render_os', escalada_a: 'Líder', motivo: secret,
      financial: { importe: 873429.19, private_marker: secret }, future_bag: [secret], ...props };
    const [row] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,estado,prioridad,cliente_id,
      fecha_vencimiento,tipo_tarea,subtipo,aclaraciones,propiedades_extra)
      VALUES ($1,'Franco',$2,$3,$4,$5,'edicion','video',$6,$7::jsonb)
      RETURNING id,revision`, [title, state, priority, clientId, due, secret, JSON.stringify(metadata)]);
    // Explicit fixture IDs; this queue must not be restricted to admin-owned work.
    await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,91003,'responsable')", [row.id]);
    const item = { id: row.id, titulo: title,
      estado: state === 'en_revision' && props.revision_aprobada === true ? 'aprobada' : state,
      prioridad: priority, revision: row.revision, fecha_vencimiento: due,
      cliente: clientId === null ? null : { id: clientId, nombre: clientId === client.id ? client.nombre : inactive.nombre },
      href: `/workspace/tareas?task=${row.id}` };
    (eligible ? expected : excluded).push(item);
    return item;
  };
  // More than two default pages, repeated date/priority ties, and NULL dates.
  for (let n = 0; n < 45; n++) await seed({
    state: n % 4 === 0 ? 'en_revision' : n % 4 === 1 ? 'en_progreso' : 'pendiente',
    priority: ['baja', 'alta', 'media'][n % 3],
    due: n % 7 === 0 ? null : `2026-10-${String(20 + n % 3).padStart(2, '0')}`,
    clientId: n % 8 === 0 ? null : client.id, props: { escalada_a: targets[n % 3] },
  });
  const approved = await seed({ state: 'en_revision', due: '2026-10-19',
    props: { escalada_a: 'Agustín', revision_aprobada: true } });
  const pending = await seed({ due: '2026-10-19', priority: 'alta', props: { escalada_a: 'Franco' } });
  // Real API-created task participates in the same queue as fixture history.
  const created = expect(await api('/tareas', { token: admin, method: 'POST', body: {
    titulo: 'QA escalation API-created', workspace: 'render_os', asignado_a_id: 91003,
    tipo_tarea: 'edicion', subtipo: 'video', cliente_id: client.id, prioridad: 'alta',
    fecha_vencimiento: '2026-10-18', escalada_a: 'Líder', motivo: secret,
  } }), 201);
  expected.push({ id: created.id, titulo: created.titulo, estado: created.estado, prioridad: created.prioridad,
    revision: created.revision, fecha_vencimiento: '2026-10-18', cliente: { id: client.id, nombre: client.nombre },
    href: `/workspace/tareas?task=${created.id}` });
  for (const props of [{ workspace: 'historical' }, { workspace: null },
    { archivada_render_os: true }, { archivada_render_os: 'true' },
    { papelera_render_os: true }, { papelera_render_os: 'true' }]) await seed({ props, eligible: false });
  await seed({ clientId: inactive.id, eligible: false });
  for (const state of ['finalizada', 'publicada']) await seed({ state, eligible: false });
  for (const target of ['Luciano', 'líder', 'Lider', 'Agustin', 'franco', 'Franco ', '', 91001, null,
    true, ['Franco'], { nombre: 'Franco' }]) await seed({ props: { escalada_a: target }, eligible: false });
  const reviewOnly = await seed({ state: 'en_revision', props: { escalada_a: null }, eligible: false });
  const priorityRank = value => value === 'alta' ? 0 : value === 'media' ? 1 : 2;
  expected.sort((a, b) => (a.fecha_vencimiento === null ? 1 : 0) - (b.fecha_vencimiento === null ? 1 : 0)
    || (a.fecha_vencimiento || '').localeCompare(b.fecha_vencimiento || '')
    || priorityRank(a.prioridad) - priorityRank(b.prioridad) || a.id - b.id);
  const queue = (query = '', token = admin) => api(`/inicio/escalaciones${query}`, { token });
  const keys = (value, names) => assert.deepEqual(Object.keys(value).sort(), [...names].sort());
  const checkPage = (body, offset, limit) => {
    keys(body, ['version', 'offset', 'limit', 'total', 'has_more', 'items']);
    assert.equal(body.version, 1);
    assert.equal(body.offset, offset); assert.equal(body.limit, limit);
    assert.equal(body.total, expected.length);
    assert.equal(body.has_more, offset + limit < expected.length);
    assert.deepEqual(body.items, expected.slice(offset, offset + limit), 'Exact IDs/order/projection, not just item counts');
    for (const item of body.items) {
      keys(item, ['id', 'titulo', 'estado', 'prioridad', 'revision', 'fecha_vencimiento', 'cliente', 'href']);
      assert.ok(Number.isSafeInteger(item.id) && item.id > 0);
      assert.ok(Number.isSafeInteger(item.revision) && item.revision > 0);
      if (item.cliente !== null) keys(item.cliente, ['id', 'nombre']);
    }
    const encoded = JSON.stringify(body);
    assert.ok(!encoded.includes(secret) && !encoded.includes('873429.19'));
    assert.ok(!encoded.includes('propiedades_extra') && !encoded.includes('escalada_a') && !encoded.includes('motivo'));
  };
  const snapshot = async () => {
    const result = {};
    for (const table of ['tareas', 'tarea_asignaciones', 'clientes', 'cliente_abonos', 'publicaciones', 'historias']) {
      result[table] = await fixture.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`);
    }
    return result;
  };

  await t.test('default pages expose complete exact queue independently of review and preserve history', async () => {
    const before = await snapshot();
    const collected = [];
    for (const offset of [0, 20, 40, 60]) {
      const body = expect(await queue(offset ? `?offset=${offset}` : ''), 200);
      checkPage(body, offset, 20);
      collected.push(...body.items);
    }
    assert.deepEqual(collected, expected);
    assert.equal(new Set(collected.map(item => item.id)).size, expected.length);
    assert.ok(collected.some(item => item.id === pending.id && item.estado === 'pendiente'));
    assert.ok(collected.some(item => item.estado === 'en_revision'));
    assert.equal(collected.find(item => item.id === approved.id).estado, 'aprobada');
    for (const item of excluded) assert.ok(!collected.some(row => row.id === item.id));
    assert.ok(!collected.some(item => item.id === reviewOnly.id));
    const [stored] = await fixture.query('SELECT estado,propiedades_extra FROM tareas WHERE id=$1', [approved.id]);
    assert.equal(stored.estado, 'en_revision'); assert.equal(stored.propiedades_extra.revision_aprobada, true);
    assert.deepEqual(await snapshot(), before, 'Queue GETs must not mutate task/history/finance rows');
  });
  await t.test('explicit pagination accepts canonical bounds and returns correct nonoverlapping slices', async () => {
    for (const [offset, limit] of [[0, 1], [1, 7], [8, 7], [0, 50], [47, 2], [48, 1], [1000000, 50]]) {
      checkPage(expect(await queue(`?offset=${offset}&limit=${limit}`), 200), offset, limit);
    }
    checkPage(expect(await queue('?limit=7'), 200), 0, 7);
  });
  await t.test('strict query validation rejects malformed, repeated and identity/scope parameters', async () => {
    const before = await snapshot();
    for (const query of ['offset=-1', 'offset=1000001', 'offset=01', 'offset=1.0', 'offset=1e2', 'offset=%2B1',
      'offset=', 'offset=%201', 'offset=1%20', 'offset=NaN', 'offset=9007199254740992',
      'limit=0', 'limit=51', 'limit=01', 'limit=-1', 'limit=1.5', 'limit=1e1', 'limit=', 'limit=%2B1',
      'offset=0&offset=1', 'limit=2&limit=2', 'offset[]=1', 'limit[x]=2',
      'usuario_id=91001', 'user_id=91001', 'id=91001', 'usuario=Franco', 'rol=admin',
      'asignado_a=Franco', 'workspace=render_os', 'cliente_id=1', 'estado=en_revision', 'unknown=1']) {
      expect(await queue(`?${query}`), 400);
    }
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('only current DB admin role and active session authorize; names/targets never grant access', async () => {
    expect(await api('/inicio/escalaciones'), 401);
    for (const token of [employee, namedFranco]) expect(await queue('', token), 403);
    const secondAdmin = await login('qa_agustin');
    checkPage(expect(await queue('', secondAdmin), 200), 0, 20);
    await fixture.query("UPDATE usuarios SET rol='diseno' WHERE id=91002");
    try { expect(await queue('', secondAdmin), 403); }
    finally { await fixture.query("UPDATE usuarios SET rol='admin' WHERE id=91002"); }
    const revoked = await login('qa_agustin');
    await fixture.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91002');
    expect(await queue('', revoked), 401);
    const inactiveToken = await login('qa_agustin');
    await fixture.query('UPDATE usuarios SET activo=false WHERE id=91002');
    try { expect(await queue('', inactiveToken), 401); }
    finally { await fixture.query('UPDATE usuarios SET activo=true WHERE id=91002'); }
    checkPage(expect(await queue('', await login('qa_agustin')), 200), 0, 20);
  });
});
