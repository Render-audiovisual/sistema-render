import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTaskComment, findTaskCommentCreation } from '../src/task-comment-receipts.js';

const key = '11111111-2222-4333-8444-555555555555';
const auth = extra => ({ id: 7, session_version: 3, rol: 'diseno', nombre: 'Untrusted cached label', ...extra });
const input = extra => ({ taskId: 9, workspace: 'render_os', requestId: key, payload: { autor: 'Ignored cached author', contenido: '  A  ' }, ...extra });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const status = expected => error => error.status === expected;

// Real service; transactional rows and UUID mutex modeled in memory. This does
// not claim PostgreSQL lock/FK/trigger or HTTP middleware verification.
function fixture({ actor = { ...auth(), activo: true, nombre: 'Current DB actor', usuario: 'db_actor' },
  task = { id: 9, workspace: 'render_os' }, assigned = true, failAt, rollbackFails = false,
  leaseGate, taskLocked, commentGate } = {}) {
  const calls = [], releases = [], comments = [], receipts = [], locks = new Map();
  const failure = new Error('Original query failure'), rollbackError = new Error('Rollback failure');
  let leases = 0, nextId = 20, user = actor, access = assigned;
  const pool = { async connect() {
    const lease = ++leases; if (leaseGate) await leaseGate.promise;
    const pendingComments = [], pendingReceipts = []; let unlock;
    function releaseMutex() { unlock?.(); unlock = null; }
    return { async query(sql, params = []) {
      sql = sql.replace(/\s+/g, ' ').trim(); calls.push({ lease, sql, params: structuredClone(params) });
      if (sql === 'ROLLBACK') {
        pendingComments.length = 0; pendingReceipts.length = 0; releaseMutex();
        if (rollbackFails) throw rollbackError;
        return { rows: [] };
      }
      if (failAt && sql.startsWith(failAt)) throw failure;
      if (sql.startsWith('BEGIN')) return { rows: [] };
      if (sql === 'COMMIT') { comments.push(...pendingComments); receipts.push(...pendingReceipts); releaseMutex(); return { rows: [] }; }
      if (sql.startsWith('SELECT id,rol,activo,session_version')) return { rows: user ? [structuredClone(user)] : [] };
      if (sql.startsWith('SELECT pg_advisory_xact_lock')) {
        const previous = locks.get(params[0]) ?? Promise.resolve(), next = deferred();
        const tail = previous.then(() => next.promise); locks.set(params[0], tail);
        await previous; unlock = next.resolve; return { rows: [] };
      }
      if (sql.startsWith('SELECT id FROM tareas')) {
        if (taskLocked) await taskLocked();
        const workspaceMatches = sql.includes("IS DISTINCT FROM 'render_os'") ? task?.workspace !== 'render_os' : task?.workspace === 'render_os';
        return { rows: task && task.id === params[0] && workspaceMatches ? [{ id: task.id }] : [] };
      }
      if (sql.startsWith('SELECT t.id FROM tareas')) return { rows: !sql.includes('tarea_asignaciones') || access ? [{ id: params[0] }] : [] };
      if (sql.includes('FROM task_comment_create_receipts')) return { rows: receipts.filter(r => r.actor_user_id === params[0] && r.request_id === params[1]) };
      if (sql.includes('FROM tarea_comentarios')) return { rows: comments.filter(r => r.id === params[0] && r.tarea_id === params[1]) };
      if (sql.startsWith('INSERT INTO tarea_comentarios')) {
        if (commentGate) await commentGate.promise;
        const row = { id: ++nextId, tarea_id: params[0], autor: params[1], contenido: params[2], created_at: '2026-10-24T12:00:00.123Z' };
        pendingComments.push(row); return { rows: [{ ...row, private_finance: 'Not a DTO field' }] };
      }
      if (sql.startsWith('INSERT INTO task_comment_create_receipts')) {
        const [actor_user_id, request_id, payload_hash, tarea_id, comment_id, workspace] = params;
        pendingReceipts.push({ actor_user_id, request_id, payload_hash, tarea_id, comment_id, workspace }); return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }, release(discard) { releaseMutex(); releases.push({ lease, discard }); } };
  }, query() { throw new Error('Query escaped leased connection'); } };
  return { pool, calls, releases, comments, receipts, failure, rollbackError,
    get leases() { return leases; }, setActor(value) { user = value; }, setAssigned(value) { access = value; } };
}
const create = (f, body = input(), actor = auth()) => createTaskComment(f.pool, actor, body);
const lookup = (f, body = input(), actor = auth()) => findTaskCommentCreation(f.pool, actor, body);
function rollback(f) { assert.equal(f.calls.at(-1).sql, 'ROLLBACK'); assert.equal(f.calls.some(c => c.sql === 'COMMIT'), false); assert.equal(f.releases.length, 1); }

test('new/replay/recovery share current authority and return only operational comment fields', async () => {
  const f = fixture(), first = await create(f);
  assert.deepEqual(first, { comment: f.comments[0], requestId: key, replayed: false });
  assert.equal(first.comment.autor, 'Current DB actor'); assert.equal(first.comment.contenido, 'A');
  assert.deepEqual(await create(f), { ...first, replayed: true });
  assert.deepEqual(await lookup(f), { ...first.comment, creation_request_id: key });
  assert.equal(f.comments.length, 1); assert.equal(f.receipts.length, 1);
  assert.match(f.receipts[0].payload_hash, /^[a-f0-9]{64}$/);
  assert.equal(f.calls.filter(c => c.sql.startsWith('INSERT INTO tarea_comentarios')).length, 1);
  assert.ok(f.releases.every(r => r.discard === undefined));
});

test('lock order is READ COMMITTED, user SHARE, actor/key mutex, task SHARE, then fresh stable-ID assignment ACL', async () => {
  const f = fixture(); await create(f);
  const sql = f.calls.map(c => c.sql);
  assert.equal(sql[0], 'BEGIN ISOLATION LEVEL READ COMMITTED'); assert.match(sql[1], /FROM usuarios WHERE id=\$1 FOR SHARE$/);
  assert.match(sql[2], /^SELECT pg_advisory_xact_lock/); assert.deepEqual(JSON.parse(f.calls[2].params[0]), ['task-comment-create-v1', 7, key]);
  assert.match(sql[3], /FROM tareas WHERE id=\$1.*workspace.*FOR SHARE$/); assert.doesNotMatch(sql[3], /tarea_asignaciones/);
  assert.match(sql[4], /tarea_asignaciones ta.*ta.tarea_id = t.id AND ta.usuario_id = \$2::integer/);
  assert.deepEqual(f.calls[4].params, [9, 7]);
  assert.equal(sql.at(-1), 'COMMIT');
});

test('fresh ACL sees assignment withdrawal after task lock and never inserts or reads receipt', async () => {
  let f; f = fixture({ taskLocked: () => f.setAssigned(false) });
  await assert.rejects(create(f), status(404)); rollback(f);
  assert.equal(f.calls.some(c => /INSERT|FROM task_comment_create_receipts/.test(c.sql)), false);
});

test('legacy POST uses same authorization/normalizer but no key, receipt, or deduplication by text', async () => {
  const f = fixture();
  const first = await create(f, input({ requestId: undefined })), second = await create(f, input({ requestId: undefined }));
  assert.equal(first.requestId, null); assert.equal(second.replayed, false); assert.notEqual(first.comment.id, second.comment.id);
  assert.equal(f.comments.length, 2); assert.deepEqual(f.receipts, []);
  assert.equal(f.calls.some(c => /pg_advisory|task_comment_create_receipts/.test(c.sql)), false);
  const denied = fixture({ assigned: false }); await assert.rejects(create(denied, input({ requestId: undefined })), status(404));
});

test('different UUIDs deliberately create identical text; UUIDs normalize case and remain actor-scoped', async () => {
  const f = fixture(), otherKey = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const a = await create(f), b = await create(f, input({ requestId: otherKey.toUpperCase() }));
  assert.notEqual(a.comment.id, b.comment.id); assert.equal(b.requestId, otherKey);
  assert.equal((await create(f, input({ requestId: otherKey }))).comment.id, b.comment.id);
  f.setActor({ ...auth({ id: 8 }), activo: true, nombre: 'Other actor' });
  await assert.rejects(lookup(f, input(), auth({ id: 8 })), status(404));
  const c = await create(f, input(), auth({ id: 8 })); assert.notEqual(c.comment.id, a.comment.id);
});

test('hash binds trimmed content/task/workspace/admin author, not employee cached or DB labels', async () => {
  const f = fixture(); const first = await create(f);
  f.setActor({ ...auth(), activo: true, nombre: 'Renamed DB actor' });
  const replay = await create(f, input({ payload: { autor: { malicious: true }, contenido: 'A' } }));
  assert.equal(replay.comment.autor, first.comment.autor); assert.equal(replay.replayed, true);
  await assert.rejects(create(f, input({ payload: { contenido: 'B' } })), status(409));
  const admin = fixture({ actor: { ...auth({ rol: 'admin' }), activo: true } });
  await create(admin, input({ payload: { autor: ' Leader ', contenido: ' A ' } }), auth({ rol: 'admin' }));
  assert.equal((await create(admin, input({ payload: { autor: 'Leader', contenido: 'A' } }), auth({ rol: 'admin' }))).replayed, true);
  await assert.rejects(create(admin, input({ payload: { autor: 'Other', contenido: 'A' } }), auth({ rol: 'admin' })), status(409));
});

test('receipt bound to another path is 404 for GET and 409 for POST, never retargeted', async () => {
  const f = fixture(); await create(f); f.receipts[0].tarea_id = 10;
  await assert.rejects(lookup(f), status(404)); await assert.rejects(create(f), status(409));
  f.receipts[0].tarea_id = 9; f.receipts[0].workspace = 'historical';
  await assert.rejects(lookup(f), status(404)); await assert.rejects(create(f), status(409));
  assert.equal(f.comments.length, 1);
});

test('missing receipt is 404; deleted comment tombstone is 409 for recovery and replay without recreation', async () => {
  const f = fixture(); await assert.rejects(lookup(f), status(404)); await create(f);
  f.comments.length = 0;
  await assert.rejects(lookup(f), status(409)); await assert.rejects(create(f), status(409));
  assert.equal(f.comments.length, 0); assert.equal(f.receipts.length, 1);
});

test('historical workspace uses IS DISTINCT FROM and both read/write recheck assignment; admin bypass is only DB-verified role', async () => {
  const f = fixture({ task: { id: 9, workspace: null } });
  await create(f, input({ workspace: 'historical' })); await lookup(f, input({ workspace: 'historical' }));
  assert.ok(f.calls.filter(c => c.sql.startsWith('SELECT id FROM tareas')).every(c => c.sql.includes("IS DISTINCT FROM 'render_os'")));
  f.setAssigned(false); await assert.rejects(lookup(f, input({ workspace: 'historical' })), status(404));
  await assert.rejects(create(f, input({ workspace: 'render_os' })), status(404));
  const admin = fixture({ assigned: false, actor: { ...auth({ rol: 'admin' }), activo: true } });
  const result = await create(admin, input({ payload: { autor: 'Admin author', contenido: 'A' } }), auth({ rol: 'admin' }));
  assert.equal(result.comment.autor, 'Admin author');
  assert.deepEqual(admin.calls.find(c => c.sql.startsWith('SELECT t.id')).params, [9]);
});

for (const patch of [{ id: 0 }, { id: '7' }, { id: 2147483648 }, { session_version: 0 }, { session_version: '3' }, { session_version: 2147483648 }, { rol: '' }, { rol: 4 }]) {
  test(`invalid actor rejected before pool lease: ${JSON.stringify(patch)}`, async () => {
    const f = fixture(); await assert.rejects(create(f, input(), auth(patch)), status(401)); await assert.rejects(lookup(f, input(), auth(patch)), status(401)); assert.equal(f.leases, 0);
  });
}
test('invalid context/key/payload rejected before lease; missing GET key is 428 and no new text cap', async () => {
  const f = fixture();
  for (const fields of [{ taskId: '9' }, { taskId: 0 }, { taskId: 2147483648 }, { workspace: 'other' }, { requestId: null }, { requestId: '' }, { requestId: 'not-uuid' },
    { payload: null }, { payload: [] }, { payload: { contenido: 42 } }, { payload: { contenido: '  ' } }, { payload: { contenido: 'A\u0000' } }, { payload: { contenido: 'A', extra: 1 } }]) {
    await assert.rejects(create(f, input(fields)), status(400));
  }
  await assert.rejects(lookup(f, input({ requestId: undefined })), status(428)); assert.equal(f.leases, 0);
  await assert.rejects(create(f, input({ payload: { autor: '', contenido: 'A' } }), auth({ rol: 'admin' })), status(400));
  const long = 'x'.repeat(25000); await create(f, input({ payload: { contenido: long } })); assert.equal(f.comments[0].contenido, long);
});

for (const actor of [null, { ...auth(), activo: false }, { ...auth(), activo: 'true' }, { ...auth(), activo: true, id: 8 }, { ...auth(), activo: true, rol: 'admin' }, { ...auth(), activo: true, session_version: 4 }]) {
  test(`locked authority mismatch fails 401 before task/mutex/domain: ${JSON.stringify(actor)}`, async () => {
    const f = fixture({ actor }); await assert.rejects(create(f), status(401)); rollback(f);
    assert.equal(f.calls.some(c => /FROM tareas|pg_advisory|INSERT/.test(c.sql)), false);
  });
}

test('actor/input mutate during pool wait but immutable original binding/hash/author/content wins', async () => {
  const leaseGate = deferred(), f = fixture({ leaseGate, actor: { ...auth({ rol: 'admin' }), activo: true } });
  const actor = auth({ rol: 'admin' }), body = input({ payload: { autor: 'Held admin', contenido: ' Held comment ' } });
  const pending = create(f, body, actor);
  Object.assign(actor, { id: 8, rol: 'diseno', session_version: 99 }); Object.assign(body, { taskId: 10, workspace: 'historical', requestId: 'invalid' });
  Object.assign(body.payload, { autor: 'Mutated', contenido: 'Mutated' }); leaseGate.resolve();
  const result = await pending;
  assert.equal(result.comment.autor, 'Held admin'); assert.equal(result.comment.contenido, 'Held comment'); assert.equal(result.requestId, key);
  assert.deepEqual(f.calls[1].params, [7]); assert.equal(f.receipts[0].tarea_id, 9);
});

for (const failAt of ['SELECT id,rol', 'SELECT id FROM tareas', 'SELECT t.id', 'INSERT INTO tarea_comentarios', 'INSERT INTO task_comment_create_receipts', 'COMMIT']) {
  for (const rollbackFails of [false, true]) {
    test(`atomic rollback at ${failAt}, rollback failure=${rollbackFails} preserves original error`, async () => {
      const f = fixture({ failAt, rollbackFails });
      await assert.rejects(create(f), error => error === f.failure);
      assert.deepEqual(f.comments, []); assert.deepEqual(f.receipts, []); assert.equal(f.calls.at(-1).sql, 'ROLLBACK');
      assert.equal(f.releases.length, 1); assert.equal(f.releases[0].discard, rollbackFails ? f.rollbackError : undefined);
    });
  }
}

test('modeled overlapping same-key creates serialize to one row and recovery waits for commit', async () => {
  const gate = deferred(), f = fixture({ commentGate: gate });
  const first = create(f), second = create(f), recovery = lookup(f);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.filter(c => c.sql.startsWith('INSERT INTO tarea_comentarios')).length, 1);
  assert.equal(f.comments.length, 0); gate.resolve();
  const [a, b, found] = await Promise.all([first, second, recovery]);
  assert.equal(a.replayed, false); assert.equal(b.replayed, true); assert.equal(found.id, a.comment.id);
  assert.equal(f.comments.length, 1); assert.equal(f.receipts.length, 1);
});

