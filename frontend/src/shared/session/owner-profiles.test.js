import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOwnerProfiles, ownerProfileCapability, activeOwnerProfileLabel } from './owner-profiles.js';
import { parseBrowserSession, createBrowserSessionState } from './browser-session-state.js';
import { createBrowserSessionController } from './browser-session-controller.js';
import { createBrowserApiFetch } from './browser-api-fetch.js';
import { captureSessionBinding, sessionBindingMatches } from './session-binding.js';
import { createOwnerProfileActions } from './owner-profile-actions.js';
import { createApplicationSession } from './application-session.js';

const profiles = [{ key: 'franco', user_id: 91005, name: 'Franco QA' }, { key: 'agustin', user_id: 91006, name: 'Agustín QA' }];
const dto = (active = null, context = 'A') => ({ usuario: { id: active === null ? 91001 : profiles.find(p => p.key === active).user_id,
  usuario: 'synthetic-actor', nombre: 'No inferir nombre', rol: 'admin' },
  session_context: context.repeat(43), csrf_token: (context === 'A' ? 'C' : 'D').repeat(43),
  owner_profiles: { principal_id: 91001, active, profiles: structuredClone(profiles) } });
const response = (value, status = 200, proof = value?.session_context) => new Response(JSON.stringify(value), {
  status, headers: proof ? { 'X-Render-Session-Context': proof } : {},
});
const install = (store, value = dto()) => store.acceptBootstrap(store.beginBootstrap(), value);
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function locks() {
  let tail = Promise.resolve();
  return { request(name, options, work) {
    assert.equal(name, 'render:browser-session:v1'); assert.deepEqual(options, { mode: 'exclusive' });
    const next = tail.then(work); tail = next.catch(() => {}); return next;
  } };
}
function fixture(fetch, sharedLocks = locks()) {
  const store = createBrowserSessionState(), calls = [], hints = [];
  const controller = createBrowserSessionController({ origin: 'https://render.test', store, locks: sharedLocks,
    notifyChange: hint => hints.push(hint), fetchImpl: async (url, options) => {
      calls.push({ url, options });
      assert.equal(options.credentials, 'same-origin'); assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error');
      return fetch ? fetch(url, options) : response(dto('franco', 'B'));
    } });
  install(store); return { store, controller, calls, hints };
}

test('closed optional capability validates principal/actor separation, exact mappings and immutable labels', () => {
  const root = parseBrowserSession(dto());
  assert.equal(root.usuario.id, 91001); assert.equal(root.owner_profiles.active, null);
  assert.equal(activeOwnerProfileLabel(root), 'Cuenta Render · perfil principal');
  const franco = parseBrowserSession(dto('franco', 'B'));
  assert.equal(franco.usuario.id, 91005); assert.equal(franco.owner_profiles.principal_id, 91001);
  assert.equal(activeOwnerProfileLabel(franco), 'Cuenta Render · perfil activo: Franco QA');
  assert.ok(Object.isFrozen(franco.owner_profiles.profiles[0]));
  const regular = dto(); delete regular.owner_profiles;
  assert.equal(ownerProfileCapability(parseBrowserSession(regular)), null);
  assert.equal(ownerProfileCapability({ token: 'not-authority', ...dto() }), null);
  for (const change of [v => { v.owner_profiles = null; }, v => { v.owner_profiles.active = 'admin'; },
    v => { v.owner_profiles.principal_id = 91005; }, v => { v.owner_profiles.profiles[1].user_id = 91005; },
    v => { v.owner_profiles.profiles[1].key = 'franco'; }, v => { v.owner_profiles.profiles[0].name = '\u0000'; },
    v => { v.owner_profiles.extra = 'authority'; }, v => { v.usuario.id = 91005; },
    v => { v.owner_profiles.profiles[0].usuario = 'inferred'; }]) {
    const value = dto(); change(value); assert.throws(() => parseBrowserSession(value));
  }
  assert.throws(() => parseOwnerProfiles(dto().owner_profiles, 91006));
});

