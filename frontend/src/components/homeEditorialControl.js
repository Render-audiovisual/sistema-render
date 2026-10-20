export const EDITORIAL_BUCKETS = [
  { value: 'today', label: 'Hoy' }, { value: 'overdue', label: 'Atrasadas' },
  { value: 'blocked', label: 'Bloqueadas' }, { value: 'upcoming_ready', label: 'Próximas listas' },
];
export const EDITORIAL_LIMIT = 20;
const buckets = ['today', 'overdue', 'blocked', 'upcoming_ready'];
const roles = ['admin', 'diseno', 'edicion', 'produccion', 'community', 'programacion'];
const states = ['pendiente', 'en_diseño', 'en_edición', 'en_revision', 'en_revisión', 'lista', 'publicada', 'bloqueada', 'rechazada'];
const classifications = ['no_publicada', 'historica_sin_confirmacion', 'confirmada_manualmente'];
const id = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const count = value => Number.isSafeInteger(value) && value >= 0;
const validOffset = value => count(value) && value <= 1000000 && value % EDITORIAL_LIMIT === 0;
const invalid = () => { throw new Error('El control editorial recibido no es válido.'); };
function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const day = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value;
}
export function canReadEditorialControl(sesion) {
  return id(sesion?.usuario?.id) && roles.includes(sesion.usuario.rol) && sesion.usuario.activo !== false
    && typeof sesion.token === 'string' && sesion.token.length > 0;
}
function belongs(item, bucket, today) {
  const date = item.fecha_programada;
  if (bucket === 'today') return date === today;
  if (bucket === 'overdue') return date !== null && date < today && !['publicada', 'rechazada'].includes(item.estado);
  if (bucket === 'blocked') return item.estado === 'bloqueada';
  return item.estado === 'lista' && date !== null && date > today;
}
function compare(a, b) {
  const left = a.fecha_programada, right = b.fecha_programada;
  if (left !== right) return left === null ? 1 : right === null ? -1 : left < right ? -1 : 1;
  return a.domain === b.domain ? a.id - b.id : a.domain < b.domain ? -1 : 1;
}

export function parseHomeEditorialControl(value, { bucket = 'today', offset = 0 } = {}) {
  if (!buckets.includes(bucket) || !validOffset(offset) || value?.version !== 1 || !validDay(value.today)
    || value.bucket !== bucket || value.offset !== offset || value.limit !== EDITORIAL_LIMIT || !count(value.total)
    || typeof value.has_more !== 'boolean' || !Array.isArray(value.items)
    || value.items.length !== Math.min(EDITORIAL_LIMIT, Math.max(0, value.total - offset))
    || value.has_more !== (offset + value.items.length < value.total)) invalid();
  const summary = {};
  for (const key of buckets) {
    if (!count(value.summary?.[key])) invalid();
    summary[key] = value.summary[key];
  }
  if (summary[bucket] !== value.total) invalid();
  const keys = new Set();
  const items = value.items.map(item => {
    if (!item || !['historia', 'publicacion'].includes(item.domain) || !id(item.id)
      || typeof item.titulo !== 'string' || item.titulo.length > 160 || !states.includes(item.estado)
      || (item.domain === 'historia' ? item.tipo !== 'historia' : !['video', 'reel', 'carrusel', 'flyer'].includes(item.tipo))
      || !id(item.cliente?.id) || typeof item.cliente.nombre !== 'string' || item.cliente.nombre.length > 250
      || !(validDay(item.fecha_programada) || (item.fecha_programada === null && bucket === 'blocked'))
      || !classifications.includes(item.publication_classification) || !belongs(item, bucket, value.today)) invalid();
    const classification = item.publication_classification;
    if ((classification === 'confirmada_manualmente' && (item.estado !== 'publicada' || !validDay(item.fecha_programada)))
      || (classification === 'no_publicada' && item.estado === 'publicada')) invalid();
    // Historical actual dates may survive a later workflow state change; without
    // evidence fields the client cannot demand that historical means publicada.
    const key = `${item.domain}:${item.id}`;
    if (keys.has(key)) invalid(); keys.add(key);
    return { domain: item.domain, id: item.id, titulo: item.titulo, estado: item.estado, tipo: item.tipo,
      cliente: { id: item.cliente.id, nombre: item.cliente.nombre }, fecha_programada: item.fecha_programada,
      publication_classification: classification };
  });
  for (let index = 1; index < items.length; index++) if (compare(items[index - 1], items[index]) >= 0) invalid();
  for (const key of buckets) if (items.filter(item => belongs(item, key, value.today)).length > summary[key]) invalid();
  return { version: 1, today: value.today, bucket, offset, limit: EDITORIAL_LIMIT, total: value.total,
    has_more: value.has_more, summary, items };
}

/** Context only: these existing module routes do not promise piece selection. */
export function homeEditorialContextHref(item) {
  if (!item || !id(item.id) || !id(item.cliente?.id) || !validDay(item.fecha_programada)) return null;
  const month = item.fecha_programada.slice(0, 7), client = item.cliente.id;
  if (item.domain === 'historia') return `/planificacion-historias?vista=checklist&cliente=${client}&mes=${month}`;
  if (item.domain === 'publicacion') return `/planificacion-publicaciones?tab=calendario&cliente=${client}&mes=${month}`;
  return null;
}

export function createHomeEditorialLoader({ sesion, readSession, request, onChange, now = Date.now }) {
  const captured = { id: sesion?.usuario?.id, role: sesion?.usuario?.rol,
    active: sesion?.usuario?.activo, token: sesion?.token };
  let controller, generation = 0, disposed = false, inFlight = false, lastRequest = -Infinity;
  let selected = 'today', page = 0;
  const authorized = () => {
    const current = readSession();
    return canReadEditorialControl(current) && current.usuario.id === captured.id && current.usuario.rol === captured.role
      && current.usuario.activo === captured.active && current.token === captured.token;
  };
  const publish = (status, data = null, error = '') => onChange({ status, data, error, bucket: selected, offset: page });
  const sessionError = () => publish('error', null, 'La sesión cambió. Volvé a iniciar sesión.');
  async function refresh({ bucket = selected, offset, background = false } = {}) {
    if (disposed) return false;
    if (!authorized()) { controller?.abort(); ++generation; inFlight = false; sessionError(); return false; }
    if (!buckets.includes(bucket) || (offset !== undefined && !validOffset(offset))) throw new Error('Cola o página editorial no válida.');
    const nextPage = bucket !== selected ? 0 : offset ?? page;
    if (background && (inFlight || now() - lastRequest < 30000)) return false;
    controller?.abort(); controller = new AbortController();
    const signal = controller.signal, version = ++generation;
    selected = bucket; page = nextPage; lastRequest = now(); inFlight = true;
    publish('loading');
    const stale = () => disposed || signal.aborted || version !== generation;
    try {
      const value = await request(`/api/editorial-control?bucket=${bucket}&offset=${nextPage}&limit=${EDITORIAL_LIMIT}`, { method: 'GET', signal });
      if (stale()) return false;
      if (!authorized()) { sessionError(); return false; }
      publish('ready', parseHomeEditorialControl(value, { bucket, offset: nextPage }));
    } catch {
      if (stale()) return false;
      if (!authorized()) { sessionError(); return false; }
      publish('error', null, 'No pudimos cargar el control editorial. Reintentá.');
    } finally { if (version === generation) inFlight = false; }
    return true;
  }
  return { refresh, dispose() { disposed = true; ++generation; controller?.abort(); } };
}
