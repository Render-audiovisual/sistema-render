// Presentation of already-authorized, loaded tasks. Never resolve identity from
// legacy display names or grant access from membership in a visual group.
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const labelText = value => typeof value === 'string' ? value.trim() : '';
function uniqueTasks(tasks) {
  const seen = new Set();
  return (Array.isArray(tasks) ? tasks : []).filter(task => {
    if (!positiveId(task?.id) || seen.has(task.id)) return false;
    seen.add(task.id); return true;
  });
}
function finish(groups, idField) {
  const counts = new Map();
  const labelKey = label => label.normalize('NFC').toLocaleLowerCase('es');
  for (const group of groups) {
    const key = labelKey(group.label);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const group of groups) {
    if (group[idField] !== null && counts.get(labelKey(group.label)) > 1) group.label += ` · #${group[idField]}`;
  }
  return groups.sort((left, right) => {
    if (left[idField] === null) return right[idField] === null ? 0 : 1;
    if (right[idField] === null) return -1;
    return left.label.localeCompare(right.label, 'es', { numeric: true, sensitivity: 'base' }) || left[idField] - right[idField];
  });
}
export function groupTasksByResponsible(tasks, users = []) {
  const labels = new Map();
  for (const user of Array.isArray(users) ? users : []) {
    if (!positiveId(user?.id)) continue;
    const name = labelText(user.nombre) || labelText(user.usuario);
    if (!labels.has(user.id)) labels.set(user.id, new Set());
    if (name) labels.get(user.id).add(name);
  }
  const grouped = new Map();
  for (const task of uniqueTasks(tasks)) {
    const ids = [...new Set([task.asignado_a_id, ...(Array.isArray(task.colaborador_ids) ? task.colaborador_ids : [])].filter(positiveId))];
    for (const userId of ids.length ? ids : [null]) {
      const key = userId === null ? 'unassigned' : `user:${userId}`;
      if (!grouped.has(key)) {
        const names = labels.get(userId);
        const label = userId === null ? 'Sin responsable vinculado'
          : names?.size === 1 ? [...names][0] : `Usuario #${userId}`;
        grouped.set(key, { key, userId, label, tasks: [] });
      }
      grouped.get(key).tasks.push(task);
    }
  }
  return finish([...grouped.values()], 'userId');
}
export function groupTasksByClient(tasks) {
  const grouped = new Map(), names = new Map();
  for (const task of uniqueTasks(tasks)) {
    const clientId = positiveId(task.cliente_id) ? task.cliente_id : null;
    const key = clientId === null ? 'unassigned' : `client:${clientId}`;
    if (!grouped.has(key)) {
      grouped.set(key, { key, clientId, label: '', tasks: [] });
      names.set(key, new Set());
    }
    const name = labelText(task.cliente_nombre);
    if (name) names.get(key).add(name);
    grouped.get(key).tasks.push(task);
  }
  for (const group of grouped.values()) {
    const labels = names.get(group.key);
    group.label = group.clientId === null ? 'Sin cliente vinculado'
      : labels.size === 1 ? [...labels][0] : `Cliente #${group.clientId}`;
  }
  return finish([...grouped.values()], 'clientId');
}
