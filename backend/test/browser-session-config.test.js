import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { configuredBrowserSessions, createPrincipalAuthentication } from '../src/browser-session-config.js';
const secret = 'synthetic-principal-browser-selector-only';
const env = { JWT_SECRET: secret, RENDER_BROWSER_SESSIONS: 'true', RENDER_BROWSER_ORIGIN: 'https://render.example.test' };
const user = { id: 7, usuario: 'qa', nombre: 'QA', rol: 'edicion', activo: true, session_version: 1 };
const response = () => ({ headers: {}, statusCode: 200, set(key, value) { this.headers[key] = value; return this; },
  status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } });
test('explicit browser opt-in defaults off and rejects unsafe/unrecognized development config', () => {
  const pool = { query() { assert.fail('no DB at configuration'); } };
  assert.equal(configuredBrowserSessions({}, pool), null);
  assert.equal(configuredBrowserSessions({ RENDER_BROWSER_SESSIONS: 'false' }, pool), null);
  assert.ok(configuredBrowserSessions(env, pool));
  for (const extra of [{ RENDER_BROWSER_SESSIONS: '' }, { RENDER_BROWSER_SESSIONS: 'TRUE' },
    { RENDER_BROWSER_ORIGIN: undefined }, { JWT_SECRET: undefined }, { RENDER_BROWSER_ALLOW_LOCAL_HTTP: 'yes' },
    { RENDER_BROWSER_ALLOW_LOCAL_HTTP: 'true', NODE_ENV: 'production' },
    { RENDER_BROWSER_ALLOW_LOCAL_HTTP: 'true', NODE_ENV: undefined },
    { RENDER_BROWSER_ORIGIN: 'http://127.0.0.1:5195' },
    { RENDER_BROWSER_ORIGIN: 'http://localhost:5195', RENDER_BROWSER_ALLOW_LOCAL_HTTP: 'true', NODE_ENV: 'test' }])
    assert.throws(() => configuredBrowserSessions({ ...env, ...extra }, pool));
  assert.ok(configuredBrowserSessions({ ...env, NODE_ENV: 'test', RENDER_BROWSER_ALLOW_LOCAL_HTTP: 'true',
    RENDER_BROWSER_ORIGIN: 'http://127.0.0.1:5195' }, pool));
});

test('principal selector has no credential fallback and always reloads current account authority', async () => {
  const old = process.env.JWT_SECRET; process.env.JWT_SECRET = secret;
  try {
    let reads = 0;
    const pool = { async query() { reads++; return { rows: [user] }; } };
    const transport = configuredBrowserSessions(env, pool), login = response();
    transport.establishSession(user, login);
    const cookie = login.headers['Set-Cookie'].split(';')[0];
    const bearer = jwt.sign({ id: 7, session_version: 1 }, secret,
      { issuer: 'render', audience: 'render-api', expiresIn: '8h' });
    const authenticate = createPrincipalAuthentication({ browserTransport: transport, pool });
    for (const [headers, status] of [
      [{ cookie }, 200], [{ authorization: `Bearer ${bearer}` }, 200],
      [{ cookie, authorization: `Bearer ${bearer}` }, 400],
      [{ cookie: '__Host-render_session =bad', authorization: `Bearer ${bearer}` }, 400],
      [{ cookie: 'render_dev_session=bad', authorization: `Bearer ${bearer}` }, 400],
      [{ cookie: '__Host-render_session=bad' }, 401],
      [{ 'x-render-session-context': 'stale' }, 401],
      [{ 'x-render-csrf': '', authorization: `Bearer ${bearer}` }, 400],
      [{ authorization: 'Bearer invalid' }, 401], [{}, 401],
    ]) {
      const req = { method: 'GET', headers }, res = response(); let continued = false;
      const before = reads;
      await authenticate(req, res, error => { assert.ifError(error); continued = true; });
      assert.equal(res.statusCode, status); assert.equal(continued, status === 200);
      assert.equal(reads - before, status === 200 ? 1 : 0);
      assert.equal(res.headers['Set-Cookie'], undefined);
      if (continued) assert.equal(req.auth.rol, 'edicion');
    }
    const disabled = createPrincipalAuthentication({ browserTransport: null, pool });
    const res = response(); await disabled({ method: 'GET', headers: { cookie } }, res, () => assert.fail('not enabled'));
    assert.equal(res.statusCode, 401);
  } finally { if (old === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = old; }
});
