import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createBrowserSessionTransport } from '../src/browser-session-transport.js';

const secret = 'synthetic-browser-boundary-unit-tests-only';
const origin = 'https://render.example.test';
const user = { id: 7, usuario: 'qa', nombre: 'QA', rol: 'edicion', activo: true, session_version: 1 };
function response() {
  return { statusCode: 200, headers: {}, body: null,
    set(key, value) { this.headers[key.toLowerCase()] = value; return this; },
    status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
}
function fixture(overrides = {}) {
  let row = user, reads = 0;
  const config = { origin, secret, pool: { async query(sql, params) {
    reads++; assert.match(sql, /FROM usuarios WHERE id=\$1/); assert.deepEqual(params, [7]);
    return { rows: row ? [row] : [] };
  } }, ...overrides };
  const transport = createBrowserSessionTransport(config);
  return { transport, get reads() { return reads; }, setRow(value) { row = value; } };
}
function session(transport) {
  const res = response(), context = transport.establishSession(user, res);
  return { cookie: res.headers['set-cookie'].split(';')[0], context, res };
}
async function run(transport, current, { method = 'POST', headers = {} } = {}) {
  const req = { method, headers: { cookie: current.cookie, origin,
    'x-render-session-context': current.context.session_context, 'x-render-csrf': current.context.csrf_token, ...headers } };
  const res = response(); let continued = false, error;
  await transport.authenticate(req, res, value => { error = value; continued = !value; });
  return { req, res, continued, error };
}

test('configuration requires canonical explicit HTTPS origin and bounded development HTTP exception', () => {
  for (const value of ['*', 'null', 'https://render.example.test/', 'https://render.example.test/path',
    'https://render.example.test?x=1', 'https://user:pass@render.example.test', 'https://render.example.test#x',
    'https://RENDER.example.test', 'http://render.example.test', 'file:///tmp/test']) {
    assert.throws(() => fixture({ origin: value }), /Invalid browser session configuration/);
  }
  assert.throws(() => fixture({ secret: 'short' }));
  assert.throws(() => fixture({ origin: 'http://127.0.0.1:5195' }));
  for (const host of ['127.0.0.1', '[::1]']) {
    const { transport } = fixture({ origin: `http://${host}:5195`, development: true });
    assert.equal(transport.sessionName, 'render_dev_session');
    const { res } = session(transport);
    assert.ok(!res.headers['set-cookie'].includes('; Secure'));
  }
  assert.throws(() => fixture({ origin: 'http://localhost.evil.test', development: true }));
  assert.throws(() => fixture({ origin: 'http://localhost:5195', development: true }));
});

test('session serializer confines credentials to host-only HttpOnly cookie; DTO is context and CSRF only', () => {
  const { transport } = fixture();
  const first = session(transport), second = session(transport);
  assert.match(first.res.headers['set-cookie'], /^__Host-render_session=/);
  assert.match(first.res.headers['set-cookie'], /; Path=\/; HttpOnly; SameSite=Lax; Max-Age=28800; Secure$/);
  assert.ok(!first.res.headers['set-cookie'].includes('Domain='));
  assert.equal(first.res.headers['cache-control'], 'no-store');
  assert.deepEqual(Object.keys(first.context), ['session_context', 'csrf_token']);
  for (const value of Object.values(first.context)) assert.match(value, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.context.session_context, first.context.csrf_token);
  assert.notEqual(first.context.session_context, second.context.session_context);
  assert.notEqual(first.context.csrf_token, second.context.csrf_token);
});

test('valid browser sessions use existing current account authority and never refresh cookies', async () => {
  const f = fixture(), current = session(f.transport);
  f.setRow({ ...user, rol: 'diseno', nombre: 'Updated account' });
  for (const method of ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'PUT']) {
    const result = await run(f.transport, current, { method });
    assert.ok(result.continued); assert.equal(result.req.auth.rol, 'diseno');
    assert.equal(result.req.auth.nombre, 'Updated account');
    assert.deepEqual(result.req.browserSession, current.context);
    assert.equal(result.res.headers['set-cookie'], undefined);
    assert.equal(result.res.headers['cache-control'], 'no-store');
  }
});

test('same credential on another explicitly configured origin has distinct context and CSRF bindings', async () => {
  const first = fixture(), current = session(first.transport);
  const otherOrigin = 'https://other-render.example.test';
  const other = fixture({ origin: otherOrigin });
  const read = await run(other.transport, current, { method: 'GET', headers: { origin: otherOrigin } });
  assert.ok(read.continued);
  assert.notEqual(read.req.browserSession.session_context, current.context.session_context);
  assert.notEqual(read.req.browserSession.csrf_token, current.context.csrf_token);
  const write = await run(other.transport, current, { headers: { origin: otherOrigin } });
  assert.equal(write.res.statusCode, 409);
  assert.equal(write.continued, false);
});

