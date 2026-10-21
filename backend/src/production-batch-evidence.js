import { productionHistoryHash } from './production-history-hash.js';

// Publication/goal evolution is legal only on this exact live canonical tuple.
// This never infers publication from a task state or inherits an approval.
export const BATCH_EDITORIAL_TUPLE_SQL = `((t.publicacion_id IS NULL AND pv.publicacion_id IS NULL
    AND pv.tarea_entrega_id IS NULL AND NOT EXISTS(SELECT 1 FROM cliente_objetivo_piezas s
      JOIN cliente_objetivos_mensuales o ON o.id=s.objetivo_id WHERE s.tarea_id=t.id
      AND (s.publicacion_id IS NOT NULL OR s.tipo<>'video'
        OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(o.cuentas) c WHERE c->>'id'=v.cliente_id::text))))
  OR (t.publicacion_id=pv.publicacion_id AND pv.tarea_entrega_id=t.id
    AND pv.cliente_editorial_id=v.cliente_id
    AND EXISTS(SELECT 1 FROM publicaciones pub WHERE pub.id=pv.publicacion_id
      AND pub.cliente_id=v.cliente_id AND pub.tipo IN ('video','reel'))
    AND NOT EXISTS(SELECT 1 FROM cliente_objetivo_piezas s JOIN cliente_objetivos_mensuales o ON o.id=s.objetivo_id
      WHERE (s.tarea_id=t.id OR s.publicacion_id=pv.publicacion_id) AND
        (s.tarea_id IS DISTINCT FROM t.id OR s.publicacion_id IS DISTINCT FROM pv.publicacion_id
         OR s.tipo<>'video' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(o.cuentas) c
           WHERE c->>'id'=v.cliente_id::text)))))`;
const canonicalDomain = `t.cliente_id=v.cliente_id AND t.propiedades_extra->>'workspace'='render_os'
  AND t.historia_id IS NULL
  AND t.propiedades_extra->>'archivada_render_os' IS DISTINCT FROM 'true'
  AND t.propiedades_extra->>'papelera_render_os' IS DISTINCT FROM 'true'
  AND NOT EXISTS(SELECT 1 FROM proyecto_tareas pt WHERE pt.tarea_id=t.id)`;
// /piezas creates an administration task before editorial handoff. This type
// is compatible only after the exact publication tuple exists, never by marker.
const independentType = `(t.tipo_tarea IN ('edicion','diseno') OR (t.tipo_tarea='administracion'
  AND pv.tarea_edicion_id IS NULL AND pv.publicacion_id IS NOT NULL
  AND t.publicacion_id=pv.publicacion_id AND pv.tarea_entrega_id=t.id
  AND pv.cliente_editorial_id=v.cliente_id))`;

// null means no batch has ever selected this video: legacy fallback is allowed.
// false is terminal: never resurrect an older/legacy proof after invalidation.
async function newestProof(db,videoId) {
  return (await db.query(`SELECT l.id,l.visita_id,l.tarea_origen_id,l.source_history_hash,
    p.disposition,p.tarea_edicion_id FROM produccion_revision_lote_videos p
    JOIN produccion_revision_lotes l ON l.id=p.lote_id
    WHERE p.video_id=$1 ORDER BY l.secuencia DESC LIMIT 1`, [videoId])).rows[0];
}
function matchingProof(proof,visit,source) {
  return Boolean(visit && source && proof.visita_id === visit.id && proof.tarea_origen_id === visit.tarea_origen_id
    && source.id === visit.tarea_origen_id && source.cliente_id
    && proof.source_history_hash === productionHistoryHash(source)
    && ['manual_independent','adopt_original'].includes(proof.disposition)
    && (proof.disposition === 'adopt_original' ? Number.isSafeInteger(proof.tarea_edicion_id) && proof.tarea_edicion_id > 0 : proof.tarea_edicion_id == null));
}
export async function productionBatchVideoEvidence(db, visit, source, videoId) {
  const proof = await newestProof(db,videoId);
  if (!proof) return null;
  if (!matchingProof(proof,visit,source)) return false;
  return batchLiveVideoCompatible(db,visit,source,videoId,proof.tarea_edicion_id,proof.disposition==='adopt_original');
}

