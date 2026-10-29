import { buildDatabasePoolConfig } from './database-transport.js';
import { parseOwnerProfilePolicy } from './owner-profile-authority.js';
import { resolveScheduledAutomationPolicy } from './scheduled-automation-policy.js';

export const HOSTINGER_RELEASE_ORIGIN = 'https://sistema.rendercorrientes.com';
const placeholder = /(?:REQUIRED|PRESERVE_EXISTING|REPLACE_ME|CHANGE_ME|PLACEHOLDER|<[^>]*>)/i;
const present = value => typeof value === 'string' && value.trim().length > 0 && !placeholder.test(value);
const absent = value => value === undefined || value === '';

/** Pure advisory checklist. No env defaults, IO, connections, logs or mutations.
 * currentDatabaseUrl must be supplied privately from the approved existing
 * configuration, not echoed in reports. Equality is byte-for-byte: never rewrite
 * its credentials/host/database. Passing checks is NOT deployment approval.
 */
export function validateHostingerReleaseConfig(env = {}, { nodeVersion, currentDatabaseUrl,
  currentJwtSecret, frontendGoogleClientId } = {}) {
  const checks = [];
  const add = (name, category, status) => checks.push(Object.freeze({ name, category, status }));
  const exact = (name, value) => add(name, 'required', env[name] === value ? 'pass' : absent(env[name]) ? 'missing' : 'invalid');
  add('NODE_RUNTIME', 'required', typeof nodeVersion === 'string' && /^v?24\.\d+\.\d+$/.test(nodeVersion) ? 'pass' : 'invalid');
  exact('NODE_ENV', 'production');
  exact('APP_URL', HOSTINGER_RELEASE_ORIGIN);
  exact('RENDER_DB_ENVIRONMENT', 'production');
  exact('SETUP_DEMO_DATA', 'false');
  exact('RENDER_BACKGROUND_JOBS', '');
  exact('RENDER_ALLOW_BACKGROUND_WRITES', 'false');
  exact('RENDER_BROWSER_SESSIONS', 'true');
  exact('RENDER_BROWSER_ORIGIN', HOSTINGER_RELEASE_ORIGIN);
  exact('RENDER_BROWSER_ALLOW_LOCAL_HTTP', 'false');
  for (const name of ['RENDER_MAINTENANCE', 'RENDER_DISABLE_SERVER_START']) {
    add(name, 'required', absent(env[name]) || env[name] === 'false' ? 'pass' : 'invalid');
  }
  let ownerProfilesStatus='deferred';
  if (!absent(env.RENDER_OWNER_PROFILES)) {
    try { parseOwnerProfilePolicy(env);ownerProfilesStatus='pass'; }
    catch { ownerProfilesStatus='invalid'; }
  }
  add('OWNER_PROFILE_CONFIGURATION','required',ownerProfilesStatus);
  // Preservation, not implicit rotation or a new strength policy. Never trim.
  add('JWT_SECRET', 'preserve', !present(env.JWT_SECRET) ? 'missing'
    : !present(currentJwtSecret) ? 'unverified' : env.JWT_SECRET === currentJwtSecret ? 'pass' : 'invalid');

  let databaseValid = false;
  if (present(env.DATABASE_URL)) {
    try {
      const config = buildDatabasePoolConfig(env);
      databaseValid = !!config?.ssl && config.ssl.rejectUnauthorized === true
        && config.ssl.minVersion === 'TLSv1.2' && !!config.password();
    } catch { /* Parser/certificate exceptions are never exposed. */ }
  }
  add('DATABASE_URL', 'preserve', !present(env.DATABASE_URL) ? 'missing' : databaseValid ? 'pass' : 'invalid');
  add('DATABASE_URL_PRESERVATION', 'preserve', !present(currentDatabaseUrl) ? 'unverified'
    : databaseValid && env.DATABASE_URL === currentDatabaseUrl ? 'pass' : 'invalid');
  // Release checklist intentionally requires an explicit provider CA bundle,
  // although the runtime also supports Node's public root store without one.
  add('RENDER_DB_CA_PEM', 'required', !present(env.RENDER_DB_CA_PEM) ? 'missing'
    : databaseValid ? 'pass' : 'invalid');
  for (const name of ['NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'PGSSLROOTCERT', 'PGSSLCERT', 'PGSSLKEY', 'PGSSLCRL']) {
    add(name, 'required', absent(env[name]) ? 'pass' : 'invalid');
  }
  add('NODE_TLS_REJECT_UNAUTHORIZED', 'required', absent(env.NODE_TLS_REJECT_UNAUTHORIZED)
    || env.NODE_TLS_REJECT_UNAUTHORIZED === '1' ? 'pass' : 'invalid');
  add('PGSSLMODE', 'required', absent(env.PGSSLMODE) || env.PGSSLMODE === 'verify-full' ? 'pass' : 'invalid');
  add('PGSSLNEGOTIATION', 'required', absent(env.PGSSLNEGOTIATION) || env.PGSSLNEGOTIATION === 'postgres' ? 'pass' : 'invalid');
  const automationConfigured = ['RENDER_AUTOMATIONS_MODE','RENDER_AUTOMATION_JOBS','RENDER_AUTOMATION_CONNECTION_MODE']
    .some(name => !absent(env[name]));
  let automationPolicy;
  if (automationConfigured) {
    try { automationPolicy = resolveScheduledAutomationPolicy(env); } catch { /* Closed configuration only. */ }
  }
  add('SCHEDULED_AUTOMATION_CONFIGURATION','required', !automationConfigured ? 'deferred'
    : automationPolicy && !automationPolicy.paused ? 'pass' : 'invalid');
  add('MIA_SUPERVISOR_ENABLED','required', absent(env.MIA_SUPERVISOR_ENABLED) || env.MIA_SUPERVISOR_ENABLED === 'false'
    || (env.MIA_SUPERVISOR_ENABLED === 'true' && automationPolicy?.jobs.includes('supervisor')) ? 'pass' : 'invalid');
  for (const name of ['MIA_SUPERVISOR_REASONING_ENABLED', 'TASK_COMPLETED_CLEANUP_ENABLED', 'TASK_AUTOMATIC_DELETION_ENABLED']) {
    add(name, 'required', absent(env[name]) || env[name] === 'false' ? 'pass' : 'invalid');
  }
  // Personal email collection is deferred, NOT existing SMTP operation.
  // Explicit host/port/user/password form the release-review quartet. No send,
  // credential replacement, provider validation or activation happens here.
  const smtpNames = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
  const smtpConfigured = smtpNames.some(name => !absent(env[name]));
  const smtpComplete = smtpNames.every(name => present(env[name]))
    && /^\d+$/.test(env.SMTP_PORT) && Number(env.SMTP_PORT) >= 1 && Number(env.SMTP_PORT) <= 65535;
  add('SMTP_CONFIGURATION', 'preserve', smtpConfigured && !smtpComplete ? 'invalid' : 'unverified');
  for (const name of smtpNames) {
    add(name, 'preserve', !absent(env[name]) && !present(env[name]) ? 'missing' : 'unverified');
  }
  add('SMTP_SECURE', 'preserve', absent(env.SMTP_SECURE) || ['true', 'false'].includes(env.SMTP_SECURE)
    ? 'unverified' : 'invalid');
  add('GOOGLE_BUILD_MATCH', 'preserve', !present(frontendGoogleClientId) || !present(env.GOOGLE_CLIENT_ID)
    ? 'unverified' : frontendGoogleClientId === env.GOOGLE_CLIENT_ID ? 'pass' : 'invalid');
  for (const name of ['GOOGLE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET',
    'GOOGLE_DRIVE_REDIRECT_URI', 'WILSON_PUBLIC_KEY', 'WILSON_ALLOWED_TELEGRAM_IDS',
    'WILSON_SYSTEM_ACTOR_ID', 'EMAIL_FROM', 'EMAIL_REPLY_TO', 'OPENAI_API_KEY']) {
    add(name, 'preserve', absent(env[name]) ? 'unverified' : placeholder.test(String(env[name])) ? 'missing' : 'unverified');
  }
  const configurationValid = checks.every(c => !['invalid', 'missing'].includes(c.status) && (c.category === 'preserve'
    && !['JWT_SECRET', 'DATABASE_URL', 'DATABASE_URL_PRESERVATION'].includes(c.name)
    ? true : ['pass', 'deferred'].includes(c.status)));
  return Object.freeze({ configurationValid, releaseApproved: false, checks: Object.freeze(checks) });
}
