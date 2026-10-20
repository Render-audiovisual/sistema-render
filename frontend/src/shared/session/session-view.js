import { captureSessionBinding } from './session-binding.js';

const cookieViews = new WeakMap();
let serial = 0;
function viewKey(binding, session) {
  if (!binding) return null;
  if (binding.mode === 'cookie') {
    if (!cookieViews.has(session)) cookieViews.set(session, `cookie-observation:${++serial}`);
    return cookieViews.get(session);
  }
  // Legacy-only private render key, as before. Never render/log it or persist it.
  return JSON.stringify(['bearer', typeof binding.id, binding.id, binding.role, typeof binding.active, binding.active, binding.token]);
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
