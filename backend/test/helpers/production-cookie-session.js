import assert from 'node:assert/strict';

const defaultOrigin = 'http://127.0.0.1:5195';
const proof = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
function exactKeys(value, expected) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}
async function http(base, route, { method = 'GET', body, origin, headers = {} }) {
  const fixture = new URL(base);
  assert.ok(fixture.protocol === 'http:' && fixture.hostname === '127.0.0.1'
    && !fixture.username && !fixture.password && !fixture.search && !fixture.hash, 'Expected numeric loopback fixture');
  assert.ok(typeof route === 'string' && /^\/api\//.test(route) && !route.includes('#'), 'Expected absolute API pathname');
  const target = new URL(route, base);
  assert.ok(target.origin === new URL(base).origin && target.pathname.startsWith('/api/'), 'Expected same fixture API origin');
  let response, data;
  try {
    response = await fetch(target, { method, redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', ...headers,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error('Production cookie fixture HTTP/JSON request failed');
  }
  return { response, data };
}
function cookiePair(response) {
  const values = response.headers.getSetCookie?.() || [response.headers.get('set-cookie')].filter(Boolean);
  assert.ok(values.length === 1 && typeof values[0] === 'string', 'Expected one authentication cookie');
  const pair = values[0].split(';')[0];
  assert.ok(/^[A-Za-z0-9_-]+=[A-Za-z0-9_.-]+$/.test(pair), 'Expected authentication cookie pair');
  return pair;
}

export async function loginProductionCookieSession(base, usuario, password, { origin = defaultOrigin } = {}) {
  const challenge = await http(base, '/api/sesion/desafio', { origin });
  assert.equal(challenge.response.status, 200, 'Unexpected challenge HTTP status');
  assert.ok(exactKeys(challenge.data, ['csrf_token']) && proof(challenge.data.csrf_token), 'Unexpected challenge shape');
  const challengeCookie = cookiePair(challenge.response);
  const login = await http(base, '/api/login/browser', { origin, method: 'POST', body: { usuario, password },
    headers: { Cookie: challengeCookie, 'X-Render-CSRF': challenge.data.csrf_token } });
  assert.equal(login.response.status, 200, 'Unexpected browser login HTTP status');
  assert.ok(exactKeys(login.data, ['usuario', 'session_context', 'csrf_token']), 'Unexpected browser login shape');
  assert.ok(proof(login.data.session_context) && proof(login.data.csrf_token)
    && login.data.session_context !== login.data.csrf_token, 'Expected distinct session proofs');
  assert.ok(Number.isSafeInteger(login.data.usuario?.id) && login.data.usuario.id > 0, 'Expected authenticated user');
  return { cookie: cookiePair(login.response), context: login.data.session_context, csrf: login.data.csrf_token, user: login.data.usuario };
}

export async function productionCookieRequest(base, route, { session, method = 'GET', body, origin = defaultOrigin } = {}) {
  assert.ok(typeof session?.cookie === 'string' && proof(session.context) && proof(session.csrf), 'Expected captured cookie session');
  const { response, data } = await http(base, route, { method, body, origin, headers: {
    Cookie: session.cookie, 'X-Render-Session-Context': session.context, 'X-Render-CSRF': session.csrf,
  } });
  if (response.ok) assert.ok(response.headers.get('x-render-session-context') === session.context,
    'Successful operational response must prove its original cookie context');
  return { status: response.status, body: data };
}
