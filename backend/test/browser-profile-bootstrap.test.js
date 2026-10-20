import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Executes the actual route callback with an injected pool, not a substitute
// resolver. Physical password/HTTP/PG coverage lives in browser-client suite.
const source = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const begin = source.indexOf('router.get("/sesion",');
const end = source.indexOf('router.post("/logout",', begin);
assert.ok(begin >= 0 && end > begin);
function route(query) {
  let handler;
  new Function('router', 'pool', source.slice(begin, end))({ get(path, callback) {
    assert.equal(path, '/sesion'); handler = callback;
  } }, { query });
  return handler;
}
const identity = { id: 7, usuario: 'synthetic', nombre: 'Synthetic', rol: 'edicion', session_version: 3 };
const context = { session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) };
function response() {
  return { headers: { 'X-Render-Session-Context': context.session_context }, code: 200,
    set(name, value) { this.headers[name] = value; }, removeHeader(name) { delete this.headers[name]; },
    status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
}
test('browser bootstrap selects saved photo within the observed active account epoch and emits only closed fields', async () => {
  for (const photo of [null, 'data:image/png;base64,c3ludGhldGlj']) {
    const handle = route(async (sql, parameters) => {
      assert.equal(sql.replace(/\s+/g, ' ').trim(), 'SELECT id, usuario, nombre, rol, foto_perfil FROM usuarios WHERE id=$1 AND session_version=$2 AND activo IS TRUE');
      assert.deepEqual(parameters, [7, 3]);
      return { rows: [{ ...identity, foto_perfil: photo, password_hash: 'must-not-escape', sueldo: 123 }] };
    });
    const res = response(); await handle({ auth: identity, browserSession: context }, res, error => { throw error; });
    assert.equal(res.headers['Cache-Control'], 'no-store'); assert.equal(res.code, 200);
    assert.deepEqual(res.body, { usuario: { id: 7, usuario: 'synthetic', nombre: 'Synthetic', rol: 'edicion', foto_perfil: photo }, ...context });
  }
});
test('revocation between middleware and bootstrap query returns 401 without a confirmed-context proof or DTO fallback', async () => {
  const handle = route(async () => ({ rows: [] })), res = response();
  await handle({ auth: identity, browserSession: context }, res, error => { throw error; });
  assert.equal(res.code, 401); assert.equal(res.headers['X-Render-Session-Context'], undefined);
  assert.equal(res.body.usuario, undefined);
});
test('browser query failure is forwarded, never replaced by stale auth profile', async () => {
  const failure = new Error('synthetic unavailable'), handle = route(async () => { throw failure; });
  const res = response(); let forwarded;
  await handle({ auth: identity, browserSession: context }, res, error => { forwarded = error; });
  assert.equal(forwarded, failure); assert.equal(res.body, undefined);
});
test('legacy bearer bootstrap remains unchanged and does not issue an additional profile query', async () => {
  const handle = route(() => assert.fail('No additional legacy query')), res = response();
  await handle({ auth: identity }, res, error => { throw error; });
  assert.deepEqual(res.body, { usuario: identity });
});
