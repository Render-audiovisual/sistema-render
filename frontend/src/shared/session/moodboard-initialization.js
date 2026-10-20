import { captureSessionBinding, sessionBindingMatches, sessionRequestOptions } from './session-binding.js';

// Explicit click only. No automatic initialization on mount or retry after an
// identity change. The same captured credential accompanies both requests.
export function createMoodboardInitialization({ session, readSession, isMounted, fetchImpl, signal }) {
  const captured = captureSessionBinding(session);
  const current = () => {
    try {
      const live = readSession();
      return Boolean(isMounted() && sessionBindingMatches(captured, live));
    } catch { return false; }
  };
  async function request(url, options = {}) {
    const result = await fetchImpl(url, sessionRequestOptions(captured, { ...options, signal, cache: 'no-store', redirect: 'error',
      headers: { 'Content-Type': 'application/json' } }));
    if (!current()) return null;
    const body = await result.json();
    if (!current()) return null;
    if (!result.ok) throw new Error('No se pudieron preparar los moodboards. Volvé a cargar para comprobar el estado.');
    return body;
  }
  return {
    current,
    async run() {
      if (!current()) return null;
      const confirmation = await request('/api/moodboards/boards/initialize', { method: 'POST', body: '{}' });
      if (!current()) return null;
      if (confirmation?.ok !== true) throw new Error('No se pudo confirmar la preparación de moodboards.');
      const boards = await request('/api/moodboards/boards');
      if (!current()) return null;
      if (!Array.isArray(boards)) throw new Error('La lista de moodboards no es válida.');
      return boards;
    },
  };
}
