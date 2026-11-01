import React, { useEffect, useState } from 'react';
import { getSesion } from '../utils.jsx';
import { useScopedRequest } from '../shared/session/use-scoped-request.js';
import { isSessionFailure } from '../shared/session/captured-request.js';
import { labelPeriod, variation } from './InstagramPanel.jsx';
import './InstagramPanel.css';

// Reporte mensual para enviar al cliente. Se exporta con "Guardar como PDF"
// del navegador; no incluye datos internos (responsables ni vínculos).
const number = new Intl.NumberFormat('es-AR');
const fmt = value => (value === null || value === undefined ? '—' : number.format(value));
const TIPO = { reel: 'Reel', carrusel: 'Carrusel', imagen: 'Imagen' };

export function readReportParams(search) {
  const params = new URLSearchParams(search);
  const cliente = params.get('cliente'), periodo = params.get('periodo');
  if (!/^(cliente|grupo)-[1-9]\d{0,9}$/.test(cliente || '') || !/^20\d\d-(0[1-9]|1[0-2])$/.test(periodo || '')) return null;
  return { cliente, periodo };
}

function Compare({ label, current, previous, suffix = '' }) {
  const delta = variation(current, previous);
  return <article>
    <span>{label}</span>
    <strong>{fmt(current)}{suffix}</strong>
    <small>{previous === null || previous === undefined ? 'Sin dato del mes anterior' : `Mes anterior: ${fmt(previous)}${suffix}`}
      {delta !== null && <b className={delta >= 0 ? 'is-up' : 'is-down'}> ({delta > 0 ? '+' : ''}{delta}%)</b>}</small>
  </article>;
}

