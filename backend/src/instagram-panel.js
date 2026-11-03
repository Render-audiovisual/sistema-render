import { captureFinanceActor } from './finance-snapshot.js';
import {readTeamStatistics} from './team-statistics.js';
import { captureOwnerProfileWriteAuthority, checkCapturedOwnerProfileAuthority,
  retainCapturedOwnerProfileAuthority } from './owner-profile-authority.js';
import { linkInstagramAccountInTransaction } from './instagram-accounts.js';
import { computeAlerts } from './instagram-alerts.js';
import {inspectMetaConnection} from './instagram-connection.js';
import { readClientStatsFromDb, readMediaStatsFromDb } from './instagram-stats.js';
import { readViewBreakdowns } from './instagram-view-breakdown.js';
import { selectReportMedia, readReportMembershipSnapshots } from './instagram-report-membership.js';
import { num, interactions, responsablesDe } from './instagram-metrics.js';
import { loadGoalClients } from './client-goals.js';
import { instagramFeedGroupCounts, validateFeedCountSnapshot,feedCountsAreTrusted } from '../../shared/instagram-feed-counts.mjs';
import { validateInstagramMonthlyObservation } from '../../shared/instagram-monthly-observation.mjs';
import { MEDIA_COVERS_ACTION, COVER_MAX_AGE_MS, normalizeCoverUrl, normalizeCoverSnapshot } from './instagram-graph.js';
import {monthlyAdjustment} from '../../shared/client-monthly-adjustment.mjs';
export { interactions, responsablesDe };

// Instagram reports are shared with authenticated active users. Administrative
// reads and all writes remain Leader-only; every read revalidates the session.

const TIME_ZONE = 'America/Argentina/Cordoba';
const MONTHLY_ADJUSTMENTS_SQL=`SELECT DISTINCT ON(ia.detalles->>'key') ia.detalles FROM integracion_auditoria ia
 WHERE ia.integracion='client_monthly_control' AND ia.canal='web' AND ia.accion='monthly_count_adjustment_v1'
 AND ia.resultado='ok' AND ia.detalles->>'period'=$1 ORDER BY ia.detalles->>'key',ia.id DESC`;
const fail = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const forbidden = () => fail(403, 'El panel de Instagram está disponible solo para Líder.', 'INSTAGRAM_PANEL_FORBIDDEN');

export function panelPeriod(query) {
  const keys = Object.keys(query || {});
  const value = query?.periodo;
  if (keys.some(key => key !== 'periodo') || typeof value !== 'string' || value.length !== 7
    || !/^(20\d\d)-(0[1-9]|1[0-2])$/.test(value)) throw fail(400, 'Elegí un mes válido (YYYY-MM).');
  return value;
}

