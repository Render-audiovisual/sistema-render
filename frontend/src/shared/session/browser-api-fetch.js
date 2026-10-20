const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
export class BrowserSessionError extends Error {
  constructor(code) { super('La sesión cambió o no pudo verificarse. Conservá tus cambios y volvé a verificarla.'); this.name = 'BrowserSessionError'; this.code = code; }
}

// Exact-intent wrapper for the coordinated cookie cutover, not a compatibility
// shim. Callers must migrate token guards and capture mutations at user intent.
export function createBrowserApiFetch({ origin, store, fetchImpl }) {
  if (new URL(origin).origin !== origin || !/^https?:/.test(origin)) throw new Error('Origen API inválido.');
  const current = intent => { if (!store.isCurrent(intent)) throw new BrowserSessionError('browser_intent_obsolete'); };
  function fence(response, intent) {
    return new Proxy(response, { get(target, key) {
      if (key === 'clone') return () => { current(intent); return fence(target.clone(), intent); };
      if (key === 'body') throw new BrowserSessionError('browser_stream_not_supported');
      const value = Reflect.get(target, key, target);
      if (['json', 'text', 'blob', 'arrayBuffer', 'formData', 'bytes'].includes(key) && typeof value === 'function')
        return async (...args) => {
          current(intent);
          try { const body = await value.apply(target, args); current(intent); return body; }
          catch (error) { current(intent); throw error; }
        };
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  }
  return async (input, init = {}) => {
    const value = typeof input === 'string' ? input : input?.url ?? input?.href;
    let url;
    try { url = new URL(value, origin); } catch { return fetchImpl(input, init); }
    if (url.origin !== origin || !(url.pathname === '/api' || url.pathname.startsWith('/api/'))) return fetchImpl(input, init);
    if (typeof input !== 'string') throw new BrowserSessionError('browser_request_object_not_supported');
    if (url.username || url.password || url.pathname === '/api/sesion' || url.pathname.startsWith('/api/login'))
      throw new BrowserSessionError('browser_session_transport_required');
    const { sessionIntent, ...options } = init;
    if (typeof options.body?.getReader === 'function') throw new BrowserSessionError('browser_request_stream_not_supported');
    const method = (options.method || 'GET').toUpperCase();
    const intent = sessionIntent || (SAFE.has(method) ? store.captureIntent() : null);
    current(intent);
    const headers = new Headers(options.headers || {});
    if (headers.has('Authorization')) throw new BrowserSessionError('browser_bearer_not_allowed');
    for (const [key, value] of [['X-Render-Session-Context', intent.session.session_context], ['X-Render-CSRF', intent.session.csrf_token]]) {
      if (headers.has(key) && headers.get(key) !== value) throw new BrowserSessionError('browser_intent_headers_conflict');
      headers.set(key, value);
    }
    let response;
    try {
      response = await fetchImpl(`${url.pathname}${url.search}`, { ...options, method, headers,
        credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
    } catch (error) { current(intent); throw error; }
    current(intent);
    const proof = response.headers.get('X-Render-Session-Context');
    if (response.status === 401) {
      let passwordError = false;
      if (proof === intent.session.session_context && ['/api/usuarios/perfil', '/api/usuarios/password'].includes(url.pathname)) {
        try { passwordError = (await response.clone().json())?.code === 'current_password_invalid'; } catch { /* An unclassified401 is unauthorized. */ }
        current(intent);
      }
      if (!passwordError) { store.invalidate(intent); throw new BrowserSessionError('browser_session_unauthorized'); }
    } else if (proof && proof !== intent.session.session_context) {
      store.invalidate(intent); throw new BrowserSessionError('browser_response_context_changed');
    } else if (!proof) {
      if (response.status === 409) {
        let changed = false;
        try { changed = (await response.clone().json())?.code === 'browser_session_changed'; } catch { /* No automatic retry. */ }
        current(intent);
        if (changed) store.invalidate(intent);
      }
      throw new BrowserSessionError('browser_response_unverified');
    }
    return fence(response, intent);
  };
}
