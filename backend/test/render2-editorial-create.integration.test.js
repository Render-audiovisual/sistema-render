import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import pg from 'pg';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

test('editorial creation receipts: one piece/task per captured ID intent, current replay and atomic authority', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const f = await startLocalHarness({ port: 55760 });
  const connections = new Set();
  t.after(async () => {
    for (const db of connections) { await db.query('ROLLBACK').catch(() => {}); await db.end(); }
    await f.cleanup(); await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`QA115 cleanup ENOENT: ${f.root}; PostgreSQL port55760`);
  });
  const url = 'postgresql://render2_fixture@127.0.0.1:55760/render2_local_test';
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55760, url, identity });
  const connect = async () => {
    const db = new pg.Client({ connectionString: url, application_name: 'qa115-own-create-barrier', statement_timeout: 15000 });
    connections.add(db); await db.connect(); return db;
  };
  const close = async db => { await db.query('ROLLBACK').catch(() => {}); await db.end(); connections.delete(db); };
  const api = (path, token, method = 'GET', body) => request(f.base, `/api${path}`, { token, method, body });
  const http = async (token, body) => {
    const response = await fetch(new URL('/api/editorial-creaciones', f.base), { method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const ok = (result, status = 200) => { assert.equal(result.status, status, 'Unexpected principal HTTP status'); return result.body; };
  const login = async usuario => ok(await api('/login', null, 'POST', { usuario, password: fixturePassword })).token;
  const admin = await login('qa_franco'), otherAdmin = await login('qa_agustin'), employee = await login('qa_luciano');
  const [client] = await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA115 editorial account',true) RETURNING id");
  const [otherClient] = await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA115 other account',true) RETURNING id");
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  const snapshot = async () => {
    const result = {};
    for (const table of tables) {
      assert.match(table, /^[a-zA-Z_][a-zA-Z_0-9]*$/);
      result[table] = await f.query(`SELECT * FROM "${table}" t ORDER BY to_jsonb(t)::text`);
    }
    return result;
  };
  const payload = (extra = {}) => ({ request_id: randomUUID(), tipo: 'historia', cliente_id: client.id,
    responsable_id: 91004, fecha_programada: '2026-10-24', idea: 'QA115 original idea', copy: 'QA115 original copy', ...extra });
  const domainFor = input => input.tipo === 'historia' ? 'historia' : 'publicacion';
  const tableFor = domain => domain === 'historia' ? 'historias' : 'publicaciones';
  const get = (piece, token = admin) => api(`/piezas/${piece.id}?dominio=${piece.origen}`, token).then(response => ok(response));
  const check = (row, input, replayed) => {
    assert.ok(Number.isSafeInteger(row.id) && row.id > 0); assert.equal(row.origen, domainFor(input));
    assert.deepEqual(Object.keys(row.creation).sort(), ['request_id', 'dominio', 'pieza_id', 'tarea_id', 'replayed'].sort());
    assert.equal(row.creation.request_id, input.request_id.toLowerCase()); assert.equal(row.creation.dominio, domainFor(input));
    assert.equal(row.creation.pieza_id, row.id); assert.equal(row.creation.replayed, replayed);
    assert.ok(Number.isSafeInteger(row.creation.tarea_id) && row.creation.tarea_id > 0);
    assert.ok(Number.isSafeInteger(row.publicacion_evidencia.revision) && row.publicacion_evidencia.revision >= 0);
    for (const field of ['payload_hash', 'actor_user_id', 'password_hash', 'token']) assert.equal(Object.hasOwn(row, field), false);
    return row;
  };
  const assertOne = async (piece, input, actorId = 91001) => {
    const link = piece.origen === 'historia' ? 'historia_id' : 'publicacion_id';
    const rows = await f.query(`SELECT id,tipo_tarea,estado,cliente_id FROM tareas WHERE ${link}=$1`, [piece.id]);
    assert.equal(rows.length, 1); assert.equal(rows[0].id, piece.creation.tarea_id);
    assert.equal(rows[0].cliente_id, input.cliente_id); assert.equal(rows[0].tipo_tarea, input.tipo === 'video' ? 'administracion' : 'diseno');
    assert.equal(rows[0].estado, 'pendiente');
    assert.deepEqual(await f.query('SELECT usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1', [rows[0].id]),
      [{ usuario_id: input.responsable_id, tipo: 'responsable' }]);
    const receipts = await f.query(`SELECT actor_user_id,request_id,dominio,pieza_id,tarea_id,payload_hash
      FROM editorial_create_receipts WHERE actor_user_id=$1 AND request_id=$2`, [actorId, input.request_id.toLowerCase()]);
    assert.equal(receipts.length, 1); assert.equal(receipts[0].dominio, piece.origen); assert.equal(receipts[0].pieza_id, piece.id);
    assert.equal(receipts[0].tarea_id, rows[0].id); assert.match(receipts[0].payload_hash, /^[0-9a-f]{64}$/);
  };
  const created = [];

  await t.test('historical and dedicated routes share the same receipt, never two implementations', async () => {
    const input=payload();
    const first=check(ok(await api('/piezas',admin,'POST',input),201),input,false);
    const recovered=check(ok(await http(admin,input)),input,true);
    assert.equal(recovered.id,first.id);assert.equal(recovered.creation.tarea_id,first.creation.tarea_id);
    await assertOne(recovered,input);
  });

  await t.test('all three actual creation kinds make one piece, one ID-assigned task and one receipt without publishing', async () => {
    for (const tipo of ['historia', 'carrusel', 'video']) {
      const input = payload({ tipo, responsable: 'Forged display label does not grant authority' }), before = await snapshot();
      const row = check(ok(await http(admin, input), 201), input, false); created.push({ input, row });
      assert.equal(row.publicacion_evidencia.revision, 0); assert.equal(row.publicacion_evidencia.classification, 'no_publicada');
      assert.equal(row.fecha_publicación_real, null); assert.equal(row.estado, 'pendiente');
      assert.equal(row.responsable, (await f.query('SELECT nombre FROM usuarios WHERE id=91004'))[0].nombre);
      await assertOne(row, input);
      const after = await snapshot();
      for (const table of tables.filter(name => ![tableFor(row.origen), 'tareas', 'tarea_asignaciones', 'editorial_create_receipts'].includes(name)))
        assert.deepEqual(after[table], before[table], table);
      assert.equal(after[tableFor(row.origen)].length, before[tableFor(row.origen)].length + 1);
      assert.equal(after.tareas.length, before.tareas.length + 1); assert.equal(after.editorial_create_receipts.length, before.editorial_create_receipts.length + 1);
      assert.equal(ok(await api(`/tareas/${row.creation.tarea_id}?workspace=render_os`, employee)).id, row.creation.tarea_id);
    }
  });

  await t.test('parallel identical intent creates once; unobserved genuine ACK recovers same task, not a new request', async () => {
    const input = payload(), before = await snapshot();
    const results = await Promise.all([http(admin, input), http(admin, input)]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 201]);
    const row = check(results.find(result => result.status === 201).body, input, false);
    const replay = check(results.find(result => result.status === 200).body, input, true);
    assert.equal(replay.id, row.id); assert.equal(replay.creation.tarea_id, row.creation.tarea_id); await assertOne(row, input);
    const after = await snapshot(); assert.equal(after.tareas.length, before.tareas.length + 1);
    const lost = payload({ tipo: 'video' });
    const committed = check(ok(await http(admin, lost), 201), lost, false);
    // Deliberately discard caller observation of a genuine committed HTTP ACK;
    // this is not a TCP-disconnect/native-browser or external publishing claim.
    const stable = await snapshot(), recovered = check(ok(await http(admin, lost)), lost, true);
    assert.equal(recovered.id, committed.id); assert.equal(recovered.creation.tarea_id, committed.creation.tarea_id);
    assert.deepEqual(await snapshot(), stable); await assertOne(recovered, lost);
  });

  await t.test('canonical defaults/UUID case/labels preserve hash; changed business intent conflicts and actors have independent UUID namespaces', async () => {
    const { input, row } = created[0], before = await snapshot();
    const replay = check(ok(await http(admin, { ...input, request_id: input.request_id.toUpperCase(), responsable: 'Another ignored label',
      estado: 'pendiente', prioridad: 'media', material_referencia: '', aclaraciones: '' })), input, true);
    assert.equal(replay.id, row.id); assert.deepEqual(await snapshot(), before);
    for (const change of [{ copy: 'Changed text' }, { cliente_id: otherClient.id }, { responsable_id: 91003 },
      { tipo: 'video' }, { fecha_programada: '2026-10-25' }, { prioridad: 'alta' }]) {
      ok(await http(admin, { ...input, ...change }), 409); assert.deepEqual(await snapshot(), before);
    }
    const other = check(ok(await http(otherAdmin, input), 201), input, false);
    assert.notEqual(other.id, row.id); assert.notEqual(other.creation.tarea_id, row.creation.tarea_id); await assertOne(other, input, 91002);
  });

  await t.test('replay returns current edited piece and remains read-only after responsible rename or deactivation', async () => {
    const { input, row } = created[1], observed = await get(row);
    const saved = ok(await api(`/publicaciones/${row.id}`, admin, 'PATCH', { expected_revision: observed.revision, copy: 'QA115 current saved copy' }));
    await f.query("UPDATE usuarios SET nombre='QA115 renamed responsible' WHERE id=91004");
    let before = await snapshot();
    let replay = check(ok(await http(admin, input)), input, true);
    assert.equal(replay.copy, saved.copy); assert.equal(replay.publicacion_evidencia.revision, saved.publicacion_evidencia.revision);
    assert.equal(replay.creation.tarea_id, row.creation.tarea_id); assert.deepEqual(await snapshot(), before);
    await f.query('UPDATE usuarios SET activo=false WHERE id=91004');
    try {
      before = await snapshot(); replay = check(ok(await http(admin, input)), input, true);
      assert.equal(replay.id, row.id); assert.deepEqual(await snapshot(), before);
      ok(await http(admin, payload()), 400); assert.deepEqual(await snapshot(), before);
    } finally { await f.query('UPDATE usuarios SET activo=true WHERE id=91004'); }
  });

  await t.test('deleted piece/task tombstones never recreate business rows; receipts remain immutable', async () => {
    for (const deleted of ['piece', 'task']) {
      const input = payload({ tipo: 'video' }), row = check(ok(await http(admin, input), 201), input, false);
      // Fixture-only deletions exercise the deliberate absence of business FKs;
      // no production retention/deletion workflow is authorized by this test.
      await f.query(deleted === 'piece' ? 'DELETE FROM publicaciones WHERE id=$1' : 'DELETE FROM tareas WHERE id=$1',
        [deleted === 'piece' ? row.id : row.creation.tarea_id]);
      const before = await snapshot(); ok(await http(admin, input), 409); assert.deepEqual(await snapshot(), before);
      assert.equal((await f.query('SELECT pieza_id FROM editorial_create_receipts WHERE actor_user_id=91001 AND request_id=$1', [input.request_id])).length, 1);
    }
    const db = await connect(), before = await snapshot();
    try {
      const key = created[0].input.request_id;
      await assert.rejects(db.query("UPDATE editorial_create_receipts SET payload_hash=repeat('0',64) WHERE actor_user_id=91001 AND request_id=$1", [key]), error => error.code === '23514');
      await assert.rejects(db.query('DELETE FROM editorial_create_receipts WHERE actor_user_id=91001 AND request_id=$1', [key]), error => error.code === '23514');
    } finally { await close(db); }
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('mandatory UUID/recipient IDs, closed typed content, publication denial and unavailable client reject before business writes', async () => {
    const valid = payload(), { request_id, ...missing } = valid, before = await snapshot();
    ok(await http(admin, missing), 428);
    for (const change of [{ request_id: 'bad' }, { request_id: null }, { responsable_id: '91004' }, { responsable_id: 0 },
      { cliente_id: '1' }, { fecha_programada: '2026-02-30' }, { tipo: 'flyer' }, { idea: {} }, { copy: [] },
      { responsable: {} }, { estado: 'bogus' }, { metadata: {} }]) ok(await http(admin, { ...valid, ...change }), 400);
    const { responsable_id, ...labelOnly } = valid;
    ok(await http(admin, { ...labelOnly, responsable: 'QA115 renamed responsible' }), 400);
    ok(await http(admin, { ...valid, estado: 'publicada' }), 409);
    ok(await http(employee, valid), 403); ok(await http(null, valid), 401);
    assert.deepEqual(await snapshot(), before);
    const [inactive] = await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA115 unavailable client',false) RETURNING id");
    const afterSeed = await snapshot(); ok(await http(admin, { ...valid, cliente_id: inactive.id }), 409);
    ok(await http(admin, { ...valid, cliente_id: 2147483647 }), 409); assert.deepEqual(await snapshot(), afterSeed);
  });

  for (const target of [
    { name: 'selected responsible', table: 'usuarios', id: 91004, status: 400 },
    { name: 'selected client', table: 'clientes', id: client.id, status: 409 },
  ]) await t.test(`${target.name} deactivated during actual row wait cannot leave a new piece, task or receipt`, async () => {
    const input = payload(), holder = await connect(), observer = await connect(); let pending;
    try {
      await holder.query('BEGIN'); await holder.query(`SELECT id FROM ${target.table} WHERE id=$1 FOR UPDATE`, [target.id]);
      const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = http(admin, input); void pending.catch(() => {});
      const deadline = Date.now() + 5000; let waiting = false;
      while (Date.now() < deadline) {
        const { rows } = await observer.query(`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
          AND wait_event_type='Lock' AND $1::int=ANY(pg_blocking_pids(pid))
          AND query ILIKE $2 AND query ILIKE '%FOR SHARE%'`, [pid, `%FROM ${target.table}%`]);
        if (rows.length) { waiting = true; break; } await new Promise(resolve => setTimeout(resolve, 15));
      }
      assert.equal(waiting, true, 'Actual HTTP must wait on the selected recipient/client row before inserting business data');
      await holder.query(`UPDATE ${target.table} SET activo=false WHERE id=$1`, [target.id]); await holder.query('COMMIT');
      const before = await snapshot(); ok(await pending, target.status); assert.deepEqual(await snapshot(), before);
    } finally {
      await holder.query('ROLLBACK').catch(() => {}); if (pending) await Promise.allSettled([pending]);
      await close(observer); await close(holder);
      await f.query(`UPDATE ${target.table} SET activo=true WHERE id=$1`, [target.id]);
    }
  });

  for (const table of ['tareas', 'tarea_asignaciones', 'editorial_create_receipts']) await t.test(`${table} INSERT failure rolls back piece/task/bindings/receipt; SAME-key healthy retry creates exactly once`, async () => {
    const input = payload({ tipo: table === 'tareas' ? 'historia' : 'video' });
    await f.query(`CREATE FUNCTION qa115_insert_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'QA115 synthetic insert failure'; END $$`);
    await f.query(`CREATE TRIGGER qa115_insert_fault BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION qa115_insert_fault()`);
    try { const before = await snapshot(); ok(await http(admin, input), 500); assert.deepEqual(await snapshot(), before); }
    finally { await f.query(`DROP TRIGGER qa115_insert_fault ON ${table}`); await f.query('DROP FUNCTION qa115_insert_fault()'); }
    const row = check(ok(await http(admin, input), 201), input, false); await assertOne(row, input);
    const stable = await snapshot(); check(ok(await http(admin, input)), input, true); assert.deepEqual(await snapshot(), stable);
  });

  let sequence = 0;
  for (const replay of [false, true]) for (const loss of [
    { name: 'epoch revocation', sql: 'UPDATE usuarios SET session_version=session_version+1 WHERE id=$1', status: 401 },
    { name: 'role downgrade', sql: "UPDATE usuarios SET rol='edicion' WHERE id=$1", status: 403 },
    { name: 'inactive actor', sql: 'UPDATE usuarios SET activo=false WHERE id=$1', status: 401 },
  ]) await t.test(`${replay ? 'receipt replay' : 'new creation'}: ${loss.name} during actual account-mutex wait prevents every business write`, async () => {
    const id = 991160 + sequence++, usuario = `qa115_actor_${id}`;
    await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,'QA115 isolated owner','admin',password_hash,true,1 FROM usuarios WHERE id=91001`, [id, usuario]);
    const token = await login(usuario), input = payload();
    if (replay) check(ok(await http(token, input), 201), input, false);
    const holder = await connect(), changer = await connect(); let pending;
    try {
      await holder.query('BEGIN'); await holder.query('SELECT pg_advisory_xact_lock(20261019,1)');
      const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = http(token, input); void pending.catch(() => {});
      const deadline = Date.now() + 5000; let waiting = false;
      while (Date.now() < deadline) {
        const { rows } = await changer.query(`SELECT l.pid FROM pg_locks l WHERE l.locktype='advisory'
          AND l.classid=20261019::oid AND l.objid=1::oid AND l.objsubid=2 AND NOT l.granted
          AND $1::int=ANY(pg_blocking_pids(l.pid))`, [pid]);
        if (rows.length) { waiting = true; break; } await new Promise(resolve => setTimeout(resolve, 15));
      }
      assert.equal(waiting, true, 'Actual principal HTTP must wait before current actor SHARE');
      await changer.query(loss.sql, [id]); const before = await snapshot();
      await holder.query('COMMIT'); ok(await pending, loss.status); assert.deepEqual(await snapshot(), before);
    } finally {
      await holder.query('ROLLBACK').catch(() => {}); if (pending) await Promise.allSettled([pending]);
      await close(changer); await close(holder);
    }
  });
});
