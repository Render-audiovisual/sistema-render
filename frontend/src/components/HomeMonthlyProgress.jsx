import React, { useId } from 'react';

const SECTOR_LABELS = {
  administracion: 'Administración', community: 'Comunicación', desarrollo: 'Desarrollo',
  diseno: 'Diseño', edicion: 'Edición', produccion: 'Producción', sin_sector: 'Sin sector',
};

// Receives only the closed monthly_progress DTO validated by the home parser.
export function HomeMonthlyProgress({ data }) {
  const titleId = useId();
  const progressId = useId();
  if (!data) return null;
  const periodLabel = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${data.period}-01T12:00:00Z`));

  return <section className="qh-section" aria-labelledby={titleId}>
    <header className="qh-section-heading"><div><h2 id={titleId}>Mi avance del mes</h2>
      <p><time dateTime={data.period}>{periodLabel}</time></p></div>
      <span className="qh-list-count">{data.completed} / {data.total} · Tareas terminadas</span>
    </header>
    <p className="qh-section-description">Por fecha de entrega; sin fecha, se usa la última actualización. No mide publicaciones.</p>
    {data.total > 0 ? <div className="qh-section-heading">
      <label htmlFor={progressId}>Tareas terminadas</label>
      <progress id={progressId} max={data.total} value={data.completed}>{data.completed} de {data.total}</progress>
    </div> : <p className="qh-empty">Sin tareas en este período.</p>}
    {data.by_sector.length > 0 && <dl className="qh-section-heading">
      {data.by_sector.map(row => <div key={row.sector}>
        <dt>{SECTOR_LABELS[row.sector]}</dt>
        <dd className="qh-list-count">{row.completed} / {row.total} · Tareas terminadas</dd>
      </div>)}
    </dl>}
    {data.production && <details className="qh-monthly-production">
      <summary>Producción por cliente · {data.production.completed} / {data.production.total} tareas terminadas</summary>
      <p className="qh-section-description">Tu trabajo de producción del mes. No cuenta videos grabados ni cuotas de contenido.</p>
      {data.production.clients.length ? <ul className="qh-client-list">
        {data.production.clients.map(row => <li key={row.client?.id ?? 'none'}>
          <span>{row.client ? `${row.client.nombre} · #${row.client.id}` : 'Sin cliente'}</span>
          <span>{row.completed} / {row.total} terminadas</span>
        </li>)}
      </ul> : <p className="qh-empty">Sin tareas de producción en este período.</p>}
      {data.production.client_count > data.production.clients.length && <p className="qh-section-description">
        Mostrando {data.production.clients.length} de {data.production.client_count} grupos de cliente. Los totales incluyen todos los grupos.
      </p>}
    </details>}
  </section>;
}

export default HomeMonthlyProgress;
