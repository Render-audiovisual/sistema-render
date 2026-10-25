// Optional by presence: callers must never turn an absent historical selection
// into an empty explicit selection, nor infer IDs from display labels.
export function normalizeFeedbackResponsibleIds(value) {
  if (!Array.isArray(value) || value.length > 20
    || value.some(id => !Number.isSafeInteger(id) || id < 1 || id > 2147483647)
    || new Set(value).size !== value.length) {
    throw Object.assign(new Error('Los responsables deben ser IDs únicos válidos (máximo 20).'), {status:400});
  }
  return [...value].sort((a,b) => a-b);
}
