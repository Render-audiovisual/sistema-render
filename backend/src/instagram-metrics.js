// Utilidades compartidas por el panel y los reportes de Instagram (sin efectos al importar).
export const num = value => (value === null || value === undefined ? null : Number(value));
export function interactions(row) {
  if (row.interacciones !== null && row.interacciones !== undefined) return Number(row.interacciones);
  const parts = [row.likes, row.comentarios, row.guardados, row.compartidos].map(num).filter(v => v !== null);
  return parts.length ? parts.reduce((a, b) => a + b, 0) : null;
}

export function responsablesDe(row) {
  const names = new Set();
  for (const value of [...(Array.isArray(row.responsables_objetivo) ? row.responsables_objetivo : []),
    row.responsable_diseno, row.responsable_edicion]) {
    if (typeof value === 'string' && value.trim()) names.add(value.trim());
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'es'));
}
