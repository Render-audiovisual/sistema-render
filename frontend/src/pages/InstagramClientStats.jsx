import React, { useEffect, useMemo, useState } from 'react';
import { getSesion } from '../utils.jsx';
import { useScopedRequest } from '../shared/session/use-scoped-request.js';
import { isSessionFailure } from '../shared/session/captured-request.js';
import { handleAppLinkClick } from '../shared/navigation/location.js';
import { mediaCoverUrl, mediaPostUrl } from './InstagramMediaGallery.jsx';
import './InstagramClientStats.css';

// Estadísticas por cliente y por publicación. La API revalida la sesión en cada pedido.
const nf = new Intl.NumberFormat('es-AR');
const fmt = v => (typeof v === 'number' && Number.isFinite(v) ? nf.format(v) : '—');
const times = v => (typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(1).replace('.', ',')}×` : '—');
const TIPO = { reel: 'Reel', carrusel: 'Carrusel' };
const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const METRIC_LABELS = [['vistas', 'Visualizaciones'], ['alcance', 'Alcance'], ['interacciones', 'Interacciones'], ['likes', 'Me gusta'],
  ['comentarios', 'Comentarios'], ['guardados', 'Guardados'], ['compartidos', 'Compartidos']];
const validClient = v => typeof v === 'string' && /^(cliente|grupo)-[1-9]\d{0,9}$/.test(v);
const validPeriod = v => typeof v === 'string' && /^20\d\d-(0[1-9]|1[0-2])$/.test(v);
const validMedia = v => typeof v === 'string' && /^[1-9]\d{0,39}$/.test(v);

export function readStatsParams(search) {
  const p = new URLSearchParams(search || '');
  if (['cliente', 'periodo', 'pub'].some(k => p.getAll(k).length > 1)) return null;
  const cliente = p.get('cliente'), periodo = p.get('periodo'), pub = p.get('pub');
  if (!validClient(cliente) || !validPeriod(periodo) || (pub !== null && !validMedia(pub))) return null;
  return { cliente, periodo, pub };
}
export function statsHref({ cliente, periodo, pub = null }) {
  if (!validClient(cliente) || !validPeriod(periodo) || (pub && !validMedia(pub))) return null;
  const q = new URLSearchParams({ cliente, periodo }); if (pub) q.set('pub', pub);
  return `/instagram/estadisticas?${q}`;
}
export function variation(current, previous) {
  return Number.isFinite(current) && Number.isFinite(previous) && previous > 0 ? Math.round(((current - previous) / previous) * 100) : null;
}
export function periodLabel(period) {
  const [y, m] = period.split('-').map(Number);
  const s = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const shortDate = iso => new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' }).format(new Date(iso));
export function measurementLabel(iso) {
  return typeof iso === 'string' && Number.isFinite(Date.parse(iso)) ? `Actualizado ${shortDate(iso)}` : 'Sin fecha de medición';
}
export function sortPublications(rows, tipo, orden) {
  const list = rows.filter(r => tipo === 'all' || r.tipo === tipo);
  const key = { fecha: r => Date.parse(r.publicado_at), puntaje: r => r.puntaje ?? -1, alcance: r => r.metricas.alcance ?? -1 }[orden];
  return list.slice().sort((a, b) => key(b) - key(a));
}

function useTooltip() {
  const [tip, setTip] = useState(null);
  const bind = text => ({ onMouseMove: e => setTip({ x: e.clientX, y: e.clientY, text }), onMouseLeave: () => setTip(null),
    onFocus: e => { const r = e.currentTarget.getBoundingClientRect(); setTip({ x: r.left, y: r.top, text }); }, onBlur: () => setTip(null), tabIndex: 0 });
  const node = tip && <div className="igs-tip" role="status" style={{ left: tip.x + 12, top: tip.y + 12 }}>{tip.text}</div>;
  return [bind, node];
}

function Sparkline({ values }) {
  const v = values.filter(Number.isFinite);
  if (v.length < 2) return null;
  const mn = Math.min(...v), mx = Math.max(...v), span = mx - mn || 1;
  return <svg className="igs-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
    <polyline points={v.map((y, i) => `${(i * 100) / (v.length - 1)},${27 - ((y - mn) / span) * 24}`).join(' ')} /></svg>;
}

function Tile({ label, value, previous, note, spark }) {
  const d = variation(value, previous);
  return <article className="igs-card igs-tile"><span className="igs-label">{label}</span><strong>{fmt(value)}</strong>
    {note ? <span className="igs-note">{note}</span> : d === null ? <span className="igs-note">Sin dato del mes anterior</span> :
      <span className={`igs-delta ${d >= 0 ? 'is-up' : 'is-down'}`}>{d >= 0 ? '▲ +' : '▼ '}{d}% vs mes anterior</span>}
    {spark && <Sparkline values={spark} />}</article>;
}

function niceTicks(lo, hi, count = 4) {
  const raw = (hi - lo) / count, mag = 10 ** Math.floor(Math.log10(raw || 1)), step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(st => st >= raw) || raw;
  const out = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) out.push(Math.round(t));
  return out;
}

export function FollowersChart({ serie, period, bind }) {
  const pts = serie.slice(-120);
  if (pts.length < 2) return <p className="igs-empty">Todavía no hay suficientes días de seguidores registrados. Se guardan desde que se conectó la cuenta.</p>;
  const W = 380, H = 200, L = 52, R = 10, T = 18, B = 24;
  const vals = pts.map(p => p.seguidores), mn = Math.min(...vals), mx = Math.max(...vals), pad = Math.max(5, (mx - mn) * 0.1);
  const lo = mn - pad, hi = mx + pad, x = i => L + (i / (pts.length - 1)) * (W - L - R), y = v => H - B - ((v - lo) / (hi - lo)) * (H - T - B);
  const ticks = niceTicks(lo, hi);
  const monthStart = pts.findIndex(p => p.fecha >= `${period}-01`);
  const labels = [0, Math.floor((pts.length - 1) / 2), pts.length - 1];
  return <svg className="igs-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Seguidores por día">
    {ticks.map(t => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="igs-grid" /><text x={L - 6} y={y(t) + 4} textAnchor="end">{fmt(t)}</text></g>)}
    {monthStart > 0 && <g><line x1={x(monthStart)} x2={x(monthStart)} y1={T} y2={H - B} className="igs-mark" /><text x={x(monthStart)} y={T - 6} textAnchor="middle">Inicio del mes</text></g>}
    <path d={`M${pts.map((p, i) => `${x(i)},${y(p.seguidores)}`).join('L')}`} className="igs-line" />
    {labels.map(i => <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}>{pts[i].fecha.slice(8)}/{pts[i].fecha.slice(5, 7)}</text>)}
    {pts.map((p, i) => <rect key={p.fecha} x={x(i) - (W - L - R) / pts.length / 2} y={T} width={(W - L - R) / pts.length} height={H - T - B} className="igs-hit"
      {...bind(`${p.fecha.slice(8)}/${p.fecha.slice(5, 7)}: ${fmt(p.seguidores)} seguidores`)} />)}
  </svg>;
}

export function CurveChart({ curva, bind }) {
  const own = curva.mediciones.filter(m => Number.isFinite(m.alcance) && m.horas >= 0 && m.horas <= 170);
  const band = curva.tipica.filter(b => b.p25 !== null);
  if (own.length < 2) return <p className="igs-empty">Esta publicación todavía no tiene suficientes mediciones para dibujar la curva. Se mide cada hora en sus primeros días.</p>;
  const maxH = Math.max(24, Math.min(168, Math.max(...own.map(m => m.horas))));
  const W = 640, H = 230, L = 56, R = 16, T = 14, B = 30;
  const maxV = Math.max(...own.map(m => m.alcance), ...band.filter(b => b.horas <= maxH).map(b => b.p75)) * 1.08 || 1;
  const x = h => L + (h / maxH) * (W - L - R), y = v => H - B - (v / maxV) * (H - T - B);
  const visibleBand = [{ horas: 0, p25: 0, p75: 0 }, ...band.filter(b => b.horas <= maxH)];
  const ticks = niceTicks(0, maxV).filter(t => t > 0);
  const xTicks = (maxH <= 48 ? [0, 6, 12, 24, 48] : [0, 24, 48, 72, 96, 120, 144, 168]).filter(h => h <= maxH);
  return <svg className="igs-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Curva de alcance de la publicación frente al rango típico">
    {ticks.map(t => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="igs-grid" /><text x={L - 6} y={y(t) + 4} textAnchor="end">{fmt(t)}</text></g>)}
    {xTicks.map(h => <text key={h} x={x(h)} y={H - 10} textAnchor="middle">{h === 0 ? 'Publicación' : h < 24 ? `${h} h` : `Día ${h / 24}`}</text>)}
    {visibleBand.length > 2 && <path className="igs-band" d={`M${visibleBand.map(b => `${x(b.horas)},${y(b.p75)}`).join('L')}L${visibleBand.slice().reverse().map(b => `${x(b.horas)},${y(b.p25)}`).join('L')}Z`} />}
    <path className="igs-line" d={`M${x(0)},${y(0)}L${own.map(m => `${x(m.horas)},${y(m.alcance)}`).join('L')}`} />
    {own.map(m => <circle key={m.horas} cx={x(m.horas)} cy={y(m.alcance)} r="3.5" className="igs-dot" />)}
    {own.map(m => <rect key={`h${m.horas}`} x={x(m.horas) - 8} y={T} width="16" height={H - T - B} className="igs-hit"
      {...bind(`${m.horas < 24 ? `${Math.round(m.horas)} h` : `Día ${(m.horas / 24).toFixed(1).replace('.', ',')}`}: ${fmt(m.alcance)} de alcance`)} />)}
  </svg>;
}

export function curveInsight(curva) {
  const own = curva.mediciones.filter(m => Number.isFinite(m.alcance));
  const at24 = curva.tipica.find(b => b.horas === 24);
  const mine = own.filter(m => m.horas <= 24.5).at(-1);
  if (!at24?.p50 || !mine || mine.horas < 20) return null;
  const r = mine.alcance / at24.p50;
  return r >= 1 ? `A las 24 h tenía ${times(r)} el alcance de una publicación típica de la cuenta.` : `A las 24 h estaba por debajo de lo típico (${times(r)} de una publicación normal de la cuenta).`;
}

function PublicationDetail({ capture, id, cover, bind, onClose }) {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  useEffect(() => {
    const controller = new AbortController(), guard = capture();
    setState({ loading: true, error: '', data: null });
    guard.request(`/api/instagram/media/${encodeURIComponent(id)}/estadisticas`, { cache: 'no-store', signal: controller.signal })
      .then(data => { if (guard.current() && data?.ig_media_id === id) setState({ loading: false, error: '', data }); })
      .catch(reason => { if (guard.current() && !controller.signal.aborted && !isSessionFailure(reason)) setState({ loading: false, error: reason?.status === 404 ? 'No encontramos esa publicación.' : 'No se pudo cargar la publicación.', data: null }); });
    return () => controller.abort();
  }, [capture, id]);
  const d = state.data, href = d && mediaPostUrl(d.permalink), img = mediaCoverUrl(cover);
  const insight = d && curveInsight(d.curva);
  return <section className="igs-card igs-detail" aria-label="Publicación seleccionada">
    <header className="igs-detail-head"><h2>Publicación seleccionada</h2><button type="button" className="igs-link" onClick={onClose}>Ver todas ✕</button></header>
    {state.loading && <p className="igs-empty">Cargando publicación…</p>}
    {state.error && <p className="igs-empty" role="alert">{state.error}</p>}
    {d && <div className="igs-detail-body">
      <div className="igs-detail-media">
        <div className="igs-detail-cover">{img ? <img src={img} alt="" width="240" height="300" loading="lazy" referrerPolicy="no-referrer" /> : <span>{TIPO[d.tipo]}</span>}</div>
        <p className="igs-detail-meta">{TIPO[d.tipo]} · {shortDate(d.publicado_at)}</p>
        <p className="igs-sub">{measurementLabel(d.medido_at)}</p>
        {href && <a href={href} target="_blank" rel="noopener noreferrer" className="igs-link">Ver en Instagram ↗</a>}
        {d.caption && <details className="igs-copy"><summary>Ver copy</summary><p>{d.caption}</p></details>}
      </div>
      <div className="igs-detail-data">
        <div className="igs-score"><span>Rendimiento contra el promedio de la cuenta</span><strong className={d.puntaje >= 1 ? 'is-up' : 'is-down'}>{times(d.puntaje)}</strong>
          <small>Promedio de {d.promedio.piezas} {d.tipo === 'reel' ? 'reels' : 'carruseles'} de los últimos {d.promedio.dias} días</small></div>
        <dl className="igs-metrics">{METRIC_LABELS.map(([k, label]) => <div key={k}><dt>{label}</dt><dd>{fmt(d.metricas[k])}</dd>
          <small className={d.comparacion[k] === null ? '' : d.comparacion[k] >= 1 ? 'is-up' : 'is-down'}>{d.comparacion[k] === null ? 'sin promedio' : `${times(d.comparacion[k])} promedio`}</small></div>)}</dl>
        <h3>Cómo creció el alcance</h3>
        <CurveChart curva={d.curva} bind={bind} />
        <div className="igs-legend"><span><i className="igs-key-line" />Esta publicación</span><span><i className="igs-key-band" />Rango típico de la cuenta (25–75 %)</span></div>
        {insight && <p className="igs-insight">{insight}</p>}
      </div>
    </div>}
  </section>;
}

function Heatmap({ rows, bind }) {
  if (!rows.some(r => r.dias.some(Boolean))) return <p className="igs-empty">Todavía no hay suficientes publicaciones medidas.</p>;
  const level = v => (v < 0.8 ? 1 : v < 1 ? 2 : v < 1.2 ? 3 : v < 1.5 ? 4 : 5);
  return <div className="igs-heat" role="table" aria-label="Rendimiento por día y franja horaria">
    <div role="row" className="igs-heat-row"><span role="columnheader" />{DAYS.map(d => <span role="columnheader" key={d}>{d}</span>)}</div>
    {rows.map(r => <div role="row" className="igs-heat-row" key={r.franja}><span role="rowheader">{r.etiqueta}</span>
      {r.dias.map((c, i) => <span role="cell" key={i} className={c ? `igs-q${level(c.puntaje)}` : 'igs-q0'}
        {...bind(c ? `${DAYS[i]} · ${r.etiqueta}: ${times(c.puntaje)} el promedio (${c.piezas} ${c.piezas === 1 ? 'pieza' : 'piezas'})` : `${DAYS[i]} · ${r.etiqueta}: sin publicaciones`)}>{c ? times(c.puntaje) : '—'}</span>)}</div>)}
  </div>;
}

function StatsContent({ sesion, params, navigate }) {
  const { capture } = useScopedRequest(sesion, `instagram-stats:${params.cliente}:${params.periodo}`);
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [tipo, setTipo] = useState('all'), [orden, setOrden] = useState('fecha');
  const [bind, tipNode] = useTooltip();
  useEffect(() => {
    const controller = new AbortController(), guard = capture();
    setState({ loading: true, error: '', data: null });
    guard.request(`/api/instagram/clientes/${encodeURIComponent(params.cliente)}/estadisticas?periodo=${encodeURIComponent(params.periodo)}`, { cache: 'no-store', signal: controller.signal })
      .then(data => { if (guard.current() && data?.clave === params.cliente) setState({ loading: false, error: '', data }); })
      .catch(reason => { if (guard.current() && !controller.signal.aborted && !isSessionFailure(reason)) setState({ loading: false, error: reason?.status === 404 ? 'No encontramos este cliente.' : 'No se pudieron cargar las estadísticas.', data: null }); });
    return () => controller.abort();
  }, [capture, params.cliente, params.periodo]);
  const d = state.data;
  const rows = useMemo(() => (d?.publicaciones ? sortPublications(d.publicaciones, tipo, orden) : []), [d, tipo, orden]);
  const selected = d?.publicaciones?.find(p => p.ig_media_id === params.pub);
  const maxScore = Math.max(2, ...rows.map(r => r.puntaje ?? 0));
  const a = d?.totales?.actual, p = d?.totales?.anterior;
  return <main className="igs-page">
    <div className="igs-toolbar">
      <a className="igs-link" href={`/instagram?periodo=${encodeURIComponent(params.periodo)}&tab=clientes`} onClick={e => handleAppLinkClick(window, e)}>← Volver a Clientes</a>
      <div className="igs-controls">
        <label><span>Mes</span><input type="month" value={params.periodo} onChange={e => validPeriod(e.target.value) && navigate({ ...params, periodo: e.target.value, pub: null })} /></label>
        <a className="igs-button" href={`/instagram/reporte?${new URLSearchParams({ cliente: params.cliente, periodo: params.periodo })}`} onClick={e => handleAppLinkClick(window, e)}>Ver reporte</a>
      </div>
    </div>
    {state.loading && <p className="igs-state" role="status">Cargando estadísticas de {periodLabel(params.periodo)}…</p>}
    {state.error && <p className="igs-state" role="alert">{state.error}</p>}
    {d && <>
      <header className="igs-head"><h1>{d.nombre} · Estadísticas</h1><p>{d.cuentas.map(c => `@${c}`).join(' · ') || 'Sin cuenta vinculada'} · {periodLabel(d.periodo)}</p></header>
      {d.sin_cuenta ? <p className="igs-state">Este cliente todavía no tiene una cuenta de Instagram conectada.</p> : <>
        <section className="igs-tiles" aria-label="Resumen del mes">
          <Tile label="Visualizaciones" value={a.vistas} previous={p.vistas} />
          <Tile label="Interacciones" value={a.interacciones} previous={p.interacciones} spark={d.diario.map(x => x.interacciones)} />
          <Tile label="Publicaciones" value={a.piezas} previous={p.piezas} note={`${a.reels} reels · ${a.carruseles} carruseles`} />
          <Tile label="Seguidores ganados en el mes" value={d.seguidores.crecimiento} previous={d.seguidores.anterior}
            note={d.seguidores.fin === null ? 'Sin datos de seguidores en el mes' : `Total: ${fmt(d.seguidores.fin)} seguidores`} spark={d.seguidores.serie.slice(-31).map(x => x.seguidores)} />
        </section>

        {selected && <PublicationDetail key={selected.ig_media_id} capture={capture} id={selected.ig_media_id} cover={selected.portada_url} bind={bind} onClose={() => navigate({ ...params, pub: null })} />}

        <section className="igs-card" aria-label="Publicaciones del mes">
          <header className="igs-section-head"><div><h2>Publicación por publicación</h2><p>Tocá una publicación para ver su detalle y su curva. Puntaje = alcance contra el promedio de su formato en la cuenta (1,0× = normal).</p></div>
            <div className="igs-filters">
              <div role="group" aria-label="Formato">{[['all', 'Todo'], ['reel', 'Reels'], ['carrusel', 'Carruseles']].map(([k, l]) => <button key={k} type="button" aria-pressed={tipo === k} onClick={() => setTipo(k)}>{l}</button>)}</div>
              <label><span>Ordenar</span><select value={orden} onChange={e => setOrden(e.target.value)}><option value="fecha">Más recientes</option><option value="puntaje">Mejor puntaje</option><option value="alcance">Mayor alcance</option></select></label>
            </div></header>
          {rows.length ? <ul className="igs-pubs">{rows.map(r => { const img = mediaCoverUrl(r.portada_url); const pct = r.puntaje === null ? 0 : Math.min(r.puntaje / maxScore, 1) * 100;
            return <li key={r.ig_media_id}><button type="button" className={`igs-pub${params.pub === r.ig_media_id ? ' is-active' : ''}`} onClick={() => { navigate({ ...params, pub: r.ig_media_id }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
              <span className="igs-thumb">{img ? <img src={img} alt="" width="48" height="60" loading="lazy" referrerPolicy="no-referrer" /> : TIPO[r.tipo]?.[0]}</span>
              <span className="igs-pub-text"><b>{r.caption?.trim() || `${TIPO[r.tipo]} sin copy`}</b><small>{TIPO[r.tipo]} · {shortDate(r.publicado_at)}</small><small>{measurementLabel(r.medido_at)}</small></span>
              <span className="igs-pub-num"><b>{fmt(r.metricas.vistas)}</b><small>vistas</small></span>
              <span className="igs-pub-score"><span className="igs-scorebar"><i className={r.puntaje >= 1 ? '' : 'is-low'} style={{ width: `${pct}%` }} /><em style={{ left: `${(1 / maxScore) * 100}%` }} /></span>
                <b className={r.puntaje === null ? '' : r.puntaje >= 1 ? 'is-up' : 'is-down'}>{times(r.puntaje)}</b></span>
            </button></li>; })}</ul> : <p className="igs-empty">No hay {tipo === 'reel' ? 'reels' : tipo === 'carrusel' ? 'carruseles' : 'publicaciones'} en este mes.</p>}
        </section>

        <div className="igs-grid">
          <section className="igs-card"><h2>Seguidores, día por día</h2><p className="igs-sub">{d.seguidores.crecimiento === null ? 'Sin datos del mes.' : `${d.seguidores.crecimiento >= 0 ? '+' : ''}${fmt(d.seguidores.crecimiento)} en ${periodLabel(d.periodo).toLowerCase()} (de ${fmt(d.seguidores.inicio)} a ${fmt(d.seguidores.fin)})`}</p>
            <FollowersChart serie={d.seguidores.serie} period={d.periodo} bind={bind} /></section>
          <section className="igs-card"><h2>Mejores días y horarios</h2><p className="igs-sub">Puntaje promedio según cuándo se publicó (últimos {d.promedio.dias} días)</p>
            <Heatmap rows={d.horarios} bind={bind} />
            <div className="igs-legend"><span>Menos</span>{[1, 2, 3, 4, 5].map(l => <i key={l} className={`igs-sw igs-q${l}`} />)}<span>Más</span></div></section>
        </div>
      </>}
    </>}
    {tipNode}
  </main>;
}

export function InstagramClientStatsPage({ sesion }) {
  const [search, setSearch] = useState(() => window.location.search);
  const params = readStatsParams(search);
  const { view, epoch } = useScopedRequest(sesion || getSesion(), params ? `instagram-stats:${params.cliente}:${params.periodo}` : `instagram-stats:invalid:${search}`);
  useEffect(() => { const read = () => setSearch(window.location.search); window.addEventListener('popstate', read); return () => window.removeEventListener('popstate', read); }, []);
  const navigate = next => { const href = statsHref(next); if (!href) return; window.history.pushState({}, '', href); setSearch(window.location.search); };
  if (!view.role) return <main className="igs-page"><p className="igs-state" role="alert">Iniciá sesión para consultar Instagram.</p></main>;
  if (!params) return <main className="igs-page"><p className="igs-state" role="alert">El cliente o el mes no son válidos.</p><a className="igs-link" href="/instagram" onClick={e => handleAppLinkClick(window, e)}>Volver a Clientes</a></main>;
  return <StatsContent key={`${view.key}:${epoch}:${params.cliente}:${params.periodo}`} sesion={view.session} params={params} navigate={navigate} />;
}
