import { isConfirmedPublication, isHistoricalPublication, confirmationDate, historicalPublicationDate } from '../editorial/publication-evidence.js';
import { productionResultStatus } from '../../pages/productionResultStatus.js';
import { effectiveTaskFilterState } from '../../features/render-os/utils/task-view-state.js';

// Report-only projections. Never resolve identities from names or inspect finance metadata.
const personId = value => Number.isSafeInteger(value) && value > 0;
const recordId = value => (typeof value === 'string' && value.trim()) || personId(value);
const array = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' ? value : '';
export function reportParticipantLabel(person) {
  if(!personId(person?.id)||person.id>2147483647)return 'Sin identidad verificable';
  const fallback=`Usuario #${person.id}`, name=text(person.nombre).trim();
  return !name||name===fallback ? fallback : `${name} · #${person.id}`;
}
const quantity = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0;
const finalized = task => ['finalizada', 'publicada'].includes(task.estado);
const hiddenReportTask = task => task.propiedades_extra?.archivada_render_os === true
  || (task.propiedades_extra?.workspace === 'render_os' && [true, 'true'].includes(task.propiedades_extra?.papelera_render_os));
const scopedReportTasks = (tasks, range) => uniqueReportTasks(tasks).filter(task => !hiddenReportTask(task)
  && inReportRange(task.fecha_vencimiento || task.propiedades_extra?.finalizada_at || task.updated_at, range));
export const inReportRange = (date, range) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date)
  && date.slice(0, 10) >= range.desde && date.slice(0, 10) < range.hasta;

export function uniqueReportTasks(...sources) {
  const tasks = new Map();
  for (const task of sources.flatMap(array)) {
    if (personId(task?.id)) tasks.set(task.id, task);
  }
  return [...tasks.values()];
}

export function reportTaskPeople(task) {
  const editing = task.tipo_tarea === 'edicion' || /edicion|editar/.test(`${text(task.subtipo)} ${text(task.titulo)}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
  const editorCredit = editing ? task.propiedades_extra?.edicion_responsable_id : null;
  return [...new Set([task.asignado_a_id, ...array(task.colaborador_ids), editorCredit].filter(personId))];
}

export function buildEmployeeReport(users, tasks, range, today) {
  const people = new Map(array(users).filter(user => personId(user?.id)).map(user => [user.id, user]));
  const scoped = scopedReportTasks(tasks, range);
  const rows = [...people.values()].map(user => {
    const own = scoped.filter(task => reportTaskPeople(task).includes(user.id));
    return { id: user.id, nombre: text(user.nombre) || `Usuario #${user.id}`, rol: text(user.rol),
      total: own.length, enRevision: own.filter(task => effectiveTaskFilterState(task) === 'en_revision').length,
      aprobadas: own.filter(task => effectiveTaskFilterState(task) === 'aprobada').length,
      finalizadas: own.filter(finalized).length,
      pendientes: own.filter(task => !finalized(task)).length,
      vencidas: own.filter(task => !finalized(task) && task.fecha_vencimiento && task.fecha_vencimiento < today).length };
  });
  return { rows, uniqueTasks: scoped.length,
    unattributed: scoped.filter(task => !reportTaskPeople(task).some(id => people.has(id))).length };
}

