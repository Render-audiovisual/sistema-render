import { clientAgreementRevisionSql } from './client-agreement.js';
import { clientOperationalDto } from './operational-dto.js';
import { validateInstagramMonthlyObservation } from '../../shared/instagram-monthly-observation.mjs';
import { captureOwnerProfileWriteAuthority, checkCapturedOwnerProfileAuthority } from './owner-profile-authority.js';

const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const stale = () => Object.assign(new Error('La sesión cambió. Volvé a iniciar sesión.'), { status: 401 });

export const CLIENT_CATALOG_SQL = `
  SELECT c.id,c.nombre,${clientAgreementRevisionSql('c','gf')} AS agreement_revision,
    COALESCE(cfg.cuota_reels, CASE WHEN c.fecha_inicio >= $1::date + INTERVAL '1 month' THEN 0 ELSE c.cuota_reels END) AS cuota_reels,
    COALESCE(cfg.cuota_carruseles, CASE WHEN c.fecha_inicio >= $1::date + INTERVAL '1 month' THEN 0 ELSE c.cuota_carruseles END) AS cuota_carruseles,
    c.rubro,c.activo,to_char(c.fecha_inicio,'YYYY-MM-DD') AS fecha_inicio,
    to_char(c.fecha_fin,'YYYY-MM-DD') AS fecha_fin,cfg.dias_historias,cfg.dias_reels,cfg.dias_carruseles,
    cfg.disenador_responsable,COALESCE(abono.importe,cfg.abono_mensual) AS abono_mensual,
    to_char(COALESCE(abono.vigente_desde,cfg.vigente_desde),'YYYY-MM-DD') AS abono_vigente_desde,
    to_char(cfg.vigente_desde,'YYYY-MM-DD') AS configuracion_vigente_desde,
    (cfg.id IS NOT NULL) AS configuracion_completa,c.grupo_feed_id,gf.nombre AS grupo_feed_nombre,
    gf.cuota_reels AS cuota_feed_reels,gf.cuota_carruseles AS cuota_feed_carruseles,
    (gf.cuota_reels + gf.cuota_carruseles) AS cuota_feed_compartida,
    instagram_observation.detalles AS instagram_monthly_observation,
    branding.detalles->>'logo' AS logo
  FROM clientes c
  LEFT JOIN LATERAL (
    SELECT cc.* FROM cliente_configuraciones cc
    WHERE cc.cliente_id=c.id AND cc.vigente_desde <= $1::date
    ORDER BY cc.vigente_desde DESC LIMIT 1
  ) cfg ON TRUE
  LEFT JOIN LATERAL (
    SELECT ca.importe,ca.vigente_desde FROM cliente_abonos ca
    WHERE ca.cliente_id=c.id AND ca.vigente_desde <= $1::date
    ORDER BY ca.vigente_desde DESC LIMIT 1
  ) abono ON TRUE
  LEFT JOIN grupos_feed gf ON gf.id=c.grupo_feed_id
  LEFT JOIN LATERAL (
    SELECT ia.detalles FROM integracion_auditoria ia
    WHERE ia.integracion='client_branding' AND ia.canal='web' AND ia.accion='logo_updated'
      AND ia.resultado='ok' AND ia.detalles->>'clientId'=c.id::text
    ORDER BY ia.created_at DESC,ia.id DESC LIMIT 1
  ) branding ON TRUE
  LEFT JOIN LATERAL (
    SELECT ia.detalles FROM integracion_auditoria ia
    WHERE ia.integracion='instagram_manual_review' AND ia.canal='web'
      AND ia.accion='monthly_publications_observed' AND ia.resultado='ok'
      AND ia.detalles->>'clientId'=c.id::text
      AND ia.detalles->>'period'=to_char($1::date,'YYYY-MM')
    ORDER BY ia.created_at DESC,ia.id DESC LIMIT 1
  ) instagram_observation ON TRUE
  ORDER BY c.id`;

// Authorization and commercial rows share the first repeatable-read snapshot.
// A revocation committed before that snapshot must not retain an old admin
// projection. A later revocation does not retroactively invalidate the snapshot.
export async function loadClientCatalogSnapshot(pool, auth, periodo) {
  if (!positive(auth?.id) || !positive(auth?.session_version) || typeof auth?.rol !== 'string' || !auth.rol.trim()) throw stale();
  const observed = Object.freeze({ id: auth.id, rol: auth.rol, session_version: auth.session_version });
  const delegation=captureOwnerProfileWriteAuthority(auth);
  const db = await pool.connect();
  let discard;
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await checkCapturedOwnerProfileAuthority(db,delegation);
    const actor = (await db.query('SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1', [observed.id])).rows[0];
    if (!actor || actor.id !== observed.id || actor.activo !== true || actor.rol !== observed.rol || actor.session_version !== observed.session_version) throw stale();
    const result = await db.query(CLIENT_CATALOG_SQL, [periodo]);
    const rows = result.rows.map(row => {
      const dto = { ...clientOperationalDto(row, actor) };
      delete dto.instagram_monthly_observation;
      const snapshot = validateInstagramMonthlyObservation(row.instagram_monthly_observation, { clientId: row.id, period: periodo.slice(0, 7) });
      if (snapshot) dto.instagram_monthly_observation = snapshot;
      return dto;
    });
    await db.query('COMMIT');
    return rows;
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (rollback) { discard = rollback; }
    throw error;
  } finally { db.release(discard); }
}
