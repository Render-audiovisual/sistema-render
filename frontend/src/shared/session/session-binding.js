import { captureBrowserSessionIntent, isBrowserSessionIntentCurrent } from './browser-session-state.js';

const bindings = new WeakSet();
const validId = id => Number.isSafeInteger(id) && id > 0 || typeof id === 'string' && Boolean(id.trim());
const hasCookieFields = session => session && (Object.hasOwn(session, 'session_context') || Object.hasOwn(session, 'csrf_token'));
const denied = () => Object.assign(new Error('La sesión cambió. Conservá tus cambios y volvé a verificarla.'), { code: 'session_binding_obsolete' });

// Migration adapter, not authentication. No synthetic token property is added
// to cookie sessions; legacy bearer is retained only for not-yet-cut-over callers.
export function captureSessionBinding(session) {
  const user = session?.usuario;
  if (!validId(user?.id) || typeof user?.rol !== 'string' || !user.rol.trim() || user.activo === false) return null;
  let binding;
  const identity = { id: user.id, role: user.rol, active: user.activo };
  if (hasCookieFields(session)) {
    if (Object.hasOwn(session, 'token')) return null;
    const intent = captureBrowserSessionIntent(session);
    if (!intent) return null;
    binding = { ...identity, mode: 'cookie', intent, context: session.session_context, csrf: session.csrf_token };
  } else {
    if (typeof session?.token !== 'string' || !session.token.trim()) return null;
    binding = { ...identity, mode: 'bearer', token: session.token };
  }
  Object.freeze(binding); bindings.add(binding); return binding;
}

export function sessionBindingMatches(binding, live) {
  if (!binding || !bindings.has(binding) || live?.usuario?.id !== binding.id || live.usuario.rol !== binding.role
    || live.usuario.activo !== binding.active || live.usuario.activo === false) return false;
  return binding.mode === 'cookie'
    ? live === binding.intent.session && !Object.hasOwn(live, 'token') && isBrowserSessionIntentCurrent(binding.intent)
    : !hasCookieFields(live) && live.token === binding.token;
}

export function sessionRequestOptions(binding, options = {}) {
  if (!binding || !bindings.has(binding)) throw denied();
  const headers = new Headers(options.headers || {});
  if (binding.mode === 'cookie') {
    if (!isBrowserSessionIntentCurrent(binding.intent) || headers.has('Authorization')
      || options.sessionIntent !== undefined && (!isBrowserSessionIntentCurrent(options.sessionIntent)
        || options.sessionIntent.session !== binding.intent.session || options.sessionIntent.revision !== binding.intent.revision)) throw denied();
    for (const [name, value] of [['X-Render-Session-Context', binding.context], ['X-Render-CSRF', binding.csrf]]) {
      if (headers.has(name) && headers.get(name) !== value) throw denied();
      headers.set(name, value);
    }
  } else {
    if (headers.has('X-Render-Session-Context') || headers.has('X-Render-CSRF') || options.sessionIntent !== undefined
      || headers.has('Authorization') && headers.get('Authorization') !== `Bearer ${binding.token}`) throw denied();
    headers.set('Authorization', `Bearer ${binding.token}`);
  }
  const canonical = { authorization: 'Authorization', 'content-type': 'Content-Type',
    'x-render-session-context': 'X-Render-Session-Context', 'x-render-csrf': 'X-Render-CSRF' };
  return { ...options, headers: Object.fromEntries([...headers].map(([name, value]) => [canonical[name] || name, value])),
    ...(binding.mode === 'cookie' ? { sessionIntent: options.sessionIntent ?? binding.intent } : {}) };
}
