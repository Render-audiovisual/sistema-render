export function getUnifiedTaskContent(task = {}) {
  const metadata = task.propiedades_extra || {};
  const parts = [task.aclaraciones, metadata.guiones, metadata.copy_trabajo]
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const unique = [];
  for (const part of parts) {
    if (!unique.some((existing) => existing === part || existing.includes(part))) unique.push(part);
  }
  return unique.join("\n\n");
}

export function getCanonicalTaskContentMetadata(metadata = {}) {
  return { ...metadata, guiones: "", copy_trabajo: "" };
}
