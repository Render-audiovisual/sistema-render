import React, { useEffect, useRef, useState } from "react";
import { driveFiles, driveUploadPlan, uploadFileToDrive } from "./drive-api.js";
import { getSesion } from '../../utils.jsx';
import { createCapturedRequest } from '../../shared/session/captured-request.js';
import { useSessionView } from '../../shared/session/use-session-view.js';
import { createUploadRecovery } from './upload-recovery.js';
import './DriveUploader.css';

function FolderPicker({ root, onSelect, onClose, session, readSession, isActive }) {
  const [stack, setStack] = useState([{ id: root.id, name: root.label }]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const current = stack[stack.length - 1];
  useEffect(() => {
    let active = true; const controller = new AbortController();
    const scope = createCapturedRequest({ session, readSession, isActive: () => active && isActive(),
      request: (_url, options) => driveFiles(current.id, '', options) });
    setLoading(true); setFolders([]); setError('');
    scope.request('/api/drive/files', { signal: controller.signal }).then(items => {
      if (scope.current()) setFolders(items.filter(item => item.isFolder));
    }).catch(reason => { if (scope.current()) setError(reason.message); })
      .finally(() => { if (scope.current()) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [current.id, session, readSession, isActive]);
  return <div className="drive-folder-picker">
    <header><div><strong>Elegir carpeta</strong><small>{stack.map((item) => item.name).join(" / ")}</small></div><button type="button" onClick={onClose}>×</button></header>
    {stack.length > 1 && <button className="drive-folder-back" type="button" onClick={() => setStack((items) => items.slice(0, -1))}>← Volver</button>}
    <div className="drive-folder-list">{loading ? <p>Cargando carpetas…</p> : folders.map((folder) => <button type="button" key={folder.id} onClick={() => setStack((items) => [...items, folder])}><span>▰</span><strong>{folder.name}</strong><b>›</b></button>)}</div>
    {error && <p role="alert">{error}</p>}
    <footer><button type="button" onClick={onClose}>Cancelar</button><button className="primary" type="button" onClick={() => onSelect(current)}>Usar esta carpeta</button></footer>
  </div>;
}

export function DriveUploader({ task, currentFolder, canReplace, onUploaded }) {
  const view = useSessionView(getSesion());
  const context = `${view.key}:${task?.id ?? ''}:${currentFolder?.id ?? ''}`;
  const live = useRef(context); live.current = context;
  return <UploadScope key={context} task={task} currentFolder={currentFolder} canReplace={canReplace} onUploaded={onUploaded}
    session={view.session} context={context} live={live}/>;
}

function UploadScope({ task, currentFolder, canReplace, onUploaded, session, context, live }) {
  const inputRef = useRef(null);
  const recovery=useRef(null),uploadScope=useRef(null);
  const [recoveryState,setRecoveryState]=useState({blocked:false,confirmed:[]}),[refreshFailed,setRefreshFailed]=useState(false);
  const mounted = useRef(true), generation = useRef(0), operation = useRef(null), pending = useRef(false);
  const isActive = React.useCallback(() => mounted.current && live.current === context, [live, context]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; operation.current?.abort(); }; }, []);
  const sessionCanReplace = session?.usuario?.rol === 'admin';
  const mayReplace = canReplace ?? sessionCanReplace;
  const [destination, setDestination] = useState(currentFolder ? { status: "resolved", folder: currentFolder, breadcrumb: currentFolder.name } : null);
  const [pickerRoot, setPickerRoot] = useState(null);
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [duplicate, setDuplicate] = useState(null);

  useEffect(() => {
    if (currentFolder) setDestination({ status: "resolved", folder: currentFolder, breadcrumb: currentFolder.name });
  }, [currentFolder?.id]);

  const choose = async (event) => {
    if (pending.current || !isActive()) return;
    if(recovery.current?.snapshot.blocked||refreshFailed)return;
    recovery.current=null;uploadScope.current=null;setRecoveryState({blocked:false,confirmed:[]});setRefreshFailed(false);
    operation.current?.abort(); const controller = new AbortController(); operation.current = controller;
    const stamp = ++generation.current;
    const scope = createCapturedRequest({ session, readSession: getSesion, isActive: () => isActive() && stamp === generation.current,
      request: (_url, options) => driveUploadPlan(task.id, options) });
    if(!scope.current())return;
    const selected = event.target.files?.[0] || null;
    setFile(selected); setError(""); setDuplicate(null); setProgress(0);
    if (!selected || currentFolder || !task) return;
    try {
      const plan = await scope.request('/api/drive/upload-plan', { signal: controller.signal });
      scope.assertCurrent();
      setDestination(plan);
      if (plan.status !== "resolved") setPickerRoot(plan.root);
    } catch (reason) { if (scope.current()) setError(reason.message); }
  };

  const upload = async (duplicateAction = "") => {
    if (!file || !destination?.folder?.id || uploading || pending.current || !isActive()) return;
    pending.current = true;
    if(recovery.current?.snapshot.blocked){pending.current=false;return;}
    if(!recovery.current){
      const stamp=++generation.current,controller=new AbortController();operation.current?.abort();operation.current=controller;
      const original=createCapturedRequest({session,readSession:getSesion,isActive:()=>isActive()&&stamp===generation.current});uploadScope.current=original;
      recovery.current=createUploadRecovery({capture:()=>original,upload:uploadFileToDrive});
    }
    const scope=uploadScope.current,controller=operation.current;
    if(!scope.current()){pending.current=false;return;}
    let uploadConfirmed=false;
    setUploading(true); setError(""); setDuplicate(null);
    try {
      const files = await recovery.current.run([{file}], { parentId: destination.folder.id, taskId: task?.id, duplicateAction,
        session, readSession: getSesion, signal: controller.signal, isActive: scope.current,
      },value => { if (scope.current()) setProgress(value); });
      scope.assertCurrent();
      const uploaded=files[0];uploadConfirmed=true;setRecoveryState(recovery.current.snapshot);setRefreshFailed(false);
      setFile(null); setProgress(100); if (inputRef.current) inputRef.current.value = "";
      const refreshed=await onUploaded?.(uploaded, scope);
      scope.assertCurrent();
      if(refreshed===false)throw new Error('No se pudo actualizar la vista después de guardar el archivo.');
    } catch (reason) {
      if (!scope.current()) return;
      setRecoveryState(recovery.current.snapshot);
      if(uploadConfirmed){setRefreshFailed(true);setError('Archivo guardado en Drive; no pudimos actualizar la vista. Reintentá sólo la lectura.');}
      else if (reason.uploadStage==='init'&&reason.code==='DRIVE_DUPLICATE_REJECTED'&&reason.status === 409 && reason.body?.duplicate) setDuplicate(reason.body.duplicate);
      else setError(reason.message);
    } finally { pending.current = false; if (scope.current()) setUploading(false); }
  };
  const retryRefresh=async()=>{
    if(pending.current||!refreshFailed||!recovery.current?.snapshot.confirmed.length)return;
    const own=recovery.current,scope=own.scope;if(!scope.current())return;
    pending.current=true;setUploading(true);
    try{await own.refresh(async original=>{const refreshed=await onUploaded?.(own.snapshot.confirmed[0],original);if(refreshed===false)throw new Error('No se pudo actualizar la vista.');});scope.assertCurrent();setRefreshFailed(false);setError('');}
    catch{if(scope.current())setError('El archivo sigue guardado; no pudimos actualizar la vista. No se repitió la carga.');}
    finally{pending.current=false;if(scope.current())setUploading(false);}
  };

  return <div className="drive-uploader">
    <input ref={inputRef} type="file" onChange={choose} disabled={uploading||recoveryState.blocked||refreshFailed}/>
    {!file ? <button className="drive-upload-trigger" type="button" disabled={uploading||recoveryState.blocked||refreshFailed} onClick={() => inputRef.current?.click()}><span>＋</span><div><strong>Subir archivo</strong><small>{task ? "Lo vincularemos automáticamente con esta tarea." : "Seleccioná cualquier tipo de archivo."}</small></div></button> : <div className="drive-upload-ready"><div><strong>{file.name}</strong><small>{destination?.breadcrumb || destination?.reason || "Buscando la carpeta correcta…"}</small></div>{destination?.status === "resolved" ? <button type="button" disabled={uploading||recoveryState.blocked||refreshFailed} onClick={() => upload()}>{uploading ? `${progress}%` : "Subir"}</button> : <button type="button" onClick={() => setPickerRoot(destination?.root)}>Elegir carpeta</button>}</div>}
    {uploading && <div className="drive-progress"><i style={{ width: `${progress}%` }}/></div>}
    {duplicate && <div className="drive-duplicate"><strong>Ya existe “{duplicate.name}”.</strong><span>¿Qué querés hacer?</span><div><button type="button" onClick={() => { setDuplicate(null); setFile(null); }}>Cancelar</button><button type="button" onClick={() => upload("keep")}>Conservar ambos</button>{mayReplace && <button className="danger" type="button" onClick={() => upload("replace")}>Reemplazar</button>}</div></div>}
    {error && <p className="drive-error" role="alert">{error}</p>}
    {recoveryState.blocked&&<p className="drive-error" role="status">La carga puede haberse completado total o parcialmente. No se volverá a enviar. <a href="/drive">Revisar Drive manualmente</a>. Buscar por nombre no confirma el resultado. Al salir se pierde esta recuperación en memoria.</p>}
    {refreshFailed&&<button type="button" disabled={uploading} onClick={()=>void retryRefresh()}>Actualizar vista sin volver a subir</button>}
    {pickerRoot && <div className="drive-picker-backdrop"><FolderPicker root={pickerRoot} session={session} readSession={getSesion} isActive={isActive} onClose={() => setPickerRoot(null)} onSelect={(folder) => {
      const scope = createCapturedRequest({ session, readSession: getSesion, isActive });
      if (!scope.current()) return;
      setDestination({ status: "resolved", folder, breadcrumb: folder.name }); setPickerRoot(null);
    }}/></div>}
  </div>;
}
