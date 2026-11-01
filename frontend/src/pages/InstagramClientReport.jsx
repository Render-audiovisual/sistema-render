import React, { useEffect, useRef, useState } from 'react';
import { getSesion } from '../utils.jsx';
import { useScopedRequest } from '../shared/session/use-scoped-request.js';
import { isSessionFailure } from '../shared/session/captured-request.js';
import './InstagramClientReport.css';

// Private Leader view; the existing API independently enforces authorization.
const number = new Intl.NumberFormat('es-AR');
const fmt = value => typeof value === 'number' && Number.isFinite(value) ? number.format(value) : '—';
const TIPO = { reel: 'Reel', carrusel: 'Carrusel', imagen: 'Imagen' };

export function readReportParams(search) {
  if (typeof search !== 'string') return null;
  const params = new URLSearchParams(search);
  if ([...params.keys()].some(key => !['cliente', 'periodo'].includes(key)) ||
    params.getAll('cliente').length !== 1 || params.getAll('periodo').length !== 1) return null;
  const cliente = params.get('cliente'), periodo = params.get('periodo');
  if (!/^(cliente|grupo)-[1-9]\d{0,9}$/.test(cliente || '') || Number(cliente.split('-')[1]) > 2147483647 ||
    !/^20\d\d-(0[1-9]|1[0-2])$/.test(periodo || '')) return null;
  return { cliente, periodo };
}

export function clientReportHref(cliente, periodo) {
  const query = new URLSearchParams({ cliente, periodo });
  return readReportParams(query.toString()) ? `/instagram/reporte?${query}` : null;
}

export function reportPeriodLabel(periodo) {
  if (!/^20\d\d-(0[1-9]|1[0-2])$/.test(periodo || '')) return 'Mes no válido';
  const [year, month] = periodo.split('-').map(Number);
  const text = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function reportDate(value, dateOnly = false) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return 'Sin fecha disponible';
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', ...(dateOnly ? {} : { timeStyle: 'short' }), timeZone: 'America/Argentina/Cordoba' }).format(new Date(value));
}

export function safeReportLogo(value) {
  // Stored raster logos only: no external requests, SVG or tracking URLs.
  return typeof value === 'string' && value.length <= 2000000 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : null;
}

export function safeInstagramPostUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && ['www.instagram.com', 'instagram.com'].includes(u.hostname) && !u.username && !u.password && !u.port &&
      /^\/(?:p|reel)\/[A-Za-z0-9_-]+\/?$/.test(u.pathname) ? `https://www.instagram.com${u.pathname}` : null;
  } catch { return null; }
}

export function reportFormatState(data, format) {
  const counts = data?.format_counts, fulfillment = data?.fulfillment?.[format];
  const observable = ['current', 'historical', 'confirmed', 'stale', 'owner_record'].includes(counts?.status);
  const count = observable && Number.isSafeInteger(counts?.[format]) && counts[format] >= 0 ? counts[format] : null;
  const quota = Number.isSafeInteger(fulfillment?.cuota) && fulfillment.cuota >= 0 ? fulfillment.cuota : null;
  const matched = count !== null && fulfillment?.cantidad === count;
  const percentage = matched && quota > 0 && typeof fulfillment?.porcentaje === 'number' && Number.isFinite(fulfillment.porcentaje) &&
    fulfillment.porcentaje >= 0 && fulfillment.porcentaje <= 100 ? fulfillment.porcentaje : null;
  return { count, quota, percentage, status: counts?.status || 'unavailable' };
}

export function reportEvidenceLabel(counts) {
  const date = reportDate(counts?.checkedAt);
  if (counts?.status === 'owner_record') return `Registrado por dirección · ${date}. No acredita el cierre del mes.`;
  if (counts?.status === 'historical') return `Cierre comprobado · ${date}`;
  if (counts?.status === 'stale') return `Última comprobación · ${date}. Pendiente de actualizar.`;
  if (['current', 'confirmed'].includes(counts?.status)) return `Última comprobación · ${date}`;
  if (counts?.reason === 'owner_group_ambiguous') return 'Revisar cuentas compartidas. No hay un conteo conjunto acreditado.';
  if (counts?.reason === 'month_incomplete') return 'El mes no tiene una comprobación completa de cierre.';
  return 'Sin conexión verificada para este mes. Un dato no disponible no equivale a cero publicaciones.';
}

