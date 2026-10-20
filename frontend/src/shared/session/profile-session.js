import { parseServerIdentity } from './current-session.js';

// Presentation/session continuity only; server authentication remains authoritative.
export function captureProfileSession(session) {
  const user = parseServerIdentity(session?.usuario);
  if (!user || typeof session?.token !== 'string' || !session.token.trim()) return null;
  return { id: user.id, role: user.rol, token: session.token };
}

export function createProfileSessionGuard({ session, readSession, isMounted, save, clear, navigate }) {
  const captured = captureProfileSession(session);
  const current = () => {
    if (!captured || !isMounted()) return null;
    try {
      const live = readSession();
      return live?.usuario?.id === captured.id && live.usuario.rol === captured.role
        && live.token === captured.token && live.usuario.activo !== false ? live : null;
    } catch { return null; }
  };
  return {
    current: () => Boolean(current()),
    headers: () => current() ? { 'Content-Type': 'application/json', Authorization: `Bearer ${captured.token}` } : null,
    applyPhoto(value) {
      const identity = parseServerIdentity(value);
      if (!identity || identity.id !== captured?.id || identity.rol !== captured.role
        || (Object.hasOwn(identity, 'activo') && identity.activo !== true)
        || !(identity.foto_perfil === null || typeof identity.foto_perfil === 'string')) throw new Error('La respuesta de perfil no es válida.');
      const live = current();
      if (!live) return null;
      const user = { ...live.usuario, ...identity, foto_perfil: identity.foto_perfil || '' };
      save(captured.token, user);
      return user;
    },
    requireReauthentication() {
      if (!current()) return false;
      clear('render_sesion');
      navigate('/login');
      return true;
    },
  };
}
