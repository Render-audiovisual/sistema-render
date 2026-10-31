import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { productionResultStatus } from './productionResultStatus.js';
import { createProductionCatalogReader } from './productionCatalogReader.js';
import { captureProductionMediaFocus } from './productionMediaFocus.js';
import { FilterSelect } from '../components/FilterSelect.jsx';
import { Modal } from '../components/Modal.jsx';
import { restoreProductionDraftRecoveryFocus } from './productionDraftRecoveryFocus.js';
import { useNavigationConfirmation } from '../components/NavigationDiscardHost.jsx';
import { createProductionContextGate } from './productionContextGate.js';
import { getHoyLocalISO, getSesion } from '../utils.jsx';
import { apiRequest } from '../features/render-os/services/render-os-api.js';
import { useNavigationGuard } from '../shared/navigation/useNavigationGuard.js';
import { notifyViewPreferenceChange } from '../shared/navigation/viewPreferenceEvent.js';
import { hasReviewedProductionContext, productionVisitEditInput } from './productionVisitEdit.js';
import { createProductionDraft, productionMediaDraft, productionVisitDraft, verifiedProductionDraftVisit } from './productionDraft.js';
import { createCapturedRequest } from '../shared/session/captured-request.js';
import { createProductionCreateIntent } from './productionCreateIntent.js';
import { ProductionHistoryBatchReview } from '../components/ProductionHistoryBatchReview.jsx';
import { ProductionResultHistory } from './ProductionResultHistory.jsx';
import { ProductionResultRegister } from './ProductionResultRegister.jsx';
import './Productions.css';
import './OperationalCalendars.css';
import { productionLocation, initialProductionContext, productionReadUrl, assertProductionClient, productionCalendarDay, validProductionDay } from './productionRouteContext.js';
import { createProductionVisitObserver, newestProductionVisit, reconcileProductionVisitList } from './productionVisitObservation.js';

const VIDEO_STATES = { planificado:'Planificado', grabado:'Grabado', pendiente:'Pendiente', repetir:'Repetir' };
const PHOTO_STATES = { realizada:'Realizada', pendiente:'Pendiente', repetir:'Repetir' };
const TASK_STATES = { pendiente:'Pendiente', en_progreso:'En proceso', en_revision:'Para revisar', aprobada:'Aprobada', finalizada:'Finalizada', publicada:'Finalizada' };
const positiveId = value => Number.isSafeInteger(value) && value > 0;
function safeProductionUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
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

function writeProductionLocation({id = null, month, day, clientId, tab, replace = false}) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('visita',id); else url.searchParams.delete('visita');
  if (month) url.searchParams.set('mes',month);
  if (day) url.searchParams.set('dia',day); else url.searchParams.delete('dia');
  for (const key of [...url.searchParams.keys()]) if (key.startsWith('cliente[') || key.startsWith('mes[') || key.startsWith('visita[') || key.startsWith('tab[') || key.startsWith('dia[')) url.searchParams.delete(key);
  if (clientId !== undefined) { if(clientId) url.searchParams.set('cliente',clientId); else url.searchParams.delete('cliente'); }
  if (tab) url.searchParams.set('tab',tab);
  if (url.href !== window.location.href) {
    window.history[replace ? 'replaceState' : 'pushState'](window.history.state,'',url);
    notifyViewPreferenceChange(window);
  }
}

