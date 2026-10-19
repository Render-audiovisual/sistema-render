import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const section = (start, end) => server.slice(server.indexOf(start), server.indexOf(end));
test('principal password route keeps limiter/input/hash/active checks around shared unique identity lookup', () => {
  const route = section('router.post("/login",', 'router.post("/login/google",');
  assert.ok(route.indexOf('passwordLoginInput(req.body)') < route.indexOf('allowLoginAttempt'));
  assert.ok(route.indexOf('allowLoginAttempt') < route.indexOf('findPasswordLoginIdentity(pool, identificador)'));
  assert.match(route, /bcrypt.compare/); assert.match(route, /usuarioDB.activo !== true/);
  assert.match(route, /issueUserToken\(usuarioDB\)/);
  assert.doesNotMatch(route, /email_notificaciones|porEmail|req.body.rol|req.body.id/);
});
test('principal Google route verifies actual provider token before resolving, and serializes safe expected errors', () => {
  const route = section('router.post("/login/google",', '// El callback de Google vuelve');
  assert.ok(route.indexOf('allowLoginAttempt') < route.indexOf('googleClient.verifyIdToken'));
  assert.ok(route.indexOf('googleClient.verifyIdToken') < route.indexOf('resolveGoogleLoginIdentity(pool, payload)'));
  assert.match(route, /audience: process.env.GOOGLE_CLIENT_ID/);
  assert.match(route, /payload\?\.email_verified !== true/);
  assert.ok(route.indexOf('resolveGoogleLoginIdentity(pool, payload)') < route.indexOf('issueUserToken(usuarioDB)'));
  assert.match(route, /Object.hasOwn\(identityErrors, error.status\)/);
  assert.doesNotMatch(route, /error.message|process.env.NODE_ENV|fixture|req.body.sub|UPDATE usuarios|SELECT .*FROM usuarios/);
});
