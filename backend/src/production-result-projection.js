// Correlated scalar lookup: evidence and visit revision share one SQL snapshot.
// Never project the raw journal summary, request receipt or actor metadata.
export const productionResultProjectionSql = `(SELECT jsonb_build_object(
  'id',r.id,'visita_revision',r.visita_revision,'revision_resultante',r.revision_resultante,
  'registrado_at',r.registrado_at,'parcial',r.resumen->'parcial',
  'vigente',r.revision_resultante=v.revision)
  FROM produccion_resultados r WHERE r.visita_id=v.id
  ORDER BY r.visita_revision DESC LIMIT 1) AS ultimo_resultado`;

export function productionResultProjection(value, revision) {
  if (value === null || value === undefined) return null;
  const positive = n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
  const timestamp = text => {
    if(typeof text!=='string'||text.length>64)return false;
    const match=/^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(text);
    if(!match||match[0]!==text||text.startsWith('0000')||!Number.isFinite(Date.parse(text)))return false;
    const day=new Date(`${match[1]}T00:00:00Z`);
    return Number.isFinite(day.getTime())&&day.toISOString().slice(0,10)===match[1];
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.id)
    || !positive(value.visita_revision) || value.revision_resultante !== value.visita_revision + 1
    || !positive(revision) || value.revision_resultante > revision
    || typeof value.parcial !== 'boolean' || typeof value.vigente !== 'boolean'
    || value.vigente !== (value.revision_resultante === revision)
    || !timestamp(value.registrado_at)) {
    throw new Error('Invalid production result projection');
  }
  return {id:value.id,visita_revision:value.visita_revision,revision_resultante:value.revision_resultante,
    registrado_at:new Date(value.registrado_at).toISOString(),parcial:value.parcial,vigente:value.vigente};
}
