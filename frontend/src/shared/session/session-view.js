import { captureSessionBinding } from './session-binding.js';

const cookieViews = new WeakMap();
let serial = 0;
let bearerObservation = null;
function viewKey(binding, session) {
  if (!binding) { bearerObservation = null; return null; }
  if (binding.mode === 'cookie') {
    bearerObservation = null;
    if (!cookieViews.has(session)) cookieViews.set(session, `cookie-observation:${++serial}`);
    return cookieViews.get(session);
  }
  // Keys can appear in React diagnostics. Keep only the current comparison in
  // memory and expose an opaque counter, never a serialized credential. Exact
  // clones remain stable; a changed/returned observation receives a new key.
  const previous = bearerObservation;
  if (!previous || previous.id !== binding.id || previous.role !== binding.role
    || previous.active !== binding.active || previous.token !== binding.token) {
    bearerObservation = { id: binding.id, role: binding.role, active: binding.active,
      token: binding.token, key: `bearer-observation:${++serial}` };
  }
  return bearerObservation.key;
}
export function sessionViewKey(session) { return viewKey(captureSessionBinding(session), session); }

export function sessionViewInputs(session) {
  const binding = captureSessionBinding(session);
  return { key: viewKey(binding, session), cookieSession: binding?.mode === 'cookie' ? session : null,
    id: binding?.id, role: binding?.role, active: binding?.active, token: binding?.mode === 'bearer' ? binding.token : null };
}
export function createSessionView({ key, cookieSession, id, role, active, token }) {
  // Reconstruct only the old primitive bearer shape. Cookie DTO ownership must
  // remain the exact observed object, never a lookalike or token placeholder.
  const session = cookieSession || (token ? Object.freeze({ token,
    usuario: Object.freeze({ id, rol: role, activo: active }) }) : null);
  return Object.freeze({ key, session, binding: captureSessionBinding(session), id, role, active });
}
