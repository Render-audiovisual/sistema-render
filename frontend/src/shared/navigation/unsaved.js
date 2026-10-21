// Data-loss mitigation only. Never stores drafts or replaces browser history.
const windows = new WeakMap();
const MESSAGE = 'Hay cambios sin guardar. ¿Querés descartarlos?';
function stateFor(win) {
  let state = windows.get(win);
  if (!state) { state = { guards: new Set(), installation: null }; windows.set(win, state); }
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
export function registerNavigationGuard(win, getStatus) {
  if (typeof getStatus !== 'function') throw new TypeError('La protección necesita un lector de estado.');
  const state = stateFor(win), token = navigation => getStatus(navigation);
  state.guards.add(token);
  return () => state.guards.delete(token);
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
    if (!navigation || !approve(win, navigation)) event.preventDefault();
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
    win.removeEventListener('render:before-navigation', before);
    win.removeEventListener('beforeunload', unload);
    nativeNavigation?.removeEventListener?.('navigate', traverse);
    if (state.installation === installation) state.installation = null;
  } };
  state.installation = installation;
  return installation;
}