test('modeled overlapping same-key different payload produces one commit and one conflict, not another comment', async () => {
  const gate = deferred(), f = fixture({ commentGate: gate });
  const first = create(f), second = create(f, input({ payload: { contenido: 'B' } }));
  const rejected = assert.rejects(second, status(409));
  await new Promise(resolve => setImmediate(resolve)); gate.resolve(); await first; await rejected;
  assert.equal(f.comments.length, 1); assert.equal(f.receipts.length, 1); assert.equal(f.comments[0].contenido, 'A');
  assert.equal(f.calls.filter(c => c.sql === 'COMMIT').length, 1); assert.equal(f.calls.filter(c => c.sql === 'ROLLBACK').length, 1);
});

test('recovery rechecks epoch, role and active state even for a valid existing receipt', async () => {
  const f = fixture(); await create(f);
  for (const patch of [{ session_version: 4 }, { rol: 'admin' }, { activo: false }]) {
    f.setActor({ ...auth(), activo: true, ...patch });
    const before = f.calls.length;
    await assert.rejects(lookup(f), status(401));
    assert.equal(f.calls.slice(before).some(c => /FROM tareas|task_comment_create_receipts|tarea_comentarios/.test(c.sql)), false);
  }
  assert.equal(f.comments.length, 1); assert.equal(f.receipts.length, 1);
});

