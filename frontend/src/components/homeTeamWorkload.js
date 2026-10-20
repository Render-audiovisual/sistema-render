import { canReadHomeEscalations } from './homeEscalations.js';
import { captureSessionBinding, sessionBindingMatches, sessionRequestOptions } from '../shared/session/session-binding.js';

export const TEAM_LIMIT = 20;
const count = n => Number.isSafeInteger(n) && n >= 0;
const invalid = () => { throw new Error('El resumen del equipo no es válido.'); };
export function parseHomeTeamWorkload(value, offset = 0) {
  if (!count(offset) || offset > 1000000 || offset % TEAM_LIMIT || value?.version !== 1
    || value.offset !== offset || value.limit !== TEAM_LIMIT || !count(value.total_tasks)
    || !count(value.total_overdue) || value.total_overdue > value.total_tasks || !count(value.total_people)
    || !Array.isArray(value.items) || value.items.length !== Math.min(TEAM_LIMIT, Math.max(0, value.total_people - offset))
    || value.has_more !== (offset + value.items.length < value.total_people)
    || typeof value.today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.today)) invalid();
  const day = new Date(`${value.today}T12:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.today) invalid();
  const counts = item => {
    if (!item || !count(item.open) || !count(item.overdue) || item.overdue > item.open) invalid();
    return { open: item.open, overdue: item.overdue };
  };
  const unassigned = counts(value.unassigned);
  if (unassigned.open > value.total_tasks || unassigned.overdue > value.total_overdue) invalid();
  const ids = new Set();
  const items = value.items.map(item => {
    const countsValue = counts(item), user = item.user;
    if (!user || !Number.isSafeInteger(user.id) || user.id < 1 || user.id > 2147483647 || ids.has(user.id)
      || typeof user.nombre !== 'string' || typeof user.activo !== 'boolean'
      || !countsValue.open || countsValue.open > value.total_tasks || countsValue.overdue > value.total_overdue
      || !count(item.review) || !count(item.approved) || item.review + item.approved > item.open) invalid();
    ids.add(user.id);
    return { user: { id: user.id, nombre: user.nombre, activo: user.activo }, ...countsValue,
      review: item.review, approved: item.approved };
  });
  for (let i = 1; i < items.length; i++) {
    const a = items[i - 1], b = items[i];
    if (a.overdue < b.overdue || (a.overdue === b.overdue && (a.open < b.open
      || (a.open === b.open && a.user.id > b.user.id)))) invalid();
  }
  return { version: 1, today: value.today, offset, limit: TEAM_LIMIT, total_tasks: value.total_tasks,
    total_overdue: value.total_overdue, total_people: value.total_people, has_more: value.has_more, unassigned, items };
}

export const homeTeamTaskHref = id => Number.isSafeInteger(id) && id > 0 && id <= 2147483647
  ? `/workspace/tareas?responsible=id%3A${id}` : null;

// Capture the whole session, not a name or local role selector. Late responses
// must never repaint data after logout, a token change or a superseding page.
export function createHomeTeamLoader({ sesion, readSession, request, onChange, now = Date.now }) {
  const captured = captureSessionBinding(sesion);
  let controller, generation = 0, disposed = false, inFlight = false, lastRequest = -Infinity, page = 0;
  const authorized = () => {
    const current = readSession();
    return canReadHomeEscalations(current) && sessionBindingMatches(captured, current);
  };
  const sessionError = () => onChange({ status: 'error', data: null, error: 'La sesión cambió. Volvé a iniciar sesión.' });
  async function refresh({ offset = page, background = false } = {}) {
    if (disposed) return false;
    if (!authorized()) { controller?.abort(); ++generation; inFlight = false; sessionError(); return false; }
    if (!count(offset) || offset > 1000000 || offset % TEAM_LIMIT) throw new Error('Página no válida.');
    if (background && (inFlight || now() - lastRequest < 30000)) return false;
    controller?.abort(); controller = new AbortController();
    const signal = controller.signal, version = ++generation;
    page = offset; lastRequest = now(); inFlight = true;
    onChange({ status: 'loading', data: null, error: '' });
    const stale = () => disposed || signal.aborted || version !== generation;
    try {
      const value = await request(`/api/inicio/equipo?offset=${offset}&limit=${TEAM_LIMIT}`, sessionRequestOptions(captured, { method: 'GET', signal }));
      if (stale()) return false;
      if (!authorized()) { sessionError(); return false; }
      onChange({ status: 'ready', data: parseHomeTeamWorkload(value, offset), error: '' });
    } catch {
      if (stale()) return false;
      if (!authorized()) { sessionError(); return false; }
      onChange({ status: 'error', data: null, error: 'No pudimos cargar el trabajo del equipo. Reintentá.' });
    } finally { if (version === generation) inFlight = false; }
    return true;
  }
  return { refresh, dispose() { disposed = true; ++generation; controller?.abort(); } };
}
