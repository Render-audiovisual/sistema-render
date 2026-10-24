import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCurrentPublicationRecipient } from '../src/publication-recipient-authority.js';

function fixture(rows) {
  const calls = [];
  return { calls, db: { async query(sql, values) {
    calls.push({ sql, values });
    assert.equal(sql, 'SELECT id,nombre,rol,activo FROM usuarios WHERE id=$1 FOR SHARE');
    assert.deepEqual(values, [12]);
    assert.equal(calls.length, 1, 'No follow-up lookup or mutation');
    return { rows };
  } } };
}

for (const rol of ['admin', 'community']) {
  test(`active ${rol} recipient is bound by ID and returned as a frozen non-auth projection`, async () => {
    const row = { id: 12, nombre: 'Same display label', rol, activo: true, session_version: 7 };
    const before = structuredClone(row);
    const f = fixture([row]);
    const result = await assertCurrentPublicationRecipient(f.db, 12);
    assert.deepEqual(result, { id: 12, nombre: 'Same display label' });
    assert.ok(Object.isFrozen(result));
    assert.notEqual(result, row);
    assert.deepEqual(row, before);
    row.nombre = 'Later rename';
    assert.equal(result.nombre, 'Same display label');
    assert.equal(f.calls.length, 1);
  });
}

for (const id of [undefined, null, '12', 0, -1, 1.5, NaN, Infinity, 2147483648, Number.MAX_SAFE_INTEGER, {}, [], true]) {
  test(`invalid publisher ID (${String(id)}) rejects before querying`, async () => {
    let queries = 0;
    await assert.rejects(assertCurrentPublicationRecipient({ query() { queries++; assert.fail('Unexpected query'); } }, id), { status: 400 });
    assert.equal(queries, 0);
  });
}

for (const rows of [
  [],
  [{ id: 12, nombre: 'Publisher', rol: 'community', activo: false }],
  [{ id: 12, nombre: 'Publisher', rol: 'admin', activo: null }],
  ...['edicion', 'diseno', 'produccion', 'administracion', null].map(rol => [{ id: 12, nombre: 'Publisher', rol, activo: true }]),
  [{ id: 13, nombre: 'Same label', rol: 'admin', activo: true }],
  [{ id: '12', nombre: 'Publisher', rol: 'admin', activo: true }],
  [{ id: 12, nombre: 'First', rol: 'admin', activo: true }, { id: 12, nombre: 'Second', rol: 'community', activo: true }],
]) {
  test(`missing, inactive, wrong-role or mismatched row fails closed (${JSON.stringify(rows)})`, async () => {
    const before = structuredClone(rows);
    const f = fixture(rows);
    await assert.rejects(assertCurrentPublicationRecipient(f.db, 12), { status: 400 });
    assert.deepEqual(rows, before);
    assert.equal(f.calls.length, 1);
  });
}

test('positive int32 endpoints are accepted and bound unchanged', async () => {
  for (const id of [1, 2147483647]) {
    let queries = 0;
    const result = await assertCurrentPublicationRecipient({ async query(sql, values) {
      queries++;
      assert.equal(sql, 'SELECT id,nombre,rol,activo FROM usuarios WHERE id=$1 FOR SHARE');
      assert.deepEqual(values, [id]);
      return { rows: [{ id, nombre: 'Publisher', rol: 'community', activo: true }] };
    } }, id);
    assert.equal(result.id, id);
    assert.equal(queries, 1);
  }
});

test('database errors propagate unchanged without fallback or follow-up', async () => {
  const sentinel = new Error('Database unavailable');
  let queries = 0;
  await assert.rejects(assertCurrentPublicationRecipient({ async query() { queries++; throw sentinel; } }, 12), error => error === sentinel);
  assert.equal(queries, 1);
});