export function reportCoverageLabel(data) {
  const counts = data?.format_counts;
  const record = data?.coverage?.render_count_known === true && counts?.status === 'owner_record'
    ? `Dirección registró ${fmt(counts.reels)} reels y ${fmt(counts.carruseles)} carruseles de Render. ` : '';
  return `${record}El listado corresponde al perfil de Instagram; no identifica qué publicaciones realizó Render.${data?.coverage?.complete === false ? ' La cobertura del listado es parcial.' : ''}`;
}

// One request owns one client/month/session. Cleanup also fences a transport
// ignoring AbortSignal, including client/month A → B → A navigation.
export function beginClientReportLoad(capture, params, setState) {
  if (!params || !clientReportHref(params.cliente, params.periodo)) return () => {};
  const { cliente, periodo } = params;
  const controller = new AbortController(), guard = capture();
  let active = true;
  const current = () => active && !controller.signal.aborted && guard.current();
  if (!current()) return () => { active = false; controller.abort(); };
  setState({ loading: true, error: '', data: null });
  Promise.resolve().then(() => {
    if (!current()) return null;
    return guard.request(`/api/instagram/clientes/${encodeURIComponent(cliente)}/reporte?periodo=${encodeURIComponent(periodo)}`,
      { cache: 'no-store', signal: controller.signal });
  }).then(data => {
    if (!current()) return;
    if (!data || typeof data.cliente !== 'string' || data.periodo !== periodo || data.clave !== cliente)
      throw new Error('report_context_mismatch');
    setState({ loading: false, error: '', data });
  }).catch(reason => {
    if (!current()) return;
    const error = isSessionFailure(reason) || [401, 403].includes(reason?.status) ? 'El acceso al reporte cambió. Volvé a ingresar.' :
      reason?.status === 404 ? 'No hay un reporte disponible para este cliente y mes.' : 'No se pudo cargar el reporte. Volvé a abrirlo desde Clientes.';
    setState({ loading: false, error, data: null });
  });
  return () => { active = false; controller.abort(); };
}

export function prepareClientReportPrint(root, events) {
  const prior = new Map();
  const before = () => {
    for (const detail of root.current?.querySelectorAll('details') || []) {
      if (!prior.has(detail)) prior.set(detail, detail.open);
      detail.open = true;
    }
  };
  const after = () => { for (const [detail, open] of prior) detail.open = open; prior.clear(); };
  events.addEventListener('beforeprint', before);
  events.addEventListener('afterprint', after);
  return () => { events.removeEventListener('beforeprint', before); events.removeEventListener('afterprint', after); after(); };
}

function ReportLogo({ logo, name }) {
  const [failed, setFailed] = useState(false);
  const src = safeReportLogo(logo);
  const initials = (name || 'Cliente').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  return <span className="ig-client-report-logo" aria-hidden="true">{src && !failed ? <img src={src} alt="" onError={() => setFailed(true)} /> : initials}</span>;
}

export function ClientReportFormatCard({ label, format, data }) {
  const { count, quota, percentage, status } = reportFormatState(data, format);
  const disabled = quota === 0;
  return <section className={`ig-client-report-format${disabled ? ' is-excluded' : ''}`} aria-label={label} data-status={status}>
    <h2>{label}</h2>
    <p className="ig-client-report-count"><strong>{fmt(count)}</strong>{quota > 0 && <span> / {fmt(quota)}</span>}</p>
    <p className="ig-client-report-format-caption">{quota === null ? 'Sin configuración de cuota' : disabled ? 'No incluido en el acuerdo' : `Cuota del mes · ${fmt(quota)} ${label.toLowerCase()}`}</p>
    <div className={`ig-client-report-bar${disabled ? ' is-locked' : ''}`} role={percentage !== null ? 'progressbar' : undefined}
      aria-label={`${label}: ${disabled ? 'no incluido' : count === null ? 'sin conteo disponible' : quota === null ? 'sin cuota configurada' : 'avance registrado'}`}
      aria-disabled={percentage === null ? true : undefined} aria-valuemin={percentage !== null ? 0 : undefined}
      aria-valuemax={percentage !== null ? quota : undefined} aria-valuenow={percentage !== null ? Math.min(count, quota) : undefined}
      aria-valuetext={percentage !== null ? `${count} de ${quota}${status === 'owner_record' ? ', registrado por dirección; sin cierre acreditado' : ''}` : undefined}>
      <span style={{ width: `${percentage ?? 0}%` }} />
    </div>
    <p className="ig-client-report-format-note">{disabled && count > 0 ? `${fmt(count)} publicaciones fuera de la cuota.` :
      count === null ? 'Conteo no disponible' : status === 'owner_record' ? 'Registro de dirección, no cierre comprobado.' :
        status === 'stale' ? 'Conteo de la última comprobación.' : count === 0 ? 'Sin publicaciones en la comprobación.' : 'Publicaciones registradas en este mes.'}</p>
  </section>;
}

