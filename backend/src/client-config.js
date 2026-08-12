export const CLIENT_DESIGNERS = ["Augusto", "Mariano"];

export function normalizePeriod(value, fallback = new Date()) {
  const raw = String(value || "");
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) return `${raw}-01`;
  const year = fallback.getFullYear();
  const month = String(fallback.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

export function normalizeClientConfiguration(body = {}) {
  const cuota_reels = Number(body.cuota_reels);
  const cuota_carruseles = Number(body.cuota_carruseles);
  const abono_mensual = Number(body.abono_mensual);
  const dias_historias = [...new Set((body.dias_historias || []).map(Number))].sort();
  const disenador_responsable = String(body.disenador_responsable || "").trim();

  if (![cuota_reels, cuota_carruseles].every(Number.isInteger) || cuota_reels < 0 || cuota_carruseles < 0) {
    throw new Error("Las cuotas deben ser números enteros iguales o mayores a 0.");
  }
  if (!Number.isFinite(abono_mensual) || abono_mensual < 0) {
    throw new Error("El abono mensual debe ser un importe igual o mayor a 0.");
  }
  if (!dias_historias.length || dias_historias.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new Error("Elegí al menos un día válido para publicar historias.");
  }
  if (!CLIENT_DESIGNERS.includes(disenador_responsable)) {
    throw new Error("Elegí un diseñador responsable válido.");
  }
  return { cuota_reels, cuota_carruseles, abono_mensual, dias_historias, disenador_responsable };
}
