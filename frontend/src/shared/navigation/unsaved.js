// Data-loss mitigation only. Never stores drafts or replaces browser history.
const windows = new WeakMap();
const MESSAGE = 'Hay cambios sin guardar. ¿Querés descartarlos?';
function stateFor(win) {
  let state = windows.get(win);
  if (!state) { state = { guards: new Set(), observations: new Map(), epoch: 0, pending: null, permit: null, installation: null }; windows.set(win, state); }
  return state;
}
const route = url => `${url.pathname}${url.search}${url.hash}`;
function context(win, to, type) {
  const from = new URL(win.location.href);
  if (to === null) return { from: route(from), to: null, type };
  const next = new URL(to, from);
  if (next.origin !== from.origin || !['http:', 'https:'].includes(next.protocol) || next.username || next.password) return null;
  return { from: route(from), to: route(next), type };
}
function statusFor(win, navigation) {
  let dirty = false, busy = false;
  for (const getter of [...stateFor(win).guards]) {
    try {
      const value = getter(navigation);
      if (!value || typeof value.dirty !== 'boolean' || typeof value.busy !== 'boolean') { busy = true; continue; }
      dirty ||= value.dirty; busy ||= value.busy;
    } catch { busy = true; }
  }
  return { dirty, busy };
}
function approve(win, navigation) {
  const status = statusFor(win, navigation);
  if (status.busy) return false;
  if (!status.dirty) return true;
  try { return win.confirm(MESSAGE) === true; } catch { return false; }
}
export function registerNavigationGuard(win, getStatus, { readObservation } = {}) {
  if (typeof getStatus !== 'function') throw new TypeError('La protección necesita un lector de estado.');
  if (readObservation !== undefined && typeof readObservation !== 'function') throw new TypeError('La observación necesita un lector.');
  const state = stateFor(win), token = navigation => getStatus(navigation);
  state.guards.add(token);
  state.observations.set(token, readObservation);
  state.epoch++; state.pending?.controller.abort();
  return () => {
    if (!state.guards.delete(token)) return;
    state.observations.delete(token); state.epoch++; state.pending?.controller.abort();
  };
}

// Additive controlled-consent path. Legacy synchronous callers retain their
// exact boolean contract. The presenter never owns history or a reusable permit.
export async function withNavigationConsent(win, href, { present, isCurrent, perform } = {}) {
  const state = stateFor(win);
  if (state.pending || !state.installation || typeof present !== 'function'
    || typeof isCurrent !== 'function' || typeof perform !== 'function') return false;
  let attempt;
  try {
    const navigation = context(win, href, 'link');
    if (!navigation || navigation.from === navigation.to || !isCurrent()) return false;
    const before = statusFor(win, navigation);
    if (before.busy) return false;
    const observations = [...state.guards].map(token => {
      const reader = state.observations.get(token);
      if (before.dirty && typeof reader !== 'function') throw new Error('Missing controlled observation.');
      return { token, reader, value: reader?.() };
    });
    const epoch = state.epoch, installation = state.installation, from = win.location.href;
    const controller = new AbortController();
    attempt = { controller }; state.pending = attempt;
    const valid = () => {
      try {
        const sameOwner = () => state.pending === attempt && state.installation === installation && state.epoch === epoch
          && !controller.signal.aborted && win.location.href === from && isCurrent();
        const sameObservations = () => observations.every(item => state.guards.has(item.token)
          && state.observations.get(item.token) === item.reader && Object.is(item.reader?.(), item.value));
        if (!sameOwner() || !sameObservations()) return false;
        const current = statusFor(win, navigation);
        return !current.busy && (before.dirty || !current.dirty) && sameOwner() && sameObservations();
      } catch { return false; }
    };
    if (!valid()) return false;
    if (before.dirty) {
      const accepted = await present(Object.freeze({ signal: controller.signal, isCurrent: valid }));
      if (accepted !== true || !valid()) return false;
    }
    const permit = { navigation, valid, consumed: false };
    state.permit = permit;
    // perform is the trusted synchronous router commit. Its final validate runs
    // AFTER every cancellable listener, immediately before changing history.
    const validate = () => state.permit === permit && permit.consumed && valid();
    return perform(validate) === true;
  } catch { return false; }
  finally {
    if (state.pending === attempt) { state.permit = null; state.pending = null; attempt?.controller.abort(); }
  }
}

// Bind the one-use approval to the original Event BEFORE any listener can
// dispatch a nested navigation with the same URL. No permit leaves this module.
export function dispatchNavigationEvent(win, event) {
  const permit = stateFor(win).permit;
  if (permit && !permit.event) permit.event = event;
  return win.dispatchEvent(event);
}
export function installUnsavedNavigation(win) {
  const state = stateFor(win);
  if (state.installation) return state.installation;
  const before = event => {
    if (event.defaultPrevented) return;
    if (typeof event.detail?.href !== 'string' || !event.detail.href.trim()) { event.preventDefault(); return; }
    let navigation;
    // A same-location data refresh can replace component state. It must not
    // borrow a task guard's harmless "keeps this task open" link exemption.
    try { navigation = context(win, event.detail?.href, event.detail?.type === 'refresh' ? 'refresh' : 'link'); } catch { event.preventDefault(); return; }
    if (!navigation) { event.preventDefault(); return; }
    const permit = state.permit;
    if (permit) {
      if (permit.event !== event || permit.consumed || navigation.from !== permit.navigation.from || navigation.to !== permit.navigation.to
        || navigation.type !== permit.navigation.type || !permit.valid()) event.preventDefault();
      else permit.consumed = true;
      return;
    }
    if (state.pending) { event.preventDefault(); return; }
    if (!approve(win, navigation)) event.preventDefault();
  };
  const unload = event => {
    const status = statusFor(win, context(win, null, 'unload'));
    if (status.dirty || status.busy) { event.preventDefault(); event.returnValue = ''; }
  };
  const traverse = event => {
    // Browser escape/cross-document traversals may be noncancelable. Respect
    // that boundary: no compensating history.go/replaceState loop or hijack.
    if (event.defaultPrevented || !event.cancelable || event.navigationType !== 'traverse' || event.destination?.sameDocument !== true) return;
    let navigation;
    try { navigation = context(win, event.destination.url, 'traverse'); } catch { return; }
    if (navigation && !approve(win, navigation)) event.preventDefault();
  };
  win.addEventListener('render:before-navigation', before);
  win.addEventListener('beforeunload', unload);
  const nativeNavigation = win.navigation;
  if (nativeNavigation && typeof nativeNavigation.addEventListener === 'function') nativeNavigation.addEventListener('navigate', traverse);
  let disposed = false;
  const installation = { dispose() {
    if (disposed) return;
    disposed = true;
    state.pending?.controller.abort();
    win.removeEventListener('render:before-navigation', before);
    win.removeEventListener('beforeunload', unload);
    nativeNavigation?.removeEventListener?.('navigate', traverse);
    if (state.installation === installation) state.installation = null;
  } };
  state.installation = installation;
  return installation;
}
