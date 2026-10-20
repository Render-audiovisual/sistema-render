import { createBrowserSessionState } from './browser-session-state.js';
import { createBrowserSessionController } from './browser-session-controller.js';
import { createBrowserApiFetch } from './browser-api-fetch.js';
import { createAuthenticatedApiFetch } from './api-fetch.js';
import { parseCurrentSession } from './current-session.js';

export class ApplicationSessionError extends Error {
  constructor(code) {
    super('No se pudo usar la sesión en este modo.');
    this.name = 'ApplicationSessionError'; this.code = code;
  }
}

// One instance belongs to one document, not to a React mount. No globals,
// event listeners or storage access at module import time.
export function createApplicationSession({ mode = 'bearer', fetchImpl, storage, location, apiBase = '', locks, notifyChange } = {}) {
  if (!['bearer', 'browser'].includes(mode) || typeof fetchImpl !== 'function')
    throw new ApplicationSessionError('application_session_config_invalid');
  let disposed = false, started;
  const assertLive = () => { if (disposed) throw new ApplicationSessionError('application_session_disposed'); };
  // INITIAL-ONLY result, cached even on rejection. This is not revalidation or
  // current identity: consumers observe getSnapshot/subscribe after later login.
  // Install the promise before controller publication permits subscriber reentry.
  const startOnce = work => {
    assertLive();
    if (!started) {
      let resolve, reject;
      started = new Promise((yes, no) => { resolve = yes; reject = no; });
      try { Promise.resolve(work()).then(resolve, reject); } catch (error) { reject(error); }
    }
    return started;
  };
  if (mode === 'browser') {
    let origin;
    try {
      origin = location.origin;
      if (apiBase !== '' || new URL(origin).origin !== origin || !/^https?:/.test(origin)) throw new Error();
    } catch { throw new ApplicationSessionError('application_session_origin_invalid'); }
    // Never consult storage, including when configuration/locks are invalid.
    const store = createBrowserSessionState();
    const controller = createBrowserSessionController({ origin, store, fetchImpl, locks, notifyChange });
    const apiFetch = createBrowserApiFetch({ origin, store, fetchImpl });
    const subscriptions = new Set();
    return Object.freeze({ mode,
      fetch(input, options) { assertLive(); return apiFetch(input, options); },
      getSession: store.getSession, getSnapshot: store.getSnapshot,
      subscribe(listener) {
        if (disposed) return () => {};
        const remove = store.subscribe(listener);
        const unsubscribe = () => { remove(); subscriptions.delete(unsubscribe); };
        subscriptions.add(unsubscribe); return unsubscribe;
      },
      start: () => startOnce(() => controller.bootstrap()),
      login(options) { assertLive(); return controller.login(options); },
      logout(options) { assertLive(); return controller.logout(options); },
      dispose() { if (!disposed) {
        disposed = true; for (const unsubscribe of subscriptions) unsubscribe(); controller.dispose();
      } },
    });
  }
  const listeners = new Set();
  let rawPrevious = Symbol('unread'), snapshot, revision = 0;
  const getSnapshot = () => {
    let raw;
    try { raw = storage.getItem('render_sesion'); } catch { raw = null; }
    if (raw !== rawPrevious) {
      rawPrevious = raw;
      const session = parseCurrentSession(raw);
      if (session) { Object.freeze(session.usuario); Object.freeze(session); }
      snapshot = Object.freeze({ status: session ? 'authenticated' : 'anonymous', session, revision: ++revision });
    }
    return snapshot;
  };
  const emit = () => {
    const previous = snapshot, next = getSnapshot();
    if (next !== previous && !disposed) for (const listener of listeners) {
      try { listener(); } catch { /* Observers cannot change transport outcomes. */ }
    }
  };
  const legacyFetch = createAuthenticatedApiFetch({ fetchImpl, storage, location, apiBase });
  const unsupported = () => { assertLive(); throw new ApplicationSessionError('application_session_mode_unsupported'); };
  return Object.freeze({ mode,
    async fetch(input, options) { assertLive(); try { return await legacyFetch(input, options); } finally { emit(); } },
    getSession: () => getSnapshot().session, getSnapshot,
    // Legacy notification is post-fetch only. No storage event listener, polling
    // or cross-tab subscription is installed; App's existing behavior is unchanged.
    subscribe(listener) { if (disposed) return () => {}; listeners.add(listener); return () => listeners.delete(listener); },
    start: () => startOnce(() => ({ ok: Boolean(getSnapshot().session), session: getSnapshot().session })),
    login: unsupported, logout: unsupported,
    dispose() { disposed = true; listeners.clear(); },
  });
}
