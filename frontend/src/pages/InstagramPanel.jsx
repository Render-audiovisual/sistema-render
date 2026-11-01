import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getSesion } from '../utils.jsx';
import { useScopedRequest } from '../shared/session/use-scoped-request.js';
import { isSessionFailure } from '../shared/session/captured-request.js';
import { hasWeeklyReportCoverage } from '../shared/instagram-report-coverage.js';
import './InstagramPanel.css';

// Panel de rendimiento de Instagram. Solo Líder; el servidor vuelve a verificarlo.
const number = new Intl.NumberFormat('es-AR');
const compact = new Intl.NumberFormat('es-AR', { notation: 'compact', maximumFractionDigits: 1 });
const monthLabel = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dateLabel = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' });
const TIPO = { reel: 'Reel', carrusel: 'Carrusel', imagen: 'Imagen' };
const VINCULO = { automatico: 'Vinculado', manual: 'Vinculado a mano', ambiguo: 'Varias piezas posibles', sin_pieza: 'Sin pieza en el sistema', pendiente: 'Pendiente' };

export function currentPeriod(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Cordoba', year: 'numeric', month: '2-digit' })
    .formatToParts(now).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}`;
}
export function labelPeriod(period) {
  const [year, month] = period.split('-').map(Number);
  const text = monthLabel.format(new Date(Date.UTC(year, month - 1, 1)));
  return text.charAt(0).toUpperCase() + text.slice(1);
}
const pct = value => (value === null || value === undefined ? '—' : `${number.format(value)}%`);
const fmt = value => (value === null || value === undefined ? '—' : number.format(value));
const short = value => (value === null || value === undefined ? '—' : compact.format(value));
export function variation(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}
function Delta({ current, previous }) {
  const value = variation(current, previous);
  if (value === null) return null;
  return <span className={`ig-delta ${value > 0 ? 'is-up' : value < 0 ? 'is-down' : ''}`}>{value > 0 ? '+' : ''}{value}%</span>;
}

export function InstagramPanelPage({ sesion }) {
  const { view } = useScopedRequest(sesion || getSesion(), 'instagram');
  if (view.role !== 'admin') return <main className="page-shell ig-panel"><div className="salary-state is-error">El panel de Instagram está disponible solo para Líder.</div></main>;
  return <InstagramPanelContent key={view.key} sesion={view.session} />;
}

function InstagramPanelContent({ sesion }) {
  const [period, setPeriod] = useState(currentPeriod());
  const [tab, setTab] = useState('clientes');
  const [selected, setSelected] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const { capture } = useScopedRequest(sesion, `instagram:${period}:${version}`);

  useEffect(() => {
    const controller = new AbortController();
    const guard = capture();
    setLoading(true); setError('');
    guard.request(`/api/instagram/panel?periodo=${encodeURIComponent(period)}`, { cache: 'no-store', signal: controller.signal })
      .then(body => { if (guard.current() && !controller.signal.aborted) setData(body); })
      .catch(reason => { if (guard.current() && !controller.signal.aborted && !isSessionFailure(reason)) setError(reason.message || 'No se pudo cargar el panel.'); })
      .finally(() => { if (guard.current() && !controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [capture, period]);

  const reload = useCallback(() => setVersion(v => v + 1), []);
  const visibleAlerts=(data?.alertas||[]).filter(a=>a.tipo!=='sin_vincular');

  return <main className="page-shell ig-panel">
    <section className="salary-hero ig-hero">
      <div>
        <h1>Instagram</h1>
        <p>Reels y carruseles de cada cliente, con métricas de Meta y el rendimiento del equipo.</p>
      </div>
      <label className="ig-period"><span>Mes</span>
        <input type="month" value={period} min="2026-01" onChange={e => { if (/^\d{4}-\d{2}$/.test(e.target.value)) { setPeriod(e.target.value); setSelected(null); } }} />
      </label>
    </section>

    {data && <p className="ig-sync-note">
      {data.ultima_sincronizacion ? `Última sincronización con Meta: ${dateLabel.format(new Date(data.ultima_sincronizacion))}` : 'Todavía no hay datos sincronizados desde Meta.'}
      {data.cuentas_sin_cliente > 0 && <> · <button type="button" className="ig-link" onClick={() => { setTab('cuentas'); setSelected(null); }}>{data.cuentas_sin_cliente} cuenta{data.cuentas_sin_cliente === 1 ? '' : 's'} sin cliente asignado</button></>}
    </p>}

    <nav className="ig-tabs" aria-label="Secciones del panel">
      {[['clientes', 'Clientes'], ['equipo', 'Equipo'], ['reportes', 'Reportes'], ['cuentas', 'Cuentas']].map(([id, label]) =>
        <button key={id} type="button" className={tab === id ? 'is-active' : ''} aria-pressed={tab === id} onClick={() => { setTab(id); setSelected(null); }}>{label}{id === 'clientes' && visibleAlerts.length ? <span className="ig-badge" aria-label={`${visibleAlerts.length} alertas`}>{visibleAlerts.length}</span> : null}</button>)}
    </nav>

    {loading && data?.periodo !== period && <div className="salary-state">Cargando {labelPeriod(period)}…</div>}
    {error && <div className="salary-state is-error" role="alert"><strong>No se pudo cargar el panel.</strong><span>{error}</span>
      <button type="button" className="btn" onClick={reload}>Reintentar</button></div>}

    {data?.periodo === period && tab === 'clientes' && !selected && <ClientsView data={data} onOpen={setSelected} />}
    {data?.periodo === period && tab === 'clientes' && selected && <ClientDetail key={`${selected}:${period}`} sesion={sesion} clave={selected} period={period} onBack={() => setSelected(null)} onChanged={reload} />}
    {data?.periodo === period && tab === 'equipo' && <TeamView data={data} />}
    {tab === 'reportes' && <ReportsView sesion={sesion} />}
    {tab === 'cuentas' && <AccountsView sesion={sesion} onChanged={reload} />}
  </main>;
}

function Totals({ data }) {
  const t = data.totales;
  const counts=data.format_totals,known=counts?.current>0;
  return <section className="ig-metrics" aria-label={`Totales de ${labelPeriod(data.periodo)}`}>
    <article><span>Reels</span><strong>{known?fmt(counts.reels):'—'}</strong><small>{known?`${counts.current} de ${counts.total} clientes con datos comprobados`:'Sin información comprobada para este mes'}</small></article>
    <article><span>Carruseles</span><strong>{known?fmt(counts.carruseles):'—'}</strong><small>{known&&counts.current<counts.total?'Conteo parcial: faltan cuentas por comprobar':'Las imágenes sueltas no cuentan como carruseles'}</small></article>
    <article><span>Alcance total</span><strong>{short(t.alcance)}</strong><small>Promedio por pieza: {fmt(t.alcance_promedio)}</small></article>
    <article><span>Reproducciones</span><strong>{short(t.vistas)}</strong><small>Promedio por pieza: {fmt(t.vistas_promedio)}</small></article>
    <article><span>Tasa de interacción</span><strong>{pct(t.tasa_interaccion)}</strong><small>Interacciones / alcance</small></article>
  </section>;
}

function FormatProgress({label,format,status}) {
  const count=format?.cantidad,quota=format?.cuota,known=Number.isSafeInteger(count),included=format?.incluido;
  const trusted=['current','historical','confirmed'].includes(status);
  return <div className="ig-format-progress">
    <span>{label}</span><strong>{included===false?`${known&&count>0?`${count} registrados · `:''}No incluido`:`${known?fmt(count):'—'} / ${quota===null||quota===undefined?'—':fmt(quota)}`}</strong>
    {included!==false&&<i className="ig-bar" role={known&&trusted&&quota>0?'progressbar':undefined}
      aria-label={`${label}: ${known?`${count} registrados`:'sin información comprobada'}`}
      aria-valuemin={known&&trusted&&quota>0?0:undefined} aria-valuemax={known&&trusted&&quota>0?quota:undefined}
      aria-valuenow={known&&trusted&&quota>0?Math.min(count,quota):undefined}>
      <b style={{width:`${known&&quota>0?Math.min(100,count/quota*100):0}%`}}/></i>}
  </div>;
}

const NIVEL = { alta: 'Alta', media: 'Media', baja: 'Baja' };
function Alerts({ alerts, onOpen }) {
  const [open, setOpen] = useState(false);
  if (!alerts.length) return <p className="ig-alerts-ok" role="status">Sin alertas para este mes.</p>;
  const visible = open ? alerts : alerts.slice(0, 5);
  return <section className="ig-card ig-alerts" aria-label="Alertas">
    <header className="ig-card-head"><h2>Alertas · {alerts.length}</h2></header>
    <ul>
      {visible.map((a, i) => <li key={`${a.clave}:${a.tipo}:${i}`} className={`is-${a.nivel}`}>
        <span className="ig-alert-level">{NIVEL[a.nivel]}</span>
        <div><strong>{a.cliente} · {a.titulo}</strong><p>{a.detalle}</p></div>
        <button type="button" className="ig-link" onClick={() => onOpen(a.clave)}>Ver</button>
      </li>)}
    </ul>
    {alerts.length > 5 && <button type="button" className="ig-link" onClick={() => setOpen(v => !v)}>{open ? 'Ver menos' : `Ver las ${alerts.length}`}</button>}
  </section>;
}

function ReportsView({ sesion }) {
  const [list, setList] = useState({ loading: true, error: '', rows: [] });
  const [selected, setSelected] = useState(null);
  const [report, setReport] = useState(null);
  const { capture } = useScopedRequest(sesion, `instagram-reports:${selected ?? ''}`);
  useEffect(() => {
    const controller = new AbortController(), guard = capture();
    guard.request('/api/instagram/reportes', { cache: 'no-store', signal: controller.signal })
      .then(body => { if (guard.current()) { setList({ loading: false, error: '', rows: body.reportes }); setSelected(s => s ?? body.reportes[0]?.id ?? null); } })
      .catch(reason => { if (guard.current() && !controller.signal.aborted && !isSessionFailure(reason)) setList({ loading: false, error: reason.message, rows: [] }); });
    return () => controller.abort();
  }, [capture]);
  useEffect(() => {
    if (!selected) return undefined;
    const controller = new AbortController(), guard = capture();
    setReport(null);
    guard.request(`/api/instagram/reportes/${selected}`, { cache: 'no-store', signal: controller.signal })
      .then(body => { if (guard.current()) setReport(body); })
      .catch(reason => { if (guard.current() && !controller.signal.aborted && !isSessionFailure(reason)) setList(l => ({ ...l, error: reason.message })); });
    return () => controller.abort();
  }, [capture, selected]);
  const range = r => `${r.desde.slice(8, 10)}/${r.desde.slice(5, 7)} al ${r.hasta.slice(8, 10)}/${r.hasta.slice(5, 7)}`;
  return <section className="ig-card">
    <header className="ig-card-head"><h2>Reportes semanales</h2>
      {list.rows.length > 0 && <label className="ig-sort"><span>Semana</span><select value={selected ?? ''} onChange={e => setSelected(Number(e.target.value))}>
        {list.rows.map(r => <option key={r.id} value={r.id}>{range(r)}</option>)}
      </select></label>}
    </header>
    <p className="ig-help">Se generan solos cada lunes con los datos de la semana anterior (lunes a domingo). Los números los calcula el sistema; el texto de conclusiones lo redacta la IA solo a partir de esos números.</p>
    {list.loading && <div className="salary-state">Cargando reportes…</div>}
    {list.error && <div className="salary-state is-error" role="alert">{list.error}</div>}
    {!list.loading && !list.rows.length && !list.error && <div className="salary-state">Todavía no hay reportes. El primero aparece el lunes siguiente a activar el job <code>instagram_reporte</code>.</div>}
    {report && <WeeklyReport report={report} />}
  </section>;
}

function WeeklyReport({ report }) {
  if (!hasWeeklyReportCoverage(report)) return <div className="salary-state" role="status">Este reporte se generó sin datos de cuentas suficientes. No representa los resultados de la semana. Consultá las publicaciones sincronizadas en Clientes.</div>;
  const h = report.hechos;
  return <div className="ig-report-week">
    {report.estado === 'ia' && <article className="ig-conclusions"><h3>Conclusiones</h3><div>{report.conclusiones}</div></article>}
    {report.estado === 'ia_error' && <div className="salary-state">No se pudieron generar las conclusiones con IA; se reintentará. Abajo están los datos.</div>}
    <section className="ig-metrics">
      <article><span>Piezas de la semana</span><strong>{fmt(h.totales.piezas)}</strong><small>{h.totales.reels} reels · {h.totales.carruseles} carruseles</small></article>
      <article><span>Alcance</span><strong>{short(h.totales.alcance)}</strong><small>Promedio por pieza: {fmt(h.totales.alcance_promedio)}</small></article>
      <article><span>Tasa de interacción</span><strong>{pct(h.totales.tasa_interaccion)}</strong><small>Interacciones / alcance</small></article>
      <article><span>Sin publicar</span><strong>{h.sin_publicar_en_la_semana.length}</strong><small>{h.sin_publicar_en_la_semana.join(', ') || 'Todos publicaron'}</small></article>
    </section>
    <div className="ig-table ig-week" role="table" aria-label="Clientes en la semana">
      <div className="ig-row is-head" role="row"><span role="columnheader">Cliente</span><span role="columnheader">Piezas</span>
        <span role="columnheader">Alcance prom.</span><span role="columnheader">vs 4 semanas</span><span role="columnheader">Cupo del mes</span></div>
      {h.clientes.map(c => <div className="ig-row" role="row" key={c.cliente}>
        <span role="cell"><strong>{c.cliente}</strong>{c.mejor_pieza && <small>Mejor: {TIPO[c.mejor_pieza.tipo]} del {c.mejor_pieza.fecha.slice(8)}/{c.mejor_pieza.fecha.slice(5, 7)} · {fmt(c.mejor_pieza.alcance)}</small>}</span>
        <span role="cell"><em className="ig-cell-label">Piezas</em><strong>{c.piezas}</strong><small>{c.reels} reels · {c.carruseles} carr.</small></span>
        <span role="cell"><em className="ig-cell-label">Alcance prom.</em><strong>{fmt(c.alcance_promedio)}</strong></span>
        <span role="cell"><em className="ig-cell-label">vs 4 semanas</em><strong>{c.variacion_alcance_promedio_pct === null ? '—' : <span className={`ig-delta ${c.variacion_alcance_promedio_pct > 0 ? 'is-up' : c.variacion_alcance_promedio_pct < 0 ? 'is-down' : ''}`}>{c.variacion_alcance_promedio_pct > 0 ? '+' : ''}{c.variacion_alcance_promedio_pct}%</span>}</strong></span>
        <span role="cell"><em className="ig-cell-label">Cupo del mes</em><strong>{c.cupo_mes ? `${c.cupo_mes.publicadas}/${c.cupo_mes.cupo}` : '—'}</strong></span>
      </div>)}
    </div>
    {h.top_piezas.length > 0 && <><h3 className="ig-subtitle">Top de la semana</h3><ol className="ig-top">
      {h.top_piezas.map((p, i) => <li key={i}><strong>{p.cliente}</strong> · {TIPO[p.tipo]} · {fmt(p.alcance)} de alcance · <a href={p.link} target="_blank" rel="noopener noreferrer">ver ↗</a>{p.texto && <small>{p.texto}</small>}</li>)}
    </ol></>}
    <p className="ig-help">{h.nota}{report.modelo ? ` · Conclusiones: ${report.modelo}` : ''}</p>
  </div>;
}

function ClientsView({ data, onOpen }) {
  const [sort, setSort] = useState('nombre');
  const rows = useMemo(() => {
    const list = [...data.clientes];
    const by = { nombre: (a, b) => a.nombre.localeCompare(b.nombre, 'es'), alcance: (a, b) => b.actual.alcance - a.actual.alcance,
      tasa: (a, b) => (b.actual.tasa_interaccion ?? -1) - (a.actual.tasa_interaccion ?? -1), cumplimiento: (a, b) => (a.cumplimiento ?? 999) - (b.cumplimiento ?? 999) };
    return list.sort(by[sort]);
  }, [data, sort]);
  const maxReach = Math.max(1, ...rows.map(r => r.actual.alcance));
  if (!rows.length) return <div className="salary-state">No hay clientes con cuenta vinculada ni objetivos para {labelPeriod(data.periodo)}.</div>;
  return <>
    <Alerts alerts={(data.alertas || []).filter(a=>a.tipo!=='sin_vincular')} onOpen={onOpen} />
    <Totals data={data} />
    <section className="ig-card">
      <header className="ig-card-head"><h2>Clientes · {labelPeriod(data.periodo)}</h2>
        <label className="ig-sort"><span>Ordenar</span><select value={sort} onChange={e => setSort(e.target.value)}>
          <option value="nombre">Nombre</option><option value="alcance">Mayor alcance</option><option value="tasa">Mayor interacción</option><option value="cumplimiento">Menor cumplimiento</option>
        </select></label>
      </header>
      <div className="ig-table" role="table" aria-label="Rendimiento por cliente">
        <div className="ig-row is-head" role="row">
          <span role="columnheader">Cliente</span><span role="columnheader">Cupo</span><span role="columnheader">Alcance</span>
          <span role="columnheader">Interacción</span><span role="columnheader">Seguidores</span><span role="columnheader" className="ig-sr">Abrir</span>
        </div>
        {rows.map(c => <div className="ig-row" role="row" key={c.clave}>
          <span role="cell" className="ig-client">
            <strong>{c.nombre}</strong>
            <small>{c.instagram.length ? c.instagram.map(a => `@${a.username}`).join(' · ') : 'Sin cuenta vinculada'}</small>
            {c.format_counts?.status==='unavailable'&&<small>Sin información comprobada</small>}
            {c.format_counts?.status==='stale'&&<small className="ig-warn">Último dato: {dateLabel.format(new Date(c.format_counts.checkedAt))}</small>}
            {c.format_counts?.status==='owner_record'&&<small>Registrado por dirección · {dateLabel.format(new Date(c.format_counts.checkedAt))}</small>}
            {c.format_counts?.status==='historical'&&<small>Cierre comprobado · {dateLabel.format(new Date(c.format_counts.checkedAt))}</small>}
          </span>
          <span role="cell" className="ig-quota">
            <em className="ig-cell-label">Cupo</em>
            <FormatProgress label="Reels" format={c.fulfillment?.reels} status={c.format_counts?.status}/>
            <FormatProgress label="Carruseles" format={c.fulfillment?.carruseles} status={c.format_counts?.status}/>
            {!c.cupo&&<small>Cuota sin configurar</small>}
          </span>
          <span role="cell" className="ig-reach">
            <em className="ig-cell-label">Alcance</em>
            <strong>{short(c.actual.alcance)} <Delta current={c.actual.alcance} previous={c.anterior.alcance} /></strong>
            <i className="ig-bar" aria-hidden="true"><b style={{ width: `${(c.actual.alcance / maxReach) * 100}%` }} /></i>
          </span>
          <span role="cell"><em className="ig-cell-label">Interacción</em><strong>{pct(c.actual.tasa_interaccion)}</strong>
            <small>{fmt(c.actual.interacciones)} interacciones</small></span>
          <span role="cell"><em className="ig-cell-label">Seguidores</em><strong>{short(c.seguidores)}</strong>
            {c.crecimiento_seguidores !== null && <small className={c.crecimiento_seguidores < 0 ? 'ig-down' : ''}>{c.crecimiento_seguidores >= 0 ? '+' : ''}{fmt(c.crecimiento_seguidores)} en el mes</small>}</span>
          <span role="cell"><button type="button" className="btn ig-open" onClick={() => onOpen(c.clave)} aria-label={`Ver piezas de ${c.nombre}`}>Ver piezas</button></span>
        </div>)}
      </div>
    </section>
  </>;
}

function ClientDetail({ sesion, clave, period, onBack, onChanged }) {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState('');
  const { capture } = useScopedRequest(sesion, `instagram-client:${clave}:${period}:${version}`);
  useEffect(() => {
    const controller = new AbortController(), guard = capture();
    setState(s => ({ ...s, loading: true, error: '' }));
    guard.request(`/api/instagram/clientes/${encodeURIComponent(clave)}/piezas?periodo=${encodeURIComponent(period)}`, { cache: 'no-store', signal: controller.signal })
      .then(data => { if (guard.current()) setState({ loading: false, error: '', data }); })
      .catch(reason => { if (guard.current() && !controller.signal.aborted && !isSessionFailure(reason)) setState({ loading: false, error: reason.message, data: null }); });
    return () => controller.abort();
  }, [capture, clave, period]);

  const link = async (igMediaId, value) => {
    const guard = capture();
    setBusy(igMediaId);
    try {
      await guard.request(`/api/instagram/media/${encodeURIComponent(igMediaId)}/vinculo`, { method: 'PUT', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publicacion_id: value === '' ? null : Number(value) }) });
      setVersion(v => v + 1); onChanged();
    } catch (reason) { if (!isSessionFailure(reason)) setState(s => ({ ...s, error: reason.message })); }
    finally { setBusy(''); }
  };

  const { data } = state;
  return <section className="ig-card">
    <header className="ig-card-head">
      <button type="button" className="btn" onClick={onBack}>← Clientes</button>
      <h2>{data?.nombre ?? 'Cliente'} · {labelPeriod(period)}</h2>
      <a className="btn" href={`/instagram/reporte?${new URLSearchParams({ cliente: clave, periodo: period })}`} target="_blank" rel="noopener">Reporte para el cliente ↗</a>
    </header>
    {state.loading && !data && <div className="salary-state">Cargando piezas…</div>}
    {state.error && <div className="salary-state is-error" role="alert">{state.error}</div>}
    {data && !data.piezas.length && <div className="salary-state">No hay publicaciones de Instagram en este mes.</div>}
    {data && <div className="ig-pieces">
      {data.piezas.map(p => <article key={p.ig_media_id} className="ig-piece">
        <header>
          <span className={`ig-chip is-${p.tipo}`}>{TIPO[p.tipo]}</span>
          <time dateTime={p.publicado_at}>{dateLabel.format(new Date(p.publicado_at))}</time>
          <a href={p.permalink} target="_blank" rel="noopener noreferrer">Ver en Instagram ↗</a>
        </header>
        {p.caption && <p className="ig-caption">{p.caption}</p>}
        <dl className="ig-piece-metrics">
          <div><dt>Alcance</dt><dd>{fmt(p.metricas.alcance)}</dd></div>
          <div><dt>Reproducciones</dt><dd>{fmt(p.metricas.vistas)}</dd></div>
          <div><dt>Likes</dt><dd>{fmt(p.metricas.likes)}</dd></div>
          <div><dt>Comentarios</dt><dd>{fmt(p.metricas.comentarios)}</dd></div>
          <div><dt>Guardados</dt><dd>{fmt(p.metricas.guardados)}</dd></div>
          <div><dt>Compartidos</dt><dd>{fmt(p.metricas.compartidos)}</dd></div>
        </dl>
        <footer>
          <p className={`ig-link-state is-${p.vinculo}`}>{VINCULO[p.vinculo]}{p.pieza?.idea ? ` · ${p.pieza.idea}` : ''}</p>
          {p.responsables.length > 0 && <p className="ig-people">Equipo: {p.responsables.join(', ')}</p>}
          <label className="ig-link-select"><span>Pieza del sistema</span>
            <select disabled={busy === p.ig_media_id} value={p.publicacion_id ?? ''} onChange={e => link(p.ig_media_id, e.target.value)}>
              <option value="">{p.publicacion_id ? 'Quitar vínculo (recalcular)' : 'Elegir pieza…'}</option>
              {p.publicacion_id && <option value={p.publicacion_id}>{p.pieza?.fecha} · {p.pieza?.idea || `Pieza #${p.publicacion_id}`}</option>}
              {data.candidatas.map(c => <option key={c.id} value={c.id}>{c.fecha} · {TIPO[c.tipo] ?? c.tipo} · {c.idea || `Pieza #${c.id}`}</option>)}
            </select>
          </label>
        </footer>
      </article>)}
    </div>}
  </section>;
}

