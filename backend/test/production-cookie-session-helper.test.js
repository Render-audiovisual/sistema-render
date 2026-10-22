import test from 'node:test';
import assert from 'node:assert/strict';
import { loginProductionCookieSession, productionCookieRequest } from './helpers/production-cookie-session.js';

const base = 'http://127.0.0.1:55780';
const origin = 'http://127.0.0.1:5195';
const context = 'a'.repeat(43), csrf = 'b'.repeat(43), challengeCsrf = 'c'.repeat(43);
// JWT-style dots are intentional: the real transport cookie is not a single
// base64url segment. All values here are synthetic and never sent to a server.
const session = Object.freeze({ cookie: 'render_dev_session=header.payload.signature', context, csrf, user: { id: 91003 } });
const secret = 'QA131_PRIVATE_RESPONSE_CANARY';
function response(body, { status = 200, proof = context, cookies = [] } = {}) {
  return { status, ok: status >= 200 && status < 300,
    headers: { get(name) { return name.toLowerCase() === 'x-render-session-context' ? proof : null; }, getSetCookie: () => cookies },
    text: async () => typeof body === 'string' ? body : JSON.stringify(body),
  };
}
const challengeResponse = () => response({ csrf_token: challengeCsrf }, { cookies: ['render_dev_login=challenge.payload.signature; HttpOnly; SameSite=Strict; Path=/'] });
const loginBody = () => ({ usuario: { id: 91003, usuario: 'qa_editor', rol: 'edicion' }, session_context: context, csrf_token: csrf });
const loginResponse = () => response(loginBody(), { cookies: [`${session.cookie}; HttpOnly; SameSite=Lax; Path=/`] });

// All tests that replace fetch are awaited serially. No fallback to the real
// fetch exists, and the exact original descriptor is restored even on failure.
async function withFetch(stub, run) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: stub });
  try { await run(); }
  finally {
    if (original) Object.defineProperty(globalThis, 'fetch', original);
    else assert.equal(Reflect.deleteProperty(globalThis, 'fetch'), true);
    assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'fetch'), original);
  }
}
function assertRequest(url, init, path) {
  assert.ok(url instanceof URL);
  assert.equal(url.origin, base); assert.equal(url.pathname, path);
  assert.equal(init.redirect, 'error'); assert.ok(init.signal instanceof AbortSignal);
  const headers = new Headers(init.headers);
  assert.equal(headers.has('Authorization'), false);
  assert.equal(headers.get('Origin'), origin);
  assert.equal(headers.get('Sec-Fetch-Site'), 'same-origin');
  return headers;
}

