export function normalizeManualFinance(body = {}) {
  const fields = ["facturacion", "sueldos", "impuestos", "herramientas"];
  const normalized = {};
  for (const field of fields) {
    const value = Number(body[field]);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error("Los importes deben ser números iguales o mayores a cero.");
    }
    normalized[field] = value;
  }
  return normalized;
}

export function buildManualFinanceSummary(row = {}, period = "") {
  const facturacion = Number(row.facturacion || 0);
  const sueldos = Number(row.sueldos || 0);
  const impuestos = Number(row.impuestos || 0);
  const herramientas = Number(row.herramientas || 0);
  return {
    period,
    facturacion,
    sueldos,
    impuestos,
    herramientas,
    resultado: facturacion - sueldos - impuestos - herramientas,
    updatedAt: row.updated_at || null,
  };
}
