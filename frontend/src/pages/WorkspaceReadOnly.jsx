import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ESTADO_FINAL_TAREA, ROL_LABELS } from "../constants.js";
import "./WorkspaceReadOnly.css";
import "./WorkspaceStagingLogin.css";

const SECTIONS = {
  "/workspace/tareas": "tasks",
  "/workspace/clientes": "clients",
  "/workspace/equipo": "team",
};

const STATUSES = [
  { id: "pendiente", label: "Por hacer", color: "#8d9095" },
  { id: "en_progreso", label: "En progreso", color: "#3378d4" },
  { id: "en_revision", label: "En revisión", color: "#df9830" },
  { id: "publicada", label: "Terminado", color: "#34a16f" },
];

const AREAS = [
  { id: "all", label: "Todo", icon: "⌘", color: "#242529" },
  { id: "carruseles", label: "Carruseles", icon: "▦", color: "#7459e8" },
  { id: "produccion", label: "Visitas / producción", icon: "◉", color: "#e26d45" },
  { id: "edicion", label: "Edición", icon: "▶", color: "#2d8f75" },
  { id: "historias", label: "Flyers / historias", icon: "◇", color: "#d34f75" },
  { id: "web", label: "Páginas web", icon: "◫", color: "#3278cc" },
  { id: "chatbots", label: "Chatbots", icon: "✦", color: "#9a6a24" },
  { id: "carteleria", label: "Cartelería", icon: "▱", color: "#68717f" },
];

const TASK_TYPES = [
  { id: "diseno", label: "Diseño" },
  { id: "edicion", label: "Edición" },
  { id: "produccion", label: "Producción" },
  { id: "community", label: "Community" },
  { id: "administracion", label: "Administración" },
];

const GOOGLE_CLIENT_ID = "468370687841-do43hb7rje2t6agcliof3asq5gmbqssv.apps.googleusercontent.com";

async function apiRequest(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "No se pudo completar la operación.");
  return body;
}

function apiJson(url) {
  return apiRequest(url).then((body) => Array.isArray(body) ? body : []);
}

function areaForTask(task) {
  const text = `${task.tipo_tarea || ""} ${task.subtipo || ""} ${task.titulo || ""}`.toLowerCase();
  if (text.includes("chatbot") || text.includes("bot ")) return "chatbots";
  if (text.includes("web") || text.includes("landing") || text.includes("página")) return "web";
  if (text.includes("cartel")) return "carteleria";
  if (text.includes("carrusel")) return "carruseles";
  if (text.includes("historia") || text.includes("flyer") || text.includes("community")) return "historias";
  if (text.includes("produccion") || text.includes("producción") || text.includes("visita") || text.includes("filmar")) return "produccion";
  if (text.includes("edicion") || text.includes("edición") || text.includes("editar") || text.includes("reel")) return "edicion";
  return task.tipo_tarea === "diseno" ? "carruseles" : "edicion";
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  return day && month ? `${day}/${month}/${year}` : value;
}

function formatDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function initials(value = "") {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}

function personForTask(task, users) {
  const assigned = String(task?.asignado_a || "").toLowerCase();
  return users.find((user) => user.nombre?.toLowerCase() === assigned || user.usuario?.toLowerCase() === assigned);
}

function Avatar({ person, name }) {
  const label = person?.nombre || name || "Sin asignar";
  return <span className="ros-avatar" title={person ? `${person.nombre} · @${person.usuario}` : label}>{initials(label)}</span>;
}

function AreaBadge({ task }) {
  const area = AREAS.find((item) => item.id === areaForTask(task)) || AREAS[0];
  return <span className="ros-area-badge" style={{ "--area": area.color }}>{area.icon} {area.label}</span>;
}

function LoadingState({ error }) {
  return <div className={`ros-state ${error ? "error" : ""}`}><span>{error ? "!" : "◌"}</span><strong>{error || "Conectando con los datos reales…"}</strong><small>{error ? "La interfaz anterior sigue disponible." : "Cargando tareas, clientes y responsables."}</small></div>;
}

function Toast({ toast, onClose }) {
  if (!toast) return null;
  return <button type="button" className={`ros-toast ${toast.type || "success"}`} onClick={onClose}><span>{toast.type === "error" ? "!" : "✓"}</span>{toast.message}</button>;
}

