const positive = value => Number.isSafeInteger(value) && value > 0;
const count = value => Number.isSafeInteger(value) && value >= 0;
export const ESCALATIONS_LIMIT = 20;
export function canReadHomeEscalations(sesion) {
  return positive(sesion?.usuario?.id) && sesion.usuario.rol === 'admin'
    && sesion.usuario.activo !== false && typeof sesion.token === 'string' && sesion.token.length > 0;
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const instant = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === value;
}
const invalid = () => { throw new Error('La respuesta de escalaciones no es válida.'); };
export function parseHomeEscalations(value, offset = 0) {
  if (!count(offset) || offset % ESCALATIONS_LIMIT !== 0 || value?.version !== 1
    || value.offset !== offset || value.limit !== ESCALATIONS_LIMIT || !count(value.total)
    || typeof value.has_more !== 'boolean' || !Array.isArray(value.items)
    || value.items.length !== Math.min(ESCALATIONS_LIMIT, Math.max(0, value.total - offset))
    || value.has_more !== (offset + value.items.length < value.total)) invalid();
  const ids = new Set();
  const items = value.items.map(item => {
    if (!item || !positive(item.id) || ids.has(item.id) || !positive(item.revision)
      || typeof item.titulo !== 'string' || typeof item.estado !== 'string' || typeof item.prioridad !== 'string'
      || !(item.fecha_vencimiento === null || validDate(item.fecha_vencimiento))
      || item.href !== `/workspace/tareas?task=${item.id}`) invalid();
    ids.add(item.id);
    const client = item.cliente;
    if (client !== null && (!client || !positive(client.id) || typeof client.nombre !== 'string')) invalid();
    return { id: item.id, titulo: item.titulo, estado: item.estado, prioridad: item.prioridad,
      revision: item.revision, fecha_vencimiento: item.fecha_vencimiento,
      cliente: client === null ? null : { id: client.id, nombre: client.nombre }, href: item.href };
  });
  return { version: 1, offset, limit: ESCALATIONS_LIMIT, total: value.total, has_more: value.has_more, items };
}

// Each instance belongs to one captured session; neither late success nor failure
// may publish after identity changes, even when transport ignores AbortSignal.
export function createHomeEscalationsLoader({ sesion, readSession, request, onChange, now = Date.now }) {
  const identity = { id: sesion?.usuario?.id, role: sesion?.usuario?.rol,
    active: sesion?.usuario?.activo, token: sesion?.token };
  let controller, generation = 0, disposed = false, inFlight = false, lastRequest = -Infinity, page = 0;
  const authorized = () => {
    const current = readSession();
    return canReadHomeEscalations(current) && current.usuario.id === identity.id
      && current.usuario.rol === identity.role && current.usuario.activo === identity.active && current.token === identity.token;
  };
  async function refresh({ offset = page, background = false } = {}) {
    if (disposed) return false;
    if (!authorized()) {
      controller?.abort(); ++generation; inFlight = false;
      onChange({ status: 'error', data: null, error: 'La sesión cambió. Volvé a iniciar sesión.' });
      return false;
    }
    if (!count(offset) || offset % ESCALATIONS_LIMIT !== 0) throw new Error('Página no válida.');
    if (background && (inFlight || now() - lastRequest < 30000)) return false;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal, version = ++generation;
    page = offset; lastRequest = now(); inFlight = true;
    onChange({ status: 'loading', data: null, error: '' });
    const stale = () => disposed || signal.aborted || version !== generation;
    try {
      const value = await request(`/api/inicio/escalaciones?offset=${offset}&limit=20`, { method: 'GET', signal });
      if (stale()) return false;
      if (!authorized()) { onChange({ status: 'error', data: null, error: 'La sesión cambió. Volvé a iniciar sesión.' }); return false; }
      onChange({ status: 'ready', data: parseHomeEscalations(value, offset), error: '' });
    } catch {
      if (stale()) return false;
      onChange({ status: 'error', data: null, error: authorized()
        ? 'No pudimos cargar las escaladas a dirección. Reintentá.' : 'La sesión cambió. Volvé a iniciar sesión.' });
    } finally { if (version === generation) inFlight = false; }
    return true;
  }
  return { refresh, dispose() { disposed = true; ++generation; controller?.abort(); } };
}
