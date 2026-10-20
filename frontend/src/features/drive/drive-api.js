import { createCapturedRequest, isSessionFailure } from '../../shared/session/captured-request.js';
import { getApplicationSession } from '../../shared/session/application-session-access.js';

export async function driveRequest(url, options, request = fetch) {
  const response = await request(url, options);
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error || "No se pudo completar la operación con Drive.");
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

export const driveStatus = options => driveRequest("/api/drive/status", options);
export const driveFiles = (parent, query = "", options) => driveRequest(`/api/drive/files?parent=${encodeURIComponent(parent)}&q=${encodeURIComponent(query)}`, options);
export const driveUploadPlan = (taskId, options) => driveRequest(`/api/drive/upload-plan?task_id=${encodeURIComponent(taskId)}`, options);
export const publicationUploadPlan = options => driveRequest("/api/drive/publication-upload-plan", options);

export async function uploadFileToDrive(file, { parentId, taskId, duplicateAction, onProgress,
  readSession = () => getApplicationSession()?.getSession(), session = readSession(), request = fetch,
  signal, isActive = () => true }) {
  const scope = createCapturedRequest({ session, readSession, request, isActive: () => !signal?.aborted && isActive() });
  const read = async response => {
    try { const body = await response.json(); scope.assertCurrent(); return body; }
    catch (error) { scope.assertCurrent(); throw error; }
  };
  const check = (response, body) => {
    if (response.ok) return;
    const error = new Error(body?.error || 'No se pudo completar la operación con Drive.');
    error.status = response.status; error.body = body; throw error;
  };
  const planned = await scope.request("/api/drive/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, mimeType: file.type || "application/octet-stream", size: file.size, parentId, taskId, duplicateAction }),
    signal,
  });
  const upload = await read(planned); check(planned, upload);
  if (typeof upload?.token !== 'string' || !upload.token.trim()) throw new Error('La respuesta de carga de Drive no es válida.');
  const chunkSize = 8 * 1024 * 1024;
  let offset = 0;
  let completed = null;
  while (offset < file.size || (file.size === 0 && offset === 0)) {
    const end = file.size === 0 ? 0 : Math.min(file.size, offset + chunkSize);
    const chunk = file.slice(offset, end);
    let attempts = 0;
    let body, response;
    const url = `/api/drive/uploads/${encodeURIComponent(upload.token)}`;
    const settings = { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream',
      'Content-Range': file.size === 0 ? 'bytes */0' : `bytes ${offset}-${end - 1}/${file.size}` }, body: chunk, signal };
    while (attempts < 3) {
      attempts += 1;
      try {
        response = await scope.request(url, settings);
        body = await read(response); check(response, body); break;
      } catch (error) {
        scope.assertCurrent();
        if (signal?.aborted || error?.name === 'AbortError' || isSessionFailure(error)
          || !(error instanceof TypeError || [500, 502, 503, 504].includes(error?.status)) || attempts === 3) throw error;
      }
    }
    if (response.status === 200) completed = body;
    offset = file.size === 0 ? 1 : end;
    scope.assertCurrent(); onProgress?.(file.size ? Math.round((end / file.size) * 100) : 100); scope.assertCurrent();
  }
  scope.assertCurrent();
  return completed;
}
