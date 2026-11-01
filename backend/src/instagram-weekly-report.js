import { responsablesDe, interactions } from './instagram-metrics.js';

// Reporte semanal (job 'instagram_reporte'). Primero calcula hechos con SQL;
// la IA, si está habilitada, solo redacta conclusiones a partir de esos hechos.

const TIME_ZONE = 'America/Argentina/Cordoba';
const DAY = 86400000;

function cordobaDate(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
const addDays = (iso, days) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);

// Última semana completa (lunes a domingo) en el calendario de Córdoba.
export function lastCompleteWeek(now) {
  const today = cordobaDate(now);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 domingo
  const thisMonday = addDays(today, -((weekday + 6) % 7));
  return { desde: addDays(thisMonday, -7), hasta: addDays(thisMonday, -1) };
}

const WEEK_MEDIA_SQL = `SELECT m.ig_media_id, m.tipo, m.permalink, left(m.caption, 160) AS caption, m.publicado_at,
    (m.publicado_at AT TIME ZONE '${TIME_ZONE}')::date::text AS fecha,
    to_char(m.publicado_at AT TIME ZONE '${TIME_ZONE}', 'HH24') AS hora,
    CASE WHEN c.grupo_feed_id IS NULL THEN 'cliente-'||c.id ELSE 'grupo-'||c.grupo_feed_id END AS clave,
    COALESCE(g.nombre, c.nombre) AS cliente,
    u.alcance, u.vistas, u.likes, u.comentarios, u.guardados, u.compartidos, u.interacciones, u.medido_at,
    op.responsables AS responsables_objetivo, p."responsable_diseño" AS responsable_diseno, p."responsable_edición" AS responsable_edicion
  FROM instagram_media m JOIN clientes c ON c.id=m.cliente_id LEFT JOIN grupos_feed g ON g.id=c.grupo_feed_id
  LEFT JOIN LATERAL (SELECT * FROM instagram_media_metricas x WHERE x.ig_media_id=m.ig_media_id ORDER BY x.medido_at DESC LIMIT 1) u ON TRUE
  LEFT JOIN publicaciones p ON p.id=m.publicacion_id
  LEFT JOIN cliente_objetivo_piezas op ON op.publicacion_id=m.publicacion_id
  WHERE m.tipo IN ('reel','carrusel')
    AND m.publicado_at >= ($1::date::timestamp AT TIME ZONE '${TIME_ZONE}')
    AND m.publicado_at < ($2::date::timestamp AT TIME ZONE '${TIME_ZONE}')`;

const avg = (sum, n) => (n ? Math.round(sum / n) : null);
function summarize(rows) {
  const measured = rows.filter(r => r.medido_at && r.alcance !== null);
  const alcance = measured.reduce((a, r) => a + Number(r.alcance), 0);
  const inter = measured.reduce((a, r) => a + (interactions(r) ?? 0), 0);
  return { piezas: rows.length, reels: rows.filter(r => r.tipo === 'reel').length, carruseles: rows.filter(r => r.tipo === 'carrusel').length,
    medidas: measured.length, alcance, interacciones: inter, alcance_promedio: avg(alcance, measured.length),
    tasa_interaccion: alcance ? Math.round((inter / alcance) * 10000) / 100 : null };
}
const pieceFact = r => ({ cliente: r.cliente, tipo: r.tipo, fecha: r.fecha, hora: r.hora, alcance: r.alcance === null ? null : Number(r.alcance),
  vistas: r.vistas === null ? null : Number(r.vistas), interacciones: interactions(r), guardados: r.guardados === null ? null : Number(r.guardados),
  compartidos: r.compartidos === null ? null : Number(r.compartidos), texto: (r.caption || '').replace(/\s+/g, ' ').trim().slice(0, 120), link: r.permalink });

