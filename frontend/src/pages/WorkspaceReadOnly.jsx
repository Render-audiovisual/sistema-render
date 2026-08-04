import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ESTADO_FINAL_TAREA, ROL_LABELS } from "../constants.js";
import { esperandoMaterial, extraerUrlsTarea, getTipoPublicacionLabel, obtenerInfoLinkTarea, renderizarTextoTarea } from "../utils.jsx";
import { AREAS, STATUSES, TASK_TYPES } from "../features/render-os/constants.js";
import { apiJson, apiRequest, apiSubtasks, apiTaskById, apiTaskPage } from "../features/render-os/services/render-os-api.js";
import { areaForTask, formatDate, formatDateTime, initials, personForTask } from "../features/render-os/utils/task-formatters.js";
import { mergeRelatedTasks } from "../workspace-task-state.js";
import { getTasksEmptyMessage, getTaskViewState, isNewTaskDraftDirty, updateTaskViewUrl } from "../features/render-os/utils/task-view-state.js";
import { getHoyLocalISO } from "../shared/date/date-utils.js";
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

function TaskDetail({ task, tasks, users, clients, sesion, onClose, onOpen, onLoadSubtasks, onUpdate, onArchive, onDelete, onCreateSubtask }) {
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
  const archivePendingRef = useRef(false);
  const isAdmin = sesion?.usuario?.rol === "admin";

  useEffect(() => {
    if (!task) return;
    setDraft(task);
    setEditing(false);
    setComment("");
    setCommentError("");
    setSubtaskTitle("");
    setConfirmDelete(false);
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

  const save = async () => {
    setSaving(true);
    const fields = ["titulo", "asignado_a", "cliente_id", "estado", "fecha_vencimiento", "prioridad", "tipo_tarea", "subtipo", "aclaraciones", "material_referencia"];
    const nullable = ["cliente_id", "fecha_vencimiento", "tipo_tarea", "subtipo", "aclaraciones", "material_referencia"];
    const changes = Object.fromEntries(fields
      .filter((field) => String(draft[field] ?? "") !== String(task[field] ?? ""))
      .map((field) => [field, draft[field] === "" && nullable.includes(field) ? null : draft[field]]));
    const nextMetadata = {
      resumen: String(draft.resumen || "").trim(),
      etiquetas: String(draft.etiquetas || "").split(",").map((item) => item.trim()).filter(Boolean),
      colaboradores: Array.isArray(draft.colaboradores) ? draft.colaboradores : [],
    };
    if (JSON.stringify(nextMetadata) !== JSON.stringify({ resumen: metadata.resumen || "", etiquetas: tags, colaboradores: collaborators })) {
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
    setDraft({ ...task, resumen: metadata.resumen || "", etiquetas: tags.join(", "), colaboradores: collaborators });
    setEditing(true);
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

  return <div className="ros-drawer-backdrop" onClick={closeDetail}>
    <aside className="ros-drawer" onClick={(event) => event.stopPropagation()}>
      <header><AreaBadge task={task}/><button onClick={closeDetail}>×</button></header>
      <div className="ros-drawer-body">
        <div className="ros-eyebrow">{task.cliente_nombre || "SIN CLIENTE"}</div>
        {editing ? <input className="ros-title-input" value={draft.titulo || ""} onChange={(event) => setDraft({ ...draft, titulo: event.target.value })}/> : <><h2>{task.titulo}</h2>{metadata.resumen && <p className="ros-task-summary">{metadata.resumen}</p>}{tags.length > 0 && <div className="ros-tags">{tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}</>}
        <div className="ros-operational-pill">● Operativa · cambios reales</div>
        {esperandoMaterial(task) && <div className="ros-warning-banner">Esperando material: la tarea de origen todavía no está terminada.</div>}
        <div className={`ros-properties ${editing ? "editing" : ""}`}>
          <label><span>Estado</span>{editing ? <select value={draft.estado || "pendiente"} onChange={(event) => setDraft({ ...draft, estado: event.target.value })}>{STATUSES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select> : <strong><i style={{ color: status.color }}>●</i>{status.label}</strong>}</label>
          <label><span>Responsable</span>{editing ? <select value={draft.asignado_a || ""} onChange={(event) => setDraft({ ...draft, asignado_a: event.target.value })}>{users.map((user) => <option key={user.id} value={user.nombre}>{user.nombre} · @{user.usuario}{user.email_notificaciones ? ` · ${user.email_notificaciones}` : ""}</option>)}</select> : <strong><Avatar person={person} name={task.asignado_a}/>{task.asignado_a || "Sin asignar"}</strong>}</label>
          <label><span>Cliente</span>{editing ? <select value={draft.cliente_id || ""} onChange={(event) => setDraft({ ...draft, cliente_id: event.target.value ? Number(event.target.value) : "" })}><option value="">Sin cliente</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.nombre}</option>)}</select> : <strong>{task.cliente_nombre || "Sin cliente"}</strong>}</label>
          <label><span>Vencimiento</span>{editing ? <input type="date" value={draft.fecha_vencimiento || ""} onChange={(event) => setDraft({ ...draft, fecha_vencimiento: event.target.value })}/> : <strong>{formatDate(task.fecha_vencimiento)}</strong>}</label>
          <label><span>Prioridad</span>{editing ? <select value={draft.prioridad || "media"} onChange={(event) => setDraft({ ...draft, prioridad: event.target.value })}><option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option></select> : <strong>{task.prioridad || "Media"}</strong>}</label>
          <label><span>Sector</span>{editing ? <select value={draft.tipo_tarea || ""} onChange={(event) => setDraft({ ...draft, tipo_tarea: event.target.value })}><option value="">Sin sector</option>{TASK_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select> : <strong>{task.tipo_tarea || "Sin definir"}</strong>}</label>
        </div>
        {person && <div className="ros-person-card"><Avatar person={person}/><div><strong>{person.nombre}</strong><span>@{person.usuario} · {ROL_LABELS[person.rol] || person.rol}</span><small>{person.email_notificaciones || "Sin correo de notificaciones"}</small></div></div>}
        {collaborators.length > 0 && !editing && <div className="ros-collaborators"><strong>Colaboran</strong><span>{collaborators.join(", ")}</span></div>}
        {editing && <div className="ros-edit-extras"><label><span>Subtipo</span><input value={draft.subtipo || ""} onChange={(event) => setDraft({ ...draft, subtipo: event.target.value })}/></label><label><span>Resumen corto</span><input value={draft.resumen || ""} onChange={(event) => setDraft({ ...draft, resumen: event.target.value })}/></label><label><span>Etiquetas</span><input value={draft.etiquetas || ""} onChange={(event) => setDraft({ ...draft, etiquetas: event.target.value })}/></label><fieldset><legend>Colaboradores</legend>{users.filter((user) => user.nombre !== draft.asignado_a).map((user) => <label key={user.id}><input type="checkbox" checked={(draft.colaboradores || []).includes(user.nombre)} onChange={(event) => setDraft({ ...draft, colaboradores: event.target.checked ? [...(draft.colaboradores || []), user.nombre] : (draft.colaboradores || []).filter((name) => name !== user.nombre) })}/><span>{user.nombre}</span></label>)}</fieldset></div>}
        <hr/>
        <h4>Guion e indicaciones</h4>
        {editing ? <textarea className="ros-detail-textarea" rows={7} value={draft.aclaraciones || ""} onChange={(event) => setDraft({ ...draft, aclaraciones: event.target.value })}/> : <p className="ros-description">{task.aclaraciones ? renderizarTextoTarea(task.aclaraciones) : "Esta tarea todavía no tiene indicaciones cargadas."}</p>}
        {links.length > 0 && <div className="ros-reference-list">{links.map((url) => { const info = obtenerInfoLinkTarea(url); return <a href={url} target="_blank" rel="noreferrer" key={url}><span>{info.etiqueta}</span><small>{info.dominio}</small><b>↗</b></a>; })}</div>}
        <h4>Material y enlaces</h4>
        {editing ? <input className="ros-detail-input" placeholder="https://…" value={draft.material_referencia || ""} onChange={(event) => setDraft({ ...draft, material_referencia: event.target.value })}/> : task.material_referencia ? <a className="ros-file" href={task.material_referencia} target="_blank" rel="noreferrer"><span>▣</span><div><strong>{materialInfo?.etiqueta || "Material de referencia"}</strong><small>{materialInfo?.dominio || task.material_referencia}</small></div><b>↗</b></a> : <p className="ros-empty-copy">No hay material vinculado.</p>}
        {(origin || task.tarea_padre_id) && <><h4>Origen y dependencia</h4><div className="ros-context-list">{origin && <a href={origin.href}><strong>{origin.label}</strong><span>{formatDate(origin.date)} · {origin.state || "Sin estado"}</span><b>↗</b></a>}{task.tarea_padre_id && <button type="button" onClick={() => onOpen(Number(task.tarea_padre_id))}><strong>Depende de la tarea #{task.tarea_padre_id}</strong><span>Estado: {task.tarea_padre_estado || "Sin datos"}</span></button>}</div></>}
        <h4>Subtareas</h4>
        <div className="ros-subtasks">{subtasks.map((subtask) => <button type="button" key={subtask.id} onClick={() => onOpen(subtask.id)}><span>{subtask.titulo}</span><b>{STATUSES.find((item) => item.id === subtask.estado)?.label || subtask.estado}</b></button>)}{subtasks.length === 0 && <p className="ros-empty-copy">No hay subtareas cargadas.</p>}</div>
        {isAdmin && <div className="ros-subtask-create"><input value={subtaskTitle} placeholder="Nombre de la subtarea" onChange={(event) => setSubtaskTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") createSubtask(); }}/><button type="button" disabled={!subtaskTitle.trim() || creatingSubtask} onClick={createSubtask}>{creatingSubtask ? "Creando…" : "+ Agregar"}</button></div>}
        {isAdmin && <div className="ros-detail-actions">{editing ? <><button type="button" onClick={() => { setDraft(task); setEditing(false); }}>Cancelar</button><button className="primary" type="button" disabled={saving || !draft.titulo?.trim() || !draft.asignado_a} onClick={save}>{saving ? "Guardando…" : "Guardar cambios"}</button></> : <button className="primary" type="button" onClick={startEditing}>Editar tarea</button>}</div>}
        <hr/>
        <h4>Comentarios y actividad</h4>
        {commentError && <div className="ros-inline-error">{commentError}</div>}
        <div className="ros-comments"><article className="activity"><div><strong>Sistema</strong><time>{formatDateTime(task.created_at)}</time></div><p>Creó la tarea.</p></article>{comments.map((item) => <article className={item.contenido.startsWith("[Actividad]") ? "activity" : ""} key={item.id}><div><strong>{item.autor}</strong><time>{formatDateTime(item.created_at)}</time></div><p>{item.contenido.replace(/^\[Actividad\]\s*/, "")}</p></article>)}</div>
        <div className="ros-comment-create"><textarea rows={3} value={comment} placeholder="Escribí una actualización, consulta o bloqueo…" onChange={(event) => setComment(event.target.value)}/><button type="button" disabled={!comment.trim() || commenting} onClick={addComment}>{commenting ? "Enviando…" : "Comentar"}</button></div>
        <h4>Datos de origen</h4>
        <div className="ros-origin"><span>ID #{task.id}</span><span>Creada: {formatDate(task.created_at)}</span><span>Actualizada: {formatDate(task.updated_at)}</span></div>
        {isAdmin && <div className="ros-danger-zone"><strong>Administrar tarea</strong><p>{isArchived ? "Podés restaurarla al tablero o eliminarla definitivamente." : "Archivala para sacarla del tablero sin perder su historial."}</p><div><button type="button" disabled={archiving} onClick={archiveTask}>{archiving ? (isArchived ? "Restaurando…" : "Archivando…") : (isArchived ? "Restaurar tarea" : "Archivar tarea")}</button>{confirmDelete ? <><button type="button" onClick={() => setConfirmDelete(false)}>Cancelar</button><button className="danger" type="button" disabled={deleting} onClick={deleteTask}>{deleting ? "Eliminando…" : "Eliminar definitivamente"}</button></> : <button className="danger" type="button" onClick={() => setConfirmDelete(true)}>Eliminar…</button>}</div></div>}
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
    {open && <div className="ros-people-options">{users.map((user) => { const active = selected.includes(user.nombre); return <button className={active ? "selected" : ""} type="button" key={user.id} onClick={() => toggle(user.nombre)}><Avatar person={user}/><span><strong>{user.nombre}</strong><small>{ROL_LABELS[user.rol] || user.rol || `@${user.usuario}`}</small></span><b>{active ? "✓" : "+"}</b></button>; })}</div>}
  </div>;
}

function NewTaskModal({ users, clients, initialStatus = "pendiente", onClose, onCreate }) {
  const [draft, setDraft] = useState({ titulo: "", asignado_a: "", cliente_id: "", estado: initialStatus, tipo_tarea: "", subtipo: "", prioridad: "media", fecha_vencimiento: "", aclaraciones: "", material_referencia: "", resumen: "", etiquetas: "", colaboradores: [] });
  const [saving, setSaving] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
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
  return <div className="ros-drawer-backdrop" onClick={closeModal}><section className="ros-modal ros-quick-task-modal" onClick={(event) => event.stopPropagation()}><header><div><div className="ros-eyebrow">NUEVA TAREA</div><h2>¿Qué hay que hacer?</h2><p>Cargá lo esencial ahora. Los detalles se pueden completar después.</p></div><button type="button" aria-label="Cerrar" onClick={closeModal}>×</button></header><form onSubmit={submit}>
    <label className="wide ros-quick-title"><span>Tarea *</span><input autoFocus required placeholder="Ej.: Editar reel de lanzamiento" value={draft.titulo} onChange={(event) => setDraft({ ...draft, titulo: event.target.value })}/></label>
    <TaskPeoplePicker users={users} primary={draft.asignado_a} collaborators={draft.colaboradores} onChange={({ primary, collaborators }) => setDraft({ ...draft, asignado_a: primary, colaboradores: collaborators })}/>
    <div className="wide ros-quick-grid"><label><span>Cliente</span><select value={draft.cliente_id} onChange={(event) => setDraft({ ...draft, cliente_id: event.target.value })}><option value="">Sin cliente</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.nombre}</option>)}</select></label><label><span>Fecha</span><input type="date" value={draft.fecha_vencimiento} onChange={(event) => setDraft({ ...draft, fecha_vencimiento: event.target.value })}/></label><label><span>Prioridad</span><select value={draft.prioridad} onChange={(event) => setDraft({ ...draft, prioridad: event.target.value })}><option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option></select></label></div>
    <button className="wide ros-more-details" type="button" aria-expanded={showDetails} onClick={() => setShowDetails((current) => !current)}><span>{showDetails ? "−" : "+"}</span>{showDetails ? "Ocultar detalles" : "Agregar indicaciones, material o colaboradores"}</button>
    {showDetails && <div className="wide ros-optional-fields"><label><span>Sector</span><select value={draft.tipo_tarea} onChange={(event) => setDraft({ ...draft, tipo_tarea: event.target.value })}><option value="">Sin sector</option>{TASK_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label><span>Tipo de pieza</span><input placeholder="Reel, carrusel, visita…" value={draft.subtipo} onChange={(event) => setDraft({ ...draft, subtipo: event.target.value })}/></label><label className="wide"><span>Resumen corto</span><input value={draft.resumen} placeholder="Resultado esperado" onChange={(event) => setDraft({ ...draft, resumen: event.target.value })}/></label><label className="wide"><span>Indicaciones</span><textarea rows={3} placeholder="Datos necesarios para poder resolverla" value={draft.aclaraciones} onChange={(event) => setDraft({ ...draft, aclaraciones: event.target.value })}/></label><label className="wide"><span>Material o enlace</span><input placeholder="https://…" value={draft.material_referencia} onChange={(event) => setDraft({ ...draft, material_referencia: event.target.value })}/></label><label className="wide"><span>Etiquetas</span><input placeholder="Urgente, web, corrección" value={draft.etiquetas} onChange={(event) => setDraft({ ...draft, etiquetas: event.target.value })}/></label></div>}
    <footer><button type="button" onClick={closeModal}>Cancelar</button><button className="primary" type="submit" disabled={saving || !draft.titulo.trim() || !draft.asignado_a}>{saving ? "Creando…" : "Crear tarea"}</button></footer>
  </form></section></div>;
}

function TaskCard({ task, users, today, onOpen, onMove }) {
  const person = personForTask(task, users);
  const tags = Array.isArray(task.propiedades_extra?.etiquetas) ? task.propiedades_extra.etiquetas : [];
  const collaborators = Array.isArray(task.propiedades_extra?.colaboradores) ? task.propiedades_extra.colaboradores : [];
  return <article role="button" tabIndex={0} draggable className="ros-task-card" onDragStart={(event) => { event.dataTransfer.setData("text/task-id", String(task.id)); event.dataTransfer.effectAllowed = "move"; }} onClick={() => onOpen(task.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onOpen(task.id); }}>
    <AreaBadge task={task}/><h3>{task.titulo}</h3><p>{task.cliente_nombre || "Sin cliente"}</p>
    {task.propiedades_extra?.resumen && <div className="ros-card-summary">{task.propiedades_extra.resumen}</div>}
    {tags.length > 0 && <div className="ros-card-tags">{tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div>}
    {esperandoMaterial(task) && <div className="ros-card-warning">Esperando material</div>}
    <footer><Avatar person={person} name={task.asignado_a}/><span title={collaborators.length ? `Colaboran: ${collaborators.join(", ")}` : ""}>{task.asignado_a || "Sin asignar"}{collaborators.length ? ` +${collaborators.length}` : ""}</span><b className={task.fecha_vencimiento && task.fecha_vencimiento < today && task.estado !== ESTADO_FINAL_TAREA ? "urgent" : ""}>□ {formatDate(task.fecha_vencimiento)}</b></footer>
    <select className="ros-mobile-state" aria-label={`Cambiar estado de ${task.titulo}`} value={task.estado} onClick={(event) => event.stopPropagation()} onChange={(event) => { event.stopPropagation(); onMove(task, event.target.value); }}>{STATUSES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
  </article>;
}

function TaskCalendar({ tasks, onOpen, monthValue, onMonthChange }) {
  const [cursor, setCursor] = useState(() => {
    if (monthValue) { const [year, month] = monthValue.split("-").map(Number); return new Date(year, month - 1, 1); }
    const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1);
  });
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
  const label = cursor.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  const moveMonth = (delta) => { const next = new Date(year, month + delta, 1); setCursor(next); onMonthChange(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`); };
  return <section className="ros-calendar"><header><button type="button" aria-label="Mes anterior" onClick={() => moveMonth(-1)}>‹</button><strong>{label}</strong><button type="button" aria-label="Mes siguiente" onClick={() => moveMonth(1)}>›</button></header><div className="ros-calendar-week"><span>Lun</span><span>Mar</span><span>Mié</span><span>Jue</span><span>Vie</span><span>Sáb</span><span>Dom</span></div><div className="ros-calendar-grid">{cells.map((day, index) => { if (!day) return <div className="ros-calendar-day muted" key={`empty-${index}`}/>; const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`; const items = byDate.get(key) || []; return <div className="ros-calendar-day" key={key}><b>{day}</b>{items.slice(0, 3).map((task) => <button className="ros-calendar-task" type="button" key={task.id} onClick={() => onOpen(task.id)}>{task.titulo}</button>)}{items.length > 3 && <small>+{items.length - 3} más</small>}</div>; })}</div>{tasks.some((task) => !task.fecha_vencimiento) && <p className="ros-calendar-note">{tasks.filter((task) => !task.fecha_vencimiento).length} tareas sin fecha no aparecen en el calendario.</p>}</section>;
}

function TasksByClient({ tasks, onOpen }) {
  const groups = [...new Set(tasks.map((task) => task.cliente_nombre || "Sin cliente"))].sort().map((name) => ({ name, tasks: tasks.filter((task) => (task.cliente_nombre || "Sin cliente") === name) }));
  return <div className="ros-project-grid">{groups.map((group) => <section className="ros-project-card" key={group.name}><header><div><span>{initials(group.name)}</span><strong>{group.name}</strong></div><small>{group.tasks.length} tareas</small></header><div>{group.tasks.map((task) => <button type="button" key={task.id} onClick={() => onOpen(task.id)}><span>{task.titulo}</span><b>{STATUSES.find((item) => item.id === task.estado)?.label || task.estado}</b><small>{task.asignado_a} · {formatDate(task.fecha_vencimiento)}</small></button>)}</div></section>)}</div>;
}

function TasksView({ tasks, totalTasks, loadingMore, onLoadMore, users, clients, query, setQuery, area, setArea, responsible, setResponsible, client, setClient, sector, setSector, priority, setPriority, archiveMode, setArchiveMode, sesion, onCreate, onUpdate, onDelete, onError }) {
  const initialViewState = useMemo(() => getTaskViewState(window.location.search), []);
  const initialTask = Number(new URLSearchParams(window.location.search).get("task")) || null;
  const [view, setView] = useState(initialViewState.view);
  const [calendarMonth, setCalendarMonth] = useState(initialViewState.calendarMonth);
  const [selectedId, setSelectedId] = useState(initialTask);
  const [creatingStatus, setCreatingStatus] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dragOver, setDragOver] = useState("");
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
    return (archiveMode === "archived" ? isArchived : !isArchived)
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
  const clearFilters = () => { setResponsible("all"); setClient("all"); setSector("all"); setPriority("all"); setArea("all"); };

  const archiveTask = async (task, archived) => {
    await onUpdate(task.id, { propiedades_extra: { archivada_render_os: archived } }, archived ? "archivó la tarea" : "restauró la tarea");
    closeTask();
  };

  return <><section className="ros-page">
    <div className="ros-title-row"><div><div className="ros-page-icon" aria-hidden="true">✓</div><div className="ros-eyebrow">ESPACIO DE TRABAJO</div><h1>Tareas</h1><p>Organizá, asigná y revisá el trabajo del equipo en un solo lugar.</p></div><div className="ros-title-actions"><input className="ros-top-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar tarea, cliente o responsable…"/>{isAdmin && <button className="ros-primary-button" type="button" onClick={() => setCreatingStatus("pendiente")}>+ Nueva tarea</button>}</div></div>
    <div className="ros-controls"><div><button aria-pressed={view === "board"} className={view === "board" ? "active" : ""} onClick={() => setView("board")}>▦ Tablero</button><button aria-pressed={view === "list"} className={view === "list" ? "active" : ""} onClick={() => setView("list")}>☷ Lista</button><button aria-pressed={view === "calendar"} className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")}>□ Calendario</button><button aria-pressed={view === "clients"} className={view === "clients" ? "active" : ""} onClick={() => setView("clients")}>◌ Por cliente</button></div><div className="ros-controls-meta"><span>Mostrando {visible.length} de {totalTasks}</span><button className="ros-archive-link" type="button" onClick={() => setArchiveMode(archiveMode === "archived" ? "active" : "archived")}>{archiveMode === "archived" ? "← Volver a tareas activas" : "▣ Ver archivadas"}</button></div></div>
    <button className="ros-filter-toggle" type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((current) => !current)}>Filtros{activeFilterCount ? <b>{activeFilterCount}</b> : null}<span>{filtersOpen ? "Ocultar" : "Mostrar"}</span></button>
    <div className={`ros-filter-bar ${filtersOpen ? "open" : ""}`}><label><span>Área</span><select aria-label="Área" value={area} onChange={(event) => setArea(event.target.value)}><option value="all">Todas</option>{AREAS.slice(1).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label><span>Responsable</span><select aria-label="Responsable" value={responsible} onChange={(event) => setResponsible(event.target.value)}><option value="all">Todos</option>{responsibleOptions.map((name) => <option key={name} value={name}>{name}</option>)}</select></label><label><span>Cliente</span><select aria-label="Cliente" value={client} onChange={(event) => setClient(event.target.value)}><option value="all">Todos</option><option value="none">Sin cliente</option>{clients.map((item) => <option key={item.id} value={String(item.id)}>{item.nombre}</option>)}</select></label><label><span>Sector</span><select aria-label="Sector" value={sector} onChange={(event) => setSector(event.target.value)}><option value="all">Todos</option><option value="none">Sin sector</option>{TASK_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label><span>Prioridad</span><select aria-label="Prioridad" value={priority} onChange={(event) => setPriority(event.target.value)}><option value="all">Todas</option><option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option></select></label>{hasFilters && <button type="button" onClick={clearFilters}>Limpiar filtros</button>}</div>
    {view === "board" && <div className="ros-board">{STATUSES.map((status) => { const items = visible.filter((task) => task.estado === status.id); return <section className={`ros-column ${dragOver === status.id ? "drag-over" : ""}`} key={status.id} onDragOver={(event) => { event.preventDefault(); setDragOver(status.id); }} onDragLeave={() => setDragOver("")} onDrop={(event) => { event.preventDefault(); setDragOver(""); const task = tasks.find((item) => String(item.id) === event.dataTransfer.getData("text/task-id")); if (task) move(task, status.id); }}><header><span style={{ color: status.color }}>●</span><strong>{status.label}</strong><small>{items.length}</small></header><div>{items.slice(0, 250).map((task) => <TaskCard key={task.id} task={task} users={users} today={today} onOpen={openTask} onMove={move}/>)}{items.length > 250 && <div className="ros-column-limit">Mostrando 250 de {items.length}. Usá los filtros para acotar.</div>}{items.length === 0 && (isAdmin ? <button className="ros-empty-column" type="button" onClick={() => setCreatingStatus(status.id)}><span>+</span>Nueva tarea</button> : <div className="ros-empty-column">Sin tareas</div>)}</div></section>; })}</div>}
    {view === "list" && <div className="ros-task-list"><div className="ros-task-list-head"><span>TAREA</span><span>ÁREA</span><span>CLIENTE</span><span>RESPONSABLE</span><span>ESTADO</span><span>FECHA</span></div>{visible.slice(0, 500).map((task) => <button key={task.id} onClick={() => openTask(task.id)}><strong>{task.titulo}</strong><AreaBadge task={task}/><span>{task.cliente_nombre || "Sin cliente"}</span><span>{task.asignado_a || "Sin asignar"}</span><span>{STATUSES.find((item) => item.id === task.estado)?.label || task.estado}</span><span>{formatDate(task.fecha_vencimiento)}</span></button>)}{visible.length > 500 && <div className="ros-list-limit">Mostrando 500 de {visible.length}. Usá los filtros para acotar.</div>}</div>}
    {view === "calendar" && <TaskCalendar tasks={visible} onOpen={openTask} monthValue={calendarMonth} onMonthChange={setCalendarMonth}/>} {view === "clients" && <TasksByClient tasks={visible} onOpen={openTask}/>} {view !== "board" && visible.length === 0 && <div className="ros-no-results">{emptyMessage}</div>}
    {paginatedTaskCount < totalTasks && <div className="ros-load-more"><button type="button" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? "Cargando…" : `Cargar más tareas (${paginatedTaskCount} de ${totalTasks})`}</button></div>}
  </section>
  <TaskDetail task={selected} tasks={tasks} users={users} clients={clients} sesion={sesion} onClose={closeTask} onOpen={openTask} onLoadSubtasks={loadSubtasks} onUpdate={onUpdate} onArchive={archiveTask} onDelete={async (id) => { await onDelete(id); closeTask(); }} onCreateSubtask={createSubtask}/>
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
  const isAdmin = sesion?.usuario?.rol === "admin";

  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  useEffect(() => {
    let active = true;
    Promise.all([apiJson("/api/clientes"), isAdmin ? apiJson("/api/usuarios") : Promise.resolve([])])
      .then(([clientData, userData]) => {
        if (!active) return;
        setClients(clientData);
        setUsers(userData);
      })
      .catch((reason) => { if (active) setError(reason.message || "No se pudieron cargar los datos reales."); })
    return () => { active = false; };
  }, [isAdmin, reloadKey]);

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
          try {
            const currentTask = await apiTaskById(id);
            tasksRef.current = tasksRef.current.map((task) => task.id === id ? currentTask : task);
            setTasks((current) => current.map((task) => task.id === id ? currentTask : task));
          } catch {
            setTasks((current) => current.filter((task) => task.id !== id));
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

  const retry = () => { setError(""); setLoading(true); setReloadKey((current) => current + 1); };
  return <div className="render-workspace"><Toast toast={toast} onClose={() => setToast(null)}/><main className="ros-main">{loading || error ? <LoadingState error={error} onRetry={retry}/> : <TasksView tasks={tasks} totalTasks={totalTasks} loadingMore={loadingMore} onLoadMore={loadMoreTasks} users={users} clients={clients} query={query} setQuery={setQuery} area={area} setArea={setArea} responsible={responsible} setResponsible={setResponsible} client={client} setClient={setClient} sector={sector} setSector={setSector} priority={priority} setPriority={setPriority} archiveMode={archiveMode} setArchiveMode={setArchiveMode} sesion={sesion} onCreate={createTask} onUpdate={updateTask} onDelete={deleteTask} onError={(message) => notify(message, "error")}/>}</main></div>;
}
