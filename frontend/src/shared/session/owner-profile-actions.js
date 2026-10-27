import { captureBrowserSessionIntent } from './browser-session-state.js';
import { ownerProfileCapability } from './owner-profiles.js';

// Component actions carry the exact observed session, never a selected user ID.
export function createOwnerProfileActions({ getRuntime, readSnapshot, onState = () => {} }) {
  let pending = null, disposed = false;
  return Object.freeze({
    async change(profile, expected) {
      if (disposed || pending || readSnapshot() !== expected || expected?.status !== 'authenticated') return false;
      const runtime = getRuntime(), session = expected.session, capability = ownerProfileCapability(session);
      const intent = captureBrowserSessionIntent(session);
      if (runtime?.mode !== 'browser' || runtime.getSession() !== session || typeof runtime.changeProfile !== 'function'
        || !intent || !capability?.profiles.some(item => item.key === profile)) return false;
      const held = {}; pending = held;
      onState({ busy: true, error: null });
      try {
        const result = await runtime.changeProfile({ profile, sessionIntent: intent });
        if (disposed || pending !== held || getRuntime() !== runtime) return false;
        return result?.ok === true && runtime.getSession() === result.session;
      } catch {
        // After uncertain cookie writes the runtime owns re-verification. A
        // stale component must not repaint another authenticated actor's error.
        if (!disposed && pending === held && getRuntime() === runtime && readSnapshot() === expected)
          onState({ busy: false, error: 'No se pudo cambiar el perfil. Volvé a verificar la sesión.' });
        return false;
      } finally {
        if (pending === held) { pending = null; if (!disposed) onState({ busy: false }); }
      }
    },
    dispose() { disposed = true; pending = null; },
  });
}
