import React, { useEffect, useMemo, useState } from "react";
import { ESTADO_FINAL_TAREA, ROL_LABELS } from "../constants.js";
import "./WorkspaceReadOnly.css";

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

function apiJson(url) {
  return fetch(url).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `No se pudo cargar ${url}`);
    return Array.isArray(body) ? body : [];
  });
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

function initials(value = "") {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
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
  return <div className={`ros-state ${error ? "error" : ""}`}><span>{error ? "!" : "◌"}</span><strong>{error || "Conectando con los datos reales…"}</strong><small>{error ? "La interfaz anterior sigue disponible y no se modificó ningún dato." : "Tareas, clientes y usuarios se cargan únicamente para lectura."}</small></div>;
}

function TaskDetail({ task, users, onClose }) {
  if (!task) return null;
  const person = users.find((user) => user.nombre === task.asignado_a || user.usuario === task.asignado_a);
  const status = STATUSES.find((item) => item.id === task.estado) || STATUSES[0];
  return <div className="ros-drawer-backdrop" onClick={onClose}><aside className="ros-drawer" onClick={(event) => event.stopPropagation()}><header><AreaBadge task={task}/><button onClick={onClose}>×</button></header><div className="ros-drawer-body"><div className="ros-eyebrow">{task.cliente_nombre || "SIN CLIENTE"}</div><h2>{task.titulo}</h2><div className="ros-readonly-pill">🔒 Solo lectura · los cambios están deshabilitados</div><div className="ros-properties"><label><span>Estado</span><strong><i style={{ color: status.color }}>●</i>{status.label}</strong></label><label><span>Responsable</span><strong><Avatar person={person} name={task.asignado_a}/>{task.asignado_a || "Sin asignar"}</strong></label><label><span>Vencimiento</span><strong>{formatDate(task.fecha_vencimiento)}</strong></label><label><span>Prioridad</span><strong>{task.prioridad || "Media"}</strong></label><label><span>Tipo</span><strong>{task.subtipo || task.tipo_tarea || "Sin definir"}</strong></label></div>{person && <div className="ros-person-card"><Avatar person={person}/><div><strong>{person.nombre}</strong><span>@{person.usuario} · {ROL_LABELS[person.rol] || person.rol}</span><small>{person.email_notificaciones || "Sin correo de notificaciones"}</small></div></div>}<hr/><h4>Indicaciones</h4><p className="ros-description">{task.aclaraciones || "Esta tarea todavía no tiene indicaciones cargadas."}</p><h4>Material y enlaces</h4>{task.material_referencia ? <a className="ros-file" href={task.material_referencia} target="_blank" rel="noreferrer"><span>▣</span><div><strong>Material de referencia</strong><small>{task.material_referencia}</small></div><b>↗</b></a> : <p className="ros-empty-copy">No hay material vinculado.</p>}<h4>Datos de origen</h4><div className="ros-origin"><span>ID #{task.id}</span><span>Creada: {formatDate(task.created_at)}</span><span>Actualizada: {formatDate(task.updated_at)}</span></div></div></aside></div>;
}

