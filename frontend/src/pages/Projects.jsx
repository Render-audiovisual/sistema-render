import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FilterSelect } from '../components/FilterSelect.jsx';
import { restoreProjectFormFocus } from './projectFormReturnFocus.js';
import { apiRequest } from "../features/render-os/services/render-os-api.js";
import { useNavigationGuard } from "../shared/navigation/useNavigationGuard.js";
import { navigateWithinApp } from "../shared/navigation/location.js";
import { notifyViewPreferenceChange } from '../shared/navigation/viewPreferenceEvent.js';
import { getSesion } from '../utils.jsx';
import { useSessionView } from '../shared/session/use-session-view.js';
import { createCapturedRequest, isSessionFailure } from '../shared/session/captured-request.js';
import { DELIVERABLE_EDIT_STATES, isProjectChildCreation, parseProjectChildCreation, parseProjectDeliverableApproval, projectDeliverableApprovalLabel, projectListLocation, projectListLocationUrl } from './projectsModel.js';
import { PROJECT_TYPES, PROJECT_STATES, STAGE_STATES, MILESTONE_STATES, DELIVERABLE_STATES, PROJECT_ACTIVITY, buildProjectMutation, createProjectsTransport, observedProjectTask, parseProject, parseProjectsPage, projectDate, projectError, projectHref, projectLocation, projectLocationUrl, projectsListUrl, safeProjectUrl } from "./projectsModel.js";
import "./Projects.css";

const USER_ROLES = ["admin", "diseno", "edicion", "produccion", "community", "programacion"];
const TASK_STATES = { pendiente: "Pendiente", en_progreso: "En progreso", en_revision: "En revisión", aprobada: "Aprobada", finalizada: "Finalizada", publicada: "Finalizada" };
const FORM_TITLES = { create: "Nuevo proyecto", project: "Editar proyecto", archive: "Cambiar archivo", order: "Ordenar etapas", "stage-create": "Nueva etapa", "stage-edit": "Editar etapa", "milestone-create": "Nuevo hito", "milestone-edit": "Editar hito", "deliverable-create": "Nuevo entregable", "deliverable-edit": "Editar entregable", "deliverable-approve":"Aprobar versión revisada", "task-link": "Vincular tarea existente", "task-unlink": "Desvincular tarea" };
const states = { ...PROJECT_STATES, ...STAGE_STATES, ...MILESTONE_STATES, ...DELIVERABLE_STATES };
const plainClick = event => !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
function Options({ values }) { return Object.entries(values).map(([value, label]) => <option value={value} key={value}>{label}</option>); }
function StageSelect({ value, project, onChange }) { return <FilterSelect label="Etapa" value={value || ""} onChange={event => onChange(event.target.value)}><option value="">Sin etapa</option>{project.etapas.map(stage => <option key={stage.id} value={stage.id}>{stage.titulo}</option>)}</FilterSelect>; }
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
  if(kind==='deliverable-approve')return{acknowledged:false};
  if (kind.startsWith("deliverable-")) return { titulo: item?.titulo || "", url: item?.url || "", observaciones: item?.observaciones || "", estado: item?.estado || "pendiente" };
  return kind === "task-link" ? { tarea_id: "", etapa_id: "" } : {};
}

function ProjectFields({ form, project, catalog, change, retryCatalog }) {
  const d = form.draft, creating = form.kind === "create", admin = creating || form.admin;
  const inactiveIds = d.miembro_ids.filter(id => !catalog.users.some(user => user.id === id));
  return <>
    <TitleInput value={d.titulo} onChange={value => change("titulo", value)}/>
    <FilterSelect label="Tipo" value={d.tipo} onChange={event => change("tipo", event.target.value)}><Options values={PROJECT_TYPES}/></FilterSelect>
    {!creating && <FilterSelect label="Estado del proyecto" value={d.estado} onChange={event => change("estado", event.target.value)}><Options values={PROJECT_STATES}/></FilterSelect>}
    <DateInput label="Fecha de inicio" value={d.fecha_inicio} onChange={value => change("fecha_inicio", value)}/>
    <DateInput label="Fecha de entrega" value={d.fecha_entrega} onChange={value => change("fecha_entrega", value)}/>
    <label className="pr-wide">Descripción<textarea maxLength={20000} rows={4} value={d.descripcion} onChange={event => change("descripcion", event.target.value)}/></label>
    {admin && <>
      {catalog.status === "loading" && <p className="pr-muted pr-wide" role="status">Cargando clientes y personas…</p>}
      {catalog.error && <div className="pr-error pr-wide" role="alert">{catalog.error}<button type="button" onClick={retryCatalog}>Reintentar catálogos</button></div>}
      <div className="pr-field-stack"><FilterSelect label="Cliente" required value={d.cliente_id} disabled={catalog.status !== "ready" || (!creating && project.counts.tareas > 0)} aria-describedby={!creating && project.counts.tareas > 0 ? 'project-client-lock-help' : undefined} onChange={event => change("cliente_id", event.target.value)}>
        <option value="">Elegir cliente activo</option>
        {!creating && !catalog.clients.some(client => String(client.id) === String(d.cliente_id)) && <option value={project.cliente.id}>{project.cliente.nombre} (actual)</option>}
        {catalog.clients.map(client => <option key={client.id} value={client.id}>{client.nombre} · ID {client.id}</option>)}
      </FilterSelect>{!creating && project.counts.tareas > 0 && <small id="project-client-lock-help">El cliente no se cambia mientras haya tareas vinculadas.</small>}</div>
      <FilterSelect label="Responsable" required value={d.responsable_id} disabled={catalog.status !== "ready"} onChange={event => change("responsable_id", event.target.value)}>
        <option value="">Elegir persona activa</option>
        {!creating && !catalog.users.some(user => String(user.id) === String(d.responsable_id)) && <option value={project.responsable.id}>{project.responsable.nombre} · ID {project.responsable.id} (actual)</option>}
        {catalog.users.map(user => <option key={user.id} value={user.id}>{user.nombre} · {user.usuario || `ID ${user.id}`} · ID {user.id}</option>)}
      </FilterSelect>
      <fieldset className="pr-members pr-wide"><legend>Miembros</legend><small>Ser miembro no concede permisos de edición del proyecto.</small>
        {catalog.status === "ready" && !catalog.users.length && <p>No hay personas activas disponibles.</p>}
        {catalog.users.map(user => <label key={user.id}><input type="checkbox" checked={d.miembro_ids.includes(user.id)} disabled={catalog.status !== "ready"} onChange={event => change("miembro_ids", event.target.checked ? [...d.miembro_ids, user.id] : d.miembro_ids.filter(id => id !== user.id))}/>{user.nombre} · ID {user.id}</label>)}
        {inactiveIds.map(id => <label key={id}><input type="checkbox" checked onChange={() => change("miembro_ids", d.miembro_ids.filter(value => value !== id))}/>Usuario ID {id} (actual; retirar)</label>)}
      </fieldset>
    </>}
  </>;
}

