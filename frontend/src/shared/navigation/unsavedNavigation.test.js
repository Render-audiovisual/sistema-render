import test from 'node:test';
import assert from 'node:assert/strict';
import { registerNavigationGuard, installUnsavedNavigation } from './unsaved.js';
import { navigateWithinApp, readRouteKey } from './location.js';

const message = 'Hay cambios sin guardar. ¿Querés descartarlos?';
class MockEvent {
  constructor(type, { cancelable = false } = {}) { this.type = type; this.cancelable = cancelable; this.defaultPrevented = false; this.preventCalls = 0; }
  preventDefault() { this.preventCalls++; if (this.cancelable) this.defaultPrevented = true; }
}
class MockCustomEvent extends MockEvent {
  constructor(type, options = {}) { super(type, options); this.detail = options.detail; }
}
class MockPopStateEvent extends MockEvent {
  constructor(type, options = {}) { super(type, options); this.state = options.state; }
}
class MockTarget {
  listeners = new Map();
  dispatched = [];
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  dispatchEvent(event) {
    event.target = this; this.dispatched.push(event);
    for (const fn of [...(this.listeners.get(event.type) ?? [])]) fn.call(this, event);
    return !event.defaultPrevented;
  }
  count(type) { return this.listeners.get(type)?.size ?? 0; }
}
function mockWindow({ navigation = true, href = 'https://render.test/workspace/tareas?task=17#contenido' } = {}) {
  const win = new MockTarget(); win.location = new URL(href); win.CustomEvent = MockCustomEvent; win.PopStateEvent = MockPopStateEvent;
  win.confirmCalls = []; win.accept = false; win.effects = []; win.storageAccess = [];
  win.confirm = text => { win.confirmCalls.push(text); return win.accept; };
  const initialState = Object.freeze({ owner: 'router', nested: Object.freeze({ draftContext: 17 }), arbitrary: ['keep'] });
  win.history = { state: initialState, length: 3, scrollRestoration: 'manual',
    pushState(state, title, href) { win.effects.push({ action: 'pushState', state, title, href }); this.state = state; this.length++; win.location = new URL(href, win.location.href); },
    replaceState(state, title, href) { win.effects.push({ action: 'replaceState', state, title, href }); this.state = state; win.location = new URL(href, win.location.href); },
    go(delta) { win.effects.push({ action: 'go', delta }); }, back() { win.effects.push({ action: 'back' }); }, forward() { win.effects.push({ action: 'forward' }); },
  };
  win.scrollTo = options => win.effects.push({ action: 'scroll', options });
  if (navigation) {
    win.navigation = new MockTarget();
    for (const method of ['navigate', 'back', 'forward', 'traverseTo', 'reload', 'updateCurrentEntry'])
      win.navigation[method] = (...args) => win.effects.push({ action: `navigation.${method}`, args });
  }
  for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(win, name, { get() {
    win.storageAccess.push(name); throw new Error('Business persistence must not be accessed');
  } });
  return win;
}
function traverse(win, { url = 'https://render.test/inicio?desde=tarea#hoy', sameDocument = true, cancelable = true,
  navigationType = 'traverse', canIntercept = true } = {}) {
  const event = new MockEvent('navigate', { cancelable });
  event.navigationType = navigationType; event.destination = { url, sameDocument }; event.canIntercept = canIntercept;
  event.intercept = () => win.effects.push({ action: 'event.intercept' });
  event.scroll = () => win.effects.push({ action: 'event.scroll' });
  win.navigation.dispatchEvent(event); return event;
}
function beforeLink(win, href = '/proyectos?proyecto=uno#hitos', cancelable = true) {
  const event = new MockCustomEvent('render:before-navigation', { detail: { href }, cancelable });
  win.dispatchEvent(event); return event;
}
function unload(win) {
  const event = new MockEvent('beforeunload', { cancelable: true }); let value = '';
  event.returnValueWrites = [];
  Object.defineProperty(event, 'returnValue', { get: () => value, set: next => { value = String(next); event.returnValueWrites.push(value); } });
  win.dispatchEvent(event); return event;
}
const unchanged = (win, location, state, length = 3) => {
  assert.equal(win.location.href, location); assert.equal(win.history.state, state); assert.equal(win.history.length, length);
  assert.equal(win.history.scrollRestoration, 'manual'); assert.deepEqual(win.effects, []); assert.deepEqual(win.storageAccess, []);
};

