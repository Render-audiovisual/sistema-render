import {captureSessionBinding, sessionBindingMatches} from '../session/session-binding.js';
import {readRememberedView, saveRememberedView} from './rememberedViews.js';

// Preferences only: never accepts or persists business records or credentials.
export function createRememberedViewOwner({session, readSession, windowTarget, documentTarget, getStorage = () => windowTarget.localStorage}) {
  const binding = captureSessionBinding(session), id = session?.usuario?.id;
  let disposed = false;
  const current = () => {
    try { return !disposed && sessionBindingMatches(binding, readSession()); }
    catch { return false; }
  };
  const save = () => {
    try {
      if (!current()) return false;
      return saveRememberedView(getStorage(), id, `${windowTarget.location.pathname}${windowTarget.location.search}`);
    } catch { return false; }
  };
  const read = href => {
    try { return current() ? readRememberedView(getStorage(), id, href) : href; }
    catch { return href; }
  };
  const visibility = () => { if (documentTarget.visibilityState === 'hidden') save(); };
  // A separate task lets all native popstate listeners settle their context;
  // microtasks may run between native listener callbacks. Coalesce rapid Back.
  let restoreTimer = null;
  const afterHistoryRestore = () => {
    if (!current()) return;
    if (restoreTimer !== null) windowTarget.clearTimeout(restoreTimer);
    restoreTimer = windowTarget.setTimeout(() => { restoreTimer = null; save(); }, 0);
  };
  const events = ['render:view-preference-change', 'render:before-navigation', 'popstate', 'pagehide', 'beforeunload'];
  for (const event of events) windowTarget.addEventListener(event, event === 'popstate' ? afterHistoryRestore : save);
  documentTarget.addEventListener('visibilitychange', visibility);
  return {
    save, read,
    dispose() {
      disposed = true;
      if (restoreTimer !== null) windowTarget.clearTimeout(restoreTimer);
      restoreTimer = null;
      for (const event of events) windowTarget.removeEventListener(event, event === 'popstate' ? afterHistoryRestore : save);
      documentTarget.removeEventListener('visibilitychange', visibility);
    },
  };
}
