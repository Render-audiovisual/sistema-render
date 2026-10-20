import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserSessionState, captureBrowserSessionIntent, isBrowserSessionIntentCurrent } from './browser-session-state.js';
import { captureSessionBinding, sessionBindingMatches, sessionRequestOptions } from './session-binding.js';
import { createMoodboardInitialization } from './moodboard-initialization.js';
import { createEditorialSessionGuard } from '../../components/EditorialPublicationControl.model.js';
const dto = (id = 7, context = 'A') => ({ usuario: { id, usuario: `qa${id}`, nombre: 'QA', rol: 'diseno' }, session_context: context.repeat(43), csrf_token: 'C'.repeat(43) });
function fixture() {
  const store = createBrowserSessionState();
  const install = value => store.acceptBootstrap(store.beginBootstrap(), value);
  install(dto()); return { store, install, session: store.getSession() };
}
test('cookie bindings require an actual current store observation, never copied DTO or a fake token', () => {
  const f = fixture(), binding = captureSessionBinding(f.session);
  assert.ok(binding); assert.equal(binding.mode, 'cookie'); assert.equal('token' in binding, false);
  assert.ok(Object.isFrozen(binding)); assert.ok(sessionBindingMatches(binding, f.session));
  assert.equal(captureBrowserSessionIntent(null), null); assert.equal(captureBrowserSessionIntent(undefined), null);
  for (const forged of [dto(), { ...f.session }, { ...f.session, token: 'cookie' }, { ...f.session, token: undefined }])
    assert.equal(captureSessionBinding(forged), null);
  assert.equal(sessionBindingMatches({ ...binding }, f.session), false);
  f.install(dto(8, 'B')); assert.equal(captureSessionBinding(f.session), null);
  assert.equal(sessionBindingMatches(binding, f.store.getSession()), false);
  assert.equal(isBrowserSessionIntentCurrent(binding.intent), false);
});
test('same-context new observation and another store never rebase the original binding', () => {
  const f = fixture(), old = captureSessionBinding(f.session);
  const other = fixture(); assert.equal(sessionBindingMatches(old, other.session), false);
  f.install(dto()); assert.equal(sessionBindingMatches(old, f.store.getSession()), false);
  assert.throws(() => sessionRequestOptions(old), error => error.code === 'session_binding_obsolete');
});
test('cookie options carry the exact captured intent and preserve multipart/binary/custom request fields', () => {
  const f = fixture(), binding = captureSessionBinding(f.session), body = new Uint8Array([1, 2]);
  const controller = new AbortController();
  const options = sessionRequestOptions(binding, { method: 'PUT', body, signal: controller.signal,
    headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-1/2' } });
  assert.equal(options.body, body); assert.equal(options.signal, controller.signal); assert.equal(options.sessionIntent, binding.intent);
  assert.equal(options.headers.Authorization, undefined);
  assert.equal(options.headers['X-Render-Session-Context'], f.session.session_context);
  assert.equal(options.headers['X-Render-CSRF'], f.session.csrf_token);
  assert.equal(options.headers['Content-Type'], 'video/mp4'); assert.equal(options.headers['content-range'], 'bytes 0-1/2');
  for (const extra of [{ headers: { Authorization: 'Bearer obsolete' } }, { headers: { 'X-Render-CSRF': 'other' } },
    { sessionIntent: { ...binding.intent } }]) assert.throws(() => sessionRequestOptions(binding, extra));
});
test('legacy bearer remains exact and cannot fall through into cookie mode', () => {
  const session = { usuario: { id: 7, rol: 'diseno' }, token: 'legacy-real-synthetic' };
  const binding = captureSessionBinding(session); assert.equal(binding.mode, 'bearer'); assert.ok(sessionBindingMatches(binding, session));
  assert.equal(sessionRequestOptions(binding).headers.Authorization, 'Bearer legacy-real-synthetic');
  for (const live of [{ ...session, token: 'B' }, { ...session, usuario: { ...session.usuario, id: 8 } },
    { ...session, usuario: { ...session.usuario, rol: 'admin' } }, { ...session, usuario: { ...session.usuario, activo: false } },
    { ...session, session_context: 'bad' }]) assert.equal(sessionBindingMatches(binding, live), false);
  assert.throws(() => sessionRequestOptions(binding, { headers: { Authorization: 'Bearer B' } }));
  assert.throws(() => sessionRequestOptions(binding, { sessionIntent: {} }));
});
test('nested guards preserve the original genuine intent only within the exact same observation', () => {
  const f = fixture(), outer = captureSessionBinding(f.session), inner = captureSessionBinding(f.session);
  assert.notEqual(outer.intent, inner.intent);
  const nested = sessionRequestOptions(inner, sessionRequestOptions(outer, { method: 'PATCH' }));
  assert.equal(nested.sessionIntent, outer.intent);
  const other = fixture(), foreign = captureSessionBinding(other.session);
  assert.throws(() => sessionRequestOptions(inner, sessionRequestOptions(foreign)));
});
test('existing editorial session guard sends genuine cookie intent and fences late results after replacement', async () => {
  const f = fixture(); const guard = createEditorialSessionGuard(f.session, f.store.getSession);
  let finish, options;
  const pending = guard.request((_url, value) => { options = value; return new Promise(resolve => { finish = resolve; }); }, '/api/editorial-publicacion/historia/1/confirmar', { method: 'POST' });
  assert.ok(options.sessionIntent); assert.equal(options.headers.Authorization, undefined);
  assert.equal(options.headers['X-Render-Session-Context'], f.session.session_context);
  f.install(dto(8, 'B')); finish({ private: 'A' });
  assert.equal(await pending, undefined); assert.equal(guard.isCurrent(), false);
});
test('existing moodboard initializer uses one original cookie binding and never reloads under B', async () => {
  const f = fixture(); let finish; const calls = [];
  const operation = createMoodboardInitialization({ session: f.session, readSession: f.store.getSession, isMounted: () => true,
    fetchImpl: (url, options) => { calls.push({ url, options }); return new Promise(resolve => { finish = resolve; }); } });
  const pending = operation.run(); assert.ok(calls[0].options.sessionIntent); assert.equal(calls[0].options.headers.Authorization, undefined);
  f.install(dto(8, 'B')); finish({ ok: true, json: async () => ({ ok: true }) });
  assert.equal(await pending, null); assert.equal(calls.length, 1);
});
