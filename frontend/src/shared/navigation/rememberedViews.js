// Presentation preferences only. Caller owns live identity and storage access;
// these values never authorize a request or restore a selected resource.
const positiveId = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const numericId = value => /^[1-9][0-9]*$/.test(value) && positiveId(Number(value));
const oneOf = (...values) => value => values.includes(value);
const month = value => /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value);
function day(value) {
  if (!/^(?!0000)\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) return false;
  const date = new Date(0);
  date.setUTCFullYear(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  return date.toISOString().slice(0, 10) === value;
}
// Closed values from task-view-state/constants, productionRouteContext,
// calendarModel and projectsModel. Deliberately not their permissive fallbacks.
const validators = {
  '/workspace/tareas': {
    view: oneOf('board', 'list', 'calendar', 'clients', 'responsibles'),
    mode: oneOf('active', 'trash'), month,
    estado: oneOf('all', 'pendiente', 'en_progreso', 'en_revision', 'aprobada', 'finalizada'),
    responsible: value => value === 'all' || value.startsWith('id:') && numericId(value.slice(3)),
    client: value => ['all', 'none'].includes(value) || numericId(value),
    sector: oneOf('all', 'none', 'diseno', 'edicion', 'produccion', 'community', 'administracion', 'desarrollo'),
    priority: oneOf('all', 'alta', 'media', 'baja'),
    area: oneOf('all', 'planificacion', 'carruseles', 'produccion', 'edicion', 'historias', 'web', 'desarrollo', 'chatbots', 'carteleria'),
    sort: oneOf('date', 'manual'), review_scope: oneOf('personal', 'team'),
    board_column: oneOf('pendiente', 'en_progreso', 'en_revision', 'aprobada', 'finalizadas'),
  },
  '/producciones': { mes: month, dia: day, cliente: numericId, tab: oneOf('calendar', 'pending') },
  '/calendario': {
    mes: value => month(value) && value !== '9999-12', dia: day,
    scope: oneOf('mine', 'team'), tipo: oneOf('all', 'tarea', 'visita', 'hito', 'programacion', 'publicacion'), cliente: numericId,
  },
  '/proyectos': {
    cliente: numericId, estado: oneOf('planificado', 'en_curso', 'en_revision', 'pausado', 'finalizado', 'cancelado'),
    archivados: oneOf('true', 'false'),
  },
  '/clientes': { periodo: month, cliente: numericId },
  '/reportes-historias': { periodo: oneOf('mes_actual', 'mes_pasado', 'ultimos_30') },
};
const owns = (value, key) => Object.hasOwn(value, key);
const size = value => new TextEncoder().encode(value).length;
const keyFor = (id, path) => `render:view:v1:${id}:${path}`;
function parseHref(href) {
  if (typeof href !== 'string' || /[\u0000-\u0020\u007f\\]/.test(href)) return null;
  const withoutHash = href.split('#')[0], index = withoutHash.indexOf('?');
  const path = index < 0 ? withoutHash : withoutHash.slice(0, index);
  if (!owns(validators, path)) return null;
  const query = index < 0 ? '' : withoutHash.slice(index + 1);
  // URLSearchParams replaces malformed encodings; never remember that repair.
  try { for (const part of query.split('&')) decodeURIComponent(part.replace(/\+/g, ' ')); } catch { return null; }
  return { path, query };
}
function sanitize(path, query, strict) {
  const params = new URLSearchParams(query), allowed = validators[path], result = new URLSearchParams();
  for (const key of params.keys()) {
    if (!owns(allowed, key)) { if (strict) return null; continue; }
    if (params.getAll(key).length !== 1) return null;
    const value = params.get(key);
    if (!allowed[key](value)) { if (strict) return null; continue; }
    result.set(key, value);
  }
  if (result.has('dia') && result.has('mes') && result.get('dia').slice(0, 7) !== result.get('mes')) {
    if (strict) return null;
    result.delete('dia');
  }
  result.sort();
  return result.toString();
}

export function saveRememberedView(storage, userId, href) {
  try {
    if (!positiveId(userId)) return false;
    const parsed = parseHref(href); if (!parsed) return false;
    // Administrative client management shares a pathname, not a view. Never
    // let that explicit mode replace the operational goals preference.
    if (parsed.path === '/clientes' && new URLSearchParams(parsed.query).has('gestion')) return false;
    const query = sanitize(parsed.path, parsed.query, false); if (query === null) return false;
    const record = JSON.stringify({ version: 1, path: parsed.path, query });
    if (size(record) > 4096) return false;
    storage.setItem(keyFor(userId, parsed.path), record);
    return true;
  } catch { return false; }
}

export function readRememberedView(storage, userId, href) {
  try {
    // Even an empty explicit ? or # must win over remembered preferences.
    if (!positiveId(userId) || typeof href !== 'string' || !owns(validators, href)) return href;
    const raw = storage.getItem(keyFor(userId, href));
    if (typeof raw !== 'string' || size(raw) > 4096) return href;
    const record = JSON.parse(raw);
    if (!record || Array.isArray(record) || Object.keys(record).length !== 3
      || !['version', 'path', 'query'].every(key => owns(record, key))
      || record.version !== 1 || record.path !== href || typeof record.query !== 'string') return href;
    const query = sanitize(href, record.query, true);
    return query ? `${href}?${query}` : href;
  } catch { return href; }
}
