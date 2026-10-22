import test from 'node:test';
import assert from 'node:assert/strict';
import { installUnsavedNavigation, registerNavigationGuard, withNavigationConsent } from './unsaved.js';
import { navigateWithConfirmation, navigateWithinApp, readRouteKey, requestAppNavigation } from './location.js';

// Self-contained browser-event double. Uses the actual shared kernel/location
// functions, not React, a dialog replica, jsdom, or native-browser proof.
class FakeEvent {
  constructor(type, { cancelable = false } = {}) { this.type = type; this.cancelable = cancelable; this.defaultPrevented = false; }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
}
class FakeCustomEvent extends FakeEvent {
  constructor(type, options = {}) { super(type, options); this.detail = options.detail; }
}
class FakePopStateEvent extends FakeEvent {
  constructor(type, options = {}) { super(type, options); this.state = options.state; }
}
class FakeTarget {
  listeners = new Map();
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatchEvent(event) {
    event.target = this;
    for (const listener of [...(this.listeners.get(event.type) ?? [])]) {
      if (this.listeners.get(event.type)?.has(listener)) listener.call(this, event);
    }
    return !event.defaultPrevented;
  }
}
function fakeWindow(href = 'https://render.test/workspace/tareas?task=17#contenido') {
  const win = new FakeTarget();
  win.location = new URL(href); win.CustomEvent = FakeCustomEvent; win.PopStateEvent = FakePopStateEvent;
  win.trace = []; win.confirmCalls = []; win.storageCalls = [];
  win.confirm = message => { win.confirmCalls.push(message); return false; };
  win.navigation = new FakeTarget();
  const initialState = Object.freeze({ owner: 'actual-router', keep: Object.freeze({ task: 17 }) });
  win.history = { state: initialState, length: 3, scrollRestoration: 'manual',
    pushState(state, title, href) {
      const next = new URL(href, win.location.href); assert.equal(next.origin, win.location.origin);
      win.trace.push({ kind: 'push', href, title, state }); this.state = state; this.length++; win.location = next;
    },
    replaceState(state, title, href) {
      win.trace.push({ kind: 'replace', href, title, state }); this.state = state; win.location = new URL(href, win.location.href);
    },
    go(delta) { win.trace.push({ kind: 'go', delta }); },
  };
  const dispatch = win.dispatchEvent.bind(win);
  win.dispatchEvent = event => {
    win.trace.push({ kind: event.type, event, route: readRouteKey(win) });
    return dispatch(event);
  };
  win.scrollTo = options => win.trace.push({ kind: 'scroll', options });
  for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(win, name, { get() {
    win.storageCalls.push(name); throw new Error('Navigation consent must not persist business drafts');
  } });
  return win;
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const target = '/proyectos?proyecto=42#entregables';
const options = present => ({ present, isCurrent: () => true });
function guarded(t, { dirty = true, busy = false, observation = true } = {}) {
  const win = fakeWindow(), installed = installUnsavedNavigation(win);
  const draft = { text: 'Original unsaved working text' };
  const state = { dirty, busy, observation: Symbol('render-observation') };
  const remove = registerNavigationGuard(win, () => ({ dirty: state.dirty, busy: state.busy }),
    observation ? { readObservation: () => state.observation } : undefined);
  t.after(() => { remove(); installed.dispose(); });
  return { win, state, draft, remove };
}
function unchanged(win, href, historyState) {
  assert.equal(win.location.href, href); assert.equal(win.history.state, historyState); assert.equal(win.history.length, 3);
  assert.equal(win.history.scrollRestoration, 'manual');
  assert.deepEqual(win.trace.filter(row => ['push', 'popstate', 'scroll', 'go'].includes(row.kind)), []);
  assert.deepEqual(win.confirmCalls, []); assert.deepEqual(win.storageCalls, []);
}

test('controlled Cancel preserves the exact URL, history and working draft without native confirm', async t => {
  const { win, draft } = guarded(t), from = win.location.href, history = win.history.state;
  let prompts = 0;
  const pending = deferred();
  const result = navigateWithConfirmation(win, target, options(() => { prompts++; return pending.promise; }));
  assert.equal(prompts, 1); unchanged(win, from, history);
  pending.resolve(false); assert.equal(await result, false);
  assert.equal(draft.text, 'Original unsaved working text'); unchanged(win, from, history);
});

test('explicit discard uses existing event/push/popstate/scroll order exactly once and never edits the draft itself', async t => {
  const { win, draft } = guarded(t); let prompts = 0;
  assert.equal(await navigateWithConfirmation(win, target, options(() => { prompts++; return true; })), true);
  assert.equal(prompts, 1); assert.equal(readRouteKey(win), target);
  assert.deepEqual(win.trace.map(row => row.kind), ['render:before-navigation', 'push', 'popstate', 'scroll']);
  assert.equal(win.trace[0].event.cancelable, true); assert.equal(win.trace[0].event.defaultPrevented, false);
  assert.deepEqual(win.trace[0].event.detail, { href: target });
  assert.equal(win.trace[2].event.state, win.history.state); assert.equal(win.trace[2].route, target);
  assert.equal(win.history.length, 4); assert.equal(draft.text, 'Original unsaved working text');
  assert.deepEqual(win.confirmCalls, []); assert.deepEqual(win.storageCalls, []);
});

test('busy or invalid/throwing guard denies before opening any controlled confirmation', async t => {
  for (const status of [{ dirty: true, busy: true }, { dirty: false, busy: true }, {}, { dirty: 'yes', busy: false }]) {
    const win = fakeWindow(), installed = installUnsavedNavigation(win);
    const remove = registerNavigationGuard(win, () => status, { readObservation: () => Symbol.for('qa123-invalid') });
    try {
      let prompts = 0;
      assert.equal(await navigateWithConfirmation(win, target, options(() => { prompts++; return true; })), false);
      assert.equal(prompts, 0); assert.equal(win.trace.length, 0); assert.deepEqual(win.confirmCalls, []);
    } finally { remove(); installed.dispose(); }
  }
  const { win } = guarded(t);
  const remove = registerNavigationGuard(win, () => { throw Error('stale getter'); }, { readObservation: () => 1 });
  try { assert.equal(await navigateWithConfirmation(win, target, options(() => assert.fail('Busy must not prompt'))), false); }
  finally { remove(); }
});

test('clean navigation never prompts, while dirty guard without observation or missing host fails closed', async t => {
  const clean = guarded(t, { dirty: false, observation: false });
  assert.equal(await navigateWithConfirmation(clean.win, target, options(() => assert.fail('Clean navigation must not prompt'))), true);
  assert.deepEqual(clean.win.confirmCalls, []);
  for (const hasObservation of [false, true]) {
    const { win } = guarded(t, { observation: hasObservation }), from = win.location.href, history = win.history.state;
    let prompts = 0;
    const config = hasObservation ? { isCurrent: () => true } : options(() => { prompts++; return true; });
    assert.equal(await navigateWithConfirmation(win, target, config), false);
    assert.equal(prompts, 0); unchanged(win, from, history);
  }
});

test('one pending attempt denies repeated clicks including a concurrent clean target, and a canceled attempt releases the slot', async t => {
  const { win, state } = guarded(t), pending = deferred(); let prompts = 0;
  const present = () => { prompts++; return pending.promise; };
  const first = navigateWithConfirmation(win, target, options(present));
  assert.equal(await navigateWithConfirmation(win, '/inicio', options(present)), false);
  state.dirty = false;
  assert.equal(await navigateWithConfirmation(win, '/calendario', options(present)), false);
  assert.equal(prompts, 1); pending.resolve(false); assert.equal(await first, false);
  assert.equal(await navigateWithConfirmation(win, '/inicio', options(() => assert.fail('Clean retry must not prompt'))), true);
  assert.equal(win.trace.filter(row => row.kind === 'push').length, 1);
});

test('changed registration epoch invalidates a pending decision even when unregister/register restores the same state', async t => {
  const { win, remove } = guarded(t), pending = deferred();
  const from = win.location.href, history = win.history.state;
  const result = navigateWithConfirmation(win, target, options(() => pending.promise));
  remove();
  const token = Symbol('new component registration');
  const added = registerNavigationGuard(win, () => ({ dirty: true, busy: false }), { readObservation: () => token });
  t.after(added);
  pending.resolve(true); assert.equal(await result, false); unchanged(win, from, history);
});

test('fresh observation token invalidates changed draft/render including A to B to A without clearing local text', async t => {
  const { win, state, draft } = guarded(t), pending = deferred(), from = win.location.href, history = win.history.state;
  const result = navigateWithConfirmation(win, target, options(() => pending.promise));
  draft.text = 'Second draft'; state.observation = Symbol('B render');
  draft.text = 'Original unsaved working text'; state.observation = Symbol('A new render, not original observation');
  pending.resolve(true); assert.equal(await result, false);
  assert.equal(draft.text, 'Original unsaved working text'); unchanged(win, from, history);
});

test('session/route lifetime changes including same-account ABA invalidate isCurrent rather than rebasing the saved decision', async t => {
  for (const kind of ['account', 'same-account bootstrap', 'route ABA']) {
    const { win } = guarded(t), pending = deferred(), from = win.location.href, history = win.history.state;
    let lifetime = Symbol('initial actual session/route lifetime'); const captured = lifetime;
    const result = navigateWithConfirmation(win, target, { present: () => pending.promise, isCurrent: () => lifetime === captured });
    lifetime = Symbol(`${kind} replacement`);
    if (kind === 'route ABA') {
      win.location = new URL('/feedback?section=team#draft', win.location.href);
      win.dispatchEvent(new FakePopStateEvent('popstate'));
      win.location = new URL(from); win.dispatchEvent(new FakePopStateEvent('popstate'));
      // External routing notifications are not controlled-operation pushes.
      win.trace.length = 0;
    }
    lifetime = Symbol(`${kind} returned identity, fresh lifetime`);
    pending.resolve(true); assert.equal(await result, false); unchanged(win, from, history);
  }
});

test('full from URL, not just pathname, is rechecked after awaiting the presenter', async t => {
  for (const suffix of ['?task=18#contenido', '?task=17#otro']) {
    const { win } = guarded(t), pending = deferred();
    const result = navigateWithConfirmation(win, target, options(() => pending.promise));
    win.location = new URL(`/workspace/tareas${suffix}`, win.location.href);
    pending.resolve(true); assert.equal(await result, false);
    assert.deepEqual(win.trace.filter(row => row.kind === 'push'), []); assert.deepEqual(win.confirmCalls, []);
  }
});

test('becoming busy while the dialog is open denies discard without writing or clearing anything', async t => {
  const { win, state } = guarded(t), pending = deferred(), from = win.location.href, history = win.history.state;
  const result = navigateWithConfirmation(win, target, options(() => pending.promise));
  state.busy = true; pending.resolve(true);
  assert.equal(await result, false); unchanged(win, from, history);
});

test('a legacy listener can cancel after kernel consent, and canceled consent does not leak into later plain navigation', async t => {
  const { win } = guarded(t), from = win.location.href, history = win.history.state;
  const cancel = event => event.preventDefault(); win.addEventListener('render:before-navigation', cancel);
  assert.equal(await navigateWithConfirmation(win, target, options(() => true)), false);
  unchanged(win, from, history); win.removeEventListener('render:before-navigation', cancel);
  assert.equal(navigateWithinApp(win, target), false, 'Legacy call needs its own existing approval, not old controlled consent');
  assert.equal(win.confirmCalls.length, 1); assert.equal(win.trace.filter(row => row.kind === 'push').length, 0);
});

test('another before-event listener changing guard observation without canceling still prevents the final history commit', async t => {
  const { win, state } = guarded(t), from = win.location.href, history = win.history.state;
  win.addEventListener('render:before-navigation', () => { state.observation = Symbol('new render during event'); });
  assert.equal(await navigateWithConfirmation(win, target, options(() => true)), false);
  unchanged(win, from, history);
});

test('another before-event listener replacing current actor without canceling still prevents the final history commit', async t => {
  const { win } = guarded(t), from = win.location.href, history = win.history.state;
  let current = true;
  win.addEventListener('render:before-navigation', () => { current = false; });
  assert.equal(await navigateWithConfirmation(win, target, { present: () => true, isCurrent: () => current }), false);
  unchanged(win, from, history);
});

test('another before-event listener adding even a clean guard invalidates registration epoch before commit', async t => {
  const { win } = guarded(t), from = win.location.href, history = win.history.state; let added;
  const observation = Symbol('another component');
  win.addEventListener('render:before-navigation', () => {
    added = registerNavigationGuard(win, () => ({ dirty: false, busy: false }), { readObservation: () => observation });
  });
  t.after(() => added?.());
  assert.equal(await navigateWithConfirmation(win, target, options(() => true)), false);
  unchanged(win, from, history);
});

test('same-target event reentry cannot borrow the one-shot permit or call native confirm', async t => {
  const { win } = guarded(t); let nested, entered = false;
  win.addEventListener('render:before-navigation', () => {
    if (entered) return; entered = true;
    nested = navigateWithinApp(win, target);
  });
  assert.equal(await navigateWithConfirmation(win, target, options(() => true)), true);
  assert.equal(nested, false); assert.equal(win.trace.filter(row => row.kind === 'push').length, 1);
  assert.equal(win.trace.filter(row => row.kind === 'popstate').length, 1); assert.deepEqual(win.confirmCalls, []);
});

test('controlled API reentry during the commit event is denied without a second dialog or push', async t => {
  const { win } = guarded(t); let nested, prompts = 0;
  win.addEventListener('render:before-navigation', () => {
    nested = navigateWithConfirmation(win, '/inicio', options(() => { prompts++; return true; }));
  });
  assert.equal(await navigateWithConfirmation(win, target, options(() => { prompts++; return true; })), true);
  assert.equal(await nested, false); assert.equal(prompts, 1);
  assert.equal(win.trace.filter(row => row.kind === 'push').length, 1); assert.deepEqual(win.confirmCalls, []);
});

test('listener installed before kernel cannot steal the intended before-event permit through same-target legacy reentry', async t => {
  const win = fakeWindow(); let entered = false, nested;
  win.addEventListener('render:before-navigation', () => {
    if (entered) return; entered = true;
    nested = navigateWithinApp(win, target);
  });
  const installed = installUnsavedNavigation(win), observation = Symbol('stable dirty draft');
  const remove = registerNavigationGuard(win, () => ({ dirty: true, busy: false }), { readObservation: () => observation });
  t.after(() => { remove(); installed.dispose(); });
  const result = await navigateWithConfirmation(win, target, options(() => true));
  assert.deepEqual({ result, nested, pushes: win.trace.filter(row => row.kind === 'push').length,
    popstates: win.trace.filter(row => row.kind === 'popstate').length, confirms: win.confirmCalls },
  { result: true, nested: false, pushes: 1, popstates: 1, confirms: [] },
  'Only the original controlled operation may consume and commit its own before-event');
});

test('presenter/current/observation failures fail closed and release the pending slot for a later explicit attempt', async t => {
  for (const fail of ['present throw', 'present reject', 'current throw', 'observation throw']) {
    const { win, state } = guarded(t), from = win.location.href, history = win.history.state;
    let added;
    if (fail === 'observation throw') added = registerNavigationGuard(win, () => ({ dirty: true, busy: false }), {
      readObservation: () => { throw Error('Unmounted observation'); },
    });
    try {
      const config = {
        present: () => {
          if (fail === 'present throw') throw Error('No dialog host');
          if (fail === 'present reject') return Promise.reject(Error('Host disposed'));
          return true;
        },
        isCurrent: () => { if (fail === 'current throw') throw Error('No live session'); return true; },
      };
      assert.equal(await navigateWithConfirmation(win, target, config), false); unchanged(win, from, history);
    } finally { added?.(); }
    state.dirty = false;
    assert.equal(await navigateWithConfirmation(win, '/inicio', options(() => assert.fail('Clean recovery must not prompt'))), true);
  }
});

test('invalid, off-origin and exact-current targets never open a dialog or mutate history', async t => {
  for (const href of [null, undefined, '', ' ', 'https://other.test/inicio', '//other.test/inicio', 'javascript:alert(1)',
    'https://user:secret@render.test/inicio', 'https://render.test/workspace/tareas?task=17#contenido']) {
    const { win } = guarded(t), from = win.location.href, history = win.history.state;
    assert.equal(await navigateWithConfirmation(win, href, options(() => assert.fail('Rejected target must not prompt'))), false);
    unchanged(win, from, history);
  }
});

test('withNavigationConsent gives trusted synchronous perform a final validator, executes it once, and leaves no global permit', async t => {
  const { win } = guarded(t); let performs = 0, prompts = 0;
  const result = await withNavigationConsent(win, target, {
    present: () => { prompts++; return true; }, isCurrent: () => true,
    perform: validate => {
      performs++; assert.equal(typeof validate, 'function');
      assert.equal(requestAppNavigation(win, target), true);
      assert.equal(validate(), true);
      return false; // Trusted caller declines its own commit; no synthetic push.
    },
  });
  assert.equal(result, false); assert.equal(performs, 1); assert.equal(prompts, 1); assert.deepEqual(win.confirmCalls, []);
  assert.equal(navigateWithinApp(win, target), false);
  assert.equal(win.confirmCalls.length, 1); assert.equal(win.trace.filter(row => row.kind === 'push').length, 0);
});