export function InstagramClientReportPage({ sesion }) {
  const { view, capture } = useScopedRequest(sesion || getSesion(), 'instagram-client-report');
  const params = readReportParams(window.location.search);
  const [state, setState] = useState({ loading: true, error: '', data: null });
  useEffect(() => {
    if (view.role !== 'admin' || !params) return undefined;
    const controller = new AbortController(), guard = capture();
    guard.request(`/api/instagram/clientes/${encodeURIComponent(params.cliente)}/reporte?periodo=${encodeURIComponent(params.periodo)}`,
      { cache: 'no-store', signal: controller.signal })
      .then(data => { if (guard.current()) setState({ loading: false, error: '', data }); })
      .catch(reason => { if (guard.current() && !controller.signal.aborted && !isSessionFailure(reason)) setState({ loading: false, error: reason.message, data: null }); });
    return () => controller.abort();
  }, [capture, view.role, params?.cliente, params?.periodo]);

  if (view.role !== 'admin') return <main className="page-shell ig-panel"><div className="salary-state is-error">Disponible solo para Líder.</div></main>;
  if (!params) return <main className="page-shell ig-panel"><div className="salary-state is-error">Faltan el cliente o el mes del reporte.</div></main>;
  const { data } = state;
  return <main className="page-shell ig-panel">
    <div className="ig-report-actions">
      <button type="button" className="btn" onClick={() => window.print()} disabled={!data}>Imprimir / Guardar PDF</button>
      <span className="ig-help">En el cuadro de impresión elegí “Guardar como PDF”.</span>
    </div>
    {state.loading && <div className="salary-state">Armando el reporte…</div>}
    {state.error && <div className="salary-state is-error" role="alert">{state.error}</div>}
    {data && <article className="ig-report">
      <header className="ig-report-head">
        <div>
          <p className="ig-report-brand">RENDER · Reporte de Instagram</p>
          <h1>{data.cliente}</h1>
          <p>{labelPeriod(data.periodo)}{data.cuentas.length ? ` · ${data.cuentas.map(u => `@${u}`).join(' · ')}` : ''}</p>
        </div>
      </header>

      <section className="ig-metrics ig-report-metrics" aria-label="Resumen del mes">
        <Compare label="Publicaciones" current={data.actual.piezas} previous={data.anterior.piezas} />
        <Compare label="Cuentas alcanzadas (suma por pieza)" current={data.actual.alcance} previous={data.anterior.alcance} />
        <Compare label="Reproducciones" current={data.actual.vistas} previous={data.anterior.vistas} />
        <Compare label="Interacciones" current={data.actual.interacciones} previous={data.anterior.interacciones} />
      </section>

      <section className="ig-report-row">
        <div className="ig-card">
          <h2>Comunidad</h2>
          <p className="ig-report-big">{fmt(data.seguidores)} <small>seguidores</small></p>
          {data.crecimiento_seguidores !== null && <p>{data.crecimiento_seguidores >= 0 ? '+' : ''}{fmt(data.crecimiento_seguidores)} en el mes</p>}
        </div>
        <div className="ig-card">
          <h2>Plan del mes</h2>
          {data.cupo ? <p className="ig-report-big">{data.actual.reels + data.actual.carruseles}/{data.cupo.reels + data.cupo.carruseles} <small>piezas</small></p> : <p>—</p>}
          {data.cupo && <p>{data.actual.reels}/{data.cupo.reels} reels · {data.actual.carruseles}/{data.cupo.carruseles} carruseles</p>}
        </div>
        <div className="ig-card">
          <h2>Por formato</h2>
          <p>Reels: {data.formatos.reel.piezas} · {fmt(data.formatos.reel.alcance_promedio)} de alcance promedio</p>
          <p>Carruseles: {data.formatos.carrusel.piezas} · {fmt(data.formatos.carrusel.alcance_promedio)} de alcance promedio</p>
          <p className="ig-help">Tasa de interacción: {data.actual.tasa_interaccion === null ? '—' : `${number.format(data.actual.tasa_interaccion)}%`}</p>
        </div>
      </section>

      {data.destacadas.length > 0 && <section className="ig-card">
        <h2>Publicaciones destacadas</h2>
        <ol className="ig-report-top">
          {data.destacadas.map(p => <li key={p.ig_media_id}>
            <div><strong>{TIPO[p.tipo]} · {new Date(p.publicado_at).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Cordoba' })}</strong>
              {p.caption && <p>{p.caption}</p>}<a href={p.permalink}>{p.permalink}</a></div>
            <dl><div><dt>Alcance</dt><dd>{fmt(p.metricas.alcance)}</dd></div><div><dt>Reproducciones</dt><dd>{fmt(p.metricas.vistas)}</dd></div>
              <div><dt>Interacciones</dt><dd>{fmt(p.metricas.interacciones)}</dd></div><div><dt>Guardados</dt><dd>{fmt(p.metricas.guardados)}</dd></div></dl>
          </li>)}
        </ol>
      </section>}

      <section className="ig-card">
        <h2>Todas las publicaciones del mes</h2>
        <table className="ig-report-table">
          <thead><tr><th>Fecha</th><th>Formato</th><th>Alcance</th><th>Reproducciones</th><th>Likes</th><th>Comentarios</th><th>Guardados</th><th>Compartidos</th></tr></thead>
          <tbody>{data.piezas.map(p => <tr key={p.ig_media_id}>
            <td>{new Date(p.publicado_at).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Cordoba', day: '2-digit', month: '2-digit' })}</td>
            <td>{TIPO[p.tipo]}</td><td>{fmt(p.metricas.alcance)}</td><td>{fmt(p.metricas.vistas)}</td><td>{fmt(p.metricas.likes)}</td>
            <td>{fmt(p.metricas.comentarios)}</td><td>{fmt(p.metricas.guardados)}</td><td>{fmt(p.metricas.compartidos)}</td>
          </tr>)}</tbody>
        </table>
        <p className="ig-help">Datos de Instagram (Meta) a la fecha de emisión: {new Date().toLocaleDateString('es-AR')}.</p>
      </section>
    </article>}
  </main>;
}
