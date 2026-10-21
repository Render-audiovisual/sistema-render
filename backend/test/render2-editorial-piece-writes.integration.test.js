import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

test('editorial piece writes: explicit legacy domain, one shared revision, current authority and preserved publication evidence', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const f = await startLocalHarness({ port: 55758 });
  const connections = new Set();
  t.after(async () => {
    for (const db of connections) { await db.query('ROLLBACK').catch(() => {}); await db.end(); }
    await f.cleanup(); await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`QA114 cleanup ENOENT: ${f.root}; PostgreSQL port55758`);
  });
  const url = 'postgresql://render2_fixture@127.0.0.1:55758/render2_local_test';
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55758, url, identity });
  const connect = async () => {
    const db = new pg.Client({ connectionString: url, application_name: 'qa114-own-piece-barrier', statement_timeout: 15000 });
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
  const ok = (response, status = 200) => { assert.equal(response.status, status, 'Unexpected principal HTTP status'); return response.body; };
  const login = async usuario => ok(await api('/login', null, 'POST', { usuario, password: fixturePassword })).token;
  const admin = await login('qa_franco'), secondAdmin = await login('qa_agustin'), staff = await login('qa_luciano');
  await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
    SELECT 991140,'qa114_unknown','QA114 unknown','qa_unknown',password_hash,true,1 FROM usuarios WHERE id=91004`);
  const unknown = await login('qa114_unknown');
  const clients = await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA114 story account',true),('QA114 publication account',true) RETURNING id,nombre");
  const marker = 'QA114_PRIVATE_FINANCE_CANARY', amount = 817293.46, collision = 997214;
  const tablesByDomain = { historia: 'historias', publicacion: 'publicaciones' };
  const seed = async (domain, id, state = 'lista') => {
    await f.query(`INSERT INTO ${tablesByDomain[domain]}(id,cliente_id,${domain === 'publicacion' ? 'tipo,' : ''}estado,
      fecha_programada,idea,copy,material_referencia,aclaraciones,metadata)
      VALUES($1,$2,${domain === 'publicacion' ? "'video'," : ''}$3,'2026-10-22',$4,'Original copy','Original material','Original notes',$5::jsonb)`,
    [id, clients[domain === 'historia' ? 0 : 1].id, state, `QA114 ${domain} identity`, JSON.stringify({ private_finance: { marker, amount } })]);
    return { domain, id };
  };
  const pieces = [await seed('historia', collision), await seed('publicacion', collision)];
  const unique = [await seed('historia', collision + 1), await seed('publicacion', collision + 2)];
  const legacy = piece => `/piezas/${piece.id}?dominio=${piece.domain}`;
  const canonical = piece => `/${piece.domain === 'historia' ? 'historias' : 'publicaciones'}/${piece.id}`;
  const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
  const legacyKeys = ['origen', 'id', 'tipo', 'estado', 'cliente_id', 'cliente_nombre', 'responsable', 'fecha_programada',
    'idea', 'copy', 'material_referencia', 'aclaraciones', 'prioridad', 'created_at', 'updated_at', 'revision', 'publicacion_evidencia'];
  const read = async (piece, token = admin) => {
    const response = await http(legacy(piece), token), row = ok(response);
    assert.equal(response.cacheControl, 'no-store'); keys(row, legacyKeys);
    assert.equal(row.id, piece.id); assert.equal(row.origen, piece.domain);
    assert.ok(Number.isSafeInteger(row.revision) && row.revision >= 0);
    keys(row.publicacion_evidencia, ['classification', 'revision', 'confirmation']);
    assert.equal(row.revision, row.publicacion_evidencia.revision);
    assert.equal(JSON.stringify(row).includes(marker), false); assert.equal(JSON.stringify(row).includes(String(amount)), false);
    return row;
  };
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  const snapshot = async () => {
    const result = {};
    for (const table of tables) {
      assert.match(table, /^[a-zA-Z_][a-zA-Z_0-9]*$/);
      result[table] = await f.query(`SELECT * FROM "${table}" t ORDER BY to_jsonb(t)::text`);
    }
    return result;
  };
  // Approved linked work must not be silently finalized by ordinary piece edits.
  for (const piece of pieces) await f.query(`INSERT INTO tareas(titulo,asignado_a,tipo_tarea,estado,cliente_id,
    ${piece.domain === 'historia' ? 'historia_id' : 'publicacion_id'},propiedades_extra)
    VALUES('QA114 preserved approved work','Fixture','edicion','aprobada',$1,$2,
      '{"workspace":"render_os","origen_pieza":true}')`, [clients[piece.domain === 'historia' ? 0 : 1].id, piece.id]);

  await t.test('colliding domains never silently choose publication; unique fallback and explicit selection retain closed shared reads including unknown roles', async () => {
    const before = await snapshot();
    for (const token of [admin, staff, unknown]) {
      ok(await http(`/piezas/${collision}`, token), 409);
      for (const piece of pieces) {
        const row = await read(piece, token); assert.equal(row.idea, `QA114 ${piece.domain} identity`);
        assert.equal(row.cliente_id, clients[piece.domain === 'historia' ? 0 : 1].id); assert.equal(row.revision, 0);
      }
      for (const piece of unique) {
        const response = await http(`/piezas/${piece.id}`, token); assert.equal(response.cacheControl, 'no-store');
        const row = ok(response); keys(row, legacyKeys); assert.equal(row.origen, piece.domain); assert.equal(row.id, piece.id);
      }
    }
    for (const query of ['dominio=no', 'dominio=historia&dominio=publicacion', 'dominio[]=historia', 'dominio=historia&extra=1'])
      ok(await http(`/piezas/${collision}?${query}`, admin), 400);
    for (const id of ['0', '-1', '01', '2147483648', 'bad']) ok(await http(`/piezas/${id}?dominio=historia`, admin), 400);
    ok(await http('/piezas/2147483647?dominio=historia', admin), 404);
    ok(await http(legacy(pieces[0]), null), 401);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('legacy domain is mandatory for writes; all three route forms require typed observed revision and deny untrusted fields', async () => {
    const before = await snapshot();
    ok(await http(`/piezas/${collision}`, admin, 'PATCH', { expected_revision: 0, copy: 'Wrong fallback' }), 428);
    for (const route of [legacy(pieces[0]), canonical(pieces[0]), canonical(pieces[1])]) {
      ok(await http(route, admin, 'PATCH', { copy: 'Missing revision' }), 428);
      for (const expected_revision of [null, '0', -1, 0.5, {}, 9007199254740992])
        ok(await http(route, admin, 'PATCH', { expected_revision, copy: 'Invalid revision' }), 400);
      for (const body of [{ expected_revision: 0, copy: {} }, { expected_revision: 0, idea: [] },
        { expected_revision: 0, unexpected: true }, { expected_revision: 0, prioridad: 'critical' }])
        ok(await http(route, admin, 'PATCH', body), 400);
      ok(await http(route, staff, 'PATCH', { expected_revision: 0, copy: 'Denied' }), 403);
      ok(await http(route, null, 'PATCH', { expected_revision: 0, copy: 'Denied' }), 401);
    }
    for (const piece of pieces) {
      ok(await http(canonical(piece), admin, 'PATCH', { expected_revision: 0, fecha_programada: '2026-02-30' }), 400);
      ok(await http(canonical(piece), admin, 'PATCH', { expected_revision: 0, metadata: [] }), 400);
    }
    for (const value of ['1', -1, 1.5]) ok(await http(canonical(pieces[1]), admin, 'PATCH', { expected_revision: 0, num_imagenes: value }), 400);
    assert.deepEqual(await snapshot(), before);
  });

  for (const piece of pieces) await t.test(`${piece.domain}: legacy/canonical writers share exact CAS, clear text and cannot edit the same-ID other domain`, async () => {
    const observed = await read(piece), other = pieces.find(item => item.domain !== piece.domain);
    const otherBefore = await f.query(`SELECT * FROM ${tablesByDomain[other.domain]} WHERE id=$1`, [other.id]);
    const before = await snapshot();
    const results = await Promise.all([http(legacy(piece), admin, 'PATCH', { expected_revision: observed.revision, copy: 'QA114 winner legacy' }),
      http(canonical(piece), secondAdmin, 'PATCH', { expected_revision: observed.revision, copy: 'QA114 winner canonical' })]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const winner = results.find(result => result.status === 200).body;
    assert.equal(winner.revision, observed.revision + 1); assert.equal(winner.publicacion_evidencia.revision, winner.revision);
    assert.equal((await read(piece)).copy, winner.copy);
    assert.deepEqual(await f.query(`SELECT * FROM ${tablesByDomain[other.domain]} WHERE id=$1`, [other.id]), otherBefore);
    const after = await snapshot();
    for (const table of ['tareas', 'tarea_asignaciones', 'cliente_objetivo_piezas', 'cliente_objetivo_eventos', 'editorial_publicacion_eventos'])
      assert.deepEqual(after[table], before[table], table);
    const current = await read(piece);
    const saved = ok(await http(canonical(piece), admin, 'PATCH', { expected_revision: current.revision, fecha_programada: '2026-10-24',
      idea: '', copy: '', material_referencia: '', aclaraciones: '', ...(piece.domain === 'historia' ? { notas_planificacion: '' } : { num_imagenes: 0, duracion_segundos: 0 }) }));
    assert.equal(saved.revision, current.revision + 1); assert.equal(saved.fecha_programada, '2026-10-24');
    for (const field of ['idea', 'copy', 'material_referencia', 'aclaraciones']) assert.equal(saved[field], '');
    const nullOmission = ok(await http(canonical(piece), admin, 'PATCH', { expected_revision: saved.revision, copy: null, idea: 'QA114 explicit new idea' }));
    assert.equal(nullOmission.copy, ''); assert.equal(nullOmission.idea, 'QA114 explicit new idea');
    const stable = await snapshot();
    ok(await http(legacy(piece), admin, 'PATCH', { expected_revision: current.revision, copy: 'Stale overwrite' }), 409);
    assert.deepEqual(await snapshot(), stable);
    assert.equal((await read(piece, staff)).idea, 'QA114 explicit new idea');
  });

  await t.test('ordinary writes and creation cannot publish/finalize work; already-published content edits retain exact real confirmation', async () => {
    const before = await snapshot();
    for (const piece of pieces) {
      const current = await read(piece);
      for (const route of [legacy(piece), canonical(piece)])
        ok(await http(route, admin, 'PATCH', { expected_revision: current.revision, estado: 'publicada' }), 409);
      ok(await api('/piezas', admin, 'POST', { request_id: randomUUID(), tipo: piece.domain === 'historia' ? 'historia' : 'video',
        cliente_id: clients[0].id, responsable_id: 91004, fecha_programada: '2026-10-24', estado: 'publicada', idea: 'Must not publish' }), 409);
    }
    assert.deepEqual(await snapshot(), before);
    const [clock] = await f.query(`SELECT to_char((statement_timestamp()-interval '1 minute') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS past`);
    for (const piece of pieces) {
      const status = ok(await api(`/editorial-publicacion/${piece.domain}/${piece.id}`, admin));
      ok(await api(`/editorial-publicacion/${piece.domain}/${piece.id}/confirmar`, admin, 'POST', {
        request_id: randomUUID(), expected_revision: status.piece.revision, occurred_at: clock.past }), 201);
      const confirmed = await read(piece); assert.equal(confirmed.publicacion_evidencia.classification, 'confirmada_manualmente');
      const snapshotBeforeContent = await snapshot();
      const stored = snapshotBeforeContent[tablesByDomain[piece.domain]].find(row => row.id === piece.id);
      const saved = ok(await http(canonical(piece), admin, 'PATCH', { expected_revision: confirmed.revision, copy: 'QA114 content only after publication' }));
      assert.equal(saved.estado, 'publicada'); assert.equal(saved.publicacion_evidencia.classification, 'confirmada_manualmente');
      assert.deepEqual(saved.publicacion_evidencia.confirmation, confirmed.publicacion_evidencia.confirmation);
      const after = await snapshot();
      assert.equal(after[tablesByDomain[piece.domain]].find(row => row.id === piece.id)['fecha_publicación_real'], stored['fecha_publicación_real']);
      assert.deepEqual(after.editorial_publicacion_eventos, snapshotBeforeContent.editorial_publicacion_eventos);
      assert.deepEqual(after.tareas, snapshotBeforeContent.tareas);
      const current = await read(piece), stable = await snapshot();
      for (const state of ['lista', 'publicada']) ok(await http(legacy(piece), admin, 'PATCH', { expected_revision: current.revision, estado: state }), 409);
      assert.deepEqual(await snapshot(), stable);
    }
  });

  await t.test('successful ordinary creation returns annotated revision0; historical published content does not gain confirmation', async () => {
    const created = ok(await api('/piezas', admin, 'POST', { request_id: randomUUID(), tipo: 'historia', cliente_id: clients[0].id,
      responsable_id: 91004, fecha_programada: '2026-10-24', estado: 'pendiente', idea: 'QA114 actual creation' }), 201);
    assert.equal(created.publicacion_evidencia.revision, 0); assert.equal(created.publicacion_evidencia.classification, 'no_publicada');
    const historical = await seed('historia', collision + 3, 'publicada'), current = await read(historical);
    assert.equal(current.publicacion_evidencia.classification, 'historica_sin_confirmacion');
    const saved = ok(await http(canonical(historical), admin, 'PATCH', { expected_revision: current.revision, copy: 'QA114 retain historical truth' }));
    assert.equal(saved.publicacion_evidencia.classification, 'historica_sin_confirmacion'); assert.equal(saved.publicacion_evidencia.confirmation, null);
  });

  for (const piece of unique) await t.test(`${piece.domain}: late SQL failure rolls back content and trigger064 revision, preserving linked business history`, async () => {
    const current = await read(piece), input = { expected_revision: current.revision, copy: 'QA114 healthy exact retry' };
    await f.query(`CREATE FUNCTION qa114_piece_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.id=${piece.id} THEN RAISE EXCEPTION 'QA114 synthetic piece failure'; END IF; RETURN NEW; END $$`);
    await f.query(`CREATE TRIGGER qa114_piece_fault AFTER UPDATE ON ${tablesByDomain[piece.domain]} FOR EACH ROW EXECUTE FUNCTION qa114_piece_fault()`);
    try { const before = await snapshot(); ok(await http(canonical(piece), admin, 'PATCH', input), 500); assert.deepEqual(await snapshot(), before); }
    finally {
      await f.query(`DROP TRIGGER qa114_piece_fault ON ${tablesByDomain[piece.domain]}`); await f.query('DROP FUNCTION qa114_piece_fault()');
    }
    const saved = ok(await http(canonical(piece), admin, 'PATCH', input)); assert.equal(saved.revision, current.revision + 1);
    assert.equal(saved.copy, input.copy);
  });

  let sequence = 0;
  for (const route of [legacy(unique[1]), canonical(unique[0]), canonical(unique[1])]) for (const loss of [
    { name: 'epoch revocation', sql: 'UPDATE usuarios SET session_version=session_version+1 WHERE id=$1', status: 401 },
    { name: 'role downgrade', sql: "UPDATE usuarios SET rol='edicion' WHERE id=$1", status: 403 },
    { name: 'inactive identity', sql: 'UPDATE usuarios SET activo=false WHERE id=$1', status: 401 },
  ]) await t.test(`${route}: ${loss.name} committed during real account mutex wait prevents content/revision writes`, async () => {
    const id = 991141 + sequence++, usuario = `qa114_actor_${id}`;
    await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,'QA114 isolated admin','admin',password_hash,true,1 FROM usuarios WHERE id=91001`, [id, usuario]);
    const token = await login(usuario), piece = route.includes('/historias/') ? unique[0] : unique[1];
    const input = { expected_revision: (await read(piece, token)).revision, copy: 'QA114 forbidden late write' };
    const holder = await connect(), changer = await connect(); let pending;
    try {
      await holder.query('BEGIN'); await holder.query('SELECT pg_advisory_xact_lock(20261019,1)');
      const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = http(route, token, 'PATCH', input); void pending.catch(() => {});
      const deadline = Date.now() + 5000; let waiting = false;
      while (Date.now() < deadline) {
        const { rows } = await changer.query(`SELECT l.pid FROM pg_locks l WHERE l.locktype='advisory'
          AND l.classid=20261019::oid AND l.objid=1::oid AND l.objsubid=2 AND NOT l.granted
          AND $1::int=ANY(pg_blocking_pids(l.pid))`, [pid]);
        if (rows.length) { waiting = true; break; } await new Promise(resolve => setTimeout(resolve, 15));
      }
      assert.equal(waiting, true, 'Actual HTTP must wait on account mutex before actor SHARE');
      await changer.query(loss.sql, [id]); const before = await snapshot();
      await holder.query('COMMIT'); ok(await pending, loss.status); assert.deepEqual(await snapshot(), before);
    } finally {
      await holder.query('ROLLBACK').catch(() => {}); if (pending) await Promise.allSettled([pending]);
      await close(changer); await close(holder);
    }
  });
});
