import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DEPLOYED_HISTORY_COMMIT, DEPLOYED_MIGRATION_HISTORY, isRecognizedDeployedMigration } from '../src/deployed-migration-history.js';
import { readMigrationStatus, buildMigrationPlan, runMigrations } from '../src/migrations.js';

// Pinned source provenance, not proof of SQL execution in an inherited ledger.
const expected = {
  '050_registro_entregas_edicion_septiembre_2026.sql': '24f9235c8be62b240c67f8555e1e08213ce08956607c90f880c7f91a0712e8f7',
  '051_progreso_edicion_auditable.sql': '858f69ede3f8dc7e2542e7a28c656921f1e9935bc1869e2fc69118cf69db7edd',
  '052_reubicar_backfill_progreso_edicion.sql': '032ba209ab4ea544cc17c70603d8d8696d142d5e392ec66e56dfc3b5c04dd897',
  '054_cierre_reportes_septiembre_2026.sql': '559dcd2b108528c203cee05c2fa62e27cf0c54d98a9d04e4e478d1b0af15a50b',
  '055_cierre_reportes_identidad_septiembre_2026.sql': 'bb47e9d7bbf43f38977eef595cd62a1236b9bef254155942beb9dedbe174faf9',
};
const names = Object.keys(expected);
const directory = new URL('../migrations/', import.meta.url);
const local = readdirSync(directory).filter(name => name.endsWith('.sql')).sort().map(name => ({ name,
  sha256: createHash('sha256').update(readFileSync(new URL(name, directory))).digest('hex') }));
const identity = { database: 'unit_history', username: 'unit_history', address: '127.0.0.1', port: 55401 };
function mock(applied = [], ledger = true) {
  const queries = [], releases = [];
  const entries = applied.map((nombre, i) => ({ id: i + 1, nombre, aplicada_at: new Date(0) }));
  const client = { release: value => releases.push(value), async query(sql, params) {
    queries.push({ sql, params });
    if (sql.includes('current_database()')) return { rows: [identity] };
    if (sql.includes('to_regclass')) return { rows: [{ ledger: ledger ? 'public._migrations' : null }] };
    if (sql === 'SELECT id,nombre,aplicada_at FROM public._migrations ORDER BY nombre') return { rows: structuredClone(entries) };
    if (sql.includes('pg_advisory_unlock')) return { rows: [{ unlocked: true }] };
    return { rows: [] };
  } };
  return { client, queries, releases, entries, pool: { connect: async () => client } };
}
async function approval(m) {
  const status = await readMigrationStatus(m.client);
  m.queries.length = 0;
  return { environment: 'test', expectedIdentity: identity, purpose: 'local-explicit',
    planHash: buildMigrationPlan({ environment: 'test', identity, status }) };
}

test('recognition registry is exactly five frozen SHA256 entries from the pinned deployed commit', () => {
  assert.equal(DEPLOYED_HISTORY_COMMIT, '43f02707e299293c5b0c2bb6f12386bd4642746b');
  assert.deepEqual(DEPLOYED_MIGRATION_HISTORY, expected);
  assert.equal(Object.isFrozen(DEPLOYED_MIGRATION_HISTORY), true);
  for (const name of names) {
    assert.equal(Object.hasOwn(DEPLOYED_MIGRATION_HISTORY, name), true);
    assert.match(DEPLOYED_MIGRATION_HISTORY[name], /^[a-f0-9]{64}$/);
    assert.equal(isRecognizedDeployedMigration(name), true);
    assert.throws(() => { DEPLOYED_MIGRATION_HISTORY[name] = '0'.repeat(64); }, TypeError);
  }
});

test('recognition is exact own-key boolean, never prefix, coercion or inherited property lookup', () => {
  const invalid = [undefined, null, 50, {}, [], new String(names[0]), 'toString', 'constructor', '__proto__',
    ...names.flatMap(name => [' ' + name, name + ' ', name.toUpperCase(), '../' + name, name + '.bak',
      name.replace('.sql', '_near.sql')])];
  for (const name of invalid) assert.equal(isRecognizedDeployedMigration(name), false);
  for (const file of local) assert.equal(isRecognizedDeployedMigration(file.name), false);
});

test('deployed ledger entries remain applied, recognized and read-only without changing local pending bytes', async () => {
  const m = mock(names), before = structuredClone(m.entries);
  const status = await readMigrationStatus(m.client);
  assert.equal(status.ledgerExists, true);
  assert.deepEqual(status.applied, [...names].sort());
  assert.deepEqual(status.unknownApplied, []);
  assert.deepEqual(status.pending, local);
  assert.deepEqual(m.entries, before);
  assert.deepEqual(m.queries.map(q => q.sql), ["SELECT to_regclass('public._migrations') AS ledger",
    'SELECT id,nombre,aplicada_at FROM public._migrations ORDER BY nombre']);
});

test('nearby and foreign ledger names stay unknown and block execution before any SQL body or ledger write', async () => {
  const unknown = ['054_cierre_reportes_septiembre_2027.sql', '055_cierre_reportes_identidad_septiembre_2026.sql.bak', 'foreign.sql'];
  const m = mock([...names, ...unknown]);
  assert.deepEqual((await readMigrationStatus(m.client)).unknownApplied, unknown);
  await assert.rejects(runMigrations(m.pool, { log() {} }, { approval: await approval(m) }), /plan changed/);
  assert.ok(!m.queries.some(q => /^(BEGIN|CREATE|INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/.test(q.sql)));
  assert.ok(!m.queries.some(q => local.some(f => readFileSync(new URL(f.name, directory), 'utf8') === q.sql)));
  assert.deepEqual(m.releases, [false]);
});

test('fresh schema pending is only current local SQL; deployed history is never synthesized into the chain', async () => {
  const m = mock([], false), status = await readMigrationStatus(m.client);
  assert.equal(status.ledgerExists, false);
  assert.deepEqual(status.applied, []);
  assert.deepEqual(status.unknownApplied, []);
  assert.deepEqual(status.pending, local);
  assert.ok(names.every(name => !status.pending.some(file => file.name === name)));
  assert.equal(m.queries.length, 1);
});

test('actual runner executes exact current pending SQL only and never replays or rewrites deployed history', async () => {
  const last = local.at(-1);
  const m = mock([...local.slice(0, -1).map(f => f.name), ...names]);
  await runMigrations(m.pool, { log() {} }, { approval: await approval(m) });
  const body = readFileSync(new URL(last.name, directory), 'utf8');
  assert.equal(m.queries.filter(q => q.sql === body).length, 1);
  assert.deepEqual(m.queries.filter(q => q.sql.startsWith('INSERT INTO public._migrations'))
    .map(q => q.params), [[last.name]]);
  assert.equal(m.queries.filter(q => q.sql === 'BEGIN').length, 1);
  assert.equal(m.queries.filter(q => q.sql === 'COMMIT').length, 1);
  assert.ok(!m.queries.some(q => /^(UPDATE|DELETE|TRUNCATE)\s+(?:TABLE\s+)?(?:public\.)?_migrations\b/i.test(q.sql)));
  assert.ok(!m.queries.some(q => names.some(name => q.params?.includes(name))));
  assert.deepEqual(m.releases, [false]);
});