// CAS always uses the visit version supplied by the visible form, never a newer hidden ref.
async function productionWrite({ visit, path = '', method = 'PATCH', data, request, refresh }) {
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
function PendingProductionPhotos({photos, busy, onOpen}) {
  return <section aria-label="Fotos pendientes" className="prod-pending-photos">
    <h3>Fotos pendientes o para repetir</h3>
    <p className="prod-muted">Revisá el material en su visita original. No se crea una copia.</p>
    {photos.map(photo=><article className="prod-media" key={photo.id}>
      <header><h4>{photo.tipo}</h4><span className="prod-status">{PHOTO_STATES[photo.estado] || photo.estado}</span></header>
      <p className="prod-muted">{photo.cliente_nombre} · {photo.fecha}</p>
      {photo.observaciones && <p className="prod-script">{photo.observaciones}</p>}
      {safeProductionUrl(photo.drive_url) && <p><a href={safeProductionUrl(photo.drive_url)} target="_blank" rel="noopener noreferrer">Abrir material ↗</a></p>}
      <button type="button" disabled={busy} onClick={()=>onOpen(photo.visita_id)}>Ver visita de origen</button>
    </article>)}
    {!photos.length && <p className="prod-empty">No hay fotos pendientes para este filtro.</p>}
  </section>;
}
function Participants({users, selected, onChange, disabled}) {
  return <fieldset className="prod-participants" disabled={disabled}><legend>Participantes</legend>{users.map(user => <label key={user.id}><input type="checkbox" checked={selected.includes(user.id)} onChange={event => onChange(event.target.checked ? [...selected,user.id] : selected.filter(id => id !== user.id))}/><span>{user.nombre}<small>@{user.usuario || user.id} · #{user.id}</small></span></label>)}{!users.length && <p className="prod-muted">No hay usuarios activos disponibles.</p>}</fieldset>;
}
function CreateVisit({clients, users, date, busy, sesion, onCreate, onCreated, onCancel, onDirty}) {
  clients=clients.filter(client=>client.activo === true);
  const [draft, setDraft] = useState({cliente_id:'',fecha:date,titulo:'',participante_ids:[],tarea_origen_id:'',observaciones:'',drive_url:''});
  const [error, setError] = useState('');
  const mounted=useRef(false),model=useRef(null),originalScope=useRef(null),[,render]=useState(0);
  useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
  if(!model.current)model.current=createProductionCreateIntent({
    capture:()=>{const scope=createCapturedRequest({session:sesion,readSession:getSesion,request:apiRequest,isActive:()=>mounted.current});originalScope.current=scope;return scope},
    request:(body,scope)=>onCreate(body,scope),
  });
  const state=model.current.snapshot,locked=busy||state.locked;
  const submit = async event => {
    event.preventDefault();if(model.current.snapshot.busy)return;setError('');
    try {
      if(model.current.snapshot.locked){const pending=model.current.verify();render(value=>value+1);const visit=await pending;originalScope.current.assertCurrent();onDirty('create',false);onCreated(visit,originalScope.current);return;}
      if (!positiveId(Number(draft.cliente_id)) || !draft.titulo.trim()) throw new Error('Elegí cliente y título de la visita.');
      if (draft.drive_url && !safeProductionUrl(draft.drive_url)) throw new Error('Usá un enlace http o https para Drive.');
      const source = draft.tarea_origen_id === '' ? null : Number(draft.tarea_origen_id);
      if (source !== null && !positiveId(source)) throw new Error('El ID de la tarea debe ser un entero positivo.');
      const pending=model.current.submit({...draft,cliente_id:Number(draft.cliente_id),tarea_origen_id:source,titulo:draft.titulo.trim()});render(value=>value+1);const visit=await pending;
      originalScope.current.assertCurrent();onDirty('create',false);onCreated(visit,originalScope.current);
    } catch (reason) { if(mounted.current&&(!originalScope.current||originalScope.current.current()))setError(reason.message); }
    finally{if(mounted.current&&(!originalScope.current||originalScope.current.current()))render(value=>value+1);}
  };
  return <section className="prod-panel"><header className="prod-section-heading"><h2>Nueva visita</h2><button type="button" disabled={busy} onClick={onCancel}>Cancelar</button></header><form className="prod-form" onSubmit={submit} onChange={()=>onDirty('create',true)}>
    <FilterSelect label="Cliente" required value={draft.cliente_id} disabled={locked} onChange={e=>setDraft({...draft,cliente_id:e.target.value})}><option value="">Elegí un cliente</option>{clients.map(client=><option value={client.id} key={client.id}>{client.nombre}</option>)}</FilterSelect>
    <label>Fecha<input required type="date" value={draft.fecha} disabled={locked} onChange={e=>setDraft({...draft,fecha:e.target.value})}/></label>
    <label className="prod-wide">Título<input required maxLength={250} value={draft.titulo} disabled={locked} onChange={e=>setDraft({...draft,titulo:e.target.value})}/></label>
    <div className="prod-wide"><Participants users={users} selected={draft.participante_ids} disabled={locked} onChange={ids=>{onDirty('create',true);setDraft({...draft,participante_ids:ids});}}/></div>
    <details className="prod-wide"><summary>Vincular tarea existente (opcional)</summary><label>Tarea de origen (ID)<input inputMode="numeric" type="number" min="1" step="1" value={draft.tarea_origen_id} disabled={locked} onChange={e=>setDraft({...draft,tarea_origen_id:e.target.value})}/></label><small>Usá esta opción solo para vincular una tarea que ya existe.</small></details>
    <label>Carpeta Drive (opcional)<input type="url" value={draft.drive_url} disabled={locked} onChange={e=>setDraft({...draft,drive_url:e.target.value})}/></label>
    <label className="prod-wide">Observaciones<textarea value={draft.observaciones} disabled={locked} onChange={e=>setDraft({...draft,observaciones:e.target.value})}/></label>
    {state.locked&&<p className="prod-muted prod-wide">Conservamos este intento sin cambiar sus datos. {state.uncertain?'Verificá si ya se guardó antes de crear otra visita.':'Revisá las visitas guardadas antes de crear otra.'} Al salir de este formulario o cambiar de sesión se pierde esta clave de recuperación.</p>}
    {error && <p className="prod-error prod-wide" role="alert">{error}</p>}<footer className="prod-wide"><button className="prod-primary" disabled={busy||state.busy||state.blocked} type="submit">{busy||state.busy ? 'Guardando…' : state.uncertain ? 'Verificar creación' : 'Crear visita'}</button></footer>
  </form></section>;
}

function useProductionDraft({visit, source, key, onDirty, onReload}) {
  const [draftModel] = useState(()=>createProductionDraft(visit,source(visit)));
  const [reloadPrompt,setReloadPrompt]=useState(null);
  const reloadIntent=useRef(null);
  const latest = useRef(null), mounted = useRef(false);
  const [,render] = useState(0);
  const state = draftModel.snapshot;
  const publish = () => { if (mounted.current) render(value=>value+1); };
  const report = () => {if(mounted.current){const next=draftModel.snapshot;onDirty(key,next.dirty || next.blocked || next.pending);}};
  useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;reloadIntent.current=null;onDirty(key,false);}},[key,onDirty]);
  // Do not mutate the model on speculative React renders. begin() independently
  // rejects a changed latest prop even before this layout effect can execute.
  useLayoutEffect(()=>{latest.current={visit,source};});
  const sourceKey=JSON.stringify(visit);
  const cancelReload=()=>{reloadIntent.current=null;setReloadPrompt(null);};
  useLayoutEffect(()=>{
    cancelReload();
    try{draftModel.observe(visit,source(visit));}catch(reason){draftModel.fail(reason);}
    report();publish();
  },[sourceKey]);
  const edit = value => {cancelReload();draftModel.edit(value);report();publish();};
  const begin = () => {cancelReload();try{return draftModel.begin(visit);}finally{report();publish();}};
  const complete = result => {
    const fresh=verifiedProductionDraftVisit(result,visit.id);
    draftModel.complete(fresh,latest.current.source(fresh));report();publish();
  };
  const fail = reason => {draftModel.fail(reason);report();publish();};
  const performReload = async () => {
    if(!mounted.current||!draftModel.beginReload(()=>true))return;
    report();publish();
    try{const fresh=await onReload(visit.id);if(mounted.current){complete(fresh);return true;}}
    catch(reason){if(mounted.current){fail(reason);return false;}}
  };
  const reloadObservation=()=>JSON.stringify({state:draftModel.snapshot,visit:latest.current?.visit});
  const reload = () => {
    if(!mounted.current||draftModel.snapshot.pending||reloadIntent.current)return;
    if(!draftModel.snapshot.dirty&&!draftModel.snapshot.uncertain)return performReload();
    const intent={observation:reloadObservation()};reloadIntent.current=intent;setReloadPrompt(intent);
  };
  const confirmReload = intent => {
    if(!mounted.current||!intent||reloadIntent.current!==intent)return;
    const current=intent.observation===reloadObservation();cancelReload();
    if(current)return performReload();
  };
  return {...state,edit,begin,complete,fail,reload,reloadPrompt,cancelReload,confirmReload};
}
function DraftRecovery({form,busy}) {
  const keepRef=useRef(null),invokerRef=useRef(null);
  const [focusRequest,setFocusRequest]=useState(null);
  useEffect(()=>{
    if(!focusRequest)return;
    restoreProductionDraftRecoveryFocus(focusRequest.result,focusRequest.scope);setFocusRequest(null);
  },[focusRequest]);
  const confirmReload=async()=>{
    const invoker=invokerRef.current,scope={form:invoker?.closest('form'),invoker};
    const result=await form.confirmReload(form.reloadPrompt);
    if(typeof result==='boolean')setFocusRequest({result,scope});
  };
  if(!form.dirty && !form.blocked)return null;
  return <div className="prod-wide">
    {form.blocked && <p role="alert">{form.saved ? 'El cambio se guardó. No repitas el envío: cargá la versión guardada para verificarlo.' : form.uncertain ? 'No se pudo confirmar el envío. No lo repitas: revisá los registros guardados.' : 'La visita cambió. Tus campos se conservan, pero no se pueden guardar sobre otra revisión.'}</p>}
    <button ref={invokerRef} type="button" disabled={busy || form.pending} onClick={()=>void form.reload()}>Descartar campos y cargar versión guardada</button>
    {form.reloadPrompt && <Modal native className="prod-discard-modal" overlayAriaLabel="Cargar versión guardada" title={<h2>¿Cargar la versión guardada?</h2>} onClose={form.cancelReload} initialFocusRef={keepRef} returnFocusRef={invokerRef}>
      <div className="modal-body"><p>Se descartarán estos campos sin guardar. Si un envío fue incierto, revisá los registros guardados antes de crear otro. Esta consulta no repite el envío.</p>
        <div className="modal-actions"><button ref={keepRef} type="button" onClick={form.cancelReload}>Seguir editando</button><button type="button" disabled={busy || form.pending} onClick={()=>void confirmReload()}>Descartar campos y consultar</button></div>
      </div>
    </Modal>}
  </div>;
}
function MediaForm({visit, item, kind, busy, onWrite, onDirty, onCreated, onReload, focusReturnTarget, focusReturnCurrent}) {
  const video = kind === 'videos';
  const focusMounted = useRef(false);
  const activeMediaFocus = useRef(null);
  useLayoutEffect(()=>{focusMounted.current=true;return()=>{
    focusMounted.current=false;activeMediaFocus.current?.dispose();activeMediaFocus.current=null;
  };},[]);
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
    const focusIntent = !item ? captureProductionMediaFocus({
      form:event.currentTarget,target:focusReturnTarget?.current,documentTarget:document,
      isCurrent:focusReturnCurrent,
    }) : null;
    activeMediaFocus.current?.dispose();activeMediaFocus.current=focusIntent;
    try {
      const url = video ? draft.material_url : draft.drive_url;
      if (url && !safeProductionUrl(url)) throw new Error('Usá un enlace http o https.');
      const intent=form.begin();
      try{form.complete(await onWrite(intent.visit,`/${kind}${item ? `/${encodeURIComponent(item.id)}` : ''}`,item ? 'PATCH' : 'POST',intent.draft));}
      catch(reason){form.fail(reason);throw reason;}
      if (!item && focusMounted.current) {
        const confirmedFocus=focusIntent?.confirm() ? focusIntent : null;
        activeMediaFocus.current=null; // Parent now owns confirmed restoration after child removal.
        onCreated(confirmedFocus);
      }
      else focusIntent?.dispose();
    } catch (reason) { focusIntent?.dispose();setError(reason.message); }
    finally { if(activeMediaFocus.current===focusIntent)activeMediaFocus.current=null; }
  };
  return <form className="prod-form prod-media-form" onSubmit={submit}>
    <label>{video ? 'Título del video' : 'Tipo de fotos'}<input required maxLength={250} value={video ? draft.titulo : draft.tipo} disabled={busy} onChange={e=>setDraft({...draft,[video ? 'titulo' : 'tipo']:e.target.value})}/></label>
    <FilterSelect label="Estado" value={draft.estado} disabled={busy} onChange={e=>setDraft({...draft,estado:e.target.value})}>{Object.entries(video ? VIDEO_STATES : PHOTO_STATES).map(([id,label])=><option key={id} value={id}>{label}</option>)}</FilterSelect>
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
  return <details className="prod-handoff"><summary>Enviar a edición</summary><form className="prod-form" onSubmit={submit}><FilterSelect label="Editor" required value={editorId} disabled={busy} onChange={e=>setEditorId(e.target.value)}><option value="">Elegí una persona</option>{users.filter(user=>user.activo === true && ['admin','edicion'].includes(user.rol)).map(user=><option key={user.id} value={user.id}>{user.nombre} · #{user.id}</option>)}</FilterSelect><label>Fecha de entrega<input required type="date" value={date} disabled={busy} onChange={e=>setDate(e.target.value)}/></label>{!hasMaterial && <p className="prod-muted prod-wide">Vinculá el material del video o la carpeta Drive de la visita antes de enviar.</p>}<DraftRecovery form={form} busy={busy}/>{error && <p className="prod-error prod-wide" role="alert">{error}</p>}<footer className="prod-wide"><button disabled={busy || form.pending || form.blocked || !editorId || !date || !hasMaterial} type="submit">Enviar video a edición</button></footer></form></details>;
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
function VisitAgendaItem({visit, users = [], selected, onOpen}) {
  const participants = (visit.participante_ids || []).map(id => users.find(user => user.id === id)?.nombre || `Usuario #${id}`);
  return <article className="prod-agenda-entry"><button type="button" className="prod-agenda-item" aria-pressed={selected} onClick={()=>onOpen(visit.id)}><span><strong>{visit.titulo}</strong><small>{visit.cliente_nombre}</small></span><span aria-hidden="true">›</span></button>
    <dl className="prod-agenda-context"><div><dt>Grabación</dt><dd><time dateTime={visit.fecha}>{dateLabel(visit.fecha)}</time></dd></div><div><dt>Participantes</dt><dd>{participants.join(', ') || 'Sin participantes'}</dd></div></dl>
    <p className="prod-muted">{productionResultStatus(visit.ultimo_resultado,visit.revision).label}</p><ul className="prod-agenda-media">{(visit.videos || []).map(video=><li key={video.id}><span>Video · {video.titulo}</span><span className={`prod-status is-${video.estado}`}>{VIDEO_STATES[video.estado] || video.estado}</span></li>)}{(visit.fotos || []).map(photo=><li key={photo.id}><span>Fotos · {photo.tipo}</span><span className={`prod-status is-${photo.estado}`}>{PHOTO_STATES[photo.estado] || photo.estado}</span></li>)}</ul>{!visit.videos?.length && !visit.fotos?.length && <p className="prod-muted">Sin material registrado todavía.</p>}</article>;
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
        <FilterSelect className="prod-wide" label={kind === 'piece' ? 'Publicación existente' : 'Casillero vacío'} value={choice} required disabled={busy || submitting || !catalogReady} onChange={event=>{setChoice(event.target.value);setAcknowledged(false);}}><option value="">{kind === 'piece' ? 'Elegí una publicación' : 'Elegí un casillero'}</option>{unavailable && <option disabled value={choice}>La selección anterior ya no está disponible</option>}{options.map(item=><option key={kind === 'piece' ? item.publicacion_id : item.objetivo_pieza_id} value={kind === 'piece' ? item.publicacion_id : item.objetivo_pieza_id}>{item.titulo || (kind === 'piece' ? `Publicación #${item.publicacion_id}` : `Video ${item.numero}`)} · tarea #{item.tarea_id}{item.objetivo_pieza_id ? ` · casillero #${item.objetivo_pieza_id}` : ''}{item.fecha_programada ? ` · ${item.fecha_programada}` : ''}</option>)}</FilterSelect>
        {catalogReady && !options.length && <p className="prod-muted prod-wide">No hay {kind === 'piece' ? 'publicaciones compatibles' : 'casilleros vacíos compatibles'} para este mes. No se adoptan tareas duplicadas ni trabajos ya iniciados.</p>}
        {candidate && <p className="prod-editorial-review prod-wide">Se conservará la <a href={`/workspace/tareas?task=${candidate.tarea_id}`}>tarea de entrega #{candidate.tarea_id} ↗</a>{kind === 'piece' ? ` y la publicación #${candidate.publicacion_id}` : '; se creará una publicación borrador en el casillero elegido'}. No se crea otra tarea.{video.tarea_edicion_id ? ` Tarea de edición actual: #${video.tarea_edicion_id}.` : ''}</p>}
        {requiresGoalAck && <label className="prod-editorial-ack prod-wide"><input type="checkbox" checked={acknowledged} disabled={busy || submitting || !catalogReady} onChange={event=>setAcknowledged(event.target.checked)}/>Confirmo que también se conserva el casillero #{candidate.objetivo_pieza_id}{candidate.periodo ? ` de ${candidate.periodo}` : ''} vinculado a esta publicación.</label>}
        {kind === 'goal' && <label className="prod-wide">Fecha de programación<input type="date" required value={plannedDate} disabled={busy || submitting} onChange={event=>setPlannedDate(event.target.value)}/><small>Elegí la fecha editorial. Es distinta de la visita y de la entrega de edición. El guion no se usa como copy.</small></label>}
        <footer className="prod-wide"><button type="submit" disabled={busy || submitting || !catalogReady || !candidate || (requiresGoalAck && !acknowledged) || (kind === 'goal' && !plannedDate)}>{submitting ? 'Vinculando…' : 'Confirmar vinculación'}</button></footer>
      </>}
    </form>}
  </details>;
}
function VisitDetail({visit, users, busy, isAdmin, sesion, onBatchDraftStateChange, onBatchSaved, onWrite, onDirty, onReload, resultControls}) {
  const [adding, setAdding] = useState({});
  const [resultObservation,setResultObservation] = useState(null);
  const resultKnown=resultObservation?.visitId===visit.id&&resultObservation?.revision===visit.revision;
  const mediaFocusTargets = useRef({videos:{current:null},fotos:{current:null}});
  const mediaFocusOwner = useRef(false);
  useLayoutEffect(()=>{mediaFocusOwner.current=true;return()=>{mediaFocusOwner.current=false;};},[]);
  const pendingMediaFocus = useRef(null);
  useLayoutEffect(()=>{
    const intent=pendingMediaFocus.current;pendingMediaFocus.current=null;
    intent?.restore();
  },[adding]);
  useLayoutEffect(()=>()=>{pendingMediaFocus.current?.dispose();pendingMediaFocus.current=null;},[]);
  return <section className="prod-panel prod-detail" aria-label="Detalle de visita"><header className="prod-detail-heading"><span>{visit.cliente_nombre}</span><h2>{visit.titulo}</h2><p>{dateLabel(visit.fecha)}</p><SafeLink url={visit.drive_url}/></header>
    {visit.observaciones && <p className="prod-notes">{visit.observaciones}</p>}<p className="prod-muted">Participantes: {(visit.participante_ids || []).map(id=>users.find(user=>user.id===id)?.nombre || `Usuario #${id}`).join(', ') || 'Sin participantes'}</p>
    {visit.tarea_origen_id && <a href={`/workspace/tareas?task=${visit.tarea_origen_id}`}>Ver tarea de origen ↗</a>}
    {isAdmin&&visit.tarea_origen_id&&<ProductionHistoryBatchReview sourceId={visit.tarea_origen_id} sesion={sesion} users={users} disabled={busy} onDraftStateChange={onBatchDraftStateChange} onSaved={onBatchSaved}/>}
    <ProductionResultHistory visit={visit} sesion={sesion} onObservation={setResultObservation}/>
    <ProductionResultRegister visit={visit} {...resultControls} disabled={!resultKnown} registered={resultKnown&&resultObservation.registered}/>
    <VisitEditor visit={visit} users={users} busy={busy} onWrite={onWrite} onDirty={onDirty} onReload={onReload}/>
    {['videos','fotos'].map(kind=><section key={kind} className="prod-media-section"><header className="prod-section-heading"><h3>{kind === 'videos' ? 'Videos' : 'Fotos'} <span>{visit[kind]?.length || 0}</span></h3><button ref={mediaFocusTargets.current[kind]} disabled={busy} type="button" onClick={()=>setAdding(current=>({...current,[kind]:true}))}>+ {kind === 'videos' ? 'Video' : 'Fotos'}</button></header>
      {(visit[kind] || []).map(item=><article className="prod-media" key={item.id}><header><h4>{item.titulo || item.tipo}</h4><span className={`prod-status is-${item.estado}`}>{(kind === 'videos' ? VIDEO_STATES : PHOTO_STATES)[item.estado] || item.estado}</span></header><SafeLink url={item.material_url || item.drive_url}/>
        {item.tarea_edicion_id && <a className="prod-task-link" href={`/workspace/tareas?task=${item.tarea_edicion_id}`}>Edición · {TASK_STATES[item.tarea_estado] || item.tarea_estado || 'Ver tarea'} ↗</a>}
        {item.tarea_edicion_id && <EditingAssignment video={item} users={users}/>}
        {kind === 'videos' && <EditorialLinkSummary video={item}/>}
        {kind === 'videos' && item.guion && <details><summary>Ver guion</summary><p className="prod-script">{item.guion}</p></details>}
        <details><summary>Editar {kind === 'videos' ? 'video' : 'fotos'}</summary><MediaForm visit={visit} item={item} kind={kind} busy={busy} onWrite={onWrite} onDirty={onDirty} onReload={onReload}/></details>
        {isAdmin && kind === 'videos' && <EditorialAssociation visit={visit} video={item} busy={busy} onWrite={onWrite} onDirty={onDirty}/>}
        {isAdmin && kind === 'videos' && item.estado === 'grabado' && !item.tarea_edicion_id && <SendToEditing visit={visit} video={item} users={users} busy={busy} onWrite={onWrite} onDirty={onDirty} onReload={onReload}/>}
      </article>)}{!visit[kind]?.length && <p className="prod-empty">Sin {kind} registrados.</p>}
      {adding[kind] && <MediaForm key={`${visit.id}:${kind}:new`} visit={visit} kind={kind} busy={busy} onWrite={onWrite} onDirty={onDirty} onReload={onReload} focusReturnTarget={mediaFocusTargets.current[kind]} focusReturnCurrent={()=>mediaFocusOwner.current} onCreated={intent=>{
        pendingMediaFocus.current?.dispose();pendingMediaFocus.current=intent;
        setAdding(current=>({...current,[kind]:false}));
      }}/>}
    </section>)}
  </section>;
}

export function ProductionsPage({sesion}) {
  const today = getHoyLocalISO();
  const [initial] = useState(()=>initialProductionContext(window.location.href,today));
  const [contextError,setContextError] = useState(initial.error);
  const [month, setMonth] = useState(initial.month || today.slice(0,7));
  const [day, setDay] = useState(()=>productionCalendarDay(initial,today));
  const [dayOpen,setDayOpen]=useState(false);
  const [tab, setTab] = useState(initial.tab);
  const [clientId, setClientId] = useState(initial.clientId);
  const [listAvailable,setListAvailable] = useState(false);
  const readEpoch = useRef(0);
  const visitObserver=useRef(null);
  if(!visitObserver.current)visitObserver.current=createProductionVisitObserver(()=>readEpoch.current);
  const observeProductionVisit=value=>visitObserver.current.observe(value);
  const [visits, setVisits] = useState([]);
  const [users, setUsers] = useState([]);
  const [clients, setClients] = useState([]);
  const productionCatalog = useRef(null);
  if (!productionCatalog.current || productionCatalog.current.session !== sesion) productionCatalog.current = { session: sesion, reader: createProductionCatalogReader() };
  const [pending, setPending] = useState([]);
  const [pendingPhotos, setPendingPhotos] = useState([]);
  const [bankObservation,setBankObservation]=useState(null);
  const pendingAvailable=bankObservation?.epoch===readEpoch.current&&bankObservation?.token===visitObserver.current.token;
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pageBusy, setBusy] = useState(false);
  const [batchBusy,setBatchBusy]=useState(false),batchDraft=useRef({dirty:false,busy:false});
  const [resultBusy,setResultBusy]=useState(false),resultDraft=useRef({busy:false,locked:false});
  const busy=pageBusy||batchBusy||resultBusy;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const writeLock = useRef(false);
  const openVersion = useRef(0);
  const refreshVersion = useRef(0);
  const navigationRef = useRef(null);
  const calendarHeadingRef = useRef(null);
  const contextGate=useRef(null);
  if(!contextGate.current)contextGate.current=createProductionContextGate();
  const [contextLifetime]=useState(()=>Object.freeze({}));
  const contextConfirmation=useNavigationConfirmation({lifetime:contextLifetime});
  useLayoutEffect(()=>{const lease=contextGate.current.activate();return()=>contextGate.current.deactivate(lease);},[]);
  const dirty = useRef(new Set());
  const productionObservation = useRef(Symbol('production-form-observation'));
  useNavigationGuard(() => ({ dirty: dirty.current.size > 0, busy: writeLock.current||batchDraft.current.busy||resultDraft.current.busy||contextGate.current.pending }),()=>productionObservation.current);
  const isAdmin = positiveId(sesion?.usuario?.id) && sesion.usuario.rol === 'admin';
  const onDirty = useCallback((key,value)=>{contextGate.current.invalidate();productionObservation.current=Symbol('production-form-observation');if(value) dirty.current.add(key); else dirty.current.delete(key);},[]);
  const onBatchDraftStateChange=useCallback(next=>{batchDraft.current=next;setBatchBusy(next.busy);onDirty('history-batch',next.dirty);},[onDirty]);
  const onResultState=useCallback(next=>{resultDraft.current=next;setResultBusy(next.busy||next.locked);onDirty('visit-result',next.locked);},[onDirty]);
  const captureResult=()=>{
    if(writeLock.current||batchDraft.current.busy||dirty.current.size)throw new Error('Guardá los cambios antes de registrar el resultado.');
    const epoch=readEpoch.current,version=openVersion.current;
    const scope=createCapturedRequest({session:sesion,readSession:getSesion,request:apiRequest,isActive:()=>readEpoch.current===epoch&&openVersion.current===version});
    return {...scope,actorId:sesion?.usuario?.id};
  };
  const mayLeave = action => contextGate.current.run(action,{
    capture:()=>createCapturedRequest({session:sesion,readSession:getSesion,request:apiRequest}),
    readState:()=>({busy:writeLock.current||batchDraft.current.busy||resultDraft.current.busy,dirty:dirty.current.size>0,
      observation:productionObservation.current,epoch:readEpoch.current,version:openVersion.current,
      visitObservation:visitObserver.current.token,location:window.location.href}),
    confirm:intent=>contextConfirmation.request({...intent,fallbackFocus:calendarHeadingRef.current}),
    onDiscard:()=>dirty.current.clear(),
  });
  useEffect(()=>{
    const controller = new AbortController(),epoch=readEpoch.current;setLoading(true);setListAvailable(false);setError('');
    if(contextError){setLoading(false);return;}
    const current=()=>!controller.signal.aborted && epoch===readEpoch.current;
    Promise.all([apiRequest(productionReadUrl({month,clientId,tab:'calendar'}),{signal:controller.signal}),productionCatalog.current.reader.read(apiRequest,'/api/usuarios',{signal:controller.signal}),productionCatalog.current.reader.read(apiRequest,'/api/clientes',{signal:controller.signal})])
      .then(async([data,people,brands])=>{if(current()){
        if(!Array.isArray(data?.visitas))throw new Error('No se pudo verificar la lista de producciones.');
        const verifiedVisits=data.visitas.map(visit=>assertProductionClient(verifiedProductionDraftVisit(visit),clientId));
        const observedVisits=verifiedVisits.map(observeProductionVisit);
        const token=visitObserver.current.token;
        const bank=tab==='pending'?await apiRequest(productionReadUrl({month,clientId,tab}),{signal:controller.signal}):null;
        if(!current())return;
        if(tab==='pending'&&token!==visitObserver.current.token)throw new Error('Las visitas cambiaron durante la consulta. Actualizá los pendientes para ver el material vigente.');
        if(tab==='pending'&&(!Array.isArray(bank?.videos)||!Array.isArray(bank?.fotos)))throw new Error('No se pudo verificar la lista de producciones.');
        bank?.videos.forEach(video=>assertProductionClient(video,clientId));bank?.fotos.forEach(photo=>assertProductionClient(photo,clientId));
        setVisits(current=>reconcileProductionVisitList(current,observedVisits,{month,clientId}));
        setSelected(current=>{const value=observedVisits.find(visit=>visit.id===current?.id);return value?newestProductionVisit(current,value):current;});
        setPending(bank?.videos || []);setPendingPhotos(bank?.fotos || []);setBankObservation(tab==='pending'?{epoch,token}:null);setUsers(people.filter(user=>user.activo === true && positiveId(user.id)));setClients(brands);setListAvailable(true);
      }})
      .catch(reason=>{if(current())setError(reason.message);}).finally(()=>{if(current())setLoading(false);});
    return()=>controller.abort();
  },[month,clientId,tab,contextError,reload]);
  const refreshVisit = async (id, guard, options) => {
    guard?.assertCurrent();
    const epoch=readEpoch.current,version=openVersion.current,refresh=++refreshVersion.current;
    const assertCurrentRead=()=>{
      guard?.assertCurrent();
      if(epoch!==readEpoch.current||version!==openVersion.current||refresh!==refreshVersion.current)
        throw Object.assign(new Error('El contexto de lectura de la visita cambió.'),{code:'production_read_obsolete'});
    };
    assertCurrentRead();
    const url=`/api/producciones/${encodeURIComponent(id)}`;
    let response;
    try { response=await (guard ? guard.request(url,options) : apiRequest(url,options)); }
    catch(reason){assertCurrentRead();throw reason;}
    assertCurrentRead();
    const verified=assertProductionClient(verifiedProductionDraftVisit(response,id),clientId);
    const value=observeProductionVisit(verified);
    setSelected(current=>current?.id === id ? newestProductionVisit(current,value) : current);
    setVisits(current=>reconcileProductionVisitList(current,current.map(visit=>visit.id === id ? value : visit),{month,clientId}));
    return value;
  };
  const onBatchSaved=async(result,guard)=>{
    guard.assertCurrent();setNotice('Revisión guardada. Consultando la visita actual…');
    const epoch=readEpoch.current,version=openVersion.current;
    const pending=refreshVisit(result.visita_id,guard,{cache:'no-store'}),refresh=refreshVersion.current;
    const current=()=>guard.current()&&epoch===readEpoch.current&&version===openVersion.current&&refresh===refreshVersion.current;
    try{await pending;if(current())setNotice('Revisión guardada. Se muestra la visita actual.');}
    catch(reason){if(current()&&reason.code!=='production_read_obsolete')setNotice('Revisión guardada; no pudimos actualizar la visita. Volvé a consultarla, sin repetir la revisión.');}
  };
  const openVisit = async (id, {history = true, checkDirty = true, expectedClient = clientId} = {}) => {
    if(checkDirty)return mayLeave(()=>openVisit(id,{history,checkDirty:false,expectedClient}));
    const version=++openVersion.current;setCreating(false);setSelected(null);setDetailLoading(true);setError('');
    try {
      const verified=verifiedProductionDraftVisit(await apiRequest(`/api/producciones/${encodeURIComponent(id)}`),id);
      if(version===openVersion.current) {
        assertProductionClient(verified,expectedClient);
        const value=observeProductionVisit(verified);
        if(!history) {
          // Restoration may still close over the previous filter/tab. Only the
          // current URL can supply the context for this verified-date repair.
          const context=productionLocation(window.location.href);
          if(context.id===value.id && context.clientId===expectedClient && (context.month!==value.fecha.slice(0,7) || context.day!==value.fecha)) {
            writeProductionLocation({id:value.id,month:value.fecha.slice(0,7),day:value.fecha,clientId:context.clientId,tab:context.tab,replace:true});
          }
        }
        setSelected(value);setMonth(value.fecha.slice(0,7));setDay(value.fecha);
        if(history) writeProductionLocation({id:value.id,month:value.fecha.slice(0,7),day:value.fecha,clientId,tab});
      }
    }
    catch(reason){if(version===openVersion.current)setError(reason.message);}
    finally{if(version===openVersion.current)setDetailLoading(false);}
  };
  const restoreProductionLocation = async ({discardDrafts = false} = {}) => {
    contextGate.current.invalidate();
    try {
      const location=productionLocation(window.location.href);
      ++readEpoch.current;setListAvailable(false);setContextError('');setClientId(location.clientId);setTab(location.tab);
      const restoredMonth=location.month || today.slice(0,7);
      setMonth(restoredMonth);setDay(productionCalendarDay(location,today));
      setReload(value=>value+1);
      if(discardDrafts) dirty.current.clear();
      if(location.id) await openVisit(location.id,{history:false,checkDirty:false,expectedClient:location.clientId});
      else {
        ++openVersion.current;setSelected(null);setCreating(false);setDetailLoading(false);setError('');
        const restoredMonth=location.month || today.slice(0,7);
        setMonth(restoredMonth);setDay(productionCalendarDay(location,today));
      }
    }catch(reason){++readEpoch.current;++openVersion.current;setListAvailable(false);setContextError(reason.message);setSelected(null);setDetailLoading(false);setError(reason.message);}
  };
  navigationRef.current = restoreProductionLocation;
  useEffect(()=>{
    const restore=event=>{void navigationRef.current({discardDrafts:event?.type === 'popstate'});};
    restore();window.addEventListener('popstate',restore);
    return()=>{++readEpoch.current;++openVersion.current;window.removeEventListener('popstate',restore);};
  },[]);
  const retryProductionPage = () => {
    productionCatalog.current.reader.clear();
    if(!selected)return mayLeave(()=>{setReload(value=>value+1);return navigationRef.current();});
    setReload(value=>value+1);
    if(selected) {
      const epoch=readEpoch.current,version=openVersion.current;
      const pending=refreshVisit(selected.id),refresh=refreshVersion.current;
      void pending.catch(reason=>{
        if(epoch===readEpoch.current&&version===openVersion.current&&refresh===refreshVersion.current&&reason.code!=='production_read_obsolete')setError(reason.message);
      });
    }
    else void navigationRef.current();
  };
  const retryPendingBank=()=>{
    productionCatalog.current.reader.clear();
    if(writeLock.current||batchDraft.current.busy)return;
    setReload(value=>value+1);
  };
  const writeVisit = async (visit,path,method,data) => {
    if(writeLock.current||batchDraft.current.busy||resultDraft.current.busy||resultDraft.current.locked) throw new Error('Hay otra operación en curso.');
    // Pin the rendered actor and visible context before dispatch, including
    // conflict recovery/readback. Never recapture a later cookie account.
    const epoch=readEpoch.current,version=openVersion.current;
    const guard=createCapturedRequest({session:sesion,readSession:getSesion,request:apiRequest,
      isActive:()=>readEpoch.current===epoch&&openVersion.current===version});
    guard.assertCurrent();
    const refresh=id=>refreshVisit(id,guard);
    writeLock.current=true;setBusy(true);setNotice('');
    try {
      const response=await productionWrite({visit,path,method,data,request:guard.request,refresh});
      guard.assertCurrent();
      // Read back the full aggregate: nested endpoints may return only the changed record.
      let fresh;
      try { fresh=await refresh(visit.id);guard.assertCurrent();setNotice('Cambios guardados.'); }
      catch {
        guard.assertCurrent();
        const ack=visitDTO(response);
        const saved=ack?.id===visit.id && positiveId(ack.revision) && ack.revision>visit.revision;
        throw Object.assign(new Error(saved
          ? 'El cambio se guardó, pero no pudimos verificar el detalle completo. No repitas el envío: cargá la versión guardada.'
          : 'No pudimos verificar el resultado completo. No repitas el envío antes de cargar la versión guardada.'),{productionSaved:saved});
      }
      // Follow only an explicit reschedule after its full server readback.
      // Delivery dates and edits of videos/photos must not move the visit.
      if(path==='' && method==='PATCH' && Object.hasOwn(data,'fecha') && fresh.fecha!==visit.fecha) {
        setMonth(fresh.fecha.slice(0,7));setDay(fresh.fecha);
        writeProductionLocation({id:fresh.id,month:fresh.fecha.slice(0,7),day:fresh.fecha,clientId,tab,replace:true});
      }
      setReload(value=>value+1);return fresh;
    } catch(reason){if(guard.current())setNotice(reason.message);throw reason;}
    finally{writeLock.current=false;if(guard.current())setBusy(false);}
  };
  const createVisit = async (body, guard) => {
    guard.assertCurrent();
    if(writeLock.current) throw new Error('Hay otra operación en curso.');
    writeLock.current=true;setBusy(true);
    try {
      const response=await guard.request('/api/producciones',{method:'POST',headers:{'Content-Type':'application/json'},body});
      guard.assertCurrent();return assertProductionClient(verifiedProductionDraftVisit(response),String(JSON.parse(body).cliente_id));
    } finally{writeLock.current=false;if(guard.current())setBusy(false);}
  };
  const createdVisit = (value, guard) => {
    guard.assertCurrent();value=verifiedProductionDraftVisit(value);
    ++readEpoch.current;++openVersion.current;setListAvailable(false);setClientId(String(value.cliente_id));setContextError('');
    setCreating(false);setSelected(value);setMonth(value.fecha.slice(0,7));setDay(value.fecha);setReload(current=>current+1);setNotice('Visita guardada. Se muestra la versión actual.');
    writeProductionLocation({id:value.id,month:value.fecha.slice(0,7),day:value.fecha,clientId:String(value.cliente_id),tab});
  };
  const changeContext = (nextClient, nextTab, nextMonth=month, nextDayOverride=null) => mayLeave(()=>{
    const nextDay=nextDayOverride || productionCalendarDay({month:nextMonth,day:nextMonth===month?day:`${nextMonth}-01`},today);
    ++readEpoch.current;++openVersion.current;setListAvailable(false);setLoading(true);setContextError('');setError('');setClientId(nextClient);setTab(nextTab);setMonth(nextMonth);setDay(nextDay);setDetailLoading(false);setSelected(null);setCreating(false);setReload(value=>value+1);
    writeProductionLocation({month:nextMonth,day:nextDay,clientId:nextClient,tab:nextTab});
  });
  const selectDay = (nextDay,showWindow=false) => {
    if(!validProductionDay(nextDay)||!nextDay.startsWith(`${month}-`))return;
    if(nextDay===day){if(showWindow)setDayOpen(true);return;}
    return mayLeave(()=>{
      ++openVersion.current;setDay(nextDay);setSelected(null);setCreating(false);setDetailLoading(false);
      if(showWindow)setDayOpen(true);
      writeProductionLocation({month,day:nextDay,clientId,tab,replace:true});
    });
  };
  const navigateMonth = amount => changeContext(clientId,tab,shiftProductionMonth(month,amount));
  const startCreateVisit = () => {
    // Re-entering the same mounted form must not clear its dirty registration
    // or abandon an uncertain creation receipt while retaining visible fields.
    if (creating) return;
    return mayLeave(()=>{++openVersion.current;setDetailLoading(false);setSelected(null);setCreating(true);});
  };
  const filtered = visits.filter(visit=>!clientId || visit.cliente_id === Number(clientId));
  const visitsByDate=new Map();
  for(const visit of filtered){if(!visitsByDate.has(visit.fecha))visitsByDate.set(visit.fecha,[]);visitsByDate.get(visit.fecha).push(visit);}
  const cancelCreateVisit=()=>mayLeave(()=>setCreating(false));
  const selectedDayVisits = filtered.filter(visit=>visit.fecha === day);
  const visitOutsideDay=tab==='calendar' && selected && validProductionDay(selected.fecha) && selected.fecha!==day;
  const showVisitDay=()=>{
    if(tab!=='calendar'||!selected||!validProductionDay(selected.fecha)||writeLock.current||batchDraft.current.busy||resultDraft.current.busy||resultDraft.current.locked)return;
    setMonth(selected.fecha.slice(0,7));setDay(selected.fecha);
    writeProductionLocation({id:selected.id,month:selected.fecha.slice(0,7),day:selected.fecha,clientId,tab,replace:true});
    calendarHeadingRef.current?.focus();
  };
  const resultControls={capture:captureResult,onState:onResultState,onSaved:async(id,scope)=>{await refreshVisit(id,scope);scope.assertCurrent();setReload(value=>value+1);}};
  const resume = async video => {
    if(selected?.id === video.visita_id){setNotice('Este guion ya está en la visita seleccionada. Elegí otra visita para retomarlo.');return;}
    if(!selected || selected.cliente_id !== video.cliente_id){setNotice('Elegí una visita del mismo cliente antes de retomar este guion.');return;}
    try {await writeVisit(selected,'/videos','POST',{video_origen_id:video.id});}catch{/* Conflict message already visible. */}
  };
  return <main className="productions-page">{contextConfirmation.dialog}<header className="prod-page-heading"><div><h1>Producciones</h1><p>Grabaciones y material del equipo.</p></div><div className="prod-heading-actions"><button className="prod-refresh" type="button" disabled={busy} onClick={retryProductionPage}>Actualizar</button><button className="prod-primary" type="button" disabled={busy} onClick={startCreateVisit}>Nueva visita</button></div></header>
    <nav className="prod-toolbar" aria-label="Vistas de producciones">
      <div className="prod-tabs">{[['calendar','Visitas'],['pending','Videos pendientes']].map(([id,label])=><button type="button" key={id} aria-pressed={tab===id} onClick={()=>changeContext(clientId,id)}>{label}</button>)}</div>
      <FilterSelect label="Cliente" value={clientId} onChange={e=>changeContext(e.target.value,tab)}><option value="">Todos los clientes</option>{clientId && !clients.some(client=>String(client.id)===clientId) && <option value={clientId}>Cliente #{clientId}</option>}{clients.map(client=><option key={client.id} value={client.id}>{client.nombre}{client.activo === false ? ' (inactivo)' : ''}</option>)}</FilterSelect>
    </nav>
    {notice && <p className="prod-notice" role="status">{notice}</p>}{error && <p className="prod-error" role="alert">{error} <button type="button" disabled={busy||loading} onClick={tab==='pending'?retryPendingBank:retryProductionPage}>Reintentar</button></p>}
    <div className={'prod-layout'+(!selected&&!creating&&!detailLoading?' prod-layout-full':'')}><section className="prod-schedule" aria-label={tab==='calendar' ? 'Calendario de visitas' : 'Material pendiente'}>
      <header className="prod-month-nav"><button type="button" aria-label="Mes anterior" disabled={busy} onClick={()=>navigateMonth(-1)}>‹</button><h2 ref={calendarHeadingRef} tabIndex={-1}>{monthLabel(month)}</h2>{tab==='calendar'&&<button className="calendar-today" type="button" disabled={busy} onClick={()=>changeContext(clientId,tab,today.slice(0,7),today)}>Hoy</button>}<button type="button" aria-label="Mes siguiente" disabled={busy} onClick={()=>navigateMonth(1)}>›</button></header>
      {loading ? <p className="prod-empty" role="status">Cargando producciones…</p> : !listAvailable || contextError ? <p className="prod-empty" role="status">Lista no disponible. Revisá el contexto y volvé a consultar. {tab==='pending'&&!contextError&&<button type="button" disabled={busy} onClick={retryPendingBank}>Actualizar pendientes</button>}</p> : tab==='pending'&&!pendingAvailable ? <div className="prod-empty" role="status"><p>Las visitas cambiaron. Actualizá los pendientes para consultar el material vigente.</p><button type="button" disabled={busy} onClick={retryPendingBank}>Actualizar pendientes</button></div> : tab === 'calendar' ? <>
        <div className="prod-month-grid"><div className="prod-weekdays" aria-hidden="true">{['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(name=><span key={name}>{name}</span>)}</div><div className="prod-days">{productionMonthDays(month).map((date,index)=>{if(!date)return <span key={`blank-${index}`} aria-hidden="true"/>;const dayVisits=visitsByDate.get(date)||[];return <button type="button" key={date} disabled={busy} aria-pressed={date===day} aria-current={date===today ? 'date' : undefined} aria-label={`${dateLabel(date)}, ${dayVisits.length} visitas`} aria-haspopup="dialog" onClick={()=>selectDay(date,true)}><time dateTime={date}>{Number(date.slice(-2))}</time>{dayVisits.slice(0,2).map(visit=><span key={visit.id} title={`${visit.cliente_nombre} · ${visit.titulo}`}>{visit.cliente_nombre}</span>)}{dayVisits.length>2&&<small className="calendar-overflow">+{dayVisits.length-2} más</small>}</button>;})}</div></div>
        {dayOpen&&<Modal native closeOnBackdropClick title="Visitas del día" overlayAriaLabel="Visitas del día" className="prod-day-dialog" overlayClassName="prod-day-overlay" onClose={()=>setDayOpen(false)}><section className="prod-day-agenda"><h3>{dateLabel(day)}</h3>{selectedDayVisits.map(visit=><VisitAgendaItem key={visit.id} visit={visit} users={users} selected={selected?.id===visit.id} onOpen={id=>{setDayOpen(false);void openVisit(id);}}/>)}{!selectedDayVisits.length && <p className="prod-empty">No hay visitas registradas este día.</p>}</section></Modal>}
        <section className="prod-mobile-agenda" aria-label="Agenda del mes"><label>Elegir día<input type="date" value={day} min={`${month}-01`} max={`${month}-${String(new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate()).padStart(2,'0')}`} onChange={e=>selectDay(e.target.value,true)}/></label></section>
      </> : <div className="prod-pending"><h3>Videos pendientes</h3><p className="prod-muted">Videos pendientes o para repetir. Retomarlos conserva la visita original y su guion.</p><FilterSelect label="Visita de destino" value={selected?.id || ''} disabled={busy} onChange={e=>{if(e.target.value)openVisit(e.target.value);}}><option value="">Elegí una visita del mes</option>{filtered.map(visit=><option key={visit.id} value={visit.id}>{visit.fecha} · {visit.cliente_nombre} · {visit.titulo}</option>)}</FilterSelect>{pending.map(video=><article className="prod-media" key={video.id}><header><h3>{video.titulo}</h3><span className="prod-status">{VIDEO_STATES[video.estado] || video.estado}</span></header><p className="prod-muted">{video.cliente_nombre} · {video.fecha}</p><p className="prod-script">{video.guion || 'Sin guion cargado'}</p><button type="button" disabled={busy || !selected || selected.id===video.visita_id || selected.cliente_id!==video.cliente_id} title={selected?.id===video.visita_id ? 'Este guion ya está en esta visita. Elegí otra visita de destino.' : undefined} onClick={()=>resume(video)}>Retomar en la visita seleccionada</button></article>)}{!pending.length && <p className="prod-empty">No hay videos pendientes para este cliente.</p>}<PendingProductionPhotos photos={pendingPhotos} busy={busy} onOpen={openVisit}/></div>}
    </section><div className="prod-detail-column" hidden={!selected&&!creating&&!detailLoading}>{visitOutsideDay && <div className="prod-notice prod-date-context" role="status"><p>Fecha de grabación guardada: <strong>{dateLabel(selected.fecha)}</strong>. El calendario muestra otro día.</p><button type="button" disabled={busy} onClick={showVisitDay}>Ver día de la visita</button></div>}{creating ? <CreateVisit key="create" clients={clients} users={users} date={day} busy={busy} sesion={sesion} onCreate={createVisit} onCreated={createdVisit} onDirty={onDirty} onCancel={cancelCreateVisit}/> : detailLoading ? <p role="status" className="prod-empty">Cargando visita…</p> : selected ? <VisitDetail key={selected.id} resultControls={resultControls} sesion={sesion} onBatchDraftStateChange={onBatchDraftStateChange} onBatchSaved={onBatchSaved} visit={selected} users={users} busy={busy} isAdmin={isAdmin} onWrite={writeVisit} onDirty={onDirty} onReload={refreshVisit}/> : <div className="prod-panel prod-empty"><h2>Elegí una visita</h2><p>Acá verás los videos, fotos y guiones del rodaje.</p></div>}</div></div>
  </main>;
}
