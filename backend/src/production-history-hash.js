import { createHash } from 'node:crypto';
export function canonicalProductionValue(value) {
  if (Array.isArray(value)) return value.map(canonicalProductionValue);
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key,canonicalProductionValue(value[key])]));
  }
  return value;
}
export const productionValueHash = value => createHash('sha256').update(JSON.stringify(canonicalProductionValue(value))).digest('hex');
// Deliberately identical legacy history scope; never copy raw metadata to DTOs.
export function productionHistoryHash(source) {
  const properties = source?.propiedades_extra || {};
  return productionValueHash(Object.fromEntries(Object.keys(properties).filter(key => key.startsWith('produccion_')).sort().map(key => [key,properties[key]])));
}
