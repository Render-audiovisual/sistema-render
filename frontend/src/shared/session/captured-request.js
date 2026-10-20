import { captureSessionBinding, sessionBindingMatches, sessionRequestOptions } from './session-binding.js';

export function isSessionFailure(error) {
  return ['BrowserSessionError', 'BrowserSessionControllerError', 'ApplicationSessionError'].includes(error?.name)
    || error?.code === 'session_binding_obsolete';
}
const obsolete = () => Object.assign(new Error('La sesión cambió. Volvé a verificar antes de continuar.'), { code: 'session_binding_obsolete' });

// Capture once at the user action, before queueing or reading a file. Never
// infer the actor again when a retry or a later chunk is finally dispatched.
export function createCapturedRequest({ session, readSession, request, isActive = () => true }) {
  const binding = captureSessionBinding(session);
  const current = () => {
    try { return Boolean(isActive() && sessionBindingMatches(binding, readSession())); }
    catch { return false; }
  };
  const assertCurrent = () => { if (!current()) throw obsolete(); };
  return Object.freeze({ current, assertCurrent,
    options(options = {}) { assertCurrent(); return sessionRequestOptions(binding, options); },
    async request(url, options = {}) {
      assertCurrent();
      try {
        const result = await request(url, sessionRequestOptions(binding, options));
        assertCurrent(); return result;
      } catch (error) { assertCurrent(); throw error; }
    },
  });
}
