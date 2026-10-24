import test from 'node:test';
import assert from 'node:assert/strict';
import { createExplicitLogoutNavigation } from './explicitLogoutNavigation.js';
import { createBrowserSessionState } from '../session/browser-session-state.js';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture() {
  const store = createBrowserSessionState();
  let subscribers = 0;
  const model = createExplicitLogoutNavigation({ readSnapshot: store.getSnapshot,
    subscribe(fn) { subscribers++; const off = store.subscribe(fn); return () => { subscribers--; off(); }; } });
  function login(id = 7) {
    store.acceptBootstrap(store.beginBootstrap(), { usuario: { id, usuario: 'qa', nombre: 'QA', rol: 'diseno' },
      session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) });
    return store.getSnapshot();
  }
  return { store, model, login, original: login(), get subscribers() { return subscribers; } };
}

for (const result of [{ revoked: true }, { revoked: false, reason: 'unconfirmed' }]) {
  test(`explicit withdrawal is neutral BEFORE logout settles; result stays honest revoked=${result.revoked}`, async () => {
    const f = fixture(), wait = deferred();
    const pending = f.model.run(f.original, () => { f.store.withdrawObservation(); return wait.promise; });
    const anonymous = f.store.getSnapshot();
    assert.equal(f.model.destination(anonymous), '/login');
    assert.equal(f.subscribers, 1);
    wait.resolve(result); assert.equal(await pending, result);
    assert.equal(f.subscribers, 0); assert.equal(f.model.destination(anonymous), '/login');
  });
}

test('expiry/401 or direct anonymous access without explicit intent never selects neutral logout', () => {
  const f = fixture();
  assert.equal(f.model.destination(f.original), null);
  f.store.invalidate(f.store.captureIntent());
  assert.equal(f.model.destination(f.store.getSnapshot()), null);
  const fresh = fixture(); fresh.store.withdrawObservation();
  assert.equal(fresh.model.destination(fresh.store.getSnapshot()), null);
});

test('late A completion cannot navigate B or claim a later anonymous withdrawal of B', async () => {
  const f = fixture(), wait = deferred();
  const pending = f.model.run(f.original, () => wait.promise);
  const b = f.login(8); assert.equal(f.subscribers, 0);
  f.store.withdrawObservation(); const anonymousB = f.store.getSnapshot();
  wait.resolve({ revoked: true }); await pending;
  assert.equal(f.model.destination(b), null); assert.equal(f.model.destination(anonymousB), null);
});

test('logout A then fresh A then expiry cannot reuse the old marker, even with identical cookie fields', async () => {
  const f = fixture();
  await f.model.run(f.original, () => { f.store.withdrawObservation(); return { revoked: true }; });
  const oldAnonymous = f.store.getSnapshot(); assert.equal(f.model.destination(oldAnonymous), '/login');
  const newA = f.login(); assert.notEqual(newA.session, f.original.session);
  f.store.withdrawObservation();
  assert.equal(f.model.destination(f.store.getSnapshot()), null);
  assert.equal(f.model.destination(oldAnonymous), null);
});

test('one pending operation blocks double click without invoking logout twice', async () => {
  const f = fixture(), wait = deferred(); let calls = 0;
  const work = () => { calls++; return wait.promise; };
  const first = f.model.run(f.original, work);
  assert.equal(await f.model.run(f.original, work), false); assert.equal(calls, 1);
  wait.resolve({ revoked: false, reason: 'unverified_session' }); await first;
  assert.equal(f.subscribers, 0); assert.equal(f.model.destination(f.original), null);
  assert.equal(await f.model.run(f.original, () => { calls++; return { revoked: false }; }).then(x => x.revoked), false);
  assert.equal(calls, 2);
});

