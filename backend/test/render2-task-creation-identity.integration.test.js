import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, assertFixtureIdentity, request, fixturePassword } from '../scripts/render2-local-test.js';

test('HTTP task creation queues canonical recipient IDs independently of homonyms and leader aliases', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const port = 55874;
  const f = await startLocalHarness({ port });
  t.after(async () => {
    await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own creation identity fixture cleanup ENOENT: ${f.root}; port${port}`);
  });
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port,
    url: `postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`, identity });
  const checked = (response, status = 200) => {
    assert.equal(response.status, status, 'Expected fixture HTTP status; never print credentials');
    return response.body;
  };
  const login = checked(await request(f.base, '/api/login', {
    method: 'POST', body: { usuario: 'qa_franco', password: fixturePassword },
  }));
  const api = (route, method = 'GET', body) => request(f.base, `/api${route}`, { token: login.token, method, body });
  // Generated fixture only. Keep stable IDs; the active leader-login witness
  // must never receive an event merely because another user's label is Agustín.
  await f.query("UPDATE usuarios SET nombre='QA228 shared label' WHERE id=ANY($1::int[])", [[91001, 91002, 91003]]);
  await f.query("UPDATE usuarios SET usuario='lider',nombre='QA228 leader witness' WHERE id=91004");
  const allRows = table => f.query(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`);
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"))
    .map(row => row.tablename).filter(name => !/^auth_|^browser_session/.test(name));
  assert.ok(tables.length > 30);
  assert.ok(tables.every(name => /^[a-z_][a-z0-9_]*$/.test(name)));
  const mutable = new Set(['usuarios', 'tareas', 'tarea_asignaciones', 'mia_private_task_notifications']);
  async function stableHashes() {
    const result = {};
    for (const name of tables.filter(name => !mutable.has(name))) {
      const [row] = await f.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS hash FROM "${name}" t`);
      result[name] = row.hash;
    }
    return result;
  }
  const baseline = await stableHashes();
  const oldTasks = await allRows('tareas'), oldMembers = await allRows('tarea_asignaciones');
  const notices = () => allRows('mia_private_task_notifications');
  let expectedNotices = await notices();
  const createdIds = [];
  let serial = 0;
  const body = (owner, collaborators = []) => ({ titulo: `QA228 creation ${++serial}`,
    workspace: 'render_os', tipo_tarea: 'edicion', estado: 'pendiente',
    asignado_a_id: owner, colaborador_ids: collaborators, fecha_vencimiento: '2026-10-29' });
  function closedDto(value) {
    assert.ok(value && Number.isSafeInteger(value.id) && value.id > 0);
    const visit = object => {
      if (!object || typeof object !== 'object') return;
      for (const [key, child] of Object.entries(object)) {
        assert.ok(!['assignmentNotification', 'notification', 'destinatarioIds', 'actorId',
          'actor_usuario_id', 'destinatario_usuario_id', 'assignmentNotificationActor', 'session_version'].includes(key),
        'Internal notification/authority context must not enter the task DTO');
        visit(child);
      }
    };
    visit(value);
  }
  async function unchangedNotices(expected) {
    const until = Date.now() + 300;
    do {
      assert.deepEqual(await notices(), expected, 'No unintended queue rows or mutations');
      await new Promise(resolve => setTimeout(resolve, 25));
    } while (Date.now() < until);
    assert.deepEqual(await notices(), expected);
  }
  async function created(owner, collaborators, recipientIds, actorLabel) {
    const saved = checked(await api('/tareas', 'POST', body(owner, collaborators)), 201);
    closedDto(saved);
    createdIds.push(saved.id);
    assert.equal(saved.asignado_a_id, owner);
    assert.deepEqual([...saved.colaborador_ids].sort((a, b) => a - b), [...collaborators].filter(id => id !== owner).sort((a, b) => a - b));
    const memberships = await f.query('SELECT usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1 ORDER BY usuario_id', [saved.id]);
    assert.deepEqual(memberships, [owner, ...collaborators.filter(id => id !== owner)].sort((a, b) => a - b)
      .map(id => ({ usuario_id: id, tipo: id === owner ? 'responsable' : 'colaborador' })));
    const target = expectedNotices.length + recipientIds.length;
    let rows;
    const deadline = Date.now() + 5000;
    do {
      rows = await notices();
      assert.ok(rows.length <= target, 'Unexpected additional queue recipient');
      if (rows.length === target) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    assert.equal(rows.length, target, 'Expected real enqueue within bounded wait');
    const added = rows.filter(({ row }) => Number(row.tarea_id) === saved.id).map(({ row }) => row);
    assert.equal(added.length, recipientIds.length);
    assert.deepEqual(added.map(row => row.detalles.destinatario_usuario_id).sort((a, b) => a - b), recipientIds);
    for (const notice of added) {
      assert.equal(notice.motivo, 'creada');
      assert.equal(notice.estado, 'pending');
      assert.equal(notice.detalles.actor_usuario_id, 91001);
      assert.equal(notice.detalles.actor, actorLabel);
      assert.equal(notice.destinatario_clave, notice.detalles.destinatario_usuario_id === 91002 ? 'qa_agustin' : 'qa_luciano');
    }
    assert.deepEqual(rows.filter(({ row }) => Number(row.tarea_id) !== saved.id), expectedNotices);
    expectedNotices = rows;
    await unchangedNotices(expectedNotices);
    closedDto(checked(await api(`/tareas/${saved.id}?workspace=render_os`)));
    return saved;
  }
  await t.test('homonymous owner and collaborator receive distinct ID-bound notices; homonymous actor is excluded', async () => {
    await created(91003, [91001, 91002], [91002, 91003], 'QA228 shared label');
  });
  await t.test('self-owned task still notifies the different-ID homonymous collaborator only', async () => {
    await created(91001, [91003], [91003], 'QA228 shared label');
  });
  await t.test('Agustín label does not route to the active lider-login witness', async () => {
    await f.query("UPDATE usuarios SET nombre='Agustín' WHERE id=91003");
    await created(91003, [], [91003], 'QA228 shared label');
  });
  await t.test('inactive owner and collaborator fail without creating tasks, memberships or notices', async () => {
    await f.query('UPDATE usuarios SET activo=false WHERE id=91003');
    const tasksBefore = await allRows('tareas'), membersBefore = await allRows('tarea_asignaciones');
    for (const input of [body(91003), body(91002, [91003])]) {
      checked(await api('/tareas', 'POST', input), 400);
      assert.deepEqual(await allRows('tareas'), tasksBefore);
      assert.deepEqual(await allRows('tarea_asignaciones'), membersBefore);
      await unchangedNotices(expectedNotices);
    }
  });
  assert.deepEqual(await stableHashes(), baseline, 'Unrelated business tables unchanged');
  assert.deepEqual(await f.query('SELECT to_jsonb(t) AS row FROM tareas t WHERE NOT(id=ANY($1::int[])) ORDER BY to_jsonb(t)::text', [createdIds]), oldTasks);
  assert.deepEqual(await f.query('SELECT to_jsonb(t) AS row FROM tarea_asignaciones t WHERE NOT(tarea_id=ANY($1::int[])) ORDER BY to_jsonb(t)::text', [createdIds]), oldMembers);
  await unchangedNotices(expectedNotices);
  t.diagnostic(`Own fixture ${f.root}; unrelated tables=${tables.filter(name => !mutable.has(name)).length}; real HTTP enqueue only, no provider or concurrent actor-revocation claim`);
});
