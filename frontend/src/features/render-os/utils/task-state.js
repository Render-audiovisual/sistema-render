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