function TaskDetail({ task, users, clients, sesion, onClose, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task || {});
  const [comments, setComments] = useState([]);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const isAdmin = sesion?.usuario?.rol === "admin";

  useEffect(() => {
    if (!task) return;
    setDraft(task);
    setEditing(false);
    setComment("");
    apiJson(`/api/tareas/${task.id}/comentarios`).then(setComments).catch(() => setComments([]));
  }, [task?.id]);

  useEffect(() => {
    if (!task) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [task]);

  if (!task) return null;
  const person = personForTask(task, users);
  const status = STATUSES.find((item) => item.id === task.estado) || STATUSES[0];

  const save = async () => {
    setSaving(true);
    const fields = ["titulo", "asignado_a", "cliente_id", "estado", "fecha_vencimiento", "prioridad", "tipo_tarea", "subtipo", "aclaraciones", "material_referencia"];
    const changes = Object.fromEntries(fields.filter((field) => String(draft[field] ?? "") !== String(task[field] ?? "")).map((field) => [field, draft[field] === "" && ["cliente_id", "fecha_vencimiento", "tipo_tarea", "subtipo", "aclaraciones", "material_referencia"].includes(field) ? null : draft[field]]));
    try {
      if (Object.keys(changes).length) await onUpdate(task.id, changes, "editó los datos de la tarea");
      setEditing(false);
    } catch {
      // El contenedor ya restaura los datos y muestra el error.
    } finally {
      setSaving(false);
    }
  };

  const addComment = async () => {
    const content = comment.trim();
    if (!content || commenting) return;
    setCommenting(true);
    try {
      const created = await apiRequest(`/api/tareas/${task.id}/comentarios`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autor: sesion?.usuario?.nombre || sesion?.usuario?.usuario || "Equipo RENDER", contenido: content }) });
      setComments((current) => [...current, created]);
      setComment("");
    } catch {
      // La conversación queda intacta si la API rechaza el comentario.
    } finally {
      setCommenting(false);
    }
  };

  return <div className="ros-drawer-backdrop" onClick={onClose}><aside className="ros-drawer" onClick={(event) => event.stopPropagation()}><header><AreaBadge task={task}/><button onClick={onClose}>×</button></header><div className="ros-drawer-body"><div className="ros-eyebrow">{task.cliente_nombre || "SIN CLIENTE"}</div>{editing ? <input className="ros-title-input" value={draft.titulo || ""} onChange={(event) => setDraft({ ...draft, titulo: event.target.value })}/> : <h2>{task.titulo}</h2>}<div className="ros-operational-pill">● Operativa · cambios reales</div><div className={`ros-properties ${editing ? "editing" : ""}`}><label><span>Estado</span>{editing ? <select value={draft.estado || "pendiente"} onChange={(event) => setDraft({ ...draft, estado: event.target.value })}>{STATUSES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select> : <strong><i style={{ color: status.color }}>●</i>{status.label}</strong>}</label><label><span>Responsable</span>{editing ? <select value={draft.asignado_a || ""} onChange={(event) => setDraft({ ...draft, asignado_a: event.target.value })}>{users.map((user) => <option key={user.id} value={user.nombre}>{user.nombre} · @{user.usuario}{user.email_notificaciones ? ` · ${user.email_notificaciones}` : ""}</option>)}</select> : <strong><Avatar person={person} name={task.asignado_a}/>{task.asignado_a || "Sin asignar"}</strong>}</label><label><span>Cliente</span>{editing ? <select value={draft.cliente_id || ""} onChange={(event) => setDraft({ ...draft, cliente_id: event.target.value ? Number(event.target.value) : "" })}><option value="">Sin cliente</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.nombre}</option>)}</select> : <strong>{task.cliente_nombre || "Sin cliente"}</strong>}</label><label><span>Vencimiento</span>{editing ? <input type="date" value={draft.fecha_vencimiento || ""} onChange={(event) => setDraft({ ...draft, fecha_vencimiento: event.target.value })}/> : <strong>{formatDate(task.fecha_vencimiento)}</strong>}</label><label><span>Prioridad</span>{editing ? <select value={draft.prioridad || "media"} onChange={(event) => setDraft({ ...draft, prioridad: event.target.value })}><option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option></select> : <strong>{task.prioridad || "Media"}</strong>}</label><label><span>Sector</span>{editing ? <select value={draft.tipo_tarea || ""} onChange={(event) => setDraft({ ...draft, tipo_tarea: event.target.value })}><option value="">Sin sector</option>{TASK_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select> : <strong>{task.tipo_tarea || "Sin definir"}</strong>}</label></div>{person && <div className="ros-person-card"><Avatar person={person}/><div><strong>{person.nombre}</strong><span>@{person.usuario} · {ROL_LABELS[person.rol] || person.rol}</span><small>{person.email_notificaciones || "Sin correo de notificaciones"}</small></div></div>}{editing && <label className="ros-wide-field"><span>Subtipo</span><input value={draft.subtipo || ""} onChange={(event) => setDraft({ ...draft, subtipo: event.target.value })}/></label>}<hr/><h4>Indicaciones</h4>{editing ? <textarea className="ros-detail-textarea" rows={5} value={draft.aclaraciones || ""} onChange={(event) => setDraft({ ...draft, aclaraciones: event.target.value })}/> : <p className="ros-description">{task.aclaraciones || "Esta tarea todavía no tiene indicaciones cargadas."}</p>}<h4>Material y enlaces</h4>{editing ? <input className="ros-detail-input" placeholder="https://…" value={draft.material_referencia || ""} onChange={(event) => setDraft({ ...draft, material_referencia: event.target.value })}/> : task.material_referencia ? <a className="ros-file" href={task.material_referencia} target="_blank" rel="noreferrer"><span>▣</span><div><strong>Material de referencia</strong><small>{task.material_referencia}</small></div><b>↗</b></a> : <p className="ros-empty-copy">No hay material vinculado.</p>}{isAdmin && <div className="ros-detail-actions">{editing ? <><button type="button" onClick={() => { setDraft(task); setEditing(false); }}>Cancelar</button><button className="primary" type="button" disabled={saving || !draft.titulo?.trim() || !draft.asignado_a} onClick={save}>{saving ? "Guardando…" : "Guardar cambios"}</button></> : <button className="primary" type="button" onClick={() => setEditing(true)}>Editar tarea</button>}</div>}<hr/><h4>Comentarios y actividad</h4><div className="ros-comments"><article className="activity"><div><strong>Sistema</strong><time>{formatDateTime(task.created_at)}</time></div><p>Creó la tarea.</p></article>{comments.map((item) => <article className={item.contenido.startsWith("[Actividad]") ? "activity" : ""} key={item.id}><div><strong>{item.autor}</strong><time>{formatDateTime(item.created_at)}</time></div><p>{item.contenido.replace(/^\[Actividad\]\s*/, "")}</p></article>)}{comments.length === 0 && <p className="ros-empty-copy">Todavía no hay comentarios.</p>}</div><div className="ros-comment-create"><textarea rows={3} value={comment} placeholder="Escribí una actualización, consulta o bloqueo…" onChange={(event) => setComment(event.target.value)}/><button type="button" disabled={!comment.trim() || commenting} onClick={addComment}>{commenting ? "Enviando…" : "Comentar"}</button></div><h4>Datos de origen</h4><div className="ros-origin"><span>ID #{task.id}</span><span>Creada: {formatDate(task.created_at)}</span><span>Actualizada: {formatDate(task.updated_at)}</span></div></div></aside></div>;
}

