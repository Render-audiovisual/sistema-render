const MAX_REVISION = 2147483647;
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= MAX_REVISION;
const uuid = value => typeof value === 'string' && value.length === 36
  && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const statuses = Object.freeze({
  pending: Object.freeze({ label: 'Sin resultado registrado', tone: 'pending' }),
  partial: Object.freeze({ label: 'Resultado parcial registrado', tone: 'partial' }),
  complete: Object.freeze({ label: 'Resultado registrado', tone: 'complete' }),
  outdated: Object.freeze({ label: 'Resultado desactualizado', tone: 'outdated' }),
  unknown: Object.freeze({ label: 'Resultado sin verificar', tone: 'unknown' }),
});
function timestamp(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match || match[0] !== value || Number(match[1].slice(0, 4)) < 1
    || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59
    || (match[5] && (Number(match[6]) > 23 || Number(match[7]) > 59)) || !Number.isFinite(Date.parse(value))) return false;
  const day = new Date(`${match[1]}T00:00:00Z`);
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === match[1];
}

/** Presentation of verified server evidence, never authority to finish a task.
 * Missing/contradictory contracts fail to an explicit unknown label. No raw
 * values or unknown properties escape into text, classes or component state.
 */
export function productionResultStatus(value, visitRevision) {
  if (value === null) return statuses.pending;
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !positive(visitRevision)
      || !['id', 'visita_revision', 'revision_resultante', 'registrado_at', 'parcial', 'vigente'].every(key => Object.hasOwn(value, key))
      || !uuid(value.id) || !positive(value.visita_revision) || value.visita_revision >= MAX_REVISION
      || value.revision_resultante !== value.visita_revision + 1 || value.revision_resultante > visitRevision
      || !timestamp(value.registrado_at) || typeof value.parcial !== 'boolean' || typeof value.vigente !== 'boolean'
      || value.vigente !== (value.revision_resultante === visitRevision)) return statuses.unknown;
    if (!value.vigente) return statuses.outdated;
    return value.parcial ? statuses.partial : statuses.complete;
  } catch { return statuses.unknown; }
}
