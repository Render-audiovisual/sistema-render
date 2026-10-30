import React from 'react';
import {buildTeamWorkCards} from '../shared/reports/team-work-cards.js';
import './TeamWorkCards.css';
const stateLabels={en_revision:'Para revisar',aprobada:'Aprobada',finalizada:'Finalizada',publicada:'Publicada',grabado:'Grabado'};
export function TeamWorkCards({data,range}){
 const cards=buildTeamWorkCards(data,range);
 return <section className="team-work-cards" aria-label="Trabajo realizado por integrante">
  <div className="team-work-grid">{cards.map(card=><article key={card.id}>
   <header><span className="team-work-avatar" aria-hidden="true">{card.name.split(/\s+/).slice(0,2).map(word=>word[0]).join('')}</span><h2>{card.name}</h2></header>
   <div className="team-work-count"><strong>{card.count===0&&card.unattributed?'—':card.count}</strong><span>{card.label}</span></div>
   {card.unattributed>0&&<p className="team-work-status">El historial tiene publicaciones sin usuario registrado. No se atribuyen automáticamente.</p>}
   {['diseno','edicion'].includes(card.role)&&<p className="team-work-status">{card.records.filter(row=>row.state==='en_revision').length} para revisar · {card.records.filter(row=>['finalizada','publicada'].includes(row.state)).length} finalizadas · {card.pending} pendientes</p>}
   <details><summary>Ver trabajo</summary>{card.records.length?<ul>{card.records.map(row=><li key={row.key}><div>{row.href?<a href={row.href}>{row.title}</a>:<strong>{row.title}</strong>}<small>{row.client}{row.date?` · ${row.date.split('-').reverse().join('/')}`:''}</small><small>{stateLabels[row.state]||row.state}</small></div><b>{row.amount}</b></li>)}</ul>:<p className="team-work-empty">Sin registros para este período.</p>}</details>
  </article>)}</div>
  {!cards.length&&<p>No hay integrantes disponibles para este reporte.</p>}
  <details className="team-work-method"><summary>Cómo se cuenta</summary><p>Diseño y edición: tareas enviadas a revisión, aprobadas o finalizadas, por fecha de entrega del período; sin entrega se usa finalización o actualización. Cada tarea cuenta una vez por integrante, incluidos colaboradores. Grabaciones: videos individuales y cantidades históricas asignados por ID; no se atribuyen por participar en una visita. Publicaciones: confirmaciones registradas por el usuario y su fecha real; una tarea terminada no cuenta como publicación. La ausencia de registros no demuestra ausencia de trabajo.</p></details>
 </section>;
}
