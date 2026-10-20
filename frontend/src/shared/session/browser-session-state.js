const BINDING = /^[A-Za-z0-9_-]{43}$/;
// Weak ownership metadata stays outside serialized DTOs. A copied context is
// not a captured request intent and cannot silently adopt a newer observation.
const sessionOwners = new WeakMap();
export function captureBrowserSessionIntent(session) {
  const owner = session && typeof session === 'object' ? sessionOwners.get(session) : null;
  return owner && owner.getSession() === session ? owner.captureIntent() : null;
}
export function isBrowserSessionIntentCurrent(intent) {
  const owner = intent?.session && sessionOwners.get(intent.session);
  return Boolean(owner?.isCurrent(intent));
}
export function parseBrowserSession(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['usuario', 'session_context', 'csrf_token'].includes(key))
    || !BINDING.test(value.session_context) || !BINDING.test(value.csrf_token)
    || value.session_context === value.csrf_token) throw new Error('Respuesta de sesión inválida.');
  const user = value.usuario;
  if (!user || !Number.isSafeInteger(user.id) || user.id < 1
    || !['usuario', 'nombre', 'rol'].every(key => typeof user[key] === 'string' && user[key].trim() && user[key].length <= 4096)
    || user.activo === false) throw new Error('Identidad de sesión inválida.');
  // Closed projection: no JWT, hash, financial bags or browser storage authority.
  const identity = { id: user.id, usuario: user.usuario, nombre: user.nombre, rol: user.rol };
  if (user.foto_perfil === null || typeof user.foto_perfil === 'string') identity.foto_perfil = user.foto_perfil;
  return Object.freeze({ usuario: Object.freeze(identity), session_context: value.session_context, csrf_token: value.csrf_token });
}

// In-memory observation only. Authentication/authorization always remain server-side.
// No globals, Web Storage, listeners or fetches are accessed at import time.
export function createBrowserSessionState() {
  let revision = 0, activeBootstrap = null;
  let snapshot = Object.freeze({ status: 'unknown', session: null, revision });
  const listeners = new Set(), intents = new WeakSet();
  const publish = (status, session = null) => {
    snapshot = Object.freeze({ status, session, revision: ++revision });
    for (const listener of listeners) { try { listener(); } catch { /* Subscriber must not corrupt the state boundary. */ } }
  };
  const isCurrent = intent => Boolean(intent && typeof intent === 'object' && intents.has(intent)
    && snapshot.status === 'authenticated' && intent.revision === revision && intent.session === snapshot.session);
  const api = Object.freeze({
    getSnapshot: () => snapshot,
    getSession: () => snapshot.status === 'authenticated' ? snapshot.session : null,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    beginBootstrap() {
      const ticket = Object.freeze({}); activeBootstrap = ticket;
      publish('loading'); return ticket;
    },
    acceptBootstrap(ticket, value) {
      if (!activeBootstrap || ticket !== activeBootstrap) return false;
      const session = value === null ? null : parseBrowserSession(value);
      if (session) sessionOwners.set(session, api);
      activeBootstrap = null; publish(session ? 'authenticated' : 'anonymous', session); return true;
    },
    failBootstrap(ticket) {
      if (!activeBootstrap || ticket !== activeBootstrap) return false;
      activeBootstrap = null; publish('error'); return true;
    },
    cancelBootstrap(ticket) {
      if (!activeBootstrap || ticket !== activeBootstrap) return false;
      activeBootstrap = null; publish('unknown'); return true;
    },
    captureIntent() {
      if (snapshot.status !== 'authenticated') return null;
      const intent = Object.freeze({ revision, session: snapshot.session }); intents.add(intent); return intent;
    },
    isCurrent,
    invalidate(intent) {
      if (!isCurrent(intent)) return false;
      activeBootstrap = null; publish('anonymous'); return true;
    },
  });
  return api;
}

export async function bootstrapBrowserSession({ store, fetchImpl, signal }) {
  const ticket = store.beginBootstrap();
  const cancel = () => store.cancelBootstrap(ticket);
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) { cancel(); signal.removeEventListener('abort', cancel); return false; }
  try {
    const response = await fetchImpl('/api/sesion', { signal, credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
    if (response.status === 401) return store.acceptBootstrap(ticket, null);
    if (!response.ok) throw new Error('No se pudo verificar la sesión.');
    const body = await response.json();
    if (response.headers.get('X-Render-Session-Context') !== body?.session_context)
      throw new Error('No se pudo confirmar el contexto de sesión.');
    return store.acceptBootstrap(ticket, body);
  } catch (error) {
    if (!store.failBootstrap(ticket)) return false; // Obsolete failure never clears a newer observation.
    throw error;
  } finally { signal?.removeEventListener('abort', cancel); }
}
