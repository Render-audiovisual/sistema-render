import { num, interactions } from './instagram-metrics.js';
import { readViewBreakdowns } from './instagram-view-breakdown.js';

// Estadísticas por cliente y por publicación (solo lectura). Todo sale de lo
// que ya guarda la sincronización: mediciones horarias por pieza y seguidores
// diarios. Las comparaciones son contra el propio promedio de la cuenta.

export const TIME_ZONE = 'America/Argentina/Cordoba';
const DAY = 86400000, HOUR = 3600000;
export const BASELINE_DAYS = 90;
export const CURVE_OFFSETS_H = Object.freeze([1, 2, 3, 6, 12, 24, 48, 72, 96, 120, 144, 168]);
export const SLOTS = Object.freeze([['manana', 'Mañana', 6, 12], ['mediodia', 'Mediodía', 12, 15], ['tarde', 'Tarde', 15, 19], ['noche', 'Noche', 19, 30]]);
export const METRICS = Object.freeze(['alcance', 'vistas', 'vistas_instagram', 'vistas_facebook', 'vistas_total', 'interacciones', 'likes', 'comentarios', 'guardados', 'compartidos']);

const round2 = v => Math.round(v * 100) / 100;
const finite = v => typeof v === 'number' && Number.isFinite(v);

export function percentile(values, p) {
  const v = values.filter(finite).sort((a, b) => a - b);
  if (!v.length) return null;
  const i = (v.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return v[lo] + (v[hi] - v[lo]) * (i - lo);
}

// Valor de una métrica a X horas de publicada, interpolando entre mediciones.
// Antes de la primera medición se interpola desde 0; después de la última, null.
export function valueAtHours(series, hours, field = 'alcance') {
  const points = series.filter(s => finite(s.horas) && finite(s[field])).sort((a, b) => a.horas - b.horas);
  if (!points.length || hours > points[points.length - 1].horas + 0.5) return null;
  let prev = { horas: 0, [field]: 0 };
  for (const point of points) {
    if (point.horas >= hours) {
      const span = point.horas - prev.horas;
      return span <= 0 ? point[field] : Math.round(prev[field] + (point[field] - prev[field]) * ((hours - prev.horas) / span));
    }
    prev = point;
  }
  return points[points.length - 1][field];
}

// Banda típica (percentiles 25-50-75) de piezas comparables en cada punto de la curva.
export function typicalBand(peerSeries, offsets = CURVE_OFFSETS_H, field = 'alcance', minPeers = 3) {
  return offsets.map(horas => {
    const values = peerSeries.map(series => valueAtHours(series, horas, field)).filter(finite);
    return values.length >= minPeers
      ? { horas, p25: Math.round(percentile(values, 0.25)), p50: Math.round(percentile(values, 0.5)), p75: Math.round(percentile(values, 0.75)), piezas: values.length }
      : { horas, p25: null, p50: null, p75: null, piezas: values.length };
  });
}

// Promedio por tipo (reel / carrusel) para comparar justo entre formatos.
export function baselineByType(rows) {
  const out = {};
  for (const tipo of ['reel', 'carrusel']) {
    const same = rows.filter(r => r.tipo === tipo);
    out[tipo] = Object.fromEntries(METRICS.map(metric => {
      const values = same.map(r => r[metric]).filter(finite);
      return [metric, values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null];
    }));
    out[tipo].piezas = same.filter(r => finite(r.alcance)).length;
  }
  return out;
}

export function score(value, base) {
  return finite(value) && finite(base) && base > 0 ? round2(value / base) : null;
}

function cordobaParts(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(date).map(({ type, value }) => [type, value]));
  const weekday = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[parts.weekday];
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), weekday };
}

export function slotOf(hour) {
  const h = hour < 6 ? hour + 24 : hour;
  return SLOTS.find(([, , from, to]) => h >= from && h < to)?.[0] ?? 'noche';
}

// Rendimiento promedio (alcance / promedio de su tipo) por día de semana y franja.
export function heatmap(rows, base) {
  const cells = new Map();
  for (const row of rows) {
    const ratio = score(row.alcance, base[row.tipo]?.alcance);
    if (ratio === null) continue;
    const { weekday, hour } = cordobaParts(new Date(row.publicado_at));
    const key = `${weekday}:${slotOf(hour)}`;
    const cell = cells.get(key) ?? { sum: 0, piezas: 0 };
    cell.sum += ratio; cell.piezas += 1; cells.set(key, cell);
  }
  return SLOTS.map(([slot, label]) => ({ franja: slot, etiqueta: label,
    dias: [0, 1, 2, 3, 4, 5, 6].map(d => { const c = cells.get(`${d}:${slot}`); return c ? { puntaje: round2(c.sum / c.piezas), piezas: c.piezas } : null; }) }));
}

