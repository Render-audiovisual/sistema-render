import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "../features/render-os/services/render-os-api.js";
import { useNavigationGuard } from "../shared/navigation/useNavigationGuard.js";
import { navigateWithinApp } from "../shared/navigation/location.js";
import { CATEGORIAS_NOTA } from "./BlocNotas.jsx";
import { markFeedbackSeen } from "../features/render-os/utils/feedback-notifications.js";
import { useSessionView } from "../shared/session/use-session-view.js";
import { getSesion } from "../utils.jsx";
import { createFeedbackScopedRequest, createFeedbackNotesReader, readFeedbackNotesLocation, feedbackNotesLocationUrl, feedbackNotesPageUrl, parseFeedbackNotesPage } from "./feedbackNotesPagination.js";
import { createCapturedRequest } from "../shared/session/captured-request.js";
import { createFeedbackNotesMutation } from "./feedbackNotesMutation.js";
import "./Feedback.css";
import { FeedbackTaskInventory } from './FeedbackTaskInventory.jsx';

const EDITABLE_CATEGORIES = CATEGORIAS_NOTA.filter((category) => category.id !== "todas");
const CATEGORY_LABELS = Object.fromEntries(EDITABLE_CATEGORIES.map((category) => [category.id, category.label]));
const emptyDraft = (section) => ({
  titulo: "",
  contenido: "",
  categoria: section === "team" ? "reunion" : "general",
  feedback: { cliente: "", responsable: "", responsables: [], referencia: "", estado: "pendiente", vigencia: "puntual", flujo: "feedback" },
});

export function feedbackBusinessInput(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    ["cliente", "responsable", "responsables", "referencia", "estado", "vigencia", "flujo"]
      .filter((key) => Object.prototype.hasOwnProperty.call(value, key))
      .map((key) => [key, value[key]]),
  );
}

function feedbackResponsibles(note) {
  const values = Array.isArray(note?.feedback?.responsables) ? note.feedback.responsables : [note?.feedback?.responsable];
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" }) : "";
}

function Reference({ text }) {
  let href;
  try { const url = new URL(text); if (["https:", "http:"].includes(url.protocol)) href = url.href; } catch { /* Plain references are valid. */ }
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{text}<span aria-hidden="true">↗</span></a> : <p>{text}</p>;
}

