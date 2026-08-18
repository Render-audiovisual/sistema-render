import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ESTADO_FINAL_TAREA, getRolLabel } from "../constants.js";
import { esperandoMaterial, extraerUrlsTarea, getTipoPublicacionLabel, obtenerInfoLinkTarea, renderizarTextoTarea } from "../utils.jsx";
import { AREAS, BOARD_COLUMNS, STATUSES, TASK_TYPES } from "../features/render-os/constants.js";
import { apiJson, apiRequest, apiSubtasks, apiTaskById, apiTaskPage } from "../features/render-os/services/render-os-api.js";
import { areaForTask, formatDate, formatDateTime, initials, personForTask } from "../features/render-os/utils/task-formatters.js";
import { canRetryTaskUpdate, canUserMoveTask, mergeRelatedTasks } from "../workspace-task-state.js";
import { getTasksEmptyMessage, getTaskViewState, isNewTaskDraftDirty, updateTaskViewUrl } from "../features/render-os/utils/task-view-state.js";
import { getProductionPhase, getProductionVisitProgress, isProductionVisitTask } from "../features/render-os/utils/production-visits.js";
import { getCanonicalTaskContentMetadata, getUnifiedTaskContent } from "../features/render-os/utils/task-content.js";
import { getNewTaskSuggestions, getTaskDirectUrl } from "../features/render-os/utils/new-task-suggestions.js";
import { getHoyLocalISO } from "../shared/date/date-utils.js";
import { normalizeSelectionRect, selectionRectsIntersect } from "../features/render-os/utils/selection-geometry.js";
import { DriveUploader } from "../features/drive/DriveUploader.jsx";
import "./WorkspaceReadOnly.css";

function Avatar({ person, name }) {
  const label = person?.nombre || name || "Sin asignar";
  return <span className="ros-avatar" title={person ? `${person.nombre} · @${person.usuario}` : label}>{initials(label)}</span>;
}

function AreaBadge({ task }) {
  const area = AREAS.find((item) => item.id === areaForTask(task)) || AREAS[0];
  return <span className="ros-area-badge" style={{ "--area": area.color }}>{area.icon} {area.label}</span>;
}

function LoadingState({ error, onRetry }) {
  return <div className={`ros-state ${error ? "error" : ""}`}><span>{error ? "!" : "◌"}</span><strong>{error || "Conectando con los datos reales…"}</strong><small>{error ? "No pudimos cargar las tareas. Podés reintentar sin salir del tablero." : "Cargando tareas, clientes y responsables."}</small>{error && <button type="button" onClick={onRetry}>Reintentar</button>}</div>;
}

function Toast({ toast, onClose }) {
  if (!toast) return null;
  return <button type="button" className={`ros-toast ${toast.type || "success"}`} onClick={onClose}><span>{toast.type === "error" ? "!" : "✓"}</span>{toast.message}</button>;
}

const TASK_CONTENT_TYPES = [
  { id: "guion", label: "Guion", field: "guiones", metadataField: "guiones", empty: "Todavía no hay un guion cargado." },
  { id: "copy", label: "Copy", field: "copy_trabajo", metadataField: "copy_trabajo", empty: "Todavía no hay un copy cargado." },
  { id: "indicaciones", label: "Indicaciones", field: "aclaraciones", empty: "Esta tarea todavía no tiene indicaciones cargadas." },
];

const TASK_CONTENT_TEMPLATES = {
  guion: [
    { label: "+ Video", value: "VIDEO\nIdea:\nGuion:\nReferencia:" },
    { label: "+ Escena", value: "ESCENA\nVisual:\nTexto / diálogo:" },
  ],
  copy: [
    { label: "+ Placa", value: "PLACA\nTexto:\nVisual:" },
    { label: "+ Cierre / CTA", value: "CIERRE / CTA\nAcción esperada:" },
  ],
  indicaciones: [
    { label: "+ Objetivo", value: "OBJETIVO\n" },
    { label: "+ Requisito", value: "• " },
  ],
};

function TaskContentWorkspace({ task, metadata, editing, draft, setDraft, editorRef, onInsertTemplate, onEditContent }) {
  const savedContent = getUnifiedTaskContent(task);
  const value = editing && String(draft.aclaraciones || "") !== String(task.aclaraciones || "") ? String(draft.aclaraciones || "") : savedContent;
  return <section className="ros-work-block ros-content-workspace">
    <div className="ros-block-heading"><div><h3>Contenido de trabajo</h3></div><small>Todo el texto importante en un solo lugar</small></div>
    {editing ? <div className="ros-content-editor">
      <div className="ros-content-editor-header"><div><span>Contenido de la tarea</span><strong>Escribí todo lo necesario para trabajar</strong></div></div>
      <div className="ros-content-tools"><span>Usá bloques para ordenar el texto.</span>{TASK_CONTENT_TYPES.flatMap((type) => TASK_CONTENT_TEMPLATES[type.id] || []).map((template) => <button type="button" key={`${template.label}-${template.value}`} onClick={() => onInsertTemplate(template.value)}>{template.label}</button>)}</div>
      <textarea ref={editorRef} className="ros-detail-textarea ros-content-textarea" rows={16} value={value} placeholder="Escribí el guion, copy o las indicaciones acá…" onChange={(event) => setDraft({ ...draft, aclaraciones: event.target.value })}/>
      <small>Los cambios se guardan únicamente al presionar “Guardar cambios”.</small>
    </div> : value ? <div className="ros-content-editor ros-content-viewer"><div className="ros-content-editor-header"><div><span>Contenido de la tarea</span><strong>Información para trabajar</strong></div></div><div className="ros-content-reading">{renderizarTextoTarea(value)}</div></div> : <div className="ros-content-empty"><span>✎</span><div><strong>Todavía no hay contenido cargado.</strong><p>Agregá el guion, copy o las indicaciones en un solo lugar.</p></div>{onEditContent && <button type="button" onClick={onEditContent}>Escribir contenido</button>}</div>}
  </section>;
}