function TasksView({ tasks, users, query, area, setArea }) {
  const [view, setView] = useState("board");
  const [selected, setSelected] = useState(null);
  const today = new Date().toISOString().slice(0, 10);
  const visible = useMemo(() => tasks.filter((task) => {
    const matchesArea = area === "all" || areaForTask(task) === area;
    const text = `${task.titulo} ${task.cliente_nombre || ""} ${task.asignado_a || ""}`.toLowerCase();
    return matchesArea && text.includes(query.toLowerCase());
  }), [tasks, query, area]);
  const overdue = tasks.filter((task) => task.estado !== ESTADO_FINAL_TAREA && task.fecha_vencimiento && task.fecha_vencimiento < today).length;
  const review = tasks.filter((task) => task.estado === "en_revision").length;
  const active = tasks.filter((task) => task.estado !== ESTADO_FINAL_TAREA).length;

  return <><section className="ros-page"><div className="ros-title-row"><div><div className="ros-eyebrow">CENTRO OPERATIVO</div><h1>Tareas</h1><p>Nueva interfaz conectada a la base actual, sin habilitar escrituras.</p></div><a className="ros-primary-button" href="/piezas">Abrir interfaz actual ↗</a></div><div className="ros-summary"><article><span className="red">●</span><div><strong>{overdue}</strong><small>Vencidas</small></div></article><article><span className="amber">●</span><div><strong>{review}</strong><small>Esperando revisión</small></div></article><article><span className="green">●</span><div><strong>{tasks.length - active}</strong><small>Terminadas</small></div></article><article><span className="blue">●</span><div><strong>{active}</strong><small>Carga activa</small></div></article></div><div className="ros-controls"><div><button className={view === "board" ? "active" : ""} onClick={() => setView("board")}>▦ Tablero</button><button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>☷ Lista</button></div><span>🔒 SOLO LECTURA</span></div>{area !== "all" && <div className="ros-active-filter">Área: <strong>{AREAS.find((item) => item.id === area)?.label}</strong><button onClick={() => setArea("all")}>×</button></div>}{view === "board" && <div className="ros-board">{STATUSES.map((status) => { const items = visible.filter((task) => task.estado === status.id); return <section className="ros-column" key={status.id}><header><span style={{ color: status.color }}>●</span><strong>{status.label}</strong><small>{items.length}</small></header><div>{items.map((task) => { const person = users.find((user) => user.nombre === task.asignado_a || user.usuario === task.asignado_a); return <button className="ros-task-card" key={task.id} onClick={() => setSelected(task)}><AreaBadge task={task}/><h3>{task.titulo}</h3><p>{task.cliente_nombre || "Sin cliente"}</p><footer><Avatar person={person} name={task.asignado_a}/><span>{task.asignado_a || "Sin asignar"}</span><b className={task.fecha_vencimiento && task.fecha_vencimiento < today && task.estado !== ESTADO_FINAL_TAREA ? "urgent" : ""}>□ {formatDate(task.fecha_vencimiento)}</b></footer></button>; })}{items.length === 0 && <div className="ros-empty-column">Sin tareas</div>}</div></section>; })}</div>}{view === "list" && <div className="ros-task-list"><div className="ros-task-list-head"><span>TAREA</span><span>ÁREA</span><span>CLIENTE</span><span>RESPONSABLE</span><span>ESTADO</span><span>FECHA</span></div>{visible.map((task) => <button key={task.id} onClick={() => setSelected(task)}><strong>{task.titulo}</strong><AreaBadge task={task}/><span>{task.cliente_nombre || "Sin cliente"}</span><span>{task.asignado_a || "Sin asignar"}</span><span>{STATUSES.find((item) => item.id === task.estado)?.label || task.estado}</span><span>{formatDate(task.fecha_vencimiento)}</span></button>)}</div>}</section><TaskDetail task={selected} users={users} onClose={() => setSelected(null)}/></>;
}

