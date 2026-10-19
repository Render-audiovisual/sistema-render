const SERVER_FEEDBACK_FIELDS = new Set([
  'origen', 'confirmado_por', 'confirmado_por_id', 'confirmado_at',
  'provenance_version', 'wilson_idempotency_key',
]);

// Shared editing is intentional, but caller-controlled JSON is never proof of confirmation.
export function assertFeedbackBusinessInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('Los datos del feedback no son válidos.'), { status: 400 });
  }
  for (const key of SERVER_FEEDBACK_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw Object.assign(new Error('El origen y la confirmación del feedback los registra el servidor.'), { status: 400 });
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, 'feedback')) assertFeedbackBusinessInput(value.feedback);
}

export function withServerFeedbackProvenance(business, { userId, name, channel, at = new Date().toISOString() }) {
  if (!Number.isSafeInteger(userId) || userId <= 0 || typeof name !== 'string' || !name.trim()
    || !['whatsapp', 'telegram'].includes(channel) || !Number.isFinite(Date.parse(at))) {
    throw new Error('Identidad de confirmación de feedback inválida.');
  }
  return {
    ...normalizeFeedback(business),
    origen: channel === 'whatsapp' ? 'mia_whatsapp' : 'wilson_telegram',
    confirmado_por: name.trim(), confirmado_por_id: userId,
    confirmado_at: new Date(at).toISOString(), provenance_version: 1,
  };
}

export function normalizeFeedback(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('Los datos del feedback no son válidos.'), { status: 400 });
  }
  assertFeedbackBusinessInput(value);
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
  return result;
}