function ProjectEditor({ form, project, catalog, change, cancel, submit, refresh, adoptRevision, lookupTask, retryCatalog, moveStage, observationReady = true }) {
  const editorHeading=useRef(null),focusedSequence=useRef(null);
  useEffect(()=>{
    if(focusedSequence.current===form.seq)return;
    focusedSequence.current=form.seq;
    if(form.busy||!editorHeading.current?.isConnected)return;
    editorHeading.current.focus({preventScroll:true});
    editorHeading.current.scrollIntoView({block:'start',behavior:'auto'});
  },[form.seq]);
  const d = form.draft, kind = form.kind;
  const structural = kind !== "create";
  const allowed = !structural || (kind === "archive" ? project?.permissions.administrar : project?.permissions.editar && !project?.archivado);
  const needsCatalog = kind === "create" || (kind === "project" && form.admin);
  return <section className="pr-editor" aria-labelledby="pr-editor-title">
    <header className="pr-section-heading"><h2 id="pr-editor-title" ref={editorHeading} tabIndex={-1}>{FORM_TITLES[kind]}</h2><button type="button" onClick={cancel} disabled={form.busy}>Cerrar formulario</button></header>
    {structural && <p className="pr-version">Base observada: revisión <strong>{form.baseRevision}</strong>{project && project.revision !== form.baseRevision && <> · Proyecto visible: revisión <strong>{project.revision}</strong></>}</p>}
    {form.error && <div className="pr-error" role="alert"><p>{form.error}</p>
      {form.conflict && structural && <div className="pr-actions"><button type="button" onClick={refresh} disabled={form.busy}>Actualizar proyecto y revisar</button>
        {form.reviewed && project && kind!=='deliverable-approve' && !isProjectChildCreation(kind) && <button type="button" disabled={!observationReady} onClick={adoptRevision}>Usar revisión {project.revision}</button>}{kind==='deliverable-approve'&&<p>Cerrá esta revisión y volvé a abrir el entregable actualizado antes de aprobar. No se adoptará otra versión automáticamente.</p>}{isProjectChildCreation(kind)&&<p>Este intento conserva su identificador y revisión original. Revisá el proyecto; para iniciar una creación diferente, cerrá y volvé a abrir el formulario.</p>}</div>}
      {form.uncertain&&<button type="button" disabled={form.busy || !observationReady || !allowed} onClick={event=>submit(event,{verify:true})}>Verificar la misma solicitud</button>}
      {form.conflict && !structural && <p>Revisá la lista antes de cerrar este formulario e iniciar una creación diferente. Este intento conserva su identificador.</p>}
    </div>}
    {!allowed && <p className="pr-notice">No tenés permiso actual para guardar este formulario. Tus datos siguen acá.</p>}
    <form className="pr-form" onSubmit={submit}>
      <fieldset className="pr-form-fields" disabled={form.busy||form.uncertain}>
      {(kind === "create" || kind === "project") && <ProjectFields {...{ form, project, catalog, change, retryCatalog }}/>}
      {kind === "archive" && <p className="pr-wide">{d.archivado ? "Archivar oculta el proyecto del listado habitual y bloquea sus cambios. No borra tareas ni historial." : "Reactivar permite volver a trabajar en el proyecto."}</p>}
      {kind.startsWith("stage-") && <><TitleInput value={d.titulo} onChange={value => change("titulo", value)}/>{kind === "stage-edit" && <FilterSelect label="Estado" value={d.estado} onChange={event => change("estado", event.target.value)}><Options values={STAGE_STATES}/></FilterSelect>}</>}
      {kind.startsWith("milestone-") && <><TitleInput value={d.titulo} onChange={value => change("titulo", value)}/><DateInput label="Fecha del hito" value={d.fecha} onChange={value => change("fecha", value)}/><StageSelect value={d.etapa_id} project={project} onChange={value => change("etapa_id", value)}/><FilterSelect label="Estado" value={d.estado} onChange={event => change("estado", event.target.value)}><Options values={MILESTONE_STATES}/></FilterSelect></>}
      {kind.startsWith("deliverable-") && kind!=='deliverable-approve' && <><TitleInput value={d.titulo} onChange={value => change("titulo", value)}/><label className="pr-wide">Enlace de entrega<input type="url" value={d.url} onChange={event => change("url", event.target.value)} placeholder="https://"/></label>
        <label className="pr-wide">Observaciones<textarea rows={3} maxLength={20000} value={d.observaciones} onChange={event => change("observaciones", event.target.value)}/></label>
        <FilterSelect label="Estado" value={d.estado} onChange={event => change("estado", event.target.value)}>{d.estado==='aprobado'&&<option disabled value="aprobado">Aprobación registrada (no editable aquí)</option>}<Options values={DELIVERABLE_EDIT_STATES}/></FilterSelect>
        <p className="pr-muted pr-wide">Editar título, enlace u observaciones de un entregable aprobado requiere otra revisión. Guardar este formulario no aprueba contenido.</p>
      </>}
      {kind==='deliverable-approve'&&<><div className="pr-observed pr-wide pr-deliverable-review"><h3>{form.observedDeliverable.titulo}</h3><p>Contenido versión {form.observedDeliverable.contenido_revision} · Entregable revisión {form.observedDeliverable.entregable_revision}</p>{safeProjectUrl(form.observedDeliverable.url)&&<a href={safeProjectUrl(form.observedDeliverable.url)} target="_blank" rel="noopener noreferrer">Abrir la entrega observada ↗</a>}<p>{form.observedDeliverable.observaciones||'Sin observaciones'}</p></div><label className="pr-checkbox pr-wide"><input type="checkbox" checked={d.acknowledged} onChange={event=>change('acknowledged',event.target.checked)}/>Revisé este título, enlace y observaciones y apruebo únicamente la versión indicada.</label></>}
      {kind === "order" && <ol className="pr-order pr-wide">{d.etapa_ids.map((id, index) => <li key={id}><span>{project.etapas.find(stage => stage.id === id)?.titulo || `Etapa ${id}`}</span><button type="button" aria-label={`Subir etapa ${index + 1}`} disabled={index === 0 || form.busy} onClick={() => moveStage(index, -1)}>↑</button><button type="button" aria-label={`Bajar etapa ${index + 1}`} disabled={index === d.etapa_ids.length - 1 || form.busy} onClick={() => moveStage(index, 1)}>↓</button></li>)}</ol>}
      {kind === "task-link" && <>
        <label>ID de la tarea existente<input inputMode="numeric" pattern="[1-9][0-9]*" required value={d.tarea_id} onChange={event => change("tarea_id", event.target.value)}/></label>
        <button type="button" className="pr-field-action" onClick={lookupTask} disabled={form.lookupBusy || form.busy || !observationReady || !allowed}>{form.lookupBusy ? "Consultando…" : "Consultar tarea"}</button>
        <StageSelect value={d.etapa_id} project={project} onChange={value => change("etapa_id", value)}/>
        {form.observedTask && <div className="pr-observed pr-wide"><a href={form.observedTask.href} target="_blank" rel="noopener noreferrer">{form.observedTask.titulo} ↗</a><p>ID {form.observedTask.id} · Revisión observada {form.observedTask.revision}</p></div>}
        <p className="pr-muted pr-wide">Se vincula la tarea real, no se copia ni se crea otra. Consultala de nuevo solo para revisar explícitamente una versión más reciente.</p>
      </>}
      {kind === "task-unlink" && <p className="pr-wide">Se quitará el vínculo con “{form.itemTitle}”. La tarea seguirá existiendo con su historial y permisos.</p>}
      </fieldset><footer className="pr-actions pr-wide"><button type="button" onClick={cancel} disabled={form.busy}>Cancelar</button><button type="submit" className="pr-primary" disabled={form.busy || form.uncertain || form.conflict || !observationReady || (kind==='deliverable-approve'&&!d.acknowledged) || !allowed || (needsCatalog && catalog.status !== "ready") || (kind === "task-link" && !form.observedTask)}>{form.busy ? "Guardando…" : kind === "create" ? "Crear proyecto" : kind === "archive" ? d.archivado ? "Archivar proyecto" : "Reactivar proyecto" : kind === "task-link" ? "Vincular tarea" : kind === "task-unlink" ? "Quitar vínculo" : kind==='deliverable-approve'?'Aprobar versión revisada': "Guardar cambios"}</button></footer>
    </form>
  </section>;
}