// DISCOVERY ONLY: no permission to dispatch/associate is returned. A staged
// publication on the original task may be listed, but exact candidate filters
// and locked mutation checks must establish the final tuple. Operational writes
// still call productionBatchVideoEvidence against the fully written live tuple.
export async function productionBatchCandidateProvenance(db,visit,source,videoId) {
  const proof=await newestProof(db,videoId);
  if(!proof)return null;
  if(!matchingProof(proof,visit,source))return false;
  const original=proof.disposition==='adopt_original';
  const rows=await db.query(`SELECT pv.id FROM produccion_videos pv
    JOIN produccion_visitas v ON v.id=pv.visita_id
    LEFT JOIN tareas t ON t.id=pv.tarea_edicion_id
    WHERE pv.id=$1 AND pv.visita_id=$2 AND v.tarea_origen_id=$3 AND v.cliente_id=$4
      AND pv.publicacion_id IS NULL AND pv.tarea_entrega_id IS NULL
      AND ${original ? `t.id=$5 AND ${canonicalDomain} AND t.tipo_tarea='edicion'
        AND t.propiedades_extra->>'origen_visita_id'=v.tarea_origen_id::text
        AND (EXISTS(SELECT 1 FROM produccion_lote_edicion_mapeos m WHERE m.video_id=pv.id
          AND m.visita_id=v.id AND m.tarea_edicion_id=t.id)
          OR EXISTS(SELECT 1 FROM produccion_edicion_adopciones a
            JOIN produccion_reconciliaciones r ON r.id=a.reconciliacion_id
            WHERE a.video_id=pv.id AND a.tarea_edicion_id=t.id AND r.visita_id=v.id
              AND r.tarea_origen_id=v.tarea_origen_id))`
        : `NOT EXISTS(SELECT 1 FROM produccion_lote_edicion_mapeos m WHERE m.video_id=pv.id)
        AND NOT EXISTS(SELECT 1 FROM produccion_edicion_adopciones a WHERE a.video_id=pv.id)
        AND (pv.tarea_edicion_id IS NULL OR (${canonicalDomain} AND t.tipo_tarea IN ('edicion','diseno')
          AND t.propiedades_extra->>'origen_produccion_video_id'=pv.id::text
          AND t.propiedades_extra->>'produccion_visita_id'=v.id::text))`}`,
  original ? [videoId,visit.id,visit.tarea_origen_id,source.cliente_id,proof.tarea_edicion_id]
    : [videoId,visit.id,visit.tarea_origen_id,source.cliente_id]);
  return rows.rows.length ? Object.freeze({disposition:proof.disposition,taskId:original?proof.tarea_edicion_id:null}) : false;
}

export async function batchLiveVideoCompatible(db,visit,source,videoId,taskId,original) {
  if (!visit || source?.id !== visit.tarea_origen_id || !source.cliente_id) return false;
  if (!original) {
    // A later canonical handoff is allowed; an original aggregate mapping is not.
    return Boolean((await db.query(`SELECT pv.id FROM produccion_videos pv
      JOIN produccion_visitas v ON v.id=pv.visita_id
      LEFT JOIN tareas t ON t.id=COALESCE(pv.tarea_edicion_id,pv.tarea_entrega_id)
      WHERE pv.id=$1 AND pv.visita_id=$2 AND v.tarea_origen_id=$3
      AND v.cliente_id=$4
      AND NOT EXISTS(SELECT 1 FROM produccion_lote_edicion_mapeos m WHERE m.video_id=pv.id)
      AND NOT EXISTS(SELECT 1 FROM produccion_edicion_adopciones a WHERE a.video_id=pv.id)
      AND ((pv.tarea_edicion_id IS NULL AND pv.tarea_entrega_id IS NULL AND pv.publicacion_id IS NULL)
        OR (${canonicalDomain} AND ${independentType} AND ${BATCH_EDITORIAL_TUPLE_SQL}
          AND (pv.tarea_edicion_id IS NULL OR pv.tarea_entrega_id IS NULL OR pv.tarea_edicion_id=pv.tarea_entrega_id)
          AND ((t.propiedades_extra->>'origen_produccion_video_id'=pv.id::text
            AND t.propiedades_extra->>'produccion_visita_id'=v.id::text)
            OR (pv.publicacion_id IS NOT NULL AND pv.tarea_entrega_id=t.id))))`,
    [videoId,visit.id,visit.tarea_origen_id,source.cliente_id])).rows.length);
  }
  if (!taskId) return false;
  return Boolean((await db.query(`SELECT pv.id FROM produccion_videos pv
    JOIN produccion_visitas v ON v.id=pv.visita_id JOIN tareas t ON t.id=pv.tarea_edicion_id
    WHERE pv.id=$1 AND pv.visita_id=$2 AND v.tarea_origen_id=$3 AND t.id=$4 AND v.cliente_id=$5
      AND ${canonicalDomain} AND t.tipo_tarea='edicion'
      AND t.propiedades_extra->>'origen_visita_id'=v.tarea_origen_id::text
      AND ${BATCH_EDITORIAL_TUPLE_SQL}
      AND (EXISTS(SELECT 1 FROM produccion_lote_edicion_mapeos m WHERE m.video_id=pv.id
        AND m.visita_id=v.id AND m.tarea_edicion_id=t.id)
        OR EXISTS(SELECT 1 FROM produccion_edicion_adopciones a
          JOIN produccion_reconciliaciones r ON r.id=a.reconciliacion_id
          WHERE a.video_id=pv.id AND a.tarea_edicion_id=t.id AND r.visita_id=v.id
            AND r.tarea_origen_id=v.tarea_origen_id))`,
  [videoId,visit.id,visit.tarea_origen_id,taskId,source.cliente_id])).rows.length);
}
