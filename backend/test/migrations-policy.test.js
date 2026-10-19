import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MigrationPolicyError, readMigrationIdentity, readMigrationStatus, buildMigrationPlan, runMigrations } from '../src/migrations.js';

const identity = { database: 'unit', username: 'unit', address: '127.0.0.1', port: 55401 };
const logger = { log() {} };
async function catalog() {
  return (await readMigrationStatus({ query: async () => ({ rows: [{ ledger: null }] }) })).pending;
}
function mock(applied = [], options = {}) {
  const queries = [], releases = [];
  let connected = 0;
  const client = { release: destroy => releases.push(destroy), async query(sql, params) {
    queries.push({ sql, params });
    if (options.fail?.(sql)) throw new Error('postgres://secret:password@private/financial-source');
    if (sql.includes('current_database()')) return { rows: [options.identity ?? identity] };
    if (sql.includes('to_regclass')) return { rows: [{ ledger: options.missing ? null : 'public._migrations' }] };
    if (sql.startsWith('SELECT id,nombre')) return { rows: applied.map((nombre, i) => ({ id: i + 1, nombre, aplicada_at: new Date(0) })) };
    if (sql.includes('pg_advisory_unlock')) return { rows: [{ unlocked: options.unlock !== false }] };
    if (sql.includes("current_setting('data_directory')")) return { rows: [{ directory: options.directory, tables: options.tables ?? 0 }] };
    return { rows: [] };
  } };
  return { queries, releases, client, get connected() { return connected; }, pool: { async connect() { connected++; return client; } } };
}
async function approved(m, overrides = {}) {
  const status = await readMigrationStatus(m.client);
  m.queries.length = 0;
  return { environment: 'test', expectedIdentity: identity,
    planHash: buildMigrationPlan({ environment: 'test', identity, status }), purpose: 'local-explicit', ...overrides };
}
test('inspection only issues qualified SELECTs and absent ledger does not create anything', async () => {
  const m = mock([], { missing: true });
  const status = await readMigrationStatus(m.client);
  assert.equal(status.ledgerExists, false);
  assert.ok(status.pending.length > 0);
  assert.equal(m.queries.length, 1);
  assert.ok(m.queries.every(({ sql }) => sql.startsWith('SELECT')));
  assert.deepEqual(await readMigrationIdentity(m.client), identity);
});
test('invalid ledger names/duplicates and inspection errors fail closed without leaking source errors', async () => {
  const unknown = await readMigrationStatus(mock(['foreign.sql']).client);
  assert.deepEqual(unknown.unknownApplied, ['foreign.sql']);
  await assert.rejects(readMigrationStatus(mock(['same', 'same']).client), /Cannot inspect/);
  await assert.rejects(readMigrationStatus(mock([], { fail: () => true }).client), error => !error.message.includes('password'));
});
test('plans bind identity, environment, ledger existence and every pending SQL hash', async () => {
  const status = await readMigrationStatus(mock([], { missing: true }).client);
  const plan = buildMigrationPlan({ environment: 'test', identity, status });
  assert.match(plan, /^[a-f0-9]{64}$/);
  for (const changed of [{ environment: 'sandbox' }, { identity: { ...identity, database: 'other' } },
    { status: { ...status, ledgerExists: true } }, { status: { ...status, pending: status.pending.slice(1) } },
    { status: { ...status, pending: [{ ...status.pending[0], sha256: '0'.repeat(64) }, ...status.pending.slice(1)] } }])
    assert.notEqual(buildMigrationPlan({ environment: 'test', identity, status, ...changed }), plan);
});
test('missing, malformed, production, remote and fake-fixture approvals reject before connecting', async () => {
  const m = mock();
  const base = { environment: 'test', expectedIdentity: identity, planHash: 'a'.repeat(64), purpose: 'local-explicit' };
  for (const approval of [undefined, {}, { ...base, environment: 'production' }, { ...base, planHash: 'x' },
    { ...base, expectedIdentity: { ...identity, address: 'remote' } }, { ...base, purpose: 'isolated-fixture', fixtureRoot: '/tmp/existing' }])
    await assert.rejects(runMigrations(m.pool, logger, { approval }));
  await assert.rejects(runMigrations(m.pool, logger, { approval: base, deferredMigrations: ['not-real.sql'] }));
  assert.equal(m.connected, 0);
});
test('runner rechecks actual identity and locked plan before any schema writes', async () => {
  const all = await catalog();
  const m = mock(all.map(file => file.name));
  const approval = await approved(m, { planHash: '0'.repeat(64) });
  await assert.rejects(runMigrations(m.pool, logger, { approval }), /plan changed/);
  const allowedSettings = ['SET search_path TO public', "SET lock_timeout TO '10s'", "SET statement_timeout TO '120s'",
    'RESET search_path', 'RESET lock_timeout', 'RESET statement_timeout'];
  assert.ok(m.queries.every(({ sql }) => sql.startsWith('SELECT') || allowedSettings.includes(sql)));
  assert.ok(m.queries.findIndex(({ sql }) => sql.includes('pg_advisory_lock')) < m.queries.findIndex(({ sql }) => sql.includes('to_regclass')));
  assert.deepEqual(m.releases, [false]);
  const mismatch = mock([], { identity: { ...identity, username: 'other' } });
  await assert.rejects(runMigrations(mismatch.pool, logger, { approval }), /identity mismatch/);
  assert.deepEqual(mismatch.queries.map(({ sql }) => sql), [
    'SET search_path TO public', "SET lock_timeout TO '10s'", "SET statement_timeout TO '120s'",
    'SELECT current_database() AS database, current_user AS username, host(inet_server_addr()) AS address, inet_server_port() AS port',
    'RESET search_path', 'RESET lock_timeout', 'RESET statement_timeout']);
});
test('one dedicated client applies one pending file and ledger atomically without conflict masking', async () => {
  const all = await catalog();
  const m = mock(all.slice(0, -1).map(file => file.name));
  await runMigrations(m.pool, logger, { approval: await approved(m) });
  const statements = m.queries.map(({ sql }) => sql);
  assert.equal(m.connected, 1);
  assert.deepEqual(statements.slice(0, 3), ['SET search_path TO public', "SET lock_timeout TO '10s'", "SET statement_timeout TO '120s'"]);
  assert.deepEqual(statements.slice(-4), ['SELECT pg_advisory_unlock(728194, 1) AS unlocked', 'RESET search_path', 'RESET lock_timeout', 'RESET statement_timeout']);
  assert.equal(statements.filter(sql => sql === 'BEGIN').length, 1);
  assert.equal(statements.filter(sql => sql === 'COMMIT').length, 1);
  const ledgerWrites = m.queries.filter(({ sql }) => sql.startsWith('INSERT INTO public._migrations'));
  assert.equal(ledgerWrites.length, 1);
  assert.equal(ledgerWrites[0].params[0], all.at(-1).name);
  // Migration bodies may legitimately define UPSERT triggers. The migration
  // ledger itself must never swallow duplicate/concurrent application errors.
  assert.ok(ledgerWrites.every(({ sql }) => !/ON\s+CONFLICT/i.test(sql)));
  const actualBody = readFileSync(new URL(`../migrations/${all.at(-1).name}`, import.meta.url), 'utf8');
  assert.equal(statements.filter(sql => sql === actualBody).length, 1);
  assert.deepEqual(m.releases, [false]);
});
test('SQL failure rolls back, sanitizes error and releases lock; uncertain cleanup destroys client', async () => {
  const all = await catalog();
  const m = mock(all.slice(0, -1).map(file => file.name), { fail: sql => sql.startsWith('INSERT INTO public._migrations') });
  await assert.rejects(runMigrations(m.pool, logger, { approval: await approved(m) }), error =>
    error instanceof MigrationPolicyError && error.message === `Migration failed: ${all.at(-1).name}`);
  assert.ok(m.queries.some(({ sql }) => sql === 'ROLLBACK'));
  assert.ok(!m.queries.some(({ sql }) => sql === 'COMMIT'));
  assert.deepEqual(m.releases, [false]);
  for (const options of [{ unlock: false }, { fail: sql => sql.includes('pg_advisory_unlock') }, { fail: sql => sql.includes('pg_advisory_lock(') },
    { fail: sql => sql === 'SET search_path TO public' }, { fail: sql => sql === "SET statement_timeout TO '120s'" },
    ...['search_path', 'lock_timeout', 'statement_timeout'].map(setting => ({ fail: sql => sql === `RESET ${setting}` }))]) {
    const broken = mock(all.map(file => file.name), options);
    await runMigrations(broken.pool, logger, { approval: await approved(broken) }).catch(() => {});
    assert.deepEqual(broken.releases, [true]);
  }
});

