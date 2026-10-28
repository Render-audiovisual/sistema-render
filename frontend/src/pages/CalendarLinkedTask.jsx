import React,{lazy,Suspense,useEffect,useState} from 'react';
import {Modal} from '../components/Modal.jsx';
import {useScopedRequest} from '../shared/session/use-scoped-request.js';
import {isSessionFailure} from '../shared/session/captured-request.js';
const TaskWindow=lazy(()=>import('./WorkspaceReadOnly.jsx').then(module=>({default:module.WorkspaceReadOnlyPage})));

export function CalendarLinkedTask({event,sesion,onClose}){
  const {capture}=useScopedRequest(sesion,`calendar-piece-${event.source_id}`);
  const [result,setResult]=useState({status:'loading',tasks:[],error:''});
  const [taskId,setTaskId]=useState(null),[retry,setRetry]=useState(0);
  useEffect(()=>{
    const guard=capture(),controller=new AbortController();let active=true;
    setResult({status:'loading',tasks:[],error:''});
    void guard.request(`/api/publicaciones/${event.source_id}/tareas`,{signal:controller.signal,cache:'no-store'}).then(tasks=>{
      if(!active||!guard.current())return;
      if(!Array.isArray(tasks)||tasks.some(task=>!Number.isSafeInteger(task.id)||task.id<1||typeof task.titulo!=='string'))throw Error('Respuesta de tareas inválida.');
      setResult({status:'ready',tasks,error:''});if(tasks.length===1)setTaskId(tasks[0].id);
    }).catch(reason=>{if(active&&guard.current()&&!isSessionFailure(reason))setResult({status:'error',tasks:[],error:'No se pudieron consultar las tareas vinculadas.'});});
    return()=>{active=false;controller.abort();};
  },[event.source_id,capture,retry]);
  if(taskId!==null)return <Suspense fallback={<Modal native title="Abriendo tarea…" onClose={onClose}><p role="status">Cargando…</p></Modal>}><TaskWindow sesion={sesion} detailOnlyTaskId={taskId} onSelectDetailTask={setTaskId} onCloseDetail={onClose}/></Suspense>;
  return <Modal native title="Tareas de la publicación" onClose={onClose}>
    <div className="principal-calendar-linked-body">
    <p>{event.cliente_nombre}</p>
    {result.status==='loading'?<p role="status">Buscando la tarea vinculada…</p>:result.status==='error'?<div role="alert"><p>{result.error}</p><button type="button" onClick={()=>setRetry(value=>value+1)}>Reintentar</button></div>:result.tasks.length===0?<p>Esta publicación no tiene tareas activas disponibles para tu usuario. No se creó ninguna tarea nueva.</p>:<div className="principal-calendar-linked-tasks">{result.tasks.map(task=><button type="button" key={task.id} onClick={()=>setTaskId(task.id)}>{task.titulo}</button>)}</div>}
    <button type="button" onClick={onClose}>Cerrar</button>
    </div>
  </Modal>;
}