function TaskDetail({ task, tasks, users, clients, sesion, onClose, onOpen, onLoadSubtasks, onUpdate, onRegisterProduction, onCorrectProduction, onConfirmProduction, onApprove, onArchive, onDelete, onCreateSubtask }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task || {});
  const [comments, setComments] = useState([]);
  const [comment, setComment] = useState("");
  const [commentError, setCommentError] = useState("");
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const [creatingSubtask, setCreatingSubtask] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [productionAmount, setProductionAmount] = useState(1);
  const [productionDate, setProductionDate] = useState(getHoyLocalISO());
  const [productionDriveLink, setProductionDriveLink] = useState("");
  const [registeringProduction, setRegisteringProduction] = useState(false);
  const [savingProductionDrive, setSavingProductionDrive] = useState(false);
  const [approving, setApproving] = useState(false);
  const [confirmingProduction, setConfirmingProduction] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const archivePendingRef = useRef(false);
  const scriptEditorRef = useRef(null);
  const isAdmin = sesion?.usuario?.rol === "admin";

  useEffect(() => {
    if (!task) return;
    setDraft(task);
    setEditing(false);
    setComment("");
    setCommentError("");
    setSubtaskTitle("");
    setConfirmDelete(false);
    setLinkCopied(false);
    setProductionAmount(1);
    setProductionDate(getHoyLocalISO());
    setProductionDriveLink(task.material_referencia || "");
    apiJson(`/api/tareas/${task.id}/comentarios?workspace=render_os`)
      .then(setComments)
      .catch((reason) => setCommentError(reason.message || "No se pudieron cargar los comentarios."));
    onLoadSubtasks(task.id).catch((reason) => setCommentError(reason.message || "No se pudieron cargar las subtareas."));
  }, [task?.id, task?.updated_at, onLoadSubtasks]);

  useEffect(() => {
    if (!task) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [task]);

  if (!task) return null;
  const person = personForTask(task, users);
  const status = STATUSES.find((item) => item.id === task.estado) || { label: task.estado, color: "#777" };
  const metadata = task.propiedades_extra || {};
  const driveFiles = Array.isArray(metadata.drive_archivos) ? metadata.drive_archivos : [];
  const isProductionVisit = isProductionVisitTask(task);
  const userIdentity = `${sesion?.usuario?.nombre || ""} ${sesion?.usuario?.usuario || ""}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const isLeader = isAdmin || userIdentity.includes("franco") || userIdentity.includes("agustin") || userIdentity.includes("lider");
  const canApproveForOriana = isLeader && task.estado === "en_revision" && areaForTask(task) === "edicion" && metadata.revision_aprobada !== true;
  const productionProgress = getProductionVisitProgress(task);
  const productionPhase = getProductionPhase(task);
  const canRegisterProduction = isAdmin || String(sesion?.usuario?.nombre || sesion?.usuario?.usuario || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().startsWith("german");
  const canConfirmProduction = isLeader && isProductionVisit && productionProgress.complete && !metadata.produccion_confirmada_at;
  const isArchived = metadata.archivada_render_os === true;
  const tags = Array.isArray(metadata.etiquetas) ? metadata.etiquetas : [];
  const collaborators = Array.isArray(metadata.colaboradores) ? metadata.colaboradores : [];
  const subtasks = tasks.filter((item) => Number(item.tarea_padre_id) === Number(task.id));
  const links = [...new Set(extraerUrlsTarea(task.aclaraciones || ""))].filter((url) => url !== task.material_referencia);
  const materialInfo = task.material_referencia ? obtenerInfoLinkTarea(task.material_referencia) : null;
  const origin = task.historia_id
    ? { label: "Historia", date: task.historia_fecha_programada, state: task.historia_estado, href: "/planificacion-historias" }
    : task.publicacion_id
      ? { label: getTipoPublicacionLabel(task.publicacion_tipo), date: task.publicacion_fecha_programada, state: task.publicacion_estado, href: "/planificacion-publicaciones" }
      : null;
  const activityComments = comments.filter((item) => item.contenido.startsWith("[Actividad]"));
  const teamComments = comments.filter((item) => !item.contenido.startsWith("[Actividad]"));
  const lastActivity = activityComments.at(-1);
  const objectiveSource = String(metadata.resumen || task.aclaraciones || "").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  const missingEssentials = [
    !objectiveSource && "objetivo",
    !String(task.aclaraciones || "").trim() && "indicaciones",
    !task.material_referencia && links.length === 0 && "material o referencias",
    isProductionVisit && productionProgress.planned === 0 && "cantidad de videos previstos",
  ].filter(Boolean);

  const save = async () => {
    setSaving(true);
    const fields = ["titulo", "asignado_a", "cliente_id", "estado", "fecha_vencimiento", "prioridad", "tipo_tarea", "subtipo", "aclaraciones", "material_referencia"];
    const nullable = ["cliente_id", "fecha_vencimiento", "tipo_tarea", "subtipo", "aclaraciones", "material_referencia"];
    const changes = Object.fromEntries(fields
      .filter((field) => String(draft[field] ?? "") !== String(task[field] ?? ""))
      .map((field) => [field, draft[field] === "" && nullable.includes(field) ? null : draft[field]]));
    const nextMetadata = getCanonicalTaskContentMetadata({
      resumen: String(draft.resumen || "").trim(),
      etiquetas: String(draft.etiquetas || "").split(",").map((item) => item.trim()).filter(Boolean),
      colaboradores: Array.isArray(draft.colaboradores) ? draft.colaboradores : [],
    });
    if (isProductionVisit) nextMetadata.produccion_videos_previstos = Math.max(0, Number(draft.produccion_videos_previstos) || 0);
    const previousEditableMetadata = { resumen: metadata.resumen || "", etiquetas: tags, colaboradores: collaborators, guiones: metadata.guiones || "", copy_trabajo: metadata.copy_trabajo || "" };
    if (isProductionVisit) previousEditableMetadata.produccion_videos_previstos = productionProgress.planned;
    if (JSON.stringify(nextMetadata) !== JSON.stringify(previousEditableMetadata)) {
      changes.propiedades_extra = nextMetadata;
    }
    try {
      if (Object.keys(changes).length) await onUpdate(task.id, changes, "editó los datos de la tarea");
      setEditing(false);
    } catch {
      // El contenedor restaura los datos y muestra el error.
    } finally {
      setSaving(false);
    }
  };

  const startEditing = () => {
    setDraft({ ...task, aclaraciones: getUnifiedTaskContent(task), resumen: metadata.resumen || "", etiquetas: tags.join(", "), colaboradores: collaborators, guiones: "", copy_trabajo: "", produccion_videos_previstos: productionProgress.planned || "" });
    setEditing(true);
  };

  const insertContentTemplate = (template) => {
    const textarea = scriptEditorRef.current;
    const savedContent = getUnifiedTaskContent(task);
    const current = String(draft.aclaraciones || "") !== String(task.aclaraciones || "") ? String(draft.aclaraciones || "") : savedContent;
    const start = textarea?.selectionStart ?? current.length;
    const end = textarea?.selectionEnd ?? current.length;
    const separator = current && start === current.length && !current.endsWith("\n") ? "\n\n" : "";
    const nextValue = `${current.slice(0, start)}${separator}${template}${current.slice(end)}`;
    setDraft({ ...draft, aclaraciones: nextValue });
    requestAnimationFrame(() => {
      if (!textarea) return;
      const cursor = start + separator.length + template.length;
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
    });
  };

  const closeDetail = () => {
    if (editing && !window.confirm("Hay cambios sin guardar. ¿Querés descartarlos?")) return;
    onClose();
  };

  const addComment = async () => {
    const content = comment.trim();
    if (!content || commenting) return;
    setCommenting(true);
    setCommentError("");
    try {
      const created = await apiRequest(`/api/tareas/${task.id}/comentarios?workspace=render_os`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autor: sesion?.usuario?.nombre || sesion?.usuario?.usuario || "Equipo RENDER", contenido: content }),
      });
      setComments((current) => [...current, created]);
      setComment("");
    } catch (reason) {
      setCommentError(reason.message || "No se pudo guardar el comentario.");
    } finally {
      setCommenting(false);
    }
  };

  const createSubtask = async () => {
    if (!subtaskTitle.trim() || creatingSubtask) return;
    setCreatingSubtask(true);
    try {
      await onCreateSubtask(task, subtaskTitle.trim());
      setSubtaskTitle("");
    } finally {
      setCreatingSubtask(false);
    }
  };

  const deleteTask = async () => {
    setDeleting(true);
    try { await onDelete(task.id); }
    finally { setDeleting(false); }
  };

  const archiveTask = async () => {
    if (archivePendingRef.current) return;
    archivePendingRef.current = true;
    setArchiving(true);
    try {
      await onArchive(task, !isArchived);
    } finally {
      archivePendingRef.current = false;
      setArchiving(false);
    }
  };

  const registerProduction = async () => {
    if (registeringProduction || metadata.produccion_confirmada_at) return;
    setRegisteringProduction(true);
    try {
      await onRegisterProduction(task, Number(productionAmount), productionDate);
      setProductionAmount(1);
    } finally {
      setRegisteringProduction(false);
    }
  };

  const confirmProduction = async () => {
    if (confirmingProduction) return;
    setConfirmingProduction(true);
    try { await onConfirmProduction(task); }
    finally { setConfirmingProduction(false); }
  };

  const approveForOriana = async () => {
    if (approving) return;
    setApproving(true);
    try { await onApprove(task); }
    finally { setApproving(false); }
  };

  const saveProductionDrive = async () => {
    const link = productionDriveLink.trim();
    if (!link || savingProductionDrive) return;
    setSavingProductionDrive(true);
    try { await onUpdate(task.id, { material_referencia: link }, "vinculó la carpeta de producción en Google Drive"); }
    finally { setSavingProductionDrive(false); }
  };

  const copyTaskLink = async () => {
    const link = getTaskDirectUrl(window.location.origin, task.id);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const input = document.createElement("textarea");
        input.value = link;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2200);
    } catch {
      window.prompt("Copiá el enlace de la tarea:", link);
    }
  };

  return <div className="ros-drawer-backdrop" onClick={closeDetail}>
    <aside className="ros-drawer ros-task-workspace" onClick={(event) => event.stopPropagation()}>
      <header className="ros-task-workspace-header">
        <button type="button" aria-label="Volver al tablero" onClick={closeDetail}>←</button>
        <span className="ros-task-window-icon">✓</span>
        <strong>{task.cliente_nombre || "Sin cliente"} · {task.titulo}</strong>
        <button className="ros-copy-task-link" type="button" aria-label="Copiar enlace de la tarea" title="Copiar enlace de la tarea" onClick={copyTaskLink}>{linkCopied ? "✓ Copiado" : "↗ Copiar enlace"}</button>
        <button type="button" aria-label="Cerrar tarea" onClick={closeDetail}>×</button>
      </header>
      <div className="ros-drawer-body ros-task-workspace-body">
        <div className="ros-task-layout">
          <main className="ros-task-main-column">
        <div className="ros-task-document-kind"><AreaBadge task={task}/></div>
        <div className="ros-task-document-heading">{editing ? <input className="ros-title-input" value={draft.titulo || ""} onChange={(event) => setDraft({ ...draft, titulo: event.target.value })}/> : <h2>{task.titulo}</h2>}{isAdmin && !editing && <button className="ros-task-edit-button" type="button" onClick={startEditing}>Editar tarea</button>}</div>
        <div className="ros-task-document-properties">
          <div><span>◉ <b>Estado</b></span><strong className="ros-task-document-status"><i style={{ background: status.color }}/>{status.label}</strong></div>
          <div><span>♙ <b>Responsable</b></span><strong><Avatar person={person} name={task.asignado_a}/>{task.asignado_a || "Sin asignar"}</strong></div>
          <div><span>▥ <b>Cliente</b></span><strong>{task.cliente_nombre || "Sin cliente"}</strong></div>
          <div><span>▦ <b>Entrega</b></span><strong>{formatDate(task.fecha_vencimiento)}</strong></div>
          {String(task.prioridad || "").toLowerCase() !== "media" && <div><span>⚑ <b>Prioridad</b></span><strong>{task.prioridad || "Sin definir"}</strong></div>}
        </div>
        {esperandoMaterial(task) && <div className="ros-warning-banner">Esperando material: la tarea de origen todavía no está terminada.</div>}
        {!editing && missingEssentials.length > 0 && <div className="ros-task-missing-banner"><span>!</span><div><strong>Falta información para trabajar sin dudas</strong><p>Falta completar: {missingEssentials.join(", ")}.</p></div></div>}
        {canApproveForOriana && <section className="ros-approval-handoff"><div><strong>El video está esperando aprobación</strong><span>Revisá el material y, si está listo, entregáselo a Oriana para programar o publicar.</span></div><button type="button" disabled={approving} onClick={approveForOriana}>{approving ? "Enviando…" : "Aprobar y enviar a Oriana"}</button></section>}
        {metadata.revision_aprobada === true && task.estado === "en_revision" && <div className="ros-approved-banner">✓ Aprobada por {metadata.revision_aprobada_por || "Líder"}. Oriana decide si programarla o publicarla.</div>}
        {isProductionVisit && <section className="ros-production-visit">
          <header><div><span>VISITA DE PRODUCCIÓN</span><strong>{productionProgress.recorded} de {productionProgress.planned || "—"} videos grabados</strong></div>{productionProgress.complete ? <b>{productionPhase?.label || "Completa"}</b> : <b className="pending">Faltan {productionProgress.remaining || "—"}</b>}</header>
          <div className="ros-production-progress"><i style={{ width: `${productionProgress.planned ? Math.min(100, (productionProgress.recorded / productionProgress.planned) * 100) : 0}%` }}/></div>
          {editing && isAdmin && <label className="ros-production-planned"><span>Videos previstos</span><input type="number" min="1" step="1" value={draft.produccion_videos_previstos || ""} onChange={(event) => setDraft({ ...draft, produccion_videos_previstos: event.target.value })}/></label>}
          {!editing && canRegisterProduction && productionProgress.planned > 0 && !metadata.produccion_confirmada_at && <div className="ros-production-entry">
            <label><span>¿Cuántos grabaste hoy?</span><div><button type="button" onClick={() => setProductionAmount((current) => Math.max(1, Number(current) - 1))}>−</button><input inputMode="numeric" type="number" min="1" value={productionAmount} onChange={(event) => setProductionAmount(Math.max(1, Number(event.target.value) || 1))}/><button type="button" onClick={() => setProductionAmount((current) => Number(current) + 1)}>+</button></div></label>
            <label><span>Fecha de grabación</span><input type="date" value={productionDate} max={getHoyLocalISO()} onChange={(event) => setProductionDate(event.target.value)}/></label>
            <button type="button" disabled={registeringProduction || !productionDate} onClick={registerProduction}>{registeringProduction ? "Guardando…" : `Registrar ${productionAmount} video${Number(productionAmount) === 1 ? "" : "s"}`}</button>
          </div>}
          {canConfirmProduction && <div className="ros-production-confirm"><div><strong>Grabación completa</strong><span>Franco o Agustín deben confirmarla antes de crear la edición para Luciano.</span></div><button type="button" disabled={confirmingProduction} onClick={confirmProduction}>{confirmingProduction ? "Confirmando…" : "Confirmar y enviar a edición"}</button></div>}
          {metadata.produccion_confirmada_at && <div className="ros-approved-banner">✓ Grabación confirmada por {metadata.produccion_confirmada_por}. La edición quedó vinculada.</div>}
          {!editing && canRegisterProduction && <div className="ros-production-drive"><label><span>Carpeta de material en Google Drive</span><input inputMode="url" placeholder="https://drive.google.com/…" value={productionDriveLink} onChange={(event) => setProductionDriveLink(event.target.value)}/></label><button type="button" disabled={savingProductionDrive || !productionDriveLink.trim() || productionDriveLink.trim() === String(task.material_referencia || "").trim()} onClick={saveProductionDrive}>{savingProductionDrive ? "Guardando…" : task.material_referencia ? "Actualizar enlace" : "Vincular Drive"}</button></div>}
          {productionProgress.planned === 0 && !editing && <p>Un Líder debe editar esta visita e indicar cuántos videos están previstos.</p>}
          {Array.isArray(metadata.produccion_registros) && metadata.produccion_registros.length > 0 && <details><summary>Ver registros</summary>{metadata.produccion_registros.slice().reverse().map((record) => <div key={record.id || `${record.fecha}-${record.created_at}`}><strong>+{record.cantidad} videos</strong><span>{formatDate(record.fecha)} · {record.usuario || "Equipo"}{record.corregido_at ? ` · Corregido por ${record.corregido_por}` : ""}</span>{canRegisterProduction && !metadata.produccion_confirmada_at && <button type="button" onClick={() => { const value = window.prompt("Cantidad correcta de videos:", String(record.cantidad)); if (value !== null) onCorrectProduction(task, record, Number(value)); }}>Corregir</button>}</div>)}</details>}
        </section>}
        <TaskContentWorkspace task={task} metadata={metadata} editing={editing} draft={draft} setDraft={setDraft} editorRef={scriptEditorRef} onInsertTemplate={insertContentTemplate} onEditContent={isAdmin ? startEditing : null}/>
        <section className="ros-work-block"><div className="ros-block-heading"><div><h3>{isProductionVisit ? "Material de producción" : "Material y referencias"}</h3></div><small>Archivos y enlaces</small></div>{editing ? <><input className="ros-detail-input" placeholder={isProductionVisit ? "Pegá el enlace de la carpeta de Google Drive" : "https://…"} value={draft.material_referencia || ""} onChange={(event) => setDraft({ ...draft, material_referencia: event.target.value })}/>{isProductionVisit && <small className="ros-drive-help">Este enlace es obligatorio para enviar la visita a edición.</small>}</> : <><div className="ros-material-grid">{task.material_referencia && <a className="ros-file" href={task.material_referencia} target="_blank" rel="noreferrer"><span>▣</span><div><strong>{isProductionVisit ? "Abrir carpeta en Google Drive" : (materialInfo?.etiqueta || "Material de referencia")}</strong><small>{materialInfo?.dominio || task.material_referencia}</small></div><b>↗</b></a>}{driveFiles.filter((file) => file.url !== task.material_referencia).map((file) => <a className="ros-file" href={file.url} target="_blank" rel="noreferrer" key={file.id}><span>▤</span><div><strong>{file.name}</strong><small>Google Drive · {file.uploaded_by || "Equipo"}</small></div><b>↗</b></a>)}{links.map((url) => { const info = obtenerInfoLinkTarea(url); return <a className="ros-file" href={url} target="_blank" rel="noreferrer" key={url}><span>↗</span><div><strong>{info.etiqueta}</strong><small>{info.dominio}</small></div><b>↗</b></a>; })}{!task.material_referencia && driveFiles.length === 0 && links.length === 0 && <p className="ros-compact-empty">{isProductionVisit ? "Falta vincular la carpeta de Google Drive." : "Sin material vinculado."}</p>}</div><DriveUploader task={task} onUploaded={async () => { const refreshed = await apiTaskById(task.id); window.dispatchEvent(new CustomEvent("render-os:related-tasks", { detail: [refreshed] })); }}/></>}</section>
        {(origin || task.tarea_padre_id || subtasks.length > 0 || isAdmin) && <section className="ros-work-block"><h3>Organización del trabajo</h3>{(origin || task.tarea_padre_id) && <div className="ros-context-list">{origin && <a href={origin.href}><strong>{origin.label}</strong><span>{formatDate(origin.date)} · {origin.state || "Sin estado"}</span><b>↗</b></a>}{task.tarea_padre_id && <button type="button" onClick={() => onOpen(Number(task.tarea_padre_id))}><strong>Depende de la tarea #{task.tarea_padre_id}</strong><span>Estado: {task.tarea_padre_estado || "Sin datos"}</span></button>}</div>}<div className="ros-subtasks">{subtasks.map((subtask) => <button type="button" key={subtask.id} onClick={() => onOpen(subtask.id)}><span>{subtask.titulo}</span><b>{STATUSES.find((item) => item.id === subtask.estado)?.label || subtask.estado}</b></button>)}{subtasks.length === 0 && !isAdmin && <p className="ros-empty-copy">No hay subtareas cargadas.</p>}</div>{isAdmin && <div className="ros-subtask-create"><input value={subtaskTitle} placeholder="Agregar una subtarea" onChange={(event) => setSubtaskTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") createSubtask(); }}/><button type="button" disabled={!subtaskTitle.trim() || creatingSubtask} onClick={createSubtask}>{creatingSubtask ? "Creando…" : "+ Agregar"}</button></div>}</section>}
        <details className="ros-work-block ros-activity-history">
          <summary>
            <div><small>Último cambio</small><strong>{lastActivity ? lastActivity.contenido.replace(/^\[Actividad\]\s*/, "") : `Tarea creada · ${status.label}`}</strong></div>
            <span>{formatDateTime(lastActivity?.created_at || task.created_at)} · Ver historial</span>
          </summary>
          <div className="ros-comments ros-activity-feed"><article className="activity"><div><strong>Sistema</strong><time>{formatDateTime(task.created_at)}</time></div><p>Creó la tarea.</p></article>{activityComments.map((item) => <article className="activity" key={item.id}><div><strong>{item.autor}</strong><time>{formatDateTime(item.created_at)}</time></div><p>{item.contenido.replace(/^\[Actividad\]\s*/, "")}</p></article>)}</div>
        </details>
        <section className="ros-work-block"><h3>Comentarios</h3>
        {commentError && <div className="ros-inline-error">{commentError}</div>}
        {teamComments.length > 0 && <div className="ros-comments">{teamComments.map((item) => <article key={item.id}><div><strong>{item.autor}</strong><time>{formatDateTime(item.created_at)}</time></div><p>{item.contenido}</p></article>)}</div>}
        <div className="ros-comment-create">
          <div className="ros-comment-author"><Avatar person={users.find((user) => user.nombre === sesion?.usuario?.nombre)} name={sesion?.usuario?.nombre || sesion?.usuario?.usuario}/><div><strong>{sesion?.usuario?.nombre || sesion?.usuario?.usuario || "Equipo RENDER"}</strong><small>El comentario será visible para todo el equipo.</small></div></div>
          <textarea rows={3} value={comment} placeholder="Escribí una actualización, consulta o bloqueo…" onChange={(event) => setComment(event.target.value)}/>
          <button type="button" disabled={!comment.trim() || commenting} onClick={addComment}>{commenting ? "Enviando…" : "Comentar"}</button>
        </div>
        </section>
          </main>
          <aside className="ros-task-context-rail">
        <details className="ros-more-information" open={editing}><summary>Más información</summary><div className={`ros-properties ${editing ? "editing" : ""}`}><label><span>Estado</span>{editing ? <select value={draft.estado || "pendiente"} onChange={(event) => setDraft({ ...draft, estado: event.target.value })}>{STATUSES.map((item) => <option key={item.id} value={item.id} disabled={isProductionVisit && item.id === "publicada" && !productionProgress.complete}>{item.label}</option>)}</select> : <strong><i style={{ color: status.color }}>●</i>{status.label}</strong>}</label><label><span>Responsable</span>{editing ? <select value={draft.asignado_a || ""} onChange={(event) => setDraft({ ...draft, asignado_a: event.target.value })}>{users.map((user) => <option key={user.id} value={user.nombre}>{user.nombre} · @{user.usuario}{user.email_notificaciones ? ` · ${user.email_notificaciones}` : ""}</option>)}</select> : <strong><Avatar person={person} name={task.asignado_a}/>{task.asignado_a || "Sin asignar"}</strong>}</label><label><span>Cliente</span>{editing ? <select value={draft.cliente_id || ""} onChange={(event) => setDraft({ ...draft, cliente_id: event.target.value ? Number(event.target.value) : "" })}><option value="">Sin cliente</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.nombre}</option>)}</select> : <strong>{task.cliente_nombre || "Sin cliente"}</strong>}</label><label><span>Vencimiento</span>{editing ? <input type="date" value={draft.fecha_vencimiento || ""} onChange={(event) => setDraft({ ...draft, fecha_vencimiento: event.target.value })}/> : <strong>{formatDate(task.fecha_vencimiento)}</strong>}</label><label><span>Prioridad</span>{editing ? <select value={draft.prioridad || "media"} onChange={(event) => setDraft({ ...draft, prioridad: event.target.value })}><option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option></select> : <strong>{task.prioridad || "Media"}</strong>}</label><label><span>Sector</span>{editing ? <select value={draft.tipo_tarea || ""} onChange={(event) => setDraft({ ...draft, tipo_tarea: event.target.value })}><option value="">Sin sector</option>{TASK_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select> : <strong>{task.tipo_tarea || "Sin definir"}</strong>}</label></div>{person && !editing && <div className="ros-person-card"><Avatar person={person}/><div><strong>{person.nombre}</strong><span>@{person.usuario} · {getRolLabel(person.rol)}</span><small>{person.email_notificaciones || "Sin correo de notificaciones"}</small></div></div>}{collaborators.length > 0 && !editing && <div className="ros-collaborators"><strong>Colaboran</strong><span>{collaborators.join(", ")}</span></div>}{editing && <div className="ros-edit-extras"><label><span>Subtipo</span><input value={draft.subtipo || ""} onChange={(event) => setDraft({ ...draft, subtipo: event.target.value })}/></label><label><span>Resumen corto</span><input value={draft.resumen || ""} onChange={(event) => setDraft({ ...draft, resumen: event.target.value })}/></label><label><span>Etiquetas</span><input value={draft.etiquetas || ""} onChange={(event) => setDraft({ ...draft, etiquetas: event.target.value })}/></label><fieldset><legend>Colaboradores</legend>{users.filter((user) => user.nombre !== draft.asignado_a).map((user) => <label key={user.id}><input type="checkbox" checked={(draft.colaboradores || []).includes(user.nombre)} onChange={(event) => setDraft({ ...draft, colaboradores: event.target.checked ? [...(draft.colaboradores || []), user.nombre] : (draft.colaboradores || []).filter((name) => name !== user.nombre) })}/><span>{user.nombre}</span></label>)}</fieldset></div>}<div className="ros-origin"><span>ID #{task.id}</span><span>Creada: {formatDate(task.created_at)}</span><span>Actualizada: {formatDate(task.updated_at)}</span></div></details>
        {isAdmin && <details className="ros-task-admin-actions"><summary>Acciones de tarea</summary><div className="ros-danger-zone"><strong>Administrar tarea</strong><p>{isArchived ? "Podés restaurarla al tablero o eliminarla definitivamente." : "Archivala para sacarla del tablero sin perder su historial."}</p><div><button type="button" disabled={archiving} onClick={archiveTask}>{archiving ? (isArchived ? "Restaurando…" : "Archivando…") : (isArchived ? "Restaurar tarea" : "Archivar tarea")}</button>{confirmDelete ? <><button type="button" onClick={() => setConfirmDelete(false)}>Cancelar</button><button className="danger" type="button" disabled={deleting} onClick={deleteTask}>{deleting ? "Eliminando…" : "Eliminar definitivamente"}</button></> : <button className="danger" type="button" onClick={() => setConfirmDelete(true)}>Eliminar…</button>}</div></div></details>}
          </aside>
        </div>
        {isAdmin && editing && <div className="ros-detail-actions ros-edit-footer"><button type="button" onClick={() => { setDraft(task); setEditing(false); }}>Cancelar</button><button className="primary" type="button" disabled={saving || !draft.titulo?.trim() || !draft.asignado_a} onClick={save}>{saving ? "Guardando…" : "Guardar cambios"}</button></div>}
      </div>
    </aside>
  </div>;
}

function TaskPeoplePicker({ users, primary, collaborators, onChange }) {
  const [open, setOpen] = useState(false);
  const selected = [primary, ...(collaborators || [])].filter((name, index, items) => name && items.indexOf(name) === index);
  const toggle = (name) => {
    const next = selected.includes(name) ? selected.filter((item) => item !== name) : [...selected, name];
    onChange({ primary: next[0] || "", collaborators: next.slice(1) });
  };
  return <div className="wide ros-people-picker">
    <div className="ros-people-picker-label"><span>Responsables *</span><small>Podés seleccionar una o varias personas.</small></div>
    {selected.length > 0 && <div className="ros-selected-people">{selected.map((name, index) => <button type="button" key={name} onClick={() => toggle(name)}><Avatar person={users.find((user) => user.nombre === name)} name={name}/><span><strong>{name}</strong><small>{index === 0 ? "Responsable principal" : "Colabora"}</small></span><b aria-hidden="true">×</b></button>)}</div>}
    <button className="ros-add-person" type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}><span>+</span>{selected.length ? "Añadir otra persona" : "Añadir responsable"}<b>{open ? "⌃" : "⌄"}</b></button>
    {open && <div className="ros-people-options">{users.map((user) => { const active = selected.includes(user.nombre); return <button className={active ? "selected" : ""} type="button" key={user.id} onClick={() => toggle(user.nombre)}><Avatar person={user}/><span><strong>{user.nombre}</strong><small>{getRolLabel(user.rol) || `@${user.usuario}`}</small></span><b>{active ? "✓" : "+"}</b></button>; })}</div>}
  </div>;
}

function NewTaskModal({ users, clients, initialStatus = "pendiente", onClose, onCreate }) {
  const [draft, setDraft] = useState({ titulo: "", asignado_a: "", cliente_id: "", estado: initialStatus, tipo_tarea: "", subtipo: "", prioridad: "media", fecha_vencimiento: "", aclaraciones: "", material_referencia: "", resumen: "", etiquetas: "", colaboradores: [], produccion_videos_previstos: "" });
  const [saving, setSaving] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [suggestionMessage, setSuggestionMessage] = useState("");
  const manuallyEdited = useRef(new Set());
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await onCreate({
        ...draft,
        cliente_id: draft.cliente_id ? Number(draft.cliente_id) : null,
        fecha_vencimiento: draft.fecha_vencimiento || null,
        tipo_tarea: draft.tipo_tarea || null,
        subtipo: draft.subtipo || null,
        aclaraciones: draft.aclaraciones || null,
        material_referencia: draft.material_referencia || null,
        resumen: draft.resumen.trim() || null,
        etiquetas: draft.etiquetas.split(",").map((item) => item.trim()).filter(Boolean),
        produccion_videos_previstos: isProductionVisitTask(draft) ? Number(draft.produccion_videos_previstos) : undefined,
      });
    } catch {
      // El modal permanece abierto y el contenedor muestra el error.
    } finally {
      setSaving(false);
    }
  };
  const closeModal = () => {
    if (isNewTaskDraftDirty(draft) && !window.confirm("La tarea todavía no fue creada. ¿Querés descartarla?")) return;
    onClose();
  };
  const applySuggestions = (current, { title = current.titulo, clientId = current.cliente_id, clientWasSelected = false } = {}) => {
    const suggestion = getNewTaskSuggestions({ title, clients, users, clientId: clientWasSelected || manuallyEdited.current.has("client") ? (clientId || "__none__") : "" });
    const next = { ...current, titulo: title };
    if (!manuallyEdited.current.has("client")) next.cliente_id = suggestion.client ? String(suggestion.client.id) : "";
    if (!manuallyEdited.current.has("people")) {
      next.asignado_a = suggestion.primary;
      next.colaboradores = suggestion.collaborators;
    }
    if (!manuallyEdited.current.has("classification")) {
      next.tipo_tarea = suggestion.tipo_tarea;
      next.subtipo = suggestion.subtipo;
    }
    setSuggestionMessage(suggestion.message);
    return next;
  };
  return <div className="ros-drawer-backdrop" onClick={closeModal}><section className="ros-modal ros-quick-task-modal" onClick={(event) => event.stopPropagation()}><header><div><div className="ros-eyebrow">NUEVA TAREA</div><h2>¿Qué hay que hacer?</h2><p>Cargá lo esencial ahora. Los detalles se pueden completar después.</p></div><button type="button" aria-label="Cerrar" onClick={closeModal}>×</button></header><form onSubmit={submit}>
    <label className="wide ros-quick-title"><span>Tarea *</span><input autoFocus required placeholder="Ej.: iPhone Shop | Editar reel de lanzamiento" value={draft.titulo} onChange={(event) => setDraft((current) => applySuggestions(current, { title: event.target.value }))}/></label>
    {suggestionMessage && <div className="wide ros-auto-suggestion"><span>✓</span><div><strong>{suggestionMessage}</strong><small>Es una sugerencia automática: podés cambiar cualquier dato.</small></div></div>}
    <TaskPeoplePicker users={users} primary={draft.asignado_a} collaborators={draft.colaboradores} onChange={({ primary, collaborators }) => { manuallyEdited.current.add("people"); setDraft({ ...draft, asignado_a: primary, colaboradores: collaborators }); }}/>
    <div className="wide ros-quick-grid"><label><span>Cliente</span><select value={draft.cliente_id} onChange={(event) => { manuallyEdited.current.add("client"); setDraft((current) => applySuggestions({ ...current, cliente_id: event.target.value }, { clientId: event.target.value, clientWasSelected: true })); }}><option value="">Sin cliente</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.nombre}</option>)}</select></label><label><span>Fecha</span><input type="date" value={draft.fecha_vencimiento} onChange={(event) => setDraft({ ...draft, fecha_vencimiento: event.target.value })}/></label><label><span>Prioridad</span><select value={draft.prioridad} onChange={(event) => setDraft({ ...draft, prioridad: event.target.value })}><option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option></select></label></div>
    {isProductionVisitTask(draft) && !showDetails && <label className="wide ros-visit-planned-field"><span>¿Cuántos videos incluye esta visita? *</span><input type="number" min="1" step="1" required value={draft.produccion_videos_previstos} onChange={(event) => setDraft({ ...draft, produccion_videos_previstos: event.target.value })}/></label>}
    <button className="wide ros-more-details" type="button" aria-expanded={showDetails} onClick={() => setShowDetails((current) => !current)}><span>{showDetails ? "−" : "+"}</span>{showDetails ? "Ocultar detalles" : "Agregar indicaciones, material o colaboradores"}</button>
    {showDetails && <div className="wide ros-optional-fields"><label><span>Sector</span><select value={draft.tipo_tarea} onChange={(event) => { manuallyEdited.current.add("classification"); setDraft({ ...draft, tipo_tarea: event.target.value }); }}><option value="">Sin sector</option>{TASK_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label><span>Tipo de pieza</span><input placeholder="Reel, carrusel, visita…" value={draft.subtipo} onChange={(event) => { manuallyEdited.current.add("classification"); setDraft({ ...draft, subtipo: event.target.value }); }}/></label>{isProductionVisitTask(draft) && <label className="wide ros-visit-planned-field"><span>¿Cuántos videos incluye esta visita? *</span><input type="number" min="1" step="1" required value={draft.produccion_videos_previstos} onChange={(event) => setDraft({ ...draft, produccion_videos_previstos: event.target.value })}/></label>}<label className="wide"><span>Resumen corto</span><input value={draft.resumen} placeholder="Resultado esperado" onChange={(event) => setDraft({ ...draft, resumen: event.target.value })}/></label><label className="wide"><span>Indicaciones</span><textarea rows={3} placeholder="Datos necesarios para poder resolverla" value={draft.aclaraciones} onChange={(event) => setDraft({ ...draft, aclaraciones: event.target.value })}/></label><label className="wide"><span>Material o enlace</span><input placeholder="https://…" value={draft.material_referencia} onChange={(event) => setDraft({ ...draft, material_referencia: event.target.value })}/></label><label className="wide"><span>Etiquetas</span><input placeholder="Urgente, web, corrección" value={draft.etiquetas} onChange={(event) => setDraft({ ...draft, etiquetas: event.target.value })}/></label></div>}
    <footer><button type="button" onClick={closeModal}>Cancelar</button><button className="primary" type="submit" disabled={saving || !draft.titulo.trim() || !draft.asignado_a}>{saving ? "Creando…" : "Crear tarea"}</button></footer>
  </form></section></div>;
}

function TaskCard({ task, users, today, onOpen, onMove, canMove, selected = false, selectionActive = false, onToggleSelection }) {
  const person = personForTask(task, users);
  const tags = Array.isArray(task.propiedades_extra?.etiquetas) ? task.propiedades_extra.etiquetas : [];
  const collaborators = Array.isArray(task.propiedades_extra?.colaboradores) ? task.propiedades_extra.colaboradores : [];
  const phase = getProductionPhase(task);
  return <article role="button" tabIndex={0} aria-selected={selected} data-task-id={task.id} draggable={canMove && !selectionActive} className={`ros-task-card ${canMove ? "can-move" : "view-only"} ${selected ? "is-selected" : ""}`} onDragStart={(event) => { if (!canMove || selectionActive) { event.preventDefault(); return; } event.dataTransfer.setData("text/task-id", String(task.id)); event.dataTransfer.effectAllowed = "move"; }} onClick={(event) => { if (selectionActive) { event.stopPropagation(); onToggleSelection(task.id); return; } onOpen(task.id); }} onKeyDown={(event) => { if (event.key !== "Enter" && event.key !== " ") return; event.preventDefault(); if (selectionActive) onToggleSelection(task.id); else onOpen(task.id); }}>
    <span className="ros-task-selection-check" aria-hidden="true">✓</span>
    <div className="ros-card-badges"><AreaBadge task={task}/>{phase && <span className={`ros-phase-badge ${phase.id}`}>{phase.label}</span>}</div><h3>{task.titulo}</h3><p>{task.cliente_nombre || "Sin cliente"}</p>
    {task.propiedades_extra?.resumen && <div className="ros-card-summary">{task.propiedades_extra.resumen}</div>}
    {tags.length > 0 && <div className="ros-card-tags">{tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div>}
    {esperandoMaterial(task) && <div className="ros-card-warning">Esperando material</div>}
    <footer><Avatar person={person} name={task.asignado_a}/><span title={collaborators.length ? `Colaboran: ${collaborators.join(", ")}` : ""}>{task.asignado_a || "Sin asignar"}{collaborators.length ? ` +${collaborators.length}` : ""}</span><b className={task.fecha_vencimiento && task.fecha_vencimiento < today && task.estado !== ESTADO_FINAL_TAREA ? "urgent" : ""}>□ {formatDate(task.fecha_vencimiento)}</b></footer>
    {canMove && <select className="ros-mobile-state" aria-label={`Cambiar estado de ${task.titulo}`} value={task.estado} onClick={(event) => event.stopPropagation()} onChange={(event) => { event.stopPropagation(); onMove(task, event.target.value); }}>{STATUSES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>}
  </article>;
}

function TaskCalendar({ tasks, onOpen, monthValue, onMonthChange }) {
  const [cursor, setCursor] = useState(() => {
    if (monthValue) { const [year, month] = monthValue.split("-").map(Number); return new Date(year, month - 1, 1); }
    const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState("");
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstOffset + days) / 7) * 7;
  const cells = Array.from({ length: totalCells }, (_, index) => {
    const day = index - firstOffset + 1;
    return day > 0 && day <= days ? day : null;
  });
  const byDate = new Map();
  tasks.forEach((task) => { if (!task.fecha_vencimiento) return; const key = String(task.fecha_vencimiento).slice(0, 10); byDate.set(key, [...(byDate.get(key) || []), task]); });
  const today = getHoyLocalISO();
  const label = cursor.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  const moveMonth = (delta) => { const next = new Date(year, month + delta, 1); setSelectedDate(""); setCursor(next); onMonthChange(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`); };
  const selectedTasks = selectedDate ? byDate.get(selectedDate) || [] : [];
  const selectedDateLabel = selectedDate ? new Date(`${selectedDate}T12:00:00`).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" }) : "";
  useEffect(() => {
    if (!selectedDate) return undefined;
    const closeOnEscape = (event) => { if (event.key === "Escape") setSelectedDate(""); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedDate]);
  const openFromSummary = (taskId) => { setSelectedDate(""); onOpen(taskId); };
  return <>
    <section className="ros-calendar">
      <header><button type="button" aria-label="Mes anterior" onClick={() => moveMonth(-1)}>‹</button><strong>{label}</strong><button type="button" aria-label="Mes siguiente" onClick={() => moveMonth(1)}>›</button></header>
      <div className="ros-calendar-week"><span>Lun</span><span>Mar</span><span>Mié</span><span>Jue</span><span>Vie</span><span>Sáb</span><span>Dom</span></div>
      <div className="ros-calendar-grid">{cells.map((day, index) => {
        if (!day) return <div className="ros-calendar-day muted" key={`empty-${index}`}/>;
        const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const items = byDate.get(key) || [];
        return <div className={`ros-calendar-day ${key === today ? "today" : ""}`} key={key}>
          <button className="ros-calendar-day-number" type="button" aria-label={`Ver resumen del ${day}`} onClick={() => setSelectedDate(key)}>{day}</button>
          <div className="ros-calendar-day-tasks">{items.slice(0, 3).map((task) => <button className={`ros-calendar-task area-${areaForTask(task)}`} title={`${task.titulo} · ${task.cliente_nombre || "Sin cliente"}`} type="button" key={task.id} onClick={() => onOpen(task.id)}><strong>{task.titulo}</strong><small>{task.cliente_nombre || "Sin cliente"}</small></button>)}{items.length > 3 && <button className="ros-calendar-more" type="button" onClick={() => setSelectedDate(key)}>+{items.length - 3} más</button>}</div>
        </div>;
      })}</div>
      {tasks.some((task) => !task.fecha_vencimiento) && <p className="ros-calendar-note">{tasks.filter((task) => !task.fecha_vencimiento).length} tareas sin fecha no aparecen en el calendario.</p>}
    </section>
    {selectedDate && <div className="ros-day-preview-backdrop" role="presentation" onMouseDown={() => setSelectedDate("")}>
      <section className="ros-day-preview" role="dialog" aria-modal="true" aria-labelledby="ros-day-preview-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><small>Resumen del día</small><h2 id="ros-day-preview-title">{selectedDateLabel}</h2><span>{selectedTasks.length} {selectedTasks.length === 1 ? "tarea" : "tareas"}</span></div><button type="button" aria-label="Cerrar resumen" onClick={() => setSelectedDate("")}>×</button></header>
        <div className="ros-day-preview-list">{selectedTasks.map((task) => { const state = STATUSES.find((item) => item.id === task.estado); return <button type="button" key={task.id} onClick={() => openFromSummary(task.id)}><i style={{ background: state?.color || "#8d9095" }}/><div><strong>{task.titulo}</strong><span>{task.cliente_nombre || "Sin cliente"} · {task.asignado_a || "Sin responsable"}</span></div><b>{state?.label || task.estado}</b><em>›</em></button>; })}{selectedTasks.length === 0 && <div className="ros-day-preview-empty"><span>○</span><strong>No hay tareas para este día</strong><small>Podés elegir otra fecha o cerrar el resumen.</small></div>}</div>
      </section>
    </div>}
  </>;
}