export function buildWeeklyFacts({ week, weekRows, baseRows, formatRows, quota, now }) {
  const byClient = new Map();
  const bucket = (map, key, name) => { if (!map.has(key)) map.set(key, { nombre: name, semana: [], base: [], formato: [] }); return map.get(key); };
  for (const r of weekRows) bucket(byClient, r.clave, r.cliente).semana.push(r);
  for (const r of baseRows) bucket(byClient, r.clave, r.cliente).base.push(r);
  for (const r of formatRows) bucket(byClient, r.clave, r.cliente).formato.push(r);
  const clientes = [...byClient.entries()].map(([clave, c]) => {
    const semana = summarize(c.semana), base = summarize(c.base);
    const mejor = [...c.semana].filter(r => r.alcance !== null).sort((a, b) => Number(b.alcance) - Number(a.alcance))[0];
    const reels = summarize(c.formato.filter(r => r.tipo === 'reel')), carr = summarize(c.formato.filter(r => r.tipo === 'carrusel'));
    const q = quota.find(row => row.clave === clave);
    return {
      cliente: c.nombre, ...semana,
      base_4_semanas: { piezas: base.piezas, alcance_promedio: base.alcance_promedio },
      variacion_alcance_promedio_pct: semana.alcance_promedio !== null && base.alcance_promedio
        ? Math.round(((semana.alcance_promedio - base.alcance_promedio) / base.alcance_promedio) * 100) : null,
      mejor_pieza: mejor ? pieceFact(mejor) : null,
      formato_30_dias: { reel: { piezas: reels.medidas, alcance_promedio: reels.alcance_promedio }, carrusel: { piezas: carr.medidas, alcance_promedio: carr.alcance_promedio } },
      cupo_mes: q ? { publicadas: Number(q.publicadas), cupo: Number(q.reels) + Number(q.carruseles) } : null,
    };
  }).filter(c => c.piezas || c.base_4_semanas.piezas || c.cupo_mes)
    .sort((a, b) => a.cliente.localeCompare(b.cliente, 'es'));

  const people = new Map();
  for (const r of weekRows) for (const name of responsablesDe(r)) {
    if (!people.has(name)) people.set(name, []);
    people.get(name).push(r);
  }
  const equipo = [...people.entries()].map(([nombre, rows]) => {
    const s = summarize(rows);
    return { nombre, piezas: s.piezas, reels: s.reels, carruseles: s.carruseles, alcance_promedio: s.alcance_promedio, tasa_interaccion: s.tasa_interaccion };
  }).sort((a, b) => b.piezas - a.piezas || a.nombre.localeCompare(b.nombre, 'es'));

  const total = summarize(weekRows);
  return {
    version: 1, semana: week, generado_at: now.toISOString(),
    nota: 'Métricas a la fecha de generación; las piezas de los últimos días todavía pueden crecer.',
    totales: { piezas: total.piezas, reels: total.reels, carruseles: total.carruseles, alcance: total.alcance,
      alcance_promedio: total.alcance_promedio, tasa_interaccion: total.tasa_interaccion },
    clientes,
    equipo,
    top_piezas: [...weekRows].filter(r => r.alcance !== null).sort((a, b) => Number(b.alcance) - Number(a.alcance)).slice(0, 5).map(pieceFact),
    sin_publicar_en_la_semana: clientes.filter(c => c.piezas === 0 && c.cupo_mes).map(c => c.cliente),
  };
}

export async function readWeeklyFacts(db, week, now) {
  const monthStart = `${week.hasta.slice(0, 7)}-01`;
  const weekRows = (await db.query(WEEK_MEDIA_SQL, [week.desde, addDays(week.hasta, 1)])).rows;
  const baseRows = (await db.query(WEEK_MEDIA_SQL, [addDays(week.desde, -28), week.desde])).rows;
  const formatRows = (await db.query(WEEK_MEDIA_SQL, [addDays(week.hasta, -29), addDays(week.hasta, 1)])).rows;
  const quota = (await db.query(`SELECT o.clave, o.reels, o.carruseles,
      (SELECT count(*) FROM instagram_media m JOIN clientes c ON c.id=m.cliente_id
        WHERE (CASE WHEN c.grupo_feed_id IS NULL THEN 'cliente-'||c.id ELSE 'grupo-'||c.grupo_feed_id END)=o.clave
          AND m.tipo IN ('reel','carrusel')
          AND m.publicado_at >= ($1::date::timestamp AT TIME ZONE '${TIME_ZONE}')
          AND m.publicado_at < ($2::date::timestamp AT TIME ZONE '${TIME_ZONE}')) AS publicadas
    FROM cliente_objetivos_mensuales o WHERE o.periodo=$1::date`, [monthStart, addDays(week.hasta, 1)])).rows;
  return buildWeeklyFacts({ week, weekRows, baseRows, formatRows, quota, now });
}

