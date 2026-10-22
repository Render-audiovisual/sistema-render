import { parseBrowserSession } from './browser-session-state.js';
import { createBrowserApiFetch } from './browser-api-fetch.js';

export const BROWSER_SESSION_LOCK = 'render:browser-session:v1';
export class BrowserSessionControllerError extends Error {
  constructor(code) {
    super('No se pudo confirmar la sesión. Conservá tus cambios y volvé a verificarla.');
    this.name = 'BrowserSessionControllerError'; this.code = code;
  }
}

// One cooperative origin-wide lock covers all cookie-setting requests AND the
// confirming bootstrap. Inject navigator.locks; never silently use a local lock.
// Dispose and cross-document withdrawal are not confirmed server logout.
export function createBrowserSessionController({ origin, store, fetchImpl, locks, notifyChange = () => {} }) {
  if (!locks || typeof locks.request !== 'function') throw new BrowserSessionControllerError('browser_locks_required');
  const apiFetch = createBrowserApiFetch({ origin, store, fetchImpl });
  let active = null, disposed = false, ownedIntent = null;
  const cancelled = op => op.kind === 'logout' ? { revoked: false, reason: 'cancelled' } : { ok: false, reason: 'cancelled' };
  const notify = reason => {
    try { const pending = notifyChange(Object.freeze({ reason })); pending?.catch?.(() => {}); } catch { /* Hint is not authority. */ }
  };
  function start(kind, signal) {
    if (disposed) throw new BrowserSessionControllerError('browser_controller_disposed');
    if (active) throw new BrowserSessionControllerError('browser_session_busy');
    const op = { kind, signal, ticket: null, abort: new AbortController(), cancelled: false, commitStarted: false };
    op.cancel = (force = false) => {
      // Login-page cleanup after a verified publication is not logout. Only
      // explicit logout/global controller disposal may withdraw that observation.
      if (op.commitStarted && !disposed && force !== true) return;
      op.cancelled = true; op.abort.abort();
      if (op.ticket) store.cancelBootstrap(op.ticket);
      if (op.publishedIntent && (force === true || disposed)) store.invalidate(op.publishedIntent);
    };
    // Publish only after ownership is installed: synchronous subscribers may
    // dispose/cancel while loading or authenticated snapshots are emitted.
    active = op;
    if (kind !== 'logout' && kind !== 'profile_refresh') {
      op.ticket = store.beginBootstrap();
      if (op.cancelled) store.cancelBootstrap(op.ticket);
    }
    signal?.addEventListener('abort', op.cancel, { once: true });
    if (signal?.aborted) op.cancel();
    return op;
  }
  async function run(op, work) {
    try {
      if (op.cancelled) return cancelled(op);
      const result = await locks.request(BROWSER_SESSION_LOCK, { mode: 'exclusive' }, async () => op.cancelled ? cancelled(op) : work());
      if (op.cancelled) return cancelled(op);
      // A notification/subscriber can supersede this observation while the
      // lock callback unwinds. Do not hand an obsolete login to the UI.
      if (result?.ok === true && result.session && store.getSession() !== result.session)
        return { ok: false, reason: 'obsolete' };
      return result;
    } catch (error) {
      if (op.cancelled) return cancelled(op);
      if (op.ticket) store.failBootstrap(op.ticket);
      // Never retain credentials, provider details or response bodies in errors.
      throw new BrowserSessionControllerError(error instanceof BrowserSessionControllerError ? error.code : 'browser_session_transport_failed');
    } finally {
      op.signal?.removeEventListener('abort', op.cancel);
      if (active === op) active = null;
    }
  }
  const raw = (path, options = {}) => fetchImpl(path, {
    ...options, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
  });
  async function observe(op, expected = null, strictRole = false) {
    const response = await raw('/api/sesion', { signal: op.abort.signal });
    if (op.cancelled) return cancelled(op);
    if (response.status === 401) {
      if (expected) throw new BrowserSessionControllerError('browser_login_unconfirmed');
      store.acceptBootstrap(op.ticket, null); return { ok: false, reason: 'anonymous' };
    }
    if (!response.ok) throw new BrowserSessionControllerError('browser_bootstrap_failed');
    const value = parseBrowserSession(await response.json());
    if (op.cancelled) return cancelled(op);
    if (response.headers.get('X-Render-Session-Context') !== value.session_context)
      throw new BrowserSessionControllerError('browser_bootstrap_unverified');
    if (expected && (value.session_context !== expected.session_context || value.csrf_token !== expected.csrf_token
      || value.usuario.id !== expected.usuario.id)) throw new BrowserSessionControllerError('browser_login_context_changed');
    if (strictRole && value.usuario.rol !== expected.usuario.rol)
      throw new BrowserSessionControllerError('browser_profile_context_changed');
    const previousRevision = store.getSnapshot().revision;
    op.commitStarted = true;
    if (!store.acceptBootstrap(op.ticket, value)) return { ok: false, reason: 'obsolete' };
    if (op.cancelled) {
      const current = store.captureIntent();
      if (current?.revision === previousRevision + 1) store.invalidate(current);
      return cancelled(op);
    }
    const live = store.getSession();
    if (store.getSnapshot().revision !== previousRevision + 1
      || !live || live.session_context !== value.session_context || live.usuario.id !== value.usuario.id)
      return { ok: false, reason: 'obsolete' };
    ownedIntent = store.captureIntent(); op.publishedIntent = ownedIntent;
    return { ok: true, session: live };
  }
  return Object.freeze({
    isBusy: () => active !== null,
    invalidateExternal() {
      if (disposed) return;
      // Do not abort an unresolved cookie writer's network request or release
      // its Web Lock early. Cancellation prevents publication, not commit.
      active?.cancel(true);
      store.withdrawObservation();
    },
    bootstrap({ signal } = {}) {
      const op = start('bootstrap', signal); return run(op, () => observe(op));
    },
    refreshProfile({ sessionIntent, signal } = {}) {
      // Validate ownership before queueing, then again under the shared lock.
      // Never turn a copied DTO or a stale photo action into a
      // bootstrap of whichever account happens to own the cookie now.
      if (!store.isCurrent(sessionIntent)) throw new BrowserSessionControllerError('browser_profile_intent_obsolete');
      const expected = sessionIntent.session;
      const op = start('profile_refresh', signal);
      return run(op, () => {
        if (!store.isCurrent(sessionIntent)) return { ok: false, reason: 'obsolete' };
        // Only lock ownership permits withdrawing this exact observation.
        // Publication can synchronously cancel/dispose via subscribers.
        op.ticket = store.beginBootstrap();
        if (op.cancelled) { store.cancelBootstrap(op.ticket); return cancelled(op); }
        return observe(op, expected, true);
      });
    },
    login({ kind, body, signal }) {
      const fields = kind === 'password' ? ['usuario', 'password'] : kind === 'google' ? ['credential'] : null;
      if (!fields || !body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== fields.length
        || !fields.every(key => typeof body[key] === 'string')) throw new BrowserSessionControllerError('browser_login_input_invalid');
      const encoded = JSON.stringify(body); // Capture before the first await; do not store credentials.
      const op = start('login', signal);
      return run(op, async () => {
        let sent = false;
        try {
          // Do not abort cookie-setting requests or release this lock while one
          // is unresolved. Logical cancellation only prevents local publication.
          const challenge = await raw('/api/sesion/desafio');
          if (op.cancelled) return cancelled(op);
          if (!challenge.ok) throw new BrowserSessionControllerError('browser_challenge_failed');
          const proof = await challenge.json();
          if (op.cancelled) return cancelled(op);
          if (!proof || Object.keys(proof).length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(proof.csrf_token))
            throw new BrowserSessionControllerError('browser_challenge_invalid');
          sent = true;
          const response = await raw(kind === 'password' ? '/api/login/browser' : '/api/login/browser/google', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Render-CSRF': proof.csrf_token }, body: encoded,
          });
          if (op.cancelled) return cancelled(op);
          if (!response.ok) throw new BrowserSessionControllerError(response.status === 429 ? 'browser_login_rate_limited' : 'browser_login_rejected');
          const receipt = parseBrowserSession(await response.json());
          if (op.cancelled) return cancelled(op);
          return await observe(op, receipt);
        } finally { if (sent) notify('login'); }
      });
    },
    logout({ signal } = {}) {
      if (disposed) return Promise.resolve({ revoked: false, reason: 'disposed' });
      if (active) { active.cancel(true); return Promise.resolve({ revoked: false, reason: 'unverified_session' }); }
      const intent = store.captureIntent();
      if (!intent) return Promise.resolve({ revoked: false, reason: 'unverified_session' });
      const op = start('logout', signal);
      return run(op, async () => {
        if (!store.isCurrent(intent)) return { revoked: false, reason: 'obsolete' };
        let sent = false;
        try {
          sent = true;
          const response = await apiFetch('/api/logout', { method: 'POST', sessionIntent: intent,
            headers: { 'Content-Type': 'application/json' }, body: '{}' });
          const body = await response.json();
          return response.ok && body?.ok === true ? { revoked: true } : { revoked: false, reason: 'unconfirmed' };
        } catch { return { revoked: false, reason: op.cancelled ? 'cancelled' : 'unconfirmed' }; }
        finally { store.invalidate(intent); if (sent) notify('logout'); }
      });
    },
    dispose() {
      disposed = true; active?.cancel();
      if (ownedIntent) store.invalidate(ownedIntent);
    },
  });
}