// Seguidores sumados por día entre las cuentas del cliente (feed compartido).
export function followerSeries(rows, accountIds) {
  const byDate = new Map();
  for (const row of rows) {
    if (!accountIds.includes(row.ig_user_id)) continue;
    const entry = byDate.get(row.fecha) ?? new Map();
    entry.set(row.ig_user_id, Number(row.seguidores));
    byDate.set(row.fecha, entry);
  }
  return [...byDate.entries()].filter(([, values]) => values.size === accountIds.length)
    .map(([fecha, values]) => ({ fecha, seguidores: [...values.values()].reduce((a, b) => a + b, 0) }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export function followerGrowth(series, period) {
  const before = series.filter(p => p.fecha < `${period}-01`).at(-1);
  const inside = series.filter(p => p.fecha.startsWith(period));
  if (!inside.length) return { inicio: before?.seguidores ?? null, fin: null, crecimiento: null, dias: 0 };
  const start = before ?? inside[0], end = inside.at(-1);
  return { inicio: start.seguidores, fin: end.seguidores, crecimiento: end.seguidores - start.seguidores, dias: inside.length,
    desde: start.fecha, hasta: end.fecha };
}

export function monthTotals(rows) {
  const measured = rows.filter(r => finite(r.alcance));
  const sum = key => {
    const values = rows.map(row => row[key]).filter(finite);
    return values.length ? values.reduce((a,b) => a+b,0) : rows.length ? null : 0;
  };
  return { piezas: rows.length, reels: rows.filter(r => r.tipo === 'reel').length, carruseles: rows.filter(r => r.tipo === 'carrusel').length,
    medidas: measured.length, alcance: sum('alcance'), vistas: sum('vistas'),
    vistas_instagram: sum('vistas_instagram'), vistas_facebook: sum('vistas_facebook'),
    vistas_total: rows.every(r => finite(r.vistas_total)) ? sum('vistas_total') : null,
    interacciones: sum('interacciones'),
    guardados: sum('guardados'), compartidos: sum('compartidos') };
}

export function dailyTotals(rows, period) {
  const [y, m] = period.split('-').map(Number), days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out = Array.from({ length: days }, (_, i) => ({ dia: i + 1, alcance: 0, interacciones: 0, piezas: 0 }));
  for (const row of rows) {
    const { date } = cordobaParts(new Date(row.publicado_at));
    if (!date.startsWith(period)) continue;
    const slot = out[Number(date.slice(8)) - 1];
    slot.piezas += 1; slot.alcance += finite(row.alcance) ? row.alcance : 0; slot.interacciones += finite(row.interacciones) ? row.interacciones : 0;
  }
  return out;
}

// ---------- SQL ----------

const latest = alias => `LEFT JOIN LATERAL (SELECT * FROM instagram_media_metricas x WHERE x.ig_media_id=${alias}.ig_media_id
    ORDER BY x.medido_at DESC LIMIT 1) u ON TRUE`;

const MEDIA_RANGE_SQL = `SELECT m.ig_media_id, m.ig_user_id, m.cliente_id, m.tipo, m.permalink, left(m.caption, 2200) AS caption, m.publicado_at,
    to_char(m.publicado_at AT TIME ZONE '${TIME_ZONE}','YYYY-MM') AS periodo,
    u.medido_at, u.alcance, u.vistas, u.likes, u.comentarios, u.guardados, u.compartidos, u.interacciones
  FROM instagram_media m ${latest('m')}
  WHERE m.ig_user_id = ANY($1::text[]) AND m.tipo IN ('reel','carrusel')
    AND m.publicado_at >= $2 AND m.publicado_at < $3`;

const monthStart = period => new Date(`${period}-01T03:00:00Z`); // 00:00 Córdoba (UTC-3, sin horario de verano)
const nextMonth = period => { const [y, m] = period.split('-').map(Number); const d = new Date(Date.UTC(y, m, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const prevMonth = period => { const [y, m] = period.split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

export function normalizeRow(row) {
  return { ig_media_id: row.ig_media_id, tipo: row.tipo, permalink: row.permalink, caption: row.caption ?? '',
    publicado_at: new Date(row.publicado_at).toISOString(), medido_at: row.medido_at ? new Date(row.medido_at).toISOString() : null,
    alcance: num(row.alcance), vistas: num(row.vistas), vistas_instagram: num(row.vistas_instagram),
    vistas_facebook: num(row.vistas_facebook), vistas_total: num(row.vistas_total), likes: num(row.likes), comentarios: num(row.comentarios),
    guardados: num(row.guardados), compartidos: num(row.compartidos), interacciones: interactions(row) };
}

export async function readClientStatsFromDb(db, { accountIds, period, covers = new Map(), selectMedia }) {
  const start = monthStart(period), end = monthStart(nextMonth(period)), prevStart = monthStart(prevMonth(period));
  const baseStart = new Date(+end - BASELINE_DAYS * DAY);
  const observations = (await db.query(MEDIA_RANGE_SQL, [accountIds, new Date(Math.min(+prevStart, +baseStart)), end])).rows;
  const rows = (await readViewBreakdowns(db, await selectMedia(observations))).map(normalizeRow);
  const inMonth = rows.filter(r => Date.parse(r.publicado_at) >= +start);
  const inPrev = rows.filter(r => Date.parse(r.publicado_at) >= +prevStart && Date.parse(r.publicado_at) < +start);
  const baseRows = rows.filter(r => Date.parse(r.publicado_at) >= +baseStart);
  const base = baselineByType(baseRows);
  const followerRows = (await db.query(`SELECT ig_user_id, fecha::text AS fecha, seguidores FROM instagram_cuenta_seguidores
    WHERE ig_user_id = ANY($1::text[]) AND fecha < $2::date ORDER BY fecha`, [accountIds, `${nextMonth(period)}-01`])).rows;
  const series = followerSeries(followerRows, accountIds);
  return {
    periodo: period, periodo_anterior: prevMonth(period),
    totales: { actual: monthTotals(inMonth), anterior: monthTotals(inPrev) },
    diario: dailyTotals(inMonth, period),
    seguidores: { serie: series.slice(-400), ...followerGrowth(series, period),
      anterior: followerGrowth(series, prevMonth(period)).crecimiento },
    promedio: { dias: BASELINE_DAYS, ...base },
    publicaciones: inMonth.sort((a, b) => Date.parse(b.publicado_at) - Date.parse(a.publicado_at)).map(row => ({
      ig_media_id: row.ig_media_id, tipo: row.tipo, permalink: row.permalink, caption: row.caption.slice(0, 280),
      publicado_at: row.publicado_at, medido_at: row.medido_at, portada_url: covers.get(row.ig_media_id) ?? null,
      metricas: Object.fromEntries(METRICS.map(k => [k, row[k]])),
      puntaje: score(row.alcance, base[row.tipo]?.alcance),
    })),
    horarios: heatmap(baseRows, base),
  };
}

export async function readMediaStatsFromDb(db, igMediaId) {
  const media = (await db.query(`SELECT m.ig_media_id, m.ig_user_id, m.cliente_id, m.tipo, m.permalink, left(m.caption,2200) AS caption,
      m.publicado_at, u.medido_at, u.alcance, u.vistas, u.likes, u.comentarios, u.guardados, u.compartidos, u.interacciones
    FROM instagram_media m ${latest('m')} WHERE m.ig_media_id=$1 AND m.cliente_id IS NOT NULL`, [igMediaId])).rows[0];
  if (!media) return null;
  const row = normalizeRow((await readViewBreakdowns(db, [media]))[0]);
  const published = Date.parse(row.publicado_at);
  const snapshotsFor = async ids => (await db.query(`SELECT ig_media_id, medido_at, alcance, vistas, likes, comentarios, guardados, compartidos, interacciones
    FROM instagram_media_metricas WHERE ig_media_id = ANY($1::text[]) ORDER BY ig_media_id, medido_at`, [ids])).rows;
  const peers = (await readViewBreakdowns(db, (await db.query(`SELECT m.ig_media_id, m.ig_user_id, m.cliente_id, m.tipo, m.publicado_at, u.medido_at, u.alcance, u.vistas, u.likes, u.comentarios,
      u.guardados, u.compartidos, u.interacciones
    FROM instagram_media m ${latest('m')}
    WHERE m.ig_user_id=$1 AND m.tipo=$2 AND m.ig_media_id<>$3 AND m.publicado_at >= $4 AND m.publicado_at < $5`,
  [media.ig_user_id, row.tipo, igMediaId, new Date(published - BASELINE_DAYS * DAY), new Date(published + 30 * DAY)])).rows)).map(normalizeRow);
  const all = await snapshotsFor([igMediaId, ...peers.map(p => p.ig_media_id)]);
  const toSeries = (id, publishedAt) => all.filter(s => s.ig_media_id === id).map(s => ({
    horas: round2((Date.parse(new Date(s.medido_at).toISOString()) - publishedAt) / HOUR),
    ...Object.fromEntries(METRICS.map(k => [k, k === 'interacciones' ? interactions(s) : num(s[k])])) }));
  const own = toSeries(igMediaId, published);
  const peerSeries = peers.map(p => toSeries(p.ig_media_id, Date.parse(p.publicado_at)));
  const base = baselineByType(peers)[row.tipo];
  return {
    ig_media_id: row.ig_media_id, cliente_id: media.cliente_id, ig_user_id: media.ig_user_id, tipo: row.tipo, permalink: row.permalink,
    caption: row.caption, publicado_at: row.publicado_at, medido_at: row.medido_at,
    metricas: Object.fromEntries(METRICS.map(k => [k, row[k]])),
    promedio: { piezas: base.piezas, dias: BASELINE_DAYS, ...Object.fromEntries(METRICS.map(k => [k, base[k]])) },
    comparacion: Object.fromEntries(METRICS.map(k => [k, score(row[k], base[k])])),
    puntaje: score(row.alcance, base.alcance),
    curva: { mediciones: own.map(s => ({ horas: s.horas, alcance: s.alcance, vistas: s.vistas, interacciones: s.interacciones })),
      tipica: typicalBand(peerSeries) },
  };
}
