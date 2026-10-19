import test from 'node:test';
import assert from 'node:assert/strict';
import { readDatabaseTarget, resolveStartupPolicy, assertMigrationTargetIdentity,
  assertBackgroundJobsAllowed, assertStartupMigrationStatus } from '../src/startup-policy.js';

const env = { DATABASE_URL: 'postgresql://fixture:secret@127.0.0.1:55401/sample', RENDER_DB_ENVIRONMENT: 'test' };
test('startup requires explicit classified PostgreSQL configuration and never exposes credentials', () => {
  const target = readDatabaseTarget(env);
  assert.deepEqual(target, { environment: 'test', database: 'sample', username: 'fixture', hostname: '127.0.0.1', port: 55401 });
  assert.ok(!JSON.stringify(target).includes('secret'));
  for (const changed of [{ DATABASE_URL: undefined }, { RENDER_DB_ENVIRONMENT: undefined },
    { RENDER_DB_ENVIRONMENT: 'unknown' }, { DATABASE_URL: 'http://fixture:secret@localhost/sample' },
    { DATABASE_URL: 'postgres://localhost/sample' }, { DATABASE_URL: 'postgres://fixture@localhost/' },
    { DATABASE_URL: `${env.DATABASE_URL}?host=remote` }]) {
    assert.throws(() => readDatabaseTarget({ ...env, ...changed }), error => !error.message.includes('secret'));
  }
});
test('normal startup defaults to no jobs even with old individual service flags; PORT zero is preserved', () => {
  const policy = resolveStartupPolicy({ ...env, PORT: '0', HOST: '127.0.0.1', MIA_SUPERVISOR_ENABLED: 'true' });
  assert.deepEqual(policy.jobs, []);
  assert.equal(policy.port, 0);
  assert.equal(policy.host, '127.0.0.1');
  assert.throws(() => resolveStartupPolicy({ ...env, SETUP_DEMO_DATA: 'true' }));
  for (const PORT of ['', '-1', '65536', 'nan']) assert.throws(() => resolveStartupPolicy({ ...env, PORT }));
});
test('jobs require explicit nonproduction loopback approval and exact verified identity', () => {
  const approved = { ...env, RENDER_BACKGROUND_JOBS: 'editorial,trash,wilson,supervisor', RENDER_ALLOW_BACKGROUND_WRITES: 'true' };
  const policy = resolveStartupPolicy(approved);
  const actual = { database: 'sample', username: 'fixture', address: '127.0.0.1', port: 55401 };
  assert.doesNotThrow(() => assertBackgroundJobsAllowed(policy, actual));
  assert.throws(() => assertBackgroundJobsAllowed(policy, { ...actual, database: 'other' }));
  for (const changed of [{ RENDER_ALLOW_BACKGROUND_WRITES: undefined }, { RENDER_DB_ENVIRONMENT: 'production' },
    { DATABASE_URL: 'postgres://fixture@remote/sample' }, { RENDER_BACKGROUND_JOBS: 'trash,trash' },
    { RENDER_BACKGROUND_JOBS: 'unknown' }, { RENDER_BACKGROUND_JOBS: ',' }])
    assert.throws(() => resolveStartupPolicy({ ...approved, ...changed }));
});
test('identity comparison allows localhost resolution but never other principals/targets', () => {
  const target = readDatabaseTarget({ ...env, DATABASE_URL: 'postgres://fixture@localhost:55401/sample' });
  const actual = { database: 'sample', username: 'fixture', address: '::1', port: 55401 };
  assert.doesNotThrow(() => assertMigrationTargetIdentity(actual, target));
  for (const changed of [{ username: 'other' }, { address: '192.0.2.1' }, { port: 5432 }])
    assert.throws(() => assertMigrationTargetIdentity({ ...actual, ...changed }, target));
});
test('startup rejects missing, pending, unknown or malformed migration status', () => {
  const ready = { ledgerExists: true, applied: [], pending: [], unknownApplied: [] };
  assert.doesNotThrow(() => assertStartupMigrationStatus(ready));
  for (const changed of [{ ledgerExists: false }, { pending: [{}] }, { unknownApplied: ['foreign.sql'] }, { applied: null }])
    assert.throws(() => assertStartupMigrationStatus({ ...ready, ...changed }));
});
