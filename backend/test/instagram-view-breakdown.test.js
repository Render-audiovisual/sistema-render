import test from 'node:test';
import assert from 'node:assert/strict';
import { VIEWS_ACTION, readViewBreakdowns } from '../src/instagram-view-breakdown.js';

const row = () => ({ ig_media_id: '123', ig_user_id: '456', cliente_id: 7,
  medido_at: '2026-11-03T12:00:00.123Z', vistas: 40 });
const snapshot = (changes = {}) => ({ version: 1, igMediaId: '123', igUserId: '456', clientId: 7,
  measuredAt: row().medido_at, instagram: 60, facebook: 20, total: 80, ...changes });
function database(values = []) {
  const calls = [];
  return { calls, async query(...args) { calls.push(args); return { rows: values.map(detalles => ({ detalles })) }; } };
}
const counts = value => [value.vistas, value.vistas_instagram, value.vistas_facebook, value.vistas_total];

test('one scoped query, newest valid binding wins, copies preserve input', async () => {
  const input = Object.freeze(row());
  const db = database([snapshot(), snapshot({ total: 70 })]);
  const result = await readViewBreakdowns(db, [input, input]);
  assert.deepEqual(counts(result[0]), [80, 60, 20, 80]);
  assert.notEqual(result[0], input);
  assert.equal(input.vistas, 40);
  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0][1], [VIEWS_ACTION, ['123']]);
  for (const clause of ["integracion='instagram_graph'", "canal='system'", "actor_id='render-worker'", "resultado='ok'", 'accion=$1', "detalles->>'igMediaId'=ANY($2::text[])", 'ORDER BY id DESC'])
    assert.ok(db.calls[0][0].includes(clause));
});

test('binds account, client, media and exact measurement, never older/newer', async () => {
  for (const changes of [{ igMediaId: '999' }, { igUserId: '999' }, { clientId: 8 }, { clientId: '7' },
    { measuredAt: '2026-11-03T11:00:00.123Z' }, { measuredAt: '2026-11-03T13:00:00.123Z' },
    { measuredAt: '2026-11-03T12:00:00.123001Z' }, { measuredAt: null }, { measuredAt: '2026-02-30T12:00:00Z' }]) {
    const [result] = await readViewBreakdowns(database([snapshot(changes)]), [row()]);
    assert.deepEqual(counts(result), [40, 40, null, null]);
  }
});

test('equivalent offset/Date timestamps bind without dropping fractional precision', async () => {
  const [result] = await readViewBreakdowns(database([snapshot({ measuredAt: '2026-11-03T09:00:00.123000-03:00' })]),
    [{ ...row(), medido_at: new Date(row().medido_at) }]);
  assert.deepEqual(counts(result), [80, 60, 20, 80]);
});

test('malformed numeric snapshots are ignored, including missing fields', async () => {
  for (const key of ['instagram', 'facebook', 'total']) for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '20', undefined, {}, false]) {
    const [result] = await readViewBreakdowns(database([snapshot({ [key]: value })]), [row()]);
    assert.deepEqual(counts(result), [40, 40, null, null]);
  }
  const [result] = await readViewBreakdowns(database([null, {}, snapshot({ version: 2 }), snapshot()]), [row()]);
  assert.equal(result.vistas_total, 80);
});

test('no double count, derive only Instagram and never invent combined total', async () => {
  for (const [changes, expected] of [
    [{ instagram: null }, [80, 60, 20, 80]],
    [{ instagram: null, total: 10 }, [10, 40, 20, 10]],
    [{ total: null }, [40, 60, 20, null]],
    [{ instagram: null, facebook: null, total: null }, [40, 40, null, null]],
    [{ instagram: 0, facebook: 0, total: 0 }, [0, 0, 0, 0]],
  ]) {
    const [result] = await readViewBreakdowns(database([snapshot(changes)]), [row()]);
    assert.deepEqual(counts(result), expected);
  }
});

test('missing measurements remain null; no query for empty or unbound input', async () => {
  const db = database();
  assert.deepEqual(await readViewBreakdowns(db, []), []);
  const [missing] = await readViewBreakdowns(db, [{ ...row(), medido_at: null, vistas: null }]);
  assert.deepEqual(counts(missing), [null, null, null, null]);
  assert.equal(db.calls.length, 0);
  const [unavailable] = await readViewBreakdowns(database(), [{ ...row(), vistas: undefined }]);
  assert.deepEqual(counts(unavailable), [null, null, null, null]);
});

test('dedupe does not cross clients, accounts, or measurements', async () => {
  const rows = [row(), { ...row(), cliente_id: 8 }, { ...row(), ig_user_id: '999' },
    { ...row(), medido_at: '2026-11-03T13:00:00Z' }];
  const db = database([snapshot(), snapshot({ clientId: 8, total: 90 }), snapshot({ igUserId: '999', total: 100 }),
    snapshot({ measuredAt: rows[3].medido_at, total: 110 })]);
  assert.deepEqual((await readViewBreakdowns(db, rows)).map(r => r.vistas_total), [80, 90, 100, 110]);
  assert.equal(db.calls.length, 1);
});
