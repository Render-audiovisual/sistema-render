import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';

const tables = { historia: 'historias', publicacion: 'publicaciones' };
const evidenceTables = ['editorial_publicacion_versiones', 'editorial_publicacion_eventos'];
const poison = 'QA_FINANCIAL_PRIVATE_55612';
test('editorial explicit confirmation: principal history, current authority and durable evidence', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const fixture = await startLocalHarness({ port: 55612, deferEditorialConfirmationMigration: true });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own editorial-confirmation fixture stopped and removed: ${fixture.root}`);
  });
  const check = (response, status = 200) => {
    assert.equal(response.status, status, JSON.stringify(response.body)); return response.body;
  };
  const login = async usuario => check(await request(fixture.base, '/api/login', {
    method: 'POST', body: { usuario, password: fixturePassword },
  })).token;
  const admin = await login('qa_franco');
  for (const [id, role] of [[106001, 'admin'], [106002, 'edicion']]) await fixture.query(`INSERT INTO usuarios
    (id,usuario,nombre,rol,password_hash,activo,session_version)
    SELECT $1,$2,'QA same editorial actor',$3,password_hash,true,1 FROM usuarios WHERE id=91004`,
  [id, `qa_confirmation_${id}`, role]);
  const actor = await login('qa_confirmation_106001'); const staff = await login('qa_confirmation_106002');
  const [client] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA explicit publication') RETURNING id");
  const [other] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA historical event client') RETURNING id");
  const seed = async (domain, state = 'lista', actual = null, metadata = {}) => {
    const [piece] = await fixture.query(`INSERT INTO ${tables[domain]}
      (cliente_id,${domain === 'publicacion' ? 'tipo,' : ''}estado,fecha_programada,"fecha_publicación_real",copy,metadata)
      VALUES ($1,${domain === 'publicacion' ? "'video'," : ''}$2,'2026-09-30',$3,'QA legitimate copy',$4::jsonb) RETURNING id`,
    [client.id, state, actual, JSON.stringify({ money: { importe: 782391.45, marker: poison }, ...metadata })]);
    return { domain, id: piece.id };
  };
  const url = piece => `/api/editorial-publicacion/${piece.domain}/${piece.id}`;
  const get = async (piece, token = admin) => check(await request(fixture.base, url(piece), { token }));
  const write = (piece, action, body, token = admin) => request(fixture.base, `${url(piece)}/${action}`, { token, method: 'POST', body });
  const intention = async (piece, extra = {}) => ({ request_id: randomUUID(), expected_revision: (await get(piece)).piece.revision,
    occurred_at: '2026-08-01T00:30:00-03:00', ...extra });
  const snap = async (evidence = true) => {
    const result = {};
    for (const table of ['clientes', 'usuarios', 'historias', 'publicaciones', 'tareas', 'tarea_asignaciones', 'cliente_objetivos_mensuales', 'cliente_objetivo_piezas',
      'cliente_objetivo_eventos', ...(evidence ? evidenceTables : [])])
      result[table] = await fixture.query(`SELECT to_jsonb(r) AS row FROM ${table} r ORDER BY to_jsonb(r)::text`);
    return result;
  };
  const keys = (value, names) => assert.deepEqual(Object.keys(value).sort(), [...names].sort());
  // The harness transports PostgreSQL messages, not Error.code. Assert SQLSTATE
  // and the named constraint in the fixture database, never accept any rejection.
  const sqlReject = async (statement, state, constraint) => {
    await fixture.query(`DO $qa$ DECLARE seen text; BEGIN
      BEGIN ${statement}; RAISE EXCEPTION 'QA expected rejection' USING ERRCODE='XX000';
      EXCEPTION WHEN SQLSTATE '${state}' THEN
        GET STACKED DIAGNOSTICS seen=CONSTRAINT_NAME;
        IF seen IS DISTINCT FROM '${constraint}' THEN RAISE EXCEPTION 'Wrong constraint: %',seen; END IF;
      END;
    END $qa$`);
  };
  const safe = (dto, writing = false) => {
    keys(dto, ['piece', 'classification', 'current_confirmation', 'can_confirm', ...(writing ? ['operation', 'replayed', 'changed'] : [])]);
    keys(dto.piece, ['id', 'dominio', 'cliente_id', 'estado', 'revision', 'fecha_programada', 'fecha_publicacion_real']);
    assert.ok(Number.isSafeInteger(dto.piece.revision) && dto.piece.revision >= 0);
    if (dto.current_confirmation) {
      keys(dto.current_confirmation, ['id', 'actor_id', 'occurred_at', 'recorded_at', 'source']);
      assert.equal(dto.current_confirmation.source, 'manual');
      for (const field of ['occurred_at', 'recorded_at']) assert.equal(new Date(dto.current_confirmation[field]).toISOString(), dto.current_confirmation[field]);
    }
    if (writing) keys(dto.operation, ['id', 'action']);
    assert.ok(!JSON.stringify(dto).includes(poison)); assert.ok(!JSON.stringify(dto).includes('782391.45'));
  };
  const historical = [];
  for (const domain of Object.keys(tables)) for (const [state, date] of [
    ['publicada', '2026-07-31T23:30:00Z'], ['publicada', null], ['lista', '2026-07-31T23:30:00Z'], ['lista', null],
  ]) historical.push(await seed(domain, state, date));
  const [legacyTask] = await fixture.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,publicacion_id,estado,tipo_tarea,propiedades_extra)
    VALUES ('QA historical final task','QA same editorial actor',$1,$2,'finalizada','edicion','{"workspace":"render_os"}') RETURNING id`, [client.id, historical[4].id]);
  await fixture.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ($1,106002,'responsable')", [legacyTask.id]);
  const [legacyGoal] = await fixture.query(`INSERT INTO cliente_objetivos_mensuales
    (clave,periodo,cliente_id,nombre,reels,carruseles,preparado_por)
    VALUES ('qa-confirmation-064','2026-09-01',$1,'QA preserved objective',1,0,'QA fixture') RETURNING id`, [client.id]);
  await fixture.query(`INSERT INTO cliente_objetivo_piezas(objetivo_id,tipo,numero,tarea_id,publicacion_id,titulo,estado)
    VALUES ($1,'video',1,$2,$3,'QA preserved delivered slot','publicada')`, [legacyGoal.id, legacyTask.id, historical[4].id]);
  await t.test('064 is additive: populated editorial/task/goal snapshots unchanged and two tables empty', async () => {
    const files = (await readdir(new URL('../migrations/', import.meta.url))).filter(name => /^064_.*\.sql$/.test(name));
    assert.equal(files.length, 1);
    assert.deepEqual(await fixture.query('SELECT nombre FROM _migrations WHERE nombre=$1', [files[0]]), []);
    for (const table of evidenceTables) assert.deepEqual(await fixture.query('SELECT to_regclass($1) AS relation', [`public.${table}`]), [{ relation: null }]);
    const before = await snap(false);
    await fixture.query(await readFile(new URL(`../migrations/${files[0]}`, import.meta.url), 'utf8'));
    assert.deepEqual(await snap(false), before);
    for (const table of evidenceTables) assert.deepEqual(await fixture.query(`SELECT * FROM ${table}`), []);
    await fixture.query('INSERT INTO _migrations(nombre) VALUES ($1)', [files[0]]);
  });
  await t.test('historical state/date are never promoted; DTO is closed for admin and homonymous employee', async () => {
    const response = await fetch(`${fixture.base}${url(historical[0])}`, {
      headers: { Authorization: `Bearer ${admin}` }, signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store'); await response.json();
    for (let i = 0; i < historical.length; i++) {
      const piece = historical[i];
      for (const token of [admin, staff]) {
        const dto = await get(piece, token); safe(dto);
        assert.equal(dto.classification, i % 4 === 3 ? 'no_publicada' : 'historica_sin_confirmacion');
        assert.equal(dto.current_confirmation, null); assert.equal(dto.piece.revision, 0);
        assert.equal(dto.can_confirm, token === admin);
      }
    }
    assert.deepEqual(await fixture.query('SELECT * FROM editorial_publicacion_eventos'), []);
  });
  for (const domain of Object.keys(tables)) {
    await t.test(`${domain}: confirm, canonical replay, withdraw and old-intent replay reflect current truth`, async () => {
      const piece = await seed(domain); const body = await intention(piece);
      const confirmed = check(await write(piece, 'confirmar', body, actor), 201); safe(confirmed, true);
      assert.equal(confirmed.classification, 'confirmada_manualmente'); assert.equal(confirmed.changed, true); assert.equal(confirmed.replayed, false);
      assert.equal(confirmed.current_confirmation.actor_id, 106001);
      assert.equal(confirmed.piece.fecha_publicacion_real, '2026-08-01T03:30:00.000Z');
      assert.equal(confirmed.piece.fecha_programada.slice(0, 10), '2026-09-30');
      assert.equal(confirmed.piece.estado, 'publicada');
      const before = await snap();
      const replay = check(await write(piece, 'confirmar', { ...body, occurred_at: '2026-08-01T03:30:00.000Z' }, actor));
      safe(replay, true); assert.equal(replay.replayed, true); assert.equal(replay.changed, false);
      assert.deepEqual(replay.operation, confirmed.operation); assert.deepEqual(await snap(), before);
      assert.equal((await write(piece, 'confirmar', { ...body, occurred_at: '2026-08-02T03:30:00Z' }, actor)).status, 409);
      assert.equal((await write(piece, 'confirmar', await intention(piece), actor)).status, 409);
      const withdrawal = { request_id: randomUUID(), expected_revision: (await get(piece)).piece.revision };
      const withdrawn = check(await write(piece, 'retirar', withdrawal, actor)); safe(withdrawn, true);
      assert.equal(withdrawn.piece.estado, 'lista'); assert.equal(withdrawn.piece.fecha_publicacion_real, null);
      assert.equal(withdrawn.current_confirmation, null); assert.equal(withdrawn.classification, 'no_publicada');
      const after = await snap();
      const old = check(await write(piece, 'confirmar', body, actor));
      assert.equal(old.replayed, true); assert.equal(old.changed, false); assert.equal(old.current_confirmation, null);
      assert.equal(old.piece.estado, 'lista'); assert.deepEqual(await snap(), after);
      const retried = check(await write(piece, 'retirar', withdrawal, actor)); assert.equal(retried.replayed, true);
      assert.equal((await write(piece, 'retirar', { ...withdrawal, request_id: randomUUID(), expected_revision: withdrawn.piece.revision }, actor)).status, 409);
      const events = await fixture.query('SELECT * FROM editorial_publicacion_eventos WHERE dominio=$1 AND pieza_id=$2 ORDER BY recorded_at,id', [domain, piece.id]);
      assert.equal(events.length, 2); assert.equal(events[0].cliente_id, client.id);
      assert.equal(events[1].previous_event_id, events[0].id);
    });
    await t.test(`${domain}: exact-key concurrency creates once and stale independent intentions conflict`, async () => {
      const piece = await seed(domain); const body = await intention(piece);
      const responses = await Promise.all([write(piece, 'confirmar', body), write(piece, 'confirmar', body)]);
      assert.deepEqual(responses.map(r => r.status).sort(), [200, 201]);
      assert.equal(responses.filter(r => r.body.changed === true).length, 1);
      assert.equal((await fixture.query('SELECT count(*)::int AS n FROM editorial_publicacion_eventos WHERE dominio=$1 AND pieza_id=$2', [domain, piece.id]))[0].n, 1);
      const fresh = await seed(domain); const first = await intention(fresh); const second = { ...first, request_id: randomUUID() };
      assert.deepEqual((await Promise.all([write(fresh, 'confirmar', first), write(fresh, 'confirmar', second)])).map(r => r.status).sort(), [201, 409]);
      const untouched = await snap(); assert.equal((await write(fresh, 'confirmar', first, staff)).status, 403); assert.deepEqual(await snap(), untouched);
    });
    await t.test(`${domain}: unrelated copy/planning preserve evidence; changed/reverted actual state and client never restore it`, async () => {
      const piece = await seed(domain); const body = await intention(piece); const original = check(await write(piece, 'confirmar', body), 201);
      await fixture.query(`UPDATE ${tables[domain]} SET copy='QA changed copy',fecha_programada='2026-10-03' WHERE id=$1`, [piece.id]);
      const copied = await get(piece); assert.deepEqual(copied.current_confirmation, original.current_confirmation);
      assert.equal(copied.piece.revision, original.piece.revision + 1);
      await fixture.query(`UPDATE ${tables[domain]} SET estado='lista' WHERE id=$1`, [piece.id]);
      await fixture.query(`UPDATE ${tables[domain]} SET estado='publicada' WHERE id=$1`, [piece.id]);
      assert.equal((await get(piece)).current_confirmation, null);
      const reconfirmed = check(await write(piece, 'confirmar', await intention(piece)), 201);
      await fixture.query(`UPDATE ${tables[domain]} SET cliente_id=$2 WHERE id=$1`, [piece.id, other.id]);
      assert.equal((await get(piece)).current_confirmation, null);
      assert.equal((await fixture.query('SELECT cliente_id FROM editorial_publicacion_eventos WHERE id=$1', [reconfirmed.operation.id]))[0].cliente_id, client.id);
      await fixture.query(`UPDATE ${tables[domain]} SET cliente_id=$2 WHERE id=$1`, [piece.id, client.id]);
      assert.equal((await get(piece)).current_confirmation, null);
      check(await write(piece, 'confirmar', await intention(piece)), 201);
      await fixture.query(`UPDATE ${tables[domain]} SET "fecha_publicación_real"="fecha_publicación_real"+interval '1 second' WHERE id=$1`, [piece.id]);
      assert.equal((await get(piece)).current_confirmation, null);
    });
  }
  await t.test('closed inputs, exact domains/IDs, zoned real dates, future dates and absent CAS reject without writes', async () => {
    const piece = await seed('historia'); const body = await intention(piece); const before = await snap();
    for (const invalid of [ { ...body, source: 'instagram' }, { ...body, actor_id: 91001 }, { ...body, expected_revision: -1 },
      { ...body, expected_revision: 0.5 }, { ...body, expected_revision: undefined }, { ...body, request_id: 'bad' },
      ...['2026-02-30T12:00:00Z', '2026-01-01T00:00:00', 'bad', '2999-01-01T00:00:00Z'].map(occurred_at => ({ ...body, occurred_at })) ])
      assert.equal((await write(piece, 'confirmar', invalid)).status, 400, JSON.stringify(invalid));
    for (const path of ['historia/0', 'historia/2147483648', 'historia/1x', 'historias/1'])
      assert.equal((await request(fixture.base, `/api/editorial-publicacion/${path}`, { token: admin })).status, 400, path);
    assert.equal((await request(fixture.base, url(piece))).status, 401);
    assert.deepEqual(await snap(), before);
  });
  await t.test('replay revalidates current admin role, session and active identity, not token or homonymous name', async () => {
    const piece = await seed('publicacion'); const body = await intention(piece); check(await write(piece, 'confirmar', body, actor), 201);
    await fixture.query("UPDATE usuarios SET rol='edicion' WHERE id=106001");
    assert.equal((await write(piece, 'confirmar', body, actor)).status, 403);
    await fixture.query("UPDATE usuarios SET rol='admin',session_version=session_version+1 WHERE id=106001");
    assert.equal((await write(piece, 'confirmar', body, actor)).status, 401);
    const renewed = await login('qa_confirmation_106001');
    await fixture.query('UPDATE usuarios SET activo=false WHERE id=106001');
    assert.equal((await write(piece, 'confirmar', body, renewed)).status, 401);
    await fixture.query('UPDATE usuarios SET activo=true WHERE id=106001');
    const otherKey = await intention(await seed('historia'));
    assert.equal((await write(piece, 'confirmar', otherKey, staff)).status, 403);
  });
  await t.test('archived pieces and inactive clients are invisible before new writes and replay', async () => {
    for (const domain of Object.keys(tables)) {
      const piece = await seed(domain); const body = await intention(piece); check(await write(piece, 'confirmar', body), 201);
      await fixture.query(`UPDATE ${tables[domain]} SET metadata=metadata||'{"archivado_tablero":true}'::jsonb WHERE id=$1`, [piece.id]);
      const before = await snap(); assert.equal((await request(fixture.base, url(piece), { token: staff })).status, 404);
      assert.equal((await write(piece, 'confirmar', body)).status, 404); assert.deepEqual(await snap(), before);
      await fixture.query(`UPDATE ${tables[domain]} SET metadata=metadata- 'archivado_tablero' WHERE id=$1`, [piece.id]);
      assert.equal((await get(piece)).current_confirmation, null);
    }
    await fixture.query('UPDATE clientes SET activo=false WHERE id=$1', [client.id]);
    try { assert.equal((await request(fixture.base, url(historical[0]), { token: admin })).status, 404); }
    finally { await fixture.query('UPDATE clientes SET activo=true WHERE id=$1', [client.id]); }
  });
  await t.test('unexpected event-insert failure rolls back piece/version/evidence; same key can retry', async () => {
    const piece = await seed('publicacion'); const body = await intention(piece); const before = await snap();
    await fixture.query(`CREATE FUNCTION qa_editorial_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'QA editorial rollback' USING ERRCODE='XX000'; END $$;
      CREATE TRIGGER qa_editorial_fault BEFORE INSERT ON editorial_publicacion_eventos FOR EACH ROW EXECUTE FUNCTION qa_editorial_fault()`);
    try { assert.equal((await write(piece, 'confirmar', body)).status, 500); assert.deepEqual(await snap(), before); }
    finally { await fixture.query('DROP TRIGGER qa_editorial_fault ON editorial_publicacion_eventos; DROP FUNCTION qa_editorial_fault()'); }
    check(await write(piece, 'confirmar', body), 201);
  });
  await t.test('client deactivation serializes before confirmation and returns404 without evidence or deadlock', async () => {
    const piece = await seed('historia'); const body = await intention(piece);
    const marker = `qa_editorial_client_lock_${randomUUID().replaceAll('-', '')}`;
    let blocker;
    try {
      blocker = fixture.query(`/* ${marker} */ BEGIN; UPDATE clientes SET activo=false WHERE id=${client.id}; SELECT pg_sleep(1.2); COMMIT`);
      let sleeping = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        const rows = await fixture.query("SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND query LIKE $1 AND wait_event='PgSleep'", [`%${marker}%`]);
        if (rows.length) { sleeping = true; break; }
        await new Promise(resolve => setTimeout(resolve, 15));
      }
      assert.equal(sleeping, true, 'Observe actual client lock holder before HTTP request');
      const response = write(piece, 'confirmar', body);
      let waiting = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        const rows = await fixture.query("SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query ILIKE '%clientes%' AND query ILIKE '%FOR SHARE%'");
        if (rows.length) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 15));
      }
      assert.equal(waiting, true, 'Confirmation really waits for active-client FOR SHARE');
      assert.equal((await response).status, 404); await blocker;
      assert.deepEqual(await fixture.query('SELECT * FROM editorial_publicacion_eventos WHERE dominio=$1 AND pieza_id=$2', [piece.domain, piece.id]), []);
      assert.deepEqual(await fixture.query('SELECT * FROM editorial_publicacion_versiones WHERE dominio=$1 AND pieza_id=$2', [piece.domain, piece.id]), []);
      assert.equal((await fixture.query('SELECT estado,"fecha_publicación_real" AS actual FROM historias WHERE id=$1', [piece.id]))[0].estado, 'lista');
    } finally {
      if (blocker) await blocker;
      await fixture.query('UPDATE clientes SET activo=true WHERE id=$1', [client.id]);
    }
  });
  await t.test('immutable events and restrictive piece/client history survive attempted SQL delete/update', async () => {
    const piece = await seed('historia'); const confirmed = check(await write(piece, 'confirmar', await intention(piece)), 201);
    for (const sql of [`UPDATE editorial_publicacion_eventos SET source=source WHERE id='${confirmed.operation.id}'`,
      `DELETE FROM editorial_publicacion_eventos WHERE id='${confirmed.operation.id}'`]) {
      const before = await snap(); await sqlReject(sql, '23514', 'editorial_publicacion_evento_immutable'); assert.deepEqual(await snap(), before);
    }
    let before = await snap();
    await sqlReject(`DELETE FROM historias WHERE id=${piece.id}`, '23503', 'editorial_publicacion_evento_historia_fk');
    assert.deepEqual(await snap(), before);
    const [oldClient] = await fixture.query("INSERT INTO clientes(nombre) VALUES ('QA immutable original client') RETURNING id");
    const moved = await seed('publicacion');
    await fixture.query('UPDATE publicaciones SET cliente_id=$2 WHERE id=$1', [moved.id, oldClient.id]);
    const event = check(await write(moved, 'confirmar', await intention(moved)), 201);
    await fixture.query('UPDATE publicaciones SET cliente_id=$2 WHERE id=$1', [moved.id, other.id]);
    before = await snap();
    await sqlReject(`DELETE FROM clientes WHERE id=${oldClient.id}`, '23503', 'editorial_publicacion_evento_cliente_fk');
    assert.deepEqual(await snap(), before);
    assert.equal((await fixture.query('SELECT cliente_id FROM editorial_publicacion_eventos WHERE id=$1', [event.operation.id]))[0].cliente_id, oldClient.id);
    const cross = await seed('historia');
    await fixture.query('UPDATE historias SET copy=copy WHERE id=$1', [cross.id]);
    before = await snap();
    await sqlReject(`UPDATE editorial_publicacion_versiones SET current_event_id='${event.operation.id}' WHERE dominio='historia' AND pieza_id=${cross.id}`,
      '23514', 'editorial_publicacion_current_matches_piece');
    assert.deepEqual(await snap(), before);
  });
  await t.test('real assigned-task review/approval/finalization is not publication evidence in either domain', async () => {
    for (const domain of Object.keys(tables)) {
      const piece = await seed(domain); const before = await get(piece);
      const task = check(await request(fixture.base, '/api/tareas?workspace=render_os', { token: admin, method: 'POST', body: {
        titulo: 'QA independent editorial task', workspace: 'render_os', cliente_id: client.id, tipo_tarea: 'edicion', subtipo: 'video',
        [domain === 'historia' ? 'historia_id' : 'publicacion_id']: piece.id,
        asignado_a_id: 106002, colaborador_ids: [], propiedades_extra: { workspace: 'render_os' },
      } }), 201);
      const taskId = task.id;
      assert.ok(Number.isSafeInteger(taskId) && taskId > 0, JSON.stringify(task));
      assert.equal(task.propiedades_extra.workspace, 'render_os');
      const [stored] = await fixture.query('SELECT propiedades_extra->>\'workspace\' AS workspace,historia_id,publicacion_id FROM tareas WHERE id=$1', [taskId]);
      assert.equal(stored.workspace, 'render_os');
      assert.equal(stored[domain === 'historia' ? 'historia_id' : 'publicacion_id'], piece.id);
      for (const estado of ['en_progreso', 'en_revision', 'aprobada', 'finalizada']) {
        const detail = check(await request(fixture.base, `/api/tareas/${taskId}?workspace=render_os`, { token: admin }));
        check(await request(fixture.base, `/api/tareas/${taskId}?workspace=render_os`, { token: estado === 'aprobada' || estado === 'finalizada' ? admin : staff,
          method: 'PATCH', body: { estado, expected_revision: detail.revision } }));
      }
      const after = await get(piece);
      assert.equal(after.current_confirmation, null); assert.equal(after.classification, 'no_publicada');
      assert.equal(after.piece.fecha_publicacion_real, null); assert.equal(after.piece.estado, before.piece.estado);
      assert.deepEqual(await fixture.query('SELECT * FROM editorial_publicacion_eventos WHERE dominio=$1 AND pieza_id=$2', [domain, piece.id]), []);
    }
  });
});
