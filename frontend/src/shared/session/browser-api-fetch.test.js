import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserSessionState } from './browser-session-state.js';
import { createBrowserApiFetch } from './browser-api-fetch.js';
const origin = 'https://render.example.test';
const dto = (id = 7, context = 'A') => ({ usuario: { id, usuario: `qa${id}`, nombre: 'QA', rol: 'edicion' }, session_context: context.repeat(43), csrf_token: 'C'.repeat(43) });
const response = (status = 200, body = { ok: true }, proof = 'A'.repeat(43)) => new Response(JSON.stringify(body), { status,
  headers: proof ? { 'X-Render-Session-Context': proof, 'Content-Type': 'application/json' } : {} });
function fixture(fetchImpl = async () => response()) {
  const store = createBrowserSessionState(); const install = value => store.acceptBootstrap(store.beginBootstrap(), value);
  install(dto()); const calls = [];
  const fetch = createBrowserApiFetch({ origin, store, fetchImpl: (...args) => { calls.push(args); return fetchImpl(...args); } });
  return { store, fetch, calls, install, intent: store.captureIntent() };
}
const coded = code => error => error.code === code;
test('writes require a captured current intent; no dispatch-time rebasing or bearer compatibility', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const f = fixture(); await assert.rejects(f.fetch('/api/tareas', { method }), coded('browser_intent_obsolete'));
    await assert.rejects(f.fetch('/api/tareas', { method, sessionIntent: f.intent, headers: { Authorization: 'Bearer stale' } }), coded('browser_bearer_not_allowed'));
    assert.equal(f.calls.length, 0);
    f.install(dto(8, 'B'));
    await assert.rejects(f.fetch('/api/tareas', { method, sessionIntent: f.intent }), coded('browser_intent_obsolete'));
    assert.equal(f.calls.length, 0); assert.equal(f.store.getSession().usuario.id, 8);
  }
});
test('JSON/multipart keep body, signal and content-type; credentials/cache/redirect cannot be weakened', async () => {
  const f = fixture(), controller = new AbortController(), body = new FormData(); body.set('synthetic', 'test');
  const result = await f.fetch('/api/drive/uploads', { method: 'post', sessionIntent: f.intent, body,
    signal: controller.signal, credentials: 'include', redirect: 'follow', cache: 'force-cache' });
  assert.deepEqual(await result.json(), { ok: true });
  const [url, options] = f.calls[0]; assert.equal(url, '/api/drive/uploads'); assert.equal(options.body, body);
  assert.equal(options.signal, controller.signal); assert.equal(options.headers.has('Content-Type'), false);
  assert.equal(options.headers.get('X-Render-Session-Context'), dto().session_context);
  assert.equal(options.headers.get('X-Render-CSRF'), dto().csrf_token);
  assert.equal(options.credentials, 'same-origin'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
  assert.equal('sessionIntent' in options, false);
});
test('stale supplied headers, API Request objects and login/bootstrap paths reject without fetching', async () => {
  const f = fixture();
  await assert.rejects(f.fetch('/api/tareas', { headers: { 'X-Render-CSRF': 'B'.repeat(43) } }), coded('browser_intent_headers_conflict'));
  await assert.rejects(f.fetch(new Request(`${origin}/api/tareas`)), coded('browser_request_object_not_supported'));
  await assert.rejects(f.fetch(new URL(`${origin}/api/tareas`)), coded('browser_request_object_not_supported'));
  for (const url of ['/api/login', '/api/login/browser', '/api/sesion'])
    await assert.rejects(f.fetch(url), coded('browser_session_transport_required'));
  assert.equal(f.calls.length, 0);
});
test('request body streams reject before dispatch; same-origin absolute API strings remain fenced', async () => {
  const f = fixture(), body = new ReadableStream({ start(controller) { controller.close(); } });
  await assert.rejects(f.fetch('/api/drive/uploads', { method: 'POST', sessionIntent: f.intent, body }), coded('browser_request_stream_not_supported'));
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await (await f.fetch(`${origin}/api/inicio`)).json(), { ok: true });
  assert.equal(f.calls[0][0], '/api/inicio');
});
test('different cookie context on a GET is rejected without exposing body or adopting another user', async () => {
  const f = fixture(async () => response(200, { private: 'B' }, 'B'.repeat(43)));
  await assert.rejects(f.fetch('/api/inicio'), coded('browser_response_context_changed'));
  assert.equal(f.store.getSession(), null); assert.equal(f.calls.length, 1);
});
test('late headers/401 cannot erase or redirect a replacement session', async () => {
  for (const status of [200, 401]) {
    let finish; const f = fixture(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.fetch('/api/inicio'); f.install(dto(8, 'B')); finish(response(status));
    await assert.rejects(pending, coded('browser_intent_obsolete')); assert.equal(f.store.getSession().usuario.id, 8);
  }
});
test('body readers and clones reject results after a session change; raw streams cannot bypass the fence', async () => {
  const f = fixture(); const result = await f.fetch('/api/inicio'), clone = result.clone();
  assert.throws(() => result.body, coded('browser_stream_not_supported'));
  f.install(dto(8, 'B'));
  for (const reader of ['json', 'text', 'blob', 'arrayBuffer', 'formData'])
    await assert.rejects(result[reader](), coded('browser_intent_obsolete'));
  await assert.rejects(clone.json(), coded('browser_intent_obsolete'));
});
test('body finishing after a replacement cannot resolve stale JSON into the new session', async () => {
  let controller;
  const stream = new ReadableStream({ start(value) { controller = value; } });
  const f = fixture(async () => new Response(stream, { headers: { 'X-Render-Session-Context': dto().session_context } }));
  const result = await f.fetch('/api/inicio'), reading = result.json();
  f.install(dto(8, 'B')); controller.enqueue(new TextEncoder().encode('{"old":true}')); controller.close();
  await assert.rejects(reading, coded('browser_intent_obsolete')); assert.equal(f.store.getSession().usuario.id, 8);
});
test('unverified outage preserves current observation; context409 and ordinary401 invalidate only captured session', async () => {
  const outage = fixture(async () => response(503, {}, null));
  await assert.rejects(outage.fetch('/api/inicio'), coded('browser_response_unverified')); assert.ok(outage.store.getSession());
  const changed = fixture(async () => response(409, { code: 'browser_session_changed' }, null));
  await assert.rejects(changed.fetch('/api/tareas', { method: 'PATCH', sessionIntent: changed.intent }), coded('browser_response_unverified'));
  assert.equal(changed.store.getSession(), null);
  const unauthorized = fixture(async () => response(401, {}, null));
  await assert.rejects(unauthorized.fetch('/api/inicio'), coded('browser_session_unauthorized')); assert.equal(unauthorized.store.getSession(), null);
});
test('wrong password remains a form error only with matching response proof and explicit classified route', async () => {
  for (const path of ['/api/usuarios/perfil', '/api/usuarios/password']) {
    const f = fixture(async () => response(401, { code: 'current_password_invalid' }));
    const result = await f.fetch(path, { method: 'PATCH', sessionIntent: f.intent });
    assert.equal((await result.json()).code, 'current_password_invalid'); assert.ok(f.store.getSession());
  }
  const f = fixture(async () => response(401, { code: 'current_password_invalid' }));
  await assert.rejects(f.fetch('/api/inicio'), coded('browser_session_unauthorized'));
});
test('non-API/external traffic is delegated unchanged without deriving private headers', async () => {
  const f = fixture();
  for (const url of ['/assets/image.png', 'https://other.example.test/api/inicio']) {
    const options = {}; await f.fetch(url, options);
    assert.equal(f.calls.at(-1)[0], url); assert.equal(f.calls.at(-1)[1], options);
  }
});
test('late network/body failure is fenced too, without reporting obsolete details or clearing a replacement', async () => {
  let reject;
  const network = fixture(() => new Promise((_resolve, no) => { reject = no; }));
  const pending = network.fetch('/api/inicio'); network.install(dto(8, 'B')); reject(Error('obsolete network details'));
  await assert.rejects(pending, coded('browser_intent_obsolete'));
  assert.equal(network.store.getSession().usuario.id, 8);
  let streamController;
  const stream = new ReadableStream({ start(value) { streamController = value; } });
  const body = fixture(async () => new Response(stream, { headers: { 'X-Render-Session-Context': dto().session_context } }));
  const result = await body.fetch('/api/inicio'), reading = result.json();
  body.install(dto(8, 'B')); streamController.error(Error('obsolete body details'));
  await assert.rejects(reading, coded('browser_intent_obsolete'));
  assert.equal(body.store.getSession().usuario.id, 8);
});