function TasksByClient({ tasks, onOpen }) {
  const groups = [...new Set(tasks.map((task) => task.cliente_nombre || "Sin cliente"))].sort().map((name) => ({ name, tasks: tasks.filter((task) => (task.cliente_nombre || "Sin cliente") === name) }));
  return <div className="ros-project-grid">{groups.map((group) => <section className="ros-project-card" key={group.name}><header><div><span>{initials(group.name)}</span><strong>{group.name}</strong></div><small>{group.tasks.length} tareas</small></header><div>{group.tasks.map((task) => <button type="button" key={task.id} onClick={() => onOpen(task.id)}><span>{task.titulo}</span><b>{STATUSES.find((item) => item.id === task.estado)?.label || task.estado}</b><small>{task.asignado_a} · {formatDate(task.fecha_vencimiento)}</small></button>)}</div></section>)}</div>;
}

function BulkActionsMenu({ count, archiveMode, busy, onAction, onClear }) {
  const menuRef = useRef(null);
  const run = async (action) => {
    await onAction(action);
    menuRef.current?.removeAttribute("open");
  };
  return <details className="ros-bulk-menu" ref={menuRef}>
    <summary aria-label="Acciones para tareas seleccionadas" title="Acciones para tareas seleccionadas">
      <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
      {count > 0 && <b>{count}</b>}
    </summary>
    <div className="ros-bulk-menu-panel">
      <header><strong>{count > 0 ? `${count} ${count === 1 ? "tarea seleccionada" : "tareas seleccionadas"}` : "Acciones masivas"}</strong><small>{count > 0 ? "Elegí qué hacer con la selección." : "Arrastrá desde un espacio vacío para seleccionar."}</small></header>
      {archiveMode === "active" && <button type="button" disabled={!count || busy} onClick={() => run("archivar")}><span>Archivar</span><small>Sacarlas del tablero sin perderlas</small></button>}
      {archiveMode !== "active" && <button type="button" disabled={!count || busy} onClick={() => run("restaurar")}><span>Restaurar al tablero</span><small>Volver a mostrarlas como tareas activas</small></button>}
      {archiveMode !== "trash" && <button className="danger" type="button" disabled={!count || busy} onClick={() => run("papelera")}><span>Enviar a Papelera</span><small>Se podrán recuperar más adelante</small></button>}
      {count > 0 && <button className="quiet" type="button" disabled={busy} onClick={onClear}>Cancelar selección</button>}
    </div>
  </details>;
}

