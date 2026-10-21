import { createCapturedRequest } from '../../shared/session/captured-request.js';
import { getApplicationSession } from '../../shared/session/application-session-access.js';

function driveFailure(response,body){
  const message=typeof body?.error==='string'&&body.error.length<=500?body.error:'No se pudo completar la operación con Drive.';
  const error=new Error(message);error.status=response.status;
  if(typeof body?.code==='string'&&body.code.trim()===body.code&&/^[A-Z][A-Z0-9_]{0,99}$/.test(body.code))error.code=body.code;
  if(typeof body?.retryable==='boolean')error.retryable=body.retryable;
  error.body={...(error.code?{code:error.code}:{}),...(typeof error.retryable==='boolean'?{retryable:error.retryable}:{}),
    ...(body?.duplicate&&typeof body.duplicate.id==='string'&&typeof body.duplicate.name==='string'?{duplicate:{id:body.duplicate.id,name:body.duplicate.name}}:{})};
  return error;
}
export function verifiedDriveUpload(value,expected){
  if(!value||typeof value.id!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(value.id)||value.id.trim()!==value.id
    ||typeof value.name!=='string'||!value.name.trim()||value.name.length>1000
    ||typeof value.mimeType!=='string'||!value.mimeType||value.mimeType.length>255
    ||!Number.isSafeInteger(value.size)||value.size<0
    ||value.webViewLink!==`https://drive.google.com/file/d/${value.id}/view`
    ||(expected&&(value.name!==expected.name||value.mimeType!==expected.mimeType||value.size!==expected.size)))throw new Error('No pudimos confirmar el archivo guardado. Revisá Drive antes de otra carga.');
  return value;
}
export async function driveRequest(url, options, request = fetch) {
  const response = await request(url, options);
  let body;try{body=await response.json();}catch(error){error.status=response.status;throw error;}
  if (!response.ok) throw driveFailure(response,body);
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
  let stage='init';
  const read = async response => {
    try { const body = await response.json(); scope.assertCurrent(); return body; }
    catch (error) { scope.assertCurrent();error.status=response.status; throw error; }
  };
  const check = (response, body) => {if(!response.ok)throw driveFailure(response,body);};
  try{
    const planned = await scope.request("/api/drive/uploads", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, mimeType: file.type || "application/octet-stream", size: file.size, parentId, taskId, duplicateAction }), signal,
    });
    const upload = await read(planned); check(planned, upload);
    if (planned.status!==201||typeof upload?.token !== 'string' || !upload.token.trim()||typeof upload.name!=='string'||!upload.name.trim()||upload.name.length>1000) throw new Error('La respuesta de carga de Drive no es válida.');
    const expected=Object.freeze({name:upload.name,mimeType:file.type||'application/octet-stream',size:file.size});
    stage='chunk';
    const chunkSize = 8 * 1024 * 1024;
    let offset = 0;
    while (offset < file.size || (file.size === 0 && offset === 0)) {
      const end = file.size === 0 ? 0 : Math.min(file.size, offset + chunkSize);
      const chunk = file.slice(offset, end);
      const response=await scope.request(`/api/drive/uploads/${encodeURIComponent(upload.token)}`,{
        method:'PUT',headers:{'Content-Type':'application/octet-stream','Content-Range':file.size===0?'bytes */0':`bytes ${offset}-${end-1}/${file.size}`},body:chunk,signal,
      });
      const body=await read(response);check(response,body);
      if(response.status===200){
        if(end!==file.size)throw new Error('Drive confirmó una carga antes de recibir todo el archivo. Revisá su estado.');
        verifiedDriveUpload(body,expected);scope.assertCurrent();onProgress?.(100);scope.assertCurrent();return body;
      }
      if(response.status!==202||file.size===0||end===file.size||body?.received!==`bytes=0-${end-1}`)throw new Error('No se pudo confirmar la parte recibida. Revisá Drive antes de otra carga.');
      offset=end;scope.assertCurrent();onProgress?.(Math.min(99,Math.round(end/file.size*100)));scope.assertCurrent();
    }
    throw new Error('No pudimos confirmar la carga completa. Revisá Drive antes de otra carga.');
  }catch(error){
    scope.assertCurrent();error.uploadStage=stage;
    // No automatic retransmission: no response, malformed bodies and 5xx can
    // follow a committed Google write or a partly completed replacement.
    if(error.retryable===false||!error.status||error.status>=500||error instanceof SyntaxError)error.retryable=false;
    throw error;
  }
}