test('only controlled engine errors expose the exported public classification', async () => {
  const m = mock([], { fail: sql => sql.includes('current_database()') });
  await assert.rejects(readMigrationIdentity(m.client), error => error instanceof MigrationPolicyError &&
    error.message === 'Cannot inspect migration database identity.' && !error.message.includes('password'));
  const all = await catalog();
  const driver = mock(all.map(file => file.name), { fail: sql => sql.includes('pg_advisory_lock(') });
  await assert.rejects(runMigrations(driver.pool, logger, { approval: await approved(driver) }), error =>
    !(error instanceof MigrationPolicyError) && error.message === 'Migration execution failed.');
});

test('missing-ledger stale plans and unknown applied names cannot create or repair the ledger', async () => {
  for (const m of [mock([], { missing: true }), mock(['foreign.sql'])]) {
    const approval = await approved(m, { planHash: '0'.repeat(64) });
    await assert.rejects(runMigrations(m.pool, logger, { approval }), /plan changed/);
    assert.ok(!m.queries.some(({ sql }) => /^(CREATE|INSERT|UPDATE|DELETE|BEGIN)/.test(sql)));
  }
});

test('isolated fixture requires matching generated cwd/data directory, empty schema and real filtered files', async t => {
  const root = '/private/tmp/render2-local-Unit123';
  t.mock.method(process, 'cwd', () => root);
  const fixtureIdentity = { ...identity, database: 'render2_local_test', username: 'render2_fixture' };
  const all = await catalog();
  const deferredMigrations = all.map(file => file.name);
  for (const options of [{ directory: `${root}/data`, tables: 0 }, { directory: '/existing/data', tables: 0 }, { directory: `${root}/data`, tables: 1 }]) {
    const m = mock([], { ...options, identity: fixtureIdentity, missing: true });
    const status = await readMigrationStatus(m.client, { deferredMigrations });
    assert.equal(status.pending.length, 0);
    assert.deepEqual(status.applied, [], 'deferred files must not forge applied ledger entries');
    m.queries.length = 0;
    const approval = { environment: 'test', expectedIdentity: fixtureIdentity, purpose: 'isolated-fixture', fixtureRoot: root,
      planHash: buildMigrationPlan({ environment: 'test', identity: fixtureIdentity, status }) };
    if (options.directory === `${root}/data` && options.tables === 0) {
      await runMigrations(m.pool, logger, { approval, deferredMigrations });
      assert.equal(m.queries.filter(({ sql }) => sql.startsWith('CREATE TABLE public._migrations')).length, 1);
      assert.ok(!m.queries.some(({ sql }) => sql.startsWith('INSERT')));
    } else {
      await assert.rejects(runMigrations(m.pool, logger, { approval, deferredMigrations }), /fresh isolated/);
      assert.ok(!m.queries.some(({ sql }) => sql.startsWith('CREATE')));
    }
  }
});