function TasksView({ tasks, totalTasks, loadingMore, onLoadMore, users, clients, query, setQuery, area, setArea, responsible, setResponsible, client, setClient, sector, setSector, priority, setPriority, archiveMode, setArchiveMode, sesion, onCreate, onUpdate, onRegisterProduction, onCorrectProduction, onConfirmProduction, onApprove, onDelete, onBulkAction, onError }) {
  const initialViewState = useMemo(() => getTaskViewState(window.location.search), []);
  const initialTask = Number(new URLSearchParams(window.location.search).get("task")) || null;
  const [view, setView] = useState(initialViewState.view);
  const [calendarMonth, setCalendarMonth] = useState(initialViewState.calendarMonth);
  const [selectedId, setSelectedId] = useState(initialTask);
  const [creatingStatus, setCreatingStatus] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dragOver, setDragOver] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [selectionBox, setSelectionBox] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const boardRef = useRef(null);
  const selectionStartRef = useRef(null);
  const isAdmin = sesion?.usuario?.rol === "admin";
  const today = getHoyLocalISO();
  const selected = tasks.find((task) => task.id === selectedId) || null;
  const responsibleOptions = [...new Set([
    ...users.map((user) => user.nombre),
    ...tasks.flatMap((task) => [task.asignado_a, ...(Array.isArray(task.propiedades_extra?.colaboradores) ? task.propiedades_extra.colaboradores : [])]),
  ].filter(Boolean))].sort();
  const visible = useMemo(() => tasks.filter((task) => {
    const collaborators = Array.isArray(task.propiedades_extra?.colaboradores) ? task.propiedades_extra.colaboradores : [];
    const text = `${task.titulo} ${task.cliente_nombre || ""} ${task.asignado_a || ""} ${collaborators.join(" ")} ${task.propiedades_extra?.resumen || ""}`.toLowerCase();
    const isArchived = task.propiedades_extra?.archivada_render_os === true;
    const isTrashed = task.propiedades_extra?.papelera_render_os === true;
    return (archiveMode === "trash" ? isTrashed : archiveMode === "archived" ? isArchived && !isTrashed : !isArchived && !isTrashed)
      && (area === "all" || areaForTask(task) === area)
      && (responsible === "all" || task.asignado_a === responsible || collaborators.includes(responsible))
      && (client === "all" || String(task.cliente_id || "none") === client)
      && (sector === "all" || String(task.tipo_tarea || "none") === sector)
      && (priority === "all" || task.prioridad === priority)
      && text.includes(query.toLowerCase());
  }), [tasks, query, area, responsible, client, sector, priority, archiveMode]);
  const paginatedTaskCount = tasks.filter((task) => !task.__renderOsDirectOnly).length;
  const hasFilters = responsible !== "all" || client !== "all" || sector !== "all" || priority !== "all" || area !== "all";
  const activeFilterCount = [responsible, client, sector, priority, area].filter((value) => value !== "all").length;
  const emptyMessage = getTasksEmptyMessage({ hasFilters, query, totalTasks, archiveMode });
  const selectionActive = selectedIds.size > 0;

  useEffect(() => {
    setSelectedIds(new Set());
    setSelectionBox(null);
    selectionStartRef.current = null;
  }, [view, archiveMode]);

  const startAreaSelection = (event) => {
    if (event.button !== 0 || event.pointerType === "touch" || event.target.closest(".ros-task-card, button, input, select, a, summary")) return;
    selectionStartRef.current = { x: event.clientX, y: event.clientY };
    setSelectedIds(new Set());
    setSelectionBox(normalizeSelectionRect(event.clientX, event.clientY, event.clientX, event.clientY));
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };
  const continueAreaSelection = (event) => {
    const start = selectionStartRef.current;
    if (!start || !boardRef.current) return;
    const rectangle = normalizeSelectionRect(start.x, start.y, event.clientX, event.clientY);
    setSelectionBox(rectangle);
    const hits = [...boardRef.current.querySelectorAll("[data-task-id]")]
      .filter((element) => selectionRectsIntersect(rectangle, element.getBoundingClientRect()))
      .map((element) => Number(element.dataset.taskId));
    setSelectedIds(new Set(hits));
  };
  const finishAreaSelection = (event) => {
    if (!selectionStartRef.current) return;
    selectionStartRef.current = null;
    setSelectionBox(null);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };
  const toggleTaskSelection = (id) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const runBulkAction = async (action) => {
    const ids = [...selectedIds];
    if (!ids.length || bulkBusy) return;
    const label = action === "archivar" ? "archivar" : action === "papelera" ? "enviar a Papelera" : "restaurar";
    if (!window.confirm(`¿Querés ${label} ${ids.length} ${ids.length === 1 ? "tarea" : "tareas"}?`)) return;
    setBulkBusy(true);
    try {
      await onBulkAction(ids, action);
      setSelectedIds(new Set());
    } catch {
      // El contenedor muestra el error y conserva la selección para reintentar.
    } finally {
      setBulkBusy(false);
    }
  };

  const incorporateRelatedTasks = useCallback((items) => {
    window.dispatchEvent(new CustomEvent("render-os:related-tasks", { detail: items }));
  }, []);
  const loadSubtasks = useCallback(async (id) => {
    const items = await apiSubtasks(id);
    incorporateRelatedTasks(items);
    return items;
  }, [incorporateRelatedTasks]);

  const openTask = useCallback(async (id) => {
    try {
      if (!tasks.some((task) => task.id === id)) {
        const task = await apiTaskById(id);
        incorporateRelatedTasks([task]);
      }
      setSelectedId(id);
      const url = new URL(window.location.href);
      url.searchParams.set("task", String(id));
      window.history.pushState({ task: id }, "", url);
    } catch (reason) {
      onError(reason.message || "No se pudo abrir la tarea.");
    }
  }, [tasks, incorporateRelatedTasks]);
  const closeTask = useCallback(() => {
    if (window.history.state?.task) {
      window.history.back();
      return;
    }
    setSelectedId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("task");
    window.history.replaceState({}, "", url);
  }, []);
  useEffect(() => {
    const onPop = () => setSelectedId(Number(new URLSearchParams(window.location.search).get("task")) || null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    const url = updateTaskViewUrl(window.location.href, { view, archiveMode, responsible, client, sector, priority, area, query, calendarMonth });
    window.history.replaceState(window.history.state, "", url);
  }, [view, archiveMode, responsible, client, sector, priority, area, query, calendarMonth]);

  const move = (task, status) => {
    if (status === task.estado) return;
    void onUpdate(task.id, { estado: status }, `movió la tarea de ${STATUSES.find((item) => item.id === task.estado)?.label || task.estado} a ${STATUSES.find((item) => item.id === status)?.label || status}`).catch(() => {});
  };
  const createSubtask = async (parent, title) => onCreate({ titulo: title, asignado_a: parent.asignado_a, cliente_id: parent.cliente_id || null, estado: "pendiente", tipo_tarea: parent.tipo_tarea || null, subtipo: parent.subtipo || null, prioridad: parent.prioridad || "media", fecha_vencimiento: parent.fecha_vencimiento || null, tarea_padre_id: parent.id });
  const clearFilters = () => { setQuery(""); setResponsible("all"); setClient("all"); setSector("all"); setPriority("all"); setArea("all"); };

  const archiveTask = async (task, archived) => {
    await onUpdate(task.id, { propiedades_extra: { archivada_render_os: archived } }, archived ? "archivó la tarea" : "restauró la tarea");
    closeTask();
  };

  return <><section className="ros-page">
    <div className="ros-title-row"><div className="ros-title-with-menu"><BulkActionsMenu count={selectedIds.size} archiveMode={archiveMode} busy={bulkBusy} onAction={runBulkAction} onClear={() => setSelectedIds(new Set())}/><div><div className="ros-page-icon" aria-hidden="true">✓</div><div className="ros-eyebrow">ESPACIO DE TRABAJO</div><h1>Tareas</h1><p>Organizá, asigná y revisá el trabajo del equipo en un solo lugar.</p></div></div><div className="ros-title-actions"><input className="ros-top-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar tarea, cliente o responsable…"/><button className="ros-primary-button" type="button" onClick={() => setCreatingStatus("pendiente")}>+ Nueva tarea</button></div></div>
    <div className="ros-controls"><div><button aria-pressed={view === "board"} className={view === "board" ? "active" : ""} onClick={() => setView("board")}>▦ Tablero</button><button aria-pressed={view === "list"} className={view === "list" ? "active" : ""} onClick={() => setView("list")}>☷ Lista</button><button aria-pressed={view === "calendar"} className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")}>□ Calendario</button><button aria-pressed={view === "clients"} className={view === "clients" ? "active" : ""} onClick={() => setView("clients")}>◌ Por cliente</button></div><div className="ros-controls-meta"><span>Mostrando {visible.length} de {totalTasks}</span>{archiveMode !== "active" && <button className="ros-archive-link" type="button" onClick={() => setArchiveMode("active")}>← Volver a tareas activas</button>}{archiveMode !== "archived" && <button className="ros-archive-link" type="button" onClick={() => setArchiveMode("archived")}>Ver archivadas</button>}{archiveMode !== "trash" && <button className="ros-archive-link" type="button" onClick={() => setArchiveMode("trash")}>Papelera</button>}</div></div>
    {selectionActive && <div className="ros-selection-status" role="status"><strong>{selectedIds.size} {selectedIds.size === 1 ? "tarea seleccionada" : "tareas seleccionadas"}</strong><span>Hacé clic en una tarjeta para agregarla o quitarla.</span><button type="button" onClick={() => setSelectedIds(new Set())}>Cancelar</button></div>}
    <button className="ros-filter-toggle" type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((current) => !current)}>Filtros{activeFilterCount ? <b>{activeFilterCount}</b> : null}<span>{filtersOpen ? "Ocultar" : "Mostrar"}</span></button>
    <div className={`ros-filter-bar ${filtersOpen ? "open" : ""}`}><label><span>Área</span><select aria-label="Área" value={area} onChange={(event) => setArea(event.target.value)}><option value="all">Todas</option>{AREAS.slice(1).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label><span>Responsable</span><select aria-label="Responsable" value={responsible} onChange={(event) => setResponsible(event.target.value)}><option value="all">Todos</option>{responsibleOptions.map((name) => <option key={name} value={name}>{name}</option>)}</select></label><label><span>Cliente</span><select aria-label="Cliente" value={client} onChange={(event) => setClient(event.target.value)}><option value="all">Todos</option><option value="none">Sin cliente</option>{clients.map((item) => <option key={item.id} value={String(item.id)}>{item.nombre}</option>)}</select></label><label><span>Sector</span><select aria-label="Sector" value={sector} onChange={(event) => setSector(event.target.value)}><option value="all">Todos</option><option value="none">Sin sector</option>{TASK_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label><span>Prioridad</span><select aria-label="Prioridad" value={priority} onChange={(event) => setPriority(event.target.value)}><option value="all">Todas</option><option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option></select></label>{hasFilters && <button type="button" onClick={clearFilters}>Limpiar filtros</button>}</div>
    {view === "board" && <div ref={boardRef} className={`ros-board ros-board-four ${selectionBox ? "is-selecting" : ""}`} onPointerDown={startAreaSelection} onPointerMove={continueAreaSelection} onPointerUp={finishAreaSelection} onPointerCancel={finishAreaSelection}>{selectionBox && <div className="ros-selection-rectangle" aria-hidden="true" style={{ left: selectionBox.left, top: selectionBox.top, width: selectionBox.width, height: selectionBox.height }}/>} {BOARD_COLUMNS.map((column) => { const items = visible.filter((task) => column.states.includes(task.estado)); return <section className={`ros-column ${dragOver === column.id ? "drag-over" : ""}`} key={column.id} onDragOver={(event) => { if (!event.dataTransfer.types.includes("text/task-id")) return; event.preventDefault(); setDragOver(column.id); }} onDragLeave={() => setDragOver("")} onDrop={(event) => { event.preventDefault(); setDragOver(""); const task = tasks.find((item) => String(item.id) === event.dataTransfer.getData("text/task-id")); if (task && canUserMoveTask(task, sesion?.usuario)) move(task, column.dropState || column.id); }}><header><span style={{ color: column.color }}>●</span><strong>{column.label}</strong><small>{items.length}</small></header><div>{items.slice(0, 250).map((task) => <TaskCard key={task.id} task={task} users={users} today={today} onOpen={openTask} onMove={move} canMove={canUserMoveTask(task, sesion?.usuario)} selected={selectedIds.has(task.id)} selectionActive={selectionActive} onToggleSelection={toggleTaskSelection}/>)}{items.length > 250 && <div className="ros-column-limit">Mostrando 250 de {items.length}. Usá los filtros para acotar.</div>}{items.length === 0 && <button className="ros-empty-column" type="button" onClick={() => setCreatingStatus(column.dropState || column.id)}><span>+</span>Nueva tarea</button>}</div></section>; })}</div>}
    {view === "list" && <div className="ros-task-list"><div className="ros-task-list-head"><span>TAREA</span><span>ÁREA</span><span>CLIENTE</span><span>RESPONSABLE</span><span>ESTADO</span><span>FECHA</span></div>{visible.slice(0, 500).map((task) => <button key={task.id} onClick={() => openTask(task.id)}><strong>{task.titulo}</strong><AreaBadge task={task}/><span>{task.cliente_nombre || "Sin cliente"}</span><span>{task.asignado_a || "Sin asignar"}</span><span>{STATUSES.find((item) => item.id === task.estado)?.label || task.estado}</span><span>{formatDate(task.fecha_vencimiento)}</span></button>)}{visible.length > 500 && <div className="ros-list-limit">Mostrando 500 de {visible.length}. Usá los filtros para acotar.</div>}</div>}
    {view === "calendar" && <TaskCalendar tasks={visible} onOpen={openTask} monthValue={calendarMonth} onMonthChange={setCalendarMonth}/>} {view === "clients" && <TasksByClient tasks={visible} onOpen={openTask}/>} {view !== "board" && visible.length === 0 && <div className="ros-no-results">{emptyMessage}</div>}
    {paginatedTaskCount < totalTasks && <div className="ros-load-more"><button type="button" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? "Cargando…" : `Cargar más tareas (${paginatedTaskCount} de ${totalTasks})`}</button></div>}
  </section>
  <TaskDetail task={selected} tasks={tasks} users={users} clients={clients} sesion={sesion} onClose={closeTask} onOpen={openTask} onLoadSubtasks={loadSubtasks} onUpdate={onUpdate} onRegisterProduction={onRegisterProduction} onCorrectProduction={onCorrectProduction} onConfirmProduction={onConfirmProduction} onApprove={onApprove} onArchive={archiveTask} onDelete={async (id) => { await onDelete(id); closeTask(); }} onCreateSubtask={createSubtask}/>
  {creatingStatus && <NewTaskModal users={users} clients={clients} initialStatus={creatingStatus} onClose={() => setCreatingStatus(null)} onCreate={async (draft) => { const created = await onCreate(draft); setCreatingStatus(null); openTask(created.id); }}/>}</>;
}

