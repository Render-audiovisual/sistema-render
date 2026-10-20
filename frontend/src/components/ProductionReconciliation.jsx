import React,{useEffect,useRef,useState}from 'react';
import {apiRequest}from '../features/render-os/services/render-os-api.js';
import {getSesion}from '../utils.jsx';
import {DiscardChangesDialog}from './DiscardChangesDialog.jsx';
import {createProductionReconciliationModel,emptyReconciliationVideo}from './productionReconciliation.js';
import './ProductionReconciliation.css';

const blocked={legacy_editing:'Esta tarea ya tiene edición agregada. Hay que revisar su correspondencia antes de dividirla.',already_linked:'La tarea ya tiene una visita vinculada.',not_historical:'Esta tarea no tiene producción agregada histórica para revisar.',unavailable:'Revisá el cliente, la fecha y la disponibilidad de la tarea antes de continuar.'};
const contentLabels={instructions:'Indicaciones originales',script:'Guion original',material:'Material de la tarea',recorded_material:'Material registrado',feedback:'Feedback registrado',schedule:'Horario registrado'};
export function ProductionReconciliation(props){
  const u=props.sesion?.usuario;
  if(u?.rol!=='admin'||u.activo===false)return null;
  return <ReconciliationForm key={`${props.taskId}:${u.id}:${u.rol}:${props.sesion?.token}`} {...props}/>;
}
function ReconciliationForm({taskId,sesion,users=[],onDraftStateChange,onSaved,disabled=false,available=true,request=apiRequest}){
  const [state,setState]=useState({phase:'closed',busy:false,dirty:false});
  const [discard,setDiscard]=useState(false);
  const model=useRef(null),callback=useRef(onDraftStateChange),saved=useRef(onSaved),disabledRef=useRef(disabled),notified=useRef(null);
  callback.current=onDraftStateChange;saved.current=onSaved;disabledRef.current=disabled;
  useEffect(()=>{const instance=createProductionReconciliationModel({taskId,sesion,request,readSession:getSesion,onChange:setState,canAct:()=>!disabledRef.current});
    model.current=instance;return()=>{instance.dispose();callback.current?.({dirty:false,busy:false});if(model.current===instance)model.current=null;};},[taskId,request]);
  useEffect(()=>{callback.current?.({dirty:state.dirty,busy:state.busy});},[state.dirty,state.busy]);
  useEffect(()=>{if(state.phase==='saved'&&notified.current!==state.result.reconciliation_id){notified.current=state.result.reconciliation_id;saved.current?.(state.result);}},[state.phase,state.result]);
  const context=state.context,draft=state.draft;
  const update=changes=>model.current?.update(changes);
  const videoChange=(index,field,value)=>update({videos:draft.videos.map((v,n)=>n===index?{...v,[field]:value}:v)});
  const close=()=>{if(state.dirty)setDiscard(true);else model.current?.cancel();};
  if(state.phase==='closed'&&!available)return null;
  return <section className="ros-work-block ros-reconciliation" aria-label="Revisión de producción histórica">
    <h3>Producción histórica</h3>
    <p>Conservá el registro original e identificá cada video. No se crearán tareas de edición al guardar esta revisión.</p>
    {state.phase==='closed'?<button type="button" disabled={disabled} onClick={()=>{void model.current?.open();}}>Revisar producción histórica</button>:<>
      {state.busy&&<p role="status">{state.frozen?'Guardando revisión…':'Consultando el registro original…'}</p>}
      {state.error&&<div className="ros-warning-banner" role="alert"><p>{state.error}</p>
        {state.frozen&&<button type="button" disabled={state.busy||disabled} onClick={()=>{void model.current?.submit({retry:true});}}>Reintentar la misma solicitud</button>}
        {state.canReviewAgain&&<button type="button" disabled={state.busy||disabled} onClick={()=>{void model.current?.open({preserveDraft:true});}}>Volver a revisar el origen</button>}
      </div>}
      {context&&<>
        <p className="ros-reconciliation-source">Tarea #{context.source.id} · Versión {context.source.revision} · {context.source.cliente?.nombre||'Sin cliente'} · {context.source.fecha||'Sin fecha'}</p>
        <p>Registro agregado: {context.history.recorded_count??'cantidad no verificable'} · Previstos: {context.history.declared_count??'sin registrar'}. Estas cantidades no identifican videos individuales.</p>
        <details><summary>Ver contenido original</summary><dl>{Object.entries(contentLabels).map(([key,label])=>context.source.content[key]?<React.Fragment key={key}><dt>{label}</dt><dd>{context.source.content[key]}</dd></React.Fragment>:null)}</dl></details>
        {context.eligibility.status!=='ready'?<p role="status">{blocked[context.eligibility.status]} {context.eligibility.visita_id&&<a href={`/producciones?visita=${context.eligibility.visita_id}`}>Abrir visita en Producciones ↗</a>}</p>:draft&&state.phase!=='saved'&&<form onSubmit={event=>{event.preventDefault();void model.current?.submit();}}>
          <fieldset disabled={state.busy||state.frozen||disabled}>
            <label>Nombre de la visita<input maxLength={250} value={draft.titulo} onChange={e=>update({titulo:e.target.value})}/></label>
            <label>Carpeta de material<input inputMode="url" placeholder="https://drive.google.com/…" maxLength={4000} value={draft.drive_url} onChange={e=>update({drive_url:e.target.value})}/></label>
            <details><summary>Participantes y observaciones</summary>
              <div className="ros-reconciliation-people">{users.filter(u=>u.activo!==false&&Number.isSafeInteger(u.id)).map(u=><label key={u.id}><input type="checkbox" checked={draft.participante_ids.includes(u.id)} onChange={e=>update({participante_ids:e.target.checked?[...draft.participante_ids,u.id]:draft.participante_ids.filter(id=>id!==u.id)})}/>{u.nombre} · #{u.id}</label>)}</div>
              <label>Observaciones y material aún sin identificar<textarea maxLength={20000} rows={3} value={draft.observaciones} onChange={e=>update({observaciones:e.target.value})}/></label>
            </details>
            {draft.videos.map((video,index)=><div className="ros-reconciliation-video" key={video.local_id}>
              <div className="ros-block-heading"><h4>Video {index+1}</h4><button type="button" disabled={draft.videos.length===1} onClick={()=>update({videos:draft.videos.filter((_,n)=>n!==index)})}>Quitar video {index+1}</button></div>
              <label>Título del video {index+1}<input maxLength={250} required value={video.titulo} onChange={e=>videoChange(index,'titulo',e.target.value)}/></label>
              <label>Estado del video {index+1}<select value={video.estado} onChange={e=>videoChange(index,'estado',e.target.value)}><option value="planificado">Planificado</option><option value="grabado">Grabado</option><option value="pendiente">Pendiente</option><option value="repetir">Repetir</option></select></label>
              <label>Guion del video {index+1}<textarea rows={3} maxLength={20000} value={video.guion} onChange={e=>videoChange(index,'guion',e.target.value)}/></label>
              <label>Material del video {index+1}<input inputMode="url" maxLength={4000} value={video.material_url} onChange={e=>videoChange(index,'material_url',e.target.value)}/></label>
              <label>Observaciones del video {index+1}<textarea rows={2} maxLength={20000} value={video.observaciones} onChange={e=>videoChange(index,'observaciones',e.target.value)}/></label>
            </div>)}
            <button type="button" disabled={draft.videos.length>=50} onClick={()=>update({videos:[...draft.videos,emptyReconciliationVideo()]})}>Agregar otro video</button>
            <label className="ros-reconciliation-ack"><input type="checkbox" checked={draft.acknowledged} onChange={e=>update({acknowledged:e.target.checked})}/>Identifiqué manualmente cada video. Esta revisión no confirma publicaciones ni genera tareas de edición.</label>
            <button type="submit" className="ros-reconciliation-primary" disabled={!draft.acknowledged}>Guardar revisión de videos</button>
          </fieldset>
        </form>}
      </>}
      {state.phase==='saved'&&<p role="status">Revisión guardada. <a href={`/producciones?visita=${state.result.visita_id}`}>Abrir visita en Producciones ↗</a></p>}
      <button type="button" disabled={state.busy||disabled} onClick={close}>Cerrar revisión</button>
    </>}
    <DiscardChangesDialog open={discard} busy={state.busy} onKeepEditing={()=>setDiscard(false)} onDiscard={()=>{setDiscard(false);model.current?.cancel();}}/>
  </section>;
}