test('real controller switches via cookie transport + confirming GET, no logout or local substitution; old binding invalidates', async () => {
  const f = fixture(), original = f.store.getSession(), intent = f.store.captureIntent(), binding = captureSessionBinding(original);
  const pending = f.controller.changeProfile({ profile: 'franco', sessionIntent: intent });
  assert.equal(f.store.getSession(), original, 'queued transition retains original until lock');
  const result = await pending;
  assert.equal(result.ok, true); assert.equal(result.session.usuario.id, 91005); assert.equal(f.store.getSession(), result.session);
  assert.equal(result.session.owner_profiles.principal_id, 91001); assert.equal(sessionBindingMatches(binding, result.session), false);
  assert.equal(f.store.isCurrent(intent), false);
  assert.deepEqual(f.calls.map(c => c.url), ['/api/sesion/perfil-dueno', '/api/sesion']);
  assert.deepEqual(JSON.parse(f.calls[0].options.body), { profile: 'franco' });
  assert.equal(f.calls[0].options.headers['X-Render-CSRF'], original.csrf_token);
  assert.equal(f.calls[0].options.headers['X-Render-Session-Context'], original.session_context);
  assert.equal(f.calls[0].options.signal, undefined, 'unresolved cookie mutation must retain origin lock, not abort early');
  assert.deepEqual(f.hints, [{ reason: 'profile' }]);
  assert.equal((await f.controller.changeProfile({ profile: 'franco', sessionIntent: f.store.captureIntent() })).session, result.session);
  assert.equal(f.calls.length, 2, 'active choice is a verified no-op');
});

test('copied intent, missing capability and arbitrary IDs/profile input are rejected before HTTP or withdrawal', () => {
  const f = fixture(), intent = f.store.captureIntent(), original = f.store.getSession();
  for (const profile of [91005, 'admin', 'leader', null, { id: 91005 }]) assert.throws(() => f.controller.changeProfile({ profile, sessionIntent: intent }));
  assert.throws(() => f.controller.changeProfile({ profile: 'franco', sessionIntent: { ...intent } }));
  assert.equal(f.store.getSession(), original); assert.equal(f.calls.length, 0);
  const regular = dto(); delete regular.owner_profiles; install(f.store, regular);
  assert.throws(() => f.controller.changeProfile({ profile: 'franco', sessionIntent: f.store.captureIntent() }));
});

test('rejected/malformed/ambiguous transitions fail closed without restoring stale principal or publishing unconfirmed actor', async t => {
  for (const variant of ['http', 'network', 'proof', 'csrf', 'context', 'actor', 'principal', 'active', 'get-mismatch', 'get-metadata', 'get-401']) await t.test(variant, async () => {
    const f = fixture(async url => {
      if (variant === 'network') throw Error('PRIVATE_PROVIDER_SENTINEL');
      if (variant === 'http') return response({}, 403);
      let value = dto('franco', 'B');
      if (variant === 'csrf') value.csrf_token = dto().csrf_token;
      if (variant === 'context') value.session_context = dto().session_context;
      if (variant === 'actor') value.usuario.id = 91006;
      if (variant === 'principal') value.owner_profiles.principal_id = 999;
      if (variant === 'active') value = dto('agustin', 'B');
      if (url === '/api/sesion') {
        if (variant === 'get-401') return response({}, 401);
        if (variant === 'get-mismatch') value = dto('agustin', 'E');
        if (variant === 'get-metadata') value.owner_profiles.profiles[0].name = 'Changed metadata';
      }
      return response(value, 200, variant === 'proof' ? null : value.session_context);
    });
    await assert.rejects(f.controller.changeProfile({ profile: 'franco', sessionIntent: f.store.captureIntent() }), error => !error.message.includes('PRIVATE'));
    assert.equal(f.store.getSession(), null); assert.equal(f.store.getSnapshot().status, 'error');
    assert.deepEqual(f.hints, [{ reason: 'profile' }]);
  });
});

test('double click rejects second mutation; late switch response cannot replace new observation B', async () => {
  const held = deferred(), reached = deferred();
  const f = fixture(async () => { reached.resolve(); await held.promise; return response(dto('franco', 'B')); });
  const intent = f.store.captureIntent(), pending = f.controller.changeProfile({ profile: 'franco', sessionIntent: intent });
  assert.throws(() => f.controller.changeProfile({ profile: 'agustin', sessionIntent: intent }));
  await reached.promise; install(f.store, dto('agustin', 'E')); const b = f.store.getSession();
  held.resolve(); assert.equal((await pending).ok, false); assert.equal(f.store.getSession(), b);
});