function ReportMetric({ label, value, previous }) {
  return <div><dt>{label}</dt><dd>{fmt(value)}</dd><small>Mes anterior: {fmt(previous)}</small></div>;
}

export function ClientReportStatistics({ data }) {
  const actual = data.actual || {}, previous = data.anterior || {};
  const pieces = Array.isArray(data.piezas) ? data.piezas : [], featured = Array.isArray(data.destacadas) ? data.destacadas : [];
  return <details className="ig-client-report-statistics">
    <summary>Más estadísticas<span>Alcance, comunidad y publicaciones</span></summary>
    <div className="ig-client-report-statistics-body">
      <section aria-label="Métricas de las publicaciones registradas">
        <h2>Resultados de las publicaciones</h2>
        <p className="ig-client-report-help">El alcance suma los valores por publicación: no son personas únicas. Las comparaciones incluyen períodos y antigüedades de piezas distintos.</p>
        <dl className="ig-client-report-metrics">
          <ReportMetric label="Publicaciones registradas" value={actual.piezas} previous={previous.piezas} />
          <ReportMetric label="Alcance acumulado por publicación" value={actual.alcance} previous={previous.alcance} />
          <ReportMetric label="Reproducciones" value={actual.vistas} previous={previous.vistas} />
          <ReportMetric label="Interacciones" value={actual.interacciones} previous={previous.interacciones} />
        </dl>
      </section>
      <section className="ig-client-report-community" aria-label="Comunidad y métricas por formato">
        <div><h2>Comunidad</h2><p><strong>{fmt(data.seguidores)}</strong> seguidores</p>
          <p className="ig-client-report-help">Cambio entre registros disponibles: {fmt(data.crecimiento_seguidores)}</p></div>
        <div><h2>Promedio por publicación</h2>
          <p>Reels: {fmt(data.formatos?.reel?.alcance_promedio)} de alcance</p>
          <p>Carruseles: {fmt(data.formatos?.carrusel?.alcance_promedio)} de alcance</p>
          <p className="ig-client-report-help">Interacciones / alcance: {typeof actual.tasa_interaccion === 'number' ? `${fmt(actual.tasa_interaccion)}%` : '—'}</p></div>
      </section>
      {featured.length > 0 && <section><h2>Publicaciones destacadas</h2><ol className="ig-client-report-featured">{featured.map(p => {
        const href = safeInstagramPostUrl(p.permalink);
        return <li key={p.permalink}><strong>{TIPO[p.tipo] || 'Publicación'} · {reportDate(p.publicado_at, true)}</strong>
          {p.caption && <p>{p.caption}</p>}{href && <a href={href} rel="noopener noreferrer">Ver publicación en Instagram ↗</a>}
          <dl><div><dt>Alcance</dt><dd>{fmt(p.metricas?.alcance)}</dd></div><div><dt>Reproducciones</dt><dd>{fmt(p.metricas?.vistas)}</dd></div>
            <div><dt>Interacciones</dt><dd>{fmt(p.metricas?.interacciones)}</dd></div><div><dt>Guardados</dt><dd>{fmt(p.metricas?.guardados)}</dd></div></dl>
        </li>;
      })}</ol></section>}
      <section><h2>Publicaciones del perfil en el mes</h2>
        <p className="ig-client-report-help">{reportCoverageLabel(data)}</p>
        {pieces.length === 0 ? <p className="ig-client-report-empty">No hay publicaciones registradas para este mes.</p> : <ul className="ig-client-report-posts">{pieces.map(p => {
          const href = safeInstagramPostUrl(p.permalink);
          return <li key={p.permalink}><header><strong>{TIPO[p.tipo] || 'Publicación'}</strong><span>{reportDate(p.publicado_at, true)}</span>
            {href && <a href={href} rel="noopener noreferrer">Ver publicación ↗</a>}</header>
            <dl>{[['Alcance', 'alcance'], ['Reproducciones', 'vistas'], ['Likes', 'likes'], ['Comentarios', 'comentarios'], ['Guardados', 'guardados'], ['Compartidos', 'compartidos']].map(([label, key]) =>
              <div key={key}><dt>{label}</dt><dd>{fmt(p.metricas?.[key])}</dd></div>)}</dl></li>;
        })}</ul>}
      </section>
    </div>
  </details>;
}

