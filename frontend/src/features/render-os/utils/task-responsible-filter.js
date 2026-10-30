const MAX_USER_ID = 2147483647;
const validId = value => Number.isSafeInteger(value) && value > 0 && value <= MAX_USER_ID;

export function responsibleFilterId(value) {
  if (typeof value !== 'string' || !/^id:[1-9][0-9]*$/.test(value)) return null;
  const id = Number(value.slice(3));
  return validId(id) ? id : null;
}

export function resolveResponsibleFilter(value, users = [], catalogReady = false, completeCatalog = false) {
  if (value === 'all') return { status: 'all', value: 'all', ready: true, message: '' };
  const id = responsibleFilterId(value);
  if (id !== null) return { status: 'id', value, ready: true, message: '' };
  if (typeof value !== 'string' || !value || value.startsWith('id:') || value.startsWith('invalid:')) {
    return { status: 'invalid', value, ready: false, message: 'El filtro de responsable no es válido. Elegí un integrante.' };
  }
  if (!catalogReady) return { status: 'pending', value, ready: false, message: '' };
  if (!completeCatalog) return { status: 'unresolved', value, ready: false,
    message: 'El filtro antiguo usa un nombre. Elegí un integrante por su ID para conservarlo sin ambigüedad.' };
  const ids = new Set(users.filter(user => validId(user?.id) && (user.nombre === value || user.usuario === value)).map(user => user.id));
  if (ids.size === 1) return { status: 'resolved', value: `id:${[...ids][0]}`, ready: false, message: '' };
  return { status: 'unresolved', value, ready: false,
    message: ids.size > 1 ? 'El filtro guardado coincide con más de una persona. Elegí un integrante por su ID.'
      : 'El responsable guardado ya no está identificado en el equipo. Elegí un integrante.' };
}

export function taskMatchesResponsible(task, value) {
  if (value === 'all') return true;
  const id = responsibleFilterId(value);
  return id !== null && (task.asignado_a_id === id
    || (Array.isArray(task.colaborador_ids) && task.colaborador_ids.some(member => validId(member) && member === id)));
}

export function buildResponsibleOptions(users = [], tasks = [], selected = 'all') {
  const people = new Map();
  for (const user of users) {
    if (!validId(user?.id) || people.has(user.id)) continue;
    const name = typeof user.nombre === 'string' && user.nombre.trim() ? user.nombre.trim() : 'No disponible';
    people.set(user.id, { value: `id:${user.id}`, label: name });
  }
  const ids = tasks.flatMap(task => [task.asignado_a_id, ...(Array.isArray(task.colaborador_ids) ? task.colaborador_ids : [])]);
  ids.push(responsibleFilterId(selected));
  for (const id of ids) if (validId(id) && !people.has(id)) {
    people.set(id, { value: `id:${id}`, label: 'No disponible' });
  }
  return [...people.values()].sort((a, b) => a.label.localeCompare(b.label, 'es') || responsibleFilterId(a.value) - responsibleFilterId(b.value));
}