test('explicit same-location refresh exposes destructive intent without changing history or bypassing dirty/busy', () => {
  const win = mockWindow(), installed = installUnsavedNavigation(win), seen = [];
  const location = win.location.href, state = win.history.state;
  let busy = false;
  const unsubscribe = registerNavigationGuard(win, navigation => {
    seen.push(navigation);
    return navigation.type === 'refresh' ? { dirty: true, busy } : { dirty: false, busy: false };
  });
  const refresh = () => {
    const event = new MockCustomEvent('render:before-navigation', { detail: { href: location, type: 'refresh' }, cancelable: true });
    win.dispatchEvent(event); return event;
  };
  try {
    assert.equal(beforeLink(win, location).defaultPrevented, false);
    assert.deepEqual(win.confirmCalls, []);
    assert.equal(refresh().defaultPrevented, true);
    assert.equal(seen.at(-1).type, 'refresh');
    assert.equal(seen.at(-1).from, seen.at(-1).to);
    win.accept = true; assert.equal(refresh().defaultPrevented, false);
    const prompts = win.confirmCalls.length;
    busy = true; assert.equal(refresh().defaultPrevented, true);
    assert.equal(win.confirmCalls.length, prompts, 'Pending writes cannot be discarded by accepting a prompt');
    unchanged(win, location, state);
  } finally { unsubscribe(); installed.dispose(); }
});

test('one consolidated dirty confirmation across all guards cancels traversal before route/popstate commit', () => {
  const win = mockWindow(), installed = installUnsavedNavigation(win), seen = [];
  const location = win.location.href, state = win.history.state;
  const unsubscribers = [false, true, true].map(dirty => registerNavigationGuard(win, context => { seen.push(context); return { dirty, busy: false }; }));
  try {
    const event = traverse(win); assert.equal(event.defaultPrevented, true); assert.ok(event.preventCalls > 0);
    assert.deepEqual(win.confirmCalls, [message]); assert.equal(seen.length, 3);
    for (const context of seen) assert.deepEqual(context, { from: '/workspace/tareas?task=17#contenido', to: '/inicio?desde=tarea#hoy', type: 'traverse' });
    assert.equal(win.dispatched.filter(event => event.type === 'popstate').length, 0); unchanged(win, location, state);
  } finally { unsubscribers.forEach(unsubscribe => unsubscribe()); installed.dispose(); }
});

test('accepted native traversal is not intercepted, replayed, saved, cleared or synthetically dispatched', () => {
  const win = mockWindow(); win.accept = true;
  const draft = { notes: 'Pending correction text' }, installed = installUnsavedNavigation(win);
  const unsubscribe = registerNavigationGuard(win, () => ({ dirty: Boolean(draft.notes), busy: false }));
  const location = win.location.href, state = win.history.state;
  try {
    const event = traverse(win); assert.equal(event.defaultPrevented, false); assert.equal(event.preventCalls, 0);
    assert.deepEqual(win.confirmCalls, [message]); assert.equal(draft.notes, 'Pending correction text');
    assert.equal(win.dispatched.length, 0); assert.equal(win.navigation.dispatched.length, 1); unchanged(win, location, state);
  } finally { unsubscribe(); installed.dispose(); }
});

