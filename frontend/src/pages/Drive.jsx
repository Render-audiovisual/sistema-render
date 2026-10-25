import React, { useCallback, useEffect, useRef, useState } from "react";
import { DriveUploader } from "../features/drive/DriveUploader.jsx";
import { driveFiles, driveRequest, driveStatus } from "../features/drive/drive-api.js";
import { getSesion } from '../utils.jsx';
import { useSessionView } from '../shared/session/use-session-view.js';
import { createCapturedRequest } from '../shared/session/captured-request.js';
import { requestDriveFolderChange } from '../features/drive/folder-navigation.js';
import "./Drive.css";

const ROOT_LABELS = { general: "Render", augusto: "Diseño · Augusto", mariano: "Diseño · Mariano Meza" };

function fileSize(value) {
  if (!value) return "Archivo de Google";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function DrivePage({ sesion }) {
  const view = useSessionView(sesion);
  const mounted = useRef(false), generation = useRef(0), live = useRef('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  const [status, setStatus] = useState(null);
  const [connectionPhase, setConnectionPhase] = useState('loading');
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const connectionRead = useRef(null);
  const [rootKey, setRootKey] = useState("general");
  const [stack, setStack] = useState([]);
  const [loadedFiles, setFiles] = useState([]);
  const [loadedContext, setLoadedContext] = useState(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [folderReadError, setFolderReadError] = useState(false);
  const isAdmin = view.role === "admin";
  const current = stack[stack.length - 1];
  const context = JSON.stringify([view.key, current?.id, query]); live.current = context;
  const files = loadedContext === context && !folderReadError ? loadedFiles : [];

  const load = useCallback(async (parent = current?.id, search = query, uploadScope = null) => {
    if (!parent) return false;
    uploadScope?.assertCurrent();
    const key = JSON.stringify([view.key, parent, search]);
    let observed = generation.current;
    const guard = createCapturedRequest({ session: view.session, readSession: getSesion,
      request: (_url, options) => driveFiles(parent, search, options),
      isActive: () => mounted.current && live.current === key && generation.current === observed && (!uploadScope || uploadScope.current()) });
    if (!guard.current()) return false;
    observed = ++generation.current;
    setLoading(true); setError(""); setFolderReadError(false);
    try {
      const items = await guard.request('/api/drive/files', uploadScope?.options());
      guard.assertCurrent(); setFiles(items); setLoadedContext(key); return true;
    } catch { if (guard.current()) { setFolderReadError(true); setError('No pudimos consultar esta carpeta. Volvé a intentarlo.'); } return false; }
    finally { if (guard.current()) setLoading(false); }
  }, [current?.id, query, view]);

  useEffect(() => {
    let active = true; const controller = new AbortController();
    const observation = { phase: 'loading', active: true };
    const guard = createCapturedRequest({ session: view.session, readSession: getSesion,
      request: (_url, options) => driveStatus(options), isActive: () => active && mounted.current && connectionRead.current === observation });
    connectionRead.current = observation;
    if (!guard.current()) return () => { active = false; observation.active = false; controller.abort(); };
    setConnectionPhase('loading'); setError('');
    guard.request('/api/drive/status', { signal: controller.signal }).then((data) => {
      guard.assertCurrent();
      const first = { id: data.roots.general, name: ROOT_LABELS.general };
      setStatus(data);
      setStack([first]);
      observation.phase = 'ready'; setConnectionPhase('ready');
    }).catch(() => { if (guard.current()) { observation.phase = 'error'; setConnectionPhase('error'); setError('No pudimos consultar la conexión con Drive.'); } });
    return () => { active = false; observation.active = false; controller.abort(); };
  }, [view, connectionAttempt]);
  const retryConnection = () => {
    const observation = connectionRead.current;
    const guard = createCapturedRequest({ session: view.session, readSession: getSesion,
      isActive: () => mounted.current && observation?.active === true && connectionRead.current === observation });
    if (observation?.phase !== 'error' || !guard.current()) return;
    // Synchronous latch: a second click before React renders cannot queue
    // another read. This never retries OAuth, uploads or a file operation.
    observation.phase = 'loading'; setConnectionPhase('loading'); setError('');
    setConnectionAttempt(value => value + 1);
  };
  useEffect(() => {
    if (!current?.id || !status?.connected) return;
    const timer = setTimeout(() => { void load(); }, query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [current?.id, status?.connected, query, load]);

  const selectRoot = (key) => { if (!requestDriveFolderChange(window)) return; setRootKey(key); setQuery(""); setStack([{ id: status.roots[key], name: ROOT_LABELS[key] }]); };
  const openFolder = (file, clickCount = 0) => {
    // A fast render can place a child under the second click of a double-click.
    // Keyboard activation has detail=0; a separate pointer activation has1.
    if (clickCount > 1 || !file?.isFolder || typeof file.id !== 'string' || !file.id || file.id === current?.id) return;
    const guard = createCapturedRequest({ session: view.session, readSession: getSesion,
      isActive: () => mounted.current && live.current === context });
    if (!guard.current()) return;
    if (!requestDriveFolderChange(window)) return;
    // Two clicks may share a render. Only the stack observed by this card may
    // advance; a repeat or a callback from a replaced folder cannot append.
    setStack(items => guard.current() && items[items.length - 1]?.id === current?.id && !items.some(item => item.id === file.id)
      ? [...items, { id: file.id, name: file.name }] : items);
  };
  const connect = async () => {
    const guard = createCapturedRequest({ session: view.session, readSession: getSesion, request: driveRequest, isActive: () => mounted.current });
    try {
      const result = await guard.request('/api/drive/connect', { method: 'POST' });
      const url = new URL(result.url);
      if (url.origin !== 'https://accounts.google.com' || !url.pathname.startsWith('/o/oauth2/')) throw new Error('Invalid provider URL');
      guard.assertCurrent(); window.location.href = url.href;
    } catch { if (guard.current()) { setFolderReadError(false); setError('No pudimos iniciar la conexión con Google Drive.'); } }
  };
  const trash = async (file) => {
    const guard = createCapturedRequest({ session: view.session, readSession: getSesion, request: driveRequest, isActive: () => mounted.current });
    if (!window.confirm(`¿Enviar “${file.name}” a la papelera de Google Drive?`)) return;
    try {
      await guard.request(`/api/drive/files/${encodeURIComponent(file.id)}`, { method: 'DELETE' });
      guard.assertCurrent(); await load(current?.id, query, guard);
    } catch { if (guard.current()) { setFolderReadError(false); setError('No pudimos confirmar el cambio. Verificá la carpeta antes de reintentar.'); } }
  };

  return <main className="drive-page">
    {error && connectionPhase === 'ready' && !status?.connected && <p className="drive-error-banner" role="alert">{error}</p>}
    <header className="drive-page-header"><div><span className="drive-kicker">ARCHIVOS DEL EQUIPO</span><h1>Drive</h1><p>Encontrá y cargá material sin salir de Render OS.</p></div>{status?.connected && <a href={`https://drive.google.com/drive/folders/${current?.id || status.roots.general}`} target="_blank" rel="noreferrer">Abrir en Google Drive ↗</a>}</header>
    {connectionPhase === 'loading' ? <section className="drive-connect" role="status"><h2>Consultando Drive…</h2><p>Verificando la conexión del equipo.</p></section> : connectionPhase === 'error' ? <section className="drive-connect" role="alert"><h2>No pudimos consultar Drive</h2><p>Volvé a consultar antes de conectar una cuenta. No se modificaron los archivos.</p><button type="button" onClick={retryConnection}>Reintentar consulta</button></section> : !status?.connected ? <section className="drive-connect"><span className="drive-logo">▰</span><h2>{status?.reconnectRequired ? "Volvé a conectar el Drive de Render" : "Conectá el Drive de Render"}</h2><p>{status?.reconnectRequired ? "La autorización anterior venció. Los archivos siguen intactos en Google Drive; solo hay que renovar el acceso." : "Los archivos seguirán guardados en Google Drive. Render OS solo simplifica la carga y el acceso."}</p>{isAdmin ? <button type="button" disabled={!status?.configured} onClick={connect}>{status?.reconnectRequired ? "Volver a conectar Google Drive" : "Conectar Google Drive"}</button> : <strong>Un líder debe realizar la conexión.</strong>}{status && !status.configured && <small>Falta configurar el acceso de Google en Hostinger.</small>}</section> : <>
      <section className="drive-toolbar"><div className="drive-roots">{Object.keys(ROOT_LABELS).map((key) => <button className={rootKey === key ? "active" : ""} type="button" key={key} onClick={() => selectRoot(key)}>{ROOT_LABELS[key]}</button>)}</div><label><span aria-hidden="true">⌕</span><input type="search" name="drive-search" autoComplete="off" aria-label="Buscar archivos en esta carpeta" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar en esta carpeta…"/></label></section>
      <section className="drive-browser"><div className="drive-breadcrumbs">{stack.map((folder, index) => <button type="button" key={folder.id} onClick={() => { if (requestDriveFolderChange(window)) setStack((items) => items.slice(0, index + 1)); }}>{folder.name}{index < stack.length - 1 ? " /" : ""}</button>)}</div><DriveUploader currentFolder={current} onUploaded={(_uploaded, scope) => load(current?.id, query, scope)}/>
        {error && <div className="drive-error-banner drive-folder-recovery" role="alert"><span>{error}</span>{folderReadError && <button type="button" disabled={loading} onClick={() => load()}>Reintentar carpeta</button>}</div>}
        {loading ? <div className="drive-loading" role="status">Cargando archivos…</div> : files.length ? <div className="drive-grid">{files.map((file) => <article key={file.id} className={file.isFolder ? "folder" : "file"}><button className="drive-file-main" type="button" onClick={(event) => file.isFolder ? openFolder(file, event?.detail) : window.open(file.webViewLink, "_blank", "noopener,noreferrer")}><span>{file.isFolder ? "▰" : "▤"}</span><div><strong>{file.name}</strong><small>{file.isFolder ? "Carpeta" : fileSize(file.size)}</small></div></button>{isAdmin && !file.isFolder && <button className="drive-trash" type="button" aria-label={`Enviar ${file.name} a la papelera`} onClick={() => trash(file)}>⌫</button>}</article>)}</div> : !error && <div className="drive-empty"><strong>No hay archivos para mostrar.</strong><span>{query ? "Probá otra búsqueda." : "Subí el primer archivo a esta carpeta."}</span></div>}
      </section>
    </>}
  </main>;
}