for (const kind of ['throw', 'reject', 'active']) {
  test(`${kind} without withdrawal clears marker and subscription, preserving future expiry routing`, async () => {
    const f = fixture();
    const value = await f.model.run(f.original, () => {
      if (kind === 'throw') throw new Error('Offline');
      if (kind === 'reject') return Promise.reject(new Error('Offline'));
      return { revoked: false, reason: 'unverified_session' };
    });
    assert.equal(kind === 'active' ? value.revoked : value, false);
    assert.equal(f.subscribers, 0); f.store.withdrawObservation();
    assert.equal(f.model.destination(f.store.getSnapshot()), null);
  });
}

test('stale caller, reader failure and failed subscription never dispatch logout', async () => {
  const f = fixture(); f.login(8);
  const work = () => assert.fail('Must not dispatch');
  assert.equal(await f.model.run(f.original, work), false);
  for (const config of [
    { readSnapshot() { throw new Error('Unavailable'); }, subscribe: f.store.subscribe },
    { readSnapshot: f.store.getSnapshot, subscribe() { throw new Error('Unavailable'); } },
  ]) {
    const model = createExplicitLogoutNavigation(config);
    assert.equal(await model.run(f.store.getSnapshot(), work), false);
    assert.equal(model.destination(f.store.getSnapshot()), null);
  }
});

test('intermediate loading/error invalidates marker rather than treating later anonymous as the logout withdrawal', async () => {
  const f = fixture(), wait = deferred();
  const pending = f.model.run(f.original, () => wait.promise);
  const ticket = f.store.beginBootstrap(); f.store.failBootstrap(ticket); f.store.withdrawObservation();
  wait.resolve({ revoked: false, reason: 'unconfirmed' }); await pending;
  assert.equal(f.model.destination(f.store.getSnapshot()), null); assert.equal(f.subscribers, 0);
});

test('component cleanup releases observer and permanently fences its pending completion, but permits a fresh attempt', async () => {
  const f = fixture(), wait = deferred();
  const pending = f.model.run(f.original, () => wait.promise);
  f.model.clear(); assert.equal(f.subscribers, 0);
  f.store.withdrawObservation(); wait.resolve({ revoked: true }); await pending;
  assert.equal(f.model.destination(f.store.getSnapshot()), null);
  const fresh = f.login();
  await f.model.run(fresh, () => { f.store.withdrawObservation(); return { revoked: true }; });
  assert.equal(f.model.destination(f.store.getSnapshot()), '/login');
});

test('React subscriber can read destination before the logout observer sees the same synchronous publication', async () => {
  const f = fixture(), observed = [];
  const unsubscribe = f.store.subscribe(() => observed.push(f.model.destination(f.store.getSnapshot())));
  // React's subscription was registered before run installs its own observer.
  await f.model.run(f.original, () => { f.store.withdrawObservation(); return { revoked: true }; });
  assert.deepEqual(observed, ['/login']); unsubscribe();
});

test('resolved work without withdrawal cannot classify a later expiry as explicit logout', async () => {
  const f = fixture();
  await f.model.run(f.original, () => ({ revoked: true }));
  assert.equal(f.subscribers, 0); f.store.withdrawObservation();
  assert.equal(f.model.destination(f.store.getSnapshot()), null);
});

test('cleanup during publication fences an already queued observer and a later promise completion', async () => {
  const store = createBrowserSessionState();
  store.acceptBootstrap(store.beginBootstrap(), { usuario: { id: 7, usuario: 'qa', nombre: 'QA', rol: 'diseno' },
    session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) });
  let queued;
  const model = createExplicitLogoutNavigation({ readSnapshot: store.getSnapshot,
    subscribe(listener) { queued = listener; return store.subscribe(listener); } });
  const cleanupSubscriber = store.subscribe(() => model.clear());
  const wait = deferred(), pending = model.run(store.getSnapshot(), () => wait.promise);
  store.withdrawObservation(); queued();
  wait.resolve({ revoked: true }); await pending;
  assert.equal(model.destination(store.getSnapshot()), null); cleanupSubscriber();
});