function TeamView({ data }) {
  if (!data.equipo.length) return <div className="salary-state">Todavía no hay piezas con responsables para {labelPeriod(data.periodo)}. Los responsables salen de las piezas del objetivo mensual y de las publicaciones vinculadas.</div>;
  return <section className="ig-card">
    <header className="ig-card-head"><h2>Equipo · {labelPeriod(data.periodo)}</h2></header>
    <p className="ig-help">Carga = piezas del objetivo mensual asignadas. Resultados = publicaciones de Instagram vinculadas a sus piezas.</p>
    <div className="ig-table ig-team" role="table" aria-label="Rendimiento por persona">
      <div className="ig-row is-head" role="row"><span role="columnheader">Persona</span><span role="columnheader">Carga</span>
        <span role="columnheader">Publicadas en IG</span><span role="columnheader">Alcance promedio</span><span role="columnheader">Interacción</span></div>
      {data.equipo.map(p => <div className="ig-row" role="row" key={p.nombre}>
        <span role="cell"><strong>{p.nombre}</strong></span>
        <span role="cell"><em className="ig-cell-label">Carga</em><strong>{p.publicadas_sistema}/{p.asignadas}</strong><small>publicadas / asignadas</small></span>
        <span role="cell"><em className="ig-cell-label">Publicadas en IG</em><strong>{p.totales.piezas}</strong><small>{p.totales.reels} reels · {p.totales.carruseles} carr.</small></span>
        <span role="cell"><em className="ig-cell-label">Alcance promedio</em><strong>{fmt(p.totales.alcance_promedio)}</strong><small>{fmt(p.totales.vistas_promedio)} reproducciones prom.</small></span>
        <span role="cell"><em className="ig-cell-label">Interacción</em><strong>{pct(p.totales.tasa_interaccion)}</strong></span>
      </div>)}
    </div>
  </section>;
}

