import React, { useEffect, useRef, useState } from 'react';
import { getSesion } from '../utils.jsx';
import { getHoyLocalISO } from '../shared/date/date-utils.js';
import { useSessionView } from '../shared/session/use-session-view.js';
import { useScopedRequest } from '../shared/session/use-scoped-request.js';
import { navigateWithinApp } from '../shared/navigation/location.js';
import { EditorialPieceDetails } from '../components/EditorialPieceDetails.jsx';
import { canReadEditorialControl } from '../components/homeEditorialControl.js';
import { clientOperationLocationUrl, readClientOperationLocation, createClientOperationLoader, validClientOperationPeriod } from './clientOperation.js';
import { goalClientHref } from './clientGoalLocation.js';
import './ClientOperation.css';

const states = {pendiente:'Pendiente',en_progreso:'En progreso',en_revision:'En revisión',aprobada:'Aprobada',finalizada:'Trabajo finalizado',publicada:'Trabajo finalizado (estado histórico)'};
const evidence = {confirmada_manualmente:'Publicación confirmada manualmente',historica_sin_confirmacion:'Publicación histórica sin confirmación',no_publicada:'Sin publicación confirmada'};
function HubLink({href,children,...props}) {
  return <a href={href} {...props} onClick={event=>{
    if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey) return;
    event.preventDefault(); navigateWithinApp(window,href);
  }}>{children}</a>;
}
function Preview({section,children}) {
  return <>{section.items.length ? <ul className="co-items">{children}</ul> : <p className="co-muted">No hay registros en este alcance.</p>}
    {section.has_more && <p className="co-muted">Se muestran {section.items.length} de {section.total}. Abrí el módulo para consultar el resto.</p>}</>;
}
function Block({title,subtitle,total,href,children}) {
  return <section className="co-block"><header><div><h2>{title} <span>{total}</span></h2><p>{subtitle}</p></div>{href && <HubLink className="co-action" href={href}>Abrir {title.toLowerCase()}</HubLink>}</header>{children}</section>;
}