test('any busy guard denies without discard confirmation even when other guards are dirty', () => {
  const win = mockWindow(), installed = installUnsavedNavigation(win); win.accept = true;
  const unsubscribers = [registerNavigationGuard(win, () => ({ dirty: true, busy: false })), registerNavigationGuard(win, () => ({ dirty: false, busy: true }))];
  try {
    assert.equal(traverse(win).defaultPrevented, true); assert.equal(beforeLink(win).defaultPrevented, true);
    assert.deepEqual(win.confirmCalls, []); assert.deepEqual(win.effects, []);
  } finally { unsubscribers.forEach(unsubscribe => unsubscribe()); installed.dispose(); }
});

test('status is read live for each attempt rather than captured when registering', () => {
  const win = mockWindow(), installed = installUnsavedNavigation(win);
  let status = { dirty: true, busy: false };
  const unsubscribe = registerNavigationGuard(win, () => status);
  try {
    assert.equal(traverse(win).defaultPrevented, true);
    status = { dirty: false, busy: false }; assert.equal(traverse(win).defaultPrevented, false);
    status = { dirty: false, busy: true }; assert.equal(traverse(win).defaultPrevented, true);
    status = { dirty: true, busy: false }; win.accept = true; assert.equal(traverse(win).defaultPrevented, false);
    assert.deepEqual(win.confirmCalls, [message, message]);
  } finally { unsubscribe(); installed.dispose(); }
});

test('existing link protocol rejects before history/UI writes and accepted helper navigation runs exactly once', () => {
  const win = mockWindow(), installed = installUnsavedNavigation(win), contexts = [];
  const unsubscribe = registerNavigationGuard(win, context => { contexts.push(context); return { dirty: true, busy: false }; });
  const initial = win.location.href, state = win.history.state;
  try {
    assert.equal(navigateWithinApp(win, '/proyectos?proyecto=uno#hitos'), false); unchanged(win, initial, state);
    assert.deepEqual(contexts[0], { from: '/workspace/tareas?task=17#contenido', to: '/proyectos?proyecto=uno#hitos', type: 'link' });
    win.accept = true; assert.equal(navigateWithinApp(win, '/proyectos?proyecto=uno#hitos'), true);
    assert.equal(readRouteKey(win), '/proyectos?proyecto=uno#hitos');
    assert.deepEqual(win.effects.map(effect => effect.action), ['pushState', 'scroll']);
    assert.equal(win.dispatched.filter(event => event.type === 'popstate').length, 1); assert.deepEqual(win.confirmCalls, [message, message]);
  } finally { unsubscribe(); installed.dispose(); }
});

test('clean navigation and exact current link stay unchanged without phantom confirmation', () => {
  const win = mockWindow(), installed = installUnsavedNavigation(win);
  const unsubscribe = registerNavigationGuard(win, () => ({ dirty: false, busy: false }));
  try {
    assert.equal(navigateWithinApp(win, win.location.href), false); assert.equal(traverse(win).defaultPrevented, false);
    assert.equal(beforeLink(win).defaultPrevented, false); assert.deepEqual(win.confirmCalls, []); assert.deepEqual(win.effects, []);
  } finally { unsubscribe(); installed.dispose(); }
});

test('beforeunload uses native warning and unload context for dirty or busy, never custom confirm', () => {
  for (const status of [{ dirty: true, busy: false }, { dirty: false, busy: true }]) {
    const win = mockWindow(), contexts = [], installed = installUnsavedNavigation(win);
    const unsubscribe = registerNavigationGuard(win, context => { contexts.push(context); return status; });
    try {
      const event = unload(win); assert.equal(event.defaultPrevented, true); assert.ok(event.returnValueWrites.length > 0);
      assert.deepEqual(win.confirmCalls, []); assert.deepEqual(contexts, [{ from: '/workspace/tareas?task=17#contenido', to: null, type: 'unload' }]);
      assert.deepEqual(win.effects, []);
    } finally { unsubscribe(); installed.dispose(); }
  }
});

