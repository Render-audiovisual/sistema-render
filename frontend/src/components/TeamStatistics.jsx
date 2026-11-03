import React,{useEffect,useState} from 'react';
import {useScopedRequest} from '../shared/session/use-scoped-request.js';
import {isSessionFailure} from '../shared/session/captured-request.js';
import {handleAppLinkClick} from '../shared/navigation/location.js';
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
  <p className="ig-statistics-note">Entregas registradas, no publicaciones. Los trabajos sin registro comprobable no se suman.</p>
  {error?<div role="alert">{error} <button type="button" className="btn" onClick={()=>setRetry(v=>v+1)}>Reintentar</button></div>:data?.period!==period?<p role="status">Cargando estadísticas del equipo…</p>:
  <div className="ig-statistics-grid">{data.rows.map(person=><article className="ig-statistics-card" key={person.id}>
   <h3>{person.name}</h3><p>{person.label}</p><strong className="ig-statistics-total">{person.available?person.count:'—'}</strong><small>{person.id===10?'videos registrados · cantidades por visita':'registros únicos del mes'}</small>
   {!person.available&&<p>Sin identidad verificable.</p>}{person.unverified>0&&<p className="ig-statistics-note">{person.unverified} trabajos sin fecha de entrega comprobada. No incluidos.</p>}
   <details><summary>Ver detalle</summary>{person.records.length?<ul>{person.records.map(record=><li key={record.key}><a href={record.href} onClick={event=>handleAppLinkClick(window,event)}>{record.title}</a><small>{record.client} · {record.date.split('-').reverse().join('/')}{record.quantity!=null&&` · ${record.quantity} video${record.quantity===1?'':'s'}`}</small></li>)}</ul>:<p>{person.id===10?'Sin grabaciones registradas en este mes.':'Sin entregas registradas en este mes.'}</p>}</details>
   {person.productionPending?.length>0&&<details><summary>{person.productionPending.length} cargas por revisar · no incluidas</summary><ul>{person.productionPending.map(record=><li key={record.key}><a href={record.href} onClick={event=>handleAppLinkClick(window,event)}>{record.title}</a><small>{record.client} · {record.date?record.date.split('-').reverse().join('/'):'Sin fecha comprobable'}</small><p className="ig-statistics-note">{record.reason}</p></li>)}</ul></details>}
  </article>)}</div>}
 </section>;
}
