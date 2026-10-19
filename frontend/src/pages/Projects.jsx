import React, { useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "../features/render-os/services/render-os-api.js";
import { useNavigationGuard } from "../shared/navigation/useNavigationGuard.js";
import { navigateWithinApp } from "../shared/navigation/location.js";
import { PROJECT_TYPES, PROJECT_STATES, STAGE_STATES, MILESTONE_STATES, DELIVERABLE_STATES, PROJECT_ACTIVITY, buildProjectMutation, createProjectsTransport, observedProjectTask, parseProject, parseProjectsPage, projectDate, projectError, projectHref, projectLocation, projectLocationUrl, projectsListUrl, safeProjectUrl } from "./projectsModel.js";
import "./Projects.css";

const USER_ROLES = ["admin", "diseno", "edicion", "produccion", "community", "programacion"];
const TASK_STATES = { pendiente: "Pendiente", en_progreso: "En progreso", en_revision: "En revisión", aprobada: "Aprobada", finalizada: "Finalizada", publicada: "Finalizada" };
const FORM_TITLES = { create: "Nuevo proyecto", project: "Editar proyecto", archive: "Cambiar archivo", order: "Ordenar etapas", "stage-create": "Nueva etapa", "stage-edit": "Editar etapa", "milestone-create": "Nuevo hito", "milestone-edit": "Editar hito", "deliverable-create": "Nuevo entregable", "deliverable-edit": "Editar entregable", "task-link": "Vincular tarea existente", "task-unlink": "Desvincular tarea" };
const states = { ...PROJECT_STATES, ...STAGE_STATES, ...MILESTONE_STATES, ...DELIVERABLE_STATES };
const plainClick = event => !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
function Options({ values }) { return Object.entries(values).map(([value, label]) => <option value={value} key={value}>{label}</option>); }
function StageSelect({ value, project, onChange }) { return <label>Etapa<select value={value || ""} onChange={event => onChange(event.target.value)}><option value="">Sin etapa</option>{project.etapas.map(stage => <option key={stage.id} value={stage.id}>{stage.titulo}</option>)}</select></label>; }
function DateInput({ label, value, onChange }) { return <label>{label}<input type="date" value={value || ""} onChange={event => onChange(event.target.value)}/></label>; }
function TitleInput({ value, onChange }) { return <label className="pr-wide">Título<input required maxLength={250} value={value} onChange={event => onChange(event.target.value)}/></label>; }
function dateTime(value) { return new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Cordoba", dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }

function initialForm(kind, project, item) {
  if (kind === "create") return { titulo: "", tipo: "web", descripcion: "", cliente_id: "", responsable_id: "", miembro_ids: [], fecha_inicio: "", fecha_entrega: "" };
  if (kind === "project") return { titulo: project.titulo, tipo: project.tipo, descripcion: project.descripcion, estado: project.estado, cliente_id: project.cliente.id, responsable_id: project.responsable.id, miembro_ids: [...project.miembro_ids], fecha_inicio: project.fecha_inicio || "", fecha_entrega: project.fecha_entrega || "" };
  if (kind === "archive") return { archivado: !project.archivado };
  if (kind === "order") return { etapa_ids: project.etapas.map(stage => stage.id) };
  if (kind.startsWith("stage-")) return { titulo: item?.titulo || "", estado: item?.estado || "pendiente" };
  if (kind.startsWith("milestone-")) return { titulo: item?.titulo || "", fecha: item?.fecha || "", estado: item?.estado || "pendiente", etapa_id: item?.etapa_id || "" };
  if (kind.startsWith("deliverable-")) return { titulo: item?.titulo || "", url: item?.url || "", observaciones: item?.observaciones || "", estado: item?.estado || "pendiente" };
  return kind === "task-link" ? { tarea_id: "", etapa_id: "" } : {};
}

function ProjectFields({ form, project, catalog, change, retryCatalog }) {
  const d = form.draft, creating = form.kind === "create", admin = creating || form.admin;
  const inactiveIds = d.miembro_ids.filter(id => !catalog.users.some(user => user.id === id));
  return <>
    <TitleInput value={d.titulo} onChange={value => change("titulo", value)}/>
    <label>Tipo<select value={d.tipo} onChange={event => change("tipo", event.target.value)}><Options values={PROJECT_TYPES}/></select></label>
    {!creating && <label>Estado del proyecto<select value={d.estado} onChange={event => change("estado", event.target.value)}><Options values={PROJECT_STATES}/></select></label>}
    <DateInput label="Fecha de inicio" value={d.fecha_inicio} onChange={value => change("fecha_inicio", value)}/>
    <DateInput label="Fecha de entrega" value={d.fecha_entrega} onChange={value => change("fecha_entrega", value)}/>
    <label className="pr-wide">Descripción<textarea maxLength={20000} rows={4} value={d.descripcion} onChange={event => change("descripcion", event.target.value)}/></label>
    {admin && <>
      {catalog.status === "loading" && <p className="pr-muted pr-wide" role="status">Cargando clientes y personas…</p>}
      {catalog.error && <div className="pr-error pr-wide" role="alert">{catalog.error}<button type="button" onClick={retryCatalog}>Reintentar catálogos</button></div>}
      <label>Cliente<select required value={d.cliente_id} disabled={catalog.status !== "ready" || (!creating && project.counts.tareas > 0)} onChange={event => change("cliente_id", event.target.value)}>
        <option value="">Elegir cliente activo</option>
        {!creating && !catalog.clients.some(client => String(client.id) === String(d.cliente_id)) && <option value={project.cliente.id}>{project.cliente.nombre} (actual)</option>}
        {catalog.clients.map(client => <option key={client.id} value={client.id}>{client.nombre} · ID {client.id}</option>)}
      </select>{!creating && project.counts.tareas > 0 && <small>El cliente no se cambia mientras haya tareas vinculadas.</small>}</label>
      <label>Responsable<select required value={d.responsable_id} disabled={catalog.status !== "ready"} onChange={event => change("responsable_id", event.target.value)}>
        <option value="">Elegir persona activa</option>
        {!creating && !catalog.users.some(user => String(user.id) === String(d.responsable_id)) && <option value={project.responsable.id}>{project.responsable.nombre} · ID {project.responsable.id} (actual)</option>}
        {catalog.users.map(user => <option key={user.id} value={user.id}>{user.nombre} · {user.usuario || `ID ${user.id}`} · ID {user.id}</option>)}
      </select></label>
      <fieldset className="pr-members pr-wide"><legend>Miembros</legend><small>Ser miembro no concede permisos de edición del proyecto.</small>
        {catalog.status === "ready" && !catalog.users.length && <p>No hay personas activas disponibles.</p>}
        {catalog.users.map(user => <label key={user.id}><input type="checkbox" checked={d.miembro_ids.includes(user.id)} disabled={catalog.status !== "ready"} onChange={event => change("miembro_ids", event.target.checked ? [...d.miembro_ids, user.id] : d.miembro_ids.filter(id => id !== user.id))}/>{user.nombre} · ID {user.id}</label>)}
        {inactiveIds.map(id => <label key={id}><input type="checkbox" checked onChange={() => change("miembro_ids", d.miembro_ids.filter(value => value !== id))}/>Usuario ID {id} (actual; retirar)</label>)}
      </fieldset>
    </>}
  </>;
}

function ProjectEditor({ form, project, catalog, change, cancel, submit, refresh, adoptRevision, lookupTask, retryCatalog, moveStage }) {
  const d = form.draft, kind = form.kind;
  const structural = kind !== "create";
  const allowed = !structural || (kind === "archive" ? project?.permissions.administrar : project?.permissions.editar && !project?.archivado);
  const needsCatalog = kind === "create" || (kind === "project" && form.admin);
  return <section className="pr-editor" aria-labelledby="pr-editor-title">
    <header className="pr-section-heading"><h2 id="pr-editor-title">{FORM_TITLES[kind]}</h2><button type="button" onClick={cancel} disabled={form.busy}>Cerrar formulario</button></header>
    {structural && <p className="pr-version">Base observada: revisión <strong>{form.baseRevision}</strong>{project && project.revision !== form.baseRevision && <> · Proyecto visible: revisión <strong>{project.revision}</strong></>}</p>}
    {form.error && <div className="pr-error" role="alert"><p>{form.error}</p>
      {form.conflict && structural && <div className="pr-actions"><button type="button" onClick={refresh} disabled={form.busy}>Actualizar proyecto y revisar</button>
        {form.reviewed && project && <button type="button" onClick={adoptRevision}>Usar revisión {project.revision}</button>}</div>}
      {form.conflict && !structural && <p>Revisá la lista antes de cerrar este formulario e iniciar una creación diferente. Este intento conserva su identificador.</p>}
    </div>}
    {!allowed && <p className="pr-notice">No tenés permiso actual para guardar este formulario. Tus datos siguen acá.</p>}
    <form className="pr-form" onSubmit={submit}>
      {(kind === "create" || kind === "project") && <ProjectFields {...{ form, project, catalog, change, retryCatalog }}/>}
      {kind === "archive" && <p className="pr-wide">{d.archivado ? "Archivar oculta el proyecto del listado habitual y bloquea sus cambios. No borra tareas ni historial." : "Reactivar permite volver a trabajar en el proyecto."}</p>}
      {kind.startsWith("stage-") && <><TitleInput value={d.titulo} onChange={value => change("titulo", value)}/>{kind === "stage-edit" && <label>Estado<select value={d.estado} onChange={event => change("estado", event.target.value)}><Options values={STAGE_STATES}/></select></label>}</>}
      {kind.startsWith("milestone-") && <><TitleInput value={d.titulo} onChange={value => change("titulo", value)}/><DateInput label="Fecha del hito" value={d.fecha} onChange={value => change("fecha", value)}/><StageSelect value={d.etapa_id} project={project} onChange={value => change("etapa_id", value)}/><label>Estado<select value={d.estado} onChange={event => change("estado", event.target.value)}><Options values={MILESTONE_STATES}/></select></label></>}
      {kind.startsWith("deliverable-") && <><TitleInput value={d.titulo} onChange={value => change("titulo", value)}/><label className="pr-wide">Enlace de entrega<input type="url" value={d.url} onChange={event => change("url", event.target.value)} placeholder="https://"/></label>
        <label className="pr-wide">Observaciones<textarea rows={3} maxLength={20000} value={d.observaciones} onChange={event => change("observaciones", event.target.value)}/></label>
        <label>Estado<select value={d.estado} onChange={event => change("estado", event.target.value)}><Options values={DELIVERABLE_STATES}/></select></label>
        {d.estado === "aprobado" && <p className="pr-muted pr-wide">Al guardar se registra quién aprueba y cuándo. Cambiar después el estado conserva esa transición en la actividad.</p>}
      </>}
      {kind === "order" && <ol className="pr-order pr-wide">{d.etapa_ids.map((id, index) => <li key={id}><span>{project.etapas.find(stage => stage.id === id)?.titulo || `Etapa ${id}`}</span><button type="button" aria-label={`Subir etapa ${index + 1}`} disabled={index === 0 || form.busy} onClick={() => moveStage(index, -1)}>↑</button><button type="button" aria-label={`Bajar etapa ${index + 1}`} disabled={index === d.etapa_ids.length - 1 || form.busy} onClick={() => moveStage(index, 1)}>↓</button></li>)}</ol>}
      {kind === "task-link" && <>
        <label>ID de la tarea existente<input inputMode="numeric" pattern="[1-9][0-9]*" required value={d.tarea_id} onChange={event => change("tarea_id", event.target.value)}/></label>
        <button type="button" className="pr-field-action" onClick={lookupTask} disabled={form.lookupBusy || form.busy}>{form.lookupBusy ? "Consultando…" : "Consultar tarea"}</button>
        <StageSelect value={d.etapa_id} project={project} onChange={value => change("etapa_id", value)}/>
        {form.observedTask && <div className="pr-observed pr-wide"><a href={form.observedTask.href} target="_blank" rel="noopener noreferrer">{form.observedTask.titulo} ↗</a><p>ID {form.observedTask.id} · Revisión observada {form.observedTask.revision}</p></div>}
        <p className="pr-muted pr-wide">Se vincula la tarea real, no se copia ni se crea otra. Consultala de nuevo solo para revisar explícitamente una versión más reciente.</p>
      </>}
      {kind === "task-unlink" && <p className="pr-wide">Se quitará el vínculo con “{form.itemTitle}”. La tarea seguirá existiendo con su historial y permisos.</p>}
      <footer className="pr-actions pr-wide"><button type="button" onClick={cancel} disabled={form.busy}>Cancelar</button><button type="submit" className="pr-primary" disabled={form.busy || form.conflict || !allowed || (needsCatalog && catalog.status !== "ready") || (kind === "task-link" && !form.observedTask)}>{form.busy ? "Guardando…" : kind === "create" ? "Crear proyecto" : kind === "archive" ? d.archivado ? "Archivar proyecto" : "Reactivar proyecto" : kind === "task-link" ? "Vincular tarea" : kind === "task-unlink" ? "Quitar vínculo" : "Guardar cambios"}</button></footer>
    </form>
  </section>;
}

function Detail({ project, openForm, openTask }) {
  const edit = project.permissions.editar && !project.archivado;
  const stageName = id => project.etapas.find(stage => stage.id === id)?.titulo || "Sin etapa";
  const resourceName = id => [...project.entregables, ...project.hitos, ...project.etapas].find(item => item.id === id)?.titulo;
  return <>
    <header className="pr-detail-header"><div><span className="pr-kicker">{PROJECT_TYPES[project.tipo]} · {PROJECT_STATES[project.estado]}{project.archivado ? " · Archivado" : ""}</span><h2>{project.titulo}</h2><p>{project.cliente.nombre} · Responsable: {project.responsable.nombre} · ID {project.responsable.id}</p></div>
      <div className="pr-actions">{edit && <button type="button" onClick={() => openForm("project")}>Editar proyecto</button>}{project.permissions.administrar && <button type="button" onClick={() => openForm("archive")}>{project.archivado ? "Reactivar" : "Archivar"}</button>}</div></header>
    <dl className="pr-facts"><div><dt>Inicio</dt><dd>{projectDate(project.fecha_inicio)}</dd></div><div><dt>Entrega</dt><dd>{projectDate(project.fecha_entrega)}</dd></div><div><dt>Tareas finalizadas</dt><dd>{project.counts.finalizadas} de {project.counts.tareas}</dd></div><div><dt>Revisión del proyecto</dt><dd>{project.revision}</dd></div></dl>
    {project.descripcion && <p className="pr-description">{project.descripcion}</p>}
    <p className="pr-members-summary">Miembros: {project.miembro_ids.length ? project.miembro_ids.map(id => `ID ${id}`).join(", ") : "sin miembros adicionales"}. El estado del proyecto se gestiona por separado de sus tareas.</p>

    <section className="pr-section" aria-labelledby="pr-stages-title"><header className="pr-section-heading"><h3 id="pr-stages-title">Etapas</h3>{edit && <div className="pr-actions">{project.etapas.length > 1 && <button type="button" onClick={() => openForm("order")}>Ordenar</button>}<button type="button" onClick={() => openForm("stage-create")}>Agregar etapa</button></div>}</header>
      {project.etapas.length ? <ol className="pr-stages">{project.etapas.map(stage => <li key={stage.id}><span className={`pr-stage-dot is-${stage.estado}`} aria-hidden="true"/><span><strong>{stage.titulo}</strong><small>{STAGE_STATES[stage.estado]}</small></span>{edit && <button type="button" onClick={() => openForm("stage-edit", stage)}>Editar<span className="pr-sr-only"> etapa {stage.titulo}</span></button>}</li>)}</ol> : <p className="pr-empty">Todavía no hay etapas.</p>}</section>

    <section className="pr-section" aria-labelledby="pr-milestones-title"><header className="pr-section-heading"><h3 id="pr-milestones-title">Hitos</h3>{edit && <button type="button" onClick={() => openForm("milestone-create")}>Agregar hito</button>}</header>
      {project.hitos.length ? <ul className="pr-items">{project.hitos.map(item => <li key={item.id}><div><strong>{item.titulo}</strong><small>{MILESTONE_STATES[item.estado]} · {projectDate(item.fecha)} · {stageName(item.etapa_id)}</small></div>{edit && <button type="button" onClick={() => openForm("milestone-edit", item)}>Editar<span className="pr-sr-only"> hito {item.titulo}</span></button>}</li>)}</ul> : <p className="pr-empty">Todavía no hay hitos.</p>}</section>

    <section className="pr-section" aria-labelledby="pr-deliverables-title"><header className="pr-section-heading"><h3 id="pr-deliverables-title">Entregables</h3>{edit && <button type="button" onClick={() => openForm("deliverable-create")}>Agregar entregable</button>}</header>
      {project.entregables.length ? <ul className="pr-items">{project.entregables.map(item => <li key={item.id}><div><strong>{item.titulo}</strong><small>{DELIVERABLE_STATES[item.estado]}</small>{safeProjectUrl(item.url) && <a href={safeProjectUrl(item.url)} target="_blank" rel="noopener noreferrer">Abrir entrega ↗</a>}{item.observaciones && <p className="pr-description">{item.observaciones}</p>}{item.aprobado_por_id && <small>Aprobado por usuario ID {item.aprobado_por_id} · {dateTime(item.aprobado_at)}</small>}</div>{edit && <button type="button" onClick={() => openForm("deliverable-edit", item)}>Editar<span className="pr-sr-only"> entregable {item.titulo}</span></button>}</li>)}</ul> : <p className="pr-empty">Todavía no hay entregables.</p>}</section>

    <section className="pr-section" aria-labelledby="pr-tasks-title"><header className="pr-section-heading"><h3 id="pr-tasks-title">Tareas vinculadas <span className="pr-muted">({project.counts.tareas})</span></h3>{edit && <button type="button" onClick={() => openForm("task-link")}>Vincular existente</button>}</header>
      {project.tareas.length ? <ul className="pr-items">{project.tareas.map(item => <li key={item.id}><div><a href={item.href} onClick={event => openTask(event, item.href)}>{item.titulo} ↗</a><small>{TASK_STATES[item.estado] || item.estado} · {projectDate(item.fecha_vencimiento)} · {stageName(item.etapa_id)} · Revisión {item.revision}</small></div>{edit && <button type="button" onClick={() => openForm("task-unlink", item)}>Quitar vínculo<span className="pr-sr-only"> con {item.titulo}</span></button>}</li>)}</ul> : <p className="pr-empty">No hay tareas visibles vinculadas.</p>}
      {project.tareas_no_disponibles > 0 && <p className="pr-notice">{project.tareas_no_disponibles} {project.tareas_no_disponibles === 1 ? "tarea no disponible. Sus datos no se muestran." : "tareas no disponibles. Sus datos no se muestran."}</p>}
      <p className="pr-section-note">Las tareas se trabajan en su tablero. Vincular no cambia sus permisos, estado ni fechas.</p>
    </section>

    <details className="pr-section pr-activity"><summary>Actividad del proyecto · últimas {project.actividad.length}</summary>{project.actividad.length ? <ol>{project.actividad.map(item => <li key={item.id}><strong>{PROJECT_ACTIVITY[item.accion]}</strong><small>Usuario ID {item.actor_id} · {dateTime(item.created_at)}</small>{item.recurso_id && <span title={item.recurso_id}>Recurso: {resourceName(item.recurso_id) || item.recurso_id}</span>}{item.tarea_id && <span>Tarea ID {item.tarea_id}</span>}{(item.estado_anterior || item.estado_nuevo) && <span>{item.estado_anterior ? states[item.estado_anterior] : "Sin estado previo"} → {item.estado_nuevo ? states[item.estado_nuevo] : "Sin estado posterior"}</span>}</li>)}</ol> : <p className="pr-empty">Sin actividad para mostrar.</p>}</details>
  </>;
}

export function ProjectsPage({ sesion, onNavigate, request = apiRequest }) {
  const user = sesion?.usuario;
  if (!Number.isSafeInteger(user?.id) || user.id <= 0 || user.activo === false) return <main className="projects-page"><p role="alert">Necesitás una sesión válida para consultar Proyectos.</p></main>;
  // A session change remounts all local state before rendering another identity.
  return <ProjectsSession key={JSON.stringify([user.id, user.rol, user.activo, sesion.token])} {...{ sesion, onNavigate, request }}/>;
}

function ProjectsSession({ sesion, onNavigate, request }) {
  const admin = sesion.usuario.rol === "admin";
  const transportRef = useRef(null);
  useEffect(() => {
    const client = createProjectsTransport(request);
    transportRef.current = client;
    return () => { client.dispose(); if (transportRef.current === client) transportRef.current = null; };
  }, [request]);
  const transport = useMemo(() => ({
    read: (...args) => transportRef.current?.read(...args) || Promise.resolve(undefined),
    write: (...args) => transportRef.current?.write(...args) || Promise.resolve(undefined),
    cancel: key => transportRef.current?.cancel(key),
  }), [request]);
  const [selection, setSelection] = useState(() => projectLocation(window.location.href));
  const selectionRef = useRef(selection); selectionRef.current = selection;
  const [filters, setFilters] = useState({ offset: 0, estado: "", archivados: false });
  const [list, setList] = useState({ status: "loading", data: null, error: "" });
  const [detail, setDetail] = useState({ status: "idle", data: null, error: "" });
  const [catalog, setCatalog] = useState({ status: "idle", clients: [], users: [], error: "" });
  const [form, setForm] = useState(null);
  const formRef = useRef(form); formRef.current = form;
  const formSequence = useRef(0);
  const mutationBusy = useRef(false);
  const [listRefresh, setListRefresh] = useState(0);
  const [message, setMessage] = useState("");
  const project = detail.data?.id === selection.id ? detail.data : null;
  const dirty = form && JSON.stringify(form.draft) !== JSON.stringify(form.initial);

  useEffect(() => {
    let active = true;
    setList({ status: "loading", data: null, error: "" });
    transport.read("list", projectsListUrl(filters)).then(value => { if (active && value !== undefined) setList({ status: "ready", data: parseProjectsPage(value), error: "" }); })
      .catch(error => { if (active) setList({ status: "error", data: null, error: projectError(error) }); });
    return () => { active = false; transport.cancel("list"); };
  }, [transport, filters, listRefresh]);

  async function refreshDetail(review = false) {
    const id = selectionRef.current.id;
    if (!id) return;
    setDetail(current => ({ ...current, status: "loading", error: "" }));
    try {
      const value = await transport.read("detail", `/api/proyectos/${id}`);
      if (value === undefined || selectionRef.current.id !== id) return;
      const data = parseProject(value.proyecto, true);
      if (data.id !== id) throw new Error("Proyecto incompatible.");
      setDetail({ status: "ready", data, error: "" });
      if (review) setForm(current => current?.projectId === id ? { ...current, reviewed: true } : current);
    } catch (error) { if (selectionRef.current.id === id) setDetail({ status: "error", data: null, error: projectError(error) }); }
  }
  useEffect(() => {
    setDetail({ status: selection.id ? "loading" : "idle", data: null, error: "" });
    if (selection.id) void refreshDetail();
    return () => transport.cancel("detail");
  }, [selection.id, transport]);

  function canLeave() {
    const current = formRef.current;
    if (current?.busy || mutationBusy.current) return false;
    return !current || JSON.stringify(current.draft) === JSON.stringify(current.initial) || window.confirm("Tenés cambios sin guardar. ¿Querés descartarlos?");
  }
  function navigationStatus(context = {}) {
    if (context.type !== "unload" && context.to) {
      const next = new URL(context.to, window.location.origin);
      const destination = next.origin === window.location.origin && next.pathname === "/proyectos" ? projectLocation(next.href) : null;
      // Same-project context changes do not replace the open form or its draft.
      if (destination && destination.id === selectionRef.current.id && !destination.invalid) return { dirty: false, busy: false };
    }
    const current = formRef.current;
    return { dirty: Boolean(current && JSON.stringify(current.draft) !== JSON.stringify(current.initial)),
      busy: Boolean(current?.busy || mutationBusy.current) };
  }
  useNavigationGuard(navigationStatus);
  function selectProject(id, replace = false) {
    const url = projectLocationUrl(window.location.href, id);
    window.history[replace ? "replaceState" : "pushState"](window.history.state, "", url);
    setForm(null); formRef.current = null; setMessage(""); setSelection({ id, invalid: false });
    selectionRef.current = { id, invalid: false };
  }
  useEffect(() => {
    const navigate = () => {
      if (window.location.pathname !== "/proyectos") return;
      const next = projectLocation(window.location.href);
      if (next.id === selectionRef.current.id && !next.invalid) return;
      // Shared navigation protection has already accepted any cancelable exit.
      // Unsupported/noncancelable traversals are restored normally, never trapped.
      setForm(null); formRef.current = null; setMessage(""); setSelection(next); selectionRef.current = next;
    };
    window.addEventListener("popstate", navigate);
    return () => { window.removeEventListener("popstate", navigate); };
  }, []);

  async function loadCatalog() {
    setCatalog(current => ({ ...current, status: "loading", error: "" }));
    try {
      const [clients, users] = await Promise.all([transport.read("clients", "/api/clientes"), transport.read("users", "/api/usuarios")]);
      if (clients === undefined || users === undefined) return;
      if (!Array.isArray(clients) || !Array.isArray(users)) throw new Error("Catálogo inválido.");
      setCatalog({ status: "ready", clients: clients.filter(item => Number.isSafeInteger(item.id) && item.id > 0 && item.activo !== false), users: users.filter(item => Number.isSafeInteger(item.id) && item.id > 0 && item.activo === true && USER_ROLES.includes(item.rol)), error: "" });
    } catch (error) { setCatalog({ status: "error", clients: [], users: [], error: projectError(error) }); }
  }
  function openForm(kind, item) {
    if (!canLeave()) return;
    if (kind === "create" ? !admin : !project || (kind === "archive" ? !project.permissions.administrar : !project.permissions.editar || project.archivado)) return;
    const draft = initialForm(kind, project, item);
    const next = { seq: ++formSequence.current, kind, projectId: project?.id, baseRevision: project?.revision, admin: project?.permissions.administrar === true,
      childId: item?.id, itemTitle: item?.titulo, originalStageIds: project?.etapas.map(stage => stage.id), requestId: kind === "create" ? crypto.randomUUID() : undefined,
      draft, initial: structuredClone(draft), busy: false, error: "", conflict: false, reviewed: false, observedTask: null };
    setForm(next); formRef.current = next; setMessage("");
    if ((kind === "create" || (kind === "project" && next.admin)) && catalog.status !== "ready") void loadCatalog();
  }
  function change(key, value) {
    if (key === "tarea_id") transport.cancel("task");
    setForm(current => !current || current.busy ? current : { ...current, draft: { ...current.draft, [key]: value }, ...(key === "tarea_id" ? { observedTask: null, lookupBusy: false } : {}) });
  }
  function cancelForm() { if (canLeave()) { setForm(null); formRef.current = null; } }
  function moveStage(index, offset) {
    const ids = [...form.draft.etapa_ids], target = index + offset;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]]; change("etapa_ids", ids);
  }
  async function lookupTask() {
    const current = formRef.current, id = Number(current?.draft.tarea_id);
    if (!current || !project || !Number.isSafeInteger(id) || id <= 0) { setForm(value => value ? { ...value, error: "Escribí el ID positivo de una tarea real." } : value); return; }
    setForm(value => ({ ...value, lookupBusy: true, error: "", observedTask: null }));
    try {
      const value = await transport.read("task", `/api/tareas/${id}?workspace=render_os`);
      if (value === undefined || formRef.current?.seq !== current.seq || Number(formRef.current.draft.tarea_id) !== id) return;
      const observedTask = observedProjectTask(value, id, project.cliente.id);
      setForm(value => value?.seq === current.seq ? { ...value, observedTask, lookupBusy: false } : value);
    } catch (error) { setForm(value => value?.seq === current.seq ? { ...value, error: error.status ? projectError(error) : error.message, lookupBusy: false } : value); }
  }
  function adoptRevision() {
    if (!project || !form?.reviewed) return;
    if (form.kind === "order" && (form.originalStageIds.length !== project.etapas.length || form.originalStageIds.some(id => !project.etapas.some(stage => stage.id === id)))) {
      setForm(current => ({ ...current, error: "Cambió la lista de etapas. Cerrá este formulario y volvé a ordenar las etapas actuales." })); return;
    }
    setForm(current => ({ ...current, baseRevision: project.revision, conflict: false, error: "", reviewed: false }));
  }
  async function submit(event) {
    event.preventDefault();
    const current = formRef.current;
    if (!current || current.busy || current.conflict || mutationBusy.current) return;
    try {
      const mutation = buildProjectMutation(current);
      mutationBusy.current = true;
      setForm(value => ({ ...value, busy: true, error: "" }));
      const value = await transport.write(mutation);
      if (value === undefined || formRef.current?.seq !== current.seq) return;
      const data = parseProject(value.proyecto, true);
      if (current.kind !== "create" && data.id !== current.projectId) throw new Error("Proyecto incompatible.");
      setForm(null); formRef.current = null;
      if (current.kind === "create") selectProject(data.id);
      setDetail({ status: "ready", data, error: "" });
      setMessage(value.idempotent ? "El proyecto ya estaba creado. Mostramos su estado actual." : "Cambios guardados.");
      setListRefresh(version => version + 1);
    } catch (error) {
      setForm(value => value?.seq === current.seq ? { ...value, busy: false, error: error.status ? projectError(error) : error.message === "Failed to fetch" ? projectError(error) : error.message, conflict: error.status === 409, reviewed: false } : value);
    } finally { mutationBusy.current = false; }
  }
  function openTask(event, href) {
    if (!plainClick(event)) return;
    event.preventDefault();
    if (onNavigate) onNavigate(href);
    else navigateWithinApp(window, href);
  }

  return <main className="projects-page" aria-label="Proyectos de Render"><div className="pr-shell">
    <header className="pr-page-heading"><div><h1>Proyectos</h1><p>Etapas, entregas y tareas reales en un mismo lugar.</p></div><div className="pr-actions"><button type="button" disabled={form?.busy} onClick={() => { setListRefresh(version => version + 1); if (selection.id) void refreshDetail(); }}>Actualizar</button>{admin && <button type="button" className="pr-primary" disabled={form?.busy} onClick={() => openForm("create")}>Nuevo proyecto</button>}</div></header>
    {message && <p className="pr-notice" role="status">{message}</p>}
    <div className={`pr-layout${selection.id || form?.kind === "create" ? " has-detail" : ""}`}>
      <section className="pr-project-list" aria-label="Lista de proyectos"><div className="pr-filters"><label>Estado<select value={filters.estado} onChange={event => setFilters(current => ({ ...current, estado: event.target.value, offset: 0 }))}><option value="">Todos los estados</option><Options values={PROJECT_STATES}/></select></label>{admin && <label className="pr-checkbox"><input type="checkbox" checked={filters.archivados} onChange={event => setFilters(current => ({ ...current, archivados: event.target.checked, offset: 0 }))}/>Incluir archivados</label>}</div>
        {list.status === "loading" && <p className="pr-empty" role="status">Cargando proyectos…</p>}
        {list.error && <div className="pr-error" role="alert"><p>{list.error}</p><button type="button" onClick={() => setListRefresh(version => version + 1)}>Reintentar lista</button></div>}
        {list.data && <><p className="pr-list-total">{list.data.total ? `Mostrando ${list.data.offset + 1}–${list.data.offset + list.data.proyectos.length} de ${list.data.total}` : "No hay proyectos con este filtro."}</p><ul>{list.data.proyectos.map(item => <li key={item.id}><a href={projectHref(item.id)} aria-current={selection.id === item.id ? "page" : undefined} onClick={event => { if (!plainClick(event)) return; event.preventDefault(); if (selection.id !== item.id && canLeave()) selectProject(item.id); }}><strong>{item.titulo}</strong><span>{item.cliente.nombre} · {PROJECT_TYPES[item.tipo]}</span><small>{PROJECT_STATES[item.estado]}{item.archivado ? " · Archivado" : ""} · {item.counts.finalizadas}/{item.counts.tareas} tareas finalizadas</small><small>Entrega: {projectDate(item.fecha_entrega)}</small></a></li>)}</ul>
          <nav className="pr-pagination" aria-label="Páginas de proyectos"><button type="button" disabled={list.data.offset === 0} onClick={() => setFilters(current => ({ ...current, offset: Math.max(0, list.data.offset - list.data.limit) }))}>Anterior</button><button type="button" disabled={list.data.offset + list.data.limit >= list.data.total} onClick={() => setFilters(current => ({ ...current, offset: list.data.offset + list.data.limit }))}>Siguiente</button></nav></>}
      </section>
      <div className="pr-detail-column">
        {selection.id && <a href="/proyectos" className="pr-back" onClick={event => { if (!plainClick(event)) return; event.preventDefault(); if (canLeave()) selectProject(null); }}>← Todos los proyectos</a>}
        {selection.invalid && <div className="pr-error" role="alert">El enlace no contiene un proyecto válido. Elegí uno de la lista.</div>}
        {detail.status === "loading" && selection.id && <p className="pr-empty" role="status">Actualizando proyecto…</p>}
        {detail.error && <div className="pr-error" role="alert"><p>{detail.error}</p><button type="button" onClick={() => refreshDetail(Boolean(form?.conflict))}>Reintentar proyecto</button></div>}
        {form && (form.kind === "create" || project) && <ProjectEditor {...{ form, project, catalog, change, cancel: cancelForm, submit, refresh: () => refreshDetail(true), adoptRevision, lookupTask, retryCatalog: loadCatalog, moveStage }}/>}
        {project && <Detail project={project} openForm={openForm} openTask={openTask}/>}
        {!selection.id && !selection.invalid && !form && <section className="pr-select-prompt"><h2>Elegí un proyecto</h2><p>Podés consultar su trabajo sin cambiar los permisos de las tareas vinculadas.</p></section>}
        {dirty && <p className="pr-draft-note">Borrador sin guardar. No se conserva al cerrar la sesión.</p>}
      </div>
    </div>
  </div></main>;
}
