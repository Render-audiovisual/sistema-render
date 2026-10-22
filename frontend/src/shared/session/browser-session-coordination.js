export const BROWSER_SESSION_CHANNEL = 'render:browser-session-hints:v1';

function validHint(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === 1 && keys[0] === 'reason'
    && ['login', 'logout'].includes(value.reason);
}

// Document-owned advisory transport only. A hint can withdraw authority, never
// establish it. The runtime owns cancellation, observation and Web Locks.
export function createBrowserSessionCoordination({ createChannel = name =>
  typeof globalThis.BroadcastChannel === 'function' ? new globalThis.BroadcastChannel(name) : null } = {}) {
  const listeners = new Set();
  let channel = null, attempted = false, disposed = false;
  const receive = event => {
    if (disposed || !validHint(event.data)) return;
    const hint = Object.freeze({ reason: event.data.reason });
    for (const listener of [...listeners]) {
      if (disposed) break;
      if (!listeners.has(listener)) continue;
      try { listener(hint); } catch { /* Observers cannot interrupt invalidation peers. */ }
    }
  };
  function open() {
    if (attempted || disposed) return;
    attempted = true;
    let candidate;
    try {
      candidate = createChannel(BROWSER_SESSION_CHANNEL);
      if (!candidate) return;
      candidate.addEventListener('message', receive);
      channel = candidate;
    } catch {
      try { candidate?.close(); } catch { /* Unavailable transport has no identity fallback. */ }
    }
  }
  return Object.freeze({
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Invalid session hint listener');
      if (disposed) return () => {};
      listeners.add(listener); open();
      return () => listeners.delete(listener);
    },
    notifyChange(hint) {
      if (!validHint(hint)) throw new TypeError('Invalid session hint');
      if (disposed) return;
      open();
      try { channel?.postMessage({ reason: hint.reason }); } catch { /* Best-effort hint, not logout proof. */ }
    },
    dispose() {
      if (disposed) return;
      disposed = true; listeners.clear();
      try { channel?.removeEventListener('message', receive); } catch { /* Still close below. */ }
      try { channel?.close(); } catch { /* No retained transport after disposal. */ }
      channel = null;
    },
  });
}
