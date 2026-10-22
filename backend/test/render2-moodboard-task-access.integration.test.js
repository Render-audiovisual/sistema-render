import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

const referenceKeys=['id','board_id','category_id','titulo','nota','etiquetas','estado','tipo_fuente','enlace_externo','archivo_nombre','autor_id','autor_nombre','created_at','updated_at','categoria','tareas','revision'];
function assertReference(row){
  assert.deepEqual(Object.keys(row).sort(),[...referenceKeys].sort(),'reference reads expose only the shared closed DTO');
  assert.equal(row.revision,0,'read/link operations do not mutate the initial reference revision');
  for(const key of ['created_at','updated_at']){assert.equal(typeof row[key],'string');assert.ok(Number.isFinite(Date.parse(row[key])));assert.match(row[key],/^\d{4}-\d{2}-\d{2}T.*Z$/);}
  assert.ok(row.titulo===null||typeof row.titulo==='string','historical nullable titles remain preserved');
  assert.equal(typeof row.nota,'string');
  assert.ok(Array.isArray(row.etiquetas));assert.ok(Array.isArray(row.tareas));
}

test('moodboard task projections and links respect current ID scope and board client', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const f = await startLocalHarness({ port: 55722 });
  t.after(async () => {
    await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
  });
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55722,
    url: 'postgresql://render2_fixture@127.0.0.1:55722/render2_local_test', identity });
  const api = (path, options) => request(f.base, `/api${path}`, options);
  const expect = (response, status = 200) => {
    assert.equal(response.status, status, 'Unexpected principal HTTP status');
    return response.body;
  };
  const login = async usuario => {
    const dto = expect(await api('/login', { method: 'POST', body: { usuario, password: fixturePassword } }));
    assert.equal(typeof dto.token, 'string');
    return dto.token;
  };
  const admin = await login('qa_franco');
  let editor = await login('qa_luciano'), designer = await login('qa_designer');
  const [client] = await f.query("INSERT INTO clientes(nombre,activo) VALUES ('QA97 board client',true) RETURNING id");
  const [otherClient] = await f.query("INSERT INTO clientes(nombre,activo) VALUES ('QA97 other client',true) RETURNING id");
  const [board] = await f.query("INSERT INTO moodboard_boards(nombre) VALUES ('QA97 scoped board') RETURNING id");
  await f.query('INSERT INTO moodboard_board_clients(board_id,cliente_id) VALUES ($1,$2)', [board.id, client.id]);
  const [reference] = await f.query(`INSERT INTO moodboard_references(board_id,titulo,nota,tipo_fuente,enlace_externo,autor_id,autor_nombre)
    VALUES ($1,'QA97 reference','Fixture only','enlace','https://example.invalid/qa97',91001,'QA admin') RETURNING id`, [board.id]);
  const seedTask = async (title, clientId, properties = {}, members = []) => {
    const [task] = await f.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,estado,tipo_tarea,propiedades_extra)
      VALUES ($1,'Shared historical display name',$2,'pendiente','edicion',$3::jsonb) RETURNING id`,
    [title, clientId, JSON.stringify(properties)]);
    for (const [index, userId] of members.entries()) await f.query(
      'INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,$2,$3)',
      [task.id, userId, index ? 'colaborador' : 'responsable']);
    return task;
  };
  const hidden = await seedTask('QA97_PRIVATE_HISTORICAL_SENTINEL', client.id);
  const assigned = await seedTask('QA97 assigned historical', client.id, {}, [91003]);
  const collaborator = await seedTask('QA97 collaborator historical', client.id, {}, [91001, 91004]);
  const shared = await seedTask('QA97 shared RenderOS', client.id, { workspace: 'render_os' });
  const wrongClient = await seedTask('QA97_WRONG_CLIENT_SENTINEL', otherClient.id, { workspace: 'render_os' });
  const permitted = await seedTask('QA97 permissible fresh link', client.id, {}, [91003]);
  // Deliberately preserve bad historical associations; filtering must not repair
  // or delete them, and hidden task IDs/titles must not escape through tareas.
  for (const row of [hidden, assigned, collaborator, shared, wrongClient]) await f.query(
    'INSERT INTO moodboard_reference_tasks(reference_id,tarea_id) VALUES ($1,$2)', [reference.id, row.id]);
  const relations = ['moodboard_boards', 'moodboard_board_clients', 'moodboard_categories',
    'moodboard_references', 'moodboard_reference_tasks', 'tareas', 'tarea_asignaciones'];
  const snapshot = async () => {
    const result = {};
    for (const name of relations) result[name] = await f.query(`SELECT * FROM ${name} t ORDER BY to_jsonb(t)::text`);
    return result;
  };
  const getTasks = token => api(`/moodboards/boards/${board.id}/tasks`, { token });
  const getReferences = token => api(`/moodboards/boards/${board.id}/references`, { token });
  const ids = rows => rows.map(row => row.id).sort((a, b) => a - b);
  const assertView = async (token, taskIds, linkedIds, excluded) => {
    const tasks = expect(await getTasks(token));
    const refs = expect(await getReferences(token));
    refs.forEach(assertReference);
    assert.deepEqual(ids(tasks), [...taskIds].sort((a, b) => a - b));
    const own = refs.find(row => row.id === reference.id);
    assert.ok(own);
    assert.deepEqual(ids(own.tareas), [...linkedIds].sort((a, b) => a - b));
    for (const row of [...tasks, ...own.tareas]) assert.deepEqual(Object.keys(row).sort(), ['id', 'titulo']);
    for (const row of excluded) {
      assert.equal([...tasks, ...own.tareas].some(item => item.id === row.id), false, 'Hidden ID must not be exposed');
      assert.equal(JSON.stringify({ tasks, refs }).includes(row === hidden ? 'QA97_PRIVATE_HISTORICAL_SENTINEL' : 'QA97_WRONG_CLIENT_SENTINEL'), false);
    }
  };
  // Link endpoints intentionally return204; the existing JSON helper is not
  // suitable. Use only this fixture's loopback principal URL and real fetch.
  const link = async (method, token, taskId, referenceId = reference.id) => {
    const response = await fetch(new URL(`/api/moodboards/references/${referenceId}/tasks/${taskId}`, f.base), {
      method, headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(5000),
    });
    await response.arrayBuffer();
    return response.status;
  };

  await t.test('three real identities see only client-compatible task scope in both projections; GET is read-only', async () => {
    const before = await snapshot();
    await assertView(admin, [hidden.id, assigned.id, collaborator.id, shared.id, permitted.id],
      [hidden.id, assigned.id, collaborator.id, shared.id], [wrongClient]);
    await assertView(editor, [assigned.id, shared.id, permitted.id], [assigned.id, shared.id], [hidden, wrongClient]);
    await assertView(designer, [collaborator.id, shared.id], [collaborator.id, shared.id], [hidden, wrongClient]);
    assert.deepEqual(await snapshot(), before, 'Old invalid links are preserved, not destructively cleaned');
  });

  await t.test('homonymous display names and subsequent rename never grant historical access', async () => {
    await f.query("UPDATE usuarios SET nombre='Shared historical display name' WHERE id IN (91003,91004)");
    editor = await login('qa_luciano'); designer = await login('qa_designer');
    await assertView(editor, [assigned.id, shared.id, permitted.id], [assigned.id, shared.id], [hidden, wrongClient]);
    await assertView(designer, [collaborator.id, shared.id], [collaborator.id, shared.id], [hidden, wrongClient]);
    await f.query("UPDATE usuarios SET nombre='QA97 renamed assigned person' WHERE id=91003");
    editor = await login('qa_luciano');
    const before = await snapshot();
    await assertView(editor, [assigned.id, shared.id, permitted.id], [assigned.id, shared.id], [hidden, wrongClient]);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('wrong-client, unauthorized and nonexistent links return404 without DML, including DELETE of preserved bad links', async () => {
    for (const [token, taskId, referenceId] of [
      [editor, hidden.id, reference.id], [editor, wrongClient.id, reference.id],
      [admin, wrongClient.id, reference.id], [designer, permitted.id, reference.id],
      [editor, 2147483647, reference.id], [editor, assigned.id, 2147483647],
    ]) for (const method of ['POST', 'DELETE']) {
      const before = await snapshot();
      assert.equal(await link(method, token, taskId, referenceId), 404);
      assert.deepEqual(await snapshot(), before);
    }
  });

  await t.test('permitted association survives fresh login and repeat POST; DELETE removes only that relationship', async () => {
    const before = await snapshot();
    assert.equal(await link('POST', editor, permitted.id), 204);
    const after = await snapshot();
    assert.equal(after.moodboard_reference_tasks.length, before.moodboard_reference_tasks.length + 1);
    for (const name of relations.filter(name => name !== 'moodboard_reference_tasks')) assert.deepEqual(after[name], before[name]);
    editor = await login('qa_luciano');
    await assertView(editor, [assigned.id, shared.id, permitted.id], [assigned.id, shared.id, permitted.id], [hidden, wrongClient]);
    assert.equal(await link('POST', editor, permitted.id), 204);
    assert.deepEqual(await snapshot(), after);
    assert.equal(await link('DELETE', editor, permitted.id), 204);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('explicit non-RenderOS workspace is historical: assigned IDs visible, unassigned IDs hidden', async () => {
    const [scopedClient] = await f.query("INSERT INTO clientes(nombre,activo) VALUES ('QA97 explicit workspace client',true) RETURNING id");
    const [scopedBoard] = await f.query("INSERT INTO moodboard_boards(nombre) VALUES ('QA97 explicit workspace board') RETURNING id");
    await f.query('INSERT INTO moodboard_board_clients(board_id,cliente_id) VALUES ($1,$2)', [scopedBoard.id, scopedClient.id]);
    const [scopedRef] = await f.query(`INSERT INTO moodboard_references(board_id,nota,tipo_fuente,enlace_externo,autor_nombre)
      VALUES ($1,'QA97 explicit marker','enlace','https://example.invalid/qa97-explicit','QA97') RETURNING id`, [scopedBoard.id]);
    const assignedLegacy = await seedTask('QA97 explicit legacy assigned', scopedClient.id, { workspace: 'legacy' }, [91003]);
    const unassignedLegacy = await seedTask('QA97_EXPLICIT_LEGACY_PRIVATE', scopedClient.id, { workspace: 'legacy' });
    const assignedShared = await seedTask('QA97 exact RenderOS assigned', scopedClient.id, { workspace: 'render_os' }, [91003]);
    const unassignedShared = await seedTask('QA97 exact RenderOS unassigned', scopedClient.id, { workspace: 'render_os' });
    for (const task of [assignedLegacy, unassignedLegacy, assignedShared, unassignedShared]) await f.query(
      'INSERT INTO moodboard_reference_tasks(reference_id,tarea_id) VALUES ($1,$2)', [scopedRef.id, task.id]);
    const before = await snapshot();
    for (const [token, expected] of [[editor, [assignedLegacy.id, assignedShared.id, unassignedShared.id]],
      [designer, [assignedShared.id, unassignedShared.id]],
      [admin, [assignedLegacy.id, unassignedLegacy.id, assignedShared.id, unassignedShared.id]]]) {
      const tasks = expect(await api(`/moodboards/boards/${scopedBoard.id}/tasks`, { token }));
      const refs = expect(await api(`/moodboards/boards/${scopedBoard.id}/references`, { token }));
      refs.forEach(assertReference);
      assert.deepEqual(ids(tasks), [...expected].sort((a, b) => a - b));
      assert.deepEqual(ids(refs.find(row => row.id === scopedRef.id).tareas), [...expected].sort((a, b) => a - b));
      if (token !== admin) assert.equal(JSON.stringify({ tasks, refs }).includes('QA97_EXPLICIT_LEGACY_PRIVATE'), false);
    }
    assert.equal(await link('POST', designer, assignedLegacy.id, scopedRef.id), 404);
    assert.equal(await link('DELETE', designer, unassignedLegacy.id, scopedRef.id), 404);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('anonymous and revoked sessions cannot read or mutate links', async () => {
    const before = await snapshot();
    expect(await getTasks(null), 401); expect(await getReferences(null), 401);
    assert.equal(await link('POST', null, shared.id), 401);
    await f.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91003');
    expect(await getTasks(editor), 401); expect(await getReferences(editor), 401);
    assert.equal(await link('POST', editor, permitted.id), 401);
    assert.equal(await link('DELETE', editor, assigned.id), 401);
    assert.deepEqual(await snapshot(), before);
  });
});
