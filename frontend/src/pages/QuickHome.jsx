import React, { useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "../features/render-os/services/render-os-api.js";
import { HomeEscalations } from "../components/HomeEscalations.jsx";
import { HomeMonthlyProgress } from "../components/HomeMonthlyProgress.jsx";
import { HomeTeamWorkload } from "../components/HomeTeamWorkload.jsx";
import { createPersonalHomeLoader, homeDate, homeDeadline, homeStateLabel, personalHomeNavigate, subscribePersonalHomeRefresh } from "./personalHome.js";
import "./QuickHome.css";

const WORK_AREAS = [
  { href: "/workspace/tareas", title: "Tareas" },
  { href: "/proyectos", title: "Proyectos" },
  { href: "/lista", title: "Mi lista" },
  { href: "/producciones", title: "Producciones" },
  { href: "/moodboards", title: "Moodboard" },
  { href: "/feedback", title: "Feedback" },
  { href: "/planificacion-publicaciones", title: "Publicaciones" },
];
const SUMMARY = [
  ["open", "Abiertas"], ["overdue", "Vencidas"], ["today", "Para hoy"],
  ["upcoming", "Próximos 7 días"], ["undated", "Sin fecha"], ["awaiting_review", "En revisión"],
];
function ListCount({ shown, total }) {
  return <span className="qh-list-count">{shown < total ? `Mostrando ${shown} de ${total}` : `${total} en total`}</span>;
}
function HomeLink({ href, onNavigate, children, ...props }) {
  return <a href={href} onClick={(event) => personalHomeNavigate(event, href, onNavigate)} {...props}>{children}</a>;
}
function TaskRows({ items, today, onNavigate }) {
  return <ol className="qh-task-list">{items.map((task) => {
    const overdue = task.fecha_vencimiento && task.fecha_vencimiento < today;
    const priority = ({ alta: "Alta", media: "Media", baja: "Baja" })[task.prioridad] || task.prioridad;
    return <li key={task.id}>
      <HomeLink href={task.href} onNavigate={onNavigate} className="qh-task-row">
        <span className="qh-row-main"><strong>{task.titulo}</strong>
          <span className="qh-row-meta">{task.cliente?.nombre || "Sin cliente"}<span aria-hidden="true"> · </span>{homeStateLabel(task.estado)}<span aria-hidden="true"> · </span>Prioridad {priority.toLowerCase()}</span>
        </span>
        <span className={`qh-deadline${overdue ? " is-overdue" : ""}`}>{homeDeadline(task.fecha_vencimiento, today)}</span>
        <span className="qh-row-arrow" aria-hidden="true">↗</span>
      </HomeLink>
    </li>;
  })}</ol>;
}

export function QuickHomePage({ sesion, onNavigate, request = apiRequest }) {
  const userId = sesion?.usuario?.id;
  const role = sesion?.usuario?.rol;
  const active = sesion?.usuario?.activo;
  const sessionToken = sesion?.token;
  const identity = useMemo(() => ({ id: userId, role, active, token: sessionToken }), [userId, role, active, sessionToken]);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const [result, setResult] = useState(null);
  const loaderRef = useRef(null);
  const validIdentity = Number.isSafeInteger(userId) && userId > 0 && active !== false;
  const current = result?.identity === identity ? result : null;
  const data = validIdentity ? current?.data : null;
  const loading = validIdentity && (!current || current.status === "loading");
  const error = validIdentity ? current?.error : "Necesitás una sesión válida para consultar tu inicio.";

  useEffect(() => {
    if (!validIdentity) return undefined;
    const loader = createPersonalHomeLoader({
      request, userId, allowTeamReview: role === "admin",
      onChange: (state) => { if (identityRef.current === identity) setResult({ ...state, identity }); },
    });
    loaderRef.current = loader;
    void loader.refresh();
    const unsubscribe = subscribePersonalHomeRefresh(loader);
    return () => {
      unsubscribe();
      loader.dispose();
      if (loaderRef.current === loader) loaderRef.current = null;
    };
  }, [identity, request, validIdentity, userId, role]);

  const refresh = () => { void loaderRef.current?.refresh(); };
  const firstName = data?.user.nombre.trim().split(/\s+/)[0];
  return <main className="quick-home" aria-label="Inicio personal de Render">
    <div className="quick-home-shell">
      <header className="quick-home-header">
        <div><span className="qh-eyebrow">Mi trabajo</span><h1>{firstName ? `Hola, ${firstName}.` : "Tu inicio"}</h1>
          <p>{data ? homeDate(data.today, true) : "Tu trabajo asignado y los próximos pasos."}</p></div>
        <button type="button" className="qh-refresh" onClick={refresh} disabled={loading || !validIdentity}>
          <span aria-hidden="true">↻</span> Actualizar
        </button>
      </header>

      {loading && <div className="qh-status" role="status">Cargando tu trabajo…</div>}
      {error && <div className="qh-error" role="alert"><p>{error}</p>
        {validIdentity && <button type="button" onClick={refresh}>Reintentar</button>}
      </div>}

      {data && <>
        <dl className="qh-summary" aria-label="Resumen de tus tareas">
          {SUMMARY.map(([key, label]) => <div key={key} className={key === "overdue" && data.summary[key] ? "is-overdue" : ""}>
            <dt>{label}</dt><dd>{data.summary[key]}</dd>
          </div>)}
        </dl>
        <div className="qh-columns">
          <div className="qh-primary-column">
            <HomeEscalations sesion={sesion} onNavigate={onNavigate} request={request}/>
            <HomeTeamWorkload sesion={sesion} onNavigate={onNavigate} request={request}/>
            <section className="qh-section" aria-labelledby="qh-work-title">
              <header className="qh-section-heading"><div><h2 id="qh-work-title">Tu próximo trabajo</h2><p>Primero lo vencido, después lo que sigue.</p></div>
                <ListCount shown={data.tasks.length} total={data.summary.open}/></header>
              {data.tasks.length ? <TaskRows items={data.tasks} today={data.today} onNavigate={onNavigate}/> :
                <p className="qh-empty">No tenés tareas abiertas asignadas.</p>}
              <HomeLink className="qh-section-link" href="/workspace/tareas" onNavigate={onNavigate}>Abrir tablero de tareas <span aria-hidden="true">→</span></HomeLink>
            </section>

            <section className="qh-section" aria-labelledby="qh-review-title">
              <header className="qh-section-heading"><div><h2 id="qh-review-title">{data.review.scope === "team" ? "Revisión del equipo" : "Tu trabajo en revisión"}</h2>
                <p>{data.review.scope === "team" ? "Cola del equipo, separada de tus tareas asignadas." : "Tareas asignadas que esperan revisión."}</p></div>
                <ListCount shown={data.review.items.length} total={data.review.total}/></header>
              {data.review.items.length ? <TaskRows items={data.review.items} today={data.today} onNavigate={onNavigate}/> :
                <p className="qh-empty">No hay tareas en revisión.</p>}
            </section>
          </div>

          <aside className="qh-secondary-column" aria-label="Contexto de tu trabajo">
            <HomeMonthlyProgress data={data.monthly_progress}/>
            {data.capabilities.projects && <section className="qh-section" aria-labelledby="qh-projects-title">
              <header className="qh-section-heading"><h2 id="qh-projects-title">Mis proyectos</h2><ListCount shown={data.projects.length} total={data.list_totals.projects}/></header>
              {data.projects.length ? <ul className="qh-compact-list">{data.projects.map(project => <li key={project.id}>
                <HomeLink href={project.href} onNavigate={onNavigate} className="qh-compact-row">
                  <span><strong>{project.titulo}</strong><small>{project.cliente.nombre} · {({planificado:'Planificado',en_curso:'En curso',en_revision:'En revisión',pausado:'Pausado'})[project.estado] || project.estado}</small></span>
                  <span aria-hidden="true">↗</span>
                </HomeLink>
              </li>)}</ul> : <p className="qh-empty">No tenés proyectos activos asignados.</p>}
              <HomeLink href="/proyectos" onNavigate={onNavigate} className="qh-section-link">Ver proyectos <span aria-hidden="true">→</span></HomeLink>
            </section>}
            <section className="qh-section" aria-labelledby="qh-visits-title">
              <header className="qh-section-heading"><h2 id="qh-visits-title">Próximas visitas</h2><ListCount shown={data.visits.length} total={data.list_totals.visits}/></header>
              <p className="qh-section-description">Hoy y los próximos 7 días.</p>
              {data.visits.length ? <ul className="qh-compact-list">{data.visits.map((visit) => <li key={visit.id}>
                <HomeLink href={visit.href} onNavigate={onNavigate} className="qh-compact-row">
                  <time dateTime={visit.fecha}>{homeDate(visit.fecha)}</time>
                  <span><strong>{visit.titulo}</strong><small>{visit.cliente.nombre}</small></span><span aria-hidden="true">↗</span>
                </HomeLink>
              </li>)}</ul> : <p className="qh-empty">No tenés visitas vinculadas en estos días.</p>}
            </section>

            <section className="qh-section" aria-labelledby="qh-clients-title">
              <header className="qh-section-heading"><h2 id="qh-clients-title">Clientes en tu trabajo</h2><ListCount shown={data.clients.length} total={data.list_totals.clients}/></header>
              {data.clients.length ? <ul className="qh-client-list">{data.clients.map((client) => <li key={client.id}><span>{client.nombre}</span><span>{client.open} {client.open === 1 ? "abierta" : "abiertas"}</span></li>)}</ul> :
                <p className="qh-empty">Sin clientes con tareas abiertas asignadas.</p>}
            </section>

            <section className="qh-section" aria-labelledby="qh-activity-title">
              <header className="qh-section-heading"><h2 id="qh-activity-title">Tareas actualizadas</h2><ListCount shown={data.activity.length} total={data.list_totals.activity}/></header>
              {data.activity.length ? <ul className="qh-compact-list">{data.activity.map((item) => <li key={item.task_id}>
                <HomeLink href={item.href} onNavigate={onNavigate} className="qh-compact-row">
                  <span><strong>{item.titulo}</strong><small>{homeStateLabel(item.estado)}</small></span>
                  <time dateTime={item.updated_at}>{new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Cordoba", day: "numeric", month: "short" }).format(new Date(item.updated_at))}</time>
                </HomeLink>
              </li>)}</ul> : <p className="qh-empty">Todavía no hay tareas actualizadas para mostrar.</p>}
            </section>
          </aside>
        </div>
        <p className="qh-updated">Última consulta <time dateTime={data.generated_at}>{new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Cordoba", hour: "2-digit", minute: "2-digit" }).format(new Date(data.generated_at))}</time></p>
      </>}

      <nav className="qh-shortcuts" aria-label="Accesos de trabajo">
        <span>Ir a</span>{WORK_AREAS.map((area) => <HomeLink href={area.href} key={area.href} onNavigate={onNavigate}>{area.title}<span aria-hidden="true">↗</span></HomeLink>)}
      </nav>
    </div>
  </main>;
}
