import React, { useEffect, useState } from "react";
import { DriveUploader } from "../features/drive/DriveUploader.jsx";
import { driveFiles, driveRequest, driveStatus } from "../features/drive/drive-api.js";
import "./Drive.css";

const ROOT_LABELS = { general: "Render", augusto: "Diseño · Augusto", mariano: "Diseño · Mariano Mesa" };

function fileSize(value) {
  if (!value) return "Archivo de Google";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function DrivePage({ sesion }) {
  const [status, setStatus] = useState(null);
  const [rootKey, setRootKey] = useState("general");
  const [stack, setStack] = useState([]);
  const [files, setFiles] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const isAdmin = sesion?.usuario?.rol === "admin";
  const current = stack[stack.length - 1];

  const load = (parent = current?.id, search = query) => {
    if (!parent) return;
    setLoading(true); setError("");
    driveFiles(parent, search).then(setFiles).catch((reason) => setError(reason.message)).finally(() => setLoading(false));
  };

  useEffect(() => {
    driveStatus().then((data) => {
      setStatus(data);
      const first = { id: data.roots.general, name: ROOT_LABELS.general };
      setStack([first]);
    }).catch((reason) => setError(reason.message));
  }, []);
  useEffect(() => { if (current?.id && status?.connected) load(current.id, query); }, [current?.id, status?.connected]);
  useEffect(() => { if (!current?.id || !status?.connected) return; const timer = setTimeout(() => load(current.id, query), 250); return () => clearTimeout(timer); }, [query]);

  const selectRoot = (key) => { setRootKey(key); setQuery(""); setStack([{ id: status.roots[key], name: ROOT_LABELS[key] }]); };
  const connect = async () => { const result = await driveRequest("/api/drive/connect", { method: "POST" }); window.location.href = result.url; };
  const trash = async (file) => {
    if (!window.confirm(`¿Enviar “${file.name}” a la papelera de Google Drive?`)) return;
    await driveRequest(`/api/drive/files/${file.id}`, { method: "DELETE" }); load();
  };

  return <main className="drive-page">
    <header className="drive-page-header"><div><span className="drive-kicker">ARCHIVOS DEL EQUIPO</span><h1>Drive</h1><p>Encontrá y cargá material sin salir de Render OS.</p></div>{status?.connected && <a href={`https://drive.google.com/drive/folders/${current?.id || status.roots.general}`} target="_blank" rel="noreferrer">Abrir en Google Drive ↗</a>}</header>
    {!status?.connected ? <section className="drive-connect"><span className="drive-logo">▰</span><h2>Conectá el Drive de Render</h2><p>Los archivos seguirán guardados en Google Drive. Render OS solo simplifica la carga y el acceso.</p>{isAdmin ? <button type="button" disabled={!status?.configured} onClick={connect}>Conectar Google Drive</button> : <strong>Un líder debe realizar la conexión inicial.</strong>}{status && !status.configured && <small>Falta configurar el acceso de Google en Hostinger.</small>}</section> : <>
      <section className="drive-toolbar"><div className="drive-roots">{Object.keys(ROOT_LABELS).map((key) => <button className={rootKey === key ? "active" : ""} type="button" key={key} onClick={() => selectRoot(key)}>{ROOT_LABELS[key]}</button>)}</div><label><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar en esta carpeta…"/></label></section>
      <section className="drive-browser"><div className="drive-breadcrumbs">{stack.map((folder, index) => <button type="button" key={folder.id} onClick={() => setStack((items) => items.slice(0, index + 1))}>{folder.name}{index < stack.length - 1 ? " /" : ""}</button>)}</div><DriveUploader currentFolder={current} onUploaded={() => load()}/>{error && <div className="drive-error-banner">{error}</div>}{loading ? <div className="drive-loading">Cargando archivos…</div> : files.length ? <div className="drive-grid">{files.map((file) => <article key={file.id} className={file.isFolder ? "folder" : "file"} onDoubleClick={() => file.isFolder && setStack((items) => [...items, { id: file.id, name: file.name }])}><button className="drive-file-main" type="button" onClick={() => file.isFolder ? setStack((items) => [...items, { id: file.id, name: file.name }]) : window.open(file.webViewLink, "_blank", "noopener,noreferrer")}><span>{file.isFolder ? "▰" : "▤"}</span><div><strong>{file.name}</strong><small>{file.isFolder ? "Carpeta" : fileSize(file.size)}</small></div></button>{isAdmin && !file.isFolder && <button className="drive-trash" type="button" aria-label={`Enviar ${file.name} a la papelera`} onClick={() => trash(file)}>⌫</button>}</article>)}</div> : <div className="drive-empty"><strong>No hay archivos para mostrar.</strong><span>{query ? "Probá otra búsqueda." : "Subí el primer archivo a esta carpeta."}</span></div>}</section>
    </>}
  </main>;
}
