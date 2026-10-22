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
export function createApplicationSession({ mode = 'bearer', fetchImpl, storage, location, apiBase = '', locks, notifyChange, eventTarget, sessionChanges } = {}) {
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
    let removeChanges;
    return Object.freeze({ mode,
      fetch(input, options) { assertLive(); return apiFetch(input, options); },
      getSession: store.getSession, getSnapshot: store.getSnapshot,
      subscribe(listener) {
        if (disposed) return () => {};
        const remove = store.subscribe(listener);
        const unsubscribe = () => { remove(); subscriptions.delete(unsubscribe); };
        subscriptions.add(unsubscribe); return unsubscribe;
      },
      start: () => startOnce(() => {
        if (sessionChanges) {
          if (typeof sessionChanges.subscribe !== 'function') throw new ApplicationSessionError('application_session_changes_invalid');
          removeChanges = sessionChanges.subscribe(() => controller.invalidateExternal());
        }
        return controller.bootstrap();
      }),
      login(options) { assertLive(); return controller.login(options); },
      logout(options) { assertLive(); return controller.logout(options); },
      refreshProfile(intent) { assertLive(); return controller.refreshProfile({ sessionIntent: intent }); },
      invalidateSession(intent) { assertLive(); return store.invalidate(intent); },
      sync() { assertLive(); throw new ApplicationSessionError('application_session_mode_unsupported'); },
      dispose() { if (!disposed) {
        disposed = true; removeChanges?.(); for (const unsubscribe of subscriptions) unsubscribe(); controller.dispose();
      } },
    });
  }
  const listeners = new Set();
  let removeStorageListener;
  let rawPrevious = Symbol('unread'), snapshot, lastNotified, revision = 0;
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
    const next = getSnapshot();
    if (next !== lastNotified && !disposed) {
      // Reads may already have advanced snapshot. Only notification advances
      // this marker; install it before callbacks so reentrant sync is a no-op.
      lastNotified = next;
      for (const listener of listeners) {
        try { listener(); } catch { /* Observers cannot change transport outcomes. */ }
      }
    }
  };
  const legacyFetch = createAuthenticatedApiFetch({ fetchImpl, storage, location, apiBase });
  const unsupported = () => { assertLive(); throw new ApplicationSessionError('application_session_mode_unsupported'); };
  const sync = () => { assertLive(); emit(); return getSnapshot(); };
  const listen = () => {
    if (disposed || removeStorageListener || !eventTarget) return;
    const onStorage = event => {
      if (disposed || (event.key !== 'render_sesion' && event.key !== null)
        || (event.storageArea != null && event.storageArea !== storage)) return;
      // Never accept event.newValue (or a caller DTO) as authentication state.
      emit();
    };
    eventTarget.addEventListener('storage', onStorage);
    removeStorageListener = () => eventTarget.removeEventListener('storage', onStorage);
  };
  return Object.freeze({ mode,
    async fetch(input, options) { assertLive(); try { return await legacyFetch(input, options); } finally { emit(); } },
    getSession: () => getSnapshot().session, getSnapshot,
    // Same-document writes call sync(); external storage events are subscribed
    // only by start(). Both reread the existing key, never event payloads.
    subscribe(listener) {
      if (disposed) return () => {};
      if (lastNotified === undefined) lastNotified = getSnapshot();
      listeners.add(listener); return () => listeners.delete(listener);
    },
    start: () => startOnce(() => {
      if (lastNotified === undefined) lastNotified = getSnapshot();
      listen(); return { ok: Boolean(getSnapshot().session), session: getSnapshot().session };
    }),
    sync,
    login: unsupported, logout: unsupported, refreshProfile: unsupported, invalidateSession: unsupported,
    dispose() { if (!disposed) { disposed = true; removeStorageListener?.(); listeners.clear(); } },
  });
}