test('production cookie helper has closed pure transport boundaries (serial fetch stubs)', { concurrency: false }, async t => {
  await t.test('external, credentialed and non-numeric-loopback bases fail before fetch', async () => {
    let calls = 0;
    await withFetch(() => { calls++; assert.fail('Unsafe base must never reach fetch'); }, async () => {
      for (const invalid of ['https://external.invalid', 'http://external.invalid', 'http://localhost:55780', 'https://127.0.0.1:55780',
        'http://user:password@127.0.0.1:55780', `${base}?key=private`, `${base}#private`]) {
        await assert.rejects(productionCookieRequest(invalid, '/api/inicio', { session }));
        await assert.rejects(loginProductionCookieSession(invalid, 'qa_editor', 'synthetic-password'));
      }
      assert.equal(calls, 0);
    });
  });

  await t.test('cross-origin, fragment and normalized non-API routes fail before fetch', async () => {
    let calls = 0;
    await withFetch(() => { calls++; assert.fail('Unsafe route must never reach fetch'); }, async () => {
      for (const invalid of ['https://external.invalid/api/inicio', '//external.invalid/api/inicio', '/inicio', '/api',
        '/api/inicio#private', '/api/../inicio', '/api/%2e%2e/inicio', '/api/../../outside']) {
        await assert.rejects(productionCookieRequest(base, invalid, { session }));
      }
      assert.equal(calls, 0);
    });
  });

  await t.test('valid challenge/login accepts JWT dots, exact 43-character distinct proofs and never bearer credentials', async () => {
    const calls = [];
    await withFetch(async (url, init) => {
      calls.push(url.pathname);
      const headers = assertRequest(url, init, calls.length === 1 ? '/api/sesion/desafio' : '/api/login/browser');
      if (calls.length === 1) {
        assert.equal(init.method, 'GET'); assert.equal(init.body, undefined); assert.equal(headers.has('Cookie'), false);
        return challengeResponse();
      }
      assert.equal(calls.length, 2); assert.equal(init.method, 'POST');
      assert.equal(headers.get('Cookie'), 'render_dev_login=challenge.payload.signature');
      assert.equal(headers.get('X-Render-CSRF'), challengeCsrf);
      assert.equal(headers.get('Content-Type'), 'application/json');
      assert.deepEqual(JSON.parse(init.body), { usuario: 'qa_editor', password: 'synthetic-password' });
      return loginResponse();
    }, async () => {
      const result = await loginProductionCookieSession(base, 'qa_editor', 'synthetic-password');
      assert.deepEqual(result, { cookie: session.cookie, context, csrf, user: loginBody().usuario });
      assert.equal(Object.hasOwn(result, 'token'), false);
      assert.deepEqual(calls, ['/api/sesion/desafio', '/api/login/browser']);
    });
  });

  await t.test('operational GET and writes send the captured cookie/context/CSRF without Authorization', async () => {
    const calls = [];
    await withFetch(async (url, init) => {
      const headers = assertRequest(url, init, '/api/producciones');
      assert.equal(headers.get('Cookie'), session.cookie);
      assert.equal(headers.get('X-Render-Session-Context'), context); assert.equal(headers.get('X-Render-CSRF'), csrf);
      calls.push(init.method);
      if (init.method === 'POST') {
        assert.equal(headers.get('Content-Type'), 'application/json'); assert.deepEqual(JSON.parse(init.body), { titulo: 'Explicit work' });
      } else assert.equal(init.body, undefined);
      return response({ ok: true });
    }, async () => {
      assert.deepEqual(await productionCookieRequest(base, '/api/producciones', { session }), { status: 200, body: { ok: true } });
      assert.deepEqual(await productionCookieRequest(base, '/api/producciones', { session, method: 'POST', body: { titulo: 'Explicit work' } }), { status: 200, body: { ok: true } });
      assert.deepEqual(calls, ['GET', 'POST']);
    });
  });

  await t.test('successful GET with cookie-B proof rejects before returning data, not an assumed HTTP409', async () => {
    for (const proof of ['d'.repeat(43), null, '']) {
      let calls = 0;
      await withFetch(async () => { calls++; return response({ private: secret }, { status: 200, proof }); }, async () => {
        await assert.rejects(productionCookieRequest(base, '/api/inicio', { session }), error => {
          assert.equal(error.message, 'Successful operational response must prove its original cookie context');
          assert.equal(error.message.includes(secret), false); return true;
        });
        assert.equal(calls, 1, 'No retry of a mismatched successful response');
      });
    }
  });

  await t.test('non-success HTTP409 is returned as an error DTO without requiring a success proof or retry', async () => {
    let calls = 0;
    await withFetch(async () => { calls++; return response({ error: 'Context mismatch' }, { status: 409, proof: null }); }, async () => {
      assert.deepEqual(await productionCookieRequest(base, '/api/producciones/id/videos', { session, method: 'POST', body: {} }),
        { status: 409, body: { error: 'Context mismatch' } });
      assert.equal(calls, 1);
    });
  });

  await t.test('malformed JSON, body-read and request failures expose only the generic closed error', async () => {
    for (const stub of [async () => response(`not-json-${secret}`), async () => { throw new Error(`network-${secret}`); },
      async () => ({ ...response({}), text: async () => { throw new Error(`body-${secret}`); } })]) {
      let calls = 0;
      await withFetch(async (...args) => { calls++; return stub(...args); }, async () => {
        await assert.rejects(productionCookieRequest(base, '/api/inicio', { session }), error => {
          assert.equal(error.message, 'Production cookie fixture HTTP/JSON request failed');
          assert.equal(error.cause, undefined); assert.equal(String(error).includes(secret), false); return true;
        });
        assert.equal(calls, 1);
      });
    }
  });

  await t.test('invalid challenge shapes/proofs/cookie multiplicity reject before login dispatch', async () => {
    for (const invalid of [response({ csrf_token: 'short' }), response({ csrf_token: challengeCsrf, token: secret }),
      response({ csrf_token: `${challengeCsrf}\n` }), response([challengeCsrf]),
      response({ csrf_token: challengeCsrf }, { cookies: ['one=a', 'two=b'] })]) {
      let calls = 0;
      await withFetch(async () => { calls++; return invalid; }, async () => {
        await assert.rejects(loginProductionCookieSession(base, 'qa_editor', 'synthetic-password'));
        assert.equal(calls, 1);
      });
    }
  });

  await t.test('invalid login DTO/proofs/user/cookie never produce a usable session', async () => {
    for (const invalid of [
      response({ ...loginBody(), token: secret }), response({ ...loginBody(), csrf_token: context }),
      response({ ...loginBody(), session_context: 'short' }), response({ ...loginBody(), usuario: { id: 0 } }),
      response({ ...loginBody(), usuario: { id: '91003' } }), response({ ...loginBody(), usuario: { id: Number.MAX_SAFE_INTEGER + 1 } }),
      response(loginBody(), { cookies: ['render_dev_session=bad value; Path=/'] }),
      response(loginBody(), { cookies: ['render_dev_session=a.b.c', 'extra=d.e.f'] }),
    ]) {
      let calls = 0;
      await withFetch(async () => ++calls === 1 ? challengeResponse() : invalid, async () => {
        await assert.rejects(loginProductionCookieSession(base, 'qa_editor', 'synthetic-password'));
        assert.equal(calls, 2);
      });
    }
  });

  await t.test('malformed captured session rejects before any operational request', async () => {
    let calls = 0;
    await withFetch(() => { calls++; assert.fail('Invalid session must not dispatch'); }, async () => {
      for (const invalid of [null, {}, { ...session, cookie: null }, { ...session, context: 'short' }, { ...session, csrf: 'short' }]) {
        await assert.rejects(productionCookieRequest(base, '/api/inicio', { session: invalid }));
      }
      assert.equal(calls, 0);
    });
  });
});
