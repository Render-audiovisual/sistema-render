import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeMoodboards } from '../src/moodboards.js';
const actor = { id: 7, activo: true, session_version: 1 };
function fixture({ current = actor, failCategory = false } = {}) {
  const sql = []; let released = 0;
  const client = { async query(query) {
    sql.push(query);
    if (query.includes('FROM usuarios')) return { rows: current ? [current] : [] };
    if (query.includes('FROM clientes')) return { rows: [{ id: 11, nombre: 'Synthetic brand' }] };
    if (query.includes('SELECT board_id') || query.includes('SELECT id FROM moodboard_boards')) return { rowCount: 0, rows: [] };
    if (query.includes('INSERT INTO moodboard_boards')) return { rows: [{ id: 19 }] };
    if (failCategory && query.includes('INSERT INTO moodboard_categories')) throw Error('synthetic transaction failure');
    return { rows: [], rowCount: 1 };
  }, release() { released++; } };
  return { sql, get released() { return released; }, pool: { connect: async () => client } };
}
test('explicit initialization serializes, locks current actor/clients, creates defaults but no fictional references', async () => {
  const f = fixture(); assert.deepEqual(await initializeMoodboards(f.pool, actor), { ok: true });
  assert.equal(f.sql[0], 'BEGIN'); assert.match(f.sql[1], /pg_advisory_xact_lock/);
  assert.match(f.sql[2], /usuarios.*FOR SHARE/); assert.equal(f.sql.at(-1), 'COMMIT'); assert.equal(f.released, 1);
  assert.equal(f.sql.filter(sql => sql.includes('INSERT INTO moodboard_categories')).length, 7);
  const boardLock = f.sql.findIndex(sql => sql.includes('FOR NO KEY UPDATE'));
  assert.ok(boardLock > 2);
  assert.ok(boardLock < f.sql.findIndex(sql => sql.includes('INSERT INTO moodboard_categories')));
  assert.ok(!f.sql.some(sql => sql.includes('moodboard_references')));
});
test('failed initialization rolls back and releases its connection', async () => {
  const f = fixture({ failCategory: true }); await assert.rejects(initializeMoodboards(f.pool, actor), /synthetic transaction failure/);
  assert.equal(f.sql.at(-1), 'ROLLBACK'); assert.ok(!f.sql.includes('COMMIT')); assert.equal(f.released, 1);
});
test('revoked/inactive/missing actor cannot initialize or query clients', async () => {
  for (const current of [null, { ...actor, activo: false }, { ...actor, session_version: 2 }]) {
    const f = fixture({ current }); await assert.rejects(initializeMoodboards(f.pool, actor), error => error.status === 401);
    assert.equal(f.sql.at(-1), 'ROLLBACK'); assert.ok(!f.sql.some(sql => sql.includes('FROM clientes'))); assert.equal(f.released, 1);
  }
  await assert.rejects(initializeMoodboards({ connect: () => assert.fail('no connection') }, null), error => error.status === 401);
});