function NewTaskModal({ users, clients, onClose, onCreate }) {
  const [draft, setDraft] = useState({ titulo: "", asignado_a: users[0]?.nombre || "", cliente_id: "", estado: "pendiente", tipo_tarea: "", subtipo: "", prioridad: "media", fecha_vencimiento: "", aclaraciones: "", material_referencia: "" });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await onCreate({ ...draft, cliente_id: draft.cliente_id ? Number(draft.cliente_id) : null, fecha_vencimiento: draft.fecha_vencimiento || null, tipo_tarea: draft.tipo_tarea || null, subtipo: draft.subtipo || null, aclaraciones: draft.aclaraciones || null, material_referencia: draft.material_referencia || null });
    } catch {
      // El modal permanece abierto y el contenedor muestra el error.
    } finally {
      setSaving(false);
    }
  };
  return <div className="ros-drawer-backdrop" onClick={onClose}><section className="ros-modal" onClick={(event) => event.stopPropagation()}><header><div><div className="ros-eyebrow">NUEVA TAREA</div><h2>Crear y asignar</h2></div><button type="button" onClick={onClose}>×</button></header><form onSubmit={submit}><label className="wide"><span>Título *</span><input autoFocus required value={draft.titulo} onChange={(event) => setDraft({ ...draft, titulo: event.target.value })}/></label><label><span>Responsable *</span><select required value={draft.asignado_a} onChange={(event) => setDraft({ ...draft, asignado_a: event.target.value })}><option value="">Seleccionar…</option>{users.map((user) => <option key={user.id} value={user.nombre}>{user.nombre} · @{user.usuario}{user.email_notificaciones ? ` · ${user.email_notificaciones}` : ""}</option>)}</select></label><label><span>Cliente</span><select value={draft.cliente_id} onChange={(event) => setDraft({ ...draft, cliente_id: event.target.value })}><option value="">Sin cliente</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.nombre}</option>)}</select></label><label><span>Sector</span><select value={draft.tipo_tarea} onChange={(event) => setDraft({ ...draft, tipo_tarea: event.target.value })}><option value="">Sin sector</option>{TASK_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label><span>Subtipo</span><input placeholder="Reel, carrusel, visita…" value={draft.subtipo} onChange={(event) => setDraft({ ...draft, subtipo: event.target.value })}/></label><label><span>Vencimiento</span><input type="date" value={draft.fecha_vencimiento} onChange={(event) => setDraft({ ...draft, fecha_vencimiento: event.target.value })}/></label><label><span>Prioridad</span><select value={draft.prioridad} onChange={(event) => setDraft({ ...draft, prioridad: event.target.value })}><option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option></select></label><label className="wide"><span>Indicaciones</span><textarea rows={4} value={draft.aclaraciones} onChange={(event) => setDraft({ ...draft, aclaraciones: event.target.value })}/></label><label className="wide"><span>Material o enlace</span><input placeholder="https://…" value={draft.material_referencia} onChange={(event) => setDraft({ ...draft, material_referencia: event.target.value })}/></label><footer><button type="button" onClick={onClose}>Cancelar</button><button className="primary" type="submit" disabled={saving || !draft.asignado_a}>{saving ? "Creando…" : "Crear tarea"}</button></footer></form></section></div>;
}

