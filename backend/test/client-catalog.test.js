import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClientCatalogSnapshot, CLIENT_CATALOG_SQL } from '../src/client-catalog.js';
import { clientOperationalDto } from '../src/operational-dto.js';

const auth = () => ({ id: 7, rol: 'admin', session_version: 3, nombre: 'Untrusted HTTP name' });
const row = () => ({ id: 19, nombre: 'Synthetic client', activo: true, cuota_reels: 2, cuota_carruseles: 1,
  configuracion_completa: true, dias_historias: [1, 3], abono_mensual: '123.45', agreement_revision: 'private-canary',
  unknown_private: 'never staff' });
function fixture({ actor = { id: 7, rol: 'admin', activo: true, session_version: 3 }, rows = [row()], fault, rollbackFault, onConnect } = {}) {
  const calls = [], releases = []; let connects = 0;
  const db = { async query(sql, values) {
    calls.push({ sql, values });
    if (sql === 'ROLLBACK' && rollbackFault) throw rollbackFault;
    if (fault && fault(sql)) throw fault.error;
    if (sql.startsWith('SELECT id,rol,activo,session_version FROM usuarios')) return { rows: actor ? [actor] : [] };
    if (sql === CLIENT_CATALOG_SQL) return { rows };
    assert.ok(['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', 'COMMIT', 'ROLLBACK'].includes(sql), 'Unexpected SQL');
    return { rows: [] };
  }, release(error) { releases.push(error); } };
  const pool = { async connect() { connects++; await onConnect?.(); return db; }, query() { assert.fail('No pool query outside the snapshot'); } };
  return { pool, calls, releases, get connects() { return connects; } };
}

test('catalog reads actor then commercial rows in one RR readonly transaction and commits before release', async () => {
  const rows = [row()], f = fixture({ rows });
  const result = await loadClientCatalogSnapshot(f.pool, auth(), '2026-10-01');
  assert.deepEqual(f.calls.map(c => c.sql), ['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    'SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1', CLIENT_CATALOG_SQL, 'COMMIT']);
  assert.deepEqual(f.calls[1].values, [7]); assert.deepEqual(f.calls[2].values, ['2026-10-01']);
  assert.deepEqual(result, rows); assert.equal(f.connects, 1); assert.deepEqual(f.releases, [undefined]);
  for (const call of f.calls) assert.doesNotMatch(call.sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE)\b/i);
});

test('auth ID, exact role and epoch are captured before awaited connect; caller mutation cannot change projection', async () => {
  const observed = { id: 7, rol: 'edicion', session_version: 3, nombre: 'caller' }, actor = { ...observed, activo: true };
  const raw = row(), f = fixture({ actor, rows: [raw], onConnect: () => {
    observed.id = 99; observed.rol = 'admin'; observed.session_version = 99; observed.nombre = 'replacement';
  } });
  const result = await loadClientCatalogSnapshot(f.pool, observed, '2026-10-01');
  assert.deepEqual(f.calls[1].values, [7]); assert.deepEqual(result, [clientOperationalDto(raw, actor)]);
  assert.equal(Object.hasOwn(result[0], 'abono_mensual'), false); assert.equal(Object.hasOwn(result[0], 'agreement_revision'), false);
  assert.equal(Object.hasOwn(result[0], 'unknown_private'), false); assert.equal(result[0].nombre, raw.nombre);
});

test('invalid identity/epoch or empty role fails before acquiring connection, without a role whitelist', async () => {
  const invalid = [0, -1, 1.5, '7', 2147483648, NaN, Infinity, null, undefined];
  for (const field of ['id', 'session_version']) for (const value of invalid) {
    const f = fixture(); await assert.rejects(loadClientCatalogSnapshot(f.pool, { ...auth(), [field]: value }, '2026-10-01'), { status: 401 });
    assert.equal(f.connects, 0); assert.deepEqual(f.calls, []);
  }
  for (const rol of ['', '  ', null, 7]) {
    const f = fixture(); await assert.rejects(loadClientCatalogSnapshot(f.pool, { ...auth(), rol }, '2026-10-01'), { status: 401 }); assert.equal(f.connects, 0);
  }
  for (const rol of ['custom-observed-role', ' admin ']) {
    const actor = { id: 2147483647, rol, activo: true, session_version: 2147483647 }, f = fixture({ actor });
    const result = await loadClientCatalogSnapshot(f.pool, actor, '2026-10-01');
    assert.deepEqual(result, [clientOperationalDto(row(), actor)]); assert.equal(Object.hasOwn(result[0], 'abono_mensual'), false);
  }
});

test('missing, inactive, changed-role/epoch/ID actor rejects before catalog SQL and rolls back', async () => {
  const current = { id: 7, rol: 'admin', activo: true, session_version: 3 };
  for (const actor of [null, { ...current, activo: false }, { ...current, activo: null }, { ...current, id: 8 },
    { ...current, rol: 'edicion' }, { ...current, rol: ' admin ' }, { ...current, session_version: 4 }]) {
    const f = fixture({ actor }); await assert.rejects(loadClientCatalogSnapshot(f.pool, auth(), '2026-10-01'), { status: 401 });
    assert.equal(f.calls.some(c => c.sql === CLIENT_CATALOG_SQL), false);
    assert.equal(f.calls.at(-1).sql, 'ROLLBACK'); assert.deepEqual(f.releases, [undefined]);
  }
});

test('query/commit faults roll back and release once; failed rollback discards connection without replacing original error', async () => {
  for (const point of ['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', 'SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1', CLIENT_CATALOG_SQL, 'COMMIT']) {
    for (const brokenRollback of [false, true]) {
      const original = new Error('synthetic query failure'), rollback = new Error('synthetic rollback failure');
      const fault = sql => sql === point; fault.error = original;
      const f = fixture({ fault, rollbackFault: brokenRollback ? rollback : undefined });
      await assert.rejects(loadClientCatalogSnapshot(f.pool, auth(), '2026-10-01'), error => error === original);
      assert.equal(f.calls.at(-1).sql, 'ROLLBACK'); assert.deepEqual(f.releases, [brokenRollback ? rollback : undefined]);
    }
  }
});
