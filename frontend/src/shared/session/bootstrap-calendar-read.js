// A one-shot, document-local read. This is never an authentication source or a
// data cache. The normal API transport still fences every adopted response.
export function createBootstrapCalendarRead({ request, store, fetchImpl, ttl = 10000 }) {
  let pending, boundSession, remove, timer, controller, closed = false;
  const clear = () => {
    closed = true; controller?.abort(); clearTimeout(timer); remove?.();
    pending = undefined; boundSession = undefined;
  };
  const eligible = typeof request === 'string' && /^\/api\/calendario\?/.test(request)
    && new URL(request, 'https://render.invalid').searchParams.get('vista') === 'publicaciones';
  return {
    start() {
      if (!eligible || pending || closed || store.getSnapshot().status !== 'loading') return;
      controller = new AbortController();
      remove = store.subscribe(() => {
        const snapshot = store.getSnapshot();
        if (snapshot.status !== 'authenticated' || boundSession) { clear(); return; }
        boundSession = snapshot.session;
      });
      timer = setTimeout(clear, ttl); timer.unref?.();
      pending = Promise.resolve().then(() => closed ? null : fetchImpl(request, {
        method: 'GET', signal: controller.signal, credentials: 'same-origin',
        cache: 'no-store', redirect: 'error',
      })).catch(() => null);
    },
    async fetch(input, options) {
      if (!pending || input !== request || options.method !== 'GET'
        || !boundSession || store.getSession() !== boundSession)
        return fetchImpl(input, options);
      const candidate = pending, session = boundSession;
      // Consume at most once; a remount or retry must perform its own read.
      pending = undefined;
      const abort = () => controller.abort();
      options.signal?.addEventListener('abort', abort, { once: true });
      try {
        options.signal?.throwIfAborted();
        const response = await candidate;
        options.signal?.throwIfAborted();
        if (!closed && response?.ok && store.getSession() === session
          && new Headers(options.headers).get('X-Render-Session-Context') === session.session_context
          && response.headers.get('X-Render-Session-Context') === session.session_context) {
          // Ownership passes to the normal fenced transport; do not abort its
          // still-unread body when releasing this one-shot coordinator.
          controller = undefined;
          return response;
        }
      } finally {
        options.signal?.removeEventListener('abort', abort); clear();
      }
      return fetchImpl(input, options);
    },
    dispose: clear,
  };
}