// ---------- Conclusiones con IA (opcional) ----------

export function resolveAiConfig(env = {}) {
  if (env.INSTAGRAM_AI_REPORTS_ENABLED !== 'true') return null;
  const key = env.ANTHROPIC_API_KEY, model = env.INSTAGRAM_AI_MODEL;
  if (typeof key !== 'string' || key.length < 20 || /\s/.test(key) || typeof model !== 'string' || !/^[a-z0-9][a-z0-9.\-]{2,99}$/.test(model))
    throw new Error('Configuración de IA inválida');
  return Object.freeze({ key, model });
}

export const SYSTEM_PROMPT = `Sos analista de redes sociales de RENDER, una agencia de marketing de Corrientes, Argentina.
Recibís en JSON los datos reales de Instagram de la semana de los clientes de la agencia, calculados por el sistema.
Reglas:
- Usá solo los números del JSON. No inventes datos, porcentajes ni causas que no se puedan sostener con esos números.
- Si un dato falta o la muestra es chica (1 o 2 piezas), decilo en vez de sacar conclusiones fuertes.
- Escribí en español rioplatense, directo y concreto, sin frases de relleno.
Formato (texto plano, sin tablas ni markdown de encabezados):
RESUMEN: 3 a 5 líneas con lo más importante de la semana.
POR CLIENTE: una línea por cliente con qué funcionó o no y una recomendación accionable para la próxima semana.
EQUIPO: 2 a 4 líneas sobre producción y resultados por persona, sin juicios personales.
PRIORIDADES: hasta 3 acciones concretas para el Líder.`;

export async function generateConclusions(facts, config, { fetchImpl = globalThis.fetch, timeoutMs = 60000 } = {}) {
  let response;
  try {
    response = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': config.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.model, max_tokens: 1500, system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Datos de la semana:\n${JSON.stringify(facts)}` }] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch { throw new Error('IA no disponible'); }
  let body = null;
  try { body = await response.json(); } catch { /* sin cuerpo */ }
  if (!response.ok) throw new Error(`IA respondió ${response.status}`);
  const text = Array.isArray(body?.content) ? body.content.filter(p => p?.type === 'text').map(p => p.text).join('\n').trim() : '';
  if (!text) throw new Error('IA sin texto');
  return text.slice(0, 20000);
}

export async function runInstagramWeeklyReport(pool, { now = new Date(), env = process.env, fetchImpl } = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Fecha inválida');
  const ai = resolveAiConfig(env);
  const week = lastCompleteWeek(now);
  const existing = (await pool.query(`SELECT id, estado, hechos, generado_at FROM instagram_reportes WHERE tipo='semanal' AND desde=$1`, [week.desde])).rows[0];
  // Un error de IA se reintenta cada 6 horas como máximo; los hechos ya guardados no se recalculan.
  if (existing && (existing.estado !== 'ia_error' || !ai || now - new Date(existing.generado_at) < 6 * 3600000))
    return { estado: existing.estado, creado: false };
  const facts = existing ? existing.hechos : await (async () => {
    const db = await pool.connect();
    let discard;
    try {
      await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const value = await readWeeklyFacts(db, week, now);
      await db.query('COMMIT');
      return value;
    } catch (error) {
      try { await db.query('ROLLBACK'); } catch (rollback) { discard = rollback; }
      throw error;
    } finally { db.release(discard); }
  })();
  let estado = 'solo_datos', conclusiones = null;
  if (ai) {
    try { conclusiones = await generateConclusions(facts, ai, fetchImpl ? { fetchImpl } : {}); estado = 'ia'; }
    catch { estado = 'ia_error'; }
  }
  if (existing) {
    await pool.query(`UPDATE instagram_reportes SET estado=$2, conclusiones=$3, modelo=$4, generado_at=$5 WHERE id=$1`,
      [existing.id, estado, conclusiones, ai?.model ?? null, now]);
  } else {
    await pool.query(`INSERT INTO instagram_reportes (tipo,desde,hasta,hechos,conclusiones,modelo,estado,generado_at)
      VALUES('semanal',$1,$2,$3::jsonb,$4,$5,$6,$7) ON CONFLICT (tipo,desde) DO NOTHING`,
    [week.desde, week.hasta, JSON.stringify(facts), conclusiones, ai?.model ?? null, estado, now]);
  }
  return { estado, creado: !existing };
}