function Detail({ project, openForm, openTask, observationReady = true }) {
  const edit = observationReady && project.permissions.editar && !project.archivado;
  const stageName = id => project.etapas.find(stage => stage.id === id)?.titulo || "Sin etapa";
  const resourceName = id => [...project.entregables, ...project.hitos, ...project.etapas].find(item => item.id === id)?.titulo;
  return <>
    <header className="pr-detail-header"><div><span className="pr-kicker">{PROJECT_TYPES[project.tipo]} · {PROJECT_STATES[project.estado]}{project.archivado ? " · Archivado" : ""}</span><h2>{project.titulo}</h2><p>{project.cliente.nombre} · Responsable: {project.responsable.nombre} · ID {project.responsable.id}</p></div>
      <div className="pr-actions">{edit && <button type="button" onClick={() => openForm("project")}>Editar proyecto</button>}{project.permissions.administrar && <button type="button" disabled={!observationReady} onClick={() => openForm("archive")}>{project.archivado ? "Reactivar" : "Archivar"}</button>}</div></header>
    <dl className="pr-facts"><div><dt>Inicio</dt><dd>{projectDate(project.fecha_inicio)}</dd></div><div><dt>Entrega</dt><dd>{projectDate(project.fecha_entrega)}</dd></div><div><dt>Tareas finalizadas</dt><dd>{project.counts.finalizadas} de {project.counts.tareas}</dd></div><div><dt>Revisión del proyecto</dt><dd>{project.revision}</dd></div></dl>
    {project.descripcion && <p className="pr-description">{project.descripcion}</p>}
    <p className="pr-members-summary">Miembros: {project.miembro_ids.length ? project.miembro_ids.map(id => `ID ${id}`).join(", ") : "sin miembros adicionales"}. El estado del proyecto se gestiona por separado de sus tareas.</p>

    <section className="pr-section" aria-labelledby="pr-stages-title"><header className="pr-section-heading"><h3 id="pr-stages-title">Etapas</h3>{edit && <div className="pr-actions">{project.etapas.length > 1 && <button type="button" onClick={() => openForm("order")}>Ordenar</button>}<button type="button" onClick={() => openForm("stage-create")}>Agregar etapa</button></div>}</header>
      {project.etapas.length ? <ol className="pr-stages">{project.etapas.map(stage => <li key={stage.id}><span className={`pr-stage-dot is-${stage.estado}`} aria-hidden="true"/><span><strong>{stage.titulo}</strong><small>{STAGE_STATES[stage.estado]}</small></span>{edit && <button type="button" onClick={() => openForm("stage-edit", stage)}>Editar<span className="pr-sr-only"> etapa {stage.titulo}</span></button>}</li>)}</ol> : <p className="pr-empty">Todavía no hay etapas.</p>}</section>

    <section className="pr-section" aria-labelledby="pr-milestones-title"><header className="pr-section-heading"><h3 id="pr-milestones-title">Hitos</h3>{edit && <button type="button" onClick={() => openForm("milestone-create")}>Agregar hito</button>}</header>
      {project.hitos.length ? <ul className="pr-items">{project.hitos.map(item => <li key={item.id}><div><strong>{item.titulo}</strong><small>{MILESTONE_STATES[item.estado]} · {projectDate(item.fecha)} · {stageName(item.etapa_id)}</small></div>{edit && <button type="button" onClick={() => openForm("milestone-edit", item)}>Editar<span className="pr-sr-only"> hito {item.titulo}</span></button>}</li>)}</ul> : <p className="pr-empty">Todavía no hay hitos.</p>}</section>

    <section className="pr-section" aria-labelledby="pr-deliverables-title"><header className="pr-section-heading"><h3 id="pr-deliverables-title">Entregables</h3>{edit && <button type="button" onClick={() => openForm("deliverable-create")}>Agregar entregable</button>}</header>
      {project.entregables.length ? <ul className="pr-items">{project.entregables.map(item => <li key={item.id}><div><strong>{item.titulo}</strong><small>{projectDeliverableApprovalLabel(item)}</small>{safeProjectUrl(item.url) && <a href={safeProjectUrl(item.url)} target="_blank" rel="noopener noreferrer">Abrir entrega ↗</a>}{item.observaciones && <p className="pr-description">{item.observaciones}</p>}{item.aprobado_por_id && <small>{item.aprobacion_versionada?'Aprobado por usuario ID':'Registro histórico de aprobación · usuario ID'} {item.aprobado_por_id} · {dateTime(item.aprobado_at)}</small>}</div>{edit && <button type="button" onClick={() => openForm("deliverable-edit", item)}>Editar<span className="pr-sr-only"> entregable {item.titulo}</span></button>}{edit&&item.contenido_hash&&!item.aprobacion_versionada&&<button type="button" onClick={()=>openForm("deliverable-approve",item)}>Revisar y aprobar<span className="pr-sr-only"> {item.titulo}</span></button>}</li>)}</ul> : <p className="pr-empty">Todavía no hay entregables.</p>}</section>

    <section className="pr-section" aria-labelledby="pr-tasks-title"><header className="pr-section-heading"><h3 id="pr-tasks-title">Tareas vinculadas <span className="pr-muted">({project.counts.tareas})</span></h3>{edit && <button type="button" onClick={() => openForm("task-link")}>Vincular existente</button>}</header>
      {project.tareas.length ? <ul className="pr-items">{project.tareas.map(item => <li key={item.id}><div><a href={item.href} onClick={event => openTask(event, item.href)}>{item.titulo} ↗</a><small>{TASK_STATES[item.estado] || item.estado} · {projectDate(item.fecha_vencimiento)} · {stageName(item.etapa_id)} · Revisión {item.revision}</small></div>{edit && <button type="button" onClick={() => openForm("task-unlink", item)}>Quitar vínculo<span className="pr-sr-only"> con {item.titulo}</span></button>}</li>)}</ul> : <p className="pr-empty">No hay tareas visibles vinculadas.</p>}
      {project.tareas_no_disponibles > 0 && <p className="pr-notice">{project.tareas_no_disponibles} {project.tareas_no_disponibles === 1 ? "tarea no disponible. Sus datos no se muestran." : "tareas no disponibles. Sus datos no se muestran."}</p>}
      <p className="pr-section-note">Las tareas se trabajan en su tablero. Vincular no cambia sus permisos, estado ni fechas.</p>
    </section>

    <details className="pr-section pr-activity"><summary>Actividad del proyecto · últimas {project.actividad.length}</summary>{project.actividad.length ? <ol>{project.actividad.map(item => <li key={item.id}><strong>{PROJECT_ACTIVITY[item.accion]}</strong><small>Usuario ID {item.actor_id} · {dateTime(item.created_at)}</small>{item.recurso_id && <span title={item.recurso_id}>Recurso: {resourceName(item.recurso_id) || item.recurso_id}</span>}{item.tarea_id && <span>Tarea ID {item.tarea_id}</span>}{(item.estado_anterior || item.estado_nuevo) && <span>{item.estado_anterior ? states[item.estado_anterior] : "Sin estado previo"} → {item.estado_nuevo ? states[item.estado_nuevo] : "Sin estado posterior"}</span>}</li>)}</ol> : <p className="pr-empty">Sin actividad para mostrar.</p>}</details>
  </>;
}