function feedbackNotesLocation() {
  try { return {selection:readFeedbackNotesLocation(window.location.search),error:""}; }
  catch { return {selection:null,error:"Los filtros o la página de notas no son válidos. Reiniciá el listado."}; }
}
export function FeedbackPage({ request = apiRequest, sesion = null }) {
  const view = useSessionView(sesion);
  return <FeedbackContent key={view.key} transport={request} view={view} sesion={sesion}/>;
}
function FeedbackContent({transport,view,sesion}) {
  const [location,setLocation] = useState(feedbackNotesLocation);
  const selection = location.selection;
  const section = selection?.section ?? "clients", trash = selection?.papelera ?? false;
  const mounted = useRef(false), contextEpoch = useRef(0), panelEpoch = useRef(0), readerRef = useRef(null), mutationRef = useRef(null), preparedPage = useRef(null);
  const request = useMemo(() => createFeedbackScopedRequest({session:view.session,readSession:getSesion,request:transport,
    isActive:()=>mounted.current&&["/feedback","/bloc-notas"].includes(window.location.pathname),readContext:()=>contextEpoch.current}),[transport,view]);
  useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;contextEpoch.current++;readerRef.current?.dispose()}},[]);
  const [page,setPage] = useState(null);
  const [mutation,setMutation] = useState({phase:"idle",busy:false,locked:false,accepted:null,observed:null});
  const [notes, setNotes] = useState([]);
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState(selection?.q ?? "");
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState(null);
  const [baseline, setBaseline] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const [duplicates, setDuplicates] = useState([]);
  const titleRef = useRef(null);
  const lock = useRef(false);
  const linkedNoteId = useRef(selection?.note ?? null);
  const restoreLocationRef = useRef(null);
  const dirty = Boolean(draft && JSON.stringify(draft) !== baseline);
  const panelOpen = Boolean(selected || draft);
  useNavigationGuard(() => {
    const state=mutationRef.current?.model.snapshot;
    return {dirty:dirty||Boolean(state?.locked),busy:lock.current||Boolean(state?.locked&&state.phase!=="duplicates")};
  });
  useLayoutEffect(()=>{
    const entry={active:true,model:null};
    const epoch=contextEpoch.current;
    const capture=()=>createCapturedRequest({session:view.session,readSession:getSesion,request:transport,
      isActive:()=>entry.active&&mounted.current&&mutationRef.current===entry&&contextEpoch.current===epoch&&["/feedback","/bloc-notas"].includes(window.location.pathname)});
    entry.scope=capture();
    entry.model=createFeedbackNotesMutation({capture,onChange:state=>{if(entry.scope.current())setMutation(state)},
      refresh:async scope=>{
        const first={...(selection??{section:"clients",papelera:false,categoria:null,q:"",limit:50}),offset:0,expected_snapshot:null};
        const value=await scope.request(feedbackNotesPageUrl(first),{cache:"no-store"});scope.assertCurrent();
        return parseFeedbackNotesPage(value,first);
      }});
    mutationRef.current=entry;lock.current=false;setBusy(false);setMutation(entry.model.snapshot);
    return()=>{entry.active=false;entry.model.cancel();};
  },[request,location]);
  restoreLocationRef.current = () => {
    if (!["/feedback", "/bloc-notas"].includes(window.location.pathname)) return;
    const next = feedbackNotesLocation();
    contextEpoch.current++;panelEpoch.current++;readerRef.current?.invalidate();
    linkedNoteId.current = next.selection?.note ?? null;
    setLocation(next);setQuery(next.selection?.q ?? "");setNotes([]);setPage(null);
    setSelected(null);setDraft(null);setBaseline("");setConflict(false);setDuplicates([]);
  };
  useEffect(() => {
    const restore = () => restoreLocationRef.current?.();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  useEffect(() => {
    if (!panelOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [panelOpen]);

  useEffect(() => {
    if (!selection) { setLoading(false);return undefined; }
    const reader = createFeedbackNotesReader({request,onChange:state=>{
      setPage(state);setNotes(state.data?.items ?? []);setLoading(state.status==="loading");
      if(state.status==="ready"&&!trash)markFeedbackSeen(sesion?.usuario);
    }});
    readerRef.current=reader;
    const confirmed=preparedPage.current?.location===location?preparedPage.current.data:null;
    if(confirmed){setPage({status:"ready",data:confirmed,error:""});setNotes(confirmed.items);setLoading(false);}else void reader.load(selection);
    const noteId=linkedNoteId.current??selection.note, observedPanel=panelEpoch.current;
    if(noteId&&!confirmed)void reader.detail(noteId,trash).then(item=>{
      if(readerRef.current===reader&&observedPanel===panelEpoch.current){linkedNoteId.current=null;setSelected(item);}
    }).catch(reason=>{if(reason.code!=="session_binding_obsolete"&&readerRef.current===reader&&observedPanel===panelEpoch.current)setError(reason.message||"No pudimos abrir la nota.");});
    return ()=>{reader.dispose();if(readerRef.current===reader)readerRef.current=null;};
  }, [request, location]);

  useEffect(() => {
    let active = true;
    Promise.all([request("/api/clientes"), request("/api/usuarios")]).then(([clientRows, userRows]) => {
      if (active) { setClients(clientRows); setUsers(userRows); }
    }).catch((reason) => { if (active && reason.code !== "session_binding_obsolete") setMessage("No pudimos cargar las sugerencias, pero podés escribir los datos manualmente."); });
    return () => { active = false; };
  }, [request, location]);

  useEffect(() => { if (draft) titleRef.current?.focus(); }, [draft?.id, Boolean(draft)]);

  function moveNotes(changes) {
    if (!selection) return;
    try { navigateWithinApp(window,feedbackNotesLocationUrl(window.location.href,{...selection,...changes},null)); }
    catch(reason){setError(reason.message);}
  }
  function restartNotes(item = null, confirmed = null) {
    contextEpoch.current++;panelEpoch.current++;readerRef.current?.invalidate();
    const next={...(selection ?? {section:"clients",papelera:false,categoria:null,q:"",limit:50}),offset:0,expected_snapshot:null,note:item?.id??null};
    window.history.replaceState(window.history.state,"",feedbackNotesLocationUrl(window.location.href,next,next.note));
    linkedNoteId.current=next.note;
    const nextLocation={selection:next,error:""};
    preparedPage.current=confirmed?{location:nextLocation,data:confirmed}:null;
    setNotes(confirmed?.items??[]);setPage(confirmed?{status:"ready",data:confirmed,error:""}:null);setLoading(!confirmed);setLocation(nextLocation);
  }
  function recordSelected(note) {
    panelEpoch.current++;
    if(selection)window.history.replaceState(window.history.state,"",feedbackNotesLocationUrl(window.location.href,selection,note?.id??null));
  }

  function canLeave() {
    const model=mutationRef.current?.model,state=model?.snapshot;
    if(lock.current||state?.locked&&state.phase!=="duplicates")return false;
    if((dirty||state?.locked)&&!window.confirm("Tenés cambios sin guardar. ¿Querés descartarlos?"))return false;
    if(state?.phase==="duplicates")model.releaseUnsent();
    return true;
  }
  function acceptMutation(result) {
    const model=mutationRef.current?.model;
    if(!result?.ack||model?.snapshot.phase!=="complete")return;
    model.complete(); // Settle receipt ownership BEFORE changing the page context.
    const item=result.ack.note, visibleItem=item&&(item.eliminado_at!==null)===trash?item:null;
    setSelected(visibleItem);setDraft(null);setBaseline("");setDuplicates([]);setConflict(false);setError("");
    if(!item)setMessage("La operación está confirmada. La nota ya no está disponible; fue eliminada definitivamente.");
    else setMessage(result.ack.operation.replayed?"Intento verificado. Se muestra el estado actual de la nota.":"Operación confirmada.");
    markFeedbackSeen(sesion?.usuario);
    restartNotes(visibleItem,result.data);
  }
  async function runMutation(action) {
    if(lock.current)return;
    const entry=mutationRef.current;if(!entry?.scope.current())return;
    lock.current=true;setBusy(true);setError("");
    try{
      const result=await action(entry.model);
      if(!entry.scope.current()||mutationRef.current!==entry)return;
      if(result?.duplicates)setDuplicates(result.duplicates);
      else acceptMutation(result);
    }catch(reason){
      if(reason.code!=="session_binding_obsolete"&&entry.scope.current()){
        setError(reason.message||"No se pudo confirmar la operación. Tu texto se conserva.");
        setConflict(entry.model.snapshot.phase==="conflict");
      }
    }finally{if(mutationRef.current===entry){lock.current=false;if(entry.active)setBusy(false);}}
  }
  function verifyMutation(){void runMutation(model=>model.verify());}
  function observeMutation(){void runMutation(model=>model.observe());}
  function finishConflict(){
    const model=mutationRef.current?.model;
    if(lock.current||model?.snapshot.phase!=="reviewed")return;
    const observed=model.releaseConflict();setConflict(true);setError("");
    setMessage("Revisión cerrada. Tu borrador conserva su versión anterior; copiá el texto y abrí la nota actual para editarla.");
    const item=observed?.note&&(observed.note.eliminado_at!==null)===trash?observed.note:null;
    setSelected(item);restartNotes(item);
  }

  function backToTasks() {
    const fromTasks = window.history.state?.fromTasks;
    if (typeof fromTasks === "string") {
      try {
        const origin = new URL(fromTasks, window.location.origin);
        if (origin.origin === window.location.origin && origin.pathname === "/workspace/tareas") {
          return navigateWithinApp(window, `${origin.pathname}${origin.search}${origin.hash}`);
        }
      } catch { /* Un origen inválido vuelve al tablero canónico. */ }
    }
    return navigateWithinApp(window, "/workspace/tareas");
  }

  function openNote(note) {
    if (!canLeave()) return;
    recordSelected(note);
    setSelected(note);
    setDraft(null);
    setBaseline("");
    setError("");
    setMessage("");
    setConflict(false);
  }

  function changeSection(nextSection) {
    if (nextSection === section) return;
    moveNotes({section:nextSection,offset:0,expected_snapshot:null});
  }

  function createNote() {
    if (!canLeave()) return;
    recordSelected(null);
    const next = {...emptyDraft(section),section:section==="team"?"team":"clients"};
    setSelected(null);
    setDraft(next);
    setBaseline(JSON.stringify(next));
    setError("");
    setConflict(false);
    setDuplicates([]);
  }

  function editNote(note) {
    if(lock.current||mutationRef.current?.model.snapshot.locked)return;
    recordSelected(note);
    const next = {
      ...note,
      feedback: {
        ...emptyDraft(note.section ?? section).feedback,
        ...note.feedback,
        cliente: note.resolved_client ?? note.feedback?.cliente ?? "",
        responsables: feedbackResponsibles(note),
      },
    };
    setSelected(note);
    setDraft(next);
    setBaseline(JSON.stringify(next));
    setError("");
    setConflict(false);
    setDuplicates([]);
  }

  function closePanel() {
    if (!canLeave()) return;
    recordSelected(null);
    setSelected(null);
    setDraft(null);
    setBaseline("");
    setConflict(false);
    setDuplicates([]);
  }

  async function persistDraft({ skipDuplicateCheck = false } = {}) {
    if(skipDuplicateCheck&&mutationRef.current?.model.snapshot.phase==="duplicates")return runMutation(model=>model.confirmCreate());
    const writeSection=draft?.section??section,clientName=String(draft?.feedback?.cliente||"").trim(),responsables=feedbackResponsibles(draft);
    if(lock.current||mutationRef.current?.model.snapshot.locked||conflict||!draft?.titulo.trim()||!draft?.contenido.trim()
      ||!responsables.length||writeSection==="clients"&&!clientName)return;
    const fields={titulo:draft.titulo.trim(),contenido:draft.contenido,categoria:draft.categoria,
      feedback:{...feedbackBusinessInput(draft.feedback),responsables,responsable:responsables[0],cliente:writeSection==="team"?"":clientName,flujo:"feedback"}};
    return runMutation(model=>model.start({action:draft.id?"edit":"create",note:draft.id?{id:draft.id,updated_at:draft.updated_at}:undefined,fields},{checkDuplicates:!draft.id&&!skipDuplicateCheck}));
  }

  function save(event) {
    event.preventDefault();
    void persistDraft();
  }

  function updateDuplicate(noteId) {
    if(lock.current)return;
    const model=mutationRef.current?.model;
    if(model?.snapshot.phase==="duplicates")model.releaseUnsent();
    else if(model?.snapshot.locked)return;
    const existing = notes.find((note) => Number(note.id) === Number(noteId));
    const apply = item => {
      setDraft((current)=>({...current,id:item.id,updated_at:item.updated_at,section:item.section??current.section}));
      setDuplicates([]);setMessage("Vas a actualizar el feedback existente con estos datos.");
    };
    if(existing){apply(existing);return;}
    const reader=readerRef.current,observedPanel=panelEpoch.current;
    if(!reader)return;
    lock.current=true;setBusy(true);
    void reader.detail(Number(noteId),false).then(item=>{
      if(readerRef.current===reader&&panelEpoch.current===observedPanel)apply(item);
    }).catch(reason=>{if(reason.code!=="session_binding_obsolete"&&readerRef.current===reader)setError(reason.message||"No pudimos abrir el feedback anterior.");})
      .finally(()=>{if(readerRef.current===reader&&panelEpoch.current===observedPanel){lock.current=false;setBusy(false);}});
  }

  async function toggleStatus(note) {
    if(note.source==="task"||lock.current||mutationRef.current?.model.snapshot.locked)return;
    const nextStatus=note.feedback?.estado==="resuelto"?"pendiente":"resuelto";
    return runMutation(model=>model.start({action:"edit",note:{id:note.id,updated_at:note.updated_at},
      fields:{feedback:{...feedbackBusinessInput(note.feedback),estado:nextStatus}}}));
  }

  async function trashAction(note) {
    if(lock.current||!canLeave())return;
    if(!trash&&!window.confirm(`¿Mover “${note.titulo}” a la Papelera? Podés restaurarlo después.`))return;
    return runMutation(model=>model.start({action:trash?"restore":"trash",note:{id:note.id,updated_at:note.updated_at}}));
  }

  const clientOptions = useMemo(() => [...new Set([
    ...clients.map((item) => item.nombre),
    ...notes.map((note) => note.feedback?.cliente),
  ].filter(Boolean))].sort((left, right) => left.localeCompare(right, "es")), [clients, notes]);

  const visible = notes;
  const panelSection = draft?.section ?? selected?.section ?? section;

  const change = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const changeMeta = (key, value) => setDraft((current) => ({ ...current, feedback: { ...current.feedback, [key]: value } }));
  const toggleResponsible = (name) => setDraft((current) => {
    const selected = feedbackResponsibles(current);
    const responsables = selected.includes(name) ? selected.filter((item) => item !== name) : [...selected, name];
    return { ...current, feedback: { ...current.feedback, responsables, responsable: responsables[0] || "" } };
  });
  const sectionTitle = section === "all" ? "Todas las notas" : section === "clients" ? "Feedback de clientes" : "Feedback del equipo";
  const sectionCopy = section === "clients" ? "Pedidos, correcciones y comentarios de cada cliente." : "Conclusiones y acuerdos de nuestras reuniones internas.";

  const recoveryControls=<section aria-label="Estado de la operación de nota">
    {error&&<p className="rf-conflict" role="alert">{error}</p>}
    {["preflight","writing"].includes(mutation.phase)&&<p className="rf-message" role="status">Confirmando la operación…</p>}
    {mutation.phase==="uncertain"&&<><p className="rf-conflict" role="alert">No sabemos si la operación se guardó. No vuelvas a crearla: verificá únicamente este mismo intento.</p><button type="button" disabled={busy} onClick={verifyMutation}>Verificar el mismo intento</button></>}
    {mutation.phase==="read_failed"&&<><p className="rf-message">La operación está confirmada. Falta actualizar el listado; no volveremos a enviarla.</p><button type="button" disabled={busy} onClick={verifyMutation}>Actualizar listado confirmado</button></>}
    {mutation.phase==="conflict"&&<><p className="rf-conflict">La nota cambió o ya no está disponible. Tu texto y su versión original se conservan.</p><button type="button" disabled={busy} onClick={observeMutation}>Observar versión actual</button></>}
    {mutation.phase==="reviewed"&&<><p className="rf-message">{mutation.observed?.note?`Versión actual observada: ${mutation.observed.note.titulo} · ${formatDate(mutation.observed.note.updated_at)}`:"La nota no está disponible o la operación de creación no identifica una nota observable."}</p><button type="button" disabled={busy} onClick={finishConflict}>Cerrar revisión y conservar borrador</button></>}
    {mutation.phase==="blocked"&&<p className="rf-conflict" role="alert">La sesión o el contexto cambió. No enviaremos otro intento desde aquí.</p>}
  </section>;

  return <main className="render-feedback">
    <header className="rf-header">
      <div><span className="rf-eyebrow">NOTAS Y SEGUIMIENTO</span><h1>Feedback</h1><p>Todo lo importante, ordenado y fácil de consultar.</p></div>
      <div className="rf-header-actions"><button className="rf-back-tasks" type="button" onClick={backToTasks}>← Volver a tareas</button><button className="rf-primary" disabled={busy || trash} onClick={createNote}>+ Nuevo feedback</button></div>
    </header>

    {!trash && <FeedbackTaskInventory request={transport} sesion={sesion} clients={clients}/>}

    <nav className="rf-section-switch" aria-label="Tipo de feedback">
      <button type="button" aria-pressed={section === "team"} className={section === "team" ? "active" : ""} onClick={() => changeSection("team")}><span>♙</span><b>Equipo</b></button>
      <button type="button" aria-pressed={section === "clients"} className={section === "clients" ? "active" : ""} onClick={() => changeSection("clients")}><span>◎</span><b>Clientes</b></button>
    </nav>

    <section className="rf-intro"><div><h2>{trash ? `Papelera · ${sectionTitle}` : sectionTitle}</h2><p>{sectionCopy}</p></div><button className="rf-trash-toggle" disabled={busy} onClick={() => moveNotes({papelera:!trash,q:"",offset:0,expected_snapshot:null})}>{trash ? "← Volver" : "Papelera"}</button></section>

    <form className="rf-toolbar" onSubmit={event=>{event.preventDefault();moveNotes({q:query,offset:0,expected_snapshot:null});}}>
      <label className="rf-search"><span aria-hidden="true">⌕</span><input aria-label="Buscar feedback" type="search" placeholder="Buscar por título, contenido o responsable…" value={query} onChange={(event) => setQuery(event.target.value)}/></label>
      <button type="submit" disabled={busy}>Buscar</button>
      <label>Categoría<select aria-label="Filtrar categoría de notas" value={selection?.categoria??""} disabled={busy} onChange={event=>moveNotes({categoria:event.target.value||null,offset:0,expected_snapshot:null})}><option value="">Todas</option>{EDITABLE_CATEGORIES.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <small role="status">{page?.data ? `${page.data.total} notas en total` : "Notas"}</small>
    </form>

    {(location.error || page?.error) && <div className="rf-error" role="alert">{location.error || page.error}<button type="button" disabled={busy} onClick={()=>{if(canLeave())restartNotes(selected)}}>{page?.status==="stale"?"El listado cambió · Reiniciar desde la primera página":"Reiniciar listado"}</button></div>}
    {error && <div className="rf-error" role="alert">{error}{!panelOpen && <button disabled={busy||mutation.locked} onClick={() => restartNotes(selected)}>Reintentar</button>}</div>}
    {message && <p className="rf-message" role="status">{message}</p>}
    {!panelOpen&&mutation.locked&&recoveryControls}

    {loading ? <div className="rf-loading" role="status"><span/><span/><span/></div> : <div className="rf-grid">
      {visible.map((note) => <button type="button" className="rf-note-card" key={note.id} onClick={() => openNote(note)}>
        <span className="rf-note-icon" aria-hidden="true">▤</span>
        <span className="rf-note-copy"><small><span>{note.section === "clients" ? note.resolved_client : CATEGORY_LABELS[note.categoria] || "General"}</span><i className={`rf-status ${note.feedback?.estado === "resuelto" ? "is-resolved" : ""}`}>{note.feedback?.estado === "resuelto" ? "Resuelto" : "Pendiente"}</i></small><strong>{note.titulo || "Sin título"}</strong><em>{feedbackResponsibles(note).join(", ") || note.modificado_por || "Equipo RENDER"} · {formatDate(note.updated_at)}</em></span>
        <span className="rf-note-arrow" aria-hidden="true">›</span>
      </button>)}
      {!visible.length && !error && !page?.error && !location.error && <div className="rf-empty"><span>▤</span><strong>{selection?.q ? "No encontramos resultados" : trash ? "La Papelera está vacía" : `Todavía no hay feedback de ${section === "clients" ? "clientes" : "equipo"}`}</strong><p>{selection?.q ? "Probá con otra búsqueda." : "Creá una nota para guardar la información importante."}</p></div>}
    </div>}

    {panelOpen && <div className="rf-panel-backdrop" role="presentation" onMouseDown={closePanel}>
      <section className={`rf-panel ${draft ? "is-editing" : ""}`} role="dialog" aria-modal="true" aria-label={draft ? (draft.id ? "Editar feedback" : "Nuevo feedback") : selected?.titulo} onMouseDown={(event) => event.stopPropagation()}>
        <header className="rf-panel-header"><div><span>{panelSection === "clients" ? "CLIENTE" : "EQUIPO"}</span><strong>{draft ? (draft.id ? "Editar feedback" : "Nuevo feedback") : selected?.titulo}</strong></div><button type="button" aria-label="Cerrar" onClick={closePanel}>×</button></header>

        {recoveryControls}
        {draft ? <form className="rf-editor" onSubmit={save}>
          <fieldset disabled={busy}>
            <fieldset className="rf-fields" disabled={mutation.locked} style={{border:0,margin:0,padding:0,minWidth:0}}>
              {panelSection === "clients" && <label className="rf-wide">Cliente<input ref={!draft.id ? titleRef : undefined} required list="rf-clients" maxLength={200} value={draft.feedback.cliente} onChange={(event) => changeMeta("cliente", event.target.value)}/><datalist id="rf-clients">{clientOptions.map((name) => <option key={name} value={name}/>)}</datalist></label>}
              <label className="rf-wide">Título<input ref={panelSection === "team" || draft.id ? titleRef : undefined} required value={draft.titulo} placeholder={panelSection === "team" ? "Ej.: Reunión semanal de comunicación" : "Ej.: Corrección de campaña de septiembre"} onChange={(event) => change("titulo", event.target.value)}/></label>
              <label className="rf-wide">Detalle<textarea required rows={9} value={draft.contenido} placeholder="Escribí el feedback completo…" onChange={(event) => change("contenido", event.target.value)}/></label>
              <fieldset className="rf-people rf-wide"><legend>Responsables <small>Elegí al menos uno</small></legend><div>{users.map((user) => { const name = user.nombre || user.usuario; return <label key={user.id || user.usuario} className={feedbackResponsibles(draft).includes(name) ? "selected" : ""}><input type="checkbox" checked={feedbackResponsibles(draft).includes(name)} onChange={() => toggleResponsible(name)}/><span>{name}</span></label>; })}</div></fieldset>
              <label>Categoría<select value={draft.categoria} onChange={(event) => change("categoria", event.target.value)}>{EDITABLE_CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
              <label>Vigencia<select value={draft.feedback.vigencia || "puntual"} onChange={(event) => changeMeta("vigencia", event.target.value)}><option value="puntual">Puntual</option><option value="permanente">Permanente</option></select></label>
              <label>Estado<select value={draft.feedback.estado || "pendiente"} onChange={(event) => changeMeta("estado", event.target.value)}><option value="pendiente">Pendiente</option><option value="resuelto">Resuelto</option></select></label>
              <label className="rf-wide">Referencia · opcional<input maxLength={2000} placeholder="Enlace, mensaje o dato relacionado" value={draft.feedback.referencia??""} onChange={(event) => changeMeta("referencia", event.target.value)}/></label>
            </fieldset>
            {duplicates.length > 0 && <section className="rf-duplicates" role="alert"><strong>Encontré un feedback parecido</strong><p>Podés actualizar el anterior o guardar este como uno nuevo.</p>{duplicates.map((item) => <div key={item.id}><span>{item.cliente} · {item.titulo}</span><button type="button" onClick={() => updateDuplicate(item.id)}>Modificar anterior</button></div>)}<button type="button" className="rf-save-anyway" onClick={() => void persistDraft({ skipDuplicateCheck: true })}>Crear uno nuevo igualmente</button></section>}
            <div className="rf-form-actions"><button type="button" onClick={closePanel}>Cancelar</button><button className="rf-primary" disabled={conflict||mutation.locked} type="submit">{busy ? "Guardando…" : "Guardar feedback"}</button></div>
          </fieldset>
          {conflict && <p className="rf-conflict" role="alert">Otra persona guardó una versión más reciente. Tu texto sigue acá para que puedas copiarlo antes de volver a cargar.</p>}
        </form> : selected && <div className="rf-detail">
          <div className="rf-detail-heading"><span>{(selected.resolved_client ?? selected.feedback?.cliente) || CATEGORY_LABELS[selected.categoria] || "Reunión"}</span><h2>{selected.titulo}</h2><p>Actualizado por {selected.modificado_por} · {formatDate(selected.updated_at)}</p></div>
          <div className="rf-detail-content">{selected.contenido || "Sin contenido."}</div>
          {selected.feedback?.referencia && <section className="rf-reference"><span>REFERENCIA</span><Reference text={selected.feedback.referencia}/></section>}
          <dl className="rf-detail-meta"><div><dt>Responsables</dt><dd>{feedbackResponsibles(selected).join(", ") || "Sin asignar"}</dd></div><div><dt>Estado</dt><dd>{selected.feedback?.estado === "resuelto" ? "Resuelto" : "Pendiente"}</dd></div><div><dt>Vigencia</dt><dd>{selected.feedback?.vigencia === "permanente" ? "Permanente" : "Puntual"}</dd></div><div><dt>Categoría</dt><dd>{CATEGORY_LABELS[selected.categoria] || "General"}</dd></div><div><dt>Creado por</dt><dd>{selected.creado_por}</dd></div></dl>
          <footer className="rf-detail-actions">{trash ? <button className="rf-primary" disabled={busy||mutation.locked} onClick={() => trashAction(selected)}>Restaurar feedback</button> : <><button className="rf-danger" disabled={busy||mutation.locked} onClick={() => trashAction(selected)}>Mover a Papelera</button><button disabled={busy||mutation.locked} onClick={() => toggleStatus(selected)}>{selected.feedback?.estado === "resuelto" ? "Marcar pendiente" : "Marcar resuelto"}</button><button className="rf-primary" disabled={busy||mutation.locked} onClick={() => editNote(selected)}>Editar feedback</button></>}</footer>
        </div>}
      </section>
    </div>}

    {page?.data && <nav className="rf-pagination" aria-label="Páginas de notas">
      <p role="status">Página {Math.floor(page.data.offset/page.data.limit)+1} · {page.data.total} notas en total</p>
      <button type="button" disabled={busy||loading||page.data.offset===0} onClick={()=>moveNotes({offset:Math.max(0,page.data.offset-page.data.limit),expected_snapshot:page.data.snapshot})}>Anterior</button>
      <button type="button" disabled={busy||loading||!page.data.has_more} onClick={()=>moveNotes({offset:page.data.offset+page.data.limit,expected_snapshot:page.data.snapshot})}>Siguiente</button>
    </nav>}
  </main>;
}
