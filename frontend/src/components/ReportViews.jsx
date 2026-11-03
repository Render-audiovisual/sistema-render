import React from 'react';
import { handleAppLinkClick } from '../shared/navigation/location.js';

export function ReportHub({ onSelect }) {
  return <div className="ig-report-choices" aria-label="Tipos de reporte">
    {['equipo', 'clientes'].map(section => <button type="button" key={section} onClick={() => onSelect(section)}>
      <span>{section === 'equipo' ? 'Equipo' : 'Clientes'}</span><span aria-hidden="true">↗</span>
    </button>)}
  </div>;
}

export function ClientReportList({ clients, period }) {
  return <ul className="ig-account-list" aria-label="Reportes por cliente">
    {clients.map(client => <li key={client.clave}>
      <a href={`/instagram/estadisticas?${new URLSearchParams({ cliente: client.clave, periodo: period })}`}
        onClick={event => handleAppLinkClick(window, event)} aria-label={`Ver estadísticas de ${client.nombre}`}>
        <span className="ig-account-identity"><strong>{client.nombre}</strong>
          <span>{client.instagram?.length ? client.instagram.map(account => `@${account.username}`).join(' · ') : 'Sin cuenta vinculada'}</span>
        </span><span className="ig-account-arrow" aria-hidden="true">↗</span>
      </a>
    </li>)}
  </ul>;
}

export function TeamReportCards({ people }) {
  const labels = { 10: 'Videos grabados', 9: 'Videos editados', 8: 'Carruseles realizados' };
  return <div className="ig-team-cards">{people.map(person => <article className="ig-team-card" key={person.id}>
    <h3>{person.name}</h3>
    <strong className="ig-team-count">{person.available ? new Intl.NumberFormat('es-AR').format(person.count) : '—'}</strong>
    <span>{labels[person.id] || person.label}</span>
  </article>)}</div>;
}
