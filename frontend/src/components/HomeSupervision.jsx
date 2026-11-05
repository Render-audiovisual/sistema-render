import React from 'react';
import { personalHomeNavigate } from '../pages/personalHome.js';
import './HomeSupervision.css';

export function HomeSupervision({ data, onNavigate }) {
  const link = (href, children) => <a href={href} onClick={event => personalHomeNavigate(event, href, onNavigate)}>{children}</a>;
  return <div className="hs-panel">
    <section aria-label="Mi equipo" className="hs-people">{data.people.map(person => <article className="qh-section" key={person.id}>
      <h2>{person.name}</h2><dl><div><dt>Abiertas</dt><dd>{person.open}</dd></div><div><dt>Para revisar</dt><dd>{person.review}</dd></div><div><dt>Terminadas este mes</dt><dd>{person.done}</dd></div></dl>
      {link(`/workspace/tareas?responsible=id%3A${person.id}`, 'Ver tareas →')}
    </article>)}</section>
    <div className="hs-columns"><section className="qh-section" aria-label="Qué priorizar"><h2>Qué priorizar</h2>
      {!data.priorities.length && <p>No hay tareas abiertas en este período.</p>}
      <ol className="qh-task-list">{data.priorities.map(task => <li key={task.id}>{link(`/workspace/tareas?task=${task.id}`, <><strong>{task.titulo}</strong><small>{task.cliente || 'Sin cliente'} · {task.deadline || 'Sin fecha'}{task.deadline && task.deadline < data.today ? ' · Vencida' : ''}{task.estado === 'en_revision' ? ' · Para revisar' : ''}</small></>)}</li>)}</ol>
    </section><section className="qh-section" aria-label="Avance por cliente"><h2>Avance por cliente</h2><p>Tareas terminadas / tareas con entrega este mes.</p>
      {!data.clients.length && <p>No hay tareas con entrega en este mes.</p>}
      {data.clients.map(client => <article className="hs-client" key={client.id ?? 'none'}><strong>{client.name}</strong><span>{client.done} / {client.total}</span>
        <progress aria-label={`Avance de ${client.name}`} value={client.done} max={client.total}/>
        {client.id && link(`/workspace/tareas?client=${client.id}`, 'Ver tareas')}
        {client.statsKey && link(`/instagram/estadisticas?cliente=${encodeURIComponent(client.statsKey)}&periodo=${data.today.slice(0, 7)}`, 'Estadísticas')}
      </article>)}
    </section></div>
    <nav aria-label="Control general">{link('/workspace/tareas', 'Todo el equipo')}{link('/clientes', 'Todos los clientes')}{link('/producciones', 'Visitas y grabaciones')}{link('/instagram', 'Reportes')}</nav>
  </div>;
}