test('clean or unregistered beforeunload does not request a warning', () => {
  const win = mockWindow(), installed = installUnsavedNavigation(win);
  const unsubscribe = registerNavigationGuard(win, () => ({ dirty: false, busy: false }));
  try {
    for (let i = 0; i < 2; i++) {
      const event = unload(win); assert.equal(event.defaultPrevented, false); assert.deepEqual(event.returnValueWrites, []); unsubscribe();
    }
    assert.deepEqual(win.confirmCalls, []);
  } finally { unsubscribe(); installed.dispose(); }
});

test('noncancelable traversal, push/replace/reload and cross-document events are not trapped or prompted', () => {
  const win = mockWindow(), installed = installUnsavedNavigation(win); let calls = 0;
  const unsubscribe = registerNavigationGuard(win, () => { calls++; return { dirty: true, busy: true }; });
  try {
    for (const options of [{ cancelable: false }, { sameDocument: false }, { navigationType: 'push' }, { navigationType: 'replace' }, { navigationType: 'reload' }]) {
      const event = traverse(win, options); assert.equal(event.defaultPrevented, false); assert.equal(event.preventCalls, 0);
    }
    assert.equal(calls, 0); assert.deepEqual(win.confirmCalls, []); assert.deepEqual(win.effects, []);
  } finally { unsubscribe(); installed.dispose(); }
});

test('cross-origin document exit is not a fake SPA cancellation; native unload remains available', () => {
  const win = mockWindow(), installed = installUnsavedNavigation(win);
  const unsubscribe = registerNavigationGuard(win, () => ({ dirty: true, busy: false }));
  try {
    const event = traverse(win, { url: 'https://other.test/projects', sameDocument: false });
    assert.equal(event.defaultPrevented, false); assert.deepEqual(win.confirmCalls, []);
    assert.equal(unload(win).defaultPrevented, true); assert.deepEqual(win.effects, []);
    const inconsistent = traverse(win, { url: 'https://other.test/projects', sameDocument: true });
    assert.equal(inconsistent.defaultPrevented, false); assert.deepEqual(win.confirmCalls, []);
  } finally { unsubscribe(); installed.dispose(); }
});

test('cancelable same-document traverse is guarded even if canIntercept is false', () => {
  const win = mockWindow(), installed = installUnsavedNavigation(win);
  const unsubscribe = registerNavigationGuard(win, () => ({ dirty: true, busy: false }));
  try {
    assert.equal(traverse(win, { canIntercept: false }).defaultPrevented, true); assert.deepEqual(win.confirmCalls, [message]);
  } finally { unsubscribe(); installed.dispose(); }
});

test('without Navigation API, custom protocol and native unload still work without routing/history monkeypatches', () => {
  const win = mockWindow({ navigation: false }), installed = installUnsavedNavigation(win);
  const unsubscribe = registerNavigationGuard(win, () => ({ dirty: true, busy: false }));
  const location = win.location.href, state = win.history.state;
  try {
    assert.equal(win.navigation, undefined); assert.equal(beforeLink(win).defaultPrevented, true);
    assert.equal(unload(win).defaultPrevented, true); assert.deepEqual(win.confirmCalls, [message]); unchanged(win, location, state);
  } finally { unsubscribe(); installed.dispose(); }
});

test('install/unsubscribe/dispose are idempotent and reinstall activates exactly one listener per surface', () => {
  const win = mockWindow(), first = installUnsavedNavigation(win), second = installUnsavedNavigation(win);
  assert.equal(typeof first.dispose, 'function'); assert.equal(typeof second.dispose, 'function');
  assert.equal(win.count('render:before-navigation'), 1); assert.equal(win.count('beforeunload'), 1); assert.equal(win.navigation.count('navigate'), 1);
  const unsubscribe = registerNavigationGuard(win, () => ({ dirty: true, busy: false }));
  assert.equal(traverse(win).defaultPrevented, true); assert.equal(win.confirmCalls.length, 1);
  unsubscribe(); unsubscribe(); assert.equal(traverse(win).defaultPrevented, false);
  first.dispose(); first.dispose(); second.dispose();
  assert.equal(win.count('render:before-navigation'), 0); assert.equal(win.count('beforeunload'), 0); assert.equal(win.navigation.count('navigate'), 0);
  assert.equal(beforeLink(win).defaultPrevented, false);
  const reinstalled = installUnsavedNavigation(win), remove = registerNavigationGuard(win, () => ({ dirty: false, busy: true }));
  try { assert.equal(win.navigation.count('navigate'), 1); assert.equal(traverse(win).defaultPrevented, true); assert.equal(win.confirmCalls.length, 1); }
  finally { remove(); reinstalled.dispose(); }
});

