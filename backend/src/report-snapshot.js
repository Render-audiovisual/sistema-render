import { normalizePeriod } from './client-config.js';
import { annotateTaskAssignments } from './task-assignments.js';
import { annotateEditorialEvidence } from './editorial-evidence-read.js';
import { productionReportRange, loadProductionReport } from './production-reporting.js';
import { filterReportDataForUser } from './report-access.js';
import { loadHistoricalReportClosures } from './historical-report-closures.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;

export function captureReportActor(auth) {
  if (!positive(auth?.id) || !positive(auth?.session_version) || typeof auth?.rol !== 'string' || !auth.rol.trim()) {
    throw fail(401, 'La sesión cambió. Volvé a iniciar sesión.');
  }
  return Object.freeze({ id:auth.id, session_version:auth.session_version, rol:auth.rol });
}

// Omitted selectors retain the existing monthly default. Present selectors are
// closed scalar strings, never fallback values for malformed input.
export function normalizeReportQuery(query = {}, now = new Date()) {
  if (!query || typeof query !== 'object' || Array.isArray(query)
    || Object.keys(query).some(key => !['mes_configuracion','desde','hasta'].includes(key))) {
    throw fail(400, 'Parámetros de reporte inválidos.');
  }
  if (Object.hasOwn(query,'mes_configuracion') && (typeof query.mes_configuracion !== 'string'
    || query.mes_configuracion.length !== 7 || !/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(query.mes_configuracion))) {
    throw fail(400, 'Mes de configuración inválido.');
  }
  if (['desde','hasta'].some(key => Object.hasOwn(query,key) && (typeof query[key] !== 'string'
    || query[key].length !== 10 || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(query[key])))) {
    throw fail(400, 'Elegí un rango de fechas válido.');
  }
  const mesConfiguracion = normalizePeriod(query.mes_configuracion, now);
  const productionRange = productionReportRange(query, mesConfiguracion);
  return Object.freeze({ mesConfiguracion, productionRange:Object.freeze(productionRange) });
}

// Point-in-time authorization and data share the first RR snapshot. This does
// not serialize a revocation that commits after that snapshot has begun.
// A pool/client wrapper can provide deterministic query barriers in PG tests;
// no route flag or mutable dependency hook is exposed.
export async function loadReportSnapshot(pool, auth, query = {}) {
  const observed = captureReportActor(auth);
  const { mesConfiguracion, productionRange } = normalizeReportQuery(query);
  const db = await pool.connect();
  let discard;
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const actor = (await db.query('SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1', [observed.id])).rows[0];
    if (!actor || actor.id !== observed.id || actor.activo !== true || actor.session_version !== observed.session_version || actor.rol !== observed.rol) {
      throw fail(401, 'La sesión cambió. Volvé a iniciar sesión.');
    }
    const tareas = await db.query(`SELECT t.id,t.cliente_id,t.historia_id,t.publicacion_id,t.titulo,t.asignado_a,t.estado,t.propiedades_extra,
        EXISTS(SELECT 1 FROM produccion_visitas v WHERE v.tarea_origen_id=t.id AND
          (EXISTS(SELECT 1 FROM produccion_videos pv WHERE pv.visita_id=v.id)
           OR EXISTS(SELECT 1 FROM produccion_fotos pf WHERE pf.visita_id=v.id))) produccion_registro_individual,
        to_char(t.fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento,t.tipo_tarea,t.subtipo,
        t.created_at,t.updated_at,c.nombre AS cliente_nombre
        FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
        WHERE t.propiedades_extra->>'workspace' IS DISTINCT FROM 'render_os'`);
    const historias = await db.query(`SELECT id,cliente_id,estado,to_char(fecha_programada,'YYYY-MM-DD') AS fecha_programada,fecha_publicación_real,
        responsable,responsable_diseño FROM historias
        WHERE metadata->>'archivado_tablero' IS DISTINCT FROM 'true'`);
    const publicaciones = await db.query(`SELECT id,cliente_id,tipo,estado,to_char(fecha_programada,'YYYY-MM-DD') AS fecha_programada,fecha_publicación_real,
        responsable,responsable_diseño FROM publicaciones
        WHERE metadata->>'archivado_tablero' IS DISTINCT FROM 'true'`);
    const clientes = await db.query(`SELECT c.id,c.nombre,c.activo,
        COALESCE(cfg.cuota_carruseles,c.cuota_carruseles) AS cuota_carruseles,
        COALESCE(cfg.cuota_reels,c.cuota_reels) AS cuota_reels,
        cfg.disenador_responsable,c.grupo_feed_id,
        gf.cuota_carruseles AS cuota_feed_carruseles,gf.cuota_reels AS cuota_feed_reels
        FROM clientes c
        LEFT JOIN LATERAL (
          SELECT cc.cuota_carruseles,cc.cuota_reels,cc.disenador_responsable
          FROM cliente_configuraciones cc
          WHERE cc.cliente_id=c.id AND cc.vigente_desde <= $1::date
          ORDER BY cc.vigente_desde DESC LIMIT 1
        ) cfg ON TRUE
        LEFT JOIN grupos_feed gf ON gf.id=c.grupo_feed_id
        ORDER BY c.nombre`, [mesConfiguracion]);
    const usuarios = await db.query(`SELECT id,usuario,nombre,rol FROM usuarios ORDER BY id`);
    const tareasRenderOs = await db.query(`SELECT t.id,t.cliente_id,t.historia_id,t.publicacion_id,t.titulo,t.asignado_a,t.estado,t.propiedades_extra,
        EXISTS(SELECT 1 FROM produccion_visitas v WHERE v.tarea_origen_id=t.id AND
          (EXISTS(SELECT 1 FROM produccion_videos pv WHERE pv.visita_id=v.id)
           OR EXISTS(SELECT 1 FROM produccion_fotos pf WHERE pf.visita_id=v.id))) produccion_registro_individual,
        to_char(t.fecha_vencimiento,'YYYY-MM-DD') AS fecha_vencimiento,t.tipo_tarea,t.subtipo,
        t.created_at,t.updated_at,c.nombre AS cliente_nombre
        FROM tareas t LEFT JOIN clientes c ON c.id=t.cliente_id
        WHERE t.propiedades_extra->>'workspace'='render_os'
          AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
          AND t.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'`);
    const entregasEdicion = await db.query(`SELECT id,editor_clave,to_char(fecha_entrega,'YYYY-MM-DD') AS fecha_entrega,
        cliente_etiqueta,categoria,fuente,fuente_item,confirmado_por
        FROM entregas_edicion ORDER BY fecha_entrega,fuente_item`);
    const assignedTasks = await annotateTaskAssignments(db, tareas.rows);
    const cierresMensuales = await loadHistoricalReportClosures(db);
    const assignedWorkspaceTasks = await annotateTaskAssignments(db, tareasRenderOs.rows);
    const producciones = await loadProductionReport(db, productionRange);
    const historiasConEvidencia = await annotateEditorialEvidence(db, 'historia', historias.rows);
    const publicacionesConEvidencia = await annotateEditorialEvidence(db, 'publicacion', publicaciones.rows);
    const result = filterReportDataForUser({
      tareas: assignedTasks,
      historias: historiasConEvidencia,
      publicaciones: publicacionesConEvidencia,
      clientes: clientes.rows,
      usuarios: usuarios.rows,
      tareasRenderOs: assignedWorkspaceTasks,
      entregasEdicion: entregasEdicion.rows,
      producciones,
      cierresMensuales,
    }, actor);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (rollback) { discard = rollback; }
    throw error;
  } finally { db.release(discard); }
}
