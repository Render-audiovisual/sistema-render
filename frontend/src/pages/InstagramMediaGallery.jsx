import React, { useMemo, useState } from 'react';
import './InstagramMediaGallery.css';

const numbers = new Intl.NumberFormat('es-AR');
const formats = { reel: 'Reel', carrusel: 'Carrusel', imagen: 'Imagen' };
export const mediaNumber = value => Number.isSafeInteger(value) && value >= 0 ? numbers.format(value) : '—';

export function mediaCoverUrl(value) {
  try {
    if (typeof value !== 'string' || value.length > 4096 || /[\s\\\x00-\x1f\x7f]/.test(value)) return null;
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash &&
      /\.(jpe?g|png|webp|avif)$/i.test(decodeURIComponent(url.pathname)) &&
      ![...url.searchParams.keys()].some(key => /^(access_token|token|authorization|bearer)$/i.test(key)) &&
      /^(?:[a-z0-9-]+\.)+(?:cdninstagram\.com|fbcdn\.net)$/.test(url.hostname)
      ? url.href : null;
  } catch { return null; }
}

export function mediaPostUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      ['instagram.com', 'www.instagram.com'].includes(url.hostname) && /^\/(p|reel)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)
      ? `https://www.instagram.com${url.pathname}` : null;
  } catch { return null; }
}

export function galleryPieces(pieces, type = 'all', order = 'vistas') {
  const value = p => order === 'fecha' ? Date.parse(p.publicado_at) : p.metricas?.[order];
  const valid = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  return (Array.isArray(pieces) ? pieces : []).filter(p => p && ['reel', 'carrusel'].includes(p.tipo) &&
    (type === 'all' || p.tipo === type)).slice().sort((a, b) => {
      const av = value(a), bv = value(b);
      if (valid(av) !== valid(bv)) return valid(av) ? -1 : 1;
      if (valid(av) && av !== bv) return bv - av;
      return (Date.parse(b.publicado_at) || 0) - (Date.parse(a.publicado_at) || 0) || String(a.permalink).localeCompare(String(b.permalink));
    });
}

function MediaIcon({ type }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    {type === 'reel' ? <><rect x="3" y="3" width="18" height="18" rx="5"/><path d="M10 8l6 4-6 4z"/></> :
      <><rect x="3" y="6" width="15" height="15" rx="3"/><path d="M8 3h10a3 3 0 013 3v10"/></>}
  </svg>;
}

export function InstagramMediaCard({ piece }) {
  const [failed, setFailed] = useState(false);
  const cover = mediaCoverUrl(piece.portada_url), href = mediaPostUrl(piece.permalink);
  const date = Number.isFinite(Date.parse(piece.publicado_at)) ? new Intl.DateTimeFormat('es-AR',
    { day: 'numeric', month: 'short', timeZone: 'America/Argentina/Cordoba' }).format(new Date(piece.publicado_at)) : 'Sin fecha';
  const title = typeof piece.caption === 'string' && piece.caption.trim() ? piece.caption.trim() : `${formats[piece.tipo] || 'Publicación'} del ${date}`;
  const visual = <><div className="ig-media-cover">
    {cover && !failed ? <img src={cover} alt={`Portada: ${title.slice(0, 120)}`} width="480" height="600" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)}/> :
      <div className="ig-media-no-cover"><MediaIcon type={piece.tipo}/><span>Portada no disponible</span><small>Ver en Instagram ↗</small></div>}
    <span className="ig-media-type"><MediaIcon type={piece.tipo}/>{formats[piece.tipo]}</span>
    <span className="ig-media-open" aria-hidden="true">↗</span>
    <div className={`ig-media-impact${cover && !failed ? ' has-cover' : ''}`}><span>Reproducciones</span><strong>{mediaNumber(piece.metricas?.vistas)}</strong></div>
  </div><div className="ig-media-title"><time dateTime={piece.publicado_at}>{date}</time><h3>{title}</h3></div></>;
  return <article className="ig-media-card">
    {href ? <a className="ig-media-preview" href={href} target="_blank" rel="noopener noreferrer" aria-label={`Ver ${formats[piece.tipo]?.toLowerCase() || 'publicación'} en Instagram: ${title.slice(0, 120)}`}>{visual}</a> : <div className="ig-media-preview">{visual}</div>}
    {typeof piece.caption === 'string' && piece.caption.trim() ?
      <details className="ig-media-copy"><summary>Ver copy completo</summary><p>{piece.caption}</p></details> :
      <p className="ig-media-copy-empty">Sin copy disponible</p>}
    <dl className="ig-media-results"><div><dt>Alcance</dt><dd>{mediaNumber(piece.metricas?.alcance)}</dd></div><div><dt>Guardados</dt><dd>{mediaNumber(piece.metricas?.guardados)}</dd></div></dl>
    <details className="ig-media-details"><summary>Ver resultados</summary><dl>
      {[['Likes', 'likes'], ['Comentarios', 'comentarios'], ['Guardados', 'guardados'], ['Compartidos', 'compartidos']].map(([label, key]) =>
        <div key={key}><dt>{label}</dt><dd>{mediaNumber(piece.metricas?.[key])}</dd></div>)}
    </dl><p>{piece.medido_at && Number.isFinite(Date.parse(piece.medido_at)) ? `Medido el ${new Intl.DateTimeFormat('es-AR', {dateStyle:'short',timeZone:'America/Argentina/Cordoba'}).format(new Date(piece.medido_at))}` : 'Fecha de medición no disponible'}</p></details>
  </article>;
}

export function InstagramMediaGallery({ pieces }) {
  const [type, setType] = useState('all'), [order, setOrder] = useState('vistas');
  const rows = useMemo(() => galleryPieces(pieces, type, order), [pieces, type, order]);
  return <section className="ig-media-gallery" aria-label="Rendimiento del contenido">
    <header className="ig-media-heading"><div><p>CONTENIDO DEL MES</p><h2>Qué contenido funciona mejor</h2><span>Reconocé cada publicación y compará sus resultados.</span></div>
      <label>Ordenar por<select value={order} onChange={e => setOrder(e.target.value)}><option value="vistas">Más reproducciones</option><option value="alcance">Mayor alcance</option><option value="fecha">Más recientes</option></select></label></header>
    <div className="ig-media-controls"><nav aria-label="Formato de contenido">{[['all','Todo'],['reel','Reels'],['carrusel','Carruseles']].map(([key,label]) =>
      <button key={key} type="button" aria-pressed={type === key} onClick={() => setType(key)}>{label}</button>)}</nav><span aria-live="polite">{rows.length} {rows.length === 1 ? 'publicación' : 'publicaciones'}</span></div>
    <p className="ig-media-note">Las reproducciones no son visitas al perfil. «—» significa que Meta no informó esa métrica.</p>
    <p className="ig-media-print-context">Contenido mostrado: {type === 'all' ? 'reels y carruseles' : type === 'reel' ? 'solo reels' : 'solo carruseles'} · Orden: {order === 'vistas' ? 'reproducciones' : order === 'alcance' ? 'alcance' : 'fecha'}.</p>
    {rows.length ? <div className="ig-media-grid">{rows.map(piece => <InstagramMediaCard key={`${piece.permalink}:${piece.portada_url || ''}`} piece={piece}/>)}</div> :
      <p className="ig-media-empty">No hay {type === 'reel' ? 'reels' : type === 'carrusel' ? 'carruseles' : 'reels ni carruseles'} registrados para este mes.</p>}
  </section>;
}
