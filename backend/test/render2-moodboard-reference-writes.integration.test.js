import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { applyMoodboardReferenceOperation, readMoodboardReference } from '../src/moodboard-reference-write.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aElcAAAAASUVORK5CYII=';
const imageData = `data:image/png;base64,${png}`;
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const sha = value => createHash('sha256').update(value).digest('hex');

test('QA122 principal moodboard reference operations, numeric CAS, durable receipts and local assets', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const f = await startLocalHarness({ port: 55774 });
  let pool;
  t.after(async () => {
    try { await pool?.end(); } finally { await f.cleanup(); }
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`QA122 cleanup ENOENT: ${f.root}; PostgreSQL port55774`);
  });
  const url = 'postgresql://render2_fixture@127.0.0.1:55774/render2_local_test';
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55774, url, identity });
  pool = new pg.Pool({ connectionString: url, max: 5, statement_timeout: 15000, application_name: 'qa122-own-references' });
  const uploadDir = path.join(f.root, 'storage', 'moodboards');
  const files = async () => (await readdir(uploadDir)).sort();
  const api = (route, token, method = 'GET', body) => request(f.base, `/api${route}`, { token, method, body });
  const ok = (response, status = 200) => { assert.equal(response.status, status, 'Unexpected principal HTTP status'); return response.body; };
  const login = async usuario => ok(await api('/login', null, 'POST', { usuario, password: fixturePassword })).token;
  const admin = await login('qa_franco'), peer = await login('qa_agustin'), staff = await login('qa_luciano');
  const actors = [];
  for (const [index, role] of ['admin', 'diseno', 'edicion', 'produccion', 'community', 'programacion', 'qa_unknown'].entries()) {
    const id = 991220 + index;
    await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,'QA122 same display name',$3,password_hash,true,1 FROM usuarios WHERE id=91004`, [id, `qa122_${index}`, role]);
    actors.push({ id, role, token: await login(`qa122_${index}`) });
  }
  const clients = await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA122 reference client',true),('QA122 other client',true) RETURNING id");
  const boards = await f.query("INSERT INTO moodboard_boards(nombre) VALUES('QA122 reference board'),('QA122 foreign board') RETURNING id");
  for (let index = 0; index < 2; index++) await f.query('INSERT INTO moodboard_board_clients(board_id,cliente_id) VALUES($1,$2)', [boards[index].id, clients[index].id]);
  const [category, foreign] = await f.query("INSERT INTO moodboard_categories(board_id,nombre,orden) VALUES($1,'QA122 original category',1),($2,'QA122 foreign category',1) RETURNING id,board_id,nombre", [boards[0].id, boards[1].id]);
  const marker = 'QA122_PRIVATE_TASK_FINANCE';
  const task = async (title, clientId, workspace, owner) => {
    const [row] = await f.query(`INSERT INTO tareas(titulo,cliente_id,asignado_a,estado,tipo_tarea,propiedades_extra)
      VALUES($1,$2,'QA122 same display name','pendiente','edicion',$3::jsonb) RETURNING id`,
    [title, clientId, JSON.stringify({ ...(workspace ? { workspace } : {}), private_finance: { marker, importe: 817293.46 } })]);
    if (owner) await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,$2,'responsable')", [row.id, owner]);
    return { ...row, titulo: title };
  };
  const hidden = await task('QA122_PRIVATE_HISTORY_TITLE', clients[0].id, null, 91001);
  const assigned = await task('QA122 historical assigned', clients[0].id, null, 91003);
  const shared = await task('QA122 shared task', clients[0].id, 'render_os', null);
  const wrongClient = await task('QA122_WRONG_CLIENT_TITLE', clients[1].id, 'render_os', null);
  const tables = (await f.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
  const snapshot = async () => {
    const rows = {};
    for (const table of tables) {
      assert.match(table, /^[a-zA-Z_][a-zA-Z_0-9]*$/);
      rows[table] = await f.query(`SELECT * FROM "${table}" t ORDER BY to_jsonb(t)::text`);
    }
    return rows;
  };
  const keys = (row, expected) => assert.deepEqual(Object.keys(row).sort(), [...expected].sort());
  const assertReference = row => {
    keys(row, ['id', 'board_id', 'category_id', 'titulo', 'nota', 'etiquetas', 'estado', 'tipo_fuente',
      'enlace_externo', 'archivo_nombre', 'autor_id', 'autor_nombre', 'created_at', 'updated_at', 'categoria', 'tareas', 'revision']);
    assert.ok(Number.isSafeInteger(row.id) && row.id > 0 && row.id <= 2147483647);
    assert.ok(Number.isSafeInteger(row.revision) && row.revision >= 0); assert.ok(Array.isArray(row.etiquetas));
    assert.ok(Array.isArray(row.tareas)); for (const item of row.tareas) keys(item, ['id', 'titulo']);
    assert.equal(JSON.stringify(row).includes(marker), false); assert.equal(JSON.stringify(row).includes('817293.46'), false);
    return row;
  };
  const createIntent = (title, image = false, requestId = randomUUID()) => ({ request_id: requestId, action: 'create', board_id: boards[0].id,
    fields: { title, note: 'QA122 explicit reference note', category_id: category.id, tags: ['QA122'],
      ...(image ? { image_data: imageData } : { external_url: 'https://example.invalid/qa122/reference' }) } });
  const changeIntent = (action, row, fields, requestId = randomUUID()) => ({ request_id: requestId, action,
    board_id: row.board_id, reference_id: row.id, expected_revision: row.revision,
    ...(fields === undefined ? {} : { fields }) });
  const write = (body, token = admin) => api('/moodboards/reference-operations', token, 'POST', body);
  const ack = (body, intent, replayed, referenceId = body.operation.reference_id) => {
    keys(body, ['version', 'reference', 'operation']); assert.equal(body.version, 1);
    keys(body.operation, ['request_id', 'action', 'reference_id', 'result_revision', 'replayed']);
    assert.equal(body.operation.request_id, intent.request_id.toLowerCase()); assert.equal(body.operation.action, intent.action);
    assert.equal(body.operation.reference_id, referenceId); assert.equal(body.operation.replayed, replayed);
    assert.ok(Number.isSafeInteger(body.operation.result_revision) && body.operation.result_revision >= 0);
    if (body.reference !== null) { assertReference(body.reference); assert.equal(body.reference.id, referenceId); }
    return body;
  };
  const read = async (id, token = admin) => {
    const body = ok(await api(`/moodboards/references/${id}/detail`, token));
    keys(body, ['version', 'reference']); assert.equal(body.version, 1);
    return assertReference(body.reference);
  };
  const asset = async (filename, token = admin) => {
    assert.match(filename, /^[a-f0-9-]+\.(png|jpg)$/);
    const response = await fetch(new URL(`/api/moodboards/assets/${filename}`, f.base), {
      headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(20000),
    });
    return { status: response.status, cache: response.headers.get('cache-control'), bytes: Buffer.from(await response.arrayBuffer()) };
  };
  const waitBlocked = async pid => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const { rows } = await pool.query(`SELECT pid,query FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND $1::int=ANY(pg_blocking_pids(pid))`, [pid]);
      if (rows.length) return rows;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail('HTTP did not reach the owned actual PostgreSQL lock barrier');
  };

  await t.test('every current shared role including custom creates/edits/deletes with exact closed DTO and initial revision zero', async () => {
    for (const actor of actors) {
      const intent = createIntent(`QA122 lifecycle ${actor.role}`);
      const created = ack(ok(await write(intent, actor.token), 201), intent, false).reference;
      assert.equal(created.revision, 0); assert.equal(created.autor_id, actor.id); assert.equal(created.board_id, boards[0].id);
      assert.equal(created.category_id, category.id); assert.equal(created.categoria, category.nombre);
      const edit = changeIntent('edit', created, { title: `QA122 edited ${actor.role}`, status: 'aprobada', tags: ['reviewed'] });
      const saved = ack(ok(await write(edit, actor.token)), edit, false, created.id).reference;
      assert.ok(saved.revision > created.revision); assert.equal(saved.estado, 'aprobada'); assert.deepEqual(saved.etiquetas, ['reviewed']);
      const observed = await read(created.id, actor.token); assert.equal(observed.titulo, edit.fields.title);
      const before = await snapshot();
      const listed = ok(await api(`/moodboards/boards/${boards[0].id}/references`, actor.token));
      assertReference(listed.find(row => row.id === created.id)); assert.deepEqual(await snapshot(), before);
      const removal = changeIntent('delete', saved);
      const deleted = ack(ok(await write(removal, actor.token)), removal, false, created.id);
      assert.equal(deleted.reference, null); assert.equal(deleted.operation.result_revision, saved.revision);
      ok(await api(`/moodboards/references/${created.id}/detail`, actor.token), 404);
      const stable = await snapshot();
      assert.equal(ack(ok(await write(intent, actor.token)), intent, true, created.id).reference, null);
      assert.equal(ack(ok(await write(removal, actor.token)), removal, true, created.id).reference, null);
      assert.deepEqual(await snapshot(), stable);
    }
  });

  await t.test('ignored genuine create ACK and later edits replay current state without duplicate creates or overwriting newer content', async () => {
    const intent = createIntent('QA122 ignored genuine create ACK');
    const original = ack(ok(await write(intent), 201), intent, false).reference;
    let before = await snapshot();
    assert.deepEqual(ack(ok(await write(intent)), intent, true, original.id).reference, original);
    assert.deepEqual(await snapshot(), before);
    const edit = changeIntent('edit', original, { note: 'QA122 newer independent human edit' });
    const current = ack(ok(await write(edit, peer)), edit, false, original.id).reference;
    before = await snapshot();
    const replay = ack(ok(await write(intent)), intent, true, original.id);
    assert.equal(replay.reference.nota, current.nota); assert.equal(replay.reference.revision, current.revision);
    assert.equal(replay.operation.result_revision, original.revision);
    for (const changed of [{ ...intent, fields: { ...intent.fields, note: 'QA122 same-key wrong body' } },
      { ...intent, board_id: boards[1].id }, changeIntent('edit', current, { title: 'Wrong action same UUID' }, intent.request_id)])
      ok(await write(changed), 409);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('task projection follows canonical ACL and deleting a linked reference preserves all actual tasks/assignments', async () => {
    const intent = createIntent('QA122 task privacy and retained history');
    const created = ack(ok(await write(intent), 201), intent, false).reference;
    for (const row of [hidden, assigned, shared, wrongClient])
      await f.query('INSERT INTO moodboard_reference_tasks(reference_id,tarea_id) VALUES($1,$2)', [created.id, row.id]);
    const before = await snapshot();
    for (const [token, expectedIds] of [[admin, [hidden.id, assigned.id, shared.id]],
      [staff, [assigned.id, shared.id]], [actors[2].token, [shared.id]]]) {
      const detail = await read(created.id, token);
      assert.deepEqual(detail.tareas.map(row => row.id).sort((a, b) => a - b), expectedIds.sort((a, b) => a - b));
      assert.equal(detail.revision, created.revision, 'Link relations must not advance reference revision');
      assert.equal(JSON.stringify(detail).includes(wrongClient.titulo), false);
      if (token !== admin) assert.equal(JSON.stringify(detail).includes(hidden.titulo), false);
    }
    assert.deepEqual(await snapshot(), before);
    const removal = changeIntent('delete', await read(created.id));
    ack(ok(await write(removal)), removal, false, created.id);
    const after = await snapshot();
    assert.deepEqual(after.tareas, before.tareas); assert.deepEqual(after.tarea_asignaciones, before.tarea_asignaciones);
    assert.equal(after.moodboard_reference_tasks.some(row => row.reference_id === created.id), false);
  });

  await t.test('two real actors waiting for a locked reference have one current CAS winner, never a lost update', async () => {
    const intent = createIntent('QA122 reference CAS race'), current = ack(ok(await write(intent), 201), intent, false).reference;
    const locker = await pool.connect(), pending = [];
    try {
      await locker.query('BEGIN'); await locker.query('SELECT id FROM moodboard_references WHERE id=$1 FOR UPDATE', [current.id]);
      const pid = (await locker.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      for (const [index, token] of [admin, peer].entries()) pending.push(write(changeIntent('edit', current, { note: `QA122 competing ${index}` }), token));
      const waiting = await waitBlocked(pid); assert.ok(waiting.some(row => /moodboard_references/.test(row.query)));
      await locker.query('COMMIT');
      const results = await Promise.all(pending); assert.deepEqual(results.map(row => row.status).sort(), [200, 409]);
      const winner = results.find(row => row.status === 200).body.reference;
      assert.equal((await read(current.id)).nota, winner.nota);
      const before = await snapshot(); ok(await write(changeIntent('delete', current)), 409); assert.deepEqual(await snapshot(), before);
    } finally { await locker.query('ROLLBACK').catch(() => {}); await Promise.allSettled(pending); locker.release(); }
  });

  await t.test('category SET NULL advances the actual reference revision; old edit cannot overwrite and linked tasks survive', async () => {
    const [temporary] = await f.query("INSERT INTO moodboard_categories(board_id,nombre) VALUES($1,'QA122 removable category') RETURNING id", [boards[0].id]);
    const intent = createIntent('QA122 category deletion observation'); intent.fields.category_id = temporary.id;
    const original = ack(ok(await write(intent), 201), intent, false).reference;
    await f.query('INSERT INTO moodboard_reference_tasks(reference_id,tarea_id) VALUES($1,$2)', [original.id, shared.id]);
    const before = await snapshot();
    await f.query('DELETE FROM moodboard_categories WHERE id=$1', [temporary.id]);
    const current = await read(original.id);
    assert.equal(current.category_id, null); assert.equal(current.categoria, null); assert.ok(current.revision > original.revision);
    assert.deepEqual(current.tareas, [{ id: shared.id, titulo: shared.titulo }]);
    const stable = await snapshot(); ok(await write(changeIntent('edit', original, { title: 'QA122 obsolete category observation' })), 409);
    assert.deepEqual(await snapshot(), stable);
    assert.deepEqual(stable.tareas, before.tareas); assert.deepEqual(stable.tarea_asignaciones, before.tarea_asignaciones);
    assert.deepEqual(stable.moodboard_reference_tasks, before.moodboard_reference_tasks);
  });

  await t.test('current referenced image is served exactly; a real orphan is 404 even when its file remains on disk', async () => {
    const intent = createIntent('QA122 actual local image', true);
    const created = ack(ok(await write(intent), 201), intent, false).reference;
    assert.equal(created.tipo_fuente, 'imagen'); assert.equal(created.enlace_externo, null);
    assert.match(created.archivo_nombre, /^[a-f0-9-]+\.png$/);
    const filename = created.archivo_nombre, storedPath = path.join(uploadDir, filename);
    assert.equal(path.dirname(storedPath), uploadDir); assert.deepEqual(await readFile(storedPath), Buffer.from(png, 'base64'));
    for (const token of [admin, actors.at(-1).token]) {
      const served = await asset(filename, token); assert.equal(served.status, 200); assert.equal(served.cache, 'no-store');
      assert.deepEqual(served.bytes, Buffer.from(png, 'base64'));
    }
    const actor = actors.at(-1);
    await f.query('UPDATE usuarios SET session_version=2 WHERE id=$1', [actor.id]);
    try { assert.equal((await asset(filename, actor.token)).status, 401); }
    finally { await f.query('UPDATE usuarios SET session_version=1 WHERE id=$1', [actor.id]); }
    // Deliberate fixture-only SQL deletion leaves a deterministic real orphan:
    // no invented filename, no filesystem write by this test, no provider.
    await f.query('DELETE FROM moodboard_references WHERE id=$1', [created.id]);
    assert.deepEqual(await readFile(storedPath), Buffer.from(png, 'base64'));
    const before = await snapshot(); assert.equal((await asset(filename)).status, 404);
    assert.equal(ack(ok(await write(intent)), intent, true, created.id).reference, null);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('foreign-board category rejects before preparing an image; actual SQL composite FK also rejects new cross-board rows', async () => {
    const intent = createIntent('QA122 rejected foreign category image', true); intent.fields.category_id = foreign.id;
    const before = await snapshot(), diskBefore = await files();
    const rejected = ok(await write(intent), 409); assert.equal(rejected.code, 'MOODBOARD_REFERENCE_CATEGORY_CONFLICT');
    assert.deepEqual(await snapshot(), before); assert.deepEqual(await files(), diskBefore);
    await assert.rejects(pool.query(`INSERT INTO moodboard_references(board_id,category_id,titulo,nota,tipo_fuente,enlace_externo,autor_id,autor_nombre)
      VALUES($1,$2,'QA122 SQL wrong-board category','Must not persist','enlace','https://example.invalid/wrong',91001,'QA fixture')`,
    [boards[0].id, foreign.id]), error => error.code === '23503');
    assert.deepEqual(await snapshot(), before); assert.deepEqual(await files(), diskBefore);
  });

  await t.test('required UUID/revision, canonical IDs, strict fields and real image signatures reject without rows/files', async () => {
    assert.deepEqual(Buffer.from(png, 'base64').subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const creation = createIntent('QA122 parser validation source'), original = ack(ok(await write(creation), 201), creation, false).reference;
    const edit = changeIntent('edit', original, { note: 'QA122 valid patch shape' });
    const { request_id: _key, ...missingKey } = creation;
    const { expected_revision: _revision, ...missingRevision } = edit;
    const before = await snapshot(), diskBefore = await files();
    ok(await write(missingKey), 428); ok(await write(missingRevision), 428); ok(await write({}), 428);
    for (const body of [null, [], { ...creation, request_id: 'bad' }, { ...creation, action: 'purge' },
      { ...creation, extra: true }, { ...creation, reference_id: original.id },
      ...[0, -1, '1', 1.5, 2147483648, 9007199254740992].map(board_id => ({ ...creation, board_id })),
      ...[0, -1, String(original.id), 1.5, 2147483648].map(reference_id => ({ ...edit, reference_id })),
      ...[-1, null, '0', 1.5, 9007199254740992].map(expected_revision => ({ ...edit, expected_revision })),
      ...[null, [], { ...creation.fields, note: '' }, { ...creation.fields, tags: 'not-array' },
        { ...creation.fields, autor_id: 91001 }, { ...creation.fields, external_url: 'javascript:alert(1)' },
        { ...creation.fields, external_url: 'https://user:secret@example.invalid/image' },
        { ...creation.fields, image_data: imageData },
        { ...creation.fields, external_url: '', image_data: 'data:image/png;base64,YXJiaXRyYXJ5' },
        { ...creation.fields, external_url: '', image_data: `data:image/jpeg;base64,${png}` }].map(fields => ({ ...creation, fields })),
      { ...edit, fields: { external_url: 'https://example.invalid/cannot-replace-source' } },
      { ...edit, fields: { status: 'publicada' } }]) ok(await write(body), 400);
    for (const suffix of ['?q=one', '?board_id=1&board_id=2', '?limit[]=1']) {
      ok(await api(`/moodboards/reference-operations${suffix}`, admin, 'POST', creation), 400);
      ok(await api(`/moodboards/references/${original.id}/detail${suffix}`, admin), 400);
    }
    for (const id of ['0', '-1', '01', '1.5', 'abc', '2147483648']) ok(await api(`/moodboards/references/${id}/detail`, admin), 400);
    ok(await api('/moodboards/references/2147483647/detail', admin), 404);
    ok(await write({ ...edit, board_id: boards[1].id }), 404);
    ok(await write(creation, null), 401);
    assert.deepEqual(await snapshot(), before); assert.deepEqual(await files(), diskBefore);
  });

  await t.test('stored receipt hash includes the approved contract tag and explicit canonical image/link intent; raw SQL UPDATE versions cannot be bypassed', async () => {
    for (const image of [false, true]) {
      const intent = createIntent(`QA122 canonical receipt ${image}`, image);
      const saved = ack(ok(await write(intent), 201), intent, false).reference;
      const expected = sha(canonical({ contract: 'moodboard-reference-operation-v1', action: 'create', board_id: boards[0].id,
        reference_id: null, expected_revision: null,
        fields: { title: intent.fields.title, note: intent.fields.note, category_id: category.id, tags: ['QA122'],
          source: image ? 'imagen' : 'enlace', external_url: image ? null : intent.fields.external_url },
        image: image ? { extension: 'png', digest: sha(Buffer.from(png, 'base64')) } : null }));
      const [receipt] = await f.query('SELECT * FROM moodboard_reference_operations WHERE actor_user_id=91001 AND request_id=$1', [intent.request_id]);
      keys(receipt, ['actor_user_id', 'request_id', 'action', 'payload_hash', 'board_id', 'reference_id', 'result_revision', 'recorded_at']);
      assert.equal(receipt.payload_hash, expected); assert.equal(receipt.reference_id, saved.id);
      assert.equal(Number(receipt.result_revision), 0);
      await f.query('UPDATE moodboard_references SET revision=999999,nota=nota WHERE id=$1', [saved.id]);
      const updated = await read(saved.id); assert.equal(updated.revision, saved.revision + 1); assert.equal(updated.nota, saved.nota);
      const stable = await snapshot();
      ok(await write(changeIntent('edit', saved, { note: 'QA122 obsolete pre-SQL observation' })), 409);
      assert.deepEqual(await snapshot(), stable);
    }
  });

  for (const action of ['create', 'edit', 'delete']) {
    await t.test(`late receipt INSERT fault rolls back ${action}, retained task links and local image changes; same-key retry succeeds`, async () => {
      let intent, original;
      if (action === 'create') intent = createIntent('QA122 atomic image creation', true);
      else {
        const creation = createIntent(`QA122 atomic ${action} setup`, true);
        original = ack(ok(await write(creation), 201), creation, false).reference;
        await f.query('INSERT INTO moodboard_reference_tasks(reference_id,tarea_id) VALUES($1,$2)', [original.id, shared.id]);
        intent = changeIntent(action, original, action === 'edit' ? { note: 'QA122 atomic edit only' } : undefined);
      }
      const before = await snapshot(), diskBefore = await files();
      await f.query(`CREATE FUNCTION qa122_receipt_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        RAISE EXCEPTION 'QA122 synthetic receipt failure'; END $$;
        CREATE TRIGGER qa122_receipt_fault BEFORE INSERT ON moodboard_reference_operations
        FOR EACH ROW EXECUTE FUNCTION qa122_receipt_fault()`);
      try {
        ok(await write(intent), 500); assert.deepEqual(await snapshot(), before); assert.deepEqual(await files(), diskBefore);
        if (original) assert.deepEqual(await readFile(path.join(uploadDir, original.archivo_nombre)), Buffer.from(png, 'base64'));
      } finally {
        await f.query('DROP TRIGGER qa122_receipt_fault ON moodboard_reference_operations; DROP FUNCTION qa122_receipt_fault()');
      }
      const saved = ack(ok(await write(intent), action === 'create' ? 201 : 200), intent, false);
      if (action === 'delete') {
        assert.equal(saved.reference, null); assert.equal(saved.operation.result_revision, original.revision);
        assert.equal((await asset(original.archivo_nombre)).status, 404);
      } else {
        assertReference(saved.reference);
        const served = await asset(saved.reference.archivo_nombre); assert.equal(served.status, 200);
        assert.deepEqual(served.bytes, Buffer.from(png, 'base64'));
      }
      const stable = await snapshot(), stableFiles = await files();
      ack(ok(await write(intent)), intent, true, saved.operation.reference_id);
      assert.deepEqual(await snapshot(), stable); assert.deepEqual(await files(), stableFiles);
      assert.deepEqual(stable.tareas, before.tareas); assert.deepEqual(stable.tarea_asignaciones, before.tarea_asignaciones);
      for (const sql of ['UPDATE moodboard_reference_operations SET payload_hash=payload_hash WHERE actor_user_id=91001 AND request_id=$1',
        'DELETE FROM moodboard_reference_operations WHERE actor_user_id=91001 AND request_id=$1'])
        await assert.rejects(pool.query(sql, [intent.request_id]), error => error.code === '23514');
    });
  }

  for (const change of ['epoch', 'role', 'inactive']) for (const replay of [false, true]) {
    await t.test(`account-mutex wait revalidates ${change} before ${replay ? 'receipt replay' : 'new image creation'} without rows/files`, async () => {
      const actor = actors[0];
      await f.query("UPDATE usuarios SET activo=true,rol='admin',session_version=1 WHERE id=$1", [actor.id]);
      const intent = createIntent(`QA122 authority ${change} ${replay}`, true);
      if (replay) ack(ok(await write(intent, actor.token), 201), intent, false);
      const locker = await pool.connect(); let pending;
      try {
        await locker.query('BEGIN'); await locker.query('SELECT pg_advisory_xact_lock(20261019,1)');
        const pid = (await locker.query('SELECT pg_backend_pid() pid')).rows[0].pid;
        pending = write(intent, actor.token).then(value => ({ value }), error => ({ error }));
        await waitBlocked(pid);
        await locker.query(`UPDATE usuarios SET ${change === 'epoch' ? 'session_version=2' : change === 'role' ? "rol='edicion'" : 'activo=false'} WHERE id=$1`, [actor.id]);
        await locker.query('COMMIT');
        const before = await snapshot(), diskBefore = await files(), result = await pending;
        if (result.error) throw result.error;
        ok(result.value, 401); assert.deepEqual(await snapshot(), before); assert.deepEqual(await files(), diskBefore);
      } finally {
        await locker.query('ROLLBACK').catch(() => {}); await pending; locker.release();
        await f.query("UPDATE usuarios SET activo=true,rol='admin',session_version=1 WHERE id=$1", [actor.id]);
      }
    });
  }

  await t.test('authorized edit holds actor SHARE while waiting on reference; a later revocation waits until write COMMIT', async () => {
    const actor = actors[2], creation = createIntent('QA122 actor lock through reference commit');
    const original = ack(ok(await write(creation), 201), creation, false).reference;
    const intent = changeIntent('edit', original, { note: 'QA122 legitimately serialized before revocation' });
    const locker = await pool.connect(), revoker = await pool.connect(); let pending, revocation;
    try {
      await locker.query('BEGIN'); await locker.query('SELECT id FROM moodboard_references WHERE id=$1 FOR UPDATE', [original.id]);
      const refPid = (await locker.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      pending = write(intent, actor.token).then(value => ({ value }), error => ({ error }));
      const waiting = await waitBlocked(refPid), writer = waiting.find(row => /moodboard_references/.test(row.query));
      assert.ok(writer, 'Writer must be blocked at its actual reference row after actor SHARE');
      await revoker.query('BEGIN'); const revokePid = (await revoker.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      revocation = revoker.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=$1', [actor.id])
        .then(value => ({ value }), error => ({ error }));
      const blocked = await waitBlocked(writer.pid);
      assert.ok(blocked.some(row => row.pid === revokePid));
      await locker.query('COMMIT'); const result = await pending; if (result.error) throw result.error;
      const saved = ack(ok(result.value), intent, false, original.id); assert.equal(saved.reference.nota, intent.fields.note);
      const revoked = await revocation; if (revoked.error) throw revoked.error;
      await revoker.query('COMMIT'); assert.equal((await read(original.id)).nota, intent.fields.note);
      const before = await snapshot(); ok(await write(intent, actor.token), 401); assert.deepEqual(await snapshot(), before);
    } finally {
      await locker.query('ROLLBACK').catch(() => {}); await pending; await revocation;
      await revoker.query('ROLLBACK').catch(() => {}); locker.release(); revoker.release();
      await f.query('UPDATE usuarios SET session_version=1 WHERE id=$1', [actor.id]);
    }
  });

  await t.test('genuine actor and immutable image intent are captured before a real delayed lease; obsolete actor cannot write/read/files', async () => {
    const actor = actors.at(-1);
    let reached, resume;
    const ready = new Promise(resolve => { reached = resolve; }), gate = new Promise(resolve => { resume = resolve; });
    const wrapper = { connect: async () => { reached(); await gate; return pool.connect(); } };
    const observed = { id: actor.id, rol: actor.role, session_version: 1 };
    const intent = createIntent('QA122 immutable original image', true), originalId = intent.request_id;
    const pending = applyMoodboardReferenceOperation(wrapper, observed, intent, { uploadDir });
    await ready;
    observed.id = 91001; observed.rol = 'admin'; observed.session_version = 2;
    intent.request_id = randomUUID(); intent.fields.title = 'QA122 later caller mutation';
    intent.fields.tags.push('must-not-appear'); intent.fields.image_data = 'not an image';
    resume(); const result = await pending;
    assert.equal(result.status, 201);
    const saved = ack(result.body, { ...intent, request_id: originalId }, false);
    assert.equal(saved.reference.autor_id, actor.id); assert.equal(saved.reference.titulo, 'QA122 immutable original image');
    assert.deepEqual(saved.reference.etiquetas, ['QA122']);
    assert.deepEqual((await asset(saved.reference.archivo_nombre)).bytes, Buffer.from(png, 'base64'));
    const [receipt] = await f.query('SELECT actor_user_id FROM moodboard_reference_operations WHERE request_id=$1', [originalId]);
    assert.equal(receipt.actor_user_id, actor.id);
    for (const kind of ['write', 'read']) for (const change of ['epoch', 'role', 'inactive']) {
      let acquired, release;
      const waiting = new Promise(resolve => { acquired = resolve; }), hold = new Promise(resolve => { release = resolve; });
      const delayed = { connect: async () => { acquired(); await hold; return pool.connect(); } };
      const auth = { id: actor.id, rol: actor.role, session_version: 1 };
      const response = kind === 'write'
        ? applyMoodboardReferenceOperation(delayed, auth, createIntent(`QA122 stale lease ${change}`, true), { uploadDir })
        : readMoodboardReference(delayed, auth, String(saved.reference.id));
      const rejected = assert.rejects(response, error => error.status === 401);
      await waiting;
      try {
        await f.query(`UPDATE usuarios SET ${change === 'epoch' ? 'session_version=2' : change === 'role' ? "rol='admin'" : 'activo=false'} WHERE id=$1`, [actor.id]);
        auth.id = 91001; auth.rol = 'admin'; auth.session_version = 2;
        const before = await snapshot(), diskBefore = await files(); release(); await rejected;
        assert.deepEqual(await snapshot(), before); assert.deepEqual(await files(), diskBefore);
      } finally {
        release(); await rejected;
        await f.query("UPDATE usuarios SET activo=true,rol='qa_unknown',session_version=1 WHERE id=$1", [actor.id]);
      }
    }
  });

  await t.test('populated board catalog has unique active client memberships and exact independent reference counts without GET writes', async () => {
    const before = await snapshot();
    const members = await f.query(`SELECT bc.board_id,c.id,c.nombre FROM moodboard_board_clients bc
      JOIN clientes c ON c.id=bc.cliente_id AND COALESCE(c.activo,true)=true ORDER BY bc.board_id,c.id`);
    const counts = await f.query('SELECT board_id,count(*)::int AS total FROM moodboard_references GROUP BY board_id');
    const populatedCount = counts.find(row => row.board_id === boards[0].id)?.total;
    assert.ok(populatedCount >= 2, 'Existing lifecycle cases must leave a genuinely populated board, not a vacuous empty-board check');
    const expectedBoardIds = [...new Set(members.map(row => row.board_id))].sort((a, b) => a - b);
    for (const token of [admin, staff, actors.at(-1).token]) {
      const catalog = ok(await api('/moodboards/boards', token));
      assert.ok(Array.isArray(catalog));
      assert.deepEqual(catalog.map(row => row.id).sort((a, b) => a - b), expectedBoardIds);
      for (const board of catalog) {
        keys(board, ['id', 'nombre', 'clientes', 'total_referencias']);
        assert.ok(Array.isArray(board.clientes));
        for (const client of board.clientes) keys(client, ['id', 'nombre']);
        assert.equal(new Set(board.clientes.map(client => client.id)).size, board.clientes.length,
          'Multiple references must not multiply the catalog client JSON');
        assert.deepEqual([...board.clientes].sort((a, b) => a.id - b.id),
          members.filter(row => row.board_id === board.id).map(({ id, nombre }) => ({ id, nombre })));
        assert.equal(board.total_referencias, counts.find(row => row.board_id === board.id)?.total ?? 0);
      }
      assert.equal(catalog.find(row => row.id === boards[0].id).total_referencias, populatedCount);
    }
    assert.deepEqual(await snapshot(), before);
  });
});
