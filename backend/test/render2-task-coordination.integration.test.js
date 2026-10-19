import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

// Discovery is inert. Only explicit opt-in starts this test's own physical PG
// cluster; never import db.js or consume a configured connection string here.
test('task coordination HTTP permissions, validation and revision CAS', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55632 });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own coordination fixture stopped and removed: ${fixture.root}`);
  });
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port: 55632,
    url: 'postgresql://render2_fixture@127.0.0.1:55632/render2_local_test', identity });

  const ids = { owner: 98301, outsider: 98302, community: 98303 };
  for (const [name, id] of Object.entries(ids)) {
    const inserted = await fixture.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,$3,$4,password_hash,true,1 FROM usuarios WHERE id=91004 RETURNING id`,
    [id, `qa_coordination_${name}`, `QA Coordination ${name}`, name === 'community' ? 'community' : 'produccion']);
    assert.deepEqual(inserted, [{ id }], 'Copy only the synthetic fixture password hash');
  }
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
  const owner = await login('qa_coordination_owner');
  const outsider = await login('qa_coordination_outsider');
  const otherRoles = [await login('qa_designer'), await login('qa_luciano'), await login('qa_coordination_community')];

  // Full persisted snapshots prove rejected requests do not mutate task JSON,
  // timestamps, revision or ID-based assignment bindings.
  const snapshot = async id => ({
    task: await fixture.query('SELECT * FROM tareas WHERE id=$1', [id]),
    assignments: await fixture.query('SELECT * FROM tarea_asignaciones WHERE tarea_id=$1 ORDER BY usuario_id,tipo', [id]),
  });
  const scopes = [
    { name: 'historical without scope query', render: false, suffix: '' },
    { name: 'render_os with scope query', render: true, suffix: '?workspace=render_os' },
    { name: 'stored render_os without scope query', render: true, suffix: '' },
  ];
  for (const scope of scopes) {
    const patch = (id, token, metadata, revision, suffix = scope.suffix) => api(`/tareas/${id}${suffix}`, {
      token, method: 'PATCH', body: { propiedades_extra: metadata,
        ...(revision === undefined ? {} : { expected_revision: revision }) },
    });
    const detail = async id => {
      // The single-task GET requires render_os; historical rows use the real
      // historical list endpoint, while PATCH scope is varied independently.
      if (scope.render) return expect(await api(`/tareas/${id}?workspace=render_os`, { token: admin }), 200);
      const rows = expect(await api('/tareas?limit=500', { token: admin }), 200);
      assert.ok(Array.isArray(rows));
      const row = rows.find(task => task.id === id);
      assert.ok(row, 'Historical API list contains the created task');
      return row;
    };
    const create = async () => {
      const task = expect(await api('/tareas', { token: admin, method: 'POST', body: {
        titulo: `QA coordination ${scope.name}`, asignado_a_id: ids.owner,
        colaborador_ids: [91004, 91003, ids.community], tipo_tarea: 'produccion', subtipo: 'visita',
        resumen: 'Preserve the original brief', etiquetas: ['coordination-fixture'],
        material_referencia: 'https://example.invalid/coordination-material',
        fecha_vencimiento: '2026-10-25', produccion_videos_previstos: 3,
        ...(scope.render ? { workspace: 'render_os' } : {}),
      } }), 201);
      assert.equal(task.asignado_a_id, ids.owner);
      assert.deepEqual([...task.colaborador_ids].sort((a, b) => a - b), [91003, 91004, ids.community]);
      const seeded = expect(await patch(task.id, admin, {
        qa_coordination_sentinel: { nested: ['retain', 7], enabled: true },
        horario: 'Original free-text schedule', coordinada: false,
      }, task.revision), 200);
      assert.ok(Number.isSafeInteger(seeded.revision) && seeded.revision > task.revision);
      return task.id;
    };
    const preserved = (before, after, metadata) => {
      assert.equal(after.revision, before.revision + 1);
      assert.deepEqual(after.propiedades_extra, { ...before.propiedades_extra, ...metadata });
      // Coordination must not imply visit completion, publication or scheduling.
      for (const field of ['id', 'titulo', 'asignado_a', 'asignado_a_id', 'colaborador_ids', 'cliente_id',
        'estado', 'fecha_vencimiento', 'tipo_tarea', 'subtipo', 'material_referencia', 'publicacion_id', 'historia_id']) {
        assert.deepEqual(after[field], before[field], `Coordination must preserve ${field}`);
      }
    };

    await t.test(`${scope.name}: admin and assigned production can edit; other roles and outsiders cannot`, async () => {
      const id = await create();
      let before = await detail(id);
      for (const token of [admin, owner]) {
        const metadata = { horario: token === admin ? 'Admin schedule' : 'Production schedule', coordinada: true };
        const result = expect(await patch(id, token, metadata, before.revision), 200);
        const persisted = await detail(id);
        preserved(before, persisted, metadata);
        assert.equal(result.revision, persisted.revision);
        assert.equal(result.propiedades_extra.horario, metadata.horario);
        assert.equal(result.propiedades_extra.coordinada, metadata.coordinada);
        before = persisted;
      }
      const stored = await snapshot(id);
      for (const token of otherRoles) {
        expect(await patch(id, token, { horario: 'Denied assigned role', coordinada: false }, before.revision), 403);
        assert.deepEqual(await snapshot(id), stored);
      }
      const denied = await patch(id, outsider, { coordinada: false }, before.revision);
      assert.ok([403, 404].includes(denied.status), JSON.stringify(denied.body));
      assert.deepEqual(await snapshot(id), stored);
      expect(await patch(id, undefined, { horario: 'Anonymous write' }, before.revision), 401);
      assert.deepEqual(await snapshot(id), stored);
    });

    await t.test(`${scope.name}: strict metadata types and required revision even for admin`, async () => {
      const id = await create();
      const current = await detail(id), stored = await snapshot(id);
      const invalidMetadata = [
        ...[null, 42, false, {}, [], 'x'.repeat(2001)].map(horario => ({ horario })),
        ...[null, 'true', 'false', 1, 0, {}, []].map(coordinada => ({ coordinada })),
      ];
      for (const token of [admin, owner]) {
        for (const metadata of invalidMetadata) {
          expect(await patch(id, token, metadata, current.revision), 400);
          assert.deepEqual(await snapshot(id), stored);
        }
        for (const revision of [undefined, null, 0, -1, 1.5, '1', {}, Number.MAX_SAFE_INTEGER + 1]) {
          for (const metadata of [{ horario: 'Needs revision' }, { coordinada: true }]) {
            expect(await patch(id, token, metadata, revision), 400);
            assert.deepEqual(await snapshot(id), stored);
          }
        }
      }
      // The exact length boundary, empty free text, and boolean false are valid.
      let before = current;
      for (const metadata of [{ horario: 'x'.repeat(2000), coordinada: true }, { horario: '', coordinada: false }]) {
        const result = expect(await patch(id, owner, metadata, before.revision), 200);
        const persisted = await detail(id);
        preserved(before, persisted, metadata);
        assert.equal(result.revision, persisted.revision);
        before = persisted;
      }
    });

    await t.test(`${scope.name}: stale and concurrent revisions preserve unrelated metadata and bindings`, async () => {
      const id = await create();
      const original = await detail(id);
      const updated = expect(await patch(id, owner, { horario: 'First committed schedule' }, original.revision), 200);
      const current = await detail(id);
      preserved(original, current, { horario: 'First committed schedule' });
      assert.equal(updated.revision, current.revision);
      const stored = await snapshot(id);
      expect(await patch(id, admin, { horario: 'Stale admin', coordinada: true }, original.revision), 409);
      expect(await patch(id, owner, { coordinada: true }, original.revision), 409);
      assert.deepEqual(await snapshot(id), stored);
      const changes = [
        { horario: 'Concurrent admin winner candidate', coordinada: true },
        { horario: 'Concurrent production winner candidate', coordinada: false },
      ];
      const results = await Promise.all([
        patch(id, admin, changes[0], updated.revision),
        patch(id, owner, changes[1], updated.revision),
      ]);
      assert.deepEqual(results.map(result => result.status).sort((a, b) => a - b), [200, 409]);
      const winnerIndex = results.findIndex(result => result.status === 200);
      const winner = results[winnerIndex].body;
      const persisted = await detail(id);
      preserved(current, persisted, changes[winnerIndex]);
      assert.equal(winner.revision, persisted.revision);
      assert.equal(winner.propiedades_extra.horario, changes[winnerIndex].horario);
      assert.equal(winner.propiedades_extra.coordinada, changes[winnerIndex].coordinada);
      assert.deepEqual((await snapshot(id)).assignments, stored.assignments);
      // Promise.all exercises actual HTTP/SQL contention; no fake CAS helper or
      // timing-based assertion claims the requests rendezvoused at a row lock.
    });
  }
});
