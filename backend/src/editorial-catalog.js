import { annotateEditorialEvidence } from './editorial-evidence-read.js';
import { editorialOperationalDto } from './operational-dto.js';

export const EDITORIAL_CATALOG_SQL = Object.freeze({
  historia: `SELECT h.id,h.cliente_id,c.nombre AS cliente_nombre,h.estado,
    to_char(h.fecha_programada,'YYYY-MM-DD') AS fecha_programada,
    h.idea,h.copy,h.material_referencia,h.aclaraciones,h.prioridad,h.responsable,
    h.responsable_planificacion,h.responsable_diseño,h.responsable_revisión,h.responsable_publicacion,
    to_char(h.fecha_planificacion_inicio,'YYYY-MM-DD') AS fecha_planificacion_inicio,
    to_char(h.fecha_diseño_inicio,'YYYY-MM-DD') AS fecha_diseño_inicio,
    to_char(h.fecha_diseño_entrega,'YYYY-MM-DD') AS fecha_diseño_entrega,
    to_char(h.fecha_revisión_inicio,'YYYY-MM-DD') AS fecha_revisión_inicio,
    to_char(h.fecha_revisión_aprobación,'YYYY-MM-DD') AS fecha_revisión_aprobación,
    h.fecha_publicación_real,h.notas_planificacion,h.notas_diseño,h.notas_revisión,h.notas_bloqueador,
    h.metadata,h.created_at,h.updated_at
    FROM historias h JOIN clientes c ON c.id=h.cliente_id
    WHERE h.metadata->>'archivado_tablero' IS DISTINCT FROM 'true'
    ORDER BY h.fecha_programada DESC,h.id`,
  publicacion: `SELECT p.id,p.cliente_id,c.nombre AS cliente_nombre,p.tipo,p.estado,
    to_char(p.fecha_programada,'YYYY-MM-DD') AS fecha_programada,
    p.idea,p.copy,p.material_referencia,p.aclaraciones,p.prioridad,p.responsable,
    p.duracion_segundos,p.num_imagenes,p.responsable_diseño,p.responsable_edición,p.responsable_revisión,p.responsable_publicacion,
    to_char(p.fecha_diseño_entrega,'YYYY-MM-DD') AS fecha_diseño_entrega,
    to_char(p.fecha_edición_entrega,'YYYY-MM-DD') AS fecha_edición_entrega,
    to_char(p.fecha_revisión_aprobación,'YYYY-MM-DD') AS fecha_revisión_aprobación,
    p.fecha_publicación_real,p.origen_calendario,p.calendario_clave,p.fecha_bloqueada,p.metadata,p.created_at,p.updated_at
    FROM publicaciones p JOIN clientes c ON c.id=p.cliente_id
    WHERE $1::boolean OR p.metadata->>'archivado_tablero' IS DISTINCT FROM 'true'
    ORDER BY p.fecha_programada DESC,p.id`,
});

const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const stale = () => Object.assign(new Error('La sesión cambió. Volvé a iniciar sesión.'), { status: 401 });

export async function loadEditorialCatalogSnapshot(pool, auth, domain, { includeArchived = false } = {}) {
  if (!Object.hasOwn(EDITORIAL_CATALOG_SQL, domain) || typeof includeArchived !== 'boolean') throw new TypeError('Consulta editorial inválida.');
  if (!positive(auth?.id) || !positive(auth?.session_version) || typeof auth?.rol !== 'string' || !auth.rol.trim()) throw stale();
  const observed = Object.freeze({ id: auth.id, rol: auth.rol, session_version: auth.session_version });
  const values = domain === 'publicacion' ? [includeArchived] : [];
  const db = await pool.connect();
  let discard;
  try {
    // Authority, piece content and publication evidence must share one snapshot;
    // a previously observed admin role must not outlive a pre-read revocation.
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const actor = (await db.query('SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1', [observed.id])).rows[0];
    if (!actor || actor.id !== observed.id || actor.activo !== true || actor.rol !== observed.rol || actor.session_version !== observed.session_version) throw stale();
    const result = await db.query(EDITORIAL_CATALOG_SQL[domain], values);
    const rows = (await annotateEditorialEvidence(db, domain, result.rows)).map(row => editorialOperationalDto(row, actor));
    await db.query('COMMIT');
    return rows;
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (rollback) { discard = rollback; }
    throw error;
  } finally { db.release(discard); }
}
