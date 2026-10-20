import React, { useEffect, useRef, useState } from "react";
import { driveFiles, driveUploadPlan, uploadFileToDrive } from "./drive-api.js";
import { getSesion } from '../../utils.jsx';
import { createCapturedRequest } from '../../shared/session/captured-request.js';
import { useSessionView } from '../../shared/session/use-session-view.js';

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
    operation.current?.abort(); const controller = new AbortController(); operation.current = controller;
    const stamp = ++generation.current;
    const scope = createCapturedRequest({ session, readSession: getSesion, isActive: () => isActive() && stamp === generation.current,
      request: (_url, options) => driveUploadPlan(task.id, options) });
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
    const stamp = ++generation.current, controller = new AbortController(); operation.current?.abort(); operation.current = controller;
    const scope = createCapturedRequest({ session, readSession: getSesion, isActive: () => isActive() && stamp === generation.current });
    setUploading(true); setError(""); setDuplicate(null);
    try {
      const uploaded = await uploadFileToDrive(file, { parentId: destination.folder.id, taskId: task?.id, duplicateAction,
        session, readSession: getSesion, signal: controller.signal, isActive: scope.current,
        onProgress: value => { if (scope.current()) setProgress(value); } });
      scope.assertCurrent();
      setFile(null); setProgress(100); if (inputRef.current) inputRef.current.value = "";
      await onUploaded?.(uploaded, scope);
      scope.assertCurrent();
    } catch (reason) {
      if (!scope.current()) return;
      if (reason.status === 409 && reason.body?.duplicate) setDuplicate(reason.body.duplicate);
      else setError(reason.message);
    } finally { pending.current = false; if (scope.current()) setUploading(false); }
  };

  return <div className="drive-uploader">
    <input ref={inputRef} type="file" onChange={choose} disabled={uploading}/>
    {!file ? <button className="drive-upload-trigger" type="button" onClick={() => inputRef.current?.click()}><span>＋</span><div><strong>Subir archivo</strong><small>{task ? "Lo vincularemos automáticamente con esta tarea." : "Seleccioná cualquier tipo de archivo."}</small></div></button> : <div className="drive-upload-ready"><div><strong>{file.name}</strong><small>{destination?.breadcrumb || destination?.reason || "Buscando la carpeta correcta…"}</small></div>{destination?.status === "resolved" ? <button type="button" disabled={uploading} onClick={() => upload()}>{uploading ? `${progress}%` : "Subir"}</button> : <button type="button" onClick={() => setPickerRoot(destination?.root)}>Elegir carpeta</button>}</div>}
    {uploading && <div className="drive-progress"><i style={{ width: `${progress}%` }}/></div>}
    {duplicate && <div className="drive-duplicate"><strong>Ya existe “{duplicate.name}”.</strong><span>¿Qué querés hacer?</span><div><button type="button" onClick={() => { setDuplicate(null); setFile(null); }}>Cancelar</button><button type="button" onClick={() => upload("keep")}>Conservar ambos</button>{mayReplace && <button className="danger" type="button" onClick={() => upload("replace")}>Reemplazar</button>}</div></div>}
    {error && <p className="drive-error">{error}</p>}
    {pickerRoot && <div className="drive-picker-backdrop"><FolderPicker root={pickerRoot} session={session} readSession={getSesion} isActive={isActive} onClose={() => setPickerRoot(null)} onSelect={(folder) => {
      const scope = createCapturedRequest({ session, readSession: getSesion, isActive });
      if (!scope.current()) return;
      setDestination({ status: "resolved", folder, breadcrumb: folder.name }); setPickerRoot(null);
    }}/></div>}
  </div>;
}