export function WorkspaceReadOnlyPage({ sesion }) {
  const initialViewState = useMemo(() => getTaskViewState(window.location.search), []);
  const [tasks, setTasks] = useState([]);
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalTasks, setTotalTasks] = useState(0);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState(initialViewState.query);
  const [area, setArea] = useState(initialViewState.area);
  const [responsible, setResponsible] = useState(initialViewState.responsible);
  const [client, setClient] = useState(initialViewState.client);
  const [sector, setSector] = useState(initialViewState.sector);
  const [priority, setPriority] = useState(initialViewState.priority);
  const [archiveMode, setArchiveMode] = useState(initialViewState.archiveMode);
  const tasksRef = useRef(tasks);
  const updateQueuesRef = useRef(new Map());
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  useEffect(() => {
    let active = true;
    Promise.all([apiJson("/api/clientes"), apiJson("/api/usuarios")])
      .then(([clientData, userData]) => {
        if (!active) return;
        setClients(clientData);
        setUsers(userData);
      })
      .catch((reason) => { if (active) setError(reason.message || "No se pudieron cargar los datos reales."); })
    return () => { active = false; };
  }, [reloadKey]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      apiTaskPage({ offset: 0, query, area, responsible, client, sector, priority, archiveMode })
        .then(async (taskPage) => {
          if (!active) return;
          let items = taskPage.items;
          const directTaskId = Number(new URLSearchParams(window.location.search).get("task")) || null;
          if (directTaskId && !items.some((task) => task.id === directTaskId)) {
            try {
              const directTask = await apiTaskById(directTaskId);
              items = mergeRelatedTasks(items, [{ ...directTask, __renderOsDirectOnly: true }]);
            } catch (reason) {
              notify(reason.message || "La tarea enlazada no está disponible.", "error");
              const url = new URL(window.location.href);
              url.searchParams.delete("task");
              window.history.replaceState(window.history.state, "", url);
              window.dispatchEvent(new PopStateEvent("popstate"));
            }
          }
          if (!active) return;
          setTasks(items);
          setTotalTasks(taskPage.total);
          setError("");
        })
        .catch((reason) => { if (active) setError(reason.message || "No se pudieron cargar las tareas."); })
        .finally(() => { if (active) setLoading(false); });
    }, query ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, area, responsible, client, sector, priority, archiveMode, reloadKey]);

  useEffect(() => {
    const incorporate = (event) => {
      const items = Array.isArray(event.detail) ? event.detail : [];
      setTasks((current) => mergeRelatedTasks(current, items));
    };
    window.addEventListener("render-os:related-tasks", incorporate);
    return () => window.removeEventListener("render-os:related-tasks", incorporate);
  }, []);

  const loadMoreTasks = async () => {
    const paginatedTaskCount = tasks.filter((task) => !task.__renderOsDirectOnly).length;
    if (loadingMore || paginatedTaskCount >= totalTasks) return;
    setLoadingMore(true);
    try {
      const page = await apiTaskPage({ offset: paginatedTaskCount, query, area, responsible, client, sector, priority, archiveMode });
      setTasks((current) => {
        const pageIds = new Set(page.items.map((item) => item.id));
        const retained = current.filter((task) => !task.__renderOsDirectOnly || !pageIds.has(task.id));
        return [...retained, ...page.items.filter((item) => !retained.some((task) => task.id === item.id))];
      });
      setTotalTasks(page.total);
    } catch (reason) {
      notify(reason.message || "No se pudieron cargar más tareas.", "error");
    } finally {
      setLoadingMore(false);
    }
  };

  const notify = (message, type = "success") => { setToast({ message, type }); window.clearTimeout(window.__rosToastTimer); window.__rosToastTimer = window.setTimeout(() => setToast(null), 3500); };
  const logActivity = (taskId, message) => apiRequest(`/api/tareas/${taskId}/comentarios?workspace=render_os`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autor: sesion?.usuario?.nombre || sesion?.usuario?.usuario || "Equipo RENDER", contenido: `[Actividad] ${message}` }) });
  const updateTask = (id, changes, activity) => {
    const run = async () => {
      const previous = tasksRef.current.find((task) => task.id === id);
      if (!previous) throw new Error("La tarea ya no está disponible.");
      setTasks((current) => current.map((task) => task.id === id ? { ...task, ...changes } : task));
      try {
        const updated = await apiRequest(`/api/tareas/${id}?workspace=render_os`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...changes, expected_updated_at: previous.updated_at || undefined }) });
        const selectedClient = clients.find((item) => String(item.id) === String(updated.cliente_id));
        const complete = { ...previous, ...updated, cliente_nombre: selectedClient?.nombre || null };
        tasksRef.current = tasksRef.current.map((task) => task.id === id ? complete : task);
        setTasks((current) => current.map((task) => task.id === id ? complete : task));
        let historyFailed = false;
        if (activity) {
          try { await logActivity(id, activity); }
          catch { historyFailed = true; }
        }
        notify(historyFailed ? "Cambio guardado, pero no se pudo registrar la actividad." : "Cambio guardado en la tarea real.", historyFailed ? "error" : "success");
        return complete;
      } catch (reason) {
        if (reason.status === 409) {
          let currentTask = null;
          try {
            currentTask = await apiTaskById(id);
            if (canRetryTaskUpdate(previous, currentTask, changes)) {
              const retried = await apiRequest(`/api/tareas/${id}?workspace=render_os`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...changes, expected_updated_at: currentTask.updated_at || undefined }) });
              const selectedClient = clients.find((item) => String(item.id) === String(retried.cliente_id));
              const complete = { ...currentTask, ...retried, cliente_nombre: selectedClient?.nombre || currentTask.cliente_nombre || null };
              tasksRef.current = tasksRef.current.map((task) => task.id === id ? complete : task);
              setTasks((current) => current.map((task) => task.id === id ? complete : task));
              let historyFailed = false;
              if (activity) {
                try { await logActivity(id, activity); }
                catch { historyFailed = true; }
              }
              notify(historyFailed ? "Cambio guardado, pero no se pudo registrar la actividad." : "Cambio guardado en la tarea real.", historyFailed ? "error" : "success");
              return complete;
            }
            tasksRef.current = tasksRef.current.map((task) => task.id === id ? currentTask : task);
            setTasks((current) => current.map((task) => task.id === id ? currentTask : task));
          } catch {
            if (currentTask) {
              tasksRef.current = tasksRef.current.map((task) => task.id === id ? currentTask : task);
              setTasks((current) => current.map((task) => task.id === id ? currentTask : task));
            } else {
              setTasks((current) => current.filter((task) => task.id !== id));
            }
          }
        } else {
          tasksRef.current = tasksRef.current.map((task) => task.id === id ? previous : task);
          setTasks((current) => current.map((task) => task.id === id ? previous : task));
        }
        notify(reason.message || "No se pudo guardar el cambio.", "error");
        throw reason;
      }
    };
    const previousQueue = updateQueuesRef.current.get(id) || Promise.resolve();
    const queued = previousQueue.catch(() => {}).then(run);
    updateQueuesRef.current.set(id, queued);
    void queued.finally(() => { if (updateQueuesRef.current.get(id) === queued) updateQueuesRef.current.delete(id); }).catch(() => {});
    return queued;
  };
  const createTask = async (draft) => {
    try {
      const created = await apiRequest("/api/tareas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, workspace: "render_os" }) });
      const client = clients.find((item) => String(item.id) === String(created.cliente_id));
      const complete = { ...created, cliente_nombre: client?.nombre || null };
      setTasks((current) => [complete, ...current]);
      setTotalTasks((current) => current + 1);
      try {
        await logActivity(created.id, draft.tarea_padre_id ? `creó esta subtarea dentro de la tarea #${draft.tarea_padre_id}` : "creó y asignó la tarea desde RENDER OS");
        notify(draft.tarea_padre_id ? "Subtarea creada." : "Tarea creada y asignada.");
      } catch {
        notify("Tarea creada, pero no se pudo registrar la actividad.", "error");
      }
      return complete;
    } catch (reason) {
      notify(reason.message || "No se pudo crear la tarea.", "error");
      throw reason;
    }
  };
  const registerProduction = async (task, cantidad, fecha) => {
    try {
      const updated = await apiRequest(`/api/tareas/${task.id}/produccion/registros?workspace=render_os`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cantidad, fecha, expected_updated_at: task.updated_at || undefined }),
      });
      const complete = { ...task, ...updated, cliente_nombre: task.cliente_nombre || null };
      tasksRef.current = tasksRef.current.map((item) => item.id === task.id ? complete : item);
      setTasks((current) => current.map((item) => item.id === task.id ? complete : item));
      notify(`${cantidad} video${cantidad === 1 ? "" : "s"} registrado${cantidad === 1 ? "" : "s"} en la visita.`);
      return complete;
    } catch (reason) {
      if (reason.status === 409) {
        try {
          const currentTask = await apiTaskById(task.id);
          tasksRef.current = tasksRef.current.map((item) => item.id === task.id ? currentTask : item);
          setTasks((current) => current.map((item) => item.id === task.id ? currentTask : item));
        } catch {
          // Se conserva la tarea actual si la recarga también falla.
        }
      }
      notify(reason.message || "No se pudo registrar la grabación.", "error");
      throw reason;
    }
  };
  const confirmProduction = async (task) => {
    try {
      const result = await apiRequest(`/api/tareas/${task.id}/produccion/confirmar?workspace=render_os`, { method: "POST" });
      const updated = { ...task, ...result.task, cliente_nombre: task.cliente_nombre || null };
      const additions = result.editing_task ? [{ ...result.editing_task, cliente_nombre: task.cliente_nombre || null }] : [];
      setTasks((current) => mergeRelatedTasks(current.map((item) => item.id === task.id ? updated : item), additions));
      notify(result.created ? "Grabación confirmada. Se creó la edición para Luciano." : "Grabación confirmada.");
      return updated;
    } catch (reason) {
      notify(reason.message || "No se pudo confirmar la grabación.", "error");
      throw reason;
    }
  };
  const correctProduction = async (task, record, cantidad) => {
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      notify("Ingresá una cantidad válida mayor que cero.", "error");
      return null;
    }
    try {
      const updated = await apiRequest(`/api/tareas/${task.id}/produccion/registros/${record.id}?workspace=render_os`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cantidad }),
      });
      const complete = { ...task, ...updated, cliente_nombre: task.cliente_nombre || null };
      setTasks((current) => current.map((item) => item.id === task.id ? complete : item));
      notify(`Registro corregido de ${record.cantidad} a ${cantidad} videos.`);
      return complete;
    } catch (reason) {
      notify(reason.message || "No se pudo corregir el registro.", "error");
      throw reason;
    }
  };
  const approveTask = async (task) => {
    try {
      const updated = await apiRequest(`/api/tareas/${task.id}/aprobar-publicacion?workspace=render_os`, { method: "POST" });
      const complete = { ...task, ...updated, cliente_nombre: task.cliente_nombre || null };
      tasksRef.current = tasksRef.current.map((item) => item.id === task.id ? complete : item);
      setTasks((current) => current.map((item) => item.id === task.id ? complete : item));
      try { await logActivity(task.id, "aprobó el material y lo envió a Oriana"); }
      catch { /* La aprobación ya quedó guardada. */ }
      notify("Tarea aprobada y enviada a Oriana.");
      return complete;
    } catch (reason) {
      notify(reason.message || "No se pudo aprobar la tarea.", "error");
      throw reason;
    }
  };
  const deleteTask = async (id) => {
    try {
      await apiRequest(`/api/tareas/${id}?workspace=render_os`, { method: "DELETE" });
      setTasks((current) => current.filter((task) => task.id !== id));
      setTotalTasks((current) => Math.max(0, current - 1));
      notify("Tarea eliminada definitivamente.");
    } catch (reason) {
      notify(reason.message || "No se pudo eliminar la tarea.", "error");
      throw reason;
    }
  };
  const bulkTaskAction = async (ids, action) => {
    try {
      const result = await apiRequest("/api/tareas/acciones-masivas?workspace=render_os", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, accion: action }),
      });
      const affected = new Set(result.ids || []);
      setTasks((current) => current.filter((task) => !affected.has(task.id)));
      setTotalTasks((current) => Math.max(0, current - affected.size));
      const message = action === "archivar"
        ? `${affected.size} ${affected.size === 1 ? "tarea archivada" : "tareas archivadas"}.`
        : action === "papelera"
          ? `${affected.size} ${affected.size === 1 ? "tarea enviada" : "tareas enviadas"} a Papelera.`
          : `${affected.size} ${affected.size === 1 ? "tarea restaurada" : "tareas restauradas"}.`;
      notify(message);
      return result;
    } catch (reason) {
      notify(reason.message || "No se pudo completar la acción masiva.", "error");
      throw reason;
    }
  };

  const retry = () => { setError(""); setLoading(true); setReloadKey((current) => current + 1); };
  return <div className="render-workspace"><Toast toast={toast} onClose={() => setToast(null)}/><main className="ros-main">{loading || error ? <LoadingState error={error} onRetry={retry}/> : <TasksView tasks={tasks} totalTasks={totalTasks} loadingMore={loadingMore} onLoadMore={loadMoreTasks} users={users} clients={clients} query={query} setQuery={setQuery} area={area} setArea={setArea} responsible={responsible} setResponsible={setResponsible} client={client} setClient={setClient} sector={sector} setSector={setSector} priority={priority} setPriority={setPriority} archiveMode={archiveMode} setArchiveMode={setArchiveMode} sesion={sesion} onCreate={createTask} onUpdate={updateTask} onRegisterProduction={registerProduction} onCorrectProduction={correctProduction} onConfirmProduction={confirmProduction} onApprove={approveTask} onDelete={deleteTask} onBulkAction={bulkTaskAction} onError={(message) => notify(message, "error")}/>}</main></div>;
}
