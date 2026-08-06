export function mergeRelatedTasks(current, incoming) {
  const merged = [...current];
  for (const item of incoming) {
    const index = merged.findIndex((task) => task.id === item.id);
    if (index >= 0) merged[index] = { ...merged[index], ...item };
    else merged.push({ ...item, __renderOsDirectOnly: true });
  }
  return merged;
}

function sameValue(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function normalizeActor(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

export function canUserMoveTask(task, user) {
  if (user?.rol === "admin") return true;
  const actorNames = new Set([user?.nombre, user?.usuario].map(normalizeActor).filter(Boolean));
  if (actorNames.size === 0) return false;
  const collaborators = Array.isArray(task?.propiedades_extra?.colaboradores)
    ? task.propiedades_extra.colaboradores
    : [];
  return [task?.asignado_a, ...collaborators]
    .map(normalizeActor)
    .some((name) => actorNames.has(name));
}

export function canRetryTaskUpdate(previous, current, changes) {
  if (!previous || !current || !changes) return false;
  return Object.entries(changes).every(([field, value]) => {
    if (field === "propiedades_extra" && value && typeof value === "object") {
      const previousMetadata = previous.propiedades_extra || {};
      const currentMetadata = current.propiedades_extra || {};
      return Object.keys(value).every((key) => sameValue(previousMetadata[key], currentMetadata[key]));
    }
    return sameValue(previous[field], current[field]);
  });
}
