import React, { useEffect, useState } from "react";
import { apiJson, apiTaskPage } from "../features/render-os/services/render-os-api.js";
import { activeTasks, belongsToUser, dashboardCharts, dashboardToday, isWaitingReview, orderTasks, pendingFeedback, priorityForTask, taskPeople, taskStage } from "../features/render-os/utils/home-dashboard.js";
import { formatDate } from "../features/render-os/utils/task-formatters.js";
import { STATUSES } from "../features/render-os/constants.js";
import "./QuickHome.css";

export function QuickHomePage({ sesion, onNavigate }) {
  const user = sesion?.usuario;
  const isAdmin = user?.rol === "admin";
  const [tasks, setTasks] = useState([]);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notesError, setNotesError] = useState("");
  const [reload, setReload] = useState(0);
  const [scope, setScope] = useState("mine");
  const [filter, setFilter] = useState("all");
  const [day, setDay] = useState("");
  const [group, setGroup] = useState("");
  const [today, setToday] = useState(dashboardToday);
  const team = isAdmin && scope === "team";
  const select = (value) => { setFilter(value); setDay(""); setGroup(""); };
  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setNotesError(""); setTasks([]); setNotes([]); setToday(dashboardToday());
    const loadTasks = async () => {
      const rows = []; let offset = 0;
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
      else setNotesError("No se pudo cargar el feedback.");
      setLoading(false);
    });
    return () => { active = false; };
  }, [user?.nombre, user?.usuario, user?.rol, reload]);
  const link = (href, children, className = "") => <a key={href} className={className} href={href} onClick={(event) => {
    if (!onNavigate || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onNavigate(href);
  }}>{children}</a>;
  const records = tasks.filter((task) => ![true, "true"].includes(task.propiedades_extra?.papelera_render_os) && ![true, "true"].includes(task.propiedades_extra?.archivada_render_os) && (team || belongsToUser(taskPeople(task), user)));
  const scoped = activeTasks(records);
  const ordered = orderTasks(scoped.filter((task) => team || !isWaitingReview(task)), today);
  const late = ordered.filter((task) => priorityForTask(task, today).rank === 0);
  const dueToday = ordered.filter((task) => task.fecha_vencimiento === today);
  const reviews = scoped.filter(isWaitingReview);
  const charts = dashboardCharts(records, today, team);
  const groupName = (task) => team ? task.asignado_a || "Sin responsable principal" : task.cliente_nombre || "Sin cliente";
  const filtered = day ? scoped.filter((task) => task.fecha_vencimiento === day) : group ? scoped.filter((task) => groupName(task) === group) : filter === "all" ? ordered : filter === "late" ? late : filter === "today" ? dueToday : filter === "reviews" ? reviews : records.filter((task) => taskStage(task) === filter);
  const visible = orderTasks(filtered, today);
  const feedback = pendingFeedback(notes, user, team);
  const permanent = pendingFeedback(notes, user, team, true);
  let cursor = 0;
  const gradient = charts.stages.filter((stage) => stage.count).map((stage) => { const start = cursor; cursor += stage.count / charts.total * 100; return `${stage.color} ${start}% ${cursor}%`; }).join(",");
  const agendaMax = Math.max(1, ...charts.agenda.map((entry) => entry.count));
  const loadMax = Math.max(1, ...charts.loads.map((entry) => entry.count));
  const title = day ? `Entregas del ${formatDate(day)}` : group || ({ all: "Qué hacer primero", late: "Entregas vencidas", today: "Entregas de hoy", reviews: team ? "Para revisar" : "Esperando revisión" }[filter] || charts.stages.find((stage) => stage.id === filter)?.label);
  return <main className="quick-home" aria-label="Mi trabajo en Render"><div className="quick-home-shell">
    <header className="quick-home-header"><div><span className="qh-eyebrow">CENTRO DE PRODUCCIÓN · {formatDate(today)}</span><h1>Inicio</h1><p>Hola, {String(user?.nombre || user?.usuario || "equipo").split(" ")[0]}. Tu trabajo, de un vistazo.</p></div><div className="qh-header-actions">{isAdmin && <div className="qh-scope" aria-label="Alcance del inicio">{[["mine", "Mi trabajo"], ["team", "Equipo"]].map(([value, label]) => <button type="button" key={value} aria-pressed={scope === value} onClick={() => { setScope(value); select("all"); }}>{label}</button>)}</div>}<button className="qh-refresh" type="button" disabled={loading} onClick={() => setReload((value) => value + 1)}>{loading ? "Cargando…" : "Actualizar"}</button></div></header>
    {loading ? <div className="qh-state" role="status">Cargando tareas y feedback…</div> : error ? <div className="qh-state" role="alert"><p>{error}</p><button onClick={() => setReload((value) => value + 1)}>Volver a intentar</button></div> : <div className="qh-dashboard" key={`${scope}-${reload}`}>
      <section className="qh-summary" aria-label="Resumen de tareas">{[["all", "Por hacer", ordered.length, "Prioridades disponibles"], ["late", "Vencidas", late.length, "Necesitan atención"], ["today", "Hoy", dueToday.length, "Entregas del día"], ["reviews", "Revisiones", reviews.length, team ? "Por aprobar" : "Esperando aprobación"]].map(([value, label, count, caption]) => <button type="button" key={value} aria-pressed={filter === value && !day && !group} onClick={() => select(value)} className={value === "late" ? "qh-metric-late" : ""}><span>{label}<span aria-hidden="true">↗</span></span><strong>{count}</strong><small>{caption}</small></button>)}</section>
      <div className="qh-chart-grid"><section className="qh-panel"><header className="qh-section-head"><div><span className="qh-eyebrow">PANORAMA</span><h2>Estado del trabajo</h2></div><span className="qh-chip">{team ? "Equipo" : "Mi trabajo"}</span></header><div className="qh-distribution"><div className="qh-donut" role="img" aria-label={charts.stages.map((stage) => `${stage.label}: ${stage.count}`).join(", ")} style={{ background: gradient ? `conic-gradient(${gradient})` : "var(--render-line)" }}><div><strong>{charts.total}</strong><small>registradas</small></div></div><div className="qh-legend">{charts.stages.filter((stage) => stage.count || stage.id !== "other").map((stage) => <button type="button" key={stage.id} aria-pressed={filter === stage.id && !day && !group} onClick={() => select(stage.id)}><i style={{ background: stage.color }} /><span>{stage.label}</span><strong>{stage.count}</strong></button>)}</div></div><p className="qh-footnote">Estado actual de los registros, no cumplimiento mensual. Seleccioná un estado para ver sus tareas.</p></section>
      <section className="qh-panel"><header className="qh-section-head"><div><span className="qh-eyebrow">EN AGENDA</span><h2>Próximos 7 días</h2></div><span className="qh-chip">{charts.agenda.reduce((sum, entry) => sum + entry.count, 0)} entregas</span></header><div className="qh-agenda">{charts.agenda.map((entry, index) => <button type="button" key={entry.date} aria-label={`${formatDate(entry.date)}: ${entry.count} entregas`} aria-pressed={day === entry.date} onClick={() => { select("all"); setDay(entry.date); }}><strong>{entry.count}</strong><div className="qh-bar-track"><span style={{ height: `${Math.max(3, entry.count / agendaMax * 100)}%`, animationDelay: `${index * 45}ms` }} /></div><small>{index === 0 ? "Hoy" : new Intl.DateTimeFormat("es-AR", { weekday: "short", timeZone: "America/Argentina/Cordoba" }).format(new Date(`${entry.date}T12:00:00-03:00`))}</small><span>{entry.date.slice(8)}</span></button>)}</div><p className="qh-footnote">{formatDate(today)} — {formatDate(charts.agenda[6].date)} · {scoped.filter((task) => !task.fecha_vencimiento).length} abiertas sin fecha.</p></section></div>
      <div className="qh-work-grid"><section className="qh-panel"><header className="qh-section-head"><div><span className="qh-eyebrow">SIGUIENTE PASO</span><h2>{title}</h2><p>Tres tareas a la vista. Abrí una para continuar.</p></div>{filter !== "all" || day || group ? <button type="button" className="qh-reset" onClick={() => select("all")}>Ver prioridades</button> : link("/workspace/tareas", "Ver tablero ↗")}</header><div className="qh-action-grid">{visible.slice(0, 3).map((task, index) => { const priority = priorityForTask(task, today); return link(`/workspace/tareas?task=${encodeURIComponent(task.id)}`, <><div className="qh-action-top"><span>{task.cliente_nombre || "Sin cliente"}</span><small>0{index + 1}</small></div><h3>{task.titulo || "Sin título"}</h3><p>{taskPeople(task).join(", ") || "Sin responsable"}</p><span className="qh-task-status">{taskStage(task) === "ready" ? "Lista para publicar" : STATUSES.find((status) => status.id === task.estado)?.label || task.estado}</span><div className="qh-action-bottom"><span className={`qh-badge qh-tone-${priority.tone}`}>{taskStage(task) === "done" ? "Finalizada" : priority.label}</span><span aria-hidden="true">↗</span></div></>, "qh-action-card"); })}</div>{!visible.length && <p className="qh-empty">No hay tareas en esta selección. Podés consultar el tablero o elegir otro estado.</p>}<footer className="qh-panel-footer"><span>{Math.min(3, visible.length)} de {visible.length} tareas en esta vista</span>{link("/workspace/tareas", "Abrir tablero →")}</footer></section>
      <section className="qh-panel qh-feedback"><header className="qh-section-head"><div><span className="qh-eyebrow">DEVOLUCIONES</span><h2>Feedback pendiente</h2></div><span className="qh-chip">{notesError ? "—" : feedback.length}</span></header>{notesError ? <p role="alert">{notesError}</p> : <>{feedback.slice(0, 3).map((note) => link(`/feedback?section=${note.feedback?.cliente ? "clients" : "team"}&note=${encodeURIComponent(note.id)}`, <><strong>{note.titulo || "Sin título"}</strong><small>{note.feedback?.cliente || "Equipo"} · {formatDate(note.updated_at)}</small><span aria-hidden="true">↗</span></>, "qh-feedback-item"))}{!feedback.length && <p className="qh-empty">Sin devoluciones pendientes {team ? "en las notas consultadas" : "asignadas a vos"}.</p>}{permanent.length > 0 && <details className="qh-permanent"><summary>Indicaciones permanentes ({permanent.length})</summary>{permanent.slice(0, 2).map((note) => link(`/feedback?note=${encodeURIComponent(note.id)}`, note.titulo || "Sin título"))}</details>}</>}<footer className="qh-panel-footer"><span title="Se consultan las 500 notas más recientes">Notas recientes</span>{link("/feedback", "Abrir feedback →")}</footer></section></div>
      <section className="qh-panel qh-load-panel"><header className="qh-section-head"><div><span className="qh-eyebrow">DISTRIBUCIÓN</span><h2>{team ? "Carga por responsable" : "Trabajo por cliente"}</h2></div><p>Tareas abiertas · {team ? "responsable principal" : "asignadas o compartidas con vos"}</p></header><div className="qh-load-grid">{charts.loads.slice(0, 5).map((entry) => <button type="button" key={entry.name} aria-pressed={group === entry.name} onClick={() => { select("all"); setGroup(entry.name); }}><div><span className="qh-avatar">{entry.name.slice(0, 2).toUpperCase()}</span><strong>{entry.name}</strong><b>{entry.count}</b></div><span className="qh-load-track"><i style={{ width: `${entry.count / loadMax * 100}%` }} /></span><small>{entry.late ? `${entry.late} vencidas` : "Sin entregas vencidas"}</small></button>)}</div>{!charts.loads.length && <p className="qh-empty">No hay tareas abiertas para distribuir.</p>}<p className="qh-footnote">{charts.loads.length > 5 ? `Los 5 grupos con más tareas, de ${charts.loads.length}. ` : ""}Cada tarea se cuenta una sola vez. Seleccioná un grupo para ver su trabajo.</p></section>
    </div>}
    <nav className="quick-home-grid" aria-label="Áreas de trabajo">{[["/workspace/tareas", "Tablero"], ["/lista", "Mi lista"], ["/moodboards", "Moodboards"], ["/feedback", "Feedback"], ["/planificacion-publicaciones", "Publicaciones"]].map(([href, label]) => link(href, <>{label}<span aria-hidden="true">↗</span></>, "qh-area"))}</nav>
  </div></main>;
}
