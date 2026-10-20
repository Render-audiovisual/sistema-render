export const PRODUCTION_PAGE_LIMIT = 20;
const count = n => Number.isSafeInteger(n) && n >= 0;
const positive = n => Number.isSafeInteger(n) && n > 0;
const invalid = () => { throw new Error('La página de producción no es válida.'); };
export function parseHomeProductionPage(value, { userId, period, offset }) {
  if (!positive(userId) || typeof period !== 'string' || !/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(period)
    || !count(offset) || offset > 1000000 || offset % PRODUCTION_PAGE_LIMIT
    || value?.version !== 1 || value.user?.id !== userId || value.period !== period
    || value.offset !== offset || value.limit !== PRODUCTION_PAGE_LIMIT
    || !count(value.total) || !count(value.completed) || value.completed > value.total
    || !count(value.client_count) || value.client_count > value.total
    || !Array.isArray(value.clients) || value.clients.length !== Math.min(PRODUCTION_PAGE_LIMIT, Math.max(0, value.client_count - offset))
    || value.has_more !== (value.client_count > offset + PRODUCTION_PAGE_LIMIT)
    || typeof value.today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.today)) invalid();
  const day = new Date(`${value.today}T12:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.today) invalid();
  const seen = new Set(); let previous, total = 0, completed = 0;
  const clients = value.clients.map(row => {
    const c = row?.client;
    if (!row || !(c === null || (c && positive(c.id) && typeof c.nombre === 'string'))
      || !positive(row.total) || !count(row.completed) || row.completed > row.total) invalid();
    const key = c?.id ?? null, order = key === null ? Infinity : key;
    if (seen.has(key) || (previous && (row.total > previous.total || (row.total === previous.total && order <= previous.order)))) invalid();
    seen.add(key); previous = { total: row.total, order };
    total += row.total; completed += row.completed;
    if (!count(total) || !count(completed)) invalid();
    return { client: c === null ? null : { id: c.id, nombre: c.nombre }, total: row.total, completed: row.completed };
  });
  const missing = value.client_count - clients.length;
  if (total > value.total || completed > value.completed || value.total - total < missing
    || value.completed - completed > value.total - total
    || (!missing && (total !== value.total || completed !== value.completed))) invalid();
  return { version: 1, user: { id: userId }, period, today: value.today, offset, limit: PRODUCTION_PAGE_LIMIT,
    total: value.total, completed: value.completed, client_count: value.client_count, has_more: value.has_more, clients };
}

export function createHomeProductionPageLoader({ sesion, period, readSession, request, onChange }) {
  const captured = { id: sesion?.usuario?.id, role: sesion?.usuario?.rol, active: sesion?.usuario?.activo, token: sesion?.token };
  let controller, generation = 0, disposed = false, page = 0;
  const authorized = () => {
    const current = readSession();
    return positive(captured.id) && typeof captured.token === 'string' && captured.token.length > 0
      && captured.active !== false && ['admin','diseno','produccion','edicion','community','programacion'].includes(captured.role)
      && current?.usuario?.id === captured.id && current.usuario.rol === captured.role
      && current.usuario.activo === captured.active && current.token === captured.token;
  };
  async function refresh({ offset = page } = {}) {
    if (disposed) return false;
    if (!authorized()) { controller?.abort(); ++generation; onChange({ status: 'error', data: null, error: 'La sesión cambió. Volvé a iniciar sesión.' }); return false; }
    if (!count(offset) || offset > 1000000 || offset % PRODUCTION_PAGE_LIMIT) throw new Error('Página no válida.');
    controller?.abort(); controller = new AbortController();
    const signal = controller.signal, version = ++generation; page = offset;
    onChange({ status: 'loading', data: null, error: '' });
    const stale = () => disposed || signal.aborted || generation !== version;
    try {
      const value = await request(`/api/inicio/produccion-mensual?period=${encodeURIComponent(period)}&offset=${offset}&limit=${PRODUCTION_PAGE_LIMIT}`, { method: 'GET', signal });
      if (stale()) return false;
      if (!authorized()) throw new Error('Session changed');
      onChange({ status: 'ready', data: parseHomeProductionPage(value, { userId: captured.id, period, offset }), error: '' });
    } catch {
      if (stale()) return false;
      onChange({ status: 'error', data: null, error: authorized()
        ? 'No pudimos cargar estos clientes. Reintentá o volvé a la primera página.' : 'La sesión cambió. Volvé a iniciar sesión.' });
    }
    return true;
  }
  return { refresh, dispose() { disposed = true; ++generation; controller?.abort(); } };
}
