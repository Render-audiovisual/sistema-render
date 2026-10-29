import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';
import { validateHostingerReleaseConfig } from '../src/hostinger-release-config.js';

const url = 'postgresql://fixture:synthetic-password@db.example.invalid:5432/render';
const secret = 'synthetic-only-not-a-real-secret-123456789';
const options = { nodeVersion: '24.1.0', currentDatabaseUrl: url, currentJwtSecret: secret };
const base = () => ({ NODE_ENV: 'production', APP_URL: 'https://sistema.rendercorrientes.com',
  RENDER_DB_ENVIRONMENT: 'production', SETUP_DEMO_DATA: 'false', RENDER_BACKGROUND_JOBS: '',
  RENDER_ALLOW_BACKGROUND_WRITES: 'false', RENDER_BROWSER_SESSIONS: 'true',
  RENDER_BROWSER_ORIGIN: 'https://sistema.rendercorrientes.com', RENDER_BROWSER_ALLOW_LOCAL_HTTP: 'false',
  DATABASE_URL: url, JWT_SECRET: secret, RENDER_DB_CA_PEM: rootCertificates[0] });
const check = (result, name) => result.checks.find(c => c.name === name);

test('release checklist cannot call a production-blocked owner profile mapping ready',()=>{
  const env={...base(),RENDER_OWNER_PROFILES:JSON.stringify({accountId:1,francoUserId:31,agustinUserId:32})};
  const result=validateHostingerReleaseConfig(env,options);
  assert.equal(result.configurationValid,false);
  assert.equal(check(result,'OWNER_PROFILE_CONFIGURATION').status,'invalid');
});

test('explicit shared production mode accepts configuration only, never certifies profile records or release',()=>{
  const env={...base(),RENDER_OWNER_PROFILE_MODE:'shared-v1',
    RENDER_OWNER_PROFILES:JSON.stringify({accountId:1,francoUserId:31,agustinUserId:32})};
  const result=validateHostingerReleaseConfig(env,options);
  assert.equal(result.configurationValid,true);
  assert.equal(result.releaseApproved,false);
  for(const mapping of [{accountId:1,francoUserId:14,agustinUserId:32},
    {accountId:1,francoUserId:91005,agustinUserId:91006}]){
    assert.equal(validateHostingerReleaseConfig({...env,RENDER_OWNER_PROFILES:JSON.stringify(mapping)},options).configurationValid,false);
  }
});

test('pure checklist accepts explicit safe configuration, never approves release or mutates inputs', () => {
  const env = Object.freeze(base()), before = { ...env };
  const result = validateHostingerReleaseConfig(env, Object.freeze(options));
  assert.equal(result.configurationValid, true); assert.equal(result.releaseApproved, false);
  assert.deepEqual(env, before); assert.equal(check(result, 'SMTP_PASS').status, 'unverified');
  assert.equal(check(result, 'GOOGLE_CLIENT_ID').status, 'unverified');
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.checks));
  for (const row of result.checks) assert.deepEqual(Object.keys(row), ['name', 'category', 'status']);
});

test('missing configuration and required markers never pass; preservation requires private comparison', () => {
  assert.equal(validateHostingerReleaseConfig().configurationValid, false);
  for (const name of ['DATABASE_URL', 'JWT_SECRET', 'RENDER_DB_CA_PEM']) {
    const result = validateHostingerReleaseConfig({ ...base(), [name]: '<REQUIRED_PRESERVE_EXISTING>' }, options);
    assert.equal(check(result, name).status, 'missing'); assert.equal(result.configurationValid, false);
  }
  assert.equal(check(validateHostingerReleaseConfig(base(), { nodeVersion: '24.1.0' }), 'DATABASE_URL_PRESERVATION').status, 'unverified');
  assert.equal(validateHostingerReleaseConfig(base(), { ...options, currentDatabaseUrl: url + 'other' }).configurationValid, false);
});