test('employee author falls back to current DB username, ignores cached NUL/invalid author; admin rejects NUL', async () => {
  const f = fixture({ actor: { ...auth(), activo: true, nombre: '   ', usuario: ' current_user ' } });
  const result = await create(f, input({ payload: { autor: '\u0000', contenido: 'A' } }));
  assert.equal(result.comment.autor, 'current_user');
  const admin = fixture();
  await assert.rejects(create(admin, input({ payload: { autor: 'Admin\u0000', contenido: 'A' } }), auth({ rol: 'admin' })), status(400));
  assert.equal(admin.leases, 0);
});

test('actor revocation committed while pool lease waits rejects before any task or insert', async () => {
  const leaseGate = deferred(), f = fixture({ leaseGate }), pending = create(f);
  f.setActor({ ...auth(), activo: true, session_version: 4 }); leaseGate.resolve();
  await assert.rejects(pending, status(401)); rollback(f);
  assert.equal(f.calls.some(c => /FROM tareas|INSERT/.test(c.sql)), false);
});

test('089 adds immutable tombstones without task/comment FKs, content copies, DML or backfill', () => {
  const sql = readFileSync(new URL('../migrations/089_task_comment_create_receipts.sql', import.meta.url), 'utf8');
  assert.match(sql, /PRIMARY KEY\(actor_user_id,request_id\)/);
  assert.match(sql, /actor_user_id INTEGER NOT NULL REFERENCES usuarios\(id\) ON DELETE RESTRICT/);
  assert.match(sql, /tarea_id INTEGER NOT NULL CHECK\(tarea_id>0\)/); assert.match(sql, /comment_id INTEGER NOT NULL CHECK\(comment_id>0\)/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON task_comment_create_receipts/);
  assert.match(sql, /EXECUTE FUNCTION task_comment_create_receipt_immutable\(\)/);
  assert.doesNotMatch(sql, /REFERENCES tareas|REFERENCES tarea_comentarios|INSERT INTO|ALTER TABLE|DROP |contenido TEXT/);
});
