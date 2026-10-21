import React,{useLayoutEffect,useRef,useState} from 'react';
import {apiRequest} from '../features/render-os/services/render-os-api.js';
import {getSesion} from '../utils.jsx';
import {useSessionView} from '../shared/session/use-session-view.js';
import {useNavigationGuard} from '../shared/navigation/useNavigationGuard.js';
import {DiscardChangesDialog} from './DiscardChangesDialog.jsx';
import {createProductionHistoryBatchModel,productionHistoryBatchContract,newProductionHistoryVideo,historyVideoKey} from './productionHistoryBatchReview.js';
import './ProductionHistoryBatchReview.css';

export function ProductionHistoryBatchReview(props){
  const view=useSessionView(props.sesion);
  if(view.role!=='admin'||!view.binding||view.active===false)return null;
  return <BatchReview key={`${view.key}:${props.sourceId}`} {...props} sesion={view.session}/>;
}
function BatchReview({sourceId,sesion,users=[],contract=productionHistoryBatchContract,disabled=false,onDraftStateChange,onSaved,request=apiRequest}){
  const [state,setState]=useState({phase:'closed',busy:false,dirty:false}),[discard,setDiscard]=useState(false);
  const model=useRef(null),callbacks=useRef({onDraftStateChange,onSaved}),disabledRef=useRef(disabled);
  callbacks.current={onDraftStateChange,onSaved};disabledRef.current=disabled;
  useLayoutEffect(()=>{
    const instance=createProductionHistoryBatchModel({sourceId,sesion,contract,request,readSession:getSesion,
      onChange:next=>{setState(next);if(next.phase==='saved'){try{Promise.resolve(callbacks.current.onSaved?.(next.result,instance.scope)).catch(()=>{if(instance.current())setState(current=>({...current,error:'Revisión guardada; no pudimos actualizar la vista. No repitas el envío.'}));});}catch{if(instance.current())setState(current=>({...current,error:'Revisión guardada; no pudimos actualizar la vista. No repitas el envío.'}));}}},
      onDraftStateChange:next=>callbacks.current.onDraftStateChange?.(next),canAct:()=>!disabledRef.current});
    model.current=instance;return()=>{instance.dispose();if(model.current===instance)model.current=null;};
  },[sourceId,sesion,contract,request]);
  useNavigationGuard(()=>model.current?.current()?{dirty:model.current.snapshot.dirty,busy:model.current.snapshot.busy}:{dirty:false,busy:false});
  const context=state.context,draft=state.draft,locked=state.busy||state.frozen||disabled;
  const update=next=>model.current?.update(next);
  const changeVideo=(key,changes)=>{
    const previous=draft.videos.find(video=>historyVideoKey(video)===key),reset=previous?.disposition==='adopt_original'&&changes.new_video?.estado!=='grabado';
    update({...draft,acknowledged:false,videos:draft.videos.map(video=>historyVideoKey(video)===key?{...video,...changes,...(reset?{disposition:'',task_id:null}:{}),acknowledged:false}:video),children:reset?draft.children.map(child=>child.video_key===key?{...child,disposition:'',video_key:null}:child):draft.children});
  };
  const removeVideo=key=>update({...draft,acknowledged:false,videos:draft.videos.filter(video=>historyVideoKey(video)!==key),children:draft.children.map(child=>child.video_key===key?{...child,disposition:'',video_key:null}:child)});
  const chooseDisposition=(key,value)=>{
    const taskId=value.startsWith('task:')?Number(value.slice(5)):null;
    const disposition=taskId?'adopt_original':value;
    const previous=draft.videos.find(video=>historyVideoKey(video)===key)?.task_id;
    update({...draft,acknowledged:false,videos:draft.videos.map(video=>historyVideoKey(video)===key?{...video,disposition,task_id:taskId,acknowledged:false}:video),
      children:draft.children.map(child=>child.task_id===taskId?{...child,disposition:'mapped',video_key:key}:child.task_id===previous?{...child,disposition:'',video_key:null}:child)});
  };
  const close=()=>{if(state.busy||disabled)return;if(state.dirty)setDiscard(true);else model.current?.close();};
  if(state.phase==='denied')return <section className="ros-work-block production-history-batch-review" role="alert"><h3>Revisión no disponible</h3><p>No tenés acceso a esta revisión. Se retiró el expediente de esta vista.</p></section>;
  return <section className="ros-work-block production-history-batch-review" aria-label="Correspondencia de producción histórica">
    <h3>Revisar correspondencias históricas</h3>
    <p>Identificá cada video y su tarea original. Las entregas y correcciones permanecen en su tarea. No se dividen ni se copian aprobaciones o publicaciones.</p>
    {state.phase==='closed'?<button type="button" disabled={disabled||!contract} onClick={()=>void model.current?.open()}>Revisar tareas y videos</button>:<>
      {state.busy&&<p role="status">{state.frozen?'Guardando revisión…':'Consultando expediente…'}</p>}
      {state.error&&<div className="ros-warning-banner" role="alert"><p>{state.error}</p>
        {state.frozen&&!state.canReviewAgain&&<button type="button" disabled={state.busy||disabled} onClick={()=>void model.current?.submit({verify:true})}>Verificar la misma solicitud</button>}
        {state.canReviewAgain&&<button type="button" disabled={state.busy||disabled} onClick={()=>void model.current?.open({preserveDraft:true})}>Volver a revisar el expediente</button>}
      </div>}
      {context&&draft&&state.phase==='ready'&&<form onSubmit={event=>{event.preventDefault();void model.current?.submit();}}>
        <p>Origen #{context.source.id} · Versión {context.source.revision} · {context.source.cliente.nombre} · {context.source.fecha}</p>
        {context.visit&&<p>Visita existente: {context.visit.titulo} · Versión {context.visit.revision}. Los videos no seleccionados y los datos de la visita se conservan.</p>}
        <details><summary>Consultar contenido original</summary><dl>{Object.entries({instructions:'Indicaciones',script:'Guion',material:'Material original',recorded_material:'Material registrado',feedback:'Feedback',schedule:'Horario'}).map(([key,label])=>context.source.content[key]?<React.Fragment key={key}><dt>{label}</dt><dd>{context.source.content[key]}</dd></React.Fragment>:null)}</dl></details>
        <fieldset disabled={locked}>
          {!context.visit&&<details open><summary>Datos de la nueva visita</summary>
            <label>Nombre de la visita<input required maxLength={250} value={draft.visit_fields.titulo} onChange={event=>update({...draft,visit_fields:{...draft.visit_fields,titulo:event.target.value},acknowledged:false})}/></label>
            <label>Carpeta de material<input maxLength={4000} value={draft.visit_fields.drive_url} onChange={event=>update({...draft,visit_fields:{...draft.visit_fields,drive_url:event.target.value},acknowledged:false})}/></label>
            <div className="production-history-people">{users.filter(user=>user.activo!==false&&Number.isSafeInteger(user.id)&&user.id>0).map(user=><label key={user.id}><input type="checkbox" checked={draft.visit_fields.participante_ids.includes(user.id)} onChange={event=>update({...draft,acknowledged:false,visit_fields:{...draft.visit_fields,participante_ids:event.target.checked?[...draft.visit_fields.participante_ids,user.id]:draft.visit_fields.participante_ids.filter(id=>id!==user.id)}})}/>{user.nombre} · #{user.id}</label>)}</div>
            <label>Observaciones<textarea rows={2} maxLength={20000} value={draft.visit_fields.observaciones} onChange={event=>update({...draft,visit_fields:{...draft.visit_fields,observaciones:event.target.value},acknowledged:false})}/></label>
          </details>}
          {context.visit&&<section><h4>Seleccionar videos existentes</h4><p>Elegí sólo los videos que vas a revisar. Nada se selecciona por cantidad o título.</p>
            {context.visit.videos.map(video=><label className="production-history-check" key={video.id}><input type="checkbox" checked={draft.videos.some(selected=>selected.existing_video_id===video.id)} onChange={event=>event.target.checked?update({...draft,acknowledged:false,videos:[...draft.videos,{existing_video_id:video.id,disposition:'',task_id:null,acknowledged:false}]}):removeVideo(video.id)}/><span>{video.titulo} · {video.estado} · Video #{video.id}</span></label>)}
          </section>}
          <button type="button" disabled={(context.visit?.videos.length??0)+draft.videos.filter(video=>!video.existing_video_id).length>=50} onClick={()=>update({...draft,acknowledged:false,videos:[...draft.videos,newProductionHistoryVideo()]})}>Identificar un video nuevo</button>
          {draft.videos.map((video,index)=>{
            const key=historyVideoKey(video),existing=context.visit?.videos.find(item=>item.id===video.existing_video_id),fields=existing??video.new_video;
            if(video.existing_video_id&&!existing)return <article className="production-history-card" key={key}><h4>Video #{video.existing_video_id} no disponible en la revisión actual</h4><p>Conservamos tu selección para que la revises. No se reemplazó por otro video.</p><button type="button" onClick={()=>removeVideo(key)}>Quitar selección no disponible</button></article>;
            const value=video.disposition==='adopt_original'?`task:${video.task_id}`:video.disposition;
            return <article className="production-history-card" key={key}><header><h4>{existing?existing.titulo:`Video nuevo ${index+1}`}</h4><button type="button" onClick={()=>removeVideo(key)}>Quitar de esta revisión</button></header>
              {existing?<p>Video #{existing.id} · {existing.estado}{existing.tarea_edicion_id&&` · Edición #${existing.tarea_edicion_id}`}. No se editará su contenido.</p>:<>
                <label>Título<input required maxLength={250} value={fields.titulo} onChange={event=>changeVideo(key,{new_video:{...fields,titulo:event.target.value}})}/></label>
                <label>Estado<select value={fields.estado} onChange={event=>changeVideo(key,{new_video:{...fields,estado:event.target.value}})}><option value="planificado">Planificado</option><option value="grabado">Grabado</option><option value="pendiente">Pendiente</option><option value="repetir">Repetir</option></select></label>
                <label>Guion<textarea rows={3} maxLength={20000} value={fields.guion} onChange={event=>changeVideo(key,{new_video:{...fields,guion:event.target.value}})}/></label>
                <label>Material<input maxLength={4000} value={fields.material_url} onChange={event=>changeVideo(key,{new_video:{...fields,material_url:event.target.value}})}/></label>
                <label>Observaciones<textarea rows={2} maxLength={20000} value={fields.observaciones} onChange={event=>changeVideo(key,{new_video:{...fields,observaciones:event.target.value}})}/></label>
              </>}
              <label>Correspondencia de este video<select required value={value} onChange={event=>chooseDisposition(key,event.target.value)}>
                <option value="">Elegir explícitamente</option><option value="manual_independent">Edición independiente, sin heredar evidencia histórica</option>
                {video.disposition==='adopt_original'&&!context.legacy_tasks.some(task=>task.id===video.task_id&&task.eligibility==='adoptable'&&(!task.mapped_video_id||task.mapped_video_id===key))&&<option disabled value={value}>Tarea #{video.task_id} no disponible para esta correspondencia; revisá la selección</option>}
                {context.legacy_tasks.filter(task=>task.eligibility==='adoptable'&&fields.estado==='grabado'&&(!task.mapped_video_id||task.mapped_video_id===key)&&!draft.videos.some(other=>historyVideoKey(other)!==key&&other.task_id===task.id)).map(task=><option key={task.id} value={`task:${task.id}`}>{task.titulo||'Sin título'} · Tarea #{task.id}</option>)}
              </select></label>
              {video.disposition&&<label className="production-history-check"><input type="checkbox" checked={video.acknowledged} onChange={event=>update({...draft,acknowledged:false,videos:draft.videos.map(item=>historyVideoKey(item)===key?{...item,acknowledged:event.target.checked}:item)})}/><span>{video.disposition==='adopt_original'?'Confirmo que esta tarea, sus entregas y correcciones corresponden únicamente a este video. No se divide una tarea que agrupa varios videos.':'Confirmo que este video es independiente: ninguna entrega, corrección, aprobación ni publicación histórica constituye evidencia para este video.'}</span></label>}
            </article>;
          })}
          <section><h4>Disposición de cada tarea original</h4><p>Conservar sin nueva correspondencia no elimina vínculos existentes ni modifica la tarea.</p>
            {context.legacy_tasks.map(task=>{const child=draft.children.find(item=>item.task_id===task.id);return <article className="production-history-card" key={task.id}>
              <h4>{task.eligibility==='adoptable'?<a href={`/workspace/tareas?task=${task.id}`}>{task.titulo||'Sin título'} · #{task.id}</a>:<span>{task.titulo||'Sin título'} · #{task.id}</span>}</h4>
              <p>Versión {task.revision} · {task.estado==='publicada'?'Trabajo finalizado (estado histórico)':task.estado} · {task.eligibility==='adoptable'?'Admite revisión de correspondencia':'Conservar para revisión específica'}{task.mapped_video_id&&` · Vínculo existente: video #${task.mapped_video_id}`}</p>
              <label>Decisión para esta tarea<select required value={child.disposition} onChange={event=>{
                const disposition=event.target.value;
                update({...draft,acknowledged:false,children:draft.children.map(item=>item.task_id===task.id?{...item,disposition,video_key:disposition==='mapped'?item.video_key:null}:item),videos:draft.videos.map(item=>item.task_id===task.id&&disposition!=='mapped'?{...item,disposition:'',task_id:null,acknowledged:false}:item)});
              }}><option value="">Elegir una decisión</option>{child.disposition==='mapped'&&<option value="mapped">Correspondencia elegida explícitamente en el video</option>}<option value="preserve_unmapped">Conservar sin nueva correspondencia</option></select></label>
              {child.video_key&&<p>Seleccionada para: {draft.videos.find(video=>historyVideoKey(video)===child.video_key)?.new_video?.titulo||context.visit?.videos.find(video=>video.id===child.video_key)?.titulo||child.video_key}</p>}
              <label>Motivo de esta decisión<textarea required maxLength={1000} rows={2} value={child.reason} onChange={event=>update({...draft,acknowledged:false,children:draft.children.map(item=>item.task_id===task.id?{...item,reason:event.target.value}:item)})}/></label>
            </article>})}
            {!context.legacy_tasks.length&&<p>No hay tareas históricas en este expediente.</p>}
          </section>
          <label className="production-history-check"><input type="checkbox" checked={draft.acknowledged} onChange={event=>update({...draft,acknowledged:event.target.checked})}/><span>Revisé manualmente todas las correspondencias y decisiones. Se conserva el historial original; esta revisión no crea tareas de edición ni aprueba o publica contenido.</span></label>
          <button type="submit" disabled={!draft.acknowledged||draft.videos.length===0}>Guardar revisión de correspondencias</button>
        </fieldset>
      </form>}
      {state.phase==='saved'&&<p role="status">Revisión guardada. <a href={`/producciones?visita=${state.result.visita_id}`}>Abrir la visita actual en Producciones ↗</a></p>}
      <button type="button" disabled={state.busy||disabled} onClick={close}>Cerrar revisión</button>
    </>}
    <DiscardChangesDialog open={discard} busy={state.busy} onKeepEditing={()=>setDiscard(false)} onDiscard={()=>{setDiscard(false);model.current?.close();}}/>
  </section>;
}