for (const [name, value] of Object.entries({ NODE_ENV: 'development', APP_URL: 'https://sistema.rendercorrientes.com/',
  RENDER_DB_ENVIRONMENT: 'test', SETUP_DEMO_DATA: 'true', RENDER_BACKGROUND_JOBS: 'wilson',
  RENDER_ALLOW_BACKGROUND_WRITES: 'true', RENDER_BROWSER_SESSIONS: 'false',
  RENDER_BROWSER_ORIGIN: 'http://sistema.rendercorrientes.com', RENDER_BROWSER_ALLOW_LOCAL_HTTP: 'true',
  NODE_TLS_REJECT_UNAUTHORIZED: '0', NODE_OPTIONS: '--inspect', NODE_EXTRA_CA_CERTS: '/secret',
  PGSSLMODE: 'require', PGSSLROOTCERT: '/secret', PGSSLCERT: '/secret', PGSSLKEY: '/secret', PGSSLCRL: '/secret',
  PGSSLNEGOTIATION: 'direct', MIA_SUPERVISOR_ENABLED: 'true', MIA_SUPERVISOR_REASONING_ENABLED: 'true',
  TASK_COMPLETED_CLEANUP_ENABLED: 'true' })) {
  test(`rejects unsafe or active ${name} without returning its value`, () => {
    const result = validateHostingerReleaseConfig({ ...base(), [name]: value }, options);
    assert.equal(result.configurationValid, false); assert.equal(check(result, name).status, 'invalid');
    for (const row of result.checks) {
      assert.deepEqual(Object.keys(row), ['name', 'category', 'status']);
      assert.ok(['pass', 'missing', 'invalid', 'unverified', 'deferred'].includes(row.status));
    }
  });
}

test('Node24 only; malformed/query/fragment/local/empty-password DB destinations reject', () => {
  for (const nodeVersion of ['22.1.0', '25.0.0', '24', undefined])
    assert.equal(validateHostingerReleaseConfig(base(), { ...options, nodeVersion }).configurationValid, false);
  for (const DATABASE_URL of [url + '?sslmode=require', url + '?', url + '#', 'broken-private-url',
    'postgresql://fixture:pass@127.0.0.1/render', 'postgresql://fixture@db.example.invalid/render']) {
    assert.equal(validateHostingerReleaseConfig({ ...base(), DATABASE_URL }, options).configurationValid, false);
  }
});

test('invalid CA/private key and changed JWT fail without leaking secret/provider/error strings', () => {
  for (const patch of [{ RENDER_DB_CA_PEM: '-----BEGIN PRIVATE KEY-----\nPRIVATE_SENTINEL' },
    { JWT_SECRET: 'short' }, { JWT_SECRET: 'x'.repeat(40) + '\n' }]) {
    const result = validateHostingerReleaseConfig({ ...base(), ...patch }, options);
    assert.equal(result.configurationValid, false);
    for (const value of Object.values(patch)) assert.equal(JSON.stringify(result).includes(value), false);
  }
  const result = validateHostingerReleaseConfig({ ...base(), GOOGLE_DRIVE_CLIENT_SECRET: 'PRIVATE_SENTINEL',
    DATABASE_URL: 'postgresql://PRIVATE_SENTINEL:PRIVATE_SENTINEL@invalid?secret' }, options);
  assert.equal(JSON.stringify(result).includes('PRIVATE_SENTINEL'), false);
  assert.equal(JSON.stringify(result).includes('synthetic-password'), false);
});

