export function isLinkedProductionEditorialTask(task = {}) {
  return Number.isSafeInteger(task.publicacion_id) && task.publicacion_id > 0
    && typeof task.propiedades_extra?.origen_produccion_video_id === "string"
    && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(task.propiedades_extra.origen_produccion_video_id);
}

export function getUnifiedTaskContent(task = {}) {
  const metadata = task.propiedades_extra || {};
  const parts = [task.aclaraciones, metadata.guiones, ...(isLinkedProductionEditorialTask(task) ? [] : [metadata.copy_trabajo])]
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const unique = [];
  for (const part of parts) {
    if (!unique.some((existing) => existing === part || existing.includes(part))) unique.push(part);
  }
  return unique.join("\n\n");
}

export function getCanonicalTaskContentMetadata(metadata = {}, { preserveEditorialCopy = false } = {}) {
  const result = { ...metadata, guiones: "" };
  if (preserveEditorialCopy) delete result.copy_trabajo;
  else result.copy_trabajo = "";
  return result;
}
