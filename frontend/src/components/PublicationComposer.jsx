import React, { useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "../features/render-os/services/render-os-api.js";
import { publicationUploadPlan, uploadFileToDrive } from "../features/drive/drive-api.js";

const STORAGE_KEY = "render-publicaciones-preview-v1";

function readPreviewQueue() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePreviewQueue(items) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function dateTimeLabel(date, time) {
  if (!date) return "Sin fecha";
  const parsed = new Date(`${date}T${time || "09:00"}:00`);
  if (Number.isNaN(parsed.getTime())) return `${date} · ${time || "09:00"}`;
  return new Intl.DateTimeFormat("es-AR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function platformLabel(platforms) {
  if (platforms.instagram && platforms.facebook) return "Instagram + Facebook";
  if (platforms.instagram) return "Instagram";
  if (platforms.facebook) return "Facebook";
  return "Sin plataforma";
}

function platformsForItem(item) {
  if (item.platforms) return item.platforms;
  return Object.fromEntries((item.targets || []).map((target) => [target.platform, true]));
}

function dispatchDateTimeLabel(item) {
  if (!item.scheduledAt) return dateTimeLabel(item.date, item.time);
  const parsed = new Date(item.scheduledAt);
  if (Number.isNaN(parsed.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-AR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

async function loadDispatchQueue() {
  try {
    const result = await apiRequest("/api/publicacion-envios");
    return Array.isArray(result) ? result : [];
  } catch (error) {
    if ([404, 503].includes(error.status)) return readPreviewQueue();
    throw error;
  }
}

function emptyDraft(publication, clients) {
  const client = clients.find((item) => item.id === publication?.cliente_id);
  return {
    publicationId: publication?.id || "",
    clientId: publication?.cliente_id || client?.id || clients[0]?.id || "",
    type: publication?.tipo === "video" ? "reel" : publication?.tipo || "reel",
    material: publication?.material_referencia || "",
    caption: publication?.copy || "",
    firstComment: "",
    collaborators: "",
    location: "",
    tags: "",
    date: publication?.fecha_programada || new Date().toISOString().slice(0, 10),
    time: "09:00",
    platforms: { instagram: true, facebook: true },
  };
}

function savedDraft(dispatch, clients) {
  const base = emptyDraft(null, clients);
  const scheduled = dispatch?.scheduledAt ? new Date(dispatch.scheduledAt) : null;
  return {
    ...base,
    publicationId: dispatch?.publicationId || "",
    clientId: dispatch?.clientId || base.clientId,
    type: dispatch?.type || "reel",
    material: (dispatch?.assets || []).map((asset) => asset.url).filter(Boolean).join("\n"),
    caption: dispatch?.caption || "",
    firstComment: dispatch?.firstComment || "",
    collaborators: dispatch?.options?.collaborators || "",
    location: dispatch?.options?.location || "",
    tags: dispatch?.options?.tags || "",
    date: scheduled && !Number.isNaN(scheduled.getTime()) ? scheduled.toISOString().slice(0, 10) : base.date,
    time: scheduled && !Number.isNaN(scheduled.getTime()) ? scheduled.toTimeString().slice(0, 5) : base.time,
    platforms: {
      instagram: (dispatch?.targets || []).some((target) => target.platform === "instagram"),
      facebook: (dispatch?.targets || []).some((target) => target.platform === "facebook"),
    },
  };
}

function materialCount(draft) {
  return draft.material.split(/\n+/).map((item) => item.trim()).filter(Boolean).length;
}

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function suggestionFor(draft, clients, publications) {
  const client = clients.find((item) => Number(item.id) === Number(draft.clientId));
  const publication = publications.find((item) => Number(item.id) === Number(draft.publicationId));
  const idea = publication?.idea?.trim();
  const subject = idea || (draft.type === "carrusel" ? "este nuevo carrusel" : "este nuevo reel");
  return `${client?.nombre || "Nuestro cliente"} presenta ${subject}.\n\nDescubrí todos los detalles y contanos qué te parece. ✨`;
}

function PublicationPreview({ draft, clients, uploads }) {
  const client = clients.find((item) => Number(item.id) === Number(draft.clientId));
  const assets = uploads.length || materialCount(draft);
  const firstUpload = uploads[0];
  return (
    <aside className="publisher-preview" aria-label="Vista previa de la publicación">
      <div className="publisher-preview-head">
        <div className="publisher-avatar">{client?.nombre?.slice(0, 1) || "R"}</div>
        <div><strong>{client?.nombre || "Elegí un cliente"}</strong><span>{platformLabel(draft.platforms)}</span></div>
        <span className="publisher-preview-menu">•••</span>
      </div>
      <div className={`publisher-preview-media is-${draft.type}`}>
        {firstUpload ? (
          draft.type === "reel"
            ? <video src={firstUpload.previewUrl} controls muted playsInline aria-label={`Vista previa de ${firstUpload.name}`}/>
            : <div className="publisher-preview-carousel">{uploads.slice(0, 4).map((file, index) => file.type.startsWith("image/") ? <img key={file.id} src={file.previewUrl} alt={`Pieza ${index + 1}`}/> : <video key={file.id} src={file.previewUrl} muted aria-label={`Pieza ${index + 1}`}/>)}</div>
        ) : (
          <><span aria-hidden="true">{draft.type === "carrusel" ? "▧" : "▶"}</span><strong>{draft.type === "carrusel" ? `${assets || 0} piezas` : "Vista previa del reel"}</strong><small>{draft.material ? "Material listo para validar" : "Subí el archivo o elegilo desde Drive"}</small></>
        )}
        {draft.type === "carrusel" && uploads.length > 0 && <b className="publisher-preview-count">1/{uploads.length}</b>}
      </div>
      <div className="publisher-preview-copy">
        <strong>{client?.nombre || "Cliente"}</strong>
        <p>{draft.caption || "El copy aparecerá acá antes de publicar."}</p>
        {draft.location && <span>⌖ {draft.location}</span>}
      </div>
    </aside>
  );
}

export function PublicationComposer({ publications, clients, canPublish }) {
  const candidates = useMemo(
    () => publications
      .filter((item) => item.estado !== "publicada" && ["video", "reel", "carrusel"].includes(item.tipo))
      .sort((a, b) => String(a.fecha_programada || "").localeCompare(String(b.fecha_programada || ""))),
    [publications],
  );
  const [draft, setDraft] = useState(() => emptyDraft(null, clients));
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploads, setUploads] = useState([]);
  const [fileError, setFileError] = useState("");
  const [showDriveField, setShowDriveField] = useState(false);
  const [savedDrafts, setSavedDrafts] = useState([]);
  const [draftId, setDraftId] = useState(null);
  const [uploadingMaterial, setUploadingMaterial] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedAssets, setUploadedAssets] = useState([]);
  const [driveReconnectRequired, setDriveReconnectRequired] = useState(false);
  const [sourceSelection, setSourceSelection] = useState("");
  const fileInputRef = useRef(null);
  const uploadsRef = useRef([]);

  useEffect(() => () => uploadsRef.current.forEach((file) => URL.revokeObjectURL(file.previewUrl)), []);

  useEffect(() => {
    if (!draft.clientId && clients.length) setDraft((current) => ({ ...current, clientId: clients[0].id }));
  }, [clients, draft.clientId]);

  const refreshDrafts = async () => {
    try {
      const result = await apiRequest("/api/publicacion-envios?estado=borrador");
      setSavedDrafts(Array.isArray(result) ? result : []);
    } catch (error) {
      if (![404, 503].includes(error.status)) setNotice(error.message || "No se pudieron cargar los borradores.");
    }
  };

  useEffect(() => { refreshDrafts(); }, []);

  const selectPublication = (id) => {
    setSourceSelection(id);
    if (String(id).startsWith("draft:")) {
      const selected = savedDrafts.find((item) => Number(item.id) === Number(String(id).slice(6)));
      if (!selected) return;
      clearUploads();
      setDraftId(selected.id);
      setDraft(savedDraft(selected, clients));
      setShowDriveField(Boolean(selected.assets?.length));
      setNotice("Borrador recuperado. Podés seguir editándolo.");
      return;
    }
    const publication = candidates.find((item) => Number(item.id) === Number(id));
    uploadsRef.current.forEach((file) => URL.revokeObjectURL(file.previewUrl));
    uploadsRef.current = [];
    setUploads([]);
    setUploadedAssets([]);
    setDraftId(null);
    setDraft(emptyDraft(publication, clients));
    setNotice("");
  };

  const clearUploads = () => {
    uploadsRef.current.forEach((file) => URL.revokeObjectURL(file.previewUrl));
    uploadsRef.current = [];
    setUploads([]);
    setUploadedAssets([]);
    setUploadProgress(0);
    setFileError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const changeType = (type) => {
    clearUploads();
    setField("type", type);
  };

  const chooseFiles = (fileList) => {
    const incoming = Array.from(fileList || []);
    const allowed = draft.type === "reel"
      ? incoming.filter((file) => file.type === "video/mp4" || file.name.toLowerCase().endsWith(".mp4"))
      : incoming.filter((file) => ["image/jpeg", "image/png", "image/webp", "video/mp4"].includes(file.type));
    if (!incoming.length) return;
    if (allowed.length !== incoming.length) {
      setFileError(draft.type === "reel" ? "Para un Reel seleccioná un archivo MP4." : "Usá JPG, PNG, WebP o MP4.");
      return;
    }
    if (draft.type === "reel" && allowed.length !== 1) {
      setFileError("Un Reel necesita un solo archivo MP4.");
      return;
    }
    if (draft.type === "carrusel" && (allowed.length < 2 || allowed.length > 10)) {
      setFileError("Seleccioná entre 2 y 10 piezas para el carrusel.");
      return;
    }
    if (allowed.some((file) => file.size > (draft.type === "reel" ? 500 : 50) * 1024 * 1024)) {
      setFileError(draft.type === "reel" ? "El MP4 supera los 500 MB." : "Una de las piezas supera los 50 MB.");
      return;
    }
    uploadsRef.current.forEach((file) => URL.revokeObjectURL(file.previewUrl));
    const selected = allowed.map((file, index) => ({
      id: `${file.name}-${file.size}-${index}`,
      file,
      name: file.name,
      type: file.type,
      size: file.size,
      previewUrl: URL.createObjectURL(file),
    }));
    uploadsRef.current = selected;
    setUploads(selected);
    setUploadedAssets([]);
    setUploadProgress(0);
    setFileError("");
    setField("material", "");
  };

  const uploadMaterial = async () => {
    if (!uploads.length || uploadingMaterial) return;
    setUploadingMaterial(true);
    setFileError("");
    setDriveReconnectRequired(false);
    setNotice("");
    setUploadProgress(0);
    try {
      const destination = await publicationUploadPlan();
      if (destination.status !== "resolved" || !destination.folder?.id) throw new Error(destination.reason || "No encontramos la carpeta privada de publicaciones.");
      const completed = [];
      for (let index = 0; index < uploads.length; index += 1) {
        const item = uploads[index];
        const uploaded = await uploadFileToDrive(item.file, {
          parentId: destination.folder.id,
          duplicateAction: "keep",
          onProgress: (progress) => setUploadProgress(Math.round(((index + progress / 100) / uploads.length) * 100)),
        });
        if (!uploaded?.webViewLink) throw new Error(`No pudimos confirmar la carga de ${item.name}.`);
        completed.push(uploaded);
      }
      setUploadedAssets(completed);
      setDraft((current) => ({ ...current, material: completed.map((item) => item.webViewLink).join("\n") }));
      setUploadProgress(100);
      setNotice(`${completed.length === 1 ? "Archivo guardado" : "Archivos guardados"} en el Drive privado de Render.`);
    } catch (error) {
      setFileError(error.message || "No se pudo guardar el material en Drive.");
      setDriveReconnectRequired(error.body?.code === "GOOGLE_DRIVE_RECONNECT_REQUIRED");
    } finally {
      setUploadingMaterial(false);
    }
  };

  const setField = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const setPlatform = (platform, value) => setDraft((current) => ({
    ...current,
    platforms: { ...current.platforms, [platform]: value },
  }));

  const validation = useMemo(() => {
    if (!draft.clientId) return "Elegí un cliente.";
    if (!draft.platforms.instagram && !draft.platforms.facebook) return "Elegí al menos una plataforma.";
    if (!uploads.length && !draft.material.trim()) return "Subí el material o elegilo desde Drive.";
    if (draft.type === "carrusel" && !uploads.length && materialCount(draft) < 2) return "Un carrusel necesita al menos dos piezas.";
    if (!draft.caption.trim()) return "Escribí o generá el copy.";
    if (!draft.date || !draft.time) return "Elegí fecha y hora.";
    return "";
  }, [draft, uploads]);

  const simulate = async (mode) => {
    if (!canPublish) {
      setNotice("Solo una community manager o un Líder puede preparar envíos.");
      return;
    }
    if (mode !== "draft" && validation) {
      setNotice(validation);
      return;
    }
    if (uploads.length && uploadedAssets.length !== uploads.length) {
      setNotice("Primero guardá el material en el Drive privado de Render.");
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      const materials = draft.material.split(/\n+/).map((item) => item.trim()).filter(Boolean);
      const scheduledAt = new Date(`${draft.date}T${draft.time}:00-03:00`).toISOString();
      const requestKey = window.crypto?.randomUUID?.() || `render-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      try {
        const saved = await apiRequest(draftId ? `/api/publicacion-envios/${draftId}` : "/api/publicacion-envios", {
          method: draftId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: draft.clientId,
            publicationId: draft.publicationId || null,
            type: draft.type,
            caption: draft.caption,
            firstComment: draft.firstComment,
            materials,
            platforms: draft.platforms,
            scheduledAt: mode === "draft" ? (draft.date && draft.time ? scheduledAt : null) : scheduledAt,
            collaborators: draft.collaborators,
            location: draft.location,
            tags: draft.tags,
            mode,
            requestKey,
          }),
        });
        if (mode === "draft") {
          setDraftId(saved.id);
          await refreshDrafts();
        } else {
          setDraftId(null);
          await refreshDrafts();
        }
      } catch (error) {
        if (![404, 503].includes(error.status)) throw error;
        const client = clients.find((item) => Number(item.id) === Number(draft.clientId));
        const next = {
          ...draft,
          id: `preview-${Date.now()}`,
          clientName: client?.nombre || "Cliente",
          status: mode === "draft" ? "borrador" : (mode === "now" ? "lista_para_publicar" : "programada"),
          createdAt: new Date().toISOString(),
          previewOnly: true,
          uploadedFiles: uploads.map((file) => ({ name: file.name, type: file.type, size: file.size })),
        };
        savePreviewQueue([next, ...readPreviewQueue()].slice(0, 40));
      }
      window.dispatchEvent(new CustomEvent("render:publication-preview-updated"));
      setNotice(mode === "draft"
        ? "Borrador guardado. Podés retomarlo más tarde."
        : mode === "now"
          ? "Simulación lista. No se envió nada a Meta."
          : "Programación simulada. El calendario editorial no fue modificado.");
    } catch (error) {
      setNotice(error.message || "No se pudo guardar la simulación.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="publisher-composer" aria-label="Preparar publicación">
      <div className="publisher-mode-banner">
        <span>Prototipo local</span>
        <p>Podés probar todo el recorrido. Ningún botón publica contenido real.</p>
      </div>

      <div className="publisher-layout">
        <div className="publisher-form">
          <div className="publisher-section-head">
            <div><span>Paso 1</span><h3>Elegí qué vas a publicar</h3></div>
            <span className="publisher-access">{canPublish ? "Podés preparar y publicar" : "Vista de consulta"}</span>
          </div>

          <label className="publisher-field publisher-field-wide">
            <span>Publicación planificada</span>
            <select value={sourceSelection} onChange={(event) => selectPublication(event.target.value)}>
              <option value="">Nueva publicación sin planificación</option>
              {savedDrafts.length > 0 && <optgroup label="Borradores guardados">{savedDrafts.map((item) => <option key={`draft-${item.id}`} value={`draft:${item.id}`}>{item.clientName} · {item.type === "carrusel" ? "Carrusel" : "Reel"} · Borrador #{item.id}</option>)}</optgroup>}
              <optgroup label="Calendario editorial">
              {candidates.map((item) => {
                const client = clients.find((candidate) => candidate.id === item.cliente_id);
                return <option key={item.id} value={item.id}>{item.fecha_programada} · {client?.nombre || "Cliente"} · {item.tipo === "carrusel" ? "Carrusel" : "Reel"}</option>;
              })}
              </optgroup>
            </select>
          </label>

          <div className="publisher-fields-grid">
            <label className="publisher-field"><span>Cliente</span><select value={draft.clientId} onChange={(event) => setField("clientId", Number(event.target.value))}>{clients.map((client) => <option key={client.id} value={client.id}>{client.nombre}</option>)}</select></label>
            <label className="publisher-field"><span>Formato</span><select value={draft.type} onChange={(event) => changeType(event.target.value)}><option value="reel">Reel</option><option value="carrusel">Carrusel</option></select></label>
          </div>

          <div className="publisher-upload-block">
            <div className="publisher-upload-heading"><div><span>Material</span><strong>{draft.type === "reel" ? "Subí el video terminado" : "Subí las piezas del carrusel"}</strong></div><small>{draft.type === "reel" ? "MP4 · hasta 500 MB" : "JPG, PNG, WebP o MP4 · de 2 a 10 piezas"}</small></div>
            <input ref={fileInputRef} className="publisher-file-input" type="file" accept={draft.type === "reel" ? ".mp4,video/mp4" : ".jpg,.jpeg,.png,.webp,.mp4,image/jpeg,image/png,image/webp,video/mp4"} multiple={draft.type === "carrusel"} onChange={(event) => chooseFiles(event.target.files)}/>
            {uploads.length === 0 ? (
              <div className="publisher-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); chooseFiles(event.dataTransfer.files); }}>
                <span className="publisher-upload-icon" aria-hidden="true">↑</span>
                <div><strong>{draft.type === "reel" ? "Arrastrá el MP4 acá" : "Arrastrá las fotos acá"}</strong><small>o elegí los archivos desde tu computadora</small></div>
                <button type="button" className="publisher-upload-button" onClick={() => fileInputRef.current?.click()}>{draft.type === "reel" ? "Seleccionar MP4" : "Seleccionar fotos"}</button>
              </div>
            ) : (
              <div className="publisher-uploaded-files">
                <div className="publisher-files-toolbar"><strong>{uploads.length} {uploads.length === 1 ? "archivo listo" : "archivos listos"}</strong><div><button type="button" onClick={() => fileInputRef.current?.click()}>Cambiar</button><button type="button" className="is-danger" onClick={clearUploads}>Quitar</button></div></div>
                <div className="publisher-file-grid">{uploads.map((file, index) => <article key={file.id}>{file.type.startsWith("image/") ? <img src={file.previewUrl} alt=""/> : <video src={file.previewUrl} muted/>}<div><b>{draft.type === "carrusel" ? `${index + 1}. ` : ""}{file.name}</b><span>{formatFileSize(file.size)}</span></div></article>)}</div>
                <div className="publisher-drive-upload-action"><div><strong>{uploadedAssets.length === uploads.length ? "Material privado listo" : "Guardalo antes de continuar"}</strong><small>{uploadedAssets.length === uploads.length ? "Los enlaces quedaron vinculados al borrador." : "Se subirá a RENDER_UPLOADS, sin publicar en redes."}</small></div><button type="button" disabled={uploadingMaterial || uploadedAssets.length === uploads.length} onClick={uploadMaterial}>{uploadingMaterial ? `${uploadProgress}%` : uploadedAssets.length === uploads.length ? "Guardado en Drive" : "Subir a Drive"}</button></div>
                {uploadingMaterial && <div className="publisher-upload-progress"><i style={{ width: `${uploadProgress}%` }}/></div>}
              </div>
            )}
            {fileError && <div className="publisher-file-error" role="alert"><span>{fileError}</span>{driveReconnectRequired && <a href="/drive">Volver a conectar Drive</a>}</div>}
            <div className="publisher-upload-alternative"><span>También podés usar un archivo que ya está online</span><button type="button" onClick={() => setShowDriveField((visible) => !visible)}>{showDriveField ? "Ocultar enlace" : "Elegir desde Drive"}</button></div>
            {showDriveField && <label className="publisher-field publisher-field-wide publisher-drive-field"><span>{draft.type === "carrusel" ? "Enlaces de Drive" : "Enlace de Drive"}</span><textarea rows={draft.type === "carrusel" ? 4 : 2} value={draft.material} onChange={(event) => { setField("material", event.target.value); if (event.target.value) clearUploads(); }} placeholder={draft.type === "carrusel" ? "Pegá un enlace por línea, en el orden del carrusel" : "Pegá el enlace del video final"}/><small>{draft.type === "carrusel" ? `${materialCount(draft)} piezas enlazadas` : "Render validará el acceso antes de publicar."}</small></label>}
          </div>

          <div className="publisher-divider" />
          <div className="publisher-section-head"><div><span>Paso 2</span><h3>Prepará el mensaje</h3></div><button type="button" className="publisher-secondary" onClick={() => setField("caption", suggestionFor(draft, clients, publications))}>✦ Proponer con Mía</button></div>
          <label className="publisher-field publisher-field-wide"><span>Copy</span><textarea rows="5" value={draft.caption} onChange={(event) => setField("caption", event.target.value)} placeholder="Escribí el copy o pedile una propuesta a Mía"/><small>{draft.caption.length} caracteres</small></label>
          <label className="publisher-field publisher-field-wide"><span>Primer comentario <em>Opcional</em></span><textarea rows="2" value={draft.firstComment} onChange={(event) => setField("firstComment", event.target.value)} placeholder="Hashtags, información adicional o enlaces"/></label>

          <div className="publisher-divider" />
          <div className="publisher-section-head"><div><span>Paso 3</span><h3>Elegí destino y momento</h3></div></div>
          <div className="publisher-platforms">
            <label className={draft.platforms.instagram ? "active" : ""}><input type="checkbox" checked={draft.platforms.instagram} onChange={(event) => setPlatform("instagram", event.target.checked)}/><span className="platform-icon">◎</span><strong>Instagram</strong><small>Feed profesional</small></label>
            <label className={draft.platforms.facebook ? "active" : ""}><input type="checkbox" checked={draft.platforms.facebook} onChange={(event) => setPlatform("facebook", event.target.checked)}/><span className="platform-icon">f</span><strong>Facebook</strong><small>Página del cliente</small></label>
          </div>
          <div className="publisher-fields-grid">
            <label className="publisher-field"><span>Fecha</span><input type="date" value={draft.date} onChange={(event) => setField("date", event.target.value)}/></label>
            <label className="publisher-field"><span>Hora</span><input type="time" value={draft.time} onChange={(event) => setField("time", event.target.value)}/></label>
            <label className="publisher-field"><span>Colaboradores <em>Opcional</em></span><input value={draft.collaborators} onChange={(event) => setField("collaborators", event.target.value)} placeholder="@usuario, @usuario"/></label>
            <label className="publisher-field"><span>Ubicación <em>Opcional</em></span><input value={draft.location} onChange={(event) => setField("location", event.target.value)} placeholder="Local o ciudad"/></label>
            <label className="publisher-field publisher-field-wide"><span>Etiquetas <em>Opcional</em></span><input value={draft.tags} onChange={(event) => setField("tags", event.target.value)} placeholder="Personas o cuentas para etiquetar"/></label>
          </div>

          {notice && <div className="publisher-notice" role="status">{notice}</div>}
          <div className="publisher-actions">
            <button type="button" className="publisher-draft-button" disabled={!canPublish || saving || uploadingMaterial} onClick={() => simulate("draft")}>{saving ? "Guardando…" : draftId ? "Actualizar borrador" : "Guardar borrador"}</button>
            <button type="button" className="publisher-secondary" disabled={!canPublish || saving} onClick={() => simulate("schedule")}>{saving ? "Guardando…" : "Probar programación"}</button>
            <button type="button" className="publisher-primary" disabled={!canPublish || saving} onClick={() => simulate("now")}>{saving ? "Guardando…" : "Probar “Publicar ahora”"}</button>
          </div>
        </div>

        <div className="publisher-sticky-preview">
          <div className="publisher-preview-label"><span>Vista previa</span><small>{dateTimeLabel(draft.date, draft.time)}</small></div>
          <PublicationPreview draft={draft} clients={clients} uploads={uploads}/>
          <div className="publisher-checklist">
            <strong>Antes de publicar</strong>
            <span className={draft.clientId ? "done" : ""}>Cliente y cuenta</span>
            <span className={uploads.length || draft.material.trim() ? "done" : ""}>Material cargado</span>
            <span className={draft.caption.trim() ? "done" : ""}>Copy revisado</span>
            <span className={!validation ? "done" : ""}>Configuración completa</span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function PublicationPreviewQueue({ mode }) {
  const [items, setItems] = useState(readPreviewQueue);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const result = await loadDispatchQueue();
        if (active) { setItems(result); setError(""); }
      } catch (requestError) {
        if (active) setError(requestError.message || "No se pudieron cargar los envíos.");
      } finally {
        if (active) setLoading(false);
      }
    };
    refresh();
    window.addEventListener("render:publication-preview-updated", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      active = false;
      window.removeEventListener("render:publication-preview-updated", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const filtered = items.filter((item) => mode === "history" ? item.status === "lista_para_publicar" : item.status === "programada");
  return (
    <section className="publisher-queue">
      <div className="publisher-mode-banner"><span>Prototipo local</span><p>Estos registros son simulaciones guardadas solamente en este navegador.</p></div>
      {loading ? (
        <div className="publisher-empty"><span>◌</span><h3>Cargando envíos</h3><p>Estamos ordenando la bandeja de publicaciones.</p></div>
      ) : error ? (
        <div className="publisher-empty"><span>!</span><h3>No pudimos cargar la bandeja</h3><p>{error}</p></div>
      ) : filtered.length === 0 ? (
        <div className="publisher-empty"><span>{mode === "history" ? "✓" : "◷"}</span><h3>{mode === "history" ? "Todavía no hay pruebas de publicación" : "Todavía no hay pruebas programadas"}</h3><p>Prepará una publicación para comprobar cómo se verá esta bandeja.</p></div>
      ) : (
        <div className="publisher-queue-list">{filtered.map((item) => <article key={item.id}><div className="publisher-avatar">{item.clientName?.slice(0, 1)}</div><div><strong>{item.clientName}</strong><span>{item.type === "carrusel" ? "Carrusel" : "Reel"} · {platformLabel(platformsForItem(item))}</span></div><time>{dispatchDateTimeLabel(item)}</time><b>{mode === "history" ? "Simulada" : "Programada"}</b></article>)}</div>
      )}
    </section>
  );
}
