import React, { useEffect, useState } from "react";
import { apiJson, apiTaskPage } from "../features/render-os/services/render-os-api.js";
import { activeTasks, belongsToUser, dashboardToday, orderTasks, pendingFeedback, priorityForTask, taskPeople } from "../features/render-os/utils/home-dashboard.js";
import { formatDate } from "../features/render-os/utils/task-formatters.js";
import { STATUSES } from "../features/render-os/constants.js";
import "./QuickHome.css";

const WORK_AREAS = [
  { href: "/workspace/tareas", title: "Tablero de tareas", description: "Todo el trabajo y sus entregas" },
  { href: "/lista", title: "Mi lista", description: "Tus pendientes privados" },
  { href: "/moodboards", title: "Moodboards", description: "Referencias por cliente" },
  { href: "/feedback", title: "Feedback", description: "Notas y devoluciones" },
  { href: "/planificacion-publicaciones", title: "Publicaciones", description: "Calendario de contenido" },
];

export function QuickHomePage({ sesion, onNavigate }) {
  const user = sesion?.usuario;
  const isAdmin = user?.rol === "admin";
  const firstName = String(user?.nombre || user?.usuario || "equipo").trim().split(/\s+/)[0];
  const [tasks, setTasks] = useState([]);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notesError, setNotesError] = useState("");
  const [reload, setReload] = useState(0);
  const [scope, setScope] = useState("mine");
  const [filter, setFilter] = useState("all");
  const [today, setToday] = useState(dashboardToday);
  const team = isAdmin && scope === "team";
  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setNotesError(""); setTasks([]); setNotes([]); setToday(dashboardToday());
    const loadTasks = async () => {
      const rows = [];
      let offset = 0;
      while (active) {
        const page = await apiTaskPage({ offset, limit: 100 });
        rows.push(...page.items); offset += page.items.length;
        if (offset >= page.total) return rows;
        if (!page.items.length) throw new Error("La lista de tareas quedó incompleta. Volvé a cargarla.");
      }
      return [];
    };
    Promise.allSettled([loadTasks(), apiJson("/api/notas")]).then(([taskResult, noteResult]) => {
      if (!active) return;
      if (taskResult.status === "fulfilled") setTasks(taskResult.value);
      else setError(taskResult.reason?.message || "No se pudieron cargar las tareas.");
      if (noteResult.status === "fulfilled") setNotes(noteResult.value);
      else setNotesError("No se pudo cargar el feedback. Podés volver a intentar.");
      setLoading(false);
    });
    return () => { active = false; };
  }, [user?.nombre, user?.usuario, user?.rol, reload]);
  const open = (event, href) => {
    if (!onNavigate || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onNavigate(href);
  };
  const link = (href, children, className = "") => <a key={href} className={className} href={href} onClick={(event) => open(event, href)}>{children}</a>;
  const active = activeTasks(tasks);
  const scoped = active.filter((task) => team || belongsToUser(taskPeople(task), user));
  const ordered = orderTasks(scoped.filter((task) => team || task.estado !== "en_revision"), today);
  const late = scoped.filter((task) => priorityForTask(task, today).rank === 0);
  const dueToday = scoped.filter((task) => task.fecha_vencimiento === today);
  const reviews = scoped.filter((task) => task.estado === "en_revision");
  const visible = filter === "late" ? orderTasks(late, today) : filter === "reviews" ? orderTasks(reviews, today) : ordered;
  const feedback = pendingFeedback(notes, user, team);
  const permanentFeedback = pendingFeedback(notes, user, team, true);
  const next = visible[0];
  return <main className="quick-home" aria-label="Mi trabajo en Render"><div className="quick-home-shell">
    <header className="quick-home-header"><div><span className="qh-eyebrow">Mesa de trabajo · {formatDate(today)}</span><h1>Hola, {firstName}.</h1><p>Tu próximo paso, las entregas y las devoluciones del equipo.</p></div><button className="qh-refresh" type="button" disabled={loading} onClick={() => setReload((value) => value + 1)}>{loading ? "Cargando…" : "Actualizar"}</button></header>
    {isAdmin && <div className="qh-scope" aria-label="Alcance del inicio">{[["mine", "Mi trabajo"], ["team", "Equipo"]].map(([value, label]) => <button type="button" key={value} aria-pressed={scope === value} onClick={() => { setScope(value); setFilter("all"); }}>{label}</button>)}</div>}
    {loading ? <div className="qh-state" role="status">Cargando tareas y feedback…</div> : error ? <div className="qh-state qh-error" role="alert"><p>{error}</p><button type="button" onClick={() => setReload((value) => value + 1)}>Volver a intentar</button></div> : <>
      <section className="qh-summary" aria-label={team ? "Resumen del equipo" : "Resumen de mis tareas"}>
        <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}><strong>{scoped.length}</strong><span>Tareas abiertas</span></button>
        <button type="button" className="qh-summary-late" aria-pressed={filter === "late"} onClick={() => setFilter("late")}><strong>{late.length}</strong><span>Vencidas</span></button>
        <div><strong>{dueToday.length}</strong><span>Vencen hoy</span></div>
        <button type="button" aria-pressed={filter === "reviews"} onClick={() => setFilter("reviews")}><strong>{reviews.length}</strong><span>{team ? "Para revisar" : "Esperando revisión"}</span></button>
      </section>
      <div className="qh-columns"><section className="qh-priorities" aria-labelledby="qh-priorities-title"><header className="qh-section-head"><div><h2 id="qh-priorities-title">{filter === "reviews" ? team ? "Para revisar" : "Esperando revisión" : filter === "late" ? "Entregas vencidas" : team ? "Prioridades del equipo" : "Qué hacer primero"}</h2><p>{filter === "reviews" && !team ? "Ya enviaste estas tareas. Coordiná la aprobación antes de continuar." : "Vencidas, hoy, próximos 7 días y trabajo en proceso."}</p></div>{link("/workspace/tareas", "Ver tablero →")}</header>
        {next && (team || next.estado !== "en_revision") && <div className={`qh-next qh-tone-${priorityForTask(next, today).tone}`}><span className="qh-eyebrow">{filter === "reviews" ? "Siguiente revisión" : "Primera prioridad"}</span>{link(`/workspace/tareas?task=${encodeURIComponent(next.id)}`, <><strong>{next.titulo || "Sin título"}</strong><span>Abrir tarea →</span></>)}<p>{next.cliente_nombre || "Sin cliente"} · {formatDate(next.fecha_vencimiento)}</p></div>}
        <div className="qh-task-list">{visible.slice(0, 8).map((task) => { const priority = priorityForTask(task, today); return link(`/workspace/tareas?task=${encodeURIComponent(task.id)}`, <><div className="qh-task-copy"><strong>{task.titulo || "Sin título"}</strong><small>{task.cliente_nombre || "Sin cliente"} · {taskPeople(task).join(", ") || "Sin responsable"}</small><small>{STATUSES.find((status) => status.id === task.estado)?.label || task.estado}</small></div><div className="qh-task-deadline"><span className={`qh-badge qh-tone-${priority.tone}`}>{priority.label}</span><time>{formatDate(task.fecha_vencimiento)}</time></div></>, "qh-task"); })}</div>
        {!visible.length && <p className="qh-empty">{filter === "reviews" ? "No hay tareas pendientes de revisión en esta vista." : filter === "late" ? "No hay entregas vencidas en esta vista." : team ? "El equipo no tiene tareas abiertas." : reviews.length ? "Tu trabajo abierto está esperando revisión. Consultá esa vista para coordinar las aprobaciones." : "No tenés tareas abiertas asignadas. Consultá el tablero para coordinar el próximo trabajo."}</p>}
        {visible.length > 8 && <p className="qh-list-note">Mostrando 8 de {visible.length}. {link("/workspace/tareas", "Ver todas en el tablero")}</p>}
      </section><aside className="qh-side"><section className="qh-feedback" aria-labelledby="qh-feedback-title">
        <header className="qh-section-head"><div><h2 id="qh-feedback-title">Feedback pendiente</h2><p>{team ? "Devoluciones del equipo y clientes" : "Devoluciones asignadas a vos"}</p></div></header>
        {notesError ? <div role="alert"><p>{notesError}</p><button type="button" onClick={() => setReload((value) => value + 1)}>Reintentar feedback</button></div> : <>
          {feedback.slice(0, 4).map((note) => link(`/feedback?section=${note.feedback?.cliente ? "clients" : "team"}&note=${encodeURIComponent(note.id)}`, <><strong>{note.titulo || "Sin título"}</strong><small>{note.feedback?.cliente || "Equipo"} · {formatDate(note.updated_at)}</small></>, "qh-feedback-item"))}
          {!feedback.length && <p className="qh-empty">No hay feedback pendiente {team ? "en las notas consultadas" : "asignado a vos"}.</p>}
          {permanentFeedback.length > 0 && <div className="qh-permanent"><h3>Indicaciones permanentes</h3>{permanentFeedback.slice(0, 2).map((note) => link(`/feedback?section=${note.feedback?.cliente ? "clients" : "team"}&note=${encodeURIComponent(note.id)}`, <><strong>{note.titulo || "Sin título"}</strong><small>Referencia para el trabajo</small></>, "qh-feedback-item"))}</div>}
          <p className="qh-list-note">Se consultan las 500 notas más recientes.</p>
        </>}{link("/feedback", "Abrir feedback →", "qh-text-link")}
      </section>
        {team && <section className="qh-coordination"><h2>Para ordenar</h2><p><strong>{active.filter((task) => !taskPeople(task).length).length}</strong> tareas abiertas sin responsable</p><p><strong>{active.filter((task) => !task.fecha_vencimiento).length}</strong> tareas abiertas sin fecha</p>{link("/workspace/tareas", "Revisar asignaciones →", "qh-text-link")}</section>}
      </aside></div>
    </>}
    <nav className="quick-home-grid" aria-label="Áreas de trabajo">{WORK_AREAS.map((area) => link(area.href, <><div><strong>{area.title}</strong><small>{area.description}</small></div><span aria-hidden="true">↗</span></>, "qh-area"))}</nav>
  </div></main>;
}
