import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validateEnvironment, normalizeDatabaseIdentity, isLoopbackAddress } from './startup-policy.js';
import { isRecognizedDeployedMigration } from './deployed-migration-history.js';

const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');
export class MigrationPolicyError extends Error {}
function files(deferred = []) {
  const names = fs.readdirSync(migrationsDir).filter(name => name.endsWith('.sql')).sort();
  if (!Array.isArray(deferred) || new Set(deferred).size !== deferred.length || deferred.some(name => !names.includes(name)))
    throw new Error('Invalid deferred migrations.');
  return names.filter(name => !deferred.includes(name)).map(name => ({ name,
    sha256: digest(fs.readFileSync(path.join(migrationsDir, name))) }));
}
export async function readMigrationIdentity(db) {
  try {
    const { rows } = await db.query('SELECT current_database() AS database, current_user AS username, host(inet_server_addr()) AS address, inet_server_port() AS port');
    return normalizeDatabaseIdentity(rows[0]);
  } catch { throw new MigrationPolicyError('Cannot inspect migration database identity.'); }
}
export async function readMigrationStatus(db, { deferredMigrations = [] } = {}) {
  const local = files(deferredMigrations);
  try {
    const result = await db.query("SELECT to_regclass('public._migrations') AS ledger");
    if (result.rows.length !== 1 || !Object.hasOwn(result.rows[0], 'ledger')) throw new Error();
    const ledgerExists = result.rows[0]?.ledger != null;
    const entries = ledgerExists ? (await db.query('SELECT id,nombre,aplicada_at FROM public._migrations ORDER BY nombre')).rows : [];
    if (entries.some(row => !Number.isInteger(row.id) || row.id <= 0 ||
      !(row.aplicada_at instanceof Date || typeof row.aplicada_at === 'string') || !Number.isFinite(new Date(row.aplicada_at).getTime()))) throw new Error();
    const applied = entries.map(row => row.nombre);
    if (applied.some(name => typeof name !== 'string' || !name) || new Set(applied).size !== applied.length) throw new Error();
    const allNames = files().map(file => file.name);
    return { ledgerExists, applied: applied.sort(), pending: local.filter(file => !applied.includes(file.name)),
      unknownApplied: applied.filter(name => !allNames.includes(name) && !isRecognizedDeployedMigration(name)) };
  } catch { throw new MigrationPolicyError('Cannot inspect migration ledger.'); }
}
export function buildMigrationPlan({ environment, identity, status }) {
  validateEnvironment(environment);
  const actual = normalizeDatabaseIdentity(identity);
  if (!status || typeof status.ledgerExists !== 'boolean' || !Array.isArray(status.applied) ||
    !Array.isArray(status.pending) || !Array.isArray(status.unknownApplied) ||
    status.applied.some(name => typeof name !== 'string') || status.unknownApplied.some(name => typeof name !== 'string') ||
    status.pending.some(file => !file || typeof file.name !== 'string' || !/^[0-9a-f]{64}$/.test(file.sha256)))
    throw new Error('Invalid migration status.');
  return digest(JSON.stringify({ environment, identity: actual, status: {
    ledgerExists: status.ledgerExists, applied: [...status.applied].sort(),
    pending: [...status.pending].map(({ name, sha256 }) => ({ name, sha256 })).sort((a, b) => a.name.localeCompare(b.name)),
    unknownApplied: [...status.unknownApplied].sort() } }));
}
function validateApproval(approval, deferredMigrations) {
  if (!approval || typeof approval !== 'object') throw new Error('Explicit migration approval required.');
  validateEnvironment(approval.environment);
  const expected = normalizeDatabaseIdentity(approval.expectedIdentity);
  if (approval.environment === 'production' || !isLoopbackAddress(expected.address) ||
    !['local-explicit', 'isolated-fixture'].includes(approval.purpose) || typeof approval.planHash !== 'string' || !/^[0-9a-f]{64}$/.test(approval.planHash))
    throw new Error('Migration approval is not permitted.');
  files(deferredMigrations);
  if (approval.purpose !== 'isolated-fixture' && deferredMigrations.length) throw new Error('Only fixtures may defer migrations.');
  if (approval.purpose === 'isolated-fixture' &&
    (typeof approval.fixtureRoot !== 'string' || !/^\/private\/tmp\/render2-local-[A-Za-z0-9]+$/.test(approval.fixtureRoot) ||
      process.cwd() !== approval.fixtureRoot || expected.database !== 'render2_local_test' || expected.username !== 'render2_fixture'))
    throw new Error('Invalid isolated fixture approval.');
  return expected;
}
export async function runMigrations(pool, logger = console, { approval, deferredMigrations = [] } = {}) {
  const expected = validateApproval(approval, deferredMigrations);
  const client = await pool.connect();
  let locked = false, destroy = false, configured = false;
  try {
    // Never inherit PGOPTIONS search_path/timeouts into historical SQL. Partial
    // configuration failure also makes returning this session unsafe.
    destroy = true;
    await client.query('SET search_path TO public');
    await client.query("SET lock_timeout TO '10s'");
    await client.query("SET statement_timeout TO '120s'");
    configured = true;
    destroy = false;
    const identity = await readMigrationIdentity(client);
    if (JSON.stringify(identity) !== JSON.stringify(expected) || !isLoopbackAddress(identity.address)) throw new MigrationPolicyError('Migration identity mismatch.');
    // A connection error during lock acquisition leaves lock ownership unknown.
    destroy = true;
    await client.query('SELECT pg_advisory_lock(728194, 1)');
    destroy = false;
    locked = true;
    if (approval.purpose === 'isolated-fixture') {
      const { rows } = await client.query("SELECT current_setting('data_directory') AS directory, (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public') AS tables");
      if (rows[0]?.directory !== `${approval.fixtureRoot}/data` || rows[0]?.tables !== 0) throw new MigrationPolicyError('Fixture is not a fresh isolated schema.');
    }
    const status = await readMigrationStatus(client, { deferredMigrations });
    if (status.unknownApplied.length || buildMigrationPlan({ environment: approval.environment, identity, status }) !== approval.planHash)
      throw new MigrationPolicyError('Migration plan changed; inspect and approve again.');
    // Freeze the approved bytes before any DDL, not after ledger creation.
    const pending = status.pending.map(file => {
      const content = fs.readFileSync(path.join(migrationsDir, file.name));
      if (digest(content) !== file.sha256) throw new MigrationPolicyError('Migration file changed; inspect and approve again.');
      return { ...file, content };
    });
    if (!status.ledgerExists) await client.query('CREATE TABLE public._migrations (id SERIAL PRIMARY KEY, nombre TEXT NOT NULL UNIQUE, aplicada_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    for (const { name, content } of pending) {
      try {
        await client.query('BEGIN');
        await client.query(content.toString('utf8'));
        await client.query('INSERT INTO public._migrations (nombre) VALUES ($1)', [name]);
        await client.query('COMMIT');
      } catch {
        try { await client.query('ROLLBACK'); } catch { destroy = true; }
        throw new MigrationPolicyError(`Migration failed: ${name}`);
      }
      logger.log(`Migration applied: ${name}`);
    }
  } catch (error) {
    if (error instanceof MigrationPolicyError) throw error;
    throw new Error('Migration execution failed.');
  } finally {
    if (locked && !destroy) {
      try {
        const result = await client.query('SELECT pg_advisory_unlock(728194, 1) AS unlocked');
        if (result.rows[0]?.unlocked !== true) destroy = true;
      } catch { destroy = true; }
    }
    if (configured && !destroy) {
      try {
        await client.query('RESET search_path');
        await client.query('RESET lock_timeout');
        await client.query('RESET statement_timeout');
      } catch { destroy = true; }
    }
    client.release(destroy);
  }
}
