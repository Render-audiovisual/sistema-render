import { parseServerIdentity } from './current-session.js';

export const LOGIN_FAILURE_MESSAGE = 'No se pudo iniciar sesión. Verificá tus datos e intentá nuevamente.';

// Injected side effects; cleanup owns only this page's attempts, never the runtime.
export function createLoginAttempts({ getRuntime, request, readSession, save, navigate, onState }) {
  let mounted = false, generation = 0, pending = null;
  const legacyKey = () => {
    const value = readSession();
    return JSON.stringify([value?.token, value?.usuario?.id, value?.usuario?.rol]);
  };
  return {
    mount() { mounted = true; },
    cleanup() { mounted = false; generation++; pending?.abort(); pending = null; },
    async login(kind, input) {
      if (!mounted) return false;
      const number = ++generation;
      pending?.abort();
      const abort = new AbortController(); pending = abort;
      const runtime = getRuntime();
      const current = () => mounted && generation === number && !abort.signal.aborted && getRuntime() === runtime;
      const body = kind === 'password' ? { usuario: input.usuario, password: input.password }
        : kind === 'google' ? { credential: input.credential } : null;
      onState({ busy: true, error: null });
      try {
        if (!body) throw new Error();
        let user;
        if (runtime?.mode === 'browser') {
          const result = await runtime.login({ kind, body, signal: abort.signal });
          if (!current()) return false;
          if (result?.ok !== true || !result.session || runtime.getSession() !== result.session) throw new Error();
          user = parseServerIdentity(result.session.usuario);
        } else {
          const baseline = legacyKey();
          const response = await request(kind === 'password' ? '/api/login' : '/api/login/google', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body), signal: abort.signal,
          });
          if (!current() || legacyKey() !== baseline) return false;
          if (!response.ok) throw new Error();
          const data = await response.json();
          if (!current() || legacyKey() !== baseline) return false;
          user = parseServerIdentity(data?.usuario);
          if (!user || typeof data.token !== 'string' || !data.token.trim()) throw new Error();
          save(data.token, user);
        }
        if (!user || !current()) return false;
        navigate(user);
        return true;
      } catch {
        if (current()) onState({ busy: false, error: LOGIN_FAILURE_MESSAGE });
        return false;
      } finally {
        if (current()) { pending = null; onState({ busy: false }); }
      }
    },
  };
}