test('WeakMap registry is window-scoped; one window draft cannot block or prompt another', () => {
  const first = mockWindow(), second = mockWindow(), one = installUnsavedNavigation(first), two = installUnsavedNavigation(second);
  const remove = registerNavigationGuard(first, () => ({ dirty: true, busy: false }));
  try {
    assert.equal(traverse(second).defaultPrevented, false); assert.equal(beforeLink(second).defaultPrevented, false);
    assert.deepEqual(second.confirmCalls, []); assert.equal(traverse(first).defaultPrevented, true); assert.deepEqual(first.confirmCalls, [message]);
  } finally { remove(); one.dispose(); two.dispose(); }
});

test('invalid or throwing status getters fail closed as busy without a discard confirmation', () => {
  const invalid = [undefined, null, false, 42, 'dirty', [], {}, { dirty: true }, { busy: false },
    { dirty: 1, busy: false }, { dirty: false, busy: 'false' }, Promise.resolve({ dirty: false, busy: false })];
  const getters = [...invalid.map(value => () => value), () => { throw new Error('stale component getter'); },
    () => Object.defineProperty({ busy: false }, 'dirty', { get() { throw new Error('invalid status property'); } })];
  for (const getter of getters) {
    const win = mockWindow(), installed = installUnsavedNavigation(win), remove = registerNavigationGuard(win, getter);
    try {
      assert.doesNotThrow(() => { assert.equal(traverse(win).defaultPrevented, true); assert.equal(beforeLink(win).defaultPrevented, true); });
      assert.equal(unload(win).defaultPrevented, true); assert.deepEqual(win.confirmCalls, []); assert.deepEqual(win.effects, []);
    } finally { remove(); installed.dispose(); }
  }
});

test('throwing or missing confirm denies dirty departure without routing/history changes', () => {
  for (const missing of [false, true]) {
    const win = mockWindow(), installed = installUnsavedNavigation(win), remove = registerNavigationGuard(win, () => ({ dirty: true, busy: false }));
    if (missing) delete win.confirm; else win.confirm = () => { throw new Error('Browser dialog unavailable'); };
    const location = win.location.href, state = win.history.state;
    try { assert.equal(traverse(win).defaultPrevented, true); assert.equal(beforeLink(win).defaultPrevented, true); unchanged(win, location, state); }
    finally { remove(); installed.dispose(); }
  }
});

test('installation and handling leave original browser methods/state/scroll/storage untouched', () => {
  const win = mockWindow(), location = win.location.href, state = win.history.state;
  const originals = { ...win.history }, navigationMethods = Object.fromEntries(['navigate', 'back', 'forward', 'traverseTo', 'reload', 'updateCurrentEntry'].map(key => [key, win.navigation[key]]));
  const installed = installUnsavedNavigation(win), remove = registerNavigationGuard(win, () => Object.freeze({ dirty: true, busy: false }));
  try {
    traverse(win); beforeLink(win); unload(win);
    for (const [key, value] of Object.entries(originals)) assert.equal(win.history[key], value);
    for (const [key, value] of Object.entries(navigationMethods)) assert.equal(win.navigation[key], value);
    unchanged(win, location, state);
  } finally { remove(); installed.dispose(); }
  unchanged(win, location, state);
});
