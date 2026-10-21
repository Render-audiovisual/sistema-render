import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

test('editorial archive: non-destructive observed transitions, current replay, private inventory and publication preservation', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const f = await startLocalHarness({ port: 55762 }), connections = new Set();
  t.after(async () => {
    for (const db of connections) { await db.query('ROLLBACK').catch(() => {}); await db.end(); }
    await f.cleanup(); await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`QA116 cleanup ENOENT: ${f.root}; PostgreSQL port55762`);
  });
  const url = 'postgresql://render2_fixture@127.0.0.1:55762/render2_local_test';
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55762, url, identity });
  const connect = async () => {
    const db = new pg.Client({ connectionString: url, application_name: 'qa116-own-archive-barrier', statement_timeout: 15000 });
    connections.add(db); await db.connect(); return db;
  };
  const close = async db => { await db.query('ROLLBACK').catch(() => {}); await db.end(); connections.delete(db); };
  const api = (path, token, method = 'GET', body) => request(f.base, `/api${path}`, { token, method, body });
  const http = async (path, token, method = 'GET', body) => {
    const response = await fetch(new URL(`/api${path}`, f.base), { method, signal: AbortSignal.timeout(20000),
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json(), cacheControl: response.headers.get('cache-control') };
  };
  const ok = (result, status = 200) => { assert.equal(result.status, status, 'Unexpected principal HTTP status'); return result.body; };
  const login = async usuario => ok(await api('/login', null, 'POST', { usuario, password: fixturePassword })).token;
  const admin = await login('qa_franco'), otherAdmin = await login('qa_agustin'), staff = await login('qa_luciano');
  const [client] = await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA116 main account',true) RETURNING id,nombre");
  const [volumeClient] = await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA116 archive inventory',true) RETURNING id,nombre");
  const marker = 'QA116_PRIVATE_METADATA_CANARY';
  const tableFor = domain => domain === 'historia' ? 'historias' : 'publicaciones';
  let nextId = 997300;
  const seed = async (domain, extra = {}) => {
    const id = extra.id ?? nextId++;
    await f.query(`INSERT INTO ${tableFor(domain)}(id,cliente_id,${domain === 'publicacion' ? 'tipo,' : ''}estado,
      fecha_programada,"fecha_publicación_real",idea,copy,metadata)
      VALUES($1,$2,${domain === 'publicacion' ? "'video'," : ''}$3,'2026-10-20',$4,$5,'Original copy',$6::jsonb)`,
    [id, extra.clientId ?? client.id, extra.state ?? 'lista', extra.actual ?? null, `QA116 ${domain} ${id}`,
      JSON.stringify({ private_finance: { marker, amount: 817293.46 }, ...(extra.metadata || {}) })]);
    return { id, domain };
  };
  const read = async piece => ok(await api(`/piezas/${piece.id}?dominio=${piece.domain}`, admin));
  const route = (piece, action) => `/editorial-archivo/${piece.domain}/${piece.id}/${action}`;
  const change = (piece, action, body, token = admin) => http(route(piece, action), token, 'POST', body);
  const intent = async piece => ({ request_id: randomUUID(), expected_revision: (await read(piece)).revision, motivo: 'QA116 reviewed archive decision' });
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  const snapshot = async () => {
    const result = {};
    for (const table of tables) {
      assert.match(table, /^[a-zA-Z_][a-zA-Z_0-9]*$/);
      result[table] = await f.query(`SELECT * FROM "${table}" t ORDER BY to_jsonb(t)::text`);
    }
    return result;
  };
  const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
  const checkPiece = (row, piece) => {
    keys(row, ['id', 'dominio', 'cliente', 'titulo', 'tipo', 'estado', 'fecha_programada', 'revision', 'archived', 'can_archive', 'can_restore', 'publication_classification']);
    keys(row.cliente, ['id', 'nombre', 'activo']); assert.equal(row.id, piece.id); assert.equal(row.dominio, piece.domain);
    assert.ok(Number.isSafeInteger(row.revision) && row.revision >= 0);
    assert.equal(typeof row.archived, 'boolean'); assert.equal(typeof row.can_archive, 'boolean'); assert.equal(typeof row.can_restore, 'boolean');
    assert.equal(JSON.stringify(row).includes(marker), false); assert.equal(JSON.stringify(row).includes('817293.46'), false);
  };
  const check = (body, piece, action, replayed) => {
    keys(body, ['version', 'piece', 'operation']); assert.equal(body.version, 1); checkPiece(body.piece, piece);
    keys(body.operation, ['id', 'request_id', 'action', 'replayed']); assert.equal(body.operation.action, action); assert.equal(body.operation.replayed, replayed);
    assert.match(body.operation.id, /^[a-f0-9-]{36}$/); return body;
  };
  const waitFor = async (db, sql, values, message) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const { rows } = await db.query(sql, values); if (rows.length) return rows[0];
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    assert.fail(message);
  };

  const collision = [await seed('historia', { id: 997290 }), await seed('publicacion', { id: 997290 })];
  for (const piece of collision) await t.test(`${piece.domain}: archive/restore preserve linked task/quota/history and old archive replay observes CURRENT restored state`, async () => {
    const [task] = await f.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,${piece.domain === 'historia' ? 'historia_id' : 'publicacion_id'},
      tipo_tarea,estado,propiedades_extra) VALUES('QA116 retained work','Fixture',$1,$2,'edicion','aprobada','{"workspace":"render_os","origen_pieza":true}') RETURNING id`, [client.id, piece.id]);
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91003,'responsable')", [task.id]);
    const [goal] = await f.query(`INSERT INTO cliente_objetivos_mensuales(clave,periodo,cliente_id,nombre,cuentas,reels,carruseles,preparado_por)
      VALUES($1,'2026-10-01',$2,'QA116 retained quota',$3::jsonb,1,0,'QA116 fixture') RETURNING id`,
    [`qa116-${piece.domain}`, client.id, JSON.stringify([client])]);
    await f.query(`INSERT INTO cliente_objetivo_piezas(objetivo_id,tipo,numero,tarea_id,publicacion_id,titulo,estado)
      VALUES($1,'video',1,$2,$3,'QA116 original slot','aprobada')`, [goal.id, task.id, piece.domain === 'publicacion' ? piece.id : null]);
    const other = collision.find(row => row.domain !== piece.domain), input = await intent(piece), before = await snapshot();
    const listPath = piece.domain === 'historia' ? '/historias' : '/publicaciones';
    assert.ok(ok(await api(listPath, admin)).some(row => row.id === piece.id));
    const archived = check(ok(await change(piece, 'archivar', input), 201), piece, 'archivar', false);
    assert.equal(archived.piece.archived, true); assert.equal(archived.piece.can_archive, false); assert.equal(archived.piece.can_restore, true);
    assert.equal(archived.piece.revision, input.expected_revision + 1);
    const after = await snapshot();
    for (const table of tables.filter(table => ![tableFor(piece.domain), 'editorial_publicacion_versiones', 'editorial_archive_events'].includes(table))) assert.deepEqual(after[table], before[table], table);
    assert.deepEqual(after[tableFor(other.domain)], before[tableFor(other.domain)]);
    const archivedRow = after[tableFor(piece.domain)].find(row => row.id === piece.id), original = before[tableFor(piece.domain)].find(row => row.id === piece.id);
    const { metadata, updated_at, ...unchanged } = archivedRow;
    const { metadata: originalMetadata, updated_at: originalUpdatedAt, ...originalFields } = original;
    assert.deepEqual(unchanged, originalFields); assert.deepEqual(metadata, { ...originalMetadata, archivado_tablero: true });
    assert.equal(ok(await api(listPath, staff)).some(row => row.id === piece.id), false);
    assert.deepEqual(await snapshot(), after, 'Canonical list read must not mutate archive or linked work');
    const stable = await snapshot(); check(ok(await change(piece, 'archivar', input)), piece, 'archivar', true);
    ok(await change(piece, 'archivar', { ...input, request_id: randomUUID(), expected_revision: archived.piece.revision }), 409);
    ok(await change(piece, 'archivar', { ...input, motivo: 'Changed immutable intent' }), 409);
    ok(await http(`/piezas/${piece.id}?dominio=${piece.domain}`, admin, 'PATCH', { expected_revision: archived.piece.revision, copy: 'Forbidden archived edit' }), 409);
    assert.deepEqual(await snapshot(), stable);
    const restoreInput = { request_id: randomUUID(), expected_revision: archived.piece.revision };
    const restored = check(ok(await change(piece, 'restaurar', restoreInput), 201), piece, 'restaurar', false);
    assert.equal(restored.piece.archived, false); assert.equal(restored.piece.revision, archived.piece.revision + 1);
    const restoredSnapshot = await snapshot();
    assert.ok(ok(await api(listPath, staff)).some(row => row.id === piece.id));
    const oldReplay = check(ok(await change(piece, 'archivar', input)), piece, 'archivar', true);
    assert.deepEqual(oldReplay.piece, restored.piece); assert.equal(oldReplay.operation.id, archived.operation.id);
    ok(await change(piece, 'restaurar', { ...restoreInput, request_id: randomUUID(), expected_revision: restored.piece.revision }), 409);
    assert.deepEqual(await snapshot(), restoredSnapshot);
  });

  await t.test('competing observed archive operations have one201 and one409; creation receipt replay cannot silently restore the archived piece', async () => {
    const creation = { request_id: randomUUID(), tipo: 'video', cliente_id: client.id, responsable_id: 91004,
      fecha_programada: '2026-10-20', idea: 'QA116 retained creation receipt' };
    const created = ok(await api('/piezas', admin, 'POST', creation), 201), piece = { id: created.id, domain: 'publicacion' };
    const input = await intent(piece), before = await snapshot();
    const results = await Promise.all([change(piece, 'archivar', input, admin),
      change(piece, 'archivar', { ...input, request_id: randomUUID() }, otherAdmin)]);
    assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
    const winner = check(results.find(result => result.status === 201).body, piece, 'archivar', false);
    const committed = await snapshot(); assert.equal(committed.editorial_archive_events.length, before.editorial_archive_events.length + 1);
    const replay = ok(await api('/piezas', admin, 'POST', creation));
    assert.equal(replay.id, created.id); assert.equal(replay.creation.tarea_id, created.creation.tarea_id); assert.equal(replay.creation.replayed, true);
    assert.equal(replay.metadata.archivado_tablero, true); assert.equal(replay.publicacion_evidencia.revision, winner.piece.revision);
    assert.deepEqual(await snapshot(), committed);
  });

  await t.test('published state, real actual date and current confirmation block new archive; legacy archived published restore never reconstructs evidence', async () => {
    const [clock] = await f.query(`SELECT to_char((statement_timestamp()-interval '1 minute') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS past`);
    for (const domain of ['historia', 'publicacion']) {
      const historical = await seed(domain, { state: 'publicada' }), actualOnly = await seed(domain, { actual: clock.past });
      const confirmed = await seed(domain);
      const status = ok(await api(`/editorial-publicacion/${domain}/${confirmed.id}`, admin));
      ok(await api(`/editorial-publicacion/${domain}/${confirmed.id}/confirmar`, admin, 'POST', {
        request_id: randomUUID(), expected_revision: status.piece.revision, occurred_at: clock.past }), 201);
      for (const piece of [historical, actualOnly, confirmed]) {
        const input = await intent(piece), before = await snapshot(); ok(await change(piece, 'archivar', input), 409);
        assert.deepEqual(await snapshot(), before);
      }
      // Historical archived rows predate this operation API. Existing064 clears
      // the pointer: restoration is not permission to resurrect a confirmation.
      await f.query(`UPDATE ${tableFor(domain)} SET metadata=metadata||'{"archivado_tablero":true}' WHERE id=$1`, [confirmed.id]);
      const before = await snapshot(), input = await intent(confirmed);
      const restored = check(ok(await change(confirmed, 'restaurar', input), 201), confirmed, 'restaurar', false);
      assert.equal(restored.piece.archived, false); assert.equal(restored.piece.publication_classification, 'historica_sin_confirmacion');
      const after = await snapshot(); assert.deepEqual(after.editorial_publicacion_eventos, before.editorial_publicacion_eventos);
      assert.equal(after[tableFor(domain)].find(row => row.id === confirmed.id)['fecha_publicación_real'], before[tableFor(domain)].find(row => row.id === confirmed.id)['fecha_publicación_real']);
      assert.equal((await read(confirmed)).publicacion_evidencia.confirmation, null);
    }
  });

  await t.test('canonical archive metadata is reserved; legacy DELETE410 cannot erase pieces, tasks, quotas or event history', async () => {
    const before = await snapshot();
    for (const piece of collision) {
      const observed = await read(piece), canonical = `/${piece.domain === 'historia' ? 'historias' : 'publicaciones'}/${piece.id}`;
      for (const value of [true, false, 'true', null]) ok(await http(canonical, admin, 'PATCH', {
        expected_revision: observed.revision, metadata: { archivado_tablero: value } }), 400);
      ok(await http(canonical, admin, 'DELETE'), 410);
    }
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('paginated admin inventory includes every archived ID with closed DTO and exact total beyond end; GETs never mutate', async () => {
    for (const domain of ['historia', 'publicacion']) {
      const ids = [];
      for (let n = 0; n < 23; n++) ids.push((await seed(domain, { clientId: volumeClient.id, metadata: { archivado_tablero: n % 2 ? true : 'true' } })).id);
      const before = await snapshot();
      for (const token of [admin, otherAdmin]) {
        const collected = [];
        for (const offset of [0, 20, 999]) {
          const response = await http(`/editorial-archivo?dominio=${domain}&cliente_id=${volumeClient.id}&offset=${offset}`, token);
          const body = ok(response); assert.equal(response.cacheControl, 'no-store');
          keys(body, ['version', 'dominio', 'offset', 'limit', 'total', 'has_more', 'items']);
          assert.equal(body.version, 1); assert.equal(body.dominio, domain); assert.equal(body.offset, offset); assert.equal(body.limit, 20);
          assert.equal(body.total, 23); assert.equal(body.has_more, offset === 0);
          assert.deepEqual(body.items.map(row => row.id), ids.slice(offset, offset + 20));
          for (const item of body.items) { checkPiece(item, { domain, id: item.id }); assert.equal(item.archived, true); }
          if (offset < 999) collected.push(...body.items.map(row => row.id));
        }
        assert.deepEqual(collected, ids); assert.equal(new Set(collected).size, 23);
      }
      assert.deepEqual(await snapshot(), before);
    }
  });

  await t.test('strict inputs, stale CAS, key collisions and employee/anonymous denial leave all business rows unchanged', async () => {
    const piece = await seed('historia'), input = await intent(piece), before = await snapshot();
    for (const missing of [{ request_id: input.request_id }, { expected_revision: input.expected_revision }]) ok(await change(piece, 'archivar', missing), 428);
    for (const body of [{ ...input, request_id: 'bad' }, { ...input, expected_revision: '0' }, { ...input, expected_revision: -1 },
      { ...input, motivo: 3 }, { ...input, unexpected: true }]) ok(await change(piece, 'archivar', body), 400);
    ok(await change(piece, 'archivar', { ...input, expected_revision: 999 }), 409);
    for (const [token, status] of [[staff, 403], [null, 401]]) {
      for (const action of ['archivar', 'restaurar']) ok(await change(piece, action, input, token), status);
      const denied = ok(await http('/editorial-archivo?dominio=historia', token), status);
      assert.equal(Object.hasOwn(denied, 'items'), false); assert.equal(JSON.stringify(denied).includes(marker), false);
    }
    for (const query of ['', 'dominio=bad', 'dominio=historia&dominio=publicacion', 'dominio[]=historia',
      'dominio=historia&limit=0', 'dominio=historia&limit=51', 'dominio=historia&offset=01',
      'dominio=historia&offset=1000001', 'dominio=historia&extra=1']) ok(await http(`/editorial-archivo?${query}`, admin), 400);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('late archive event INSERT failure rolls back flag/revision; healthy SAME-key retry and immutable/restrictive SQL history work', async () => {
    const piece = await seed('publicacion'), input = await intent(piece);
    await f.query(`CREATE FUNCTION qa116_event_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'QA116 synthetic audit failure'; END $$`);
    await f.query('CREATE TRIGGER qa116_event_fault BEFORE INSERT ON editorial_archive_events FOR EACH ROW EXECUTE FUNCTION qa116_event_fault()');
    try { const before = await snapshot(); ok(await change(piece, 'archivar', input), 500); assert.deepEqual(await snapshot(), before); }
    finally { await f.query('DROP TRIGGER qa116_event_fault ON editorial_archive_events'); await f.query('DROP FUNCTION qa116_event_fault()'); }
    const saved = check(ok(await change(piece, 'archivar', input), 201), piece, 'archivar', false);
    const before = await snapshot(), db = await connect();
    try {
      await assert.rejects(db.query("UPDATE editorial_archive_events SET motivo='Rewrite forbidden' WHERE id=$1", [saved.operation.id]), error => error.code === '23514');
      await assert.rejects(db.query('DELETE FROM editorial_archive_events WHERE id=$1', [saved.operation.id]), error => error.code === '23514');
      await assert.rejects(db.query('DELETE FROM publicaciones WHERE id=$1', [piece.id]), error => error.code === '23503');
    } finally { await close(db); }
    assert.deepEqual(await snapshot(), before);
  });

  for (const domain of ['historia', 'publicacion']) await t.test(`${domain}: actual SQL piece writer advances064 while archive waits; post-wait revision mismatch409 never archives`, async () => {
    const piece = await seed(domain), input = await intent(piece), holder = await connect(), observer = await connect(); let pending;
    try {
      await holder.query('BEGIN'); await holder.query(`SELECT id FROM ${tableFor(domain)} WHERE id=$1 FOR UPDATE`, [piece.id]);
      await holder.query(`UPDATE ${tableFor(domain)} SET copy='QA116 concurrent content committed' WHERE id=$1`, [piece.id]);
      const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = change(piece, 'archivar', input); void pending.catch(() => {});
      await waitFor(observer, `SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'
        AND $1::int=ANY(pg_blocking_pids(pid)) AND query ILIKE $2 AND query ILIKE '%FOR UPDATE%'`, [pid, `%FROM ${tableFor(domain)}%`],
      'Actual archive request must wait on the concurrently edited piece');
      await holder.query('COMMIT'); const committed = await snapshot();
      ok(await pending, 409); assert.deepEqual(await snapshot(), committed);
      const current = await read(piece); assert.equal(current.copy, 'QA116 concurrent content committed'); assert.equal(current.revision, input.expected_revision + 1);
    } finally {
      await holder.query('ROLLBACK').catch(() => {}); if (pending) await Promise.allSettled([pending]);
      await close(observer); await close(holder);
    }
  });

  let sequence = 0;
  for (const action of ['archivar', 'restaurar']) for (const loss of [
    { name: 'epoch revocation', sql: 'UPDATE usuarios SET session_version=session_version+1 WHERE id=$1', status: 401 },
    { name: 'role downgrade', sql: "UPDATE usuarios SET rol='edicion' WHERE id=$1", status: 403 },
    { name: 'inactive actor', sql: 'UPDATE usuarios SET activo=false WHERE id=$1', status: 401 },
  ]) await t.test(`${action}: ${loss.name} during real account mutex wait denies before metadata/revision/event DML`, async () => {
    const id = 991180 + sequence++, usuario = `qa116_actor_${id}`;
    await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,'QA116 isolated owner','admin',password_hash,true,1 FROM usuarios WHERE id=91001`, [id, usuario]);
    const token = await login(usuario), piece = await seed('historia');
    if (action === 'restaurar') ok(await change(piece, 'archivar', await intent(piece)), 201);
    const input = await intent(piece), holder = await connect(), changer = await connect(); let pending;
    try {
      await holder.query('BEGIN'); await holder.query('SELECT pg_advisory_xact_lock(20261019,1)');
      const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = change(piece, action, input, token); void pending.catch(() => {});
      await waitFor(changer, `SELECT l.pid FROM pg_locks l WHERE l.locktype='advisory' AND l.classid=20261019::oid
        AND l.objid=1::oid AND l.objsubid=2 AND NOT l.granted AND $1::int=ANY(pg_blocking_pids(l.pid))`, [pid], 'Actual archive HTTP must await account mutex');
      await changer.query(loss.sql, [id]); const before = await snapshot();
      await holder.query('COMMIT'); ok(await pending, loss.status); assert.deepEqual(await snapshot(), before);
    } finally {
      await holder.query('ROLLBACK').catch(() => {}); if (pending) await Promise.allSettled([pending]);
      await close(changer); await close(holder);
    }
  });

  await t.test('actual calendar reconciliation preserves archived automatic row, real content and linked task; restored audited ID survives even zero quota', async () => {
    const period = '2026-11';
    const [calendarClient] = await f.query(`INSERT INTO clientes(nombre,activo,cuota_reels,cuota_carruseles)
      VALUES('QA116 protected calendar cohort',true,3,0) RETURNING id`);
    const rows = [];
    for (let ordinal = 1; ordinal <= 3; ordinal++) {
      const [row] = await f.query(`INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada,idea,copy,
        origen_calendario,calendario_clave,fecha_bloqueada,metadata)
        VALUES($1,'video','pendiente',$2,'',$3,'automatico',$4,false,'{}') RETURNING id`,
      [calendarClient.id, `2026-11-${String(ordinal * 5).padStart(2, '0')}`,
        ordinal === 2 ? 'QA116 real editorial content must not become an empty generated replacement' : '',
        `${period}:${calendarClient.id}:video:${ordinal}`]);
      rows.push(row.id);
    }
    const [task] = await f.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,publicacion_id,tipo_tarea,estado,propiedades_extra)
      VALUES('QA116 calendar-linked live work','Fixture',$1,$2,'edicion','en_progreso','{"workspace":"render_os"}') RETURNING id`,
    [calendarClient.id, rows[2]]);
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91003,'responsable')", [task.id]);
    const archivedPiece = { domain: 'publicacion', id: rows[0] };
    const archive = check(ok(await change(archivedPiece, 'archivar', await intent(archivedPiece)), 201), archivedPiece, 'archivar', false);
    const cohort = async () => ({
      pieces: await f.query('SELECT * FROM publicaciones WHERE cliente_id=$1 ORDER BY id', [calendarClient.id]),
      versions: await f.query("SELECT * FROM editorial_publicacion_versiones WHERE dominio='publicacion' AND pieza_id=ANY($1::int[]) ORDER BY pieza_id", [rows]),
    });
    const reconcile = async () => {
      const result = ok(await api('/calendario-editorial/generar', admin, 'POST', { periodo: period }));
      assert.equal(result.periodo, period);
      for (const key of ['creadas', 'actualizadas', 'eliminadas', 'preservadas']) assert.ok(Number.isSafeInteger(result[key]) && result[key] >= 0);
      return result;
    };
    const assertUnrelatedUnchanged = (before, after) => {
      // The canonical algorithm may generate/update EMPTY stubs for OTHER
      // fixture clients. It must not mutate other business tables or replace
      // any row in this protected three-ID cohort.
      for (const table of tables.filter(name => !['publicaciones', 'editorial_publicacion_versiones'].includes(name)))
        assert.deepEqual(after[table], before[table], table);
    };
    let before = await snapshot(), original = await cohort();
    await reconcile();
    assert.deepEqual(await cohort(), original, 'Archive/content/task protections retain exact IDs, dates, copy and revisions');
    assert.deepEqual((await cohort()).pieces.map(row => row.id), rows);
    assertUnrelatedUnchanged(before, await snapshot());
    const restored = check(ok(await change(archivedPiece, 'restaurar', {
      request_id: randomUUID(), expected_revision: archive.piece.revision,
    }), 201), archivedPiece, 'restaurar', false);
    assert.equal(restored.piece.archived, false);
    // Explicit synthetic quota change makes the empty restored automatic row
    // otherwise obsolete: only its genuine archive audit now protects it.
    await f.query('UPDATE clientes SET cuota_reels=0 WHERE id=$1', [calendarClient.id]);
    original = await cohort(); before = await snapshot();
    const empty = original.pieces.find(row => row.id === rows[0]);
    assert.equal(empty.estado, 'pendiente'); assert.equal(empty.origen_calendario, 'automatico');
    assert.equal(empty.copy, ''); assert.equal(empty.idea, ''); assert.equal(empty.fecha_bloqueada, false);
    for (let run = 0; run < 2; run++) {
      await reconcile();
      assert.deepEqual(await cohort(), original, 'Restored audit-protected ID cannot be deleted/recreated, rescheduled or revision-bumped');
      assertUnrelatedUnchanged(before, await snapshot());
    }
    assert.equal((await f.query('SELECT id FROM tareas WHERE publicacion_id=$1', [rows[2]])).length, 1);
    assert.equal((await f.query('SELECT id FROM cliente_objetivos_mensuales WHERE cliente_id=$1', [calendarClient.id])).length, 0);
    assert.equal((await f.query('SELECT id FROM editorial_archive_events WHERE publicacion_id=$1', [rows[0]])).length, 2);
  });

  for (const mutation of [
    { name: 'quota becomes zero', sql: 'UPDATE clientes SET cuota_reels=0 WHERE id=$1' },
    { name: 'client becomes inactive', sql: 'UPDATE clientes SET activo=false WHERE id=$1' },
  ]) await t.test(`calendar re-reads client after actual SHARE wait: ${mutation.name} creates no stale-cohort stubs`, async () => {
    const period = '2027-01';
    const [fresh] = await f.query(`INSERT INTO clientes(nombre,activo,cuota_reels,cuota_carruseles)
      VALUES($1,true,2,0) RETURNING id`, [`QA116 client wait ${mutation.name}`]);
    const holder = await connect(), observer = await connect(); let pending;
    try {
      await holder.query('BEGIN'); await holder.query('SELECT id FROM clientes WHERE id=$1 FOR UPDATE', [fresh.id]);
      const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const before = await snapshot();
      pending = http('/calendario-editorial/generar', admin, 'POST', { periodo: period }); void pending.catch(() => {});
      await waitFor(observer, `SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'
        AND $1::int=ANY(pg_blocking_pids(pid)) AND query ILIKE '%FROM clientes%' AND query ILIKE '%FOR SHARE%'`, [pid],
      'Principal calendar request must actually wait on selected client SHARE, after its initial client-cohort read');
      await holder.query(mutation.sql, [fresh.id]); await holder.query('COMMIT');
      const result = ok(await pending); assert.equal(result.periodo, period);
      assert.deepEqual(await f.query('SELECT id FROM publicaciones WHERE cliente_id=$1', [fresh.id]), []);
      assert.deepEqual(await f.query('SELECT id FROM tareas WHERE cliente_id=$1', [fresh.id]), []);
      assert.deepEqual(await f.query('SELECT id FROM cliente_objetivos_mensuales WHERE cliente_id=$1', [fresh.id]), []);
      const after = await snapshot();
      for (const table of tables.filter(name => !['clientes', 'publicaciones', 'editorial_publicacion_versiones'].includes(name)))
        assert.deepEqual(after[table], before[table], table);
      assert.deepEqual(after.clientes.filter(row => row.id !== fresh.id), before.clientes.filter(row => row.id !== fresh.id));
      const changed = after.clientes.find(row => row.id === fresh.id);
      if (mutation.name === 'quota becomes zero') assert.equal(changed.cuota_reels, 0);
      else assert.equal(changed.activo, false);
    } finally {
      await holder.query('ROLLBACK').catch(() => {}); if (pending) await Promise.allSettled([pending]);
      await close(observer); await close(holder);
    }
  });

  await t.test('calendar locks protected keys whose pieces moved outside the month; UPSERT preserves their actual dates/content/versions', async () => {
    const period = '2027-02';
    const [fresh] = await f.query(`INSERT INTO clientes(nombre,activo,cuota_reels,cuota_carruseles)
      VALUES('QA116 moved key cohort',true,3,0) RETURNING id`);
    const ids = [];
    for (let ordinal = 1; ordinal <= 3; ordinal++) {
      const [row] = await f.query(`INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada,idea,copy,
        origen_calendario,calendario_clave,fecha_bloqueada,metadata)
        VALUES($1,'video','pendiente',$2,'',$3,'automatico',$4,false,$5::jsonb) RETURNING id`,
      [fresh.id, `2027-03-${String(ordinal * 5).padStart(2, '0')}`, ordinal === 1 ? 'QA116 moved real content' : '',
        `${period}:${fresh.id}:video:${ordinal}`, JSON.stringify(ordinal === 2 ? { manual_context: 'QA116 preserved metadata' } : {})]);
      ids.push(row.id);
    }
    const [task] = await f.query(`INSERT INTO tareas(titulo,asignado_a,cliente_id,publicacion_id,tipo_tarea,estado,propiedades_extra)
      VALUES('QA116 moved linked work','Fixture',$1,$2,'edicion','en_progreso','{"workspace":"render_os"}') RETURNING id`, [fresh.id, ids[2]]);
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91003,'responsable')", [task.id]);
    const holder = await connect(), observer = await connect(); let pending;
    try {
      await holder.query('BEGIN'); await holder.query('SELECT id FROM publicaciones WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE', [ids]);
      const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid, before = await snapshot();
      pending = http('/calendario-editorial/generar', admin, 'POST', { periodo: period }); void pending.catch(() => {});
      await waitFor(observer, `SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'
        AND $1::int=ANY(pg_blocking_pids(pid)) AND query ILIKE '%SELECT id FROM publicaciones%'
        AND query ILIKE '%calendario_clave%' AND query ILIKE '%FOR UPDATE%'`, [pid],
      'Calendar must lock the period KEY cohort before UPSERT, not merely block later on a conflicting INSERT');
      await holder.query('COMMIT'); const result = ok(await pending); assert.equal(result.periodo, period);
      const after = await snapshot();
      assert.deepEqual(after.publicaciones.filter(row => row.cliente_id === fresh.id), before.publicaciones.filter(row => row.cliente_id === fresh.id));
      assert.deepEqual(after.publicaciones.filter(row => row.cliente_id === fresh.id).map(row => row.id).sort((a, b) => a - b), ids);
      assert.deepEqual(after.editorial_publicacion_versiones.filter(row => row.dominio === 'publicacion' && ids.includes(row.pieza_id)),
        before.editorial_publicacion_versiones.filter(row => row.dominio === 'publicacion' && ids.includes(row.pieza_id)));
      for (const table of tables.filter(name => !['publicaciones', 'editorial_publicacion_versiones'].includes(name)))
        assert.deepEqual(after[table], before[table], table);
    } finally {
      await holder.query('ROLLBACK').catch(() => {}); if (pending) await Promise.allSettled([pending]);
      await close(observer); await close(holder);
    }
  });
});
