import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseTaskOrderRead, readTaskBoardPage } from '../src/task-board-page.js';

test('manual task page query is closed and snapshot token is never accepted for another sort/workspace', () => {
  assert.deepEqual(parseTaskOrderRead(), { sort: 'date', snapshot: undefined });
  assert.equal(parseTaskOrderRead({ workspace: 'render_os', sort: 'manual', expected_snapshot: 'a'.repeat(64) }).sort, 'manual');
  for (const query of [{ sort: [] }, { sort: 'manual' }, { sort: 'custom' }, { expected_snapshot: 'a'.repeat(64) },
    { workspace: 'render_os', sort: 'manual', expected_snapshot: ['a'.repeat(64)] },
    { workspace: 'render_os', sort: 'manual', expected_snapshot: 'a'.repeat(64) + '\n' }])
    assert.throws(() => parseTaskOrderRead(query), { status: 400 });
});

function fixture({ changed = false, missingActor = false, failRollback = false, empty = false, rowExtras = {} } = {}) {
  const calls = [], release = [], actor = { id: 7, rol: 'edicion', activo: true, session_version: 2 };
  const db = { release: error => release.push(error), async query(sql, params) {
    calls.push({ sql, params });
    if (sql.startsWith('BEGIN') || sql === 'COMMIT') return { rows: [] };
    if (sql === 'ROLLBACK') { if (failRollback) throw new Error('rollback broken'); return { rows: [] }; }
    if (sql.includes('FROM usuarios')) return { rows: missingActor ? [] : [actor] };
    if (sql.startsWith('SELECT revision::text')) return { rows: [{ revision: '3', task_ids: [4, 2] }] };
    if (sql.startsWith('SELECT COUNT(*)')) return { rows: [{ total: empty ? 0 : 2, signature: empty ? '[]' : changed ? '[[2,9],[4,1]]' : '[[2,1],[4,1]]' }] };
    const rows = empty ? [] : [{ id: 4, revision: 1, total_count: 2, ...rowExtras }, { id: 2, revision: 1, total_count: 2, ...rowExtras }];
    return { rows: rows.slice(params.at(-1), params.at(-1) + params.at(-2)) };
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
for (const empty of [false, true]) test(`exact query and typed filter parameters bind snapshot even with ${empty ? 'both collections empty' : 'identical IDs/revisions/memberships'}`, async () => {
  const baseline = await readTaskBoardPage(fixture({ empty }).options);
  for (const change of [
    { query: 'SELECT t.id,t.revision FROM tareas t WHERE t.id>=$1' },
    { params: [1] },
    { params: ['0'] },
  ]) {
    const f = fixture({ empty });
    await assert.rejects(readTaskBoardPage({ ...f.options, ...change, expectedSnapshot: baseline.snapshot }), { status: 409 });
    assert.equal(f.calls.at(-1).sql, 'ROLLBACK');
    assert.ok(!f.calls.some(row => row.sql.includes('LIMIT $')));
    assert.deepEqual(f.release, [undefined]);
  }
});
test('same exact collection accepts different page sizes and offsets without changing snapshot', async () => {
  const f = fixture(), first = await readTaskBoardPage({ ...f.options, limit: 1 });
  assert.deepEqual(first.items.map(row => row.id), [4]);
  const next = fixture(), second = await readTaskBoardPage({ ...next.options, limit: 1, offset: 1, expectedSnapshot: first.snapshot });
  assert.deepEqual(second.items.map(row => row.id), [2]);
  const whole = await readTaskBoardPage({ ...fixture().options, limit: 2, expectedSnapshot: first.snapshot });
  assert.deepEqual(whole.items.map(row => row.id), [4, 2]);
  assert.equal(second.snapshot, first.snapshot); assert.equal(whole.snapshot, first.snapshot);
  assert.equal(second.total, first.total); assert.equal(whole.total, first.total);
  assert.deepEqual(next.calls.at(-2).params, [0, [4, 2], 1, 1]);
});
test('bound array filter values cannot change while the observed collection remains identical', async () => {
  const f = fixture(), query = 'SELECT t.id,t.revision FROM tareas t WHERE t.estado=ANY($1::text[])';
  const first = await readTaskBoardPage({ ...f.options, query, params: [['en_revision', 'aprobada']] });
  await assert.rejects(readTaskBoardPage({ ...fixture().options, query, params: [['en_revision']], expectedSnapshot: first.snapshot }), { status: 409 });
});
test('row payload/financial metadata never influence the snapshot; legacy unbound tokens require explicit refresh', async () => {
  const first = await readTaskBoardPage(fixture().options);
  const privateRows = fixture({ rowExtras: { propiedades_extra: { financial: { amount: 918273.45 } }, titulo: 'Private changed payload' } });
  assert.equal((await readTaskBoardPage({ ...privateRows.options, expectedSnapshot: first.snapshot })).snapshot, first.snapshot);
  const legacy = createHash('sha256').update(JSON.stringify({ actor: 7, role: 'edicion', session_version: 2,
    revision: '3', ids: [4, 2], signature: '[[2,1],[4,1]]' })).digest('hex');
  const f = fixture();
  await assert.rejects(readTaskBoardPage({ ...f.options, expectedSnapshot: legacy }), { status: 409 });
  assert.equal(f.calls.at(-1).sql, 'ROLLBACK');
  assert.ok(!f.calls.some(row => row.sql.includes('LIMIT $')));
});
test('failed rollback removes unconfirmed transaction connection from the pool', async () => {
  const f = fixture({ missingActor: true, failRollback: true });
  await assert.rejects(readTaskBoardPage(f.options), { status: 401 });
  assert.equal(f.release[0]?.message, 'rollback broken');
});