export function previousPeriod(period) {
  const [year, month] = period.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function verifyLeader(db, observed, lock, leaderOnly = true) {
  const actor = (await db.query(`SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1${lock ? ' FOR SHARE' : ''}`,
    [observed.id])).rows[0];
  if (!actor || actor.id !== observed.id || actor.activo !== true || actor.session_version !== observed.session_version)
    throw fail(401, 'La sesión cambió. Volvé a iniciar sesión.');
  if (leaderOnly && actor.rol !== 'admin') throw forbidden();
}

export async function withLeaderRead(pool, auth, read) {
  return withInstagramRead(pool, auth, read, true);
}

export async function withInstagramRead(pool, auth, read, leaderOnly = false) {
  const observed = captureFinanceActor(auth);
  const delegation = captureOwnerProfileWriteAuthority(observed);
  const db = await pool.connect();
  let discard;
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await checkCapturedOwnerProfileAuthority(db, delegation);
    await verifyLeader(db, observed, false, leaderOnly);
    const result = await read(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (rollback) { discard = rollback; }
    throw error;
  } finally { db.release(discard); }
}

export async function withLeaderWrite(pool, auth, mutate) {
  const observed = captureFinanceActor(auth);
  const delegation = captureOwnerProfileWriteAuthority(auth);
  const db = await pool.connect();
  let discard;
  try {
    await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await retainCapturedOwnerProfileAuthority(db, delegation);
    await verifyLeader(db, observed, true);
    await db.query("SELECT pg_advisory_xact_lock(hashtext('instagram-panel'),0)");
    const result = await mutate(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (rollback) { discard = rollback; }
    throw error;
  } finally { db.release(discard); }
}

// ---------- Agregación (pura, testeable) ----------

function emptyTotals() {
  return { piezas: 0, reels: 0, carruseles: 0, imagenes: 0, medidas: 0, alcance: 0, vistas: 0,
    vistas_total: 0, vistas_instagram: 0, vistas_facebook: 0, interacciones: 0, guardados: 0, compartidos: 0 };
}
function addMedia(totals, row) {
  totals.piezas += 1;
  totals[{ reel: 'reels', carrusel: 'carruseles', imagen: 'imagenes' }[row.tipo]] += 1;
  for (const key of ['vistas_total', 'vistas_instagram', 'vistas_facebook']) {
    const value = num(row[key]);
    totals[key] = totals[key] !== null && Number.isSafeInteger(value) && value >= 0 ? totals[key] + value : null;
  }
  if (row.medido_at) {
    totals.medidas += 1;
    totals.alcance += num(row.alcance) ?? 0;
    totals.vistas += num(row.vistas) ?? 0;
    totals.interacciones += interactions(row) ?? 0;
    totals.guardados += num(row.guardados) ?? 0;
    totals.compartidos += num(row.compartidos) ?? 0;
  }
  return totals;
}
export function finishTotals(totals) {
  const per = value => (totals.medidas ? Math.round(value / totals.medidas) : null);
  return { ...totals, alcance_promedio: per(totals.alcance), vistas_promedio: per(totals.vistas),
    interacciones_promedio: per(totals.interacciones),
    tasa_interaccion: totals.alcance ? Math.round((totals.interacciones / totals.alcance) * 10000) / 100 : null };
}

export function formatFulfillment(counts,quota) {
  const trusted=feedCountsAreTrusted(counts?.status);
  const format=key=>{
    const limit=quota?.[key],count=counts?.[key];
    const configured=Number.isSafeInteger(limit)&&limit>=0,known=Number.isSafeInteger(count)&&count>=0;
    return {cantidad:known?count:null,cuota:configured?limit:null,incluido:configured?limit>0:null,
      porcentaje:configured&&limit>0&&known?Math.min(100,Math.floor(count/limit*100)):null,
      pendientes:configured&&known?Math.max(0,limit-count):null,
      completo:trusted&&configured&&known&&count>=limit};
  };
  const reels=format('reels'),carruseles=format('carruseles'),total=(quota?.reels??0)+(quota?.carruseles??0);
  const known=reels.cantidad!==null&&carruseles.cantidad!==null&&reels.cuota!==null&&carruseles.cuota!==null;
  return {reels,carruseles,completo:known&&total>0&&reels.completo&&carruseles.completo,
    porcentaje:trusted&&known&&total>0?Math.floor((Math.min(reels.cantidad,reels.cuota)+Math.min(carruseles.cantidad,carruseles.cuota))/total*100):null};
}

export function buildPanel({ period, clients, accounts, media, objectives, followers, pieces, baselines = [], lastPosts = [], snapshots=[],manualObservations=[],monthlyAdjustments=[],effectiveQuotas,now = new Date() }) {
  const previous = previousPeriod(period);
  const groups = new Map();
  for (const client of clients) {
    let group = groups.get(client.clave);
    if (!group) {
      group = { clave: client.clave, nombre: client.grupo_nombre || client.nombre, cuentas: [], instagram: [],
        cupo: null, sistema: { reels_publicados: 0, carruseles_publicados: 0, piezas: 0 },
        actual: emptyTotals(), anterior: emptyTotals(), seguidores: null, seguidores_inicio: null, sin_vincular: 0,
        base: { medidas: 0, alcance: 0 }, ultima_publicacion: null };
      groups.set(client.clave, group);
    }
    if (!group.logo && typeof client.logo === 'string' && client.logo.trim()) group.logo = client.logo;
    group.cuentas.push({ id: client.id, nombre: client.nombre });
  }
  const accountClave = new Map();
  for (const account of accounts) {
    const client = clients.find(c => c.id === account.cliente_id);
    if (!client) continue;
    const group = groups.get(client.clave);
    accountClave.set(account.ig_user_id, client.clave);
    const f = followers.filter(row => row.ig_user_id === account.ig_user_id);
    const current = f.find(row => row.tipo === 'actual')?.seguidores ?? null;
    const start = f.find(row => row.tipo === 'inicio')?.seguidores ?? null;
    group.instagram.push({ ig_user_id: account.ig_user_id, username: account.username, sincronizada_at: account.sincronizada_at,
      seguidores: num(current) });
    if (current !== null) group.seguidores = (group.seguidores ?? 0) + Number(current);
    if (start !== null) group.seguidores_inicio = (group.seguidores_inicio ?? 0) + Number(start);
    const base = baselines.find(row => row.ig_user_id === account.ig_user_id);
    if (base) { group.base.medidas += Number(base.medidas) || 0; group.base.alcance += Number(base.alcance) || 0; }
    const last = lastPosts.find(row => row.ig_user_id === account.ig_user_id)?.ultima;
    if (last && (!group.ultima_publicacion || new Date(last) > new Date(group.ultima_publicacion))) group.ultima_publicacion = last;
  }
  const team = new Map();
  const person = name => {
    if (!team.has(name)) team.set(name, { nombre: name, asignadas: 0, publicadas_sistema: 0, totales: emptyTotals() });
    return team.get(name);
  };
  for (const row of media) {
    const clave = accountClave.get(row.ig_user_id);
    const group = clave && groups.get(clave);
    if (!group) continue;
    const bucket = row.periodo === period ? group.actual : row.periodo === previous ? group.anterior : null;
    if (!bucket) continue;
    addMedia(bucket, row);
    if (row.periodo === period) {
      if (!['automatico', 'manual'].includes(row.vinculo) && row.tipo !== 'imagen') group.sin_vincular += 1;
      for (const name of responsablesDe(row)) addMedia(person(name).totales, row);
    }
  }
  for (const objective of objectives) {
    const group = groups.get(objective.clave);
    if (group) group.cupo = { reels: Number(objective.reels), carruseles: Number(objective.carruseles) };
  }
  for (const piece of pieces) {
    const group = groups.get(piece.clave);
    if (group) {
      group.sistema.piezas += 1;
      if (piece.estado === 'publicada') group.sistema[piece.tipo === 'carrusel' ? 'carruseles_publicados' : 'reels_publicados'] += 1;
    }
    for (const name of Array.isArray(piece.responsables) ? piece.responsables : []) {
      if (typeof name !== 'string' || !name.trim()) continue;
      const entry = person(name.trim());
      entry.asignadas += 1;
      if (piece.estado === 'publicada') entry.publicadas_sistema += 1;
    }
  }
  const clientes = [...groups.values()]
    .filter(group => group.instagram.length || group.cupo || group.sistema.piezas || effectiveQuotas?.some(q=>q.clave===group.clave))
    .map(group => {
      const actual = finishTotals(group.actual), anterior = finishTotals(group.anterior);
      const inputs=group.cuentas.map(c=>{
        const account=accounts.find(a=>a.cliente_id===c.id);
        return {...c,instagram_account_id:account?.ig_user_id,instagram_account_active:account?.activa,
          instagram_feed_snapshot:snapshots.find(s=>s.clientId===c.id&&s.igUserId===account?.ig_user_id&&s.period===period)};
      });
      let format_counts=instagramFeedGroupCounts(inputs,period,{now});
      // Explicit owner attribution (e.g. Estudiantil) is not replaced by the
      // total content on a profile. Never guess overlap in a shared feed.
      const manual=group.cuentas.length===1?manualObservations.find(s=>s.clientId===group.cuentas[0].id&&s.period===period)?.agencyAttribution:null;
      if(group.cuentas.length>1&&manualObservations.some(s=>s.period===period&&s.agencyAttribution&&group.cuentas.some(c=>c.id===s.clientId)))format_counts={status:'unavailable',reason:'owner_group_ambiguous',reels:null,carruseles:null,checkedAt:null};
      if(manual&&Date.parse(manual.confirmedAt)<=+now)format_counts={status:'owner_record',source:'owner_confirmation',reels:manual.reels,carruseles:manual.carruseles,checkedAt:manual.confirmedAt};
      const correction=monthlyAdjustments.map(value=>monthlyAdjustment(value,{key:group.clave,period,memberIds:group.cuentas.map(c=>c.id)})).find(Boolean);
      if(correction?.mode==='manual'&&Date.parse(correction.checkedAt)<=+now)format_counts={status:'owner_record',source:'owner_correction',reels:correction.reels,carruseles:correction.carruseles,checkedAt:correction.checkedAt};
      const effective=effectiveQuotas?.find(q=>q.clave===group.clave);
      const cupo=effectiveQuotas===undefined?group.cupo:effective?{reels:effective.reels,carruseles:effective.carruseles}:null;
      const fulfillment=formatFulfillment(format_counts,cupo);
      return { ...group,cupo,actual, anterior,format_counts,fulfillment,
        objetivo_desactualizado:Boolean(group.cupo&&cupo&&(group.cupo.reels!==cupo.reels||group.cupo.carruseles!==cupo.carruseles)),
        cumplimiento: fulfillment.porcentaje,
        crecimiento_seguidores: group.seguidores !== null && group.seguidores_inicio !== null ? group.seguidores - group.seguidores_inicio : null };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const total = clientes.reduce((acc, c) => {
    for (const key of Object.keys(acc)) acc[key] += c.actual[key];
    return acc;
  }, emptyTotals());
  const panel = {
    periodo: period, periodo_anterior: previous,
    totales: finishTotals(total),
    clientes,
    equipo: [...team.values()].map(entry => ({ ...entry, totales: finishTotals(entry.totales) }))
      .sort((a, b) => b.totales.piezas - a.totales.piezas || a.nombre.localeCompare(b.nombre, 'es')),
    cuentas_sin_cliente: accounts.filter(a => a.activa && !a.cliente_id).length,
    ultima_sincronizacion: accounts.reduce((last, a) => (a.sincronizada_at && (!last || a.sincronizada_at > last) ? a.sincronizada_at : last), null),
  };
  const currentCounts=clientes.filter(c=>feedCountsAreTrusted(c.format_counts.status));
  panel.format_totals={reels:currentCounts.reduce((n,c)=>n+(c.format_counts.reels??0),0),
    carruseles:currentCounts.reduce((n,c)=>n+(c.format_counts.carruseles??0),0),
    current:currentCounts.length,total:clientes.length};
  panel.alertas = computeAlerts(panel, { now });
  return panel;
}

// ---------- Lectura SQL ----------

const CLIENTS_SQL = `SELECT c.id, c.nombre, g.nombre AS grupo_nombre, branding.detalles->>'logo' AS logo,
    CASE WHEN c.grupo_feed_id IS NULL THEN 'cliente-'||c.id ELSE 'grupo-'||c.grupo_feed_id END AS clave
  FROM clientes c LEFT JOIN grupos_feed g ON g.id=c.grupo_feed_id
  LEFT JOIN LATERAL (
    SELECT ia.detalles FROM integracion_auditoria ia
    WHERE ia.integracion='client_branding' AND ia.canal='web'
      AND ia.accion='logo_updated' AND ia.resultado='ok' AND ia.detalles->>'clientId'=c.id::text
    ORDER BY ia.created_at DESC,ia.id DESC LIMIT 1
  ) branding ON TRUE
  WHERE COALESCE(c.activo,TRUE) OR EXISTS (SELECT 1 FROM instagram_cuentas a WHERE a.cliente_id=c.id)
  ORDER BY c.nombre`;

const MEDIA_SQL = `SELECT m.ig_media_id, m.ig_user_id, m.cliente_id, m.tipo, m.permalink, m.caption, m.publicado_at,
    to_char(m.publicado_at AT TIME ZONE '${TIME_ZONE}','YYYY-MM') AS periodo,
    m.vinculo, m.publicacion_id, u.medido_at, u.alcance, u.vistas, u.likes, u.comentarios, u.guardados, u.compartidos, u.interacciones,
    op.responsables AS responsables_objetivo, p."responsable_diseño" AS responsable_diseno, p."responsable_edición" AS responsable_edicion,
    p.idea AS pieza_idea, p.fecha_programada::text AS pieza_fecha
  FROM instagram_media m
  LEFT JOIN LATERAL (SELECT * FROM instagram_media_metricas x WHERE x.ig_media_id=m.ig_media_id
    ORDER BY x.medido_at DESC LIMIT 1) u ON TRUE
  LEFT JOIN publicaciones p ON p.id=m.publicacion_id
  LEFT JOIN cliente_objetivo_piezas op ON op.publicacion_id=m.publicacion_id
  WHERE m.publicado_at >= ($1::date::timestamp AT TIME ZONE '${TIME_ZONE}')
    AND m.publicado_at < ((($2::date + interval '1 month')::date)::timestamp AT TIME ZONE '${TIME_ZONE}')`;

const FOLLOWERS_SQL = `SELECT a.ig_user_id, 'actual' AS tipo,
    (SELECT s.seguidores FROM instagram_cuenta_seguidores s WHERE s.ig_user_id=a.ig_user_id
      AND s.fecha < ($1::date + interval '1 month') ORDER BY s.fecha DESC LIMIT 1) AS seguidores
  FROM instagram_cuentas a WHERE a.cliente_id IS NOT NULL
  UNION ALL
  SELECT a.ig_user_id, 'inicio', COALESCE(
    (SELECT s.seguidores FROM instagram_cuenta_seguidores s WHERE s.ig_user_id=a.ig_user_id
      AND s.fecha < $1::date ORDER BY s.fecha DESC LIMIT 1),
    (SELECT s.seguidores FROM instagram_cuenta_seguidores s WHERE s.ig_user_id=a.ig_user_id
      AND s.fecha >= $1::date AND s.fecha < ($1::date + interval '1 month') ORDER BY s.fecha LIMIT 1))
  FROM instagram_cuentas a WHERE a.cliente_id IS NOT NULL`;

// Base de comparación: alcance de reels/carruseles medidos en los 3 meses previos.
const BASELINE_SQL = `SELECT m.ig_user_id, count(u.alcance)::int AS medidas, COALESCE(sum(u.alcance),0)::bigint AS alcance
  FROM instagram_media m
  JOIN LATERAL (SELECT x.alcance FROM instagram_media_metricas x WHERE x.ig_media_id=m.ig_media_id
    ORDER BY x.medido_at DESC LIMIT 1) u ON TRUE
  WHERE m.tipo IN ('reel','carrusel')
    AND m.publicado_at >= ((($1::date - interval '3 months')::date)::timestamp AT TIME ZONE '${TIME_ZONE}')
    AND m.publicado_at < ($1::date::timestamp AT TIME ZONE '${TIME_ZONE}')
  GROUP BY m.ig_user_id`;

export async function readInstagramPanel(pool, auth, query) {
  const period = panelPeriod(query);
  return withInstagramRead(pool, auth, async db => (await readPanelFromDb(db, period)).panel);
}

async function readPanelFromDb(db, period, now = new Date()) {
  const previous = previousPeriod(period);
  const [clients, accounts, media, objectives, followers, pieces] = [
    (await db.query(CLIENTS_SQL)).rows,
    (await db.query('SELECT ig_user_id, username, cliente_id, activa, sincronizada_at FROM instagram_cuentas')).rows,
    await readViewBreakdowns(db, (await db.query(MEDIA_SQL, [`${previous}-01`, `${period}-01`])).rows),
    (await db.query(`SELECT clave, reels, carruseles FROM cliente_objetivos_mensuales WHERE periodo=$1::date`, [`${period}-01`])).rows,
    (await db.query(FOLLOWERS_SQL, [`${period}-01`])).rows,
    (await db.query(`SELECT o.clave, p.tipo, p.estado, p.responsables FROM cliente_objetivo_piezas p
      JOIN cliente_objetivos_mensuales o ON o.id=p.objetivo_id WHERE o.periodo=$1::date`, [`${period}-01`])).rows,
  ];
  const baselines = (await db.query(BASELINE_SQL, [`${period}-01`])).rows;
  const lastPosts = (await db.query(`SELECT ig_user_id, max(publicado_at) AS ultima FROM instagram_media
    WHERE tipo IN ('reel','carrusel') GROUP BY ig_user_id`)).rows;
  const snapshots=await readFeedSnapshotsFromDb(db, period);
  const manualObservations=(await db.query(`SELECT DISTINCT ON (ia.detalles->>'clientId') ia.detalles
    FROM integracion_auditoria ia WHERE ia.integracion='instagram_manual_review' AND ia.canal='web'
      AND ia.accion='monthly_publications_observed' AND ia.resultado='ok' AND ia.detalles->>'period'=$1
    ORDER BY ia.detalles->>'clientId',ia.created_at DESC,ia.id DESC`,[period])).rows
    .map(r=>validateInstagramMonthlyObservation(r.detalles,{period})).filter(Boolean);
  const effectiveQuotas=await loadGoalClients(db,period);
  const monthlyAdjustments=(await db.query(MONTHLY_ADJUSTMENTS_SQL,[period])).rows.map(r=>r.detalles);
  return { panel: buildPanel({ period, clients, accounts, media, objectives, followers, pieces, baselines, lastPosts,snapshots,manualObservations,monthlyAdjustments,effectiveQuotas,now }),
    clients, accounts, snapshots, now };
}

const FEED_SNAPSHOTS_SQL = `SELECT a.ig_user_id,a.cliente_id,s.detalles
      FROM instagram_cuentas a LEFT JOIN LATERAL (
        SELECT ia.detalles FROM integracion_auditoria ia
        WHERE ia.integracion='instagram_graph' AND ia.canal='system' AND ia.actor_id='render-worker'
          AND ia.accion='feed_snapshot_v1' AND ia.resultado='ok'
          AND ia.detalles->>'igUserId'=a.ig_user_id AND ia.detalles->>'clientId'=a.cliente_id::text
          AND ia.detalles->>'period'=$1 ORDER BY ia.created_at DESC,ia.id DESC LIMIT 1
      ) s ON TRUE WHERE a.cliente_id IS NOT NULL`;

async function readFeedSnapshotsFromDb(db, period) {
  return (await db.query(FEED_SNAPSHOTS_SQL,[period])).rows
      .map(r=>validateFeedCountSnapshot(r.detalles,{igUserId:r.ig_user_id,clientId:r.cliente_id,period})).filter(Boolean);
}

// A single client's report does not need the whole team's assignments, alert
// baselines or every client's media. Bundle independent reads into one database
// round trip, on the SAME authorized read-only snapshot (no shared data cache).
const COVER_ROWS_SQL = `SELECT a.ig_user_id,a.cliente_id,c.detalles AS cover_details
    FROM instagram_cuentas a LEFT JOIN LATERAL (
      SELECT ia.detalles FROM integracion_auditoria ia
      WHERE ia.integracion='instagram_graph' AND ia.canal='system' AND ia.actor_id='render-worker'
        AND ia.accion=$2 AND ia.resultado='ok' AND ia.detalles->>'clientId'=a.cliente_id::text
        AND ia.detalles->>'igUserId'=a.ig_user_id ORDER BY ia.created_at DESC,ia.id DESC LIMIT 1
    ) c ON TRUE WHERE a.cliente_id=ANY($1::int[])`;
const REPORT_INPUTS_SQL = `WITH ig_report_clients AS (
    SELECT * FROM (${CLIENTS_SQL}) c WHERE c.clave=$3
  ), ig_report_accounts AS (
    SELECT ig_user_id,username,cliente_id,activa,sincronizada_at FROM instagram_cuentas
    WHERE cliente_id IN (SELECT id FROM ig_report_clients)
  ), ig_report_media AS (
    ${MEDIA_SQL} AND m.cliente_id IN (SELECT id FROM ig_report_clients)
  ), ig_report_followers AS (${FOLLOWERS_SQL.replaceAll('$1', '$2')}),
  ig_report_snapshots AS (${FEED_SNAPSHOTS_SQL.replaceAll('$1', '$4')})
  SELECT
    (SELECT COALESCE(jsonb_agg(to_jsonb(c)),'[]'::jsonb) FROM ig_report_clients c) AS clients,
    (SELECT COALESCE(jsonb_agg(to_jsonb(a)),'[]'::jsonb) FROM ig_report_accounts a) AS accounts,
    (SELECT COALESCE(jsonb_agg(adj.detalles),'[]'::jsonb) FROM (${MONTHLY_ADJUSTMENTS_SQL.replaceAll('$1','$4')}) adj WHERE adj.detalles->>'key'=$3) AS adjustments,
    (SELECT COALESCE(jsonb_agg(to_jsonb(cv)),'[]'::jsonb) FROM
      (${COVER_ROWS_SQL.replace('=ANY($1::int[])',' IN (SELECT id FROM ig_report_clients)').replaceAll('$2','$5')}) cv) AS covers,
    (SELECT COALESCE(jsonb_agg(to_jsonb(m)),'[]'::jsonb) FROM ig_report_media m) AS media,
    (SELECT COALESCE(jsonb_agg(to_jsonb(f)),'[]'::jsonb) FROM ig_report_followers f
      WHERE f.ig_user_id IN (SELECT ig_user_id FROM ig_report_accounts)) AS followers,
    (SELECT COALESCE(jsonb_agg(to_jsonb(s)),'[]'::jsonb) FROM ig_report_snapshots s
      WHERE s.cliente_id IN (SELECT id FROM ig_report_clients)) AS snapshots,
    (SELECT COALESCE(jsonb_agg(to_jsonb(o)),'[]'::jsonb) FROM
      (SELECT clave,reels,carruseles FROM cliente_objetivos_mensuales WHERE periodo=$2::date AND clave=$3) o) AS objectives,
    (SELECT COALESCE(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM (
      SELECT DISTINCT ON (ia.detalles->>'clientId') ia.detalles FROM integracion_auditoria ia
      WHERE ia.integracion='instagram_manual_review' AND ia.canal='web'
        AND ia.accion='monthly_publications_observed' AND ia.resultado='ok'
        AND ia.detalles->>'period'=$4 AND ia.detalles->>'clientId' IN (SELECT id::text FROM ig_report_clients)
      ORDER BY ia.detalles->>'clientId',ia.created_at DESC,ia.id DESC
    ) r) AS manual`;

async function readReportPanelFromDb(db, key, period, now = new Date()) {
  const inputs = (await db.query(REPORT_INPUTS_SQL, [`${previousPeriod(period)}-01`, `${period}-01`, key, period, MEDIA_COVERS_ACTION])).rows[0];
  const clients = inputs.clients.filter(c => c.clave === key);
  if (!clients.length) throw fail(404, 'No hay datos de este cliente para el mes.');
  const accounts = inputs.accounts.filter(a => clients.some(c => c.id === a.cliente_id));
  const snapshots = inputs.snapshots.map(r => validateFeedCountSnapshot(r.detalles,
    { igUserId: r.ig_user_id, clientId: r.cliente_id, period })).filter(Boolean);
  const manualObservations = inputs.manual.map(r => validateInstagramMonthlyObservation(r.detalles, { period })).filter(Boolean);
  const effectiveQuotas = await loadGoalClients(db, period);
  const enriched = await readViewBreakdowns(db, inputs.media);
  const panel = buildPanel({ period, clients, accounts, media: enriched, objectives: inputs.objectives,
    followers: inputs.followers, pieces: [], snapshots, manualObservations,monthlyAdjustments:inputs.adjustments??[], effectiveQuotas, now });
  return { panel, clients, accounts, snapshots, now, coverRows:inputs.covers,
    reportMedia:enriched.filter(row=>row.periodo===period).map(row=>({...row,
      publicado_at:new Date(row.publicado_at),medido_at:row.medido_at?new Date(row.medido_at):null}))
      .sort((a,b)=>+b.publicado_at-+a.publicado_at) };
}

function clientKey(value) {
  if (typeof value !== 'string' || !/^(cliente|grupo)-[1-9]\d{0,9}$/.test(value)) throw fail(400, 'Cliente inválido.');
  return value;
}

export async function readInstagramClientPieces(pool, auth, clave, query) {
  const key = clientKey(clave);
  const period = panelPeriod(query);
  return withLeaderRead(pool, auth, db => readClientPiecesFromDb(db, key, period));
}

async function readClientPiecesFromDb(db, key, period, evidence, includeCandidates = true) {
  const clients = (evidence?.clients ?? (await db.query(CLIENTS_SQL)).rows).filter(c => c.clave === key);
  if (!clients.length) throw fail(404, 'Cliente no encontrado.');
  const ids = clients.map(c => c.id);
  const observed = evidence?.reportMedia ?? (await db.query(`${MEDIA_SQL} AND m.cliente_id = ANY($3::int[]) ORDER BY m.publicado_at DESC`,
    [`${period}-01`, `${period}-01`, ids])).rows;
  const accounts = evidence?.accounts ?? (await db.query('SELECT ig_user_id, username, cliente_id, activa, sincronizada_at FROM instagram_cuentas')).rows;
  const snapshots = evidence?.snapshots ?? await readFeedSnapshotsFromDb(db, period);
  const now = evidence?.now ?? new Date();
  const inputs = clients.map(c => {
    const account = accounts.find(a => a.cliente_id === c.id);
    return { id: c.id, instagram_account_id: account?.ig_user_id, instagram_account_active: account?.activa,
      instagram_feed_snapshot: snapshots.find(s => s.clientId === c.id && s.igUserId === account?.ig_user_id && s.period === period) };
  });
  const counts = instagramFeedGroupCounts(inputs, period, { now });
  const coverRows = evidence?.coverRows ?? (await db.query(COVER_ROWS_SQL, [ids, MEDIA_COVERS_ACTION])).rows;
  const covers = new Map();
  for (const row of coverRows) {
    if (!ids.includes(row.cliente_id) || !accounts.some(a => a.ig_user_id === row.ig_user_id && a.cliente_id === row.cliente_id)) continue;
    const cache = normalizeCoverSnapshot(row.cover_details, { clientId: row.cliente_id, igUserId: row.ig_user_id, now });
    for (const item of cache?.items ?? []) {
      if (+now - Date.parse(item.checkedAt) <= COVER_MAX_AGE_MS)
        covers.set(`${row.cliente_id}:${row.ig_user_id}:${item.id}:${item.kind}`, item.url);
    }
  }
  const selected = selectReportMedia(observed.filter(row => row.periodo === period),
    { clientIds: ids, accounts, snapshots, now });
  const media = evidence?.reportMedia ? selected : await readViewBreakdowns(db, selected);
  const candidates = includeCandidates ? (await db.query(`SELECT p.id, p.cliente_id, p.tipo, p.fecha_programada::text AS fecha, p.idea, p.estado
    FROM publicaciones p WHERE p.cliente_id = ANY($1::int[])
      AND p.fecha_programada >= $2::date AND p.fecha_programada < ($2::date + interval '1 month')
      AND p.tipo IN ('reel','video','carrusel','flyer') AND p.estado<>'bloqueada'
      AND NOT EXISTS (SELECT 1 FROM instagram_media x WHERE x.publicacion_id=p.id)
    ORDER BY p.fecha_programada, p.id`, [ids, `${period}-01`])).rows : [];
  return {
    clave: key, nombre: clients[0].grupo_nombre || clients[0].nombre, periodo: period,
    coverage: { status: counts.status, source: 'profile_observations',
      complete: feedCountsAreTrusted(counts.status), checkedAt: counts.checkedAt },
    piezas: media.map(row => ({
      ig_media_id: row.ig_media_id, tipo: row.tipo, permalink: row.permalink, caption: row.caption.slice(0, 2200),
      portada_url: covers.get(`${row.cliente_id}:${row.ig_user_id}:${row.ig_media_id}:${row.tipo}`) ?? null,
      publicado_at: row.publicado_at, vinculo: row.vinculo, publicacion_id: row.publicacion_id,
      pieza: row.publicacion_id ? { idea: row.pieza_idea, fecha: row.pieza_fecha } : null,
      responsables: responsablesDe(row), medido_at: row.medido_at,
      metricas: { alcance: num(row.alcance), vistas: num(row.vistas),
        vistas_instagram: num(row.vistas_instagram), vistas_facebook: num(row.vistas_facebook), vistas_total: num(row.vistas_total), likes: num(row.likes), comentarios: num(row.comentarios),
        guardados: num(row.guardados), compartidos: num(row.compartidos), interacciones: interactions(row) },
    })),
    candidatas: candidates,
  };
}

export async function readInstagramAccounts(pool, auth) {
  return withLeaderRead(pool, auth, async db => ({
    cuentas: (await db.query(`SELECT a.ig_user_id, a.username, a.activa, a.cliente_id, a.sincronizada_at,
        (SELECT s.seguidores FROM instagram_cuenta_seguidores s WHERE s.ig_user_id=a.ig_user_id ORDER BY s.fecha DESC LIMIT 1) AS seguidores
      FROM instagram_cuentas a ORDER BY a.activa DESC, a.username`)).rows,
    clientes: (await db.query(`SELECT id, nombre FROM clientes WHERE COALESCE(activo,TRUE) ORDER BY nombre`)).rows,
  }));
}

function exactBody(body, key) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, key))
    throw fail(400, 'Datos inválidos.');
  const value = body[key];
  if (value !== null && !(Number.isSafeInteger(value) && value > 0 && value <= 2147483647)) throw fail(400, 'Datos inválidos.');
  return value;
}

export async function writeInstagramAccountLink(pool, auth, igUserId, body) {
  const clienteId = exactBody(body, 'cliente_id');
  return withLeaderWrite(pool, auth, db => linkInstagramAccountInTransaction(db, igUserId, clienteId));
}

// Vínculo manual post↔pieza. null devuelve el post a 'pendiente' para que la
// próxima sincronización lo recalcule.
export async function writeInstagramMediaLink(pool, auth, igMediaId, body) {
  if (typeof igMediaId !== 'string' || !/^\d{1,40}$/.test(igMediaId)) throw fail(400, 'Publicación inválida.');
  const publicacionId = exactBody(body, 'publicacion_id');
  return withLeaderWrite(pool, auth, async db => {
    const media = (await db.query(`SELECT m.cliente_id, m.tipo FROM instagram_media m WHERE m.ig_media_id=$1 FOR UPDATE`, [igMediaId])).rows[0];
    if (!media) throw fail(404, 'Publicación no encontrada.');
    if (publicacionId === null) {
      await db.query(`UPDATE instagram_media SET publicacion_id=NULL, vinculo='pendiente', actualizada_at=clock_timestamp()
        WHERE ig_media_id=$1`, [igMediaId]);
      return { vinculo: 'pendiente', publicacion_id: null };
    }
    const piece = (await db.query(`SELECT p.id FROM publicaciones p JOIN clientes c ON c.id=p.cliente_id
      JOIN clientes mc ON mc.id=$2
      WHERE p.id=$1 AND (c.id=mc.id OR (mc.grupo_feed_id IS NOT NULL AND c.grupo_feed_id=mc.grupo_feed_id))`,
    [publicacionId, media.cliente_id])).rows[0];
    if (!piece) throw fail(404, 'La pieza no pertenece a este cliente.');
    const taken = (await db.query('SELECT 1 FROM instagram_media WHERE publicacion_id=$1 AND ig_media_id<>$2', [publicacionId, igMediaId])).rows;
    if (taken.length) throw fail(409, 'Esa pieza ya está vinculada a otra publicación.');
    await db.query(`UPDATE instagram_media SET publicacion_id=$2, vinculo='manual', actualizada_at=clock_timestamp()
      WHERE ig_media_id=$1`, [igMediaId, publicacionId]);
    return { vinculo: 'manual', publicacion_id: publicacionId };
  });
}

export async function readInstagramReports(pool, auth) {
  return withInstagramRead(pool, auth, async db => ({
    reportes: (await db.query(`SELECT id, tipo, desde::text, hasta::text, estado, generado_at FROM instagram_reportes
      ORDER BY desde DESC LIMIT 26`)).rows.map(r => ({ ...r, id: Number(r.id) })),
  }));
}

export async function readInstagramReport(pool, auth, id) {
  if (typeof id !== 'string' || !/^[1-9]\d{0,15}$/.test(id)) throw fail(400, 'Reporte inválido.');
  return withInstagramRead(pool, auth, async db => {
    const row = (await db.query(`SELECT id, tipo, desde::text, hasta::text, estado, generado_at, hechos, conclusiones, modelo
      FROM instagram_reportes WHERE id=$1`, [id])).rows[0];
    if (!row) throw fail(404, 'Reporte no encontrado.');
    return { ...row, id: Number(row.id) };
  });
}

// Reporte mensual para enviar al cliente: solo datos de ese cliente.
export async function readInstagramClientReport(pool, auth, clave, query) {
  const key = clientKey(clave);
  const period = panelPeriod(query);
  return withInstagramRead(pool, auth, async db => {
    const evidence = await readReportPanelFromDb(db, key, period);
    const { panel } = evidence;
    const client = panel.clientes.find(c => c.clave === key);
    if (!client) throw fail(404, 'No hay datos de este cliente para el mes.');
    const detail = await readClientPiecesFromDb(db, key, period, evidence, false);
    const format_counts = publicFormatCounts(client.format_counts);
    const measured = detail.piezas.filter(p => p.metricas.alcance !== null);
    const byType = tipo => {
      const rows = measured.filter(p => p.tipo === tipo);
      return { piezas: rows.length, alcance_promedio: rows.length ? Math.round(rows.reduce((a, p) => a + p.metricas.alcance, 0) / rows.length) : null };
    };
    return {
      clave: key, cliente: client.nombre, periodo: panel.periodo, periodo_anterior: panel.periodo_anterior,
      cuentas: client.instagram.map(a => a.username),
      ...(client.logo ? { logo: client.logo } : {}),
      format_counts, fulfillment: formatFulfillment(format_counts, client.cupo),
      dataFecha: format_counts.checkedAt,
      coverage: { status: detail.coverage.status, source: detail.coverage.source,
        complete: detail.coverage.complete, checkedAt: detail.coverage.checkedAt,
        render_count_known: format_counts.status === 'owner_record' },
      actual: client.actual, anterior: client.anterior, cupo: client.cupo,
      seguidores: client.seguidores, crecimiento_seguidores: client.crecimiento_seguidores,
      formatos: { reel: byType('reel'), carrusel: byType('carrusel') },
      destacadas: [...measured].sort((a, b) => b.metricas.alcance - a.metricas.alcance).slice(0, 3)
        .map(p => publicReportPiece(p)),
      piezas: detail.piezas.map(p => publicReportPiece(p)),
    };
  });
}

// Explicit allowlists: adding fields to the leader's panel/detail must never
// widen this report shared with the authenticated team.
function publicFormatCounts(counts) {
  return { status: counts.status, reels: counts.reels, carruseles: counts.carruseles, checkedAt: counts.checkedAt,
    ...(counts.source ? { source: counts.source } : {}), ...(counts.reason ? { reason: counts.reason } : {}) };
}

function publicReportPiece(piece) {
  const m = piece.metricas;
  return { tipo: piece.tipo, permalink: piece.permalink, publicado_at: piece.publicado_at, medido_at: piece.medido_at,
    caption: piece.caption, portada_url: normalizeCoverUrl(piece.portada_url),
    metricas: { alcance: m.alcance, vistas: m.vistas,
      vistas_instagram: m.vistas_instagram, vistas_facebook: m.vistas_facebook, vistas_total: m.vistas_total, likes: m.likes, comentarios: m.comentarios,
      guardados: m.guardados, compartidos: m.compartidos, interacciones: m.interacciones } };
}

// Estadísticas (equipo autenticado, solo lectura). Mismas reglas de acceso que el reporte.
export async function readInstagramClientStats(pool, auth, clave, query) {
  const key = clientKey(clave);
  const period = panelPeriod(query);
  return withInstagramRead(pool, auth, async db => {
    const clients = (await db.query(CLIENTS_SQL)).rows.filter(c => c.clave === key);
    if (!clients.length) throw fail(404, 'Cliente no encontrado.');
    const ids = clients.map(c => c.id);
    const accounts = (await db.query('SELECT ig_user_id, username, cliente_id FROM instagram_cuentas WHERE cliente_id = ANY($1::int[]) ORDER BY username', [ids])).rows;
    const head = { clave: key, nombre: clients[0].grupo_nombre || clients[0].nombre, cuentas: accounts.map(a => a.username) };
    if (!accounts.length) return { ...head, periodo: period, sin_cuenta: true };
    const detail = await readClientPiecesFromDb(db, key, period, undefined, false);
    const covers = new Map(detail.piezas.filter(p => p.portada_url).map(p => [p.ig_media_id, normalizeCoverUrl(p.portada_url)]));
    const accountIds = accounts.map(a => a.ig_user_id), now = new Date();
    return { ...head, ...(await readClientStatsFromDb(db, { accountIds, period, covers,
      selectMedia: async rows => {
        const periods = [...new Set(rows.map(row => row.periodo))];
        const snapshots = await readReportMembershipSnapshots(db, accountIds, periods);
        return selectReportMedia(rows, { clientIds: ids, accounts, snapshots, now });
      },
    })) };
  });
}

export async function readInstagramMediaStats(pool, auth, igMediaId) {
  if (typeof igMediaId !== 'string' || !/^[1-9]\d{0,39}$/.test(igMediaId)) throw fail(400, 'Publicación inválida.');
  return withInstagramRead(pool, auth, async db => {
    const stats = await readMediaStatsFromDb(db, igMediaId);
    if (!stats) throw fail(404, 'Publicación no encontrada.');
    const { ig_user_id, cliente_id, ...rest } = stats;
    return rest;
  });
}

export async function readInstagramConnectionState(pool,auth,options){
  return withLeaderRead(pool,auth,()=>inspectMetaConnection(options?.env??process.env,options));
}

export function createInstagramPanelRouter({ express, pool }) {
  const router = express.Router();
  const handle = run => async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try { return res.json(await run(req)); }
    catch (error) {
      if ([400, 401, 403, 404, 409].includes(error.status))
        return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
      return next(error);
    }
  };
  router.get('/panel', handle(req => readInstagramPanel(pool, req.auth, req.query)));
  router.get('/conexion/estado',handle(req=>{
    if(Object.keys(req.query).length)throw fail(400,'Datos inválidos.');
    return readInstagramConnectionState(pool,req.auth);
  }));
  router.get('/equipo',handle(req=>readTeamStatistics(pool,req.auth,req.query.periodo)));
  router.get('/clientes/:clave/piezas', handle(req => readInstagramClientPieces(pool, req.auth, req.params.clave, req.query)));
  router.get('/cuentas', handle(req => { if (Object.keys(req.query).length) throw fail(400, 'Datos inválidos.'); return readInstagramAccounts(pool, req.auth); }));
  router.put('/cuentas/:igUserId', handle(req => writeInstagramAccountLink(pool, req.auth, req.params.igUserId, req.body)));
  router.get('/reportes', handle(req => { if (Object.keys(req.query).length) throw fail(400, 'Datos inválidos.'); return readInstagramReports(pool, req.auth); }));
  router.get('/reportes/:id', handle(req => readInstagramReport(pool, req.auth, req.params.id)));
  router.get('/clientes/:clave/estadisticas', handle(req => readInstagramClientStats(pool, req.auth, req.params.clave, req.query)));
  router.get('/media/:igMediaId/estadisticas', handle(req => readInstagramMediaStats(pool, req.auth, req.params.igMediaId)));
  router.get('/clientes/:clave/reporte', handle(req => readInstagramClientReport(pool, req.auth, req.params.clave, req.query)));
  router.put('/media/:igMediaId/vinculo', handle(req => writeInstagramMediaLink(pool, req.auth, req.params.igMediaId, req.body)));
  return router;
}