export function ProjectsPage({ sesion, onNavigate, request = apiRequest }) {
  const view=useSessionView(sesion),user = view.session?.usuario;
  if (!view.binding||!Number.isSafeInteger(user?.id) || user.id <= 0 || user.activo === false) return <main className="projects-page"><p role="alert">Necesitás una sesión válida para consultar Proyectos.</p></main>;
  // A session change remounts all local state before rendering another identity.
  return <ProjectsSession key={view.key} sesion={view.session} {...{ onNavigate, request }}/>;
}

function ProjectsSession({ sesion, onNavigate, request }) {
  const admin = sesion.usuario.rol === "admin";
  const transportRef = useRef(null);
  const mounted=useRef(false);
  useLayoutEffect(() => {
    mounted.current=true;
    const scope=createCapturedRequest({session:sesion,readSession:getSesion,request,isActive:()=>mounted.current});
    const client = createProjectsTransport(scope.request,{isCurrent:scope.current});
    transportRef.current = client;
    return () => { mounted.current=false;client.dispose(); if (transportRef.current === client) transportRef.current = null; };
  }, [request,sesion]);
  const transport = useMemo(() => ({
    read: (...args) => transportRef.current?.read(...args) || Promise.resolve(undefined),
    write: (...args) => transportRef.current?.write(...args) || Promise.resolve(undefined),
    cancel: key => transportRef.current?.cancel(key),
  }), [request]);
  const [selection, setSelection] = useState(() => projectLocation(window.location.href));
  const selectionRef = useRef(selection); selectionRef.current = selection;
  const [filters, setFilters] = useState(() => projectListLocation(window.location.href));
  const filtersRef = useRef(filters); filtersRef.current = filters;
  const [contextHref, setContextHref] = useState(() => window.location.href);
  const [filterClients, setFilterClients] = useState({ status: 'loading', items: [], error: '' });
  const [list, setList] = useState({ status: "loading", data: null, error: "" });
  const [detail, setDetail] = useState({ status: "idle", data: null, error: "" });
  const detailStateRef = useRef(detail);
  function publishDetail(next) {
    const value = typeof next === 'function' ? next(detailStateRef.current) : next;
    detailStateRef.current = value;
    setDetail(value);
  }
  function canUseProjectObservation(kind) {
    const id = selectionRef.current.id, current = detailStateRef.current;
    if (id && (current.status !== 'ready' || current.data?.id !== id)) return false;
    if (kind === 'create') return admin;
    const data = current.data;
    return Boolean(id && data?.id === id && (kind === 'archive'
      ? data.permissions.administrar : data.permissions.editar && !data.archivado));
  }
  const [catalog, setCatalog] = useState({ status: "idle", clients: [], users: [], error: "" });
  const [form, setForm] = useState(null);
  const formRef = useRef(form); formRef.current = form;
  const formReturnFocus = useRef(null);
  useLayoutEffect(() => {
    const pending = formReturnFocus.current;
    formReturnFocus.current = null;
    if (!form && pending) restoreProjectFormFocus(pending, document);
  }, [form]);
  const formSequence = useRef(0);
  const detailReadGeneration=useRef(0);
  const mutationBusy = useRef(false);
  const [listRefresh, setListRefresh] = useState(0);
  const [message, setMessage] = useState("");
  const project = detail.data?.id === selection.id ? detail.data : null;
  const observationReady = !selection.id || (detail.status === 'ready' && project !== null);
  const dirty = form && (form.uncertain||JSON.stringify(form.draft) !== JSON.stringify(form.initial));
  const captureAction=()=>{const observation=selectionRef.current;return createCapturedRequest({session:sesion,readSession:getSesion,request,isActive:()=>mounted.current&&selectionRef.current===observation});};
  function purgeProjectAccess(scope){
    if(!scope.current())return;
    for(const key of ['detail','task','clients','users'])transport.cancel(key);
    formRef.current=null;setForm(null);setCatalog({status:'idle',clients:[],users:[],error:''});setMessage('');
    publishDetail({status:'error',data:null,error:'No tenés acceso actual a este proyecto. Se retiró el contenido de esta vista.'});
  }

  function restoreListContext(href) {
    const next = projectListLocation(href);
    setContextHref(href);
    if (JSON.stringify(next) === JSON.stringify(filtersRef.current)) return;
    // Synchronously fence the old response before React applies the new filter.
    transport.cancel('list'); filtersRef.current = next; setFilters(next);
    setList({ status: 'loading', data: null, error: '', context: next });
  }
  function changeListFilters(changes) {
    const next = { ...filtersRef.current, ...changes };
    const href = projectListLocationUrl(window.location.href, next);
    window.history.pushState(window.history.state, '', href);
    notifyViewPreferenceChange(window);
    restoreListContext(href);
  }
  function chooseClient(value) {
    if (value !== '' && !filterClients.items.some(client => String(client.id) === value)) return;
    changeListFilters({ clientId: value === '' ? null : Number(value), offset: 0, invalid: false });
  }
  async function loadProjectList() {
    const observation = filtersRef.current;
    const current = () => mounted.current && filtersRef.current === observation;
    transport.cancel('list');
    if (observation.invalid) {
      setList({ status: 'error', data: null, context: observation, error: 'El filtro de cliente o listado no es válido. Corregí el cliente o limpiá los filtros; no se consultaron todos los proyectos.' });
      return;
    }
    setList({ status: 'loading', data: null, error: '', context: observation });
    try {
      const value = await transport.read('list', projectsListUrl(observation));
      if (value === undefined || !current()) return;
      const data = parseProjectsPage(value);
      if (observation.clientId !== null && data.proyectos.some(item => item.cliente.id !== observation.clientId)) throw new Error('Listado incompatible.');
      setList({ status: 'ready', data, error: '', context: observation });
    } catch (error) { if (current()) setList({ status: 'error', data: null, error: projectError(error), context: observation }); }
  }
  useEffect(() => {
    void loadProjectList();
    return () => { transport.cancel('list'); };
  }, [transport, filters, listRefresh]);
  useEffect(() => {
    let active = true;
    transport.read('filter-clients', '/api/clientes').then(value => {
      if (!active || value === undefined) return;
      if (!Array.isArray(value) || value.some(item => !Number.isSafeInteger(item?.id) || item.id < 1 || item.id > 2147483647 || typeof item.nombre !== 'string')) throw new Error('Catálogo inválido.');
      setFilterClients({ status: 'ready', items: value.map(item => ({ id: item.id, nombre: item.nombre })), error: '' });
    }).catch(error => { if (active) setFilterClients({ status: 'error', items: [], error: projectError(error) }); });
    return () => { active = false; transport.cancel('filter-clients'); };
  }, [transport, listRefresh]);

  async function refreshDetail(review = false) {
    const observation=selectionRef.current,id = observation.id;
    const scope=captureAction();if (!id||!scope.current()) return;
    if(mutationBusy.current&&formRef.current?.projectId===id)return;
    const generation=++detailReadGeneration.current;
    publishDetail(current => ({ status: "loading", data:current.data?.id===id?current.data:null, error: "" }));
    try {
      const value = await transport.read("detail", `/api/proyectos/${id}`);
      if (value === undefined || generation!==detailReadGeneration.current||!scope.current()||selectionRef.current!==observation) return;
      const data = parseProject(value.proyecto, true);
      if (data.id !== id) throw new Error("Proyecto incompatible.");
      publishDetail({ status: "ready", data, error: "" });
      if (review) setForm(current => generation===detailReadGeneration.current&&current?.projectId === id ? { ...current, reviewed: true } : current);
    } catch (error) { if (generation===detailReadGeneration.current&&scope.current()&&selectionRef.current===observation){
      if(error.status===403){purgeProjectAccess(scope);return;}
      publishDetail(current=>({ status:"error",data:error.status===401||isSessionFailure(error)?null:current.data?.id===id?current.data:null,error:projectError(error) }));
    } }
  }
  useEffect(() => {
    publishDetail({ status: selection.id ? "loading" : "idle", data: null, error: "" });
    if (selection.id) void refreshDetail();
    return () => {detailReadGeneration.current++;transport.cancel("detail");};
  }, [selection.id, transport]);

  function canLeave() {
    const current = formRef.current;
    if (current?.busy || mutationBusy.current) return false;
    return !current || !current.uncertain&&JSON.stringify(current.draft) === JSON.stringify(current.initial) || window.confirm("Tenés cambios sin guardar o un envío sin confirmar. ¿Querés salir y perder la recuperación en memoria?");
  }
  function navigationStatus(context = {}) {
    if(!captureAction().current())return{dirty:false,busy:false};
    if (context.type !== "unload" && context.to) {
      const next = new URL(context.to, window.location.origin);
      const destination = next.origin === window.location.origin && next.pathname === "/proyectos" ? projectLocation(next.href) : null;
      // Same-project context changes do not replace the open form or its draft.
      if (destination && destination.id === selectionRef.current.id && !destination.invalid) return { dirty: false, busy: false };
    }
    const current = formRef.current;
    return { dirty: Boolean(current && (current.uncertain||JSON.stringify(current.draft) !== JSON.stringify(current.initial))),
      busy: Boolean(current?.busy || mutationBusy.current) };
  }
  useNavigationGuard(navigationStatus);
  function selectProject(id, replace = false) {
    const url = projectLocationUrl(window.location.href, id);
    window.history[replace ? "replaceState" : "pushState"](window.history.state, "", url);
    notifyViewPreferenceChange(window);
    restoreListContext(url);
    const next = { id, invalid: false };
    setForm(null); formRef.current = null; setMessage(""); setSelection(next);
    selectionRef.current = next;
    publishDetail({ status:id?'loading':'idle',data:null,error:'' });
  }
  useEffect(() => {
    const navigate = () => {
      if (window.location.pathname !== "/proyectos") return;
      const next = projectLocation(window.location.href);
      restoreListContext(window.location.href);
      if (next.id === selectionRef.current.id && !next.invalid) return;
      // Shared navigation protection has already accepted any cancelable exit.
      // Unsupported/noncancelable traversals are restored normally, never trapped.
      setForm(null); formRef.current = null; setMessage(""); setSelection(next); selectionRef.current = next;
      publishDetail({ status:next.id?'loading':'idle',data:null,error:'' });
    };
    window.addEventListener("popstate", navigate);
    return () => { window.removeEventListener("popstate", navigate); };
  }, []);

  async function loadCatalog() {
    const scope=captureAction();if(!scope.current())return;
    setCatalog(current => ({ ...current, status: "loading", error: "" }));
    try {
      const [clients, users] = await Promise.all([transport.read("clients", "/api/clientes"), transport.read("users", "/api/usuarios")]);
      if (clients === undefined || users === undefined||!scope.current()) return;
      if (!Array.isArray(clients) || !Array.isArray(users)) throw new Error("Catálogo inválido.");
      setCatalog({ status: "ready", clients: clients.filter(item => Number.isSafeInteger(item.id) && item.id > 0 && item.activo !== false), users: users.filter(item => Number.isSafeInteger(item.id) && item.id > 0 && item.activo === true && USER_ROLES.includes(item.rol)), error: "" });
    } catch (error) { if(scope.current()){if(error.status===403){purgeProjectAccess(scope);return;}setCatalog({ status: "error", clients: [], users: [], error: projectError(error) });} }
  }
  function openForm(kind, item) {
    const scope=captureAction();if(!scope.current())return;
    if (!canUseProjectObservation(kind)) return;
    if (!canLeave()) return;
    if (kind === "create" ? !admin : !project || (kind === "archive" ? !project.permissions.administrar : !project.permissions.editar || project.archivado)) return;
    const draft = initialForm(kind, project, item);
    if((kind==='create'||kind==='deliverable-approve'||isProjectChildCreation(kind))&&typeof crypto?.randomUUID!=='function'){setMessage('No se puede generar una solicitud segura. No se envió ningún cambio.');return;}
    if(kind==='deliverable-approve'&&(!item?.contenido_hash||item.aprobacion_versionada))return;
    const next = { seq: ++formSequence.current, kind, scope, observedDeliverable:kind==='deliverable-approve'?Object.freeze({...item}):null,projectId: project?.id, baseRevision: project?.revision, admin: project?.permissions.administrar === true,
      childId: item?.id, itemTitle: item?.titulo, originalStageIds: project?.etapas.map(stage => stage.id), requestId: kind === "create"||kind==='deliverable-approve'||isProjectChildCreation(kind) ? crypto.randomUUID() : undefined,
      draft, initial: structuredClone(draft), busy: false, error: "", conflict: false, reviewed: false, observedTask: null };
    setForm(next); formRef.current = next; setMessage("");
    if ((kind === "create" || (kind === "project" && next.admin)) && catalog.status !== "ready") void loadCatalog();
  }
  function change(key, value) {
    if (key === "tarea_id") transport.cancel("task");
    setForm(current => !current || current.busy || current.uncertain || !current.scope.current() ? current : { ...current, draft: { ...current.draft, [key]: value }, ...(key === "tarea_id" ? { observedTask: null, lookupBusy: false } : {}) });
  }
  function cancelForm() {
    const current = formRef.current;
    if (canLeave()) {
      if (formRef.current !== current) return;
      formReturnFocus.current = current ? {kind:current.kind, scope:current.scope} : null;
      setForm(null); formRef.current = null;
    }
  }
  function moveStage(index, offset) {
    const ids = [...form.draft.etapa_ids], target = index + offset;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]]; change("etapa_ids", ids);
  }
  async function lookupTask() {
    const current = formRef.current, id = Number(current?.draft.tarea_id);
    if (!canUseProjectObservation('task-link')) return;
    if(current&&!current.scope.current())return;
    if (!current || !project || !Number.isSafeInteger(id) || id <= 0) { setForm(value => value ? { ...value, error: "Escribí el ID positivo de una tarea real." } : value); return; }
    setForm(value => ({ ...value, lookupBusy: true, error: "", observedTask: null }));
    try {
      const value = await transport.read("task", `/api/tareas/${id}?workspace=render_os`);
      if (value === undefined || !current.scope.current()||formRef.current?.seq !== current.seq || Number(formRef.current.draft.tarea_id) !== id) return;
      if (!canUseProjectObservation('task-link')) { setForm(value=>value?.seq===current.seq?{...value,lookupBusy:false}:value); return; }
      const observedTask = observedProjectTask(value, id, project.cliente.id);
      setForm(value => value?.seq === current.seq ? { ...value, observedTask, lookupBusy: false } : value);
    } catch (error) { if(current.scope.current()){if(error.status===403){purgeProjectAccess(current.scope);return;}setForm(value => value?.seq === current.seq ? { ...value, error: error.status ? projectError(error) : error.message, lookupBusy: false } : value);} }
  }
  function adoptRevision() {
    if (!canUseProjectObservation(form?.kind)) return;
    if (!project || !form?.reviewed) return;
    if(form.kind==='deliverable-approve'||isProjectChildCreation(form.kind))return;
    if (form.kind === "order" && (form.originalStageIds.length !== project.etapas.length || form.originalStageIds.some(id => !project.etapas.some(stage => stage.id === id)))) {
      setForm(current => ({ ...current, error: "Cambió la lista de etapas. Cerrá este formulario y volvé a ordenar las etapas actuales." })); return;
    }
    setForm(current => ({ ...current, baseRevision: project.revision, conflict: false, error: "", reviewed: false }));
  }
  async function submit(event,{verify=false}={}) {
    event.preventDefault();
    const current = formRef.current;
    if (!canUseProjectObservation(current?.kind)) return;
    if (!current || !current.scope.current()||current.busy || current.conflict || mutationBusy.current||current.uncertain&&!verify||verify&&!current.frozenMutation) return;
    try {
      const mutation = current.frozenMutation||buildProjectMutation(current);
      const receipted=current.kind==='create'||current.kind==='deliverable-approve'||isProjectChildCreation(current.kind);
      mutationBusy.current = true;
      detailReadGeneration.current++;transport.cancel('detail');
      publishDetail(value=>value.status==='loading'?{...value,status:value.data?'ready':'idle'}:value);
      const sending={...current,busy:true,error:'',...(receipted?{frozenMutation:JSON.parse(JSON.stringify(mutation))}:{})};formRef.current=sending;setForm(sending);
      const value = await transport.write(mutation,current.scope);
      if (value === undefined || !current.scope.current()||formRef.current?.seq !== current.seq) return;
      const data = current.kind==='deliverable-approve'?parseProjectDeliverableApproval(value,current,sesion.usuario.id)
        :isProjectChildCreation(current.kind)?parseProjectChildCreation(value,current,sesion.usuario.id):parseProject(value.proyecto, true);
      if (current.kind !== "create" && data.id !== current.projectId) throw new Error("Proyecto incompatible.");
      setForm(null); formRef.current = null;
      if (current.kind === "create") selectProject(data.id);
      publishDetail({ status: "ready", data, error: "" });
      setMessage(current.kind==='deliverable-approve'?'Aprobación registrada para la versión revisada. Se muestra el estado actual del proyecto.':isProjectChildCreation(current.kind)?'Creación verificada. Se muestra el estado actual del proyecto.':value.idempotent ? "El proyecto ya estaba creado. Mostramos su estado actual." : "Cambios guardados.");
      setListRefresh(version => version + 1);
    } catch (error) {
      if(!current.scope.current())return;
      if(error.status===403){purgeProjectAccess(current.scope);return;}
      const uncertain=Boolean(formRef.current?.frozenMutation)&&![400,401,403,404,409,422].includes(error.status);
      setForm(value => {if(value?.seq!==current.seq)return value;const next={...value,busy:false,...([400,422].includes(error.status)?{frozenMutation:null}:{}),error:uncertain?'No pudimos confirmar el resultado. Conservamos la misma solicitud para verificarla explícitamente.':error.status?projectError(error):'Revisá los datos de la versión observada antes de guardar.',uncertain,conflict:error.status===409||current.kind==='deliverable-approve'&&[401,403,404].includes(error.status),reviewed:false};formRef.current=next;return next;});
    } finally { mutationBusy.current = false; }
  }
  function openTask(event, href) {
    if (!plainClick(event)) return;
    event.preventDefault();
    if (onNavigate) onNavigate(href);
    else navigateWithinApp(window, href);
  }

  const shownList = list.context === filters ? list : { status: 'loading', data: null, error: '' };
  const clientLabel = filterClients.items.find(item => item.id === filters.clientId)?.nombre;
  return <main className="projects-page" aria-label="Proyectos de Render"><div className="pr-shell">
    <header className="pr-page-heading"><div><h1>Proyectos</h1><p>Etapas, entregas y tareas reales en un mismo lugar.</p></div><div className="pr-actions"><button type="button" disabled={form?.busy} onClick={() => { setListRefresh(version => version + 1); if (selection.id) void refreshDetail(); }}>Actualizar</button>{admin && <button type="button" className="pr-primary" disabled={form?.busy || !observationReady} onClick={() => openForm("create")}>Nuevo proyecto</button>}</div></header>
    {message && <p className="pr-notice" role="status">{message}</p>}
    <div className={`pr-layout${selection.id || form?.kind === "create" ? " has-detail" : ""}`}>
      <section className="pr-project-list" aria-label="Lista de proyectos"><div className="pr-filters">
        <FilterSelect label="Cliente" aria-label="Filtrar proyectos por cliente" value={filters.invalid ? 'invalid' : filters.clientId ?? ''} onChange={event => chooseClient(event.target.value)}>
          {filters.invalid && <option value="invalid" disabled>Filtro inválido</option>}<option value="">Todos los clientes</option>
          {filters.clientId !== null && !filterClients.items.some(item => item.id === filters.clientId) && <option value={filters.clientId}>Cliente ID {filters.clientId}</option>}
          {filterClients.items.map(item => <option key={item.id} value={item.id}>{item.nombre} · ID {item.id}</option>)}
        </FilterSelect>
        <FilterSelect label="Estado" value={filters.estado} disabled={filters.invalid} onChange={event => changeListFilters({ estado: event.target.value, offset: 0 })}><option value="">Todos los estados</option><Options values={PROJECT_STATES}/></FilterSelect>{admin && <label className="pr-checkbox"><input type="checkbox" checked={filters.archivados} disabled={filters.invalid} onChange={event => changeListFilters({ archivados: event.target.checked, offset: 0 })}/>Incluir archivados</label>}</div>
        <p className="pr-muted">{filters.invalid ? 'Contexto de listado inválido.' : filters.clientId === null ? 'Todos los clientes.' : `Cliente: ${clientLabel || `ID ${filters.clientId}`}.`} Proyectos de todos los períodos; el mes del cliente no filtra este listado.</p>
        {filterClients.error && <p role="alert">No se pudo cargar el catálogo de clientes. El filtro por ID se conserva.<button type="button" onClick={() => setListRefresh(version => version + 1)}>Reintentar catálogo</button></p>}
        {(filters.invalid || filters.clientId !== null) && <button type="button" onClick={() => changeListFilters({ clientId: null, offset: 0, estado: '', archivados: false, invalid: false })}>Limpiar filtros del listado</button>}
        {shownList.status === "loading" && <p className="pr-empty" role="status">Cargando proyectos…</p>}
        {shownList.error && <div className="pr-error" role="alert"><p>{shownList.error}</p><button type="button" onClick={() => setListRefresh(version => version + 1)}>Reintentar lista</button></div>}
        {shownList.data && <><p className="pr-list-total">{shownList.data.total ? `Mostrando ${shownList.data.offset + 1}–${shownList.data.offset + shownList.data.proyectos.length} de ${shownList.data.total}` : "No hay proyectos con este filtro."}</p><ul>{shownList.data.proyectos.map(item => <li key={item.id}><a href={projectHref(item.id, contextHref)} aria-current={selection.id === item.id ? "page" : undefined} onClick={event => { if (!plainClick(event)) return; event.preventDefault(); if (selection.id !== item.id && canLeave()) selectProject(item.id); }}><strong>{item.titulo}</strong><span>{item.cliente.nombre} · {PROJECT_TYPES[item.tipo]}</span><small>{PROJECT_STATES[item.estado]}{item.archivado ? " · Archivado" : ""} · {item.counts.finalizadas}/{item.counts.tareas} tareas finalizadas</small><small>Entrega: {projectDate(item.fecha_entrega)}</small></a></li>)}</ul>
          <nav className="pr-pagination" aria-label="Páginas de proyectos"><button type="button" disabled={shownList.data.offset === 0} onClick={() => changeListFilters({ offset: Math.max(0, shownList.data.offset - shownList.data.limit) })}>Anterior</button><button type="button" disabled={shownList.data.offset + shownList.data.limit >= shownList.data.total} onClick={() => changeListFilters({ offset: shownList.data.offset + shownList.data.limit })}>Siguiente</button></nav></>}
      </section>
      <div className="pr-detail-column">
        {selection.id && <a href={projectLocationUrl(contextHref, null)} className="pr-back" onClick={event => { if (!plainClick(event)) return; event.preventDefault(); if (canLeave()) selectProject(null); }}>← Volver al listado{filters.clientId !== null ? ` del cliente ID ${filters.clientId}` : ''}</a>}
        {project && filters.clientId !== null && project.cliente.id !== filters.clientId && <p className="pr-notice">El proyecto seleccionado pertenece a otro cliente. El filtro solo limita el listado; no modifica este proyecto ni sus permisos.</p>}
        {selection.invalid && <div className="pr-error" role="alert">El enlace no contiene un proyecto válido. Elegí uno de la lista.</div>}
        {detail.status === "loading" && selection.id && <p className="pr-empty" role="status">Actualizando proyecto…</p>}
        {project && !observationReady && <p className="pr-notice" role="status">Mostramos la última versión observada, pendiente de actualizar. Conservamos tu borrador; podés editarlo o cerrar con confirmación. Guardar, verificar solicitudes y abrir otros formularios requiere actualizar el proyecto correctamente.</p>}
        {detail.error && <div className="pr-error" role="alert"><p>{detail.error}</p><button type="button" onClick={() => refreshDetail(Boolean(form?.conflict))}>Reintentar proyecto</button></div>}
        {form && (form.kind === "create" || project) && <ProjectEditor {...{ form, project, catalog, change, cancel: cancelForm, submit, refresh: () => refreshDetail(true), adoptRevision, lookupTask, retryCatalog: loadCatalog, moveStage, observationReady }}/>}
        {project && <Detail project={project} openForm={openForm} openTask={openTask} observationReady={observationReady}/>}
        {!selection.id && !selection.invalid && !form && <section className="pr-select-prompt"><h2>Elegí un proyecto</h2><p>Podés consultar su trabajo sin cambiar los permisos de las tareas vinculadas.</p></section>}
        {dirty && <p className="pr-draft-note">Borrador sin guardar. No se conserva al cerrar la sesión.</p>}
      </div>
    </div>
  </div></main>;
}