export function ClientOperationPage({sesion}) {
  const view=useSessionView(sesion||getSesion());
  return <ClientOperationLocation key={view.key} session={view.session}/>;
}
function ClientOperationLocation({session}) {
  const [location,setLocation]=useState(()=>({search:window.location.search,epoch:0}));
  useEffect(()=>{
    const pop=()=>setLocation(previous=>({search:window.location.search,epoch:previous.epoch+1}));
    window.addEventListener('popstate',pop); return ()=>window.removeEventListener('popstate',pop);
  },[]);
  let selection, error;
  try {selection=readClientOperationLocation(location.search,getHoyLocalISO());} catch(failure) {error=failure.message;}
  if(error) return <main className="client-operation"><h1>Operación del cliente</h1><p role="alert">{error}</p><HubLink href="/clientes">Volver a clientes</HubLink></main>;
  return <ClientOperationRead key={`${location.epoch}:${selection.clientId}:${selection.period}`} session={session} selection={selection}/>;
}
function ClientOperationRead({session,selection}) {
  const {view,capture}=useScopedRequest(session,`${selection.clientId}:${selection.period}`);
  const [state,setState]=useState({status:'loading',data:null,error:''});
  const loader=useRef(null);
  const allowed=canReadEditorialControl(view.session);
  useEffect(()=>{
    if(!allowed) return undefined;
    // Canonicalize the actual visible period before the first request.
    if(selection.needsPeriod) window.history.replaceState(window.history.state,'',clientOperationLocationUrl(window.location.href,selection));
    const current=createClientOperationLoader({capture,onChange:setState}); loader.current=current;
    void current.load(selection);
    return ()=>{current.dispose();if(loader.current===current)loader.current=null;};
  },[allowed,capture,selection]);
  if(!allowed||state.status==='denied') return <main className="client-operation"><h1>Operación del cliente</h1><p role="alert">Ya no tenés acceso a esta operación.</p></main>;
  const data=state.data;
  return <main className="client-operation">
    <header className="co-header"><div><HubLink href={goalClientHref(selection.clientId,selection.period)}>Clientes</HubLink><p className="co-eyebrow">Operación del cliente · #{selection.clientId}</p><h1>{data?.cliente.nombre||'Operación del cliente'}</h1>{data?.cliente.activo===false && <p>Cliente inactivo · se conserva su historial operativo.</p>}</div>
      <label>Mes de producción y contenido<input type="month" value={selection.period} onChange={event=>{
        if(!validClientOperationPeriod(event.target.value)) return;
        navigateWithinApp(window,clientOperationLocationUrl(window.location.href,{clientId:selection.clientId,period:event.target.value}));
      }}/></label>
    </header>
    {state.status==='loading' && <p role="status">Consultando la operación de {selection.period}…</p>}
    {state.error && <section role="alert"><p>{state.error}</p><button className="co-action" type="button" onClick={()=>void loader.current?.load(selection)}>Reintentar consulta</button></section>}
    {data && <>
      <p className="co-muted">Producción, contenido y objetivos: {data.periodo}. Tareas y proyectos: todos los períodos. Los totales incluyen más registros que las muestras de esta página.</p>
      <div className="co-grid">
        <Block title="Tareas" subtitle="Trabajo compartido · todos los períodos · sin archivo ni papelera" total={data.tareas.total} href={`/workspace/tareas?client=${data.cliente.id}&view=list`}>
          <dl className="co-counts">{Object.entries(data.tareas.counts).map(([key,value])=><div key={key}><dt>{states[key]||'Otros estados'}</dt><dd>{value}</dd></div>)}</dl>
          <Preview section={data.tareas}>{data.tareas.items.map(item=><li key={item.id}><HubLink href={item.href}>{item.titulo||`Tarea #${item.id}`}</HubLink><small>#{item.id} · {states[item.estado]||item.estado}</small></li>)}</Preview>
        </Block>
        <Block title="Proyectos" subtitle="Compartidos, no archivados · todos los períodos" total={data.proyectos.total} href={`/proyectos?cliente=${data.cliente.id}`}>
          <Preview section={data.proyectos}>{data.proyectos.items.map(item=><li key={item.id}><HubLink href={item.href}>{item.titulo||'Proyecto sin título'}</HubLink><small>{item.estado} · {item.responsable.nombre} · {item.counts.finalizadas}/{item.counts.tareas} tareas finalizadas</small></li>)}</Preview>
        </Block>
        <Block title="Producciones" subtitle={`Visitas de ${data.periodo} · registros, no publicaciones`} total={data.producciones.total} href={`/producciones?cliente=${data.cliente.id}&mes=${data.periodo}`}>
          <dl className="co-counts"><div><dt>Videos registrados</dt><dd>{data.producciones.counts.videos_registrados}</dd></div><div><dt>Registros de fotos</dt><dd>{data.producciones.counts.registros_fotos}</dd></div><div><dt>Banco pendiente · todos los períodos</dt><dd>{data.producciones.counts.pendientes_banco_todos_los_periodos}</dd></div></dl>
          <Preview section={data.producciones}>{data.producciones.items.map(item=><li key={item.id}><HubLink href={item.href}>{item.titulo||'Visita sin título'}</HubLink><small>{item.fecha} · {item.videos_registrados} videos · {item.registros_fotos} registros de fotos</small></li>)}</Preview>
        </Block>
        <Block title="Contenido" subtitle={`Piezas programadas para ${data.periodo} · la evidencia de publicación es independiente del trabajo`} total={data.editorial.total}>
          <dl className="co-counts">{Object.entries(data.editorial.counts).map(([key,value])=><div key={key}><dt>{evidence[key]}</dt><dd>{value}</dd></div>)}</dl>
          <nav className="co-links" aria-label="Planillas del cliente"><HubLink className="co-action" href={`/planificacion-historias?vista=planilla&cliente=${data.cliente.id}&filtro=${data.cliente.id}&mes=${data.periodo}`}>Planilla de historias</HubLink><HubLink className="co-action" href={`/planificacion-publicaciones?tab=planilla&cliente=${data.cliente.id}&mes=${data.periodo}`}>Planilla de publicaciones</HubLink></nav>
          <Preview section={data.editorial}>{data.editorial.items.map(item=><li key={`${item.domain}:${item.id}`}><strong>{item.domain==='historia'?'Historia':'Publicación'} #{item.id} · {item.titulo||'Sin título'}</strong><small>{item.fecha_programada} · {evidence[item.publication_classification]}</small><EditorialPieceDetails key={`${item.domain}:${item.id}`} piece={item} sesion={view.session}/></li>)}</Preview>
        </Block>
        <Block title="Objetivos" subtitle={`Trabajo mensual de ${data.periodo} · cada acuerdo compartido se muestra por separado`} total={data.objetivos.total} href={goalClientHref(data.cliente.id,data.periodo)}>
          <p className="co-muted">Completar el trabajo no confirma una publicación.</p>
          <Preview section={data.objetivos}>{data.objetivos.items.map(item=><li key={item.clave}><strong>{item.nombre}</strong><small>Cuentas: {item.cuentas.map(account=>`${account.nombre} (#${account.id})`).join(' · ')}</small><p>{item.preparado?'Objetivo preparado':'Objetivo por preparar'}{item.cuota_desactualizada?' · cuota pendiente de revisión':''}</p>{item.preparado ? <dl className="co-counts"><div><dt>Reels · trabajo completado</dt><dd>{item.progress.reels.completed}/{item.progress.reels.total}</dd></div><div><dt>Carruseles · trabajo completado</dt><dd>{item.progress.carruseles.completed}/{item.progress.carruseles.total}</dd></div><div><dt>Contenido adicional · fuera de cuota</dt><dd>{item.extras.completed}/{item.extras.total} completado</dd></div></dl> : <><p>Todavía no se preparó el objetivo de este mes.</p>{(item.quota.reels > 0 || item.quota.carruseles > 0) && <p className="co-muted">Cuota prevista: {item.quota.reels} reels · {item.quota.carruseles} carruseles.</p>}</>}</li>)}</Preview>
        </Block>
      </div>
      {view.role==='admin' && <footer><HubLink className="co-action" href={`/clientes?gestion=1&cliente=${data.cliente.id}&periodo=${data.periodo}`}>Administrar cliente</HubLink></footer>}
    </>}
  </main>;
}
