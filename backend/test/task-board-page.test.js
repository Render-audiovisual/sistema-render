import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskOrderRead, readTaskBoardPage } from '../src/task-board-page.js';

test('manual task page query is closed and snapshot token is never accepted for another sort/workspace', () => {
  assert.deepEqual(parseTaskOrderRead(), { sort: 'date', snapshot: undefined });
  assert.equal(parseTaskOrderRead({ workspace: 'render_os', sort: 'manual', expected_snapshot: 'a'.repeat(64) }).sort, 'manual');
  for (const query of [{ sort: [] }, { sort: 'manual' }, { sort: 'custom' }, { expected_snapshot: 'a'.repeat(64) },
    { workspace: 'render_os', sort: 'manual', expected_snapshot: ['a'.repeat(64)] },
    { workspace: 'render_os', sort: 'manual', expected_snapshot: 'a'.repeat(64) + '\n' }])
    assert.throws(() => parseTaskOrderRead(query), { status: 400 });
});

function fixture({ changed = false, missingActor = false, failRollback = false } = {}) {
  const calls = [], release = [], actor = { id: 7, rol: 'edicion', activo: true, session_version: 2 };
  const db = { release: error => release.push(error), async query(sql, params) {
    calls.push({ sql, params });
    if (sql.startsWith('BEGIN') || sql === 'COMMIT') return { rows: [] };
    if (sql === 'ROLLBACK') { if (failRollback) throw new Error('rollback broken'); return { rows: [] }; }
    if (sql.includes('FROM usuarios')) return { rows: missingActor ? [] : [actor] };
    if (sql.startsWith('SELECT revision::text')) return { rows: [{ revision: '3', task_ids: [4, 2] }] };
    if (sql.startsWith('SELECT COUNT(*)')) return { rows: [{ total: 2, signature: changed ? '[[2,9],[4,1]]' : '[[2,1],[4,1]]' }] };
    return { rows: [{ id: 4, revision: 1, total_count: 2 }, { id: 2, revision: 1, total_count: 2 }] };
  } };
  const options = { pool: { connect: async () => db }, query: 'SELECT t.id,t.revision FROM tareas t WHERE t.id>$1',
    params: [0], limit: 2, offset: 0, auth: actor, serialize: async (client, rows) => { assert.equal(client, db); return rows; } };
  return { calls, release, options };
}
test('manual task page observes version/membership/page/assignment projection in one read-only snapshot', async () => {
  const f = fixture(), result = await readTaskBoardPage(f.options);
  assert.equal(result.orderRevision, '3'); assert.match(result.snapshot, /^[0-9a-f]{64}$/);
  assert.deepEqual(result.items.map(row => row.id), [4, 2]); assert.equal(result.total, 2);
  assert.equal(f.calls[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(f.calls.at(-1).sql, 'COMMIT');
  assert.match(f.calls.at(-2).sql, /unnest\(\$2::integer\[\]\) WITH ORDINALITY/);
  assert.match(f.calls.at(-2).sql, /ORDER BY p.position ASC NULLS LAST/);
  assert.doesNotMatch(f.calls.at(-2).sql, /array_position/);
  assert.deepEqual(f.calls.at(-2).params, [0, [4, 2], 2, 0]);
  assert.ok(f.calls.some(row => row.sql.includes('ta.usuario_id,ta.tipo')));
  assert.ok(!f.calls.some(row => /FOR SHARE|FOR UPDATE|^(INSERT|UPDATE|DELETE)/.test(row.sql)));
  assert.deepEqual(f.release, [undefined]);
});
test('changed page snapshot fails before returning another page; no implicit new observation', async () => {
  const baseline = await readTaskBoardPage(fixture().options), f = fixture({ changed: true });
  await assert.rejects(readTaskBoardPage({ ...f.options, offset: 2, expectedSnapshot: baseline.snapshot }), { status: 409 });
  assert.equal(f.calls.at(-1).sql, 'ROLLBACK');
  assert.ok(!f.calls.some(row => row.sql.includes('LIMIT $')));
});
test('later manual pages need a snapshot and obsolete actors cannot read collections', async () => {
  const f = fixture();
  await assert.rejects(readTaskBoardPage({ ...f.options, offset: 2 }), { status: 400 });
  assert.equal(f.calls.length, 0);
  const missing = fixture({ missingActor: true });
  await assert.rejects(readTaskBoardPage(missing.options), { status: 401 });
  assert.ok(!missing.calls.some(row => row.sql.startsWith('SELECT revision::text')));
});
test('failed rollback removes unconfirmed transaction connection from the pool', async () => {
  const f = fixture({ missingActor: true, failRollback: true });
  await assert.rejects(readTaskBoardPage(f.options), { status: 401 });
  assert.equal(f.release[0]?.message, 'rollback broken');
});
