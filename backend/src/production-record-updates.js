import { getProductionProgress, nextProductionPeriod } from './production-visits.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

/** Pure correction in stored registration order (never sorted by date).
 * Returns { records, previous }; previous is the selected record's actual old
 * cantidad, not an earlier corregido_desde audit value. Caller owns transaction,
 * revision/ACL checks and resetting workflow/confirmation properties.
 */
export function correctProductionRecord(task, { recordId, amount, actorName, actorId, now = new Date() } = {}) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw fail('La cantidad debe ser un entero mayor que cero.');
  const originals = Array.isArray(task?.propiedades_extra?.produccion_registros)
    ? task.propiedades_extra.produccion_registros : [];
  const selected = recordId == null ? -1 : originals.findIndex(record => record?.id != null && String(record.id) === String(recordId));
  if (selected < 0) throw fail('Registro de producción no encontrado.', 404);
  if (!Number.isSafeInteger(actorId) || actorId <= 0 || typeof actorName !== 'string' || !actorName.trim()) {
    throw fail('La corrección necesita una identidad válida.');
  }
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw fail('Fecha de corrección inválida.');
  const previous = Number(originals[selected].cantidad);
  const planned = getProductionProgress(task).planned;
  let recorded = 0;
  const records = originals.map((record, index) => {
    const corrected = index === selected ? {
      ...record, cantidad: amount, corregido_desde: previous,
      corregido_por: actorName, corregido_por_id: actorId, corregido_at: date.toISOString(),
    } : { ...record };
    // Match production progress handling for legacy non-positive quantities.
    const value = Number(corrected.cantidad);
    const quantity = Number.isInteger(value) && value > 0 ? value : 0;
    const regular = planned > 0 ? Math.min(quantity, Math.max(planned - recorded, 0)) : quantity;
    const advance = quantity - regular;
    recorded += quantity;
    return { ...corrected, cantidad_mes_actual: regular, cantidad_adelanto: advance,
      periodo_adelanto: advance > 0 ? nextProductionPeriod(corrected.fecha) : null };
  });
  return { records, previous };
}
