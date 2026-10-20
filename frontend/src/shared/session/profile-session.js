import { parseServerIdentity } from './current-session.js';
import { captureSessionBinding, sessionBindingMatches, sessionRequestOptions } from './session-binding.js';

export function profileFailureMessage(error) {
  if (error?.code === 'current_password_invalid') return 'La contraseña actual es incorrecta.';
  if (['No se pudo leer la imagen.', 'No se pudo leer el archivo.'].includes(error?.message)) return error.message;
  // A lost response is not evidence that a write failed or was rolled back.
  return 'No pudimos confirmar el cambio. Volvé a verificar tu perfil antes de reintentar.';
}

// Presentation/session continuity only; server authentication remains authoritative.
export function captureProfileSession(session) {
  const user = parseServerIdentity(session?.usuario);
  return user ? captureSessionBinding(session) : null;
}

export function createProfileSessionGuard({ session, readSession, isMounted, save, clear, navigate, runtime }) {
  const captured = captureProfileSession(session);
  const current = () => {
    if (!captured || !isMounted()) return null;
    try {
      const live = readSession();
      return sessionBindingMatches(captured, live) ? live : null;
    } catch { return null; }
  };
  return {
    current: () => Boolean(current()),
    headers: () => current() ? sessionRequestOptions(captured, { headers: { 'Content-Type': 'application/json' } }).headers : null,
    async request(request, url, options = {}) {
      if (!current()) return undefined;
      try {
        const response = await request(url, sessionRequestOptions(captured, options));
        return current() ? response : undefined;
      } catch (error) { if (current()) throw error; return undefined; }
    },
    applyPhoto(value) {
      const identity = parseServerIdentity(value);
      if (!identity || identity.id !== captured?.id || identity.rol !== captured.role
        || (Object.hasOwn(identity, 'activo') && identity.activo !== true)
        || !(identity.foto_perfil === null || typeof identity.foto_perfil === 'string')) throw new Error('La respuesta de perfil no es válida.');
      const live = current();
      if (!live) return null;
      if (captured.mode === 'cookie') {
        if (runtime?.mode !== 'browser' || runtime.getSession() !== live || typeof runtime.refreshProfile !== 'function')
          throw new Error('No se pudo volver a verificar tu perfil.');
        // Never manufacture a cookie DTO from the mutation response. Reobserve
        // the server under the original intent; the root owns the new snapshot.
        return runtime.refreshProfile(captured.intent).then(result => {
          const verified = result?.ok === true ? result.session : null;
          if (!verified || !captureSessionBinding(verified) || runtime.getSession() !== verified || verified.usuario.id !== captured.id
            || verified.usuario.rol !== captured.role || verified.session_context !== captured.context
            || verified.csrf_token !== captured.csrf) return null;
          return verified.usuario;
        });
      }
      const user = { ...live.usuario, ...identity, foto_perfil: identity.foto_perfil || '' };
      save(captured.token, user);
      return user;
    },
    requireReauthentication() {
      if (!current()) return false;
      if (captured.mode === 'cookie') {
        const previousRevision = runtime?.getSnapshot?.().revision;
        if (runtime?.mode !== 'browser' || runtime.getSession() !== captured.intent.session
          || typeof runtime.invalidateSession !== 'function' || !runtime.invalidateSession(captured.intent)) return false;
        const next = runtime.getSnapshot();
        if (next.status === 'anonymous' && next.revision === previousRevision + 1) navigate('/login');
        return true;
      }
      clear('render_sesion');
      navigate('/login');
      return true;
    },
  };
}
