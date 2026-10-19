const environments = new Set(['development', 'sandbox', 'test', 'production']);
const services = new Set(['editorial', 'trash', 'wilson', 'supervisor']);
export const isLoopbackAddress = address => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(address);
export function validateEnvironment(environment) {
  if (!environments.has(environment)) throw new Error('Invalid database environment.');
  return environment;
}
export function normalizeDatabaseIdentity(identity) {
  if (!identity || typeof identity !== 'object' ||
    !['database', 'username', 'address'].every(key => typeof identity[key] === 'string' && identity[key].length > 0) ||
    !Number.isInteger(Number(identity.port)) || Number(identity.port) < 1 || Number(identity.port) > 65535)
    throw new Error('Invalid database identity.');
  return { database: identity.database, username: identity.username,
    address: identity.address === '[::1]' ? '::1' : identity.address, port: Number(identity.port) };
}
export function readDatabaseTarget(env = {}) {
  const environment = validateEnvironment(env.RENDER_DB_ENVIRONMENT);
  try {
    if (typeof env.DATABASE_URL !== 'string' || !env.DATABASE_URL) throw new Error();
    const url = new URL(env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash ||
      !url.pathname.startsWith('/') || url.pathname.slice(1).includes('/')) throw new Error();
    const identity = normalizeDatabaseIdentity({ database: decodeURIComponent(url.pathname.slice(1)),
      username: decodeURIComponent(url.username), address: url.hostname, port: url.port || 5432 });
    return { environment, database: identity.database, username: identity.username, hostname: identity.address, port: identity.port };
  } catch { throw new Error('Invalid explicit PostgreSQL configuration.'); }
}
export function resolveStartupPolicy(env = {}) {
  const target = readDatabaseTarget(env);
  if (env.SETUP_DEMO_DATA === 'true') throw new Error('Demo setup is prohibited during startup.');
  const raw = env.RENDER_BACKGROUND_JOBS ?? '';
  if (typeof raw !== 'string') throw new Error('Invalid background jobs.');
  const jobs = raw === '' ? [] : raw.split(',').map(value => value.trim());
  if (new Set(jobs).size !== jobs.length || jobs.some(job => !services.has(job))) throw new Error('Invalid background jobs.');
  if (jobs.length && (target.environment === 'production' || !isLoopbackAddress(target.hostname) || env.RENDER_ALLOW_BACKGROUND_WRITES !== 'true'))
    throw new Error('Background writes are not approved.');
  const port = env.PORT === undefined ? 3000 : Number(env.PORT);
  if (env.PORT === '' || !Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid server port.');
  const host = env.HOST ?? '0.0.0.0';
  if (typeof host !== 'string' || !host.trim() || /[\s/]/.test(host)) throw new Error('Invalid server host.');
  return { target, jobs, host, port };
}
export function assertMigrationTargetIdentity(actualValue, expectedValue) {
  const actual = normalizeDatabaseIdentity(actualValue);
  const expected = normalizeDatabaseIdentity({ ...expectedValue, address: expectedValue?.hostname ?? expectedValue?.address });
  for (const key of ['database', 'username', 'port']) if (expected[key] !== actual[key]) throw new Error('Database identity mismatch.');
  if (expected.address !== actual.address && !(expected.address === 'localhost' && isLoopbackAddress(actual.address)))
    throw new Error('Database identity mismatch.');
  return actual;
}
export function assertBackgroundJobsAllowed(policy, actual) {
  if (!policy.jobs.length) return;
  if (policy.target.environment === 'production' || !isLoopbackAddress(policy.target.hostname) || !isLoopbackAddress(actual.address))
    throw new Error('Background writes are not approved.');
  assertMigrationTargetIdentity(actual, policy.target);
}
export function assertStartupMigrationStatus(status) {
  if (!status || status.ledgerExists !== true || !Array.isArray(status.applied) || !Array.isArray(status.pending) ||
    !Array.isArray(status.unknownApplied) || status.pending.length || status.unknownApplied.length)
    throw new Error('Database migration status is not ready. Run explicit migration inspection.');
}
