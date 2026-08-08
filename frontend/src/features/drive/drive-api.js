export async function driveRequest(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || "No se pudo completar la operación con Drive.");
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

export const driveStatus = () => driveRequest("/api/drive/status");
export const driveFiles = (parent, query = "") => driveRequest(`/api/drive/files?parent=${encodeURIComponent(parent)}&q=${encodeURIComponent(query)}`);
export const driveUploadPlan = (taskId) => driveRequest(`/api/drive/upload-plan?task_id=${encodeURIComponent(taskId)}`);

export async function uploadFileToDrive(file, { parentId, taskId, duplicateAction, onProgress }) {
  const session = await driveRequest("/api/drive/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, mimeType: file.type || "application/octet-stream", size: file.size, parentId, taskId, duplicateAction }),
  });
  const chunkSize = 8 * 1024 * 1024;
  let offset = 0;
  let completed = null;
  while (offset < file.size || (file.size === 0 && offset === 0)) {
    const end = file.size === 0 ? 0 : Math.min(file.size, offset + chunkSize);
    const chunk = file.slice(offset, end);
    let attempts = 0;
    let response;
    while (attempts < 3) {
      attempts += 1;
      try {
        response = await fetch(`/api/drive/uploads/${encodeURIComponent(session.token)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream", "Content-Range": file.size === 0 ? "bytes */0" : `bytes ${offset}-${end - 1}/${file.size}` },
          body: chunk,
        });
        if (response.ok) break;
      } catch {
        if (attempts === 3) throw new Error("La carga se interrumpió. Revisá tu conexión e intentá nuevamente.");
      }
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "No se pudo subir una parte del archivo.");
    if (response.status === 200) completed = body;
    offset = file.size === 0 ? 1 : end;
    onProgress?.(file.size ? Math.round((end / file.size) * 100) : 100);
  }
  return completed;
}