function TasksView({ tasks, users, clients, query, area, setArea, sesion, onCreate, onUpdate }) {
  const [view, setView] = useState("board");
  const [selectedId, setSelectedId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [dragOver, setDragOver] = useState("");
  const isAdmin = sesion?.usuario?.rol === "admin";
  const today = new Date().toISOString().slice(0, 10);
  const selected = tasks.find((task) => task.id === selectedId) || null;
  const visible = useMemo(() => tasks.filter((task) => {
    const matchesArea = area === "all" || areaForTask(task) === area;
    const text = `${task.titulo} ${task.cliente_nombre || ""} ${task.asignado_a || ""}`.toLowerCase();
    return matchesArea && text.includes(query.toLowerCase());
  }), [tasks, query, area]);
  const overdue = tasks.filter((task) => task.estado !== ESTADO_FINAL_TAREA && task.fecha_vencimiento && task.fecha_vencimiento < today).length;
  const review = tasks.filter((task) => task.estado === "en_revision").length;
  const active = tasks.filter((task) => task.estado !== ESTADO_FINAL_TAREA).length;
  const move = (task, status) => {
    if (status === task.estado) return;
    void onUpdate(task.id, { estado: status }, `movió la tarea de ${STATUSES.find((item) => item.id === task.estado)?.label || task.estado} a ${STATUSES.find((item) => item.id === status)?.label || status}`).catch(() => {});
  };

  return <><section className="ros-page"><div className="ros-title-row"><div><div className="ros-eyebrow">CENTRO OPERATIVO</div><h1>Tareas</h1><p>Creación, responsables, estados, comentarios y actividad sobre la base real.</p></div>{isAdmin ? <button className="ros-primary-button" type="button" onClick={() => setCreating(true)}>+ Nueva tarea</button> : <a className="ros-primary-button" href="/piezas">Interfaz actual ↗</a>}</div><div className="ros-summary"><article><span className="red">●</span><div><strong>{overdue}</strong><small>Vencidas</small></div></article><article><span className="amber">●</span><div><strong>{review}</strong><small>Esperando revisión</small></div></article><article><span className="green">●</span><div><strong>{tasks.length - active}</strong><small>Terminadas</small></div></article><article><span className="blue">●</span><div><strong>{active}</strong><small>Carga activa</small></div></article></div><div className="ros-controls"><div><button className={view === "board" ? "active" : ""} onClick={() => setView("board")}>▦ Tablero</button><button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>☷ Lista</button></div><span>● OPERATIVO</span></div>{area !== "all" && <div className="ros-active-filter">Área: <strong>{AREAS.find((item) => item.id === area)?.label}</strong><button onClick={() => setArea("all")}>×</button></div>}{view === "board" && <div className="ros-board">{STATUSES.map((status) => { const items = visible.filter((task) => task.estado === status.id); return <section className={`ros-column ${dragOver === status.id ? "drag-over" : ""}`} key={status.id} onDragOver={(event) => { event.preventDefault(); setDragOver(status.id); }} onDragLeave={() => setDragOver("")} onDrop={(event) => { event.preventDefault(); setDragOver(""); const task = tasks.find((item) => String(item.id) === event.dataTransfer.getData("text/task-id")); if (task) move(task, status.id); }}><header><span style={{ color: status.color }}>●</span><strong>{status.label}</strong><small>{items.length}</small></header><div>{items.map((task) => { const person = personForTask(task, users); return <article role="button" tabIndex={0} draggable className="ros-task-card" key={task.id} onDragStart={(event) => { event.dataTransfer.setData("text/task-id", String(task.id)); event.dataTransfer.effectAllowed = "move"; }} onClick={() => setSelectedId(task.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedId(task.id); }}><AreaBadge task={task}/><h3>{task.titulo}</h3><p>{task.cliente_nombre || "Sin cliente"}</p><footer><Avatar person={person} name={task.asignado_a}/><span>{task.asignado_a || "Sin asignar"}</span><b className={task.fecha_vencimiento && task.fecha_vencimiento < today && task.estado !== ESTADO_FINAL_TAREA ? "urgent" : ""}>□ {formatDate(task.fecha_vencimiento)}</b></footer><select className="ros-mobile-state" aria-label={`Cambiar estado de ${task.titulo}`} value={task.estado} onClick={(event) => event.stopPropagation()} onChange={(event) => { event.stopPropagation(); move(task, event.target.value); }}>{STATUSES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></article>; })}{items.length === 0 && <div className="ros-empty-column">Soltá una tarea acá</div>}</div></section>; })}</div>}{view === "list" && <div className="ros-task-list"><div className="ros-task-list-head"><span>TAREA</span><span>ÁREA</span><span>CLIENTE</span><span>RESPONSABLE</span><span>ESTADO</span><span>FECHA</span></div>{visible.map((task) => <button key={task.id} onClick={() => setSelectedId(task.id)}><strong>{task.titulo}</strong><AreaBadge task={task}/><span>{task.cliente_nombre || "Sin cliente"}</span><span>{task.asignado_a || "Sin asignar"}</span><span>{STATUSES.find((item) => item.id === task.estado)?.label || task.estado}</span><span>{formatDate(task.fecha_vencimiento)}</span></button>)}</div>}</section><TaskDetail task={selected} users={users} clients={clients} sesion={sesion} onClose={() => setSelectedId(null)} onUpdate={onUpdate}/>{creating && <NewTaskModal users={users} clients={clients} onClose={() => setCreating(false)} onCreate={async (draft) => { const created = await onCreate(draft); setCreating(false); setSelectedId(created.id); }}/>}</>;
}

function ClientsView({ clients, tasks, query }) {
  const visible = clients.filter((client) => client.nombre.toLowerCase().includes(query.toLowerCase()));
  const activeTasks = tasks.filter((task) => task.estado !== ESTADO_FINAL_TAREA).length;
  const review = tasks.filter((task) => task.estado === "en_revision").length;
  return <section className="ros-page"><div className="ros-title-row"><div><div className="ros-eyebrow">RELACIONES Y CUENTAS</div><h1>Clientes</h1><p>Conteos operativos calculados desde las tareas actuales.</p></div><a className="ros-primary-button" href="/clientes">Administrar clientes ↗</a></div><div className="ros-summary"><article><span className="blue">●</span><div><strong>{clients.length}</strong><small>Clientes registrados</small></div></article><article><span className="green">●</span><div><strong>{activeTasks}</strong><small>Tareas activas</small></div></article><article><span className="amber">●</span><div><strong>{review}</strong><small>Para revisar</small></div></article><article><span className="gray">●</span><div><strong>{tasks.length}</strong><small>Tareas históricas</small></div></article></div><div className="ros-section-bar"><strong>Todos los clientes</strong><span>● DATOS REALES</span></div><div className="ros-client-grid">{visible.map((client) => { const clientTasks = tasks.filter((task) => String(task.cliente_id) === String(client.id)); const active = clientTasks.filter((task) => task.estado !== ESTADO_FINAL_TAREA).length; const pendingReview = clientTasks.filter((task) => task.estado === "en_revision").length; return <article className="ros-client-card" key={client.id}><header><span>{initials(client.nombre)}</span><div><strong>{client.nombre}</strong><small>Cuenta #{client.id}</small></div></header><div><span><strong>{active}</strong><small>Activas</small></span><span><strong>{pendingReview}</strong><small>Para revisar</small></span><span><strong>{clientTasks.length}</strong><small>Total</small></span></div><footer><span>Cuota: {client.cuota_reels || 0} reels · {client.cuota_carruseles || 0} carruseles</span></footer></article>; })}</div></section>;
}

function TeamView({ users, tasks, query }) {
  const visible = users.filter((user) => `${user.nombre} ${user.usuario} ${user.rol}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="ros-page"><div className="ros-title-row"><div><div className="ros-eyebrow">PERSONAS Y PERMISOS</div><h1>Equipo</h1><p>Cuentas, correos y carga activa calculada desde Tareas.</p></div><a className="ros-primary-button" href="/empleados">Administrar equipo ↗</a></div><div className="ros-summary"><article><span className="green">●</span><div><strong>{users.length}</strong><small>Usuarios activos</small></div></article><article><span className="blue">●</span><div><strong>{tasks.filter((task) => task.estado !== ESTADO_FINAL_TAREA).length}</strong><small>Tareas activas</small></div></article><article><span className="amber">●</span><div><strong>{new Set(tasks.map((task) => task.asignado_a).filter(Boolean)).size}</strong><small>Responsables con tareas</small></div></article><article><span className="green">●</span><div><strong>{users.filter((user) => user.email_notificaciones).length}</strong><small>Correos configurados</small></div></article></div><div className="ros-section-bar"><strong>Equipo activo</strong><span>● CUENTAS REALES</span></div><div className="ros-people-table"><div className="ros-people-head"><span>PERSONA</span><span>ROL</span><span>ACTIVAS</span><span>EN REVISIÓN</span><span>CUENTA</span></div>{visible.map((user) => { const assigned = tasks.filter((task) => task.asignado_a === user.nombre || task.asignado_a === user.usuario); const active = assigned.filter((task) => task.estado !== ESTADO_FINAL_TAREA).length; const review = assigned.filter((task) => task.estado === "en_revision").length; return <div className="ros-people-row" key={user.id}><span><Avatar person={user}/><span><strong>{user.nombre}</strong><small>@{user.usuario}</small></span></span><span className="ros-role">{ROL_LABELS[user.rol] || user.rol}</span><strong>{active}</strong><span>{review}</span><span><i/> Activa<small>{user.email_notificaciones || "Sin correo de notificaciones"}</small></span></div>; })}</div><div className="ros-note"><span>⌘</span><div><strong>Las nuevas tareas muestran nombre, @usuario y correo antes de asignar.</strong><p>La base actual conserva el nombre como vínculo compatible; la cuenta y el correo se resuelven desde Usuarios.</p></div></div></section>;
}

export function WorkspaceStagingLogin() {
  const [usuario, setUsuario] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const googleButton = useRef(null);

  const completeLogin = useCallback(async (request) => {
    setLoading(true);
    setError("");
    try {
      const body = await request;
      localStorage.setItem("render_sesion", JSON.stringify(body));
      window.location.reload();
    } catch (reason) {
      setError(reason.message || "No se pudo iniciar sesión.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const renderGoogleButton = () => {
      if (!window.google?.accounts?.id || !googleButton.current) return;
      googleButton.current.innerHTML = "";
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: ({ credential }) => completeLogin(apiRequest("/api/login/google", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credential }),
        })),
      });
      window.google.accounts.id.renderButton(googleButton.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        shape: "pill",
        text: "continue_with",
        locale: "es",
        width: 320,
      });
    };

    if (document.getElementById("google-identity-script")) {
      renderGoogleButton();
      return undefined;
    }
    const script = document.createElement("script");
    script.id = "google-identity-script";
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = renderGoogleButton;
    document.head.appendChild(script);
    return undefined;
  }, [completeLogin]);

  const submit = async (event) => {
    event.preventDefault();
    await completeLogin(apiRequest("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario, password: contrasena }),
    }));
  };
  return <main className="ros-staging-login"><section><div className="ros-staging-brand"><span>R</span><strong>RENDER</strong><b>OS</b></div><div className="ros-operational-pill">● STAGING OPERATIVO</div><h1>Operación con datos reales</h1><p>Ingresá con la misma cuenta del sistema. Los cambios que hagas en tareas se guardan en <strong>sistema.rendercorrientes.com</strong>.</p><div className="ros-google-login" ref={googleButton}/><div className="ros-login-divider"><span>o con tu usuario</span></div><form onSubmit={submit}><label>Usuario<input autoComplete="username" value={usuario} onChange={(event) => setUsuario(event.target.value)} required autoFocus/></label><label>Contraseña<input type="password" autoComplete="current-password" value={contrasena} onChange={(event) => setContrasena(event.target.value)} required/></label>{error && <div className="ros-login-error">{error}</div>}<button type="submit" disabled={loading}>{loading ? "Ingresando…" : "Entrar al staging"}</button></form><a href="https://sistema.rendercorrientes.com/login">Volver al sistema actual ↗</a></section></main>;
}

export function WorkspaceReadOnlyPage({ path, sesion, staging = false }) {
  const requestedSection = new URLSearchParams(window.location.search).get("section");
  const section = staging && ["tasks", "clients", "team"].includes(requestedSection) ? requestedSection : SECTIONS[path] || "tasks";
  const [tasks, setTasks] = useState([]);
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const [query, setQuery] = useState("");
  const [area, setArea] = useState("all");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isAdmin = sesion?.usuario?.rol === "admin";

  useEffect(() => {
    let active = true;
    Promise.all([apiJson("/api/tareas"), apiJson("/api/clientes"), isAdmin ? apiJson("/api/usuarios") : Promise.resolve([])])
      .then(([taskData, clientData, userData]) => { if (!active) return; setTasks(taskData); setClients(clientData); setUsers(userData); setError(""); })
      .catch((reason) => { if (active) setError(reason.message || "No se pudieron cargar los datos reales."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isAdmin]);

  const notify = (message, type = "success") => { setToast({ message, type }); window.clearTimeout(window.__rosToastTimer); window.__rosToastTimer = window.setTimeout(() => setToast(null), 3500); };
  const logActivity = (taskId, message) => apiRequest(`/api/tareas/${taskId}/comentarios`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autor: sesion?.usuario?.nombre || sesion?.usuario?.usuario || "Equipo RENDER", contenido: `[Actividad] ${message}` }) }).catch(() => null);
  const updateTask = async (id, changes, activity) => {
    const previous = tasks.find((task) => task.id === id);
    setTasks((current) => current.map((task) => task.id === id ? { ...task, ...changes } : task));
    try {
      const updated = await apiRequest(`/api/tareas/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) });
      const client = clients.find((item) => String(item.id) === String(updated.cliente_id));
      setTasks((current) => current.map((task) => task.id === id ? { ...task, ...updated, cliente_nombre: client?.nombre || null } : task));
      if (activity) await logActivity(id, activity);
      notify("Cambio guardado en la tarea real.");
      return updated;
    } catch (reason) {
      setTasks((current) => current.map((task) => task.id === id ? previous : task));
      notify(reason.message || "No se pudo guardar el cambio.", "error");
      throw reason;
    }
  };
  const createTask = async (draft) => {
    try {
      const created = await apiRequest("/api/tareas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const client = clients.find((item) => String(item.id) === String(created.cliente_id));
      const complete = { ...created, cliente_nombre: client?.nombre || null };
      setTasks((current) => [complete, ...current]);
      await logActivity(created.id, "creó y asignó la tarea desde RENDER OS");
      notify("Tarea creada y asignada.");
      return complete;
    } catch (reason) {
      notify(reason.message || "No se pudo crear la tarea.", "error");
      throw reason;
    }
  };

  const title = section === "clients" ? "Clientes" : section === "team" ? "Equipo" : "Tareas";
  const placeholder = section === "clients" ? "Buscar cliente…" : section === "team" ? "Buscar persona, usuario o rol…" : "Buscar tarea, cliente o responsable…";
  const legacyBase = staging ? (import.meta.env.VITE_API_BASE || "https://sistema.rendercorrientes.com") : "";
  const workspaceTarget = (target) => staging ? `/workspace-staging/?section=${target}` : `/workspace/${target === "tasks" ? "tareas" : target === "clients" ? "clientes" : "equipo"}`;
  const go = (target) => { window.location.href = staging && target === "/workspace/tareas" ? workspaceTarget("tasks") : target; };

  useEffect(() => {
    if (!staging) return undefined;
    const redirectStagingLinks = (event) => {
      const anchor = event.target.closest("a"); if (!anchor) return;
      const href = anchor.getAttribute("href");
      const workspaceSections = { "/workspace/tareas": "tasks", "/workspace/clientes": "clients", "/workspace/equipo": "team" };
      if (workspaceSections[href]) { event.preventDefault(); window.location.href = workspaceTarget(workspaceSections[href]); }
      else if (href?.startsWith("/")) { event.preventDefault(); window.location.href = `${legacyBase}${href}`; }
    };
    document.addEventListener("click", redirectStagingLinks);
    return () => document.removeEventListener("click", redirectStagingLinks);
  }, [staging, legacyBase]);

  return <div className={`render-workspace ${collapsed ? "collapsed" : ""}`}><Toast toast={toast} onClose={() => setToast(null)}/><button className={`ros-backdrop ${mobileOpen ? "show" : ""}`} onClick={() => setMobileOpen(false)} aria-label="Cerrar menú"/><aside className={`ros-sidebar ${mobileOpen ? "open" : ""}`}><div className="ros-brand"><span>R</span><strong>RENDER</strong><b>OS</b><button className="ros-collapse" onClick={() => setCollapsed((value) => !value)}>{collapsed ? "›" : "‹"}</button><button className="ros-close" onClick={() => setMobileOpen(false)}>×</button></div><button className="ros-side-search" onClick={() => document.querySelector(".ros-top-search")?.focus()}><span>⌕</span><em>Buscar</em><kbd>⌘ K</kbd></button><nav><a href="/">⌂ <span>Inicio</span></a><a className={section === "tasks" ? "active" : ""} href="/workspace/tareas">✓ <span>Tareas</span></a>{isAdmin && <a className={section === "clients" ? "active" : ""} href="/workspace/clientes">◌ <span>Clientes</span></a>}{isAdmin && <a className={section === "team" ? "active" : ""} href="/workspace/equipo">♙ <span>Equipo</span></a>}<a href="/reportes-historias">↗ <span>Reportes</span></a></nav><div className="ros-side-label">ESPACIOS DE TRABAJO</div><nav className="ros-areas">{AREAS.slice(1).map((item) => <button key={item.id} className={section === "tasks" && area === item.id ? "active" : ""} onClick={() => { if (section !== "tasks") go("/workspace/tareas"); else setArea(item.id); }}><i style={{ color: item.color }}>{item.icon}</i><span>{item.label}</span></button>)}</nav><div className="ros-side-bottom"><a href="/perfil">?<span>Ayuda y procesos</span></a><div><Avatar name={sesion?.usuario?.nombre}/><span><strong>{sesion?.usuario?.nombre}</strong><small>{ROL_LABELS[sesion?.usuario?.rol] || sesion?.usuario?.rol}</small></span></div></div></aside><main className="ros-main"><header className="ros-topbar"><button className="ros-menu" onClick={() => setMobileOpen(true)}>☰</button><div><span>RENDER</span><b>/</b><strong>{title}</strong></div><input className="ros-top-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder}/><span className="ros-live-badge">● DATOS REALES</span></header>{loading || error ? <LoadingState error={error}/> : section === "clients" && isAdmin ? <ClientsView clients={clients} tasks={tasks} query={query}/> : section === "team" && isAdmin ? <TeamView users={users} tasks={tasks} query={query}/> : <TasksView tasks={tasks} users={users} clients={clients} query={query} area={area} setArea={setArea} sesion={sesion} onCreate={createTask} onUpdate={updateTask}/>}</main><nav className="ros-mobile-nav"><a className={section === "tasks" ? "active" : ""} href="/workspace/tareas"><span>✓</span>Tareas</a>{isAdmin && <a className={section === "clients" ? "active" : ""} href="/workspace/clientes"><span>◌</span>Clientes</a>}{isAdmin && <a className={section === "team" ? "active" : ""} href="/workspace/equipo"><span>♙</span>Equipo</a>}<button onClick={() => setMobileOpen(true)}><span>☰</span>Más</button></nav></div>;
}