export function buildProductionRegistryReport(payload, users, range) {
  const available = payload?.desde === range.desde && payload?.hasta === range.hasta && Array.isArray(payload?.visitas);
  const visits = array(payload?.visitas);
  // Exclude legacy sources using ALL supplied visits, even out of the visible range.
  const normalizedSourceIds = new Set(visits.filter(visit => array(visit.videos).length || array(visit.fotos).length)
    .map(visit => visit.tarea_origen_id).filter(personId));
  if (!available) return { available: false, clients: [], visits: 0, videos: 0, recorded: 0, photos: 0, realizedPhotos: 0, normalizedSourceIds };
  const names = new Map(array(users).filter(user => personId(user?.id)).map(user => [user.id, text(user.nombre) || `Usuario #${user.id}`]));
  const seenVisits = new Set(), seenVideos = new Set(), seenPhotos = new Set(), clients = new Map();
  for (const visit of visits) {
    if (!recordId(visit.id) || seenVisits.has(visit.id) || !inReportRange(visit.fecha, range)) continue;
    seenVisits.add(visit.id);
    const clientKey = personId(visit.cliente_id) ? visit.cliente_id : 'unassigned';
    if (!clients.has(clientKey)) clients.set(clientKey, { id: clientKey, nombre: text(visit.cliente_nombre) || 'Sin cliente', visits: [] });
    const media = (items, seen, fields) => array(items).filter(item => {
      if (!recordId(item?.id) || seen.has(item.id)) return false;
      seen.add(item.id); return true;
    }).map(item => Object.fromEntries(fields.map(field => [field, item[field]])));
    clients.get(clientKey).visits.push({ id: visit.id, fecha: visit.fecha, titulo: text(visit.titulo),
      resultado_estado: productionResultStatus(visit.ultimo_resultado, visit.revision),
      participants: [...new Set(array(visit.participante_ids).filter(personId))].map(id => ({ id, nombre: names.get(id) || `Usuario #${id}` })),
      videos: media(visit.videos, seenVideos, ['id', 'titulo', 'estado']),
      fotos: media(visit.fotos, seenPhotos, ['id', 'tipo', 'estado']) });
  }
  const result = [...clients.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const allVisits = result.flatMap(client => client.visits.sort((a, b) => a.fecha.localeCompare(b.fecha)));
  return { available: true, clients: result, visits: allVisits.length, videos: seenVideos.size,
    recorded: allVisits.flatMap(visit => visit.videos).filter(video => video.estado === 'grabado').length,
    photos: seenPhotos.size, realizedPhotos: allVisits.flatMap(visit => visit.fotos).filter(photo => photo.estado === 'realizada').length,
    normalizedSourceIds };
}

export function buildHistoricalProductionReport(tasks, normalizedSourceIds, range) {
  const clients = new Map();
  for (const task of uniqueReportTasks(tasks)) {
    // This DB-global flag also covers source visits rescheduled outside this DTO.
    if (task.produccion_registro_individual === true || normalizedSourceIds.has(task.id) || hiddenReportTask(task)) continue;
    const records = array(task.propiedades_extra?.produccion_registros);
    if (!records.length) continue;
    let recorded = 0;
    for (const record of records) {
      // Monthly allocations are not dated individual videos. Do not distribute
      // them across arbitrary rolling windows or infer a visit/media identity.
      const monthStart = `${range.desde.slice(0, 7)}-01`;
      const nextMonth = new Date(`${monthStart}T00:00:00Z`);
      nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
      const fullMonth = range.desde === monthStart && range.hasta === nextMonth.toISOString().slice(0, 10);
      if (record.periodo_adelanto || record.periodo_objetivo) {
        if (!fullMonth) continue;
        const month = range.desde.slice(0, 7);
        if (record.periodo_adelanto === month) recorded += quantity(record.cantidad_adelanto);
        else if ((record.periodo_objetivo || text(record.fecha).slice(0, 7)) === month) recorded += quantity(record.cantidad_mes_actual ?? record.cantidad);
      } else if (inReportRange(record.fecha, range)) recorded += quantity(record.cantidad_mes_actual ?? record.cantidad);
    }
    if (!recorded) continue;
    const key = personId(task.cliente_id) ? task.cliente_id : 'unassigned';
    if (!clients.has(key)) clients.set(key, { id: key, nombre: text(task.cliente_nombre) || 'Sin cliente', recorded: 0 });
    clients.get(key).recorded += recorded;
  }
  return [...clients.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

export function historicalUnassignedEditingCount(deliveries, range) {
  const seen = new Set();
  for (const delivery of array(deliveries)) {
    if (!recordId(delivery?.id) || personId(delivery.editor_id) || !inReportRange(delivery.fecha_entrega, range)) continue;
    seen.add(delivery.id);
  }
  return seen.size;
}

export function reportTaskFormat(task) {
  const words = `${text(task.subtipo)} ${text(task.titulo)}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (task.tipo_tarea === 'produccion') return 'otros';
  if (personId(task.historia_id) || /historia|flyer/.test(words)) return 'historias';
  if (/carrusel/.test(words)) return 'carruseles';
  if (['video', 'reel'].includes(task.pieza_tipo) || /\breel\b|\bvideo\b/.test(words)) return 'reels';
  return 'otros';
}

export function employeeTaskDetails(tasks, userId, range) {
  if (!personId(userId)) return [];
  return scopedReportTasks(tasks, range).filter(task => reportTaskPeople(task).includes(userId)).map(task => ({
    id: task.id, titulo: text(task.titulo) || `Tarea #${task.id}`, estado: text(effectiveTaskFilterState(task)),
    estado_almacenado: text(task.estado), formato: reportTaskFormat(task),
    fecha_entrega: text(task.fecha_vencimiento), actualizada: text(task.updated_at),
    finalizada: text(task.propiedades_extra?.finalizada_at),
    href: task.propiedades_extra?.workspace === 'render_os' ? `/workspace/tareas?task=${task.id}` : null,
  }));
}

export function employeeFormatBreakdown(tasks, userId, range) {
  const details = employeeTaskDetails(tasks, userId, range);
  return ['carruseles', 'reels', 'historias', 'otros'].map(formato => {
    const rows = details.filter(task => task.formato === formato);
    return { formato, total: rows.length, finalizadas: rows.filter(finalized).length,
      enRevision: rows.filter(task => task.estado === 'en_revision').length,
      aprobadas: rows.filter(task => task.estado === 'aprobada').length };
  });
}

function editorialDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(value)) return null;
  const day = value.slice(0, 10);
  const parsedDay = new Date(day + 'T00:00:00Z');
  if (!Number.isFinite(parsedDay.getTime()) || parsedDay.toISOString().slice(0, 10) !== day) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

export function editorialRecords(stories, publications) {
  const rows = new Map();
  for (const [domain, items] of [['historia', stories], ['publicacion', publications]]) {
    for (const item of array(items)) {
      if (!personId(item?.id)) continue;
      const key = `${domain}:${item.id}`;
      rows.set(key, { key, id: item.id, domain, cliente_id: personId(item.cliente_id) ? item.cliente_id : null,
        formato: domain === 'historia' ? 'historias' : item.tipo === 'carrusel' ? 'carruseles' : ['video', 'reel'].includes(item.tipo) ? 'reels' : 'otros',
        estado: text(item.estado), programada: editorialDate(item.fecha_programada),
        publicada: confirmationDate(item),
        historica: isHistoricalPublication(item),
        historica_fecha: historicalPublicationDate(item),
        confirmada: isConfirmedPublication(item) });
    }
  }
  return [...rows.values()];
}

export function summarizeEditorialRecords(records, range) {
  records = [...new Map(array(records).filter(row => personId(row?.id) && ['historia', 'publicacion'].includes(row.domain))
    .map(row => [`${row.domain}:${row.id}`, row])).values()];
  return ['carruseles', 'reels', 'historias', 'otros'].map(formato => {
    const rows = records.filter(row => row.formato === formato);
    const states = new Map();
    for (const row of rows) {
      if (!inReportRange(row.programada, range) && !inReportRange(row.publicada, range) && !inReportRange(row.historica_fecha, range)) continue;
      const state = row.estado || 'Sin estado';
      states.set(state, (states.get(state) || 0) + 1);
    }
    return { formato, programadas: rows.filter(row => inReportRange(row.programada, range)).length,
      estados: [...states].map(([estado, total]) => ({ estado, total })),
      publicadas: rows.filter(row => row.confirmada === true && inReportRange(row.publicada, range)).length,
      historicalFechadas: rows.filter(row => row.historica === true && inReportRange(row.historica_fecha, range)).length,
      legacy: rows.filter(row => row.historica === true && !row.historica_fecha && inReportRange(row.programada, range)).length,
      legacySinFecha: rows.filter(row => row.historica === true && !row.historica_fecha && !row.programada).length };
  });
}

export function personalEditorialReport(tasks, userId, stories, publications, range) {
  const links = new Set();
  for (const task of uniqueReportTasks(tasks)) {
    if (hiddenReportTask(task) || !personId(userId) || !reportTaskPeople(task).includes(userId)) continue;
    if (personId(task.historia_id)) links.add(`historia:${task.historia_id}`);
    if (personId(task.publicacion_id)) links.add(`publicacion:${task.publicacion_id}`);
  }
  const matched = editorialRecords(stories, publications).filter(row => links.has(row.key));
  return { available: links.size > 0 && matched.length > 0, linked: links.size, missing: links.size - matched.length,
    rows: summarizeEditorialRecords(matched, range) };
}

const explicitQuota = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
  && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
export function clientQuotaReport(clients, records, range) {
  const groups = new Map();
  for (const client of array(clients)) {
    if (!personId(client?.id) || client.activo === false) continue;
    const shared = personId(client.grupo_feed_id);
    const key = shared ? `feed:${client.grupo_feed_id}` : `cliente:${client.id}`;
    if (!groups.has(key)) groups.set(key, { key, shared, accounts: new Map(), carousel: new Set(), reels: new Set() });
    const group = groups.get(key);
    group.accounts.set(client.id, { id: client.id, nombre: text(client.nombre) || `Cliente #${client.id}` });
    group.carousel.add(explicitQuota(shared ? client.cuota_feed_carruseles : client.cuota_carruseles));
    group.reels.add(explicitQuota(shared ? client.cuota_feed_reels : client.cuota_reels));
  }
  return [...groups.values()].map(group => {
    const accounts = [...group.accounts.values()];
    const items = records.filter(row => group.accounts.has(row.cliente_id));
    const metrics = summarizeEditorialRecords(items, range);
    return { key: group.key, shared: group.shared, accounts,
      carruseles: group.carousel.size === 1 ? [...group.carousel][0] : null,
      reels: group.reels.size === 1 ? [...group.reels][0] : null,
      metrics, conflict: group.carousel.size > 1 || group.reels.size > 1 };
  });
}
