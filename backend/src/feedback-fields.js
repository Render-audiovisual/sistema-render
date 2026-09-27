export function normalizeFeedback(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('Los datos del feedback no son válidos.'), { status: 400 });
  }
  const result = {};
  for (const [key, max] of Object.entries({ cliente: 200, responsable: 200, referencia: 2000 })) {
    if (value[key] != null && typeof value[key] !== 'string') {
      throw Object.assign(new Error(`El campo ${key} debe ser texto.`), { status: 400 });
    }
    result[key] = (value[key] || '').trim();
    if (result[key].length > max) throw Object.assign(new Error(`El campo ${key} es demasiado largo.`), { status: 400 });
  }
  if (value.responsables != null && !Array.isArray(value.responsables)) {
    throw Object.assign(new Error('El campo responsables debe ser una lista.'), { status: 400 });
  }
  const responsables = [...(value.responsables || []), result.responsable]
    .map((item) => {
      if (typeof item !== 'string') throw Object.assign(new Error('Cada responsable debe ser texto.'), { status: 400 });
      const nombre = item.trim();
      if (nombre.length > 200) throw Object.assign(new Error('Un responsable es demasiado largo.'), { status: 400 });
      return nombre;
    })
    .filter(Boolean)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.toLocaleLowerCase('es') === item.toLocaleLowerCase('es')) === index);
  if (responsables.length > 20) throw Object.assign(new Error('No se pueden asignar más de 20 responsables.'), { status: 400 });
  result.responsables = responsables;
  result.responsable = responsables[0] || '';
  result.estado = value.estado === 'resuelto' ? 'resuelto' : 'pendiente';
  result.vigencia = value.vigencia === 'permanente' ? 'permanente' : 'puntual';
  result.flujo = value.flujo === 'feedback' ? 'feedback' : '';
  if (value.origen === 'mia_whatsapp') result.origen = 'mia_whatsapp';
  if (typeof value.wilson_idempotency_key === 'string' && value.wilson_idempotency_key.trim()) {
    result.wilson_idempotency_key = value.wilson_idempotency_key.trim().slice(0, 200);
  }
  if (typeof value.confirmado_por === 'string' && value.confirmado_por.trim()) {
    result.confirmado_por = value.confirmado_por.trim().slice(0, 200);
  }
  return result;
}
