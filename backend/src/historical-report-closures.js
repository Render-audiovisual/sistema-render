// Legacy manual monthly decisions are historical evidence only. Never use
// these rows to complete tasks, publish pieces, or calculate current quotas.
// No free-text reason/author field crosses the operational report boundary.
const value = (row, key) => {
  const descriptor = row && typeof row === 'object' && Object.getOwnPropertyDescriptor(row, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
};
const positive = id => Number.isSafeInteger(id) && id > 0 && id <= 2147483647;
export function historicalClosuresDto(source) {
  if (value(source, 'disponible') !== true) return { disponible: false, registros: [] };
  const rows = value(source, 'registros'), registros = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const periodo = value(row, 'periodo'), usuario_id = value(row, 'usuario_id'), porcentaje = value(row, 'porcentaje');
    const nombre_snapshot = value(row, 'nombre_snapshot'), raw = value(row, 'registrado_at');
    if (typeof periodo !== 'string' || !/^(?!0000)\d{4}-(0[1-9]|1[0-2])-01$/.test(periodo)
      || !positive(usuario_id) || !Number.isInteger(porcentaje) || porcentaje < 0 || porcentaje > 100
      || typeof nombre_snapshot !== 'string' || !nombre_snapshot.trim() || nombre_snapshot.length > 300) continue;
    const key = `${periodo}:${usuario_id}`;
    if (seen.has(key)) continue;
    let registrado_at = null;
    try {
      if (raw instanceof Date && Number.isFinite(Date.prototype.getTime.call(raw))) registrado_at = new Date(Date.prototype.getTime.call(raw)).toISOString();
      else if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw)
        && Number.isFinite(Date.parse(raw)) && new Date(raw).toISOString() === raw) registrado_at = raw;
    } catch { /* Invalid timestamp cannot become evidence of a date. */ }
    seen.add(key);
    registros.push({ periodo, usuario_id, nombre_snapshot, porcentaje, registrado_at });
  }
  registros.sort((a, b) => b.periodo.localeCompare(a.periodo) || a.usuario_id - b.usuario_id);
  return { disponible: true, registros };
}

export async function loadHistoricalReportClosures(db) {
  // The historical table belongs to the deployed branch, not to fresh fixtures.
  // Do not replay its data migrations or silently swallow schema/query errors.
  const exists = (await db.query("SELECT to_regclass('public.reporte_cierres_mensuales') AS historical_closures_table")).rows[0]?.historical_closures_table;
  if (!exists) return { disponible: false, registros: [] };
  const rows = (await db.query(`SELECT to_char(periodo,'YYYY-MM-DD') AS periodo,usuario_id,nombre_snapshot,
    porcentaje,created_at AS registrado_at FROM public.reporte_cierres_mensuales ORDER BY periodo DESC,usuario_id`)).rows;
  return historicalClosuresDto({ disponible: true, registros: rows });
}
