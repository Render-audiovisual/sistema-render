import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { startLocalHarness, assertFixtureIdentity, fixturePassword, request } from '../scripts/render2-local-test.js';

// Real principal HTTP, owned disposable PG only. Discovery does not start it.
test('HTTP task creation UUID contract recovers normal, child and visit tasks without duplicate business effects', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 300000,
}, async t => {
  const port = 55926, f = await startLocalHarness({ port });
  t.after(async () => {
    await f.cleanup();
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic('Owned HTTP task-create fixture stopped and removed.');
  });
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port,
    url: `postgresql://render2_fixture@127.0.0.1:${port}/render2_local_test`, identity });
  const tokens = new Map();
  for (const [id, usuario] of [[91001, 'qa_franco'], [91002, 'qa_agustin']]) {
    const result = await request(f.base, '/api/login', { method: 'POST', body: { usuario, password: fixturePassword } });
    assert.equal(result.status, 200, 'Synthetic login succeeds');
    assert.equal(result.body.usuario.id, id);
    assert.equal(typeof result.body.token, 'string'); tokens.set(id, result.body.token);
  }
  const [client] = await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA308 HTTP task receipts',true) RETURNING id");
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  assert.ok(tables.includes('task_create_receipts'));
  assert.ok(tables.every(name => /^[a-z_][a-z0-9_]*$/.test(name)));
  const snapshot = async () => {
    const hashes = {};
    for (const table of tables) {
      const [row] = await f.query(`SELECT md5(coalesce(jsonb_agg(
        jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)
        ORDER BY to_jsonb(r)::text,r.ctid::text)::text,'[]')) AS hash FROM "${table}" r`);
      hashes[table] = row.hash;
    }
    return hashes;
  };
  const send = (body, actorId = 91001) => request(f.base, '/api/tareas', {
    method: 'POST', token: tokens.get(actorId), body,
  });
  const recover = async (requestId, { actorId = 91001, query = '', authenticated = true } = {}) => {
    const response = await fetch(new URL(`/api/tareas/creaciones/${requestId}${query}`, f.base), {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: authenticated ? { authorization: `Bearer ${tokens.get(actorId)}` } : {},
    });
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
  };
  const draft = (patch = {}) => ({ request_id: randomUUID(), workspace: 'render_os',
    titulo: 'QA308 normal task', asignado_a_id: 91001, colaborador_ids: [],
    cliente_id: client.id, tipo_tarea: 'desarrollo', fecha_vencimiento: '2026-10-29', ...patch });
  function envelope(result, body, replayed) {
    assert.equal(result.status, replayed ? 200 : 201);
    assert.deepEqual(Object.keys(result.body).sort(), ['operation', 'task', 'version']);
    assert.equal(result.body.version, 1);
    assert.ok(Number.isSafeInteger(result.body.task?.id) && result.body.task.id > 0);
    assert.equal(result.body.task.titulo, body.titulo);
    assert.deepEqual(result.body.operation, { request_id: body.request_id.toLowerCase(),
      task_id: result.body.task.id, replayed });
    assert.equal(result.body.task.asignado_a_id, body.asignado_a_id);
    assert.deepEqual(result.body.task.colaborador_ids, []);
    assert.equal(Object.hasOwn(result.body.task, 'password_hash'), false);
    return result.body.task;
  }
  async function receipt(body, actorId, taskId) {
    const rows = await f.query('SELECT actor_user_id,request_id,task_id,task_revision,payload_hash FROM task_create_receipts WHERE actor_user_id=$1 AND request_id=$2', [actorId, body.request_id]);
    assert.equal(rows.length, 1); assert.equal(rows[0].task_id, taskId);
    assert.equal(rows[0].actor_user_id, actorId);
    assert.equal(rows[0].request_id, body.request_id.toLowerCase());
    assert.equal(Number(rows[0].task_revision), 1);
    assert.match(rows[0].payload_hash, /^[a-f0-9]{64}$/);
  }

  await t.test('normal committed creation can recover the same UUID with no second DML or notification', async () => {
    const body = draft(), first = envelope(await send(body), body, false);
    await receipt(body, 91001, first.id);
    const before = await snapshot();
    const second = envelope(await send(body), body, true);
    assert.equal(second.id, first.id);
    assert.deepEqual(await snapshot(), before);
    // This verifies server replay, not a browser/network response-loss event.
  });

  await t.test('GET recovery returns the current authorized DTO without writes and isolates actor receipts', async () => {
    const body = draft({ titulo: 'QA308 GET recovery' }), first = envelope(await send(body), body, false);
    const before = await snapshot();
    const result = await recover(body.request_id);
    assert.equal(result.cache, 'no-store');
    assert.equal(envelope(result, body, true).id, first.id);
    const foreign = await recover(body.request_id, { actorId: 91002 });
    const missing = await recover(randomUUID());
    for (const denied of [foreign, missing]) {
      assert.equal(denied.status, 404); assert.equal(denied.cache, 'no-store');
      assert.deepEqual(Object.keys(denied.body), ['error']);
      assert.equal(typeof denied.body.error, 'string');
      assert.equal(JSON.stringify(denied.body).includes(body.request_id), false);
      assert.equal(JSON.stringify(denied.body).includes(body.titulo), false);
    }
    assert.deepEqual(foreign.body, missing.body);
    assert.deepEqual(await snapshot(), before);
    // A lookup404 is not proof that an earlier in-flight creation cannot commit.
  });

  await t.test('GET recovery reads a later title/revision rather than a stored creation DTO', async () => {
    const body = draft({ titulo: 'QA308 before current edit' }), first = envelope(await send(body), body, false);
    const [changed] = await f.query("UPDATE tareas SET titulo='QA308 current title',updated_at=clock_timestamp() WHERE id=$1 RETURNING revision", [first.id]);
    assert.ok(Number(changed.revision) > Number(first.revision));
    const before = await snapshot(), result = await recover(body.request_id);
    assert.equal(result.cache, 'no-store');
    const current = envelope(result, { ...body, titulo: 'QA308 current title' }, true);
    assert.equal(current.id, first.id); assert.equal(Number(current.revision), Number(changed.revision));
    await receipt(body, 91001, first.id);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('GET recovery rejects invalid UUIDs and all query arguments without writes', async () => {
    const before = await snapshot();
    for (const id of ['invalid', '0', randomUUID() + '%0A', '%20' + randomUUID()]) {
      const result = await recover(id);
      assert.equal(result.status, 400); assert.equal(result.cache, 'no-store');
      assert.deepEqual(Object.keys(result.body), ['error']);
    }
    for (const query of ['?limit=1', '?workspace=render_os', '?x=', '?x=1&x=2', '?x%5B%5D=1']) {
      const result = await recover(randomUUID(), { query });
      assert.equal(result.status, 400); assert.equal(result.cache, 'no-store');
      assert.deepEqual(Object.keys(result.body), ['error']);
    }
    assert.equal((await recover(randomUUID(), { authenticated: false })).status, 401);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('same actor UUID concurrent requests serialize one task, assignment and receipt', async () => {
    const body = draft({ titulo: 'QA308 concurrent task' });
    const results = await Promise.all([send(body), send(body)]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 201]);
    const tasks = results.map(result => envelope(result, body, result.status === 200));
    assert.equal(tasks[0].id, tasks[1].id);
    assert.equal((await f.query('SELECT id FROM tareas WHERE titulo=$1', [body.titulo])).length, 1);
    assert.deepEqual(await f.query('SELECT usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1 ORDER BY usuario_id', [tasks[0].id]), [{ usuario_id: 91001, tipo: 'responsable' }]);
    await receipt(body, 91001, tasks[0].id);
  });

  await t.test('changed payload conflicts without writes while another actor owns an independent namespace', async () => {
    const body = draft({ titulo: 'QA308 namespaced task' });
    const first = envelope(await send(body), body, false), before = await snapshot();
    assert.equal((await send({ ...body, titulo: 'Different intent' })).status, 409);
    assert.deepEqual(await snapshot(), before);
    // Same payload, self-owned by actor91002, must be a separate deliberate task.
    const otherBody = { ...body, asignado_a_id: 91002 };
    const other = envelope(await send(otherBody, 91002), otherBody, false);
    assert.notEqual(other.id, first.id); await receipt(body, 91001, first.id); await receipt(otherBody, 91002, other.id);
  });

  await t.test('child replay reads current FK after parent deletion instead of rechecking the original parent', async () => {
    const parentBody = draft({ titulo: 'QA308 removable parent' });
    const parent = envelope(await send(parentBody), parentBody, false);
    const body = draft({ titulo: 'QA308 child', tarea_padre_id: parent.id });
    const child = envelope(await send(body), body, false);
    assert.equal(child.tarea_padre_id, parent.id);
    await f.query('DELETE FROM tareas WHERE id=$1', [parent.id]);
    const before = await snapshot(), replay = envelope(await send(body), body, true);
    assert.equal(replay.id, child.id); assert.equal(replay.tarea_padre_id, null);
    await receipt(body, 91001, child.id); assert.deepEqual(await snapshot(), before);
  });

  await t.test('visit replay preserves exactly one derived visit and its participants', async () => {
    const body = draft({ titulo: 'QA308 Visita', tipo_tarea: 'produccion', produccion_videos_previstos: 3 });
    const task = envelope(await send(body), body, false);
    const visits = await f.query('SELECT id FROM produccion_visitas WHERE tarea_origen_id=$1', [task.id]);
    assert.equal(visits.length, 1);
    const members = await f.query('SELECT usuario_id FROM produccion_visita_participantes WHERE visita_id=$1 ORDER BY usuario_id', [visits[0].id]);
    assert.deepEqual(members, [{ usuario_id: 91001 }]);
    const before = await snapshot(); assert.equal(envelope(await send(body), body, true).id, task.id);
    await receipt(body, 91001, task.id); assert.deepEqual(await snapshot(), before);
  });

  await t.test('rename and inactive recipient do not prevent recovery or rewrite labels/relations', async () => {
    const [original] = await f.query('SELECT nombre,activo FROM usuarios WHERE id=91003');
    const body = draft({ titulo: 'QA308 recover recipient', asignado_a_id: 91003 });
    const task = envelope(await send(body), body, false);
    // The route enqueues after responding. Observe that local effect before
    // revoking the recipient or taking a no-DML replay baseline; no transport.
    const deadline = Date.now() + 5000;
    let notices;
    do {
      notices = await f.query("SELECT id FROM mia_private_task_notifications WHERE tarea_id=$1 AND motivo='creada'", [task.id]);
      if (notices.length) break;
      await new Promise(resolve => setTimeout(resolve, 15));
    } while (Date.now() < deadline);
    assert.equal(notices.length, 1, 'Initial local enqueue must finish before replay invariants');
    try {
      await f.query("UPDATE usuarios SET nombre='QA308 renamed recipient',activo=false WHERE id=91003");
      const before = await snapshot(), replay = envelope(await send(body), body, true);
      assert.equal(replay.id, task.id); assert.equal(replay.asignado_a, task.asignado_a);
      assert.deepEqual(await snapshot(), before);
    } finally {
      await f.query('UPDATE usuarios SET nombre=$1,activo=$2 WHERE id=91003', [original.nombre, original.activo]);
    }
  });

  await t.test('deleted task leaves immutable correlation and404, never a replacement task', async () => {
    const body = draft({ titulo: 'QA308 deleted task' }), task = envelope(await send(body), body, false);
    await f.query('DELETE FROM tareas WHERE id=$1', [task.id]);
    const before = await snapshot(), result = await send(body);
    assert.equal(result.status, 404); assert.deepEqual(Object.keys(result.body), ['error']);
    const gone = await recover(body.request_id), missing = await recover(randomUUID());
    assert.equal(gone.status, 404); assert.equal(gone.cache, 'no-store');
    assert.equal(missing.status, 404); assert.deepEqual(gone.body, missing.body);
    assert.deepEqual(Object.keys(gone.body), ['error']);
    await receipt(body, 91001, task.id); assert.deepEqual(await snapshot(), before);
  });

  await t.test('new contract rejects unknown fields, invalid types and name-only fallback without writes', async () => {
    const before = await snapshot();
    const nameOnly = draft(); delete nameOnly.asignado_a_id; nameOnly.asignado_a = 'Franco QA';
    for (const body of [draft({ request_id: 'not-a-uuid' }), draft({ unexpected: true }),
      draft({ workspace: 'historical' }), draft({ asignado_a_id: '91001' }),
      draft({ colaborador_ids: '91002' }), draft({ colaborador_ids: ['91002'] }),
      draft({ titulo: { text: 'Invalid' } }), draft({ requiere_aprobacion: 'false' }),
      draft({ estado: { toString: null } }), nameOnly]) {
      assert.equal((await send(body)).status, 400, 'Invalid UUID-contract input cannot fall back to legacy');
    }
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('legacy noUUID response remains plain201 and creates no receipt', async () => {
    const body = draft({ titulo: 'QA308 legacy task' }); delete body.request_id;
    const before = await f.query('SELECT count(*)::int AS n FROM task_create_receipts');
    const result = await send(body);
    assert.equal(result.status, 201); assert.ok(Number.isSafeInteger(result.body.id));
    assert.equal(result.body.titulo, body.titulo);
    assert.equal(Object.hasOwn(result.body, 'operation'), false);
    assert.equal(Object.hasOwn(result.body, 'task'), false);
    assert.deepEqual(await f.query('SELECT count(*)::int AS n FROM task_create_receipts'), before);
  });

  await t.test('anonymous and revoked actor cannot create or recover a receipt', async () => {
    const body = draft({ titulo: 'QA308 revoked actor' }); envelope(await send(body), body, false);
    await f.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91001');
    const before = await snapshot();
    assert.equal((await send(body)).status, 401);
    assert.equal((await recover(body.request_id)).status, 401);
    assert.equal((await request(f.base, '/api/tareas', { method: 'POST', body })).status, 401);
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual((await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename), tables);
  });
});
