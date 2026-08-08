import React, { useEffect, useRef, useState } from "react";
import { driveFiles, driveUploadPlan, uploadFileToDrive } from "./drive-api.js";

function FolderPicker({ root, onSelect, onClose }) {
  const [stack, setStack] = useState([{ id: root.id, name: root.label }]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const current = stack[stack.length - 1];
  useEffect(() => {
    setLoading(true);
    driveFiles(current.id).then((items) => setFolders(items.filter((item) => item.isFolder))).finally(() => setLoading(false));
  }, [current.id]);
  return <div className="drive-folder-picker">
    <header><div><strong>Elegir carpeta</strong><small>{stack.map((item) => item.name).join(" / ")}</small></div><button type="button" onClick={onClose}>×</button></header>
    {stack.length > 1 && <button className="drive-folder-back" type="button" onClick={() => setStack((items) => items.slice(0, -1))}>← Volver</button>}
    <div className="drive-folder-list">{loading ? <p>Cargando carpetas…</p> : folders.map((folder) => <button type="button" key={folder.id} onClick={() => setStack((items) => [...items, folder])}><span>▰</span><strong>{folder.name}</strong><b>›</b></button>)}</div>
    <footer><button type="button" onClick={onClose}>Cancelar</button><button className="primary" type="button" onClick={() => onSelect(current)}>Usar esta carpeta</button></footer>
  </div>;
}

export function DriveUploader({ task, currentFolder, canReplace, onUploaded }) {
  const inputRef = useRef(null);
  let sessionCanReplace = false;
  try { sessionCanReplace = JSON.parse(localStorage.getItem("render_sesion") || "null")?.usuario?.rol === "admin"; } catch { sessionCanReplace = false; }
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
    const selected = event.target.files?.[0] || null;
    setFile(selected); setError(""); setDuplicate(null); setProgress(0);
    if (!selected || currentFolder || !task) return;
    try {
      const plan = await driveUploadPlan(task.id);
      setDestination(plan);
      if (plan.status !== "resolved") setPickerRoot(plan.root);
    } catch (reason) { setError(reason.message); }
  };

  const upload = async (duplicateAction = "") => {
    if (!file || !destination?.folder?.id || uploading) return;
    setUploading(true); setError(""); setDuplicate(null);
    try {
      const uploaded = await uploadFileToDrive(file, { parentId: destination.folder.id, taskId: task?.id, duplicateAction, onProgress: setProgress });
      setFile(null); setProgress(100); if (inputRef.current) inputRef.current.value = "";
      onUploaded?.(uploaded);
    } catch (reason) {
      if (reason.status === 409 && reason.body?.duplicate) setDuplicate(reason.body.duplicate);
      else setError(reason.message);
    } finally { setUploading(false); }
  };

  return <div className="drive-uploader">
    <input ref={inputRef} type="file" onChange={choose}/>
    {!file ? <button className="drive-upload-trigger" type="button" onClick={() => inputRef.current?.click()}><span>＋</span><div><strong>Subir archivo</strong><small>{task ? "Lo vincularemos automáticamente con esta tarea." : "Seleccioná cualquier tipo de archivo."}</small></div></button> : <div className="drive-upload-ready"><div><strong>{file.name}</strong><small>{destination?.breadcrumb || destination?.reason || "Buscando la carpeta correcta…"}</small></div>{destination?.status === "resolved" ? <button type="button" disabled={uploading} onClick={() => upload()}>{uploading ? `${progress}%` : "Subir"}</button> : <button type="button" onClick={() => setPickerRoot(destination?.root)}>Elegir carpeta</button>}</div>}
    {uploading && <div className="drive-progress"><i style={{ width: `${progress}%` }}/></div>}
    {duplicate && <div className="drive-duplicate"><strong>Ya existe “{duplicate.name}”.</strong><span>¿Qué querés hacer?</span><div><button type="button" onClick={() => { setDuplicate(null); setFile(null); }}>Cancelar</button><button type="button" onClick={() => upload("keep")}>Conservar ambos</button>{mayReplace && <button className="danger" type="button" onClick={() => upload("replace")}>Reemplazar</button>}</div></div>}
    {error && <p className="drive-error">{error}</p>}
    {pickerRoot && <div className="drive-picker-backdrop"><FolderPicker root={pickerRoot} onClose={() => setPickerRoot(null)} onSelect={(folder) => { setDestination({ status: "resolved", folder, breadcrumb: folder.name }); setPickerRoot(null); }}/></div>}
  </div>;
}