test('all unsafe methods deny missing/cross-session context and CSRF before database or business', async () => {
  for (const method of ['POST', 'PATCH', 'DELETE', 'PUT']) {
    const f = fixture(), a = session(f.transport), b = session(f.transport);
    const cases = [
      [{ 'x-render-session-context': undefined }, 409],
      [{ 'x-render-session-context': a.context.session_context, 'x-render-csrf': a.context.csrf_token }, 409],
      [{ 'x-render-csrf': undefined }, 403], [{ 'x-render-csrf': a.context.csrf_token }, 403],
      [{ 'x-render-csrf': b.context.session_context }, 403], [{ 'x-render-csrf': 'é'.repeat(43) }, 403],
      [{ 'x-render-csrf': ['duplicate', b.context.csrf_token] }, 403],
    ];
    for (const [headers, status] of cases) {
      const result = await run(f.transport, b, { method, headers });
      assert.equal(result.res.statusCode, status); assert.equal(result.continued, false);
      assert.equal(result.res.headers['set-cookie'], undefined);
    }
    assert.equal(f.reads, 0);
  }
});

test('explicit origin, Fetch Metadata and credential ambiguity reject without fallback', async () => {
  const f = fixture(), current = session(f.transport);
  for (const headers of [{ origin: undefined }, { origin: 'null' }, { origin: 'https://evil.test' },
    { origin: `${origin}/` }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' },
    { authorization: 'Bearer unrelated' }, { authorization: '' }]) {
    const result = await run(f.transport, current, { headers });
    assert.ok([400, 403].includes(result.res.statusCode)); assert.equal(result.continued, false);
  }
  assert.equal(f.reads, 0);
  assert.ok((await run(f.transport, current, { method: 'GET', headers: { origin: undefined } })).continued);
});

test('malformed/duplicate cookies and expired or purpose tokens cannot authenticate', async () => {
  const f = fixture(), current = session(f.transport), name = f.transport.sessionName;
  const expired = jwt.sign({ id: 7, session_version: 1, exp: 1, jti: '6c23d760-d8fd-4f01-b43b-f4368ed3af4e' }, secret,
    { issuer: 'render', audience: 'render-api' });
  const legacy = jwt.sign({ id: 7, session_version: 1 }, secret, { issuer: 'render', audience: 'render-api', expiresIn: '8h' });
  for (const cookie of [undefined, '', `${current.cookie}; ${current.cookie}`, `${current.cookie}; ${name} =bad`,
    `${current.cookie}; ${name}\t=bad`, `${current.cookie}; malformed`, `${name}=incorrect`, `${name}=%20`,
    `${name}="quoted"`, `${name}=${expired}`, `${name}=${legacy}`, 'x='.padEnd(17000, 'x')]) {
    const result = await run(f.transport, current, { headers: { cookie } });
    assert.equal(result.res.statusCode, 401); assert.equal(result.continued, false);
    assert.equal(result.res.headers['set-cookie'], undefined);
  }
  assert.equal(f.reads, 0);
});

test('disabled/deleted/revoked accounts fail closed; database errors propagate without cookie changes', async () => {
  const f = fixture(), current = session(f.transport);
  for (const row of [null, { ...user, activo: false }, { ...user, session_version: 2 }]) {
    f.setRow(row); const result = await run(f.transport, current);
    assert.equal(result.res.statusCode, 401); assert.equal(result.continued, false);
    assert.equal(result.res.headers['set-cookie'], undefined);
  }
  const error = Error('synthetic database outage');
  const failed = fixture({ pool: { query: async () => { throw error; } } });
  const result = await run(failed.transport, session(failed.transport));
  assert.equal(result.error, error); assert.equal(result.req.browserSession, undefined);
  assert.equal(result.res.headers['set-cookie'], undefined);
});

test('anonymous login challenge is distinct from authentication and requires exact origin and bound CSRF', () => {
  const f = fixture(), res = response();
  f.transport.issueLoginChallenge({ method: 'GET', headers: {} }, res);
  const challenge = res.headers['set-cookie'].split(';')[0];
  assert.match(res.headers['set-cookie'], /^__Host-render_login=.*; HttpOnly; SameSite=Strict; Max-Age=600; Secure$/);
  const headers = { cookie: challenge, origin, 'x-render-csrf': res.body.csrf_token };
  let continued = false;
  f.transport.requireLoginChallenge({ headers }, response(), () => { continued = true; });
  assert.ok(continued);
  for (const extra of [{ origin: undefined }, { origin: 'https://evil.test' }, { 'x-render-csrf': undefined },
    { 'x-render-csrf': session(f.transport).context.csrf_token }, { cookie: `${challenge}; ${challenge}` }]) {
    const denied = response();
    f.transport.requireLoginChallenge({ headers: { ...headers, ...extra } }, denied, () => assert.fail('must deny'));
    assert.equal(denied.statusCode, 403); assert.equal(denied.headers['set-cookie'], undefined);
  }
  assert.equal(f.reads, 0);
});

test('login challenge rejects expired signatures and a normal account credential without granting identity', () => {
  const f = fixture(), expired = jwt.sign({ purpose: 'browser_login', exp: 1, iat: -599,
    jti: '6c23d760-d8fd-4f01-b43b-f4368ed3af4e' }, secret,
  { issuer: 'render', audience: 'render-browser-login' });
  const accountCredential = session(f.transport).cookie.split('=')[1];
  for (const token of [expired, accountCredential]) {
    const res = response();
    f.transport.requireLoginChallenge({ headers: { origin, cookie: `${f.transport.challengeName}=${token}`,
      'x-render-csrf': 'A'.repeat(43) } }, res, () => assert.fail('must deny'));
    assert.equal(res.statusCode, 403);
    assert.equal(res.headers['set-cookie'], undefined);
  }
  assert.equal(f.reads, 0);
});
