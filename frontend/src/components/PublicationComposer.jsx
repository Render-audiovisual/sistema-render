import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "../features/render-os/services/render-os-api.js";
import { publicationUploadPlan, uploadFileToDrive } from "../features/drive/drive-api.js";
import { createUploadRecovery } from '../features/drive/upload-recovery.js';
import { getSesion } from '../utils.jsx';
import { useSessionView } from '../shared/session/use-session-view.js';
import { createCapturedRequest } from '../shared/session/captured-request.js';
import { DISPATCH_TIME_ZONE, dispatchScheduleFields, dispatchScheduleInstant, dispatchToday } from './publicationSchedule.js';

function usePublicationCapture(session, view, currentView) {
  const mounted = useRef(false), generation = useRef(0), controllers = useRef(new Set());
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; ++generation.current;
      for (const controller of controllers.current) controller.abort(); controllers.current.clear(); };
  }, []);
  return useCallback((request = apiRequest) => {
    const epoch = generation.current, controller = new AbortController(); controllers.current.add(controller);
    const guard = createCapturedRequest({ session, readSession: getSesion, request,
      isActive: () => mounted.current && generation.current === epoch && currentView.current === view && !controller.signal.aborted });
    return { ...guard, signal: controller.signal, cancel: () => controller.abort(), release: () => controllers.current.delete(controller) };
  }, [session, view, currentView]);
}

