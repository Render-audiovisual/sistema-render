import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';
import { groupTasksByResponsible, groupTasksByClient } from '../../frontend/src/features/render-os/utils/task-groups.js';

test('principal task pages group actual ID assignments and clients without merging homonyms', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 150000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55711 });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), { code: 'ENOENT' });
  });
  const ok = (result, status = 200) => {
    assert.equal(result.status, status, 'Expected fixture HTTP status'); return result.body;
  };
  // Seed before login: labels are deliberately indistinguishable, IDs are not.
  await fixture.query("UPDATE usuarios SET nombre='QA Group Same Person' WHERE id IN (91003,91004)");
  // The real clientes.nombre UNIQUE constraint forbids byte-identical names.
  // NFC/NFD are visually identical and exercise the helper's normalized collision
  // handling without dropping constraints or fabricating API DTOs.
  const clients = [];
  for (const name of ['QA Group Café', 'QA Group Cafe\u0301'])
    clients.push((await fixture.query('INSERT INTO clientes(nombre) VALUES ($1) RETURNING id,nombre', [name]))[0]);
  assert.notEqual(clients[0].id, clients[1].id);
  assert.equal(clients[0].nombre.normalize('NFC'), clients[1].nombre.normalize('NFC'));
  const admin = ok(await request(fixture.base, '/api/login', {
    method: 'POST', body: { usuario: 'qa_franco', password: fixturePassword },
  })).token;
  const api = (route, options = {}) => request(fixture.base, `/api${route}`, { token: admin, ...options });
  const users = ok(await api('/usuarios'));
  const [sentinel] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,estado,propiedades_extra)
    VALUES ('QA unrelated group sentinel','Historical unlinked owner','pendiente','{"workspace":"private"}') RETURNING id`);
  const unrelated = async () => {
    const result = {};
    for (const table of ['usuarios', 'clientes', 'publicaciones', 'historias', 'cliente_objetivos_mensuales', 'cliente_objetivo_piezas', 'cliente_objetivo_eventos'])
      result[table] = await fixture.query(`SELECT * FROM ${table} ORDER BY id`);
    result.task = await fixture.query('SELECT * FROM tareas WHERE id=$1', [sentinel.id]);
    result.assignments = await fixture.query('SELECT * FROM tarea_asignaciones WHERE tarea_id=$1 ORDER BY usuario_id', [sentinel.id]);
    return result;
  };
  const before = await unrelated();
  const create = async (title, client, owner, collaborators = []) => ok(await api('/tareas', {
    method: 'POST', body: { titulo: title, workspace: 'render_os', cliente_id: client.id,
      asignado_a_id: owner, colaborador_ids: collaborators },
  }), 201);
  const shared = await create('QA group shared', clients[0], 91003, [91004]);
  const editorOnly = await create('QA group editor', clients[0], 91003);
  const designerOnly = await create('QA group designer', clients[1], 91004);
  const createdIds = [shared.id, editorOnly.id, designerOnly.id];
  const readPages = async () => {
    const result = [];
    for (let offset = 0; ; offset += 2) {
      const response = await fetch(new URL(`/api/tareas?workspace=render_os&limit=2&offset=${offset}`, fixture.base), {
        headers: { authorization: `Bearer ${admin}` }, signal: AbortSignal.timeout(5000),
      });
      assert.equal(response.status, 200);
      const rows = await response.json(), total = Number(response.headers.get('X-Total-Count'));
      assert.ok(Array.isArray(rows)); assert.ok(rows.length <= 2);
      assert.equal(total, 3, 'private sentinel must not enter the actual workspace page');
      result.push(...rows);
      if (result.length >= total) break;
      assert.ok(rows.length, 'pagination must make progress');
    }
    assert.deepEqual(result.map(row => row.id).sort((a, b) => a - b), [...createdIds].sort((a, b) => a - b));
    return result;
  };
  const taskIds = group => group.tasks.map(row => row.id).sort((a, b) => a - b);
  const sorted = ids => [...ids].sort((a, b) => a - b);
  const initial = await readPages();
  const people = groupTasksByResponsible(initial, users);
  assert.equal(people.length, 2);
  assert.deepEqual(taskIds(people.find(group => group.userId === 91003)), sorted([shared.id, editorOnly.id]));
  assert.deepEqual(taskIds(people.find(group => group.userId === 91004)), sorted([shared.id, designerOnly.id]));
  assert.notEqual(people[0].label, people[1].label);
  for (const group of people) {
    assert.ok(group.label.endsWith(` · #${group.userId}`));
    assert.equal(group.tasks.filter(row => row.id === shared.id).length, 1);
  }
  const byClient = groupTasksByClient(initial);
  assert.equal(byClient.length, 2);
  assert.deepEqual(taskIds(byClient.find(group => group.clientId === clients[0].id)), sorted([shared.id, editorOnly.id]));
  assert.deepEqual(taskIds(byClient.find(group => group.clientId === clients[1].id)), [designerOnly.id]);
  for (const group of byClient) assert.ok(group.label.endsWith(` · #${group.clientId}`));
  const sharedBefore = ok(await api(`/tareas/${shared.id}?workspace=render_os`));
  const untouchedTasks = await fixture.query('SELECT * FROM tareas WHERE id=ANY($1::int[]) ORDER BY id', [[editorOnly.id, designerOnly.id]]);
  const untouchedAssignments = await fixture.query('SELECT * FROM tarea_asignaciones WHERE tarea_id=ANY($1::int[]) ORDER BY tarea_id,usuario_id', [[editorOnly.id, designerOnly.id]]);
  ok(await api(`/tareas/${shared.id}?workspace=render_os`, { method: 'PATCH', body: {
    expected_revision: sharedBefore.revision, expected_updated_at: sharedBefore.updated_at,
    asignado_a_id: 91004, colaborador_ids: [],
  } }));
  const refreshed = await readPages();
  const changed = refreshed.find(row => row.id === shared.id);
  assert.equal(changed.asignado_a_id, 91004); assert.deepEqual(changed.colaborador_ids, []);
  assert.ok(changed.revision > sharedBefore.revision);
  const regrouped = groupTasksByResponsible(refreshed, users);
  assert.deepEqual(taskIds(regrouped.find(group => group.userId === 91003)), [editorOnly.id]);
  assert.deepEqual(taskIds(regrouped.find(group => group.userId === 91004)), sorted([shared.id, designerOnly.id]));
  assert.deepEqual(groupTasksByClient(refreshed).map(group => [group.clientId, taskIds(group)]),
    byClient.map(group => [group.clientId, taskIds(group)]));
  assert.deepEqual(await fixture.query('SELECT * FROM tareas WHERE id=ANY($1::int[]) ORDER BY id', [[editorOnly.id, designerOnly.id]]), untouchedTasks);
  assert.deepEqual(await fixture.query('SELECT * FROM tarea_asignaciones WHERE tarea_id=ANY($1::int[]) ORDER BY tarea_id,usuario_id', [[editorOnly.id, designerOnly.id]]), untouchedAssignments);
  assert.deepEqual(await unrelated(), before, 'task grouping/assignment must preserve unrelated rows and editorial/goal history');
});