test('template is explicitly nonusable, preserves SMTP/WhatsApp and invents no OAuth credentials', () => {
  const source = readFileSync(new URL('../../ops/hostinger-release.env.example', import.meta.url), 'utf8');
  assert.match(source, /NOT a usable/); assert.match(source, /<REQUIRED_PRESERVE_EXISTING_DATABASE_URL_NO_QUERY>/);
  assert.doesNotMatch(source, /^SMTP_\w+=/m); assert.doesNotMatch(source, /^GOOGLE_\w+=.+$/m);
  assert.match(source, /Preserve BOTH existing WhatsApp paths/);
  const env = Object.fromEntries(source.split('\n').filter(line => /^[A-Z_]+=/.test(line)).map(line => {
    const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)];
  }));
  assert.equal(validateHostingerReleaseConfig(env, options).configurationValid, false);
});

test('JWT preservation compares exact private reference; absence is unverified, not invalid or an implicit rotation', () => {
  const env = { ...base(), JWT_SECRET: 'old-short-secret ' };
  const matched = validateHostingerReleaseConfig(env, { ...options, currentJwtSecret: env.JWT_SECRET });
  assert.equal(check(matched, 'JWT_SECRET').status, 'pass'); assert.equal(matched.configurationValid, true);
  assert.equal(check(validateHostingerReleaseConfig(env, { ...options, currentJwtSecret: undefined }), 'JWT_SECRET').status, 'unverified');
  assert.equal(check(validateHostingerReleaseConfig(env, { ...options, currentJwtSecret: env.JWT_SECRET.trim() }), 'JWT_SECRET').status, 'invalid');
  assert.equal(JSON.stringify(matched).includes(env.JWT_SECRET), false);
});

test('existing complete SMTP quartet is preserved unverified, partial/malformed settings flagged without sending', () => {
  const smtp = { SMTP_HOST: 'smtp.example.invalid', SMTP_PORT: '465', SMTP_USER: 'existing-user',
    SMTP_PASS: 'existing-private-password', SMTP_SECURE: 'true', EMAIL_FROM: 'existing@example.invalid' };
  const env = Object.freeze({ ...base(), ...smtp });
  const result = validateHostingerReleaseConfig(env, options);
  assert.equal(result.configurationValid, true); assert.equal(check(result, 'SMTP_CONFIGURATION').status, 'unverified');
  assert.equal(env.SMTP_PASS, smtp.SMTP_PASS);
  for (const value of [smtp.SMTP_HOST, smtp.SMTP_USER, smtp.SMTP_PASS, smtp.EMAIL_FROM])
    assert.equal(JSON.stringify(result).includes(value), false);
  for (const patch of [{ SMTP_PASS: '' }, { SMTP_PORT: '0' }, { SMTP_PORT: '65536' }, { SMTP_PORT: 'bad' }, { SMTP_SECURE: 'bad' }])
    assert.equal(validateHostingerReleaseConfig({ ...env, ...patch }, options).configurationValid, false);
});

test('Google build match requires both supplied public IDs; WhatsApp settings are neither disabled nor hidden', () => {
  const env = Object.freeze({ ...base(), GOOGLE_CLIENT_ID: 'existing-public-id', WILSON_PUBLIC_KEY: 'existing-public-key',
    WILSON_ALLOWED_TELEGRAM_IDS: 'existing-identities', WILSON_SYSTEM_ACTOR_ID: 'existing-actor' });
  assert.equal(check(validateHostingerReleaseConfig(env, options), 'GOOGLE_BUILD_MATCH').status, 'unverified');
  const result = validateHostingerReleaseConfig(env, { ...options, frontendGoogleClientId: env.GOOGLE_CLIENT_ID });
  assert.equal(check(result, 'GOOGLE_BUILD_MATCH').status, 'pass'); assert.equal(result.configurationValid, true);
  assert.equal(validateHostingerReleaseConfig(env, { ...options, frontendGoogleClientId: 'different-public-id' }).configurationValid, false);
  for (const name of ['WILSON_PUBLIC_KEY', 'WILSON_ALLOWED_TELEGRAM_IDS', 'WILSON_SYSTEM_ACTOR_ID'])
    assert.equal(check(result, name).status, 'unverified');
  assert.equal(JSON.stringify(result).includes('existing-public-id'), false);
});
