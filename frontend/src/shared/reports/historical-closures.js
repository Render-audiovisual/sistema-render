const keys = (value, expected) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length === expected.length && expected.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value');
  });
};
const positiveId = value => Number.isInteger(value) && value > 0 && value <= 2147483647;
const periodValid = value => typeof value === 'string'
  && value.length === 10 && /^(?!0000)\d{4}-(0[1-9]|1[0-2])-01$/.test(value);
function timestampValid(value) {
  if (typeof value !== 'string') return false;
  const match = /^(?!0000)\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match || match[0] !== value) return false;
  const day = value.slice(0, 10);
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day
    && Number.isFinite(Date.parse(value));
}

// Evidence only: no roster/name lookup, task mutation or period filtering.
// null means unverified payload, distinct from a verified unavailable archive.
export function verifyHistoricalClosures(value) {
  if (!keys(value, ['disponible', 'registros']) || typeof value.disponible !== 'boolean'
    || !Array.isArray(value.registros) || (!value.disponible && value.registros.length)) return null;
  const seen = new Set(), registros = [];
  for (const row of value.registros) {
    if (!keys(row, ['periodo', 'usuario_id', 'nombre_snapshot', 'porcentaje', 'registrado_at'])
      || !periodValid(row.periodo) || !positiveId(row.usuario_id)
      || typeof row.nombre_snapshot !== 'string' || !Number.isInteger(row.porcentaje)
      || row.porcentaje < 0 || row.porcentaje > 100
      || (row.registrado_at !== null && !timestampValid(row.registrado_at))) return null;
    const key = `${row.periodo}:${row.usuario_id}`;
    if (seen.has(key)) return null;
    seen.add(key);
    registros.push(Object.freeze({ periodo: row.periodo, usuario_id: row.usuario_id,
      nombre_snapshot: row.nombre_snapshot, porcentaje: row.porcentaje, registrado_at: row.registrado_at }));
  }
  return Object.freeze({ disponible: value.disponible, registros: Object.freeze(registros) });
}