function ClientsView({ clients, tasks, query }) {
  const visible = clients.filter((client) => client.nombre.toLowerCase().includes(query.toLowerCase()));
  const activeTasks = tasks.filter((task) => task.estado !== ESTADO_FINAL_TAREA).length;
  const review = tasks.filter((task) => task.estado === "en_revision").length;
  return <section className="ros-page"><div className="ros-title-row"><div><div className="ros-eyebrow">RELACIONES Y CUENTAS</div><h1>Clientes</h1><p>Conteos reales de la base actual. Las ediciones siguen en la interfaz anterior.</p></div><a className="ros-primary-button" href="/clientes">Abrir interfaz actual ↗</a></div><div className="ros-summary"><article><span className="blue">●</span><div><strong>{clients.length}</strong><small>Clientes registrados</small></div></article><article><span className="green">●</span><div><strong>{activeTasks}</strong><small>Tareas activas</small></div></article><article><span className="amber">●</span><div><strong>{review}</strong><small>Para revisar</small></div></article><article><span className="gray">●</span><div><strong>{tasks.length}</strong><small>Tareas históricas</small></div></article></div><div className="ros-section-bar"><strong>Todos los clientes</strong><span>🔒 SOLO LECTURA</span></div><div className="ros-client-grid">{visible.map((client) => { const clientTasks = tasks.filter((task) => String(task.cliente_id) === String(client.id)); const active = clientTasks.filter((task) => task.estado !== ESTADO_FINAL_TAREA).length; const pendingReview = clientTasks.filter((task) => task.estado === "en_revision").length; return <article className="ros-client-card" key={client.id}><header><span>{initials(client.nombre)}</span><div><strong>{client.nombre}</strong><small>Cuenta #{client.id}</small></div></header><div><span><strong>{active}</strong><small>Activas</small></span><span><strong>{pendingReview}</strong><small>Para revisar</small></span><span><strong>{clientTasks.length}</strong><small>Total</small></span></div><footer><span>Cuota: {client.cuota_reels || 0} reels · {client.cuota_carruseles || 0} carruseles</span></footer></article>; })}</div></section>;
}

function TeamView({ users, tasks, query }) {
  const visible = users.filter((user) => `${user.nombre} ${user.usuario} ${user.rol}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="ros-page"><div className="ros-title-row"><div><div className="ros-eyebrow">PERSONAS Y PERMISOS</div><h1>Equipo</h1><p>Cuentas reales, roles y carga activa calculada desde Tareas.</p></div><a className="ros-primary-button" href="/empleados">Abrir interfaz actual ↗</a></div><div className="ros-summary"><article><span className="green">●</span><div><strong>{users.length}</strong><small>Usuarios activos</small></div></article><article><span className="blue">●</span><div><strong>{tasks.filter((task) => task.estado !== ESTADO_FINAL_TAREA).length}</strong><small>Tareas activas</small></div></article><article><span className="amber">●</span><div><strong>{new Set(tasks.map((task) => task.asignado_a).filter(Boolean)).size}</strong><small>Responsables con tareas</small></div></article><article><span className="green">●</span><div><strong>{users.filter((user) => user.email_notificaciones).length}</strong><small>Correos configurados</small></div></article></div><div className="ros-section-bar"><strong>Equipo activo</strong><span>🔒 SOLO LECTURA</span></div><div className="ros-people-table"><div className="ros-people-head"><span>PERSONA</span><span>ROL</span><span>ACTIVAS</span><span>EN REVISIÓN</span><span>CUENTA</span></div>{visible.map((user) => { const assigned = tasks.filter((task) => task.asignado_a === user.nombre || task.asignado_a === user.usuario); const active = assigned.filter((task) => task.estado !== ESTADO_FINAL_TAREA).length; const review = assigned.filter((task) => task.estado === "en_revision").length; return <div className="ros-people-row" key={user.id}><span><Avatar person={user}/><span><strong>{user.nombre}</strong><small>@{user.usuario}</small></span></span><span className="ros-role">{ROL_LABELS[user.rol] || user.rol}</span><strong>{active}</strong><span>{review}</span><span><i/> Activa<small>{user.email_notificaciones || "Sin correo de notificaciones"}</small></span></div>; })}</div><div className="ros-note"><span>⌘</span><div><strong>La asignación todavía usa el nombre guardado en cada tarea.</strong><p>En la próxima fase se migrará a `responsable_id`; esta vista ya compara nombres actuales con las cuentas reales sin modificar la base.</p></div></div></section>;
}

export function WorkspaceReadOnlyPage({ path, sesion }) {
  const section = SECTIONS[path] || "tasks";
  const [tasks, setTasks] = useState([]);
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [area, setArea] = useState("all");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([apiJson("/api/tareas"), apiJson("/api/clientes"), apiJson("/api/usuarios")])
      .then(([taskData, clientData, userData]) => { if (!active) return; setTasks(taskData); setClients(clientData); setUsers(userData); setError(""); })
      .catch((reason) => { if (active) setError(reason.message || "No se pudieron cargar los datos reales."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const title = section === "clients" ? "Clientes" : section === "team" ? "Equipo" : "Tareas";
  const placeholder = section === "clients" ? "Buscar cliente…" : section === "team" ? "Buscar persona, usuario o rol…" : "Buscar tarea, cliente o responsable…";
  const go = (target) => { window.location.href = target; };

  return <div className={`render-workspace ${collapsed ? "collapsed" : ""}`}><button className={`ros-backdrop ${mobileOpen ? "show" : ""}`} onClick={() => setMobileOpen(false)} aria-label="Cerrar menú"/><aside className={`ros-sidebar ${mobileOpen ? "open" : ""}`}><div className="ros-brand"><span>R</span><strong>RENDER</strong><b>OS</b><button className="ros-collapse" onClick={() => setCollapsed((value) => !value)}>{collapsed ? "›" : "‹"}</button><button className="ros-close" onClick={() => setMobileOpen(false)}>×</button></div><button className="ros-side-search" onClick={() => document.querySelector(".ros-top-search")?.focus()}><span>⌕</span><em>Buscar</em><kbd>⌘ K</kbd></button><nav><a href="/">⌂ <span>Inicio</span></a><a className={section === "tasks" ? "active" : ""} href="/workspace/tareas">✓ <span>Tareas</span></a><a className={section === "clients" ? "active" : ""} href="/workspace/clientes">◌ <span>Clientes</span></a><a className={section === "team" ? "active" : ""} href="/workspace/equipo">♙ <span>Equipo</span></a><a href="/reportes-historias">↗ <span>Reportes</span></a></nav><div className="ros-side-label">ESPACIOS DE TRABAJO</div><nav className="ros-areas">{AREAS.slice(1).map((item) => <button key={item.id} className={section === "tasks" && area === item.id ? "active" : ""} onClick={() => { if (section !== "tasks") go("/workspace/tareas"); else setArea(item.id); }}><i style={{ color: item.color }}>{item.icon}</i><span>{item.label}</span></button>)}</nav><div className="ros-side-bottom"><a href="/perfil">?<span>Ayuda y procesos</span></a><div><Avatar name={sesion?.usuario?.nombre}/><span><strong>{sesion?.usuario?.nombre}</strong><small>{ROL_LABELS[sesion?.usuario?.rol] || sesion?.usuario?.rol}</small></span></div></div></aside><main className="ros-main"><header className="ros-topbar"><button className="ros-menu" onClick={() => setMobileOpen(true)}>☰</button><div><span>RENDER</span><b>/</b><strong>{title}</strong></div><input className="ros-top-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder}/><span className="ros-live-badge">DATOS REALES · LECTURA</span></header>{loading || error ? <LoadingState error={error}/> : section === "clients" ? <ClientsView clients={clients} tasks={tasks} query={query}/> : section === "team" ? <TeamView users={users} tasks={tasks} query={query}/> : <TasksView tasks={tasks} users={users} query={query} area={area} setArea={setArea}/>}</main><nav className="ros-mobile-nav"><a className={section === "tasks" ? "active" : ""} href="/workspace/tareas"><span>✓</span>Tareas</a><a className={section === "clients" ? "active" : ""} href="/workspace/clientes"><span>◌</span>Clientes</a><a className={section === "team" ? "active" : ""} href="/workspace/equipo"><span>♙</span>Equipo</a><button onClick={() => setMobileOpen(true)}><span>☰</span>Más</button></nav></div>;
}
