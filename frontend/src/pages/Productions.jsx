import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getHoyLocalISO } from '../utils.jsx';
import { apiRequest } from '../features/render-os/services/render-os-api.js';
import { useNavigationGuard } from '../shared/navigation/useNavigationGuard.js';
import { hasReviewedProductionContext, productionVisitEditInput } from './productionVisitEdit.js';
import { createProductionDraft, productionMediaDraft, productionVisitDraft, verifiedProductionDraftVisit } from './productionDraft.js';
import './Productions.css';

const VIDEO_STATES = { planificado:'Planificado', grabado:'Grabado', pendiente:'Pendiente', repetir:'Repetir' };
const PHOTO_STATES = { realizada:'Realizada', pendiente:'Pendiente', repetir:'Repetir' };
const TASK_STATES = { pendiente:'Pendiente', en_progreso:'En proceso', en_revision:'Para revisar', aprobada:'Aprobada', finalizada:'Finalizada', publicada:'Finalizada' };
const positiveId = value => Number.isSafeInteger(value) && value > 0;
function safeProductionUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}
function productionMonthDays(month) {
  const [year, number] = month.split('-').map(Number);
  const offset = (new Date(Date.UTC(year, number - 1, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return [...Array(offset).fill(null), ...Array.from({length:count}, (_, index) => `${month}-${String(index + 1).padStart(2,'0')}`)];
}
function shiftProductionMonth(month, amount) {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1 + amount, 1)).toISOString().slice(0,7);
}
const monthLabel = month => new Intl.DateTimeFormat('es-AR', {month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${month}-01T12:00:00Z`));
const dateLabel = date => new Intl.DateTimeFormat('es-AR', {weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`));
const visitDTO = data => data?.visita || data;
function productionLocation(href) {
  const url = new URL(href);
  const id = url.searchParams.get('visita');
  if (id && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw new Error('El enlace de la visita no es válido.');
  const month = url.searchParams.get('mes');
  return {id,month:/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '') ? month : null};
}
function writeProductionLocation({id = null, month, replace = false}) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('visita',id); else url.searchParams.delete('visita');
  if (month) url.searchParams.set('mes',month);
  if (url.href !== window.location.href) window.history[replace ? 'replaceState' : 'pushState'](window.history.state,'',url);
}

// CAS always uses the visit version supplied by the visible form, never a newer hidden ref.
async function productionWrite({ visit, path = '', method = 'PATCH', data, request = apiRequest, refresh }) {
  if (!positiveId(visit?.revision)) throw new Error('Recargá la visita antes de guardar: falta su revisión actual.');
  try {
    return await request(`/api/producciones/${encodeURIComponent(visit.id)}${path}`, {
      method, headers:{'Content-Type':'application/json'}, body:JSON.stringify({...data, expected_revision:visit.revision}),
    });
  } catch (error) {
    if (error.status === 409) {
      let refreshed = false;
      try { await refresh(visit.id); refreshed = true; } catch { /* Preserve inputs even when offline. */ }
      error.message = refreshed
        ? 'La visita cambió. Recargamos sus datos; conservamos lo que escribiste. Revisá antes de volver a guardar.'
        : 'La visita cambió y no se pudo recargar. Conservamos lo que escribiste; recargá antes de guardar.';
    }
    throw error; // Never retry a registration or handoff automatically.
  }
}