function dateTimeLabel(date, time) {
  if (!date) return "Sin fecha";
  if (!time) return `${date} · Sin hora`;
  let parsed;
  try { parsed=new Date(dispatchScheduleInstant({date,time},'schedule')); }
  catch { return 'Fecha u hora no válida'; }
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: DISPATCH_TIME_ZONE,
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
  if (item.scheduledAt === null || item.scheduledAt === undefined || item.scheduledAt === '') return dateTimeLabel(item.date, item.time);
  try { dispatchScheduleFields(item.scheduledAt); } catch { return 'Fecha guardada no válida'; }
  const parsed = new Date(item.scheduledAt);
  if (Number.isNaN(parsed.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: DISPATCH_TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

async function loadDispatchQueue(guard) {
  const result = await guard.request("/api/publicacion-envios", { signal: guard.signal });
  if (!Array.isArray(result)) throw new Error("La bandeja recibida no es válida. Volvé a intentar.");
  return result;
}

function validDispatchRevision(value) {
  // Opaque server CAS token: never parse as Date or round its microseconds.
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value);
}

function validDispatchAck(value, mode, draftId) {
  const id = value?.id;
  const validId = Number.isSafeInteger(id) && id > 0 || typeof id === 'string' && /^[1-9]\d{0,18}$/.test(id)
    && (id.length < 19 || id <= '9223372036854775807');
  const status = mode === 'draft' ? 'borrador' : mode === 'now' ? 'lista_para_publicar' : 'programada';
  return validId && value.status === status && value.previewOnly === true && validDispatchRevision(value.revision)
    && (!draftId || String(id) === String(draftId));
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
    date: publication?.fecha_programada || dispatchToday(),
    time: "09:00",
    observedScheduledAt: null,
    platforms: { instagram: true, facebook: true },
  };
}

function savedDraft(dispatch, clients) {
  const base = emptyDraft(null, clients);
  const scheduled = dispatchScheduleFields(dispatch?.scheduledAt);
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
    date: scheduled.date,
    time: scheduled.time,
    observedScheduledAt: dispatch?.scheduledAt || null,
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
  const view = useSessionView(getSesion()), currentView = useRef(view); currentView.current = view;
  return <ComposerSession key={view.key} session={view.session} view={view} currentView={currentView}
    publications={publications} clients={clients} canPublish={canPublish}/>;
}

function ComposerSession({ publications, clients, canPublish, session, view, currentView }) {
  const captureRequest = usePublicationCapture(session, view, currentView);
  const pending = useRef(false), draftsGeneration = useRef(0), dispatchOperation = useRef(null);
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
  const [draftRevision, setDraftRevision] = useState(null);
  const [dispatchConflict, setDispatchConflict] = useState(false);
  const draftEdited = useRef(false);
  const [uploadingMaterial, setUploadingMaterial] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedAssets, setUploadedAssets] = useState([]);
  const uploadRecoveryModel=useRef(null),uploadAttemptGuard=useRef(null),uploadDestination=useRef(null);
  const [uploadRecovery,setUploadRecovery]=useState({blocked:false,confirmed:[]});
  const [driveReconnectRequired, setDriveReconnectRequired] = useState(false);
  const [sourceSelection, setSourceSelection] = useState("");
  const fileInputRef = useRef(null);
  const uploadsRef = useRef([]);
  const operationBusy = saving || uploadingMaterial;
  useEffect(() => {
    pending.current = false; setSaving(false); setUploadingMaterial(false);
    return () => { pending.current = false; ++draftsGeneration.current; };
  }, []);

  useEffect(() => () => uploadsRef.current.forEach((file) => URL.revokeObjectURL(file.previewUrl)), []);

  useEffect(() => {
    if (!pending.current && !draft.clientId && clients.length) setDraft((current) => ({ ...current, clientId: clients[0].id }));
  }, [clients, draft.clientId, operationBusy]);

  const refreshDrafts = async (captured) => {
    const guard = captured || captureRequest(), generation = ++draftsGeneration.current;
    try {
      const result = await guard.request("/api/publicacion-envios?estado=borrador", { signal: guard.signal });
      if (!Array.isArray(result)) throw new Error('La lista de borradores recibida no es válida.');
      if (guard.current() && generation === draftsGeneration.current) { setSavedDrafts(result); return { ok: true }; }
      return { ok: false, obsolete: true };
    } catch (error) {
      if (guard.current() && generation === draftsGeneration.current) {
        if (!captured) setNotice(error.message || "No se pudieron cargar los borradores.");
        return { ok: false, error: error.message || 'No se pudo actualizar la lista.' };
      }
      return { ok: false, obsolete: true };
    } finally { if (!captured) guard.release(); }
  };

  useEffect(() => { refreshDrafts(); }, []);

  const openSavedDraft = (selected) => {
    if(uploadRecoveryModel.current?.snapshot.blocked)return;
    if (!validDispatchAck(selected, 'draft', selected?.id)) throw new Error('El borrador guardado no tiene una revisión válida. Conservamos tus cambios.');
    const restored = savedDraft(selected, clients);
    uploadsRef.current.forEach((file) => URL.revokeObjectURL(file.previewUrl));
    uploadsRef.current = []; if (fileInputRef.current) fileInputRef.current.value = '';
    setUploads([]); setUploadedAssets([]); setUploadProgress(0); setFileError('');
    setDraftId(selected.id); setDraftRevision(selected.revision); setDraft(restored);
    setSourceSelection(`draft:${selected.id}`); setShowDriveField(Boolean(selected.assets?.length));
    setDispatchConflict(false); dispatchOperation.current = null; draftEdited.current = false;
  };

  const selectPublication = (id) => {
    if (pending.current) return;
    if(uploadRecoveryModel.current?.snapshot.blocked)return;
    if (String(id) === String(sourceSelection)) return;
    if ((draftEdited.current || dispatchConflict) && !window.confirm('Cambiar de origen descartará tus cambios locales. ¿Querés continuar?')) return;
    if (String(id).startsWith("draft:")) {
      const selected = savedDrafts.find((item) => String(item.id) === String(id).slice(6));
      if (!selected) return;
      try { openSavedDraft(selected); setNotice("Borrador recuperado. Podés seguir editándolo."); }
      catch (error) { setNotice(error.message); }
      return;
    }
    setSourceSelection(id);
    const publication = candidates.find((item) => Number(item.id) === Number(id));
    uploadsRef.current.forEach((file) => URL.revokeObjectURL(file.previewUrl));
    uploadsRef.current = [];
    setUploads([]);
    setUploadedAssets([]);
    setDraftId(null);
    setDraftRevision(null); setDispatchConflict(false); dispatchOperation.current = null; draftEdited.current = false;
    setDraft(emptyDraft(publication, clients));
    setNotice("");
  };

  const clearUploads = () => {
    if (pending.current) return;
    if(uploadRecoveryModel.current?.snapshot.blocked)return;
    uploadAttemptGuard.current?.cancel();uploadAttemptGuard.current?.release();uploadAttemptGuard.current=null;uploadRecoveryModel.current=null;uploadDestination.current=null;setUploadRecovery({blocked:false,confirmed:[]});
    if (uploadsRef.current.length || uploadedAssets.length) draftEdited.current = true;
    uploadsRef.current.forEach((file) => URL.revokeObjectURL(file.previewUrl));
    uploadsRef.current = [];
    setUploads([]);
    setUploadedAssets([]);
    setUploadProgress(0);
    setFileError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const changeType = (type) => {
    if (pending.current) return;
    if(uploadRecoveryModel.current?.snapshot.blocked)return;
    clearUploads();
    setField("type", type);
  };

  const chooseFiles = (fileList) => {
    if (pending.current) return;
    if(uploadRecoveryModel.current?.snapshot.blocked)return;
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
    uploadAttemptGuard.current?.cancel();uploadAttemptGuard.current?.release();uploadAttemptGuard.current=null;uploadRecoveryModel.current=null;uploadDestination.current=null;setUploadRecovery({blocked:false,confirmed:[]});
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
    draftEdited.current = true;
    setUploads(selected);
    setUploadedAssets([]);
    setUploadProgress(0);
    setFileError("");
    setField("material", "");
  };

  const uploadMaterial = async () => {
    if (!uploads.length || uploadingMaterial || pending.current || uploadRecoveryModel.current?.snapshot.blocked) return;
    const guard = uploadAttemptGuard.current || captureRequest(fetch);
    if (!guard.current()) { guard.release(); return; }
    uploadAttemptGuard.current=guard;
    pending.current = true; ++draftsGeneration.current;
    const selectedUploads = uploads.slice();
    setUploadingMaterial(true);setFileError("");setDriveReconnectRequired(false);setNotice("");setUploadProgress(0);
    try {
      if(!uploadDestination.current){
        const destination=await publicationUploadPlan(guard.options({signal:guard.signal}));guard.assertCurrent();
        if(destination.status!=="resolved"||!destination.folder?.id)throw new Error(destination.reason||"No encontramos la carpeta privada de publicaciones.");
        uploadDestination.current=destination;
      }
      if(!uploadRecoveryModel.current)uploadRecoveryModel.current=createUploadRecovery({
        capture:()=>guard,
        upload:(file,options)=>uploadFileToDrive(file,{...options,session,readSession:getSesion,signal:guard.signal,isActive:guard.current,
          request:(url,settings)=>guard.request(url,{...settings,sessionIntent:guard.options().sessionIntent})}),
        onConfirmed:(_uploaded,confirmed,original)=>{
          original.assertCurrent();
          // Preserve each real ACK before starting the next file.
          setUploadRecovery(uploadRecoveryModel.current.snapshot);
          const links=confirmed.map(file=>{const url=new URL(file.webViewLink);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Archivo guardado, pero su enlace no pudo verificarse. Revisá Drive; no se repetirá la carga.');return file.webViewLink;});
          setUploadedAssets([...confirmed]);draftEdited.current=true;
          setDraft(current=>({...current,material:links.join("\n")}));
        },
      });
      const completed=await uploadRecoveryModel.current.run(selectedUploads,{
        parentId:uploadDestination.current.folder.id,duplicateAction:"keep",
      },(progress,index,total)=>{if(guard.current())setUploadProgress(Math.round(((index+progress/100)/total)*100));});
      guard.assertCurrent();setUploadRecovery(uploadRecoveryModel.current.snapshot);setUploadProgress(100);
      setNotice(`${completed.length===1?"Archivo guardado":"Archivos guardados"} en el Drive privado de Render.`);
    } catch (error) {
      if (guard.current()) {
        if(uploadRecoveryModel.current)setUploadRecovery(uploadRecoveryModel.current.snapshot);
        setFileError(error.message || "No se pudo guardar el material en Drive.");
        setDriveReconnectRequired(error.code==="GOOGLE_DRIVE_RECONNECT_REQUIRED");
      }
    } finally {
      pending.current=false;if(guard.current())setUploadingMaterial(false);
      if(!uploadRecoveryModel.current||uploadRecoveryModel.current.snapshot.confirmed.length===selectedUploads.length){guard.release();if(!uploadRecoveryModel.current)uploadAttemptGuard.current=null;}
    }
  };

  const setField = (field, value) => { if (!pending.current&&!(uploadRecoveryModel.current?.snapshot.blocked&&['clientId','type','material','publicationId'].includes(field))) { draftEdited.current = true; setDraft((current) => ({ ...current, [field]: value })); } };
  const setPlatform = (platform, value) => { if (!pending.current) { draftEdited.current = true; setDraft((current) => ({
    ...current,
    platforms: { ...current.platforms, [platform]: value },
  })); } };

  const discardAndReloadDraft = async () => {
    if (pending.current) return;
    const guard = captureRequest();
    if (!guard.current()) { guard.release(); return; }
    pending.current = true; ++draftsGeneration.current; setSaving(true);
    try {
      const rows = await guard.request('/api/publicacion-envios?estado=borrador', { signal: guard.signal });
      guard.assertCurrent();
      if (!Array.isArray(rows)) throw new Error('No se pudo validar la lista guardada. Conservamos tus cambios.');
      if (draftId) {
        const selected = rows.find(item => String(item.id) === String(draftId));
        if (!selected) throw new Error('El registro ya no está disponible como borrador editable. Conservamos tus cambios.');
        openSavedDraft(selected);
        setSavedDrafts(rows); setNotice('Versión guardada cargada. Se descartaron tus cambios locales por tu pedido.');
      } else {
        setSavedDrafts(rows);
        setNotice('Lista guardada actualizada. Tus cambios locales siguen intactos: elegí el borrador que querés cargar.');
      }
    } catch (error) {
      if (guard.current()) setNotice(error.message || 'No se pudo cargar la versión guardada. Conservamos tus cambios.');
    } finally {
      if (guard.current()) { pending.current = false; setSaving(false); }
      guard.release();
    }
  };

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
    if(uploadRecoveryModel.current?.snapshot.blocked){setNotice('La carga tiene un resultado sin confirmar. Revisá Drive manualmente; no se repetirá ni se publicará este intento.');return;}
    if (pending.current) return;
    if (dispatchConflict) { setNotice('Hay un conflicto. Conservamos tus cambios; cargá explícitamente la versión guardada antes de volver a enviar.'); return; }
    if (draftId && !validDispatchRevision(draftRevision)) { setNotice('Falta la revisión del borrador. Conservamos tus cambios; cargá explícitamente la versión guardada.'); setDispatchConflict(true); return; }
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
    const guard = captureRequest();
    if (!guard.current()) { guard.release(); return; }
    pending.current = true; ++draftsGeneration.current;
    setSaving(true);
    setNotice("");
    try {
      const materials = draft.material.split(/\n+/).map((item) => item.trim()).filter(Boolean);
      const scheduledAt = dispatchScheduleInstant(draft,mode);
      const url = draftId ? `/api/publicacion-envios/${draftId}` : '/api/publicacion-envios';
      const method = draftId ? 'PATCH' : 'POST';
      const payload = {
            clientId: draft.clientId,
            publicationId: draft.publicationId || null,
            type: draft.type,
            caption: draft.caption,
            firstComment: draft.firstComment,
            materials,
            platforms: draft.platforms,
            scheduledAt,
            collaborators: draft.collaborators,
            location: draft.location,
            tags: draft.tags,
            mode,
            ...(draftId ? { expectedRevision: draftRevision } : {}),
      };
      // Retain the exact serialized operation after uncertain transport/ACK.
      // Only an explicit changed intent gets a new key; never auto-retry.
      const fingerprint = JSON.stringify({ method, url, payload });
      if (dispatchOperation.current?.fingerprint !== fingerprint) {
        const requestKey = window.crypto?.randomUUID?.() || `render-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        dispatchOperation.current = Object.freeze({ fingerprint, requestKey, body: JSON.stringify({ ...payload, requestKey }) });
      }
      const saved = await guard.request(url, { method, headers: { 'Content-Type': 'application/json' }, signal: guard.signal,
        body: dispatchOperation.current.body });
        guard.assertCurrent();
        if (!validDispatchAck(saved, mode, draftId)) throw new Error('La respuesta no confirmó el guardado. Conservá los datos y verificá antes de reintentar.');
        dispatchOperation.current = null;
        draftEdited.current = false;
        if (mode === "draft") {
          setDraftId(saved.id);
          setDraftRevision(saved.revision); setSourceSelection(`draft:${saved.id}`);
        } else {
          setDraftId(null);
          setDraftRevision(null);
        }
      const refreshed = await refreshDrafts(guard);
      guard.assertCurrent();
      window.dispatchEvent(new CustomEvent("render:publication-preview-updated"));
      setNotice(!refreshed.ok
        ? `${mode === 'draft' ? 'Borrador guardado en el sistema.' : 'Simulación guardada; no se envió nada a Meta.'} No se pudo actualizar la lista de borradores. ${refreshed.error || ''}`
        : mode === "draft"
        ? "Borrador guardado en el sistema. Podés retomarlo más tarde."
        : mode === "now"
          ? "Simulación lista. No se envió nada a Meta."
          : "Programación simulada. El calendario editorial no fue modificado.");
    } catch (error) {
      if (guard.current()) {
        if (error.status === 409) {
          setDispatchConflict(true);
          setNotice('El registro cambió o ya no es editable. Conservamos tus cambios y la revisión observada. Cargá explícitamente la versión guardada para continuar.');
        } else setNotice(error.message || "No se confirmó el guardado en el sistema. Conservá los datos y volvé a intentar.");
      }
    } finally {
      if (guard.current()) { pending.current = false; setSaving(false); }
      guard.release();
    }
  };

  return (
    <section className="publisher-composer" aria-label="Preparar publicación">
      <div className="publisher-mode-banner">
        <span>Preparación de publicaciones</span>
        <p>Los borradores se guardan en el sistema. Ningún botón publica contenido real.</p>
      </div>

      <div className="publisher-layout">
        <div className="publisher-form">
          <div className="publisher-section-head">
            <div><span>Paso 1</span><h3>Elegí qué vas a publicar</h3></div>
            <span className="publisher-access">{canPublish ? "Podés preparar envíos" : "Vista de consulta"}</span>
          </div>

          <label className="publisher-field publisher-field-wide">
            <span>Publicación planificada</span>
            <select disabled={operationBusy||uploadRecovery.blocked} value={sourceSelection} onChange={(event) => selectPublication(event.target.value)}>
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
            <label className="publisher-field"><span>Cliente</span><select disabled={operationBusy||uploadRecovery.blocked} value={draft.clientId} onChange={(event) => setField("clientId", Number(event.target.value))}>{clients.map((client) => <option key={client.id} value={client.id}>{client.nombre}</option>)}</select></label>
            <label className="publisher-field"><span>Formato</span><select disabled={operationBusy||uploadRecovery.blocked} value={draft.type} onChange={(event) => changeType(event.target.value)}><option value="reel">Reel</option><option value="carrusel">Carrusel</option></select></label>
          </div>

          <div className="publisher-upload-block">
            <div className="publisher-upload-heading"><div><span>Material</span><strong>{draft.type === "reel" ? "Subí el video terminado" : "Subí las piezas del carrusel"}</strong></div><small>{draft.type === "reel" ? "MP4 · hasta 500 MB" : "JPG, PNG, WebP o MP4 · de 2 a 10 piezas"}</small></div>
            <input disabled={operationBusy||uploadRecovery.blocked} ref={fileInputRef} className="publisher-file-input" type="file" accept={draft.type === "reel" ? ".mp4,video/mp4" : ".jpg,.jpeg,.png,.webp,.mp4,image/jpeg,image/png,image/webp,video/mp4"} multiple={draft.type === "carrusel"} onChange={(event) => chooseFiles(event.target.files)}/>
            {uploads.length === 0 ? (
              <div className="publisher-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); chooseFiles(event.dataTransfer.files); }}>
                <span className="publisher-upload-icon" aria-hidden="true">↑</span>
                <div><strong>{draft.type === "reel" ? "Arrastrá el MP4 acá" : "Arrastrá las fotos acá"}</strong><small>o elegí los archivos desde tu computadora</small></div>
                <button disabled={operationBusy||uploadRecovery.blocked} type="button" className="publisher-upload-button" onClick={() => fileInputRef.current?.click()}>{draft.type === "reel" ? "Seleccionar MP4" : "Seleccionar fotos"}</button>
              </div>
            ) : (
              <div className="publisher-uploaded-files">
                <div className="publisher-files-toolbar"><strong>{uploads.length} {uploads.length === 1 ? "archivo listo" : "archivos listos"}</strong><div><button disabled={operationBusy||uploadRecovery.blocked} type="button" onClick={() => fileInputRef.current?.click()}>Cambiar</button><button disabled={operationBusy||uploadRecovery.blocked} type="button" className="is-danger" onClick={clearUploads}>Quitar</button></div></div>
                <div className="publisher-file-grid">{uploads.map((file, index) => <article key={file.id}>{file.type.startsWith("image/") ? <img src={file.previewUrl} alt=""/> : <video src={file.previewUrl} muted/>}<div><b>{draft.type === "carrusel" ? `${index + 1}. ` : ""}{file.name}</b><span>{formatFileSize(file.size)}</span></div></article>)}</div>
                <div className="publisher-drive-upload-action"><div><strong>{uploadedAssets.length === uploads.length ? "Material privado listo" : "Guardalo antes de continuar"}</strong><small>{uploadedAssets.length === uploads.length ? "Los enlaces quedaron vinculados al borrador." : "Se subirá a RENDER_UPLOADS, sin publicar en redes."}</small></div><button type="button" disabled={operationBusy || uploadRecovery.blocked || uploadedAssets.length === uploads.length} onClick={uploadMaterial}>{uploadingMaterial ? `${uploadProgress}%` : uploadedAssets.length === uploads.length ? "Guardado en Drive" : "Subir a Drive"}</button></div>
                {uploadingMaterial && <div className="publisher-upload-progress"><i style={{ width: `${uploadProgress}%` }}/></div>}
              </div>
            )}
            {uploadRecovery.blocked&&<div className="publisher-file-error" role="status"><span>{uploadedAssets.length} de {uploads.length} archivos con enlace confirmado. Otra carga puede haberse completado total o parcialmente; no se reenviará. Revisá Drive manualmente: buscar por nombre no confirma su resultado. Esta recuperación se conserva sólo mientras permanezcas en esta sesión y formulario.</span><a href="/drive" target="_blank" rel="noopener noreferrer">Abrir Drive para revisión manual</a></div>}
            {fileError && <div className="publisher-file-error" role="alert"><span>{fileError}</span>{driveReconnectRequired && <a href="/drive">Volver a conectar Drive</a>}</div>}
            <div className="publisher-upload-alternative"><span>También podés usar un archivo que ya está online</span><button disabled={operationBusy||uploadRecovery.blocked} type="button" onClick={() => { if (!pending.current) setShowDriveField((visible) => !visible); }}>{showDriveField ? "Ocultar enlace" : "Elegir desde Drive"}</button></div>
            {showDriveField && <label className="publisher-field publisher-field-wide publisher-drive-field"><span>{draft.type === "carrusel" ? "Enlaces de Drive" : "Enlace de Drive"}</span><textarea disabled={operationBusy||uploadRecovery.blocked} rows={draft.type === "carrusel" ? 4 : 2} value={draft.material} onChange={(event) => { setField("material", event.target.value); if (event.target.value) clearUploads(); }} placeholder={draft.type === "carrusel" ? "Pegá un enlace por línea, en el orden del carrusel" : "Pegá el enlace del video final"}/><small>{draft.type === "carrusel" ? `${materialCount(draft)} piezas enlazadas` : "Render validará el acceso antes de publicar."}</small></label>}
          </div>

          <div className="publisher-divider" />
          <div className="publisher-section-head"><div><span>Paso 2</span><h3>Prepará el mensaje</h3></div><button disabled={operationBusy} type="button" className="publisher-secondary" onClick={() => setField("caption", suggestionFor(draft, clients, publications))}>✦ Proponer con Mía</button></div>
          <label className="publisher-field publisher-field-wide"><span>Copy</span><textarea disabled={operationBusy} rows="5" value={draft.caption} onChange={(event) => setField("caption", event.target.value)} placeholder="Escribí el copy o pedile una propuesta a Mía"/><small>{draft.caption.length} caracteres</small></label>
          <label className="publisher-field publisher-field-wide"><span>Primer comentario <em>Opcional</em></span><textarea disabled={operationBusy} rows="2" value={draft.firstComment} onChange={(event) => setField("firstComment", event.target.value)} placeholder="Hashtags, información adicional o enlaces"/></label>

          <div className="publisher-divider" />
          <div className="publisher-section-head"><div><span>Paso 3</span><h3>Elegí destino y momento</h3></div></div>
          <div className="publisher-platforms">
            <label className={draft.platforms.instagram ? "active" : ""}><input disabled={operationBusy} type="checkbox" checked={draft.platforms.instagram} onChange={(event) => setPlatform("instagram", event.target.checked)}/><span className="platform-icon">◎</span><strong>Instagram</strong><small>Feed profesional</small></label>
            <label className={draft.platforms.facebook ? "active" : ""}><input disabled={operationBusy} type="checkbox" checked={draft.platforms.facebook} onChange={(event) => setPlatform("facebook", event.target.checked)}/><span className="platform-icon">f</span><strong>Facebook</strong><small>Página del cliente</small></label>
          </div>
          <div className="publisher-fields-grid">
            <label className="publisher-field"><span>Fecha</span><input disabled={operationBusy} type="date" value={draft.date} onChange={(event) => setField("date", event.target.value)}/></label>
            <label className="publisher-field"><span>Hora · Córdoba</span><input disabled={operationBusy} type="time" value={draft.time} onChange={(event) => setField("time", event.target.value)}/></label>
            <label className="publisher-field"><span>Colaboradores <em>Opcional</em></span><input disabled={operationBusy} value={draft.collaborators} onChange={(event) => setField("collaborators", event.target.value)} placeholder="@usuario, @usuario"/></label>
            <label className="publisher-field"><span>Ubicación <em>Opcional</em></span><input disabled={operationBusy} value={draft.location} onChange={(event) => setField("location", event.target.value)} placeholder="Local o ciudad"/></label>
            <label className="publisher-field publisher-field-wide"><span>Etiquetas <em>Opcional</em></span><input disabled={operationBusy} value={draft.tags} onChange={(event) => setField("tags", event.target.value)} placeholder="Personas o cuentas para etiquetar"/></label>
          </div>

          {notice && <div className="publisher-notice" role="status">{notice}</div>}
          {dispatchConflict && <div className="publisher-notice" role="alert">
            <p>Conservamos tus cambios locales. No se reemplazaron con la versión del servidor.</p>
            <button type="button" className="publisher-secondary" disabled={operationBusy} onClick={discardAndReloadDraft}>
              {draftId ? 'Descartar mis cambios y cargar versión guardada' : 'Cargar lista guardada para elegir un borrador'}
            </button>
          </div>}
          <div className="publisher-actions">
            <button type="button" className="publisher-draft-button" disabled={!canPublish || saving || uploadingMaterial || dispatchConflict} onClick={() => simulate("draft")}>{saving ? "Guardando…" : draftId ? "Actualizar borrador" : "Guardar borrador"}</button>
            <button type="button" className="publisher-secondary" disabled={!canPublish || operationBusy || dispatchConflict} onClick={() => simulate("schedule")}>{saving ? "Guardando…" : "Probar programación"}</button>
            <button type="button" className="publisher-primary" disabled={!canPublish || operationBusy || dispatchConflict} onClick={() => simulate("now")}>{saving ? "Guardando…" : "Probar “Publicar ahora”"}</button>
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
  const view = useSessionView(getSesion()), currentView = useRef(view); currentView.current = view;
  return <PreviewQueueSession key={view.key} session={view.session} view={view} currentView={currentView} mode={mode}/>;
}

function PreviewQueueSession({ mode, session, view, currentView }) {
  const captureRequest = usePublicationCapture(session, view, currentView);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let generation = 0, previous;
    const refresh = async () => {
      const observed = ++generation;
      previous?.cancel(); previous?.release();
      const guard = captureRequest(); previous = guard;
      try {
        const result = await loadDispatchQueue(guard);
        if (active && observed === generation && guard.current()) { setItems(result); setError(""); }
      } catch (requestError) {
        if (active && observed === generation && guard.current()) setError(requestError.message || "No se pudieron cargar los envíos.");
      } finally {
        if (active && observed === generation && guard.current()) setLoading(false);
        guard.release();
      }
    };
    refresh();
    window.addEventListener("render:publication-preview-updated", refresh);
    return () => {
      active = false;
      ++generation; previous?.cancel(); previous?.release();
      window.removeEventListener("render:publication-preview-updated", refresh);
    };
  }, [captureRequest]);

  const filtered = items.filter((item) => mode === "history" ? item.status === "lista_para_publicar" : item.status === "programada");
  return (
    <section className="publisher-queue">
      <div className="publisher-mode-banner"><span>Envíos preparados</span><p>Registros compartidos del sistema. Preparar un envío no confirma su publicación en Meta.</p></div>
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
