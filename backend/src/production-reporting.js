import { isValidProductionDate, getProductionProgress } from './production-visits.js';
import { productionFinalizationReadiness } from './production-task-finalization.js';
import { productionResultProjectionSql, productionResultProjection } from './production-result-projection.js';

const fail = message => Object.assign(new Error(message), { status: 400 });
const positive = value => Number.isSafeInteger(value) && value > 0;

/** Inclusive start, exclusive end; one bounded reporting period, never a SQL fragment. */
export function productionReportRange(query, defaultMonth) {
  const explicit = query.desde !== undefined || query.hasta !== undefined;
  if (!explicit) {
    const start = new Date(`${defaultMonth}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-01$/.test(defaultMonth) || !Number.isFinite(start.getTime())) throw fail('Mes inválido.');
    start.setUTCMonth(start.getUTCMonth() + 1);
    return { desde: defaultMonth, hasta: start.toISOString().slice(0, 10) };
  }
  if (typeof query.desde !== 'string' || typeof query.hasta !== 'string'
    || !isValidProductionDate(query.desde) || !isValidProductionDate(query.hasta)) throw fail('Elegí un rango de fechas válido.');
  const days = (Date.parse(`${query.hasta}T00:00:00Z`) - Date.parse(`${query.desde}T00:00:00Z`)) / 86400000;
  if (days <= 0 || days > 366) throw fail('El rango debe tener entre uno y 366 días.');
  return { desde: query.desde, hasta: query.hasta };
}

/** Explicit operational fields only: no scripts, raw JSON, payroll or finance. */
export async function loadProductionReport(db, range) {
  const visits = (await db.query(`SELECT v.id,v.tarea_origen_id,v.cliente_id,c.nombre cliente_nombre,v.revision,${productionResultProjectionSql},
    to_char(v.fecha,'YYYY-MM-DD') fecha,v.titulo,
    ARRAY(SELECT p.usuario_id FROM produccion_visita_participantes p WHERE p.visita_id=v.id ORDER BY p.usuario_id) participante_ids
    FROM produccion_visitas v JOIN clientes c ON c.id=v.cliente_id
    WHERE v.fecha >= $1::date AND v.fecha < $2::date ORDER BY v.fecha,v.id`, [range.desde, range.hasta])).rows;
  if (!visits.length) return { ...range, visitas: [] };
  const ids = visits.map(visit => visit.id);
  const videos = await db.query(`SELECT pv.id,pv.visita_id,pv.titulo,pv.estado,pv.tarea_edicion_id,t.estado tarea_estado,
      (SELECT a.usuario_id FROM tarea_asignaciones a WHERE a.tarea_id=t.id AND a.tipo='responsable' ORDER BY a.usuario_id LIMIT 1) editor_actual_id,
      to_char(t.fecha_vencimiento,'YYYY-MM-DD') fecha_entrega_actual
      FROM produccion_videos pv LEFT JOIN tareas t ON t.id=pv.tarea_edicion_id
      WHERE pv.visita_id=ANY($1::uuid[]) ORDER BY pv.created_at,pv.id`, [ids]);
  const photos = await db.query('SELECT id,visita_id,tipo,estado FROM produccion_fotos WHERE visita_id=ANY($1::uuid[]) ORDER BY created_at,id', [ids]);
  return { ...range, visitas: visits.map(visit => ({
    id: visit.id, tarea_origen_id: visit.tarea_origen_id, cliente_id: visit.cliente_id,
    cliente_nombre: visit.cliente_nombre, fecha: visit.fecha, titulo: visit.titulo,
    revision: visit.revision, ultimo_resultado: productionResultProjection(visit.ultimo_resultado,visit.revision),
    participante_ids: (visit.participante_ids || []).filter(positive),
    videos: videos.rows.filter(video => video.visita_id === visit.id).map(video => ({
      id: video.id, titulo: video.titulo, estado: video.estado, tarea_edicion_id: video.tarea_edicion_id,
      tarea_estado: video.tarea_estado, editor_actual_id: video.editor_actual_id, fecha_entrega_actual: video.fecha_entrega_actual,
    })),
    fotos: photos.rows.filter(photo => photo.visita_id === visit.id).map(photo => ({ id: photo.id, tipo: photo.tipo, estado: photo.estado })),
  })) };
}

export async function loadProductionTaskContext(db, taskId) {
  if (!positive(taskId)) throw fail('Tarea inválida.');
  const result = await db.query(`SELECT v.id,to_char(v.fecha,'YYYY-MM-DD') fecha,v.revision,${productionResultProjectionSql},
    source.revision AS task_revision,source.propiedades_extra->'produccion_videos_previstos' AS previstos_raw,
    CASE WHEN v.tarea_origen_id=$1 THEN 'origen' ELSE 'edicion' END tipo,
    (SELECT count(*)::int FROM produccion_videos pv WHERE pv.visita_id=v.id) videos_total,
    (SELECT count(*)::int FROM produccion_videos pv WHERE pv.visita_id=v.id AND pv.estado='grabado') videos_grabados,
    (SELECT count(*)::int FROM produccion_fotos pf WHERE pf.visita_id=v.id) fotos_total
    FROM produccion_visitas v LEFT JOIN tareas source ON source.id=v.tarea_origen_id WHERE v.tarea_origen_id=$1
      OR EXISTS(SELECT 1 FROM produccion_videos pv WHERE pv.visita_id=v.id AND pv.tarea_edicion_id=$1)
    ORDER BY v.id LIMIT 1`, [taskId]);
  const visit = result.rows[0];
  if (!visit) return { vinculo: null };
  return { vinculo: { id: visit.id, fecha: visit.fecha, revision: visit.revision, tipo: visit.tipo,
    ultimo_resultado: productionResultProjection(visit.ultimo_resultado,visit.revision),
    videos_total: visit.videos_total, videos_grabados: visit.videos_grabados, fotos_total: visit.fotos_total,
    usa_registro_individual: visit.videos_total > 0 || visit.fotos_total > 0,
    ...(visit.tipo === 'origen' ? { finalizacion: productionFinalizationReadiness(visit.task_revision,
      getProductionProgress({ propiedades_extra: { produccion_videos_previstos: visit.previstos_raw } }).planned,
      visit.videos_total, visit.videos_grabados) } : {}) } };
}
