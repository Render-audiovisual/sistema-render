const positiveId = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const nonEditorial = new Set([
  'desarrollo', 'administracion', 'web', 'pagina web', 'paginas web',
  'landing', 'landing page', 'chatbot', 'chatbots', 'mantenimiento',
  'automatizacion', 'automatizaciones',
]);
const explicitKind = value => typeof value === 'string'
  ? value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
  : '';

// Presentation only, never an ACL or proof of publication. Retain explicit
// historical editorial relationships even when the task type contradicts them.
export function isTaskEditorialContext(task) {
  const extra = task?.propiedades_extra;
  if ([task?.publicacion_id, task?.historia_id, task?.objetivo_id, task?.objetivo_pieza_id,
    extra?.objetivo_id, extra?.objetivo_pieza_id].some(positiveId)) return true;
  return !nonEditorial.has(explicitKind(task?.tipo_tarea)) && !nonEditorial.has(explicitKind(task?.subtipo));
}