test('queued obsolete transition performs no request and preserves newer B', async () => {
  const shared = locks(), held = deferred();
  const blocking = shared.request('render:browser-session:v1', { mode: 'exclusive' }, () => held.promise);
  const f = fixture(null, shared), pending = f.controller.changeProfile({ profile: 'franco', sessionIntent: f.store.captureIntent() });
  install(f.store, dto('agustin', 'E')); const b = f.store.getSession(); held.resolve(); await blocking;
  assert.equal((await pending).reason, 'obsolete'); assert.equal(f.store.getSession(), b); assert.equal(f.calls.length, 0);
});

test('external invalidation while cookie setter unresolved retains lock and publishes no receipt', async () => {
  const shared = locks(), held = deferred(), reached = deferred(), events = [];
  const f = fixture(async () => { reached.resolve(); await held.promise; return response(dto('franco', 'B')); }, shared);
  const pending = f.controller.changeProfile({ profile: 'franco', sessionIntent: f.store.captureIntent() });
  await reached.promise; f.controller.invalidateExternal();
  const next = shared.request('render:browser-session:v1', { mode: 'exclusive' }, () => events.push('next'));
  await Promise.resolve(); assert.deepEqual(events, []); held.resolve();
  assert.equal((await pending).ok, false); await next; assert.deepEqual(events, ['next']); assert.equal(f.store.getSession(), null);
});

test('inflight old-account API response is fenced after profile rotation, including body reads', async () => {
  const f = fixture(), held = deferred(), original = f.store.getSession();
  const api = createBrowserApiFetch({ origin: 'https://render.test', store: f.store, fetchImpl: () => held.promise });
  const pending = api('/api/inicio');
  await f.controller.changeProfile({ profile: 'franco', sessionIntent: f.store.captureIntent() });
  held.resolve(response({ private: 'old-account-data' }, 200, original.session_context));
  await assert.rejects(pending); assert.equal(f.store.getSession().usuario.id, 91005);
});

test('component actions delegate exact captured intent once; no browser storage or logout fallback', async () => {
  const store = createBrowserSessionState(); install(store);
  const held = deferred(), states = [], calls = []; let snapshot = store.getSnapshot();
  const runtime = { mode: 'browser', getSession: store.getSession, async changeProfile(options) {
    calls.push(options); await held.promise; install(store, dto('franco', 'B')); return { ok: true, session: store.getSession() };
  } };
  const actions = createOwnerProfileActions({ getRuntime: () => runtime, readSnapshot: () => snapshot, onState: state => states.push(state) });
  const pending = actions.change('franco', snapshot); assert.equal(await actions.change('agustin', snapshot), false);
  assert.equal(calls.length, 1); assert.equal(calls[0].sessionIntent.session, snapshot.session);
  held.resolve(); assert.equal(await pending, true); assert.equal(store.getSession().usuario.id, 91005);
  snapshot = store.getSnapshot(); actions.dispose(); assert.equal(await actions.change('agustin', snapshot), false);
});

test('actual application runtime exposes browser changeProfile, refuses bearer mode and never touches storage', async () => {
  let value = dto(); const urls = [];
  const runtime = createApplicationSession({ mode: 'browser', location: { origin: 'https://render.test' }, locks: locks(),
    storage: { getItem() { assert.fail('storage read'); }, setItem() { assert.fail('storage write'); } },
    fetchImpl: async url => { urls.push(url); if (url === '/api/sesion/perfil-dueno') value = dto('franco', 'B'); return response(value); } });
  await runtime.start(); const session = runtime.getSession();
  // Actions are the public bridge; obtain the genuine intent without exposing a
  // mutable actor DTO or introducing a token into cookie sessions.
  const actions = createOwnerProfileActions({ getRuntime: () => runtime, readSnapshot: runtime.getSnapshot });
  assert.equal(await actions.change('franco', runtime.getSnapshot()), true);
  assert.notEqual(runtime.getSession(), session); assert.equal(runtime.getSession().usuario.id, 91005);
  assert.deepEqual(urls, ['/api/sesion', '/api/sesion/perfil-dueno', '/api/sesion']); runtime.dispose();
  const bearer = createApplicationSession({ mode: 'bearer', fetchImpl() {}, storage: { getItem: () => null } });
  assert.throws(() => bearer.changeProfile({ profile: 'franco' })); bearer.dispose();
});
