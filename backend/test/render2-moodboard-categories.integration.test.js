import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';
import { applyMoodboardCategoryChanges, readMoodboardCategorySnapshot } from '../src/moodboard-categories.js';

test('QA118 principal moodboard category snapshots and atomic reviewed batches', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  const f = await startLocalHarness({ port: 55766 });
  let pool;
  t.after(async () => {
    try { await pool?.end(); } finally { await f.cleanup(); }
    await assert.rejects(access(f.root), error => error.code === 'ENOENT');
    t.diagnostic(`QA118 cleanup ENOENT: ${f.root}; PostgreSQL port55766`);
  });
  const url = 'postgresql://render2_fixture@127.0.0.1:55766/render2_local_test';
  const [identity] = await f.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: f.root, cwd: f.root, port: 55766, url, identity });
  pool = new pg.Pool({ connectionString: url, max: 5, statement_timeout: 15000, application_name: 'qa118-own-categories' });
  const api = (path, token, method = 'GET', body) => request(f.base, `/api/moodboards${path}`, { token, method, body });
  const ok = (response, status = 200) => { assert.equal(response.status, status, 'Unexpected principal HTTP status'); return response.body; };
  const login = async usuario => {
    const result = await request(f.base, '/api/login', { method: 'POST', body: { usuario, password: fixturePassword } });
    return ok(result).token;
  };
  const admin = await login('qa_franco');
  const actors = [];
  for (const [index, role] of ['admin', 'diseno', 'edicion', 'produccion', 'community', 'programacion', 'qa_unknown'].entries()) {
    const id = 991180 + index;
    await f.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version)
      SELECT $1,$2,'QA118 same display name',$3,password_hash,true,1 FROM usuarios WHERE id=91004`, [id, `qa118_${index}`, role]);
    actors.push({ id, role, token: await login(`qa118_${index}`) });
  }
  const [client] = await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA118 category client',true) RETURNING id");
  const boards = await f.query("INSERT INTO moodboard_boards(nombre) VALUES('QA118 primary'),('QA118 other') RETURNING id");
  await f.query('INSERT INTO moodboard_board_clients(board_id,cliente_id) VALUES($1,$2)', [boards[0].id, client.id]);
  const categories = await f.query(`INSERT INTO moodboard_categories(board_id,nombre,orden)
    VALUES($1,'QA118 retained',1),($1,'QA118 removable',2),($2,'QA118 foreign',1) RETURNING id,board_id,nombre,orden`,
  [boards[0].id, boards[1].id]);
  const retained = categories.find(row => row.nombre === 'QA118 retained');
  const removable = categories.find(row => row.nombre === 'QA118 removable');
  const foreign = categories.find(row => row.nombre === 'QA118 foreign');
  const marker = 'QA118_PRIVATE_REFERENCE_NOTE';
  const [reference] = await f.query(`INSERT INTO moodboard_references(board_id,category_id,titulo,nota,tipo_fuente,enlace_externo,autor_id,autor_nombre)
    VALUES($1,$2,'QA118 preserved reference',$3,'enlace','https://example.invalid/qa118',91001,'QA fixture') RETURNING id`,
  [boards[0].id, removable.id, marker]);
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
  const assertSnapshot = (body, boardId = boards[0].id, operation = false) => {
    keys(body, ['version', 'board_id', 'revision', 'categories', ...(operation ? ['operation'] : [])]);
    assert.equal(body.version, 1); assert.equal(body.board_id, boardId);
    assert.ok(Number.isSafeInteger(body.revision) && body.revision >= 0);
    assert.ok(Array.isArray(body.categories));
    const ids = new Set();
    for (const row of body.categories) {
      keys(row, ['id', 'nombre', 'orden']);
      assert.ok(Number.isSafeInteger(row.id) && row.id > 0); assert.equal(ids.has(row.id), false); ids.add(row.id);
      assert.equal(typeof row.nombre, 'string'); assert.ok(Number.isInteger(row.orden));
    }
    assert.equal(JSON.stringify(body).includes(marker), false);
    if (operation) {
      keys(body.operation, ['request_id', 'replayed', 'result_revision']);
      assert.equal(typeof body.operation.replayed, 'boolean');
      assert.ok(Number.isSafeInteger(body.operation.result_revision) && body.operation.result_revision >= 0);
    }
    return body;
  };
  const read = async (token = admin, boardId = boards[0].id) => assertSnapshot(ok(await api(`/boards/${boardId}/category-snapshot`, token)), boardId);
  const batch = (changes, revision, requestId = randomUUID()) => ({ request_id: requestId, expected_revision: revision, changes });
  const write = (body, token = admin, boardId = boards[0].id) => api(`/boards/${boardId}/category-changes`, token, 'POST', body);
  const waitBlocked = async (pid, count = 1) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const { rows } = await pool.query(`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND $1::int=ANY(pg_blocking_pids(pid))`, [pid]);
      if (rows.length >= count) return rows;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail('HTTP request did not reach the owned PostgreSQL lock barrier');
  };

  await t.test('all current roles including custom get closed read-only snapshots and can submit explicit batches', async () => {
    const before = await snapshot();
    for (const actor of actors) await read(actor.token);
    assert.deepEqual(await snapshot(), before);
    for (const actor of actors) {
      const current = await read(actor.token);
      const intent = batch([{ type: 'create', name: `QA118 ${actor.role}` }], current.revision);
      const saved = assertSnapshot(ok(await write(intent, actor.token), 201), boards[0].id, true);
      assert.equal(saved.operation.request_id, intent.request_id); assert.equal(saved.operation.replayed, false);
      assert.equal(saved.operation.result_revision, saved.revision); assert.notEqual(saved.revision, current.revision);
      assert.equal(saved.categories.filter(row => row.nombre === `QA118 ${actor.role}`).length, 1);
    }
    ok(await api(`/boards/${boards[0].id}/category-snapshot`, null), 401);
    ok(await write(batch([{ type: 'create', name: 'No auth' }], (await read()).revision), null), 401);
  });

  await t.test('atomic rename/create/delete preserves references with SET NULL and exact observed revisions', async () => {
    const before = await snapshot(), current = await read();
    const intent = batch([{ type: 'rename', id: retained.id, name: 'QA118 renamed' },
      { type: 'create', name: 'QA118 explicit new' }, { type: 'delete', id: removable.id }], current.revision);
    const saved = assertSnapshot(ok(await write(intent), 201), boards[0].id, true);
    assert.equal(saved.categories.find(row => row.id === retained.id).nombre, 'QA118 renamed');
    assert.equal(saved.categories.some(row => row.id === removable.id), false);
    assert.equal(saved.categories.filter(row => row.nombre === 'QA118 explicit new').length, 1);
    const after = await snapshot();
    assert.deepEqual(after.moodboard_references, before.moodboard_references.map(row => row.id === reference.id
      ? { ...row, category_id: null, revision: (BigInt(row.revision) + 1n).toString() } : row),
    'SET NULL advances the reference revision exactly once and preserves every other property');
    for (const table of tables.filter(name => !name.startsWith('moodboard_'))) assert.deepEqual(after[table], before[table], table);
  });

  await t.test('a conflicting final category set rolls back the entire batch, including an earlier successful rename', async () => {
    const current = await read(), before = await snapshot();
    ok(await write(batch([{ type: 'rename', id: retained.id, name: 'QA118 must rollback' },
      { type: 'create', name: 'QA118 duplicate' }, { type: 'create', name: 'qa118 DUPLICATE' }], current.revision)), 409);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('valid final names allow rename A to B plus delete B in either input order, retaining the surviving ID', async () => {
    for (const reverse of [false, true]) {
      const [board] = await f.query('INSERT INTO moodboard_boards(nombre) VALUES($1) RETURNING id', [`QA118 final name ${reverse}`]);
      const [a, b] = await f.query("INSERT INTO moodboard_categories(board_id,nombre,orden) VALUES($1,'A',1),($1,'B',2) RETURNING id", [board.id]);
      const current = await read(admin, board.id);
      const changes = [{ type: 'rename', id: a.id, name: 'B' }, { type: 'delete', id: b.id }];
      if (reverse) changes.reverse();
      const saved = assertSnapshot(ok(await write(batch(changes, current.revision), admin, board.id), 201), board.id, true);
      assert.ok(saved.revision > current.revision);
      assert.deepEqual(saved.categories, [{ id: a.id, nombre: 'B', orden: 1 }]);
      assert.deepEqual((await read(admin, board.id)).categories, saved.categories);
    }
  });

  await t.test('atomic A/B name swap preserves IDs/order; genuine final duplicate rolls everything back', async () => {
    const [board] = await f.query("INSERT INTO moodboard_boards(nombre) VALUES('QA118 swap final names') RETURNING id");
    const [a, b] = await f.query("INSERT INTO moodboard_categories(board_id,nombre,orden) VALUES($1,'A',1),($1,'B',2) RETURNING id", [board.id]);
    const current = await read(admin, board.id);
    const saved = assertSnapshot(ok(await write(batch([{ type: 'rename', id: a.id, name: 'B' },
      { type: 'rename', id: b.id, name: 'A' }], current.revision), admin, board.id), 201), board.id, true);
    assert.ok(saved.revision > current.revision);
    assert.deepEqual(saved.categories, [{ id: a.id, nombre: 'B', orden: 1 }, { id: b.id, nombre: 'A', orden: 2 }]);
    const before = await snapshot();
    const denied = ok(await write(batch([{ type: 'rename', id: a.id, name: 'Duplicated' },
      { type: 'rename', id: b.id, name: 'duplicated' }], saved.revision), admin, board.id), 409);
    assert.equal(denied.code, 'MOODBOARD_CATEGORY_NAME_CONFLICT');
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('lost ACK exact replay never duplicates; replay after a later edit returns current snapshot and original result revision', async () => {
    const intent = batch([{ type: 'create', name: 'QA118 ignored genuine ACK' }], (await read()).revision);
    const committed = assertSnapshot(ok(await write(intent), 201), boards[0].id, true);
    const committedSnapshot = await snapshot();
    const replay = assertSnapshot(ok(await write(intent), 200), boards[0].id, true);
    assert.equal(replay.operation.replayed, true); assert.equal(replay.operation.result_revision, committed.revision);
    assert.deepEqual(await snapshot(), committedSnapshot);
    const later = assertSnapshot(ok(await write(batch([{ type: 'rename', id: retained.id, name: 'QA118 later edit' }], replay.revision)), 201), boards[0].id, true);
    const before = await snapshot(), oldReplay = assertSnapshot(ok(await write(intent), 200), boards[0].id, true);
    assert.equal(oldReplay.revision, later.revision); assert.equal(oldReplay.operation.result_revision, committed.revision);
    assert.equal(oldReplay.categories.find(row => row.id === retained.id).nombre, 'QA118 later edit');
    ok(await write({ ...intent, changes: [{ type: 'create', name: 'QA118 collision' }] }), 409);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('two actors waiting on the same board with one observed revision produce exactly one winner', async () => {
    const current = await read(), locker = await pool.connect();
    const pending = [];
    try {
      await locker.query('BEGIN');
      await locker.query('SELECT id FROM moodboard_boards WHERE id=$1 FOR NO KEY UPDATE', [boards[0].id]);
      const pid = (await locker.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      for (const [index, actor] of actors.slice(0, 2).entries()) pending.push(write(batch([{ type: 'create', name: `QA118 competing ${index}` }], current.revision), actor.token));
      await waitBlocked(pid); // The second writer may wait on the serialized account mutex.
      await locker.query('COMMIT');
      const results = await Promise.all(pending);
      assert.deepEqual(results.map(row => row.status).sort(), [201, 409]);
      const fresh = await read(); assert.equal(fresh.categories.filter(row => row.nombre.startsWith('QA118 competing ')).length, 1);
    } finally { await locker.query('ROLLBACK').catch(() => {}); await Promise.allSettled(pending); locker.release(); }
  });

  await t.test('canonical board IDs and board-specific category IDs reject without DML; legacy writes are retired', async () => {
    const current = await read(), before = await snapshot();
    for (const id of ['01', '-1', '0', '2147483648', 'abc']) {
      ok(await api(`/boards/${id}/category-snapshot`, admin), 400);
      ok(await write(batch([{ type: 'create', name: 'QA118 invalid board' }], current.revision), admin, id), 400);
    }
    ok(await api('/boards/2147483647/category-snapshot', admin), 404);
    for (const type of ['rename', 'delete']) {
      const denied = ok(await write(batch([{ type, id: foreign.id, ...(type === 'rename' ? { name: 'QA118 foreign edit' } : {}) }], current.revision)), 409);
      assert.equal(denied.code, 'MOODBOARD_CATEGORY_CONFLICT');
    }
    for (const [path, method, body] of [[`/boards/${boards[0].id}/categories`, 'POST', { name: 'Retired' }],
      [`/categories/${retained.id}`, 'PATCH', { name: 'Retired' }], [`/categories/${retained.id}`, 'DELETE', undefined]])
      ok(await api(path, admin, method, body), 410);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('closed payloads, revision types, names and unknown query parameters reject without changes', async () => {
    const current = await read(), valid = batch([{ type: 'create', name: 'QA118 validation only' }], current.revision);
    const before = await snapshot();
    const { expected_revision: _revision, ...missingRevision } = valid;
    for (const body of [missingRevision, null, [], {}, { ...valid, extra: true }, { ...valid, request_id: 'not-uuid' },
      ...[-1, '1', null, 1.5, Number.MAX_SAFE_INTEGER + 1].map(value => ({ ...valid, expected_revision: value })),
      ...[[], [{ type: 'create', name: '' }], [{ type: 'create', name: 'x\ny' }], [{ type: 'create', name: 'x'.repeat(201) }],
        [{ type: 'create', name: 123 }], [{ type: 'rename', id: String(retained.id), name: 'Wrong typed ID' }],
        [{ type: 'delete', id: retained.id }, { type: 'rename', id: retained.id, name: 'Twice' }],
        [{ type: 'rename', id: retained.id, name: 'Unknown', extra: true }]].map(changes => ({ ...valid, changes }))])
      ok(await write(body), 400);
    for (const suffix of ['?limit=20', '?id=1&id=2', '?revision[]=1']) {
      ok(await api(`/boards/${boards[0].id}/category-snapshot${suffix}`, admin), 400);
      ok(await api(`/boards/${boards[0].id}/category-changes${suffix}`, admin, 'POST', valid), 400);
    }
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('SQL category INSERT/UPDATE/DELETE advances board revision, including both sides of a move; stale API cannot overwrite', async () => {
    const before = await read(), otherBefore = await read(admin, boards[1].id);
    const [inserted] = await f.query("INSERT INTO moodboard_categories(board_id,nombre) VALUES($1,'QA118 SQL trigger') RETURNING id", [boards[0].id]);
    assert.equal((await read()).revision, before.revision + 1);
    await f.query('UPDATE moodboard_categories SET nombre=nombre WHERE id=$1', [inserted.id]);
    assert.equal((await read()).revision, before.revision + 2);
    await f.query('UPDATE moodboard_categories SET board_id=$1 WHERE id=$2', [boards[1].id, inserted.id]);
    assert.equal((await read()).revision, before.revision + 3);
    assert.equal((await read(admin, boards[1].id)).revision, otherBefore.revision + 1);
    await f.query('DELETE FROM moodboard_categories WHERE id=$1', [inserted.id]);
    assert.equal((await read(admin, boards[1].id)).revision, otherBefore.revision + 2);
    const stable = await snapshot();
    const denied = ok(await write(batch([{ type: 'rename', id: retained.id, name: 'QA118 stale SQL observation' }], before.revision)), 409);
    assert.equal(denied.code, 'MOODBOARD_CATEGORY_CONFLICT'); assert.deepEqual(await snapshot(), stable);
  });

  await t.test('receipt INSERT failure rolls back categories, reference SET NULL and board revision; healthy same-key retry works', async () => {
    const [category] = await f.query("INSERT INTO moodboard_categories(board_id,nombre) VALUES($1,'QA118 fault delete') RETURNING id", [boards[0].id]);
    await f.query('UPDATE moodboard_references SET category_id=$1 WHERE id=$2', [category.id, reference.id]);
    const intent = batch([{ type: 'rename', id: retained.id, name: 'QA118 after healthy retry' },
      { type: 'delete', id: category.id }, { type: 'create', name: 'QA118 atomic fault' }], (await read()).revision);
    const before = await snapshot();
    await f.query(`CREATE FUNCTION qa118_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION 'QA118 synthetic receipt failure'; END $$;
      CREATE TRIGGER qa118_receipt_failure BEFORE INSERT ON moodboard_category_operations
      FOR EACH ROW EXECUTE FUNCTION qa118_receipt_failure()`);
    try { ok(await write(intent), 500); assert.deepEqual(await snapshot(), before); }
    finally {
      await f.query('DROP TRIGGER qa118_receipt_failure ON moodboard_category_operations; DROP FUNCTION qa118_receipt_failure()');
    }
    const saved = assertSnapshot(ok(await write(intent), 201), boards[0].id, true);
    assert.equal(saved.operation.replayed, false); assert.equal(saved.categories.filter(row => row.nombre === 'QA118 atomic fault').length, 1);
    const [row] = await f.query('SELECT category_id,nota FROM moodboard_references WHERE id=$1', [reference.id]);
    assert.equal(row.category_id, null); assert.equal(row.nota, marker);
    const [receipt] = await f.query('SELECT * FROM moodboard_category_operations WHERE actor_user_id=91001 AND request_id=$1', [intent.request_id]);
    assert.ok(receipt);
    for (const sql of ['UPDATE moodboard_category_operations SET payload_hash=payload_hash WHERE request_id=$1',
      'DELETE FROM moodboard_category_operations WHERE request_id=$1'])
      await assert.rejects(pool.query(sql, [intent.request_id]), error => error.code === '23514');
  });

  for (const change of ['epoch', 'role', 'inactive']) for (const replay of [false, true]) {
    await t.test(`current actor ${change} while waiting for account mutex rejects ${replay ? 'replay' : 'new write'} without DML`, async () => {
      const actor = actors[0];
      await f.query("UPDATE usuarios SET activo=true,rol='admin',session_version=1 WHERE id=$1", [actor.id]);
      const intent = batch([{ type: 'create', name: `QA118 authority ${change} ${replay}` }], (await read()).revision);
      if (replay) ok(await write(intent, actor.token), 201);
      const locker = await pool.connect(); let pending;
      try {
        await locker.query('BEGIN');
        await locker.query('SELECT pg_advisory_xact_lock(20261019,1)');
        const pid = (await locker.query('SELECT pg_backend_pid() pid')).rows[0].pid;
        pending = write(intent, actor.token).then(value => ({ value }), error => ({ error }));
        const waiting = await waitBlocked(pid); assert.ok(waiting.length > 0);
        await locker.query(`UPDATE usuarios SET ${change === 'epoch' ? 'session_version=2' : change === 'role' ? "rol='edicion'" : 'activo=false'} WHERE id=$1`, [actor.id]);
        await locker.query('COMMIT');
        const before = await snapshot(), result = await pending;
        if (result.error) throw result.error;
        ok(result.value, 401); assert.deepEqual(await snapshot(), before);
      } finally {
        await locker.query('ROLLBACK').catch(() => {}); await pending; locker.release();
        await f.query("UPDATE usuarios SET activo=true,rol='admin',session_version=1 WHERE id=$1", [actor.id]);
      }
    });
  }

  await t.test('service captures original actor and frozen intent before a delayed real lease, never caller-mutated replacements', async () => {
    const actor = actors[1], current = await read();
    let reached, resume;
    const ready = new Promise(resolve => { reached = resolve; }), gate = new Promise(resolve => { resume = resolve; });
    const wrapper = { connect: async () => { reached(); await gate; return pool.connect(); } };
    const auth = { id: actor.id, rol: actor.role, session_version: 1 };
    const body = batch([{ type: 'create', name: 'QA118 original immutable intent' }], current.revision);
    const originalKey = body.request_id;
    const pending = applyMoodboardCategoryChanges(wrapper, auth, String(boards[0].id), body);
    await ready;
    auth.id = 91001; auth.rol = 'admin'; auth.session_version = 2;
    body.changes[0].name = 'QA118 caller mutation must not win'; body.request_id = randomUUID();
    resume();
    const saved = assertSnapshot(await pending, boards[0].id, true);
    assert.equal(saved.operation.request_id, originalKey);
    assert.equal(saved.categories.filter(row => row.nombre === 'QA118 original immutable intent').length, 1);
    assert.equal(saved.categories.some(row => row.nombre === 'QA118 caller mutation must not win'), false);
    const [receipt] = await f.query('SELECT actor_user_id FROM moodboard_category_operations WHERE request_id=$1', [originalKey]);
    assert.equal(receipt.actor_user_id, actor.id);
    for (const operation of ['read', 'write']) {
      let acquired, release;
      const waiting = new Promise(resolve => { acquired = resolve; }), hold = new Promise(resolve => { release = resolve; });
      const delayed = { connect: async () => { acquired(); await hold; return pool.connect(); } };
      const observed = { id: actor.id, rol: actor.role, session_version: 1 };
      const result = operation === 'read' ? readMoodboardCategorySnapshot(delayed, observed, String(boards[0].id))
        : applyMoodboardCategoryChanges(delayed, observed, String(boards[0].id), batch([{ type: 'create', name: 'QA118 obsolete lease' }], saved.revision));
      const checked = assert.rejects(result, error => error.status === 401);
      await waiting;
      try {
        await f.query('UPDATE usuarios SET session_version=2 WHERE id=$1', [actor.id]);
        observed.id = 91001; observed.rol = 'admin'; observed.session_version = 2;
        const before = await snapshot(); release(); await checked; assert.deepEqual(await snapshot(), before);
      } finally { release(); await checked; await f.query('UPDATE usuarios SET session_version=1 WHERE id=$1', [actor.id]); }
    }
  });
});
