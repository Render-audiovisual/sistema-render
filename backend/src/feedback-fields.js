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
  return result;
}