function AccountsView({ sesion, onChanged }) {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState('');
  const { capture } = useScopedRequest(sesion, `instagram-accounts:${version}`);
  useEffect(() => {
    const controller = new AbortController(), guard = capture();
    guard.request('/api/instagram/cuentas', { cache: 'no-store', signal: controller.signal })
      .then(data => { if (guard.current()) setState({ loading: false, error: '', data }); })
      .catch(reason => { if (guard.current() && !controller.signal.aborted && !isSessionFailure(reason)) setState({ loading: false, error: reason.message, data: null }); });
    return () => controller.abort();
  }, [capture]);
  const assign = async (igUserId, value) => {
    const guard = capture();
    setBusy(igUserId);
    try {
      await guard.request(`/api/instagram/cuentas/${encodeURIComponent(igUserId)}`, { method: 'PUT', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cliente_id: value === '' ? null : Number(value) }) });
      setVersion(v => v + 1); onChanged();
    } catch (reason) { if (!isSessionFailure(reason)) setState(s => ({ ...s, error: reason.message })); }
    finally { setBusy(''); }
  };
  const { data } = state;
  return <section className="ig-card">
    <header className="ig-card-head"><h2>Cuentas de Instagram</h2></header>
    <p className="ig-help">Las cuentas aparecen solas cuando están asignadas al usuario del sistema en el Business Manager. Solo se sincronizan las que tienen cliente. Cambiar el cliente recalcula los vínculos de sus piezas.</p>
    {state.loading && !data && <div className="salary-state">Cargando cuentas…</div>}
    {state.error && <div className="salary-state is-error" role="alert">{state.error}</div>}
    {data && !data.cuentas.length && <div className="salary-state">Todavía no se descubrió ninguna cuenta. Revisá que el job de Instagram esté activo y el token configurado.</div>}
    {data && data.cuentas.length > 0 && <div className="ig-accounts">
      {data.cuentas.map(a => <div key={a.ig_user_id} className={`ig-account${a.activa ? '' : ' is-inactive'}`}>
        <div><strong>@{a.username}</strong><small>{a.seguidores === null ? 'Sin datos de seguidores' : `${fmt(a.seguidores)} seguidores`}{a.activa ? '' : ' · ya no visible para el token'}</small></div>
        <select aria-label={`Cliente de @${a.username}`} value={a.cliente_id ?? ''} disabled={busy === a.ig_user_id} onChange={e => assign(a.ig_user_id, e.target.value)}>
          <option value="">Sin cliente</option>
          {data.clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      </div>)}
    </div>}
  </section>;
}