export function ClientReportDocument({ data }) {
  const accounts = Array.isArray(data.cuentas) ? data.cuentas.filter(name => typeof name === 'string' && /^[A-Za-z0-9_.]{1,30}$/.test(name)) : [];
  return <article className="ig-client-report-document">
    <header className="ig-client-report-heading">
      <ReportLogo key={`${data.cliente}:${data.logo || ''}`} logo={data.logo} name={data.cliente} />
      <div><p className="ig-client-report-eyebrow">RENDER · Reporte de Instagram</p><h1>{data.cliente}</h1>
        <p className="ig-client-report-accounts">{accounts.length ? accounts.map(name => `@${name}`).join(' · ') : 'Sin cuenta vinculada'}</p></div>
      <p className="ig-client-report-period">{reportPeriodLabel(data.periodo)}</p>
    </header>
    <section className="ig-client-report-formats" aria-label="Publicaciones por formato">
      <ClientReportFormatCard label="Reels" format="reels" data={data} />
      <ClientReportFormatCard label="Carruseles" format="carruseles" data={data} />
    </section>
    <p className="ig-client-report-evidence" role="status">{reportEvidenceLabel(data.format_counts)}</p>
    <p className="ig-client-report-coverage">{reportCoverageLabel(data)}</p>
    <ClientReportStatistics data={data} />
    <footer className="ig-client-report-footer"><span>RENDER · {reportPeriodLabel(data.periodo)}</span>
      {data.dataFecha && <span>Fecha del dato: {reportDate(data.dataFecha)}</span>}</footer>
  </article>;
}

function InstagramClientReportContent({ sesion, params, onPeriodChange }) {
  const { capture } = useScopedRequest(sesion, `instagram-client-report:${params.cliente}:${params.periodo}`);
  const page = useRef(null);
  const [state, setState] = useState({ loading: true, error: '', data: null });
  useEffect(() => beginClientReportLoad(capture, params, setState), [capture, params.cliente, params.periodo]);
  useEffect(() => prepareClientReportPrint(page, window), []);
  return <main className="ig-client-report-page" ref={page}>
    <div className="ig-client-report-toolbar">
      <a className="ig-client-report-back" href={`/instagram?periodo=${encodeURIComponent(params.periodo)}`}>← Volver a Clientes</a>
      <div className="ig-client-report-controls"><label><span>Mes del reporte</span><input type="month" value={params.periodo} onChange={event => onPeriodChange(event.target.value)} /></label>
        <button type="button" onClick={() => window.print()} disabled={!state.data || state.loading || Boolean(state.error)}>Imprimir / Guardar PDF</button></div>
    </div>
    <p className="ig-client-report-print-help">En el cuadro de impresión elegí “Guardar como PDF”.</p>
    {state.loading && <div className="ig-client-report-state" role="status">Cargando el reporte de {reportPeriodLabel(params.periodo)}…</div>}
    {state.error && <div className="ig-client-report-state" role="alert">{state.error}</div>}
    {state.data && <ClientReportDocument data={state.data} />}
  </main>;
}

export function InstagramClientReportPage({ sesion }) {
  const [search, setSearch] = useState(() => window.location.search);
  const params = readReportParams(search);
  const context = params ? `instagram-client-report:${params.cliente}:${params.periodo}` : `instagram-client-report:invalid:${search}`;
  const { view, epoch } = useScopedRequest(sesion || getSesion(), context);
  useEffect(() => {
    const readLocation = () => setSearch(window.location.search);
    window.addEventListener('popstate', readLocation);
    return () => window.removeEventListener('popstate', readLocation);
  }, []);
  const changePeriod = periodo => {
    const href = params && clientReportHref(params.cliente, periodo);
    if (!href) return;
    window.history.pushState({}, '', href);
    setSearch(window.location.search);
  };
  if (view.role !== 'admin') return <main className="ig-client-report-page"><div className="ig-client-report-state" role="alert">Disponible solo para Líder.</div></main>;
  if (!params) return <main className="ig-client-report-page"><div className="ig-client-report-state" role="alert">El cliente o el mes del reporte no son válidos.</div><a className="ig-client-report-back" href="/instagram">Volver a Clientes</a></main>;
  return <InstagramClientReportContent key={`${view.key}:${epoch}:${params.cliente}:${params.periodo}`} sesion={view.session} params={params} onPeriodChange={changePeriod} />;
}