function SafeLink({url, children = 'Abrir Drive'}) {
  const href = safeProductionUrl(url);
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{children} ↗</a> : url ? <span className="prod-muted">Enlace no válido</span> : null;
}
function Participants({users, selected, onChange, disabled}) {
  return <fieldset className="prod-participants" disabled={disabled}><legend>Participantes</legend>{users.map(user => <label key={user.id}><input type="checkbox" checked={selected.includes(user.id)} onChange={event => onChange(event.target.checked ? [...selected,user.id] : selected.filter(id => id !== user.id))}/><span>{user.nombre}<small>@{user.usuario || user.id} · #{user.id}</small></span></label>)}{!users.length && <p className="prod-muted">No hay usuarios activos disponibles.</p>}</fieldset>;
}
function CreateVisit({clients, users, date, busy, onCreate, onCancel, onDirty}) {
  const [draft, setDraft] = useState({cliente_id:'',fecha:date,titulo:'',participante_ids:[],tarea_origen_id:'',observaciones:'',drive_url:''});
  const [error, setError] = useState('');
  const submit = async event => {
    event.preventDefault(); setError('');
    try {
      if (!positiveId(Number(draft.cliente_id)) || !draft.titulo.trim()) throw new Error('Elegí cliente y título de la visita.');
      if (draft.drive_url && !safeProductionUrl(draft.drive_url)) throw new Error('Usá un enlace http o https para Drive.');
      const source = draft.tarea_origen_id === '' ? null : Number(draft.tarea_origen_id);
      if (source !== null && !positiveId(source)) throw new Error('El ID de la tarea debe ser un entero positivo.');
      await onCreate({...draft,cliente_id:Number(draft.cliente_id),tarea_origen_id:source,titulo:draft.titulo.trim()});
      onDirty('create',false);
    } catch (reason) { setError(reason.message); }
  };
  return <section className="prod-panel"><header className="prod-section-heading"><h2>Nueva visita</h2><button type="button" disabled={busy} onClick={onCancel}>Cancelar</button></header><form className="prod-form" onSubmit={submit} onChange={()=>onDirty('create',true)}>
    <label>Cliente<select required value={draft.cliente_id} disabled={busy} onChange={e=>setDraft({...draft,cliente_id:e.target.value})}><option value="">Elegí un cliente</option>{clients.map(client=><option value={client.id} key={client.id}>{client.nombre}</option>)}</select></label>
    <label>Fecha<input required type="date" value={draft.fecha} disabled={busy} onChange={e=>setDraft({...draft,fecha:e.target.value})}/></label>
    <label className="prod-wide">Título<input required maxLength={250} value={draft.titulo} disabled={busy} onChange={e=>setDraft({...draft,titulo:e.target.value})}/></label>
    <div className="prod-wide"><Participants users={users} selected={draft.participante_ids} disabled={busy} onChange={ids=>{onDirty('create',true);setDraft({...draft,participante_ids:ids});}}/></div>
    <details className="prod-wide"><summary>Vincular tarea existente (opcional)</summary><label>Tarea de origen (ID)<input inputMode="numeric" type="number" min="1" step="1" value={draft.tarea_origen_id} disabled={busy} onChange={e=>setDraft({...draft,tarea_origen_id:e.target.value})}/></label><small>Usá esta opción solo para vincular una tarea que ya existe.</small></details>
    <label>Carpeta Drive (opcional)<input type="url" value={draft.drive_url} disabled={busy} onChange={e=>setDraft({...draft,drive_url:e.target.value})}/></label>
    <label className="prod-wide">Observaciones<textarea value={draft.observaciones} disabled={busy} onChange={e=>setDraft({...draft,observaciones:e.target.value})}/></label>
    {error && <p className="prod-error prod-wide" role="alert">{error}</p>}<footer className="prod-wide"><button className="prod-primary" disabled={busy} type="submit">{busy ? 'Guardando…' : 'Crear visita'}</button></footer>
  </form></section>;
}

function useProductionDraft({visit, source, key, onDirty, onReload}) {
  const [draftModel] = useState(()=>createProductionDraft(visit,source(visit)));
  const latest = useRef(null), mounted = useRef(false);
  const [,render] = useState(0);
  const state = draftModel.snapshot;
  const publish = () => { if (mounted.current) render(value=>value+1); };
  const report = () => {if(mounted.current){const next=draftModel.snapshot;onDirty(key,next.dirty || next.blocked || next.pending);}};
  useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;onDirty(key,false);}},[key,onDirty]);
  // Do not mutate the model on speculative React renders. begin() independently
  // rejects a changed latest prop even before this layout effect can execute.
  useLayoutEffect(()=>{latest.current={visit,source};});
  const sourceKey=JSON.stringify(visit);
  useLayoutEffect(()=>{
    try{draftModel.observe(visit,source(visit));}catch(reason){draftModel.fail(reason);}
    report();publish();
  },[sourceKey]);
  const edit = value => {draftModel.edit(value);report();publish();};
  const begin = () => {try{return draftModel.begin(visit);}finally{report();publish();}};
  const complete = result => {
    const fresh=verifiedProductionDraftVisit(result,visit.id);
    draftModel.complete(fresh,latest.current.source(fresh));report();publish();
  };
  const fail = reason => {draftModel.fail(reason);report();publish();};
  const reload = async () => {
    if(!draftModel.beginReload(()=>window.confirm('¿Descartar estos campos y cargar la versión guardada? Si el envío fue incierto, revisá los registros antes de crear otro.')))return;
    report();publish();
    try{complete(await onReload(visit.id));}
    catch(reason){fail(reason);}
  };
  return {...state,edit,begin,complete,fail,reload};
}
function DraftRecovery({form,busy}) {
  if(!form.dirty && !form.blocked)return null;
  return <div className="prod-wide">{form.blocked && <p role="alert">{form.saved ? 'El cambio se guardó. No repitas el envío: cargá la versión guardada para verificarlo.' : form.uncertain ? 'No se pudo confirmar el envío. No lo repitas: revisá los registros guardados.' : 'La visita cambió. Tus campos se conservan, pero no se pueden guardar sobre otra revisión.'}</p>}<button type="button" disabled={busy || form.pending} onClick={()=>void form.reload()}>Descartar campos y cargar versión guardada</button></div>;
}
function MediaForm({visit, item, kind, busy, onWrite, onDirty, onCreated, onReload}) {
  const video = kind === 'videos';
  const key = `${kind}:${item?.id || 'new'}`;
  const source = current => {
    const row=item ? current[kind]?.find(row=>row.id===item.id) : null;
    if(item && !row)throw new Error('El registro ya no está disponible. Cerrá y recargá la visita.');
    return productionMediaDraft(row,kind);
  };
  const form=useProductionDraft({visit,source,key,onDirty,onReload});
  const draft=form.draft,setDraft=form.edit;
  const [error, setError] = useState('');
  const submit = async event => {
    event.preventDefault(); setError('');
    try {
      const url = video ? draft.material_url : draft.drive_url;
      if (url && !safeProductionUrl(url)) throw new Error('Usá un enlace http o https.');
      const intent=form.begin();
      try{form.complete(await onWrite(intent.visit,`/${kind}${item ? `/${encodeURIComponent(item.id)}` : ''}`,item ? 'PATCH' : 'POST',intent.draft));}
      catch(reason){form.fail(reason);throw reason;}
      if (!item) onCreated();
    } catch (reason) { setError(reason.message); }
  };
  return <form className="prod-form prod-media-form" onSubmit={submit}>
    <label>{video ? 'Título del video' : 'Tipo de fotos'}<input required maxLength={250} value={video ? draft.titulo : draft.tipo} disabled={busy} onChange={e=>setDraft({...draft,[video ? 'titulo' : 'tipo']:e.target.value})}/></label>
    <label>Estado<select value={draft.estado} disabled={busy} onChange={e=>setDraft({...draft,estado:e.target.value})}>{Object.entries(video ? VIDEO_STATES : PHOTO_STATES).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
    {video && <label className="prod-wide">Guion<textarea rows={5} value={draft.guion} disabled={busy} onChange={e=>setDraft({...draft,guion:e.target.value})}/><small>El guion se conserva al dejar pendiente o marcar para repetir.</small></label>}
    <label className="prod-wide">{video ? 'Enlace del material' : 'Enlace Drive'}<input type="url" value={video ? draft.material_url : draft.drive_url} disabled={busy} onChange={e=>setDraft({...draft,[video ? 'material_url' : 'drive_url']:e.target.value})}/></label>
    <label className="prod-wide">Observaciones<textarea value={draft.observaciones} disabled={busy} onChange={e=>setDraft({...draft,observaciones:e.target.value})}/></label>
    <DraftRecovery form={form} busy={busy}/>{error && <p className="prod-error prod-wide" role="alert">{error}</p>}<footer className="prod-wide"><button type="submit" disabled={busy || form.pending || form.blocked}>{busy ? 'Guardando…' : item ? 'Guardar cambios' : video ? 'Registrar video' : 'Registrar fotos'}</button></footer>
  </form>;
}
function SendToEditing({visit, video, users, busy, onWrite, onDirty, onReload}) {
  const form=useProductionDraft({visit,source:()=>({editorId:'',date:''}),key:`handoff:${video.id}`,onDirty,onReload});
  const {editorId,date}=form.draft; // Deliberately no inferred editor/date.
  const setEditorId=value=>form.edit({...form.draft,editorId:value});
  const setDate=value=>form.edit({...form.draft,date:value});
  const [error, setError] = useState('');
  const hasMaterial = Boolean(safeProductionUrl(video.material_url) || safeProductionUrl(visit.drive_url));
  const submit = async event => {
    event.preventDefault();setError('');
    try {
      if (!positiveId(Number(editorId)) || !date) throw new Error('Elegí editor y fecha de entrega.');
      if (!hasMaterial) throw new Error('Vinculá el material del video o la carpeta Drive de la visita.');
      const intent=form.begin();
      try{form.complete(await onWrite(intent.visit,`/videos/${encodeURIComponent(video.id)}/enviar-edicion`,'POST',{editor_id:Number(intent.draft.editorId),fecha_entrega:intent.draft.date}));}
      catch(reason){form.fail(reason);throw reason;}
    } catch (reason) { setError(reason.message); }
  };
  return <details className="prod-handoff"><summary>Enviar a edición</summary><form className="prod-form" onSubmit={submit}><label>Editor<select required value={editorId} disabled={busy} onChange={e=>setEditorId(e.target.value)}><option value="">Elegí una persona</option>{users.filter(user=>user.activo === true && ['admin','edicion'].includes(user.rol)).map(user=><option key={user.id} value={user.id}>{user.nombre} · #{user.id}</option>)}</select></label><label>Fecha de entrega<input required type="date" value={date} disabled={busy} onChange={e=>setDate(e.target.value)}/></label>{!hasMaterial && <p className="prod-muted prod-wide">Vinculá el material del video o la carpeta Drive de la visita antes de enviar.</p>}<DraftRecovery form={form} busy={busy}/>{error && <p className="prod-error prod-wide" role="alert">{error}</p>}<footer className="prod-wide"><button disabled={busy || form.pending || form.blocked || !editorId || !date || !hasMaterial} type="submit">Enviar video a edición</button></footer></form></details>;
}
function VisitEditor({visit, users, busy, onWrite, onDirty, onReload}) {
  const reviewed = hasReviewedProductionContext(visit);
  const form=useProductionDraft({visit,source:productionVisitDraft,key:`visit:${visit.id}`,onDirty,onReload});
  const draft=form.draft,setDraft=form.edit;
  const [error,setError] = useState('');
  const submit = async event => {
    event.preventDefault();setError('');
    try {
      if(draft.drive_url && !safeProductionUrl(draft.drive_url)) throw new Error('Usá un enlace http o https.');
      const intent=form.begin();
      try{form.complete(await onWrite(intent.visit,'','PATCH',productionVisitEditInput(intent.visit,intent.draft)));}
      catch(reason){form.fail(reason);throw reason;}
    }catch(reason){setError(reason.message);}
  };
  return <details className="prod-visit-editor"><summary>Editar datos de la visita</summary><form className="prod-form" onSubmit={submit}>
    <label>Fecha de visita<input required type="date" disabled={busy || reviewed} aria-describedby={reviewed ? `reviewed-context-${visit.id}` : undefined} value={draft.fecha} onChange={e=>setDraft({...draft,fecha:e.target.value})}/></label>
    {reviewed && <p className="prod-muted prod-wide" id={`reviewed-context-${visit.id}`}>Fecha y cliente protegidos por la revisión del registro histórico. Podés editar los demás datos de la visita.</p>}
    <label>Título<input required maxLength={250} disabled={busy} value={draft.titulo} onChange={e=>setDraft({...draft,titulo:e.target.value})}/></label><label className="prod-wide">Carpeta Drive<input type="url" disabled={busy} value={draft.drive_url} onChange={e=>setDraft({...draft,drive_url:e.target.value})}/></label><div className="prod-wide"><Participants users={users} selected={draft.participante_ids} disabled={busy} onChange={ids=>setDraft({...draft,participante_ids:ids})}/></div><label className="prod-wide">Observaciones<textarea disabled={busy} value={draft.observaciones} onChange={e=>setDraft({...draft,observaciones:e.target.value})}/></label><small className="prod-wide">Cambiar la visita no elige ni modifica automáticamente la fecha de entrega de edición.</small><DraftRecovery form={form} busy={busy}/>{error && <p className="prod-error prod-wide" role="alert">{error}</p>}<footer className="prod-wide"><button disabled={busy || form.pending || form.blocked} type="submit">Guardar visita</button></footer></form></details>;
}
function VisitAgendaItem({visit, selected, onOpen}) {
  return <article className="prod-agenda-entry"><button type="button" className="prod-agenda-item" aria-pressed={selected} onClick={()=>onOpen(visit.id)}><span><strong>{visit.titulo}</strong><small>{visit.cliente_nombre}</small></span><span aria-hidden="true">›</span></button><ul className="prod-agenda-media">{(visit.videos || []).map(video=><li key={video.id}><span>Video · {video.titulo}</span><span className={`prod-status is-${video.estado}`}>{VIDEO_STATES[video.estado] || video.estado}</span></li>)}{(visit.fotos || []).map(photo=><li key={photo.id}><span>Fotos · {photo.tipo}</span><span className={`prod-status is-${photo.estado}`}>{PHOTO_STATES[photo.estado] || photo.estado}</span></li>)}</ul>{!visit.videos?.length && !visit.fotos?.length && <p className="prod-muted">Sin material registrado todavía.</p>}</article>;
}
function EditingAssignment({video, users}) {
  const personLabel = id => positiveId(id) ? `${users.find(user=>user.id === id)?.nombre || 'Usuario'} · #${id}` : 'Sin responsable';
  const handoffId = video.editor_handoff_id ?? video.editor_id;
  const handoffDate = video.fecha_entrega_handoff ?? video.fecha_entrega;
  const hasCurrent = Object.hasOwn(video,'editor_actual_id') || Object.hasOwn(video,'fecha_entrega_actual');
  return <dl className="prod-editing-assignment" aria-label="Asignación de edición">
    <div><dt>Actual</dt><dd>{hasCurrent ? personLabel(video.editor_actual_id) : 'Sin datos actuales'}<small>Entrega: {video.fecha_entrega_actual ? <time dateTime={video.fecha_entrega_actual}>{video.fecha_entrega_actual}</time> : 'Sin fecha actual'}</small></dd></div>
    <div><dt>Al enviar</dt><dd>{personLabel(handoffId)}<small>Entrega: {handoffDate ? <time dateTime={handoffDate}>{handoffDate}</time> : 'Sin fecha registrada'}</small></dd></div>
  </dl>;
}
function buildProductionEditorialInput({revision,kind,candidate,plannedDate,acknowledged}) {
  if (!positiveId(revision) || !candidate || !positiveId(candidate.tarea_id) || !positiveId(candidate.tarea_revision)) throw new Error('Actualizá los candidatos y elegí una tarea válida antes de confirmar.');
  const data = {expected_revision:revision,tarea_id:candidate.tarea_id,expected_tarea_revision:candidate.tarea_revision};
  const version = value => typeof value === 'string' && value.trim().length > 0;
  if (kind === 'piece') {
    if (!positiveId(candidate.publicacion_id) || !version(candidate.publicacion_updated_at)) throw new Error('Falta la versión de la publicación. Actualizá los candidatos.');
    data.publicacion_id = candidate.publicacion_id;
    data.expected_publicacion_updated_at = candidate.publicacion_updated_at;
    if (candidate.objetivo_pieza_id != null) {
      if (!positiveId(candidate.objetivo_pieza_id) || !version(candidate.objetivo_updated_at) || !acknowledged) throw new Error('Confirmá también el casillero de objetivo vinculado a esta publicación.');
      data.objetivo_pieza_id = candidate.objetivo_pieza_id;
      data.expected_objetivo_updated_at = candidate.objetivo_updated_at;
    }
    return {path:'vincular-pieza',data};
  }
  if (kind !== 'goal' || !positiveId(candidate.objetivo_pieza_id) || !version(candidate.objetivo_updated_at)) throw new Error('Elegí un casillero de objetivo válido.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plannedDate || '') || !Number.isFinite(Date.parse(`${plannedDate}T12:00:00Z`)) || new Date(`${plannedDate}T12:00:00Z`).toISOString().slice(0,10) !== plannedDate) throw new Error('Elegí manualmente una fecha de programación válida.');
  return {path:'vincular-objetivo',data:{...data,objetivo_pieza_id:candidate.objetivo_pieza_id,expected_objetivo_updated_at:candidate.objetivo_updated_at,fecha_programada:plannedDate}};
}
function EditorialLinkSummary({video}) {
  if (!positiveId(video.publicacion_id) || !positiveId(video.tarea_entrega_id)) return null;
  return <p className="prod-editorial-link">Publicación #{video.publicacion_id} · <a href={`/workspace/tareas?task=${video.tarea_entrega_id}`}>Tarea de entrega #{video.tarea_entrega_id} ↗</a></p>;
}
function EditorialAssociation({visit,video,busy,onWrite,onDirty}) {
  const [open,setOpen] = useState(false);
  const [period,setPeriod] = useState(visit.fecha.slice(0,7));
  const [kind,setKind] = useState('piece');
  const [choice,setChoice] = useState('');
  const [plannedDate,setPlannedDate] = useState('');
  const [acknowledged,setAcknowledged] = useState(false);
  const [catalog,setCatalog] = useState({status:'idle',data:null,revision:null,period:null});
  const [refreshKey,setRefreshKey] = useState(0);
  const [needsRefresh,setNeedsRefresh] = useState(false);
  const [error,setError] = useState('');
  const [saved,setSaved] = useState(false);
  const [submitting,setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const currentVisit = useRef(visit);
  currentVisit.current = visit;
  useEffect(()=>{
    if (!open) return;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {setCatalog(current=>({...current,status:'error'}));setError('Elegí un mes válido.');return;}
    const controller = new AbortController();
    const revision = currentVisit.current.revision; // Captured when candidates are explicitly loaded, not silently refreshed on visit changes.
    setCatalog(current=>({...current,status:'loading'}));setError('');
    apiRequest(`/api/producciones/${encodeURIComponent(visit.id)}/videos/${encodeURIComponent(video.id)}/vinculo?periodo=${encodeURIComponent(period)}`,{signal:controller.signal})
      .then(data=>{
        if (!Object.hasOwn(data,'actual') || !Array.isArray(data.publicaciones) || !Array.isArray(data.casilleros)) throw new Error('La lista de candidatos no es válida.');
        if (!controller.signal.aborted) {setCatalog({status:'ready',data,revision,period});setNeedsRefresh(false);setAcknowledged(false);}
      })
      .catch(reason=>{if(!controller.signal.aborted){setCatalog(current=>({...current,status:'error'}));setError(reason.message);}});
    return()=>controller.abort();
  },[open,period,refreshKey,visit.id,video.id]);
  const options = kind === 'piece' ? catalog.data?.publicaciones || [] : catalog.data?.casilleros || [];
  const candidate = options.find(item=>String(kind === 'piece' ? item.publicacion_id : item.objetivo_pieza_id) === choice);
  const actual = catalog.data?.actual;
  const alreadyLinked = positiveId(video.publicacion_id) || Boolean(actual) || saved;
  const unavailable = Boolean(choice && !candidate);
  const catalogReady = catalog.status === 'ready' && catalog.period === period && !needsRefresh;
  const requiresGoalAck = kind === 'piece' && candidate?.objetivo_pieza_id != null;
  const submit = async event => {
    event.preventDefault();setError('');
    if (busy || submitLock.current) return;
    try {
      if (!catalogReady || alreadyLinked) throw new Error('Actualizá los candidatos antes de confirmar la vinculación.');
      const input = buildProductionEditorialInput({revision:catalog.revision,kind,candidate,plannedDate,acknowledged});
      if (video.tarea_edicion_id && video.tarea_edicion_id !== candidate.tarea_id) throw new Error('La tarea elegida no coincide con la tarea de edición existente. No se fusionarán tareas.');
      submitLock.current=true;setSubmitting(true);
      await onWrite({...visit,revision:catalog.revision},`/videos/${encodeURIComponent(video.id)}/${input.path}`,'POST',input.data);
      setSaved(true);onDirty(`editorial:${video.id}`,false);
    } catch(reason) {
      if (reason.status === 409) setNeedsRefresh(true);
      setError(reason.status === 409 ? `${reason.message} Actualizá los candidatos y revisá la selección antes de volver a confirmar.` : reason.message);
    } finally {submitLock.current=false;setSubmitting(false);}
  };
  return <details className="prod-editorial-association" onToggle={event=>setOpen(event.currentTarget.open)}><summary>Vincular pieza u objetivo</summary>
    {open && <form className="prod-form" onSubmit={submit} onChange={()=>onDirty(`editorial:${video.id}`,true)}>
      <p className="prod-muted prod-wide">Vinculá una entrega del mismo cliente usando su tarea existente. No publica el contenido ni lo envía a edición.</p>
      <label>Mes del objetivo<input type="month" required value={period} disabled={busy || submitting} onChange={event=>{setPeriod(event.target.value);setNeedsRefresh(true);}}/></label>
      <div className="prod-editorial-refresh"><button type="button" disabled={busy || submitting || catalog.status === 'loading'} onClick={()=>{setNeedsRefresh(true);setRefreshKey(value=>value+1);}}>Actualizar candidatos</button></div>
      {catalog.status === 'loading' && <p className="prod-muted prod-wide" role="status">Cargando publicaciones y casilleros compatibles…</p>}
      {error && <p className="prod-error prod-wide" role="alert">{error}</p>}
      {alreadyLinked ? <p className="prod-muted prod-wide" role="status">{saved ? 'Vinculación guardada.' : 'Este video ya tiene una vinculación editorial.'} {actual && <>Publicación #{actual.publicacion_id} · <a href={`/workspace/tareas?task=${actual.tarea_entrega_id}`}>Tarea #{actual.tarea_entrega_id} ↗</a>{actual.objetivo_pieza_id ? ` · Casillero #${actual.objetivo_pieza_id}` : ''}.</>} El editor y la fecha de entrega se eligen por separado en “Enviar a edición”.</p> : <>
        <fieldset className="prod-editorial-kind prod-wide" disabled={busy || submitting}><legend>Qué querés vincular</legend><label><input type="radio" name={`editorial-kind-${video.id}`} value="piece" checked={kind === 'piece'} onChange={()=>{setKind('piece');setChoice('');setAcknowledged(false);}}/>Publicación existente</label><label><input type="radio" name={`editorial-kind-${video.id}`} value="goal" checked={kind === 'goal'} onChange={()=>{setKind('goal');setChoice('');setAcknowledged(false);}}/>Casillero vacío de objetivo</label></fieldset>
        <label className="prod-wide">{kind === 'piece' ? 'Publicación existente' : 'Casillero vacío'}<select value={choice} required disabled={busy || submitting || !catalogReady} onChange={event=>{setChoice(event.target.value);setAcknowledged(false);}}><option value="">{kind === 'piece' ? 'Elegí una publicación' : 'Elegí un casillero'}</option>{unavailable && <option disabled value={choice}>La selección anterior ya no está disponible</option>}{options.map(item=><option key={kind === 'piece' ? item.publicacion_id : item.objetivo_pieza_id} value={kind === 'piece' ? item.publicacion_id : item.objetivo_pieza_id}>{item.titulo || (kind === 'piece' ? `Publicación #${item.publicacion_id}` : `Video ${item.numero}`)} · tarea #{item.tarea_id}{item.objetivo_pieza_id ? ` · casillero #${item.objetivo_pieza_id}` : ''}{item.fecha_programada ? ` · ${item.fecha_programada}` : ''}</option>)}</select></label>
        {catalogReady && !options.length && <p className="prod-muted prod-wide">No hay {kind === 'piece' ? 'publicaciones compatibles' : 'casilleros vacíos compatibles'} para este mes. No se adoptan tareas duplicadas ni trabajos ya iniciados.</p>}
        {candidate && <p className="prod-editorial-review prod-wide">Se conservará la <a href={`/workspace/tareas?task=${candidate.tarea_id}`}>tarea de entrega #{candidate.tarea_id} ↗</a>{kind === 'piece' ? ` y la publicación #${candidate.publicacion_id}` : '; se creará una publicación borrador en el casillero elegido'}. No se crea otra tarea.{video.tarea_edicion_id ? ` Tarea de edición actual: #${video.tarea_edicion_id}.` : ''}</p>}
        {requiresGoalAck && <label className="prod-editorial-ack prod-wide"><input type="checkbox" checked={acknowledged} disabled={busy || submitting || !catalogReady} onChange={event=>setAcknowledged(event.target.checked)}/>Confirmo que también se conserva el casillero #{candidate.objetivo_pieza_id}{candidate.periodo ? ` de ${candidate.periodo}` : ''} vinculado a esta publicación.</label>}
        {kind === 'goal' && <label className="prod-wide">Fecha de programación<input type="date" required value={plannedDate} disabled={busy || submitting} onChange={event=>setPlannedDate(event.target.value)}/><small>Elegí la fecha editorial. Es distinta de la visita y de la entrega de edición. El guion no se usa como copy.</small></label>}
        <footer className="prod-wide"><button type="submit" disabled={busy || submitting || !catalogReady || !candidate || (requiresGoalAck && !acknowledged) || (kind === 'goal' && !plannedDate)}>{submitting ? 'Vinculando…' : 'Confirmar vinculación'}</button></footer>
      </>}
    </form>}
  </details>;
}
function VisitDetail({visit, users, busy, isAdmin, onWrite, onDirty, onReload}) {
  const [adding, setAdding] = useState({});
  return <section className="prod-panel prod-detail" aria-label="Detalle de visita"><header className="prod-detail-heading"><span>{visit.cliente_nombre}</span><h2>{visit.titulo}</h2><p>{dateLabel(visit.fecha)}</p><SafeLink url={visit.drive_url}/></header>
    {visit.observaciones && <p className="prod-notes">{visit.observaciones}</p>}<p className="prod-muted">Participantes: {(visit.participante_ids || []).map(id=>users.find(user=>user.id===id)?.nombre || `Usuario #${id}`).join(', ') || 'Sin participantes'}</p>
    {visit.tarea_origen_id && <a href={`/workspace/tareas?task=${visit.tarea_origen_id}`}>Ver tarea de origen ↗</a>}
    <VisitEditor visit={visit} users={users} busy={busy} onWrite={onWrite} onDirty={onDirty} onReload={onReload}/>
    {['videos','fotos'].map(kind=><section key={kind} className="prod-media-section"><header className="prod-section-heading"><h3>{kind === 'videos' ? 'Videos' : 'Fotos'} <span>{visit[kind]?.length || 0}</span></h3><button disabled={busy} type="button" onClick={()=>setAdding(current=>({...current,[kind]:true}))}>+ {kind === 'videos' ? 'Video' : 'Fotos'}</button></header>
      {(visit[kind] || []).map(item=><article className="prod-media" key={item.id}><header><h4>{item.titulo || item.tipo}</h4><span className={`prod-status is-${item.estado}`}>{(kind === 'videos' ? VIDEO_STATES : PHOTO_STATES)[item.estado] || item.estado}</span></header><SafeLink url={item.material_url || item.drive_url}/>
        {item.tarea_edicion_id && <a className="prod-task-link" href={`/workspace/tareas?task=${item.tarea_edicion_id}`}>Edición · {TASK_STATES[item.tarea_estado] || item.tarea_estado || 'Ver tarea'} ↗</a>}
        {item.tarea_edicion_id && <EditingAssignment video={item} users={users}/>}
        {kind === 'videos' && <EditorialLinkSummary video={item}/>}
        {kind === 'videos' && item.guion && <details><summary>Ver guion</summary><p className="prod-script">{item.guion}</p></details>}
        <details><summary>Editar {kind === 'videos' ? 'video' : 'fotos'}</summary><MediaForm visit={visit} item={item} kind={kind} busy={busy} onWrite={onWrite} onDirty={onDirty} onReload={onReload}/></details>
        {isAdmin && kind === 'videos' && <EditorialAssociation visit={visit} video={item} busy={busy} onWrite={onWrite} onDirty={onDirty}/>}
        {isAdmin && kind === 'videos' && item.estado === 'grabado' && !item.tarea_edicion_id && <SendToEditing visit={visit} video={item} users={users} busy={busy} onWrite={onWrite} onDirty={onDirty} onReload={onReload}/>}
      </article>)}{!visit[kind]?.length && <p className="prod-empty">Sin {kind} registrados.</p>}
      {adding[kind] && <MediaForm key={`${visit.id}:${kind}:new`} visit={visit} kind={kind} busy={busy} onWrite={onWrite} onDirty={onDirty} onReload={onReload} onCreated={()=>setAdding(current=>({...current,[kind]:false}))}/>}
    </section>)}
  </section>;
}

export function ProductionsPage({sesion}) {
  const today = getHoyLocalISO();
  const [month, setMonth] = useState(today.slice(0,7));
  const [day, setDay] = useState(today);
  const [tab, setTab] = useState('calendar');
  const [clientId, setClientId] = useState('');
  const [visits, setVisits] = useState([]);
  const [users, setUsers] = useState([]);
  const [clients, setClients] = useState([]);
  const [pending, setPending] = useState([]);
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const writeLock = useRef(false);
  const openVersion = useRef(0);
  const navigationRef = useRef(null);
  const dirty = useRef(new Set());
  useNavigationGuard(() => ({ dirty: dirty.current.size > 0, busy: writeLock.current }));
  const isAdmin = positiveId(sesion?.usuario?.id) && sesion.usuario.rol === 'admin';
  const onDirty = useCallback((key,value)=>{if(value) dirty.current.add(key); else dirty.current.delete(key);},[]);
  const mayLeave = () => { if (writeLock.current) return false; if (dirty.current.size && !window.confirm('Hay cambios sin guardar. ¿Querés descartarlos?')) return false; dirty.current.clear(); return true; };
  useEffect(()=>{
    const controller = new AbortController();setLoading(true);setError('');
    Promise.all([apiRequest(`/api/producciones?mes=${encodeURIComponent(month)}`,{signal:controller.signal}),apiRequest('/api/usuarios',{signal:controller.signal}),apiRequest('/api/clientes',{signal:controller.signal})])
      .then(([data,people,brands])=>{if(!controller.signal.aborted){setVisits(data.visitas || []);setUsers(people.filter(user=>user.activo === true && positiveId(user.id)));setClients(brands.filter(client=>client.activo !== false));}})
      .catch(reason=>{if(!controller.signal.aborted)setError(reason.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[month,reload]);
  useEffect(()=>{
    if(tab !== 'pending') return;
    const controller = new AbortController();setError('');setPending([]);setLoading(true);
    apiRequest(`/api/producciones/pendientes${clientId ? `?cliente_id=${encodeURIComponent(clientId)}` : ''}`,{signal:controller.signal})
      .then(data=>{if(!controller.signal.aborted)setPending(data.videos || []);})
      .catch(reason=>{if(!controller.signal.aborted)setError(reason.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[tab,clientId,reload]);
  const refreshVisit = async id => {
    const value = verifiedProductionDraftVisit(await apiRequest(`/api/producciones/${encodeURIComponent(id)}`),id);
    setSelected(current=>current?.id === id ? value : current);
    setVisits(current=>current.map(visit=>visit.id === id ? value : visit));
    return value;
  };
  const openVisit = async (id, {history = true, checkDirty = true} = {}) => {
    if(checkDirty && !mayLeave()) return;
    const version=++openVersion.current;setCreating(false);setSelected(null);setDetailLoading(true);setError('');
    try {
      const value=verifiedProductionDraftVisit(await apiRequest(`/api/producciones/${encodeURIComponent(id)}`),id);
      if(version===openVersion.current) {
        setSelected(value);setMonth(value.fecha.slice(0,7));setDay(value.fecha);
        if(history) writeProductionLocation({id:value.id,month:value.fecha.slice(0,7)});
      }
    }
    catch(reason){if(version===openVersion.current)setError(reason.message);}
    finally{if(version===openVersion.current)setDetailLoading(false);}
  };
  const restoreProductionLocation = async ({discardDrafts = false} = {}) => {
    try {
      const location=productionLocation(window.location.href);
      if(discardDrafts) dirty.current.clear();
      if(location.id) await openVisit(location.id,{history:false,checkDirty:false});
      else {
        ++openVersion.current;setSelected(null);setCreating(false);setDetailLoading(false);setError('');
        const restoredMonth=location.month || today.slice(0,7);
        setMonth(restoredMonth);setDay(restoredMonth===today.slice(0,7) ? today : `${restoredMonth}-01`);
      }
    }catch(reason){++openVersion.current;setSelected(null);setDetailLoading(false);setError(reason.message);}
  };
  navigationRef.current = restoreProductionLocation;
  useEffect(()=>{
    const restore=event=>{void navigationRef.current({discardDrafts:event?.type === 'popstate'});};
    restore();window.addEventListener('popstate',restore);
    return()=>{++openVersion.current;window.removeEventListener('popstate',restore);};
  },[]);
  const retryProductionPage = () => {
    if(!selected && !mayLeave()) return;
    setReload(value=>value+1);
    if(selected) void refreshVisit(selected.id).catch(reason=>setError(reason.message));
    else void navigationRef.current();
  };
  const writeVisit = async (visit,path,method,data) => {
    if(writeLock.current) throw new Error('Hay otra operación en curso.');
    writeLock.current=true;setBusy(true);setNotice('');
    try {
      const response=await productionWrite({visit,path,method,data,refresh:refreshVisit});
      // Read back the full aggregate: nested endpoints may return only the changed record.
      let fresh;
      try { fresh=await refreshVisit(visit.id);setNotice('Cambios guardados.'); }
      catch {
        const ack=visitDTO(response);
        const saved=ack?.id===visit.id && positiveId(ack.revision) && ack.revision>visit.revision;
        throw Object.assign(new Error(saved
          ? 'El cambio se guardó, pero no pudimos verificar el detalle completo. No repitas el envío: cargá la versión guardada.'
          : 'No pudimos verificar el resultado completo. No repitas el envío antes de cargar la versión guardada.'),{productionSaved:saved});
      }
      setReload(value=>value+1);return fresh;
    } catch(reason){setNotice(reason.message);throw reason;}
    finally{writeLock.current=false;setBusy(false);}
  };
  const createVisit = async data => {
    if(writeLock.current) throw new Error('Hay otra operación en curso.');
    writeLock.current=true;setBusy(true);
    try {
      const value=visitDTO(await apiRequest('/api/producciones',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}));
      setCreating(false);setSelected(value);setMonth(value.fecha.slice(0,7));setDay(value.fecha);setReload(current=>current+1);setNotice('Visita creada.');
      writeProductionLocation({id:value.id,month:value.fecha.slice(0,7)});
    } finally{writeLock.current=false;setBusy(false);}
  };
  const navigateMonth = amount => {if(!mayLeave())return;const next=shiftProductionMonth(month,amount);++openVersion.current;setMonth(next);setDay(`${next}-01`);setDetailLoading(false);setSelected(null);setCreating(false);writeProductionLocation({month:next});};
  const filtered = visits.filter(visit=>!clientId || visit.cliente_id === Number(clientId));
  const selectedDayVisits = filtered.filter(visit=>visit.fecha === day);
  const resume = async video => {
    if(!selected || selected.cliente_id !== video.cliente_id){setNotice('Elegí una visita del mismo cliente antes de retomar este guion.');return;}
    try {await writeVisit(selected,'/videos','POST',{video_origen_id:video.id});}catch{/* Conflict message already visible. */}
  };
  return <main className="productions-page"><header className="prod-page-heading"><div><h1>Producciones</h1><p>Visitas, guiones y material del equipo.</p></div><button className="prod-primary" type="button" disabled={busy} onClick={()=>{if(mayLeave()){++openVersion.current;setDetailLoading(false);setSelected(null);setCreating(true);}}}>Nueva visita</button></header>
    <nav className="prod-toolbar" aria-label="Vistas de producciones"><div className="prod-tabs">{[['calendar','Calendario'],['pending','Banco de pendientes']].map(([id,label])=><button type="button" key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</div><label>Cliente<select value={clientId} onChange={e=>setClientId(e.target.value)}><option value="">Todos los clientes</option>{clients.map(client=><option key={client.id} value={client.id}>{client.nombre}</option>)}</select></label><button type="button" disabled={busy} onClick={retryProductionPage}>Actualizar</button></nav>
    {notice && <p className="prod-notice" role="status">{notice}</p>}{error && <p className="prod-error" role="alert">{error} <button type="button" onClick={retryProductionPage}>Reintentar</button></p>}
    <div className="prod-layout"><section className="prod-schedule" aria-label={tab==='calendar' ? 'Calendario de visitas' : 'Guiones pendientes'}>
      <header className="prod-month-nav"><button type="button" aria-label="Mes anterior" disabled={busy} onClick={()=>navigateMonth(-1)}>‹</button><h2>{monthLabel(month)}</h2><button type="button" aria-label="Mes siguiente" disabled={busy} onClick={()=>navigateMonth(1)}>›</button></header>
      {loading ? <p className="prod-empty" role="status">Cargando producciones…</p> : tab === 'calendar' ? <>
        <div className="prod-month-grid"><div className="prod-weekdays" aria-hidden="true">{['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(name=><span key={name}>{name}</span>)}</div><div className="prod-days">{productionMonthDays(month).map((date,index)=>date ? <button type="button" key={date} aria-pressed={date===day} aria-current={date===today ? 'date' : undefined} aria-label={`${dateLabel(date)}, ${filtered.filter(v=>v.fecha===date).length} visitas`} onClick={()=>setDay(date)}><time dateTime={date}>{Number(date.slice(-2))}</time>{filtered.filter(visit=>visit.fecha===date).slice(0,2).map(visit=><span key={visit.id}>{visit.cliente_nombre}</span>)}</button> : <span key={`blank-${index}`} aria-hidden="true"/>)}</div></div>
        <section className="prod-day-agenda"><h3>{dateLabel(day)}</h3>{selectedDayVisits.map(visit=><VisitAgendaItem key={visit.id} visit={visit} selected={selected?.id===visit.id} onOpen={openVisit}/>)}{!selectedDayVisits.length && <p className="prod-empty">No hay visitas este día. Podés crear una nueva.</p>}</section>
        <section className="prod-mobile-agenda" aria-label="Agenda del mes"><label>Elegir día<input type="date" value={day} min={`${month}-01`} max={`${month}-${String(new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate()).padStart(2,'0')}`} onChange={e=>{if(e.target.value)setDay(e.target.value);}}/></label>{selectedDayVisits.map(visit=><VisitAgendaItem key={visit.id} visit={visit} selected={selected?.id===visit.id} onOpen={openVisit}/>)}{!selectedDayVisits.length && <p className="prod-empty">No hay visitas este día.</p>}</section>
      </> : <div className="prod-pending"><p className="prod-muted">Guiones pendientes o para repetir. Retomarlos conserva la visita original.</p><label>Visita de destino<select value={selected?.id || ''} disabled={busy} onChange={e=>{if(e.target.value)openVisit(e.target.value);}}><option value="">Elegí una visita del mes</option>{filtered.map(visit=><option key={visit.id} value={visit.id}>{visit.fecha} · {visit.cliente_nombre} · {visit.titulo}</option>)}</select></label>{pending.map(video=><article className="prod-media" key={video.id}><header><h3>{video.titulo}</h3><span className="prod-status">{VIDEO_STATES[video.estado] || video.estado}</span></header><p className="prod-muted">{video.cliente_nombre} · {video.fecha}</p><p className="prod-script">{video.guion || 'Sin guion cargado'}</p><button type="button" disabled={busy || !selected || selected.cliente_id!==video.cliente_id} onClick={()=>resume(video)}>Retomar en la visita seleccionada</button></article>)}{!pending.length && <p className="prod-empty">No hay guiones pendientes para este filtro.</p>}</div>}
    </section><div className="prod-detail-column">{creating ? <CreateVisit key="create" clients={clients} users={users} date={day} busy={busy} onCreate={createVisit} onDirty={onDirty} onCancel={()=>{if(mayLeave())setCreating(false);}}/> : detailLoading ? <p role="status" className="prod-empty">Cargando visita…</p> : selected ? <VisitDetail key={selected.id} visit={selected} users={users} busy={busy} isAdmin={isAdmin} onWrite={writeVisit} onDirty={onDirty} onReload={refreshVisit}/> : <div className="prod-panel prod-empty"><h2>Elegí una visita</h2><p>Acá verás los videos, fotos y guiones del rodaje.</p></div>}</div></div>
  </main>;
}
