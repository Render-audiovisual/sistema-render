import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const handlers = readFileSync(new URL('../src/login-handlers.js', import.meta.url), 'utf8');
const section = (start, end) => handlers.slice(handlers.indexOf(start), handlers.indexOf(end));
test('principal password route keeps limiter/input/hash/active checks around shared unique identity lookup', () => {
  const route = section('password(browser = false)', 'google(browser = false)');
  assert.ok(route.indexOf('passwordLoginInput(req.body)') < route.indexOf('allowLoginAttempt'));
  assert.ok(route.indexOf('allowLoginAttempt') < route.indexOf('findPasswordLoginIdentity(pool, identificador)'));
  assert.match(route, /bcrypt.compare/); assert.match(route, /usuarioDB.activo !== true/);
  assert.match(route, /sendSuccess\(usuarioDB, res, browser\)/);
  assert.doesNotMatch(route, /email_notificaciones|porEmail|req.body.rol|req.body.id/);
});
test('principal Google route verifies actual provider token before resolving, and serializes safe expected errors', () => {
  const route = section('google(browser = false)', 'export function loginUserDto');
  assert.ok(route.indexOf('allowLoginAttempt') < route.indexOf('googleClient.verifyIdToken'));
  assert.ok(route.indexOf('googleClient.verifyIdToken') < route.indexOf('resolveGoogleLoginIdentity(pool, payload)'));
  assert.match(route, /audience: googleAudience/);
  assert.match(route, /payload\?\.email_verified !== true/);
  assert.ok(route.indexOf('resolveGoogleLoginIdentity(pool, payload)') < route.indexOf('sendSuccess(usuarioDB, res, browser)'));
  assert.match(route, /Object.hasOwn\(identityErrors, error.status\)/);
  assert.doesNotMatch(route, /error.message|process.env.NODE_ENV|fixture|req.body.sub|UPDATE usuarios|SELECT .*FROM usuarios/);
});
test('principal modes mount the same verifier factory; browser routes are challenged and inside the small login parser', () => {
  assert.match(server, /createLoginHandlers\(\{/);
  assert.match(server, /router.post\('\/login', loginHandlers.password\(\)\)/);
  assert.match(server, /router.post\('\/login\/google', loginHandlers.google\(\)\)/);
  assert.match(server, /browserSessions.requireLoginChallenge, loginHandlers.password\(true\)/);
  assert.match(server, /browserSessions.requireLoginChallenge, loginHandlers.google\(true\)/);
  assert.match(server, /googleAudience: process.env.GOOGLE_CLIENT_ID/);
  assert.match(server, /express.json\(\{ limit: '32kb' \}\)/);
  assert.match(server, /token: issueUserToken\(user\), usuario/);
});
