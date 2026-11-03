import React,{useEffect,useState} from 'react';
import {useScopedRequest} from '../shared/session/use-scoped-request.js';
import {isSessionFailure} from '../shared/session/captured-request.js';
import {TeamReportCards} from './ReportViews.jsx';
export function TeamStatistics({sesion,period}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const {capture}=useScopedRequest(sesion,`team-statistics:${period}:${retry}`);
 useEffect(()=>{
  const controller=new AbortController(),guard=capture();setData(null);setError('');
  guard.request(`/api/instagram/equipo?periodo=${encodeURIComponent(period)}`,{cache:'no-store',signal:controller.signal}).then(value=>{
   if(guard.current()&&!controller.signal.aborted){if(value?.period!==period||!Array.isArray(value.rows))throw new Error('Respuesta inválida.');setData(value);}
  }).catch(reason=>{if(guard.current()&&!controller.signal.aborted&&!isSessionFailure(reason))setError('No se pudo cargar el reporte del equipo.');});
  return()=>controller.abort();
 },[capture,period]);
 return <section aria-label="Estadísticas del equipo"><h2>Equipo</h2>
  {error?<div role="alert">{error} <button type="button" className="btn" onClick={()=>setRetry(v=>v+1)}>Reintentar</button></div>:data?.period!==period?<p role="status">Cargando estadísticas del equipo…</p>:
  <TeamReportCards people={data.rows}/>}
 </section>;
}
