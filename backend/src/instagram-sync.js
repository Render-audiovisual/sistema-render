import { createGraphClient, resolveGraphConfig, GraphError } from './instagram-graph.js';
import { buildFeedCountSnapshots, FEED_SNAPSHOT_ACTION } from '../../shared/instagram-feed-counts.mjs';

// Sincronización programada de Instagram (job 'instagram' del ejecutor).
// Lee de Meta fuera de transacciones y escribe en instagram_* y su auditoría,
// una transacción por cuenta. No toca publicaciones, tareas ni objetivos.

const HOUR = 3600000, DAY = 24 * HOUR;
export const SYNC_WINDOW_DAYS = 35;
export const BACKFILL_DAYS = 90;
const TIME_ZONE = 'America/Argentina/Cordoba';

// Cada cuánto se vuelve a medir una pieza según su antigüedad.
export function metricsRefreshInterval(age) {
  if (age < 2 * DAY) return HOUR;
  if (age < 7 * DAY) return 6 * HOUR;
  if (age < SYNC_WINDOW_DAYS * DAY) return DAY;
  return null;
}

export function needsMetrics({ publishedAt, lastMeasuredAt }, now) {
  if (!lastMeasuredAt) return true;
  const interval = metricsRefreshInterval(now - publishedAt);
  return interval !== null && now - lastMeasuredAt >= interval - 5 * 60000;
}

export function cordobaDate(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const auditSQL = `INSERT INTO integracion_auditoria
  (integracion,canal,actor_id,actor_nombre,accion,resultado,detalles)
  VALUES('instagram_graph','system','render-worker','Render · Instagram',$1,$2,$3::jsonb)`;

async function withTransaction(pool, work) {
  const db = await pool.connect();
  let discard;
  try {
    await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (rollback) { discard = rollback; }
    throw error;
  } finally { db.release(discard); }
}

async function storeAccounts(pool, accounts, now) {
  await withTransaction(pool, async db => {
    const seen = [];
    for (const account of accounts) {
      if (!/^\d{1,32}$/.test(account.igUserId) || !/^[A-Za-z0-9_.]{1,30}$/.test(account.username)) continue;
      seen.push(account.igUserId);
      await db.query(`INSERT INTO instagram_cuentas (ig_user_id,username,page_id,activa,vista_at)
        VALUES($1,$2,$3,TRUE,$4)
        ON CONFLICT (ig_user_id) DO UPDATE SET username=EXCLUDED.username,
          page_id=COALESCE(EXCLUDED.page_id,instagram_cuentas.page_id),activa=TRUE,vista_at=EXCLUDED.vista_at`,
      [account.igUserId, account.username, account.pageId && /^\d{1,32}$/.test(account.pageId) ? account.pageId : null, now]);
      if (account.followers !== null) {
        await db.query(`INSERT INTO instagram_cuenta_seguidores (ig_user_id,fecha,seguidores,medido_at)
          VALUES($1,$2,$3,$4) ON CONFLICT (ig_user_id,fecha)
          DO UPDATE SET seguidores=EXCLUDED.seguidores,medido_at=EXCLUDED.medido_at`,
        [account.igUserId, cordobaDate(now), account.followers, now]);
      }
    }
    // Una cuenta que el token ya no ve queda inactiva; sus datos se conservan.
    // Una lista vacía no desactiva nada: puede ser un fallo transitorio de Meta.
    if (seen.length) await db.query('UPDATE instagram_cuentas SET activa=FALSE WHERE activa AND NOT (ig_user_id = ANY($1::text[]))', [seen]);
  });
}

// Vincula piezas sin vínculo confirmado con la publicación del sistema del mismo
// cliente (o grupo de feed), tipo y fecha de Córdoba. Solo un candidato único
// se vincula; varios quedan 'ambiguo' y ninguno 'sin_pieza'. 'manual' y
// 'automatico' nunca se reescriben acá.
export const matchSQL = `
WITH objetivo AS (
  SELECT m.ig_media_id, m.tipo, (m.publicado_at AT TIME ZONE '${TIME_ZONE}')::date AS fecha,
    ARRAY(SELECT c2.id FROM clientes c1 JOIN clientes c2
      ON c2.id=c1.id OR (c1.grupo_feed_id IS NOT NULL AND c2.grupo_feed_id=c1.grupo_feed_id)
      WHERE c1.id=m.cliente_id) AS clientes
  FROM instagram_media m
  WHERE m.ig_user_id=$1 AND m.cliente_id IS NOT NULL AND m.vinculo IN ('pendiente','ambiguo','sin_pieza')
), candidatos AS (
  SELECT o.ig_media_id, array_agg(p.id ORDER BY p.id) AS ids
  FROM objetivo o
  LEFT JOIN publicaciones p ON p.cliente_id = ANY(o.clientes)
    AND p.fecha_programada=o.fecha AND p.estado<>'bloqueada'
    AND ((o.tipo='reel' AND p.tipo IN ('reel','video')) OR (o.tipo='carrusel' AND p.tipo='carrusel')
      OR (o.tipo='imagen' AND p.tipo='flyer'))
    AND NOT EXISTS (SELECT 1 FROM instagram_media x WHERE x.publicacion_id=p.id)
  GROUP BY o.ig_media_id
), decision AS (
  SELECT ig_media_id, array_remove(ids,NULL) AS ids,
    COALESCE(array_length(array_remove(ids,NULL),1),0) AS n,
    COUNT(*) OVER (PARTITION BY (array_remove(ids,NULL))[1]) AS competidores
  FROM candidatos
)
UPDATE instagram_media m SET
  publicacion_id = CASE WHEN d.n=1 AND d.competidores=1 THEN d.ids[1] ELSE NULL END,
  vinculo = CASE WHEN d.n=0 THEN 'sin_pieza' WHEN d.n=1 AND d.competidores=1 THEN 'automatico' ELSE 'ambiguo' END,
  actualizada_at = clock_timestamp()
FROM decision d WHERE d.ig_media_id=m.ig_media_id`;

async function storeAccountData(pool, account, media, metrics, snapshots, now) {
  return withTransaction(pool, async db => {
    // Graph reads happen outside the transaction. A leader may have reassigned
    // the account meanwhile; never overwrite the new client's links with an
    // obsolete account snapshot.
    const current = (await db.query('SELECT cliente_id,activa FROM instagram_cuentas WHERE ig_user_id=$1 FOR UPDATE',
      [account.ig_user_id])).rows[0];
    if (!current || !current.activa || current.cliente_id !== account.cliente_id)
      throw new Error('La vinculación de Instagram cambió durante la lectura');
    // Coverage is committed atomically with this account's data, never before
    // the current assignment has been checked under its row lock.
    for (const snapshot of snapshots) {
      await db.query(auditSQL, [FEED_SNAPSHOT_ACTION, 'ok', JSON.stringify(snapshot)]);
    }
    for (const item of media) {
      await db.query(`INSERT INTO instagram_media
        (ig_media_id,ig_user_id,cliente_id,tipo,permalink,caption,publicado_at)
        VALUES($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (ig_media_id) DO UPDATE SET cliente_id=EXCLUDED.cliente_id,tipo=EXCLUDED.tipo,
          permalink=EXCLUDED.permalink,caption=EXCLUDED.caption,publicado_at=EXCLUDED.publicado_at,
          actualizada_at=clock_timestamp()
        WHERE instagram_media.ig_user_id=EXCLUDED.ig_user_id`,
      [item.igMediaId, account.ig_user_id, account.cliente_id, item.tipo, item.permalink, item.caption, item.publishedAt]);
    }
    let stored = 0;
    for (const [igMediaId, values] of metrics) {
      const result = await db.query(`INSERT INTO instagram_media_metricas
        (ig_media_id,medido_at,alcance,vistas,likes,comentarios,guardados,compartidos,interacciones)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9 WHERE EXISTS (SELECT 1 FROM instagram_media WHERE ig_media_id=$1)
        ON CONFLICT (ig_media_id,medido_at) DO NOTHING`,
      [igMediaId, now, values.alcance, values.vistas, values.likes, values.comentarios,
        values.guardados, values.compartidos, values.interacciones]);
      stored += result.rowCount;
    }
    await db.query(matchSQL, [account.ig_user_id]);
    await db.query('UPDATE instagram_cuentas SET sincronizada_at=$2 WHERE ig_user_id=$1', [account.ig_user_id, now]);
    return stored;
  });
}

async function syncAccount(pool, graph, account, now) {
  // One exact boundary for the stored inventory, Graph read and shared proof.
  // The 35-day window controls metric refresh only, never feed coverage.
  const from = new Date(now - BACKFILL_DAYS * DAY);
  const existing = (await pool.query(`SELECT m.ig_media_id, m.publicado_at,
      (SELECT max(medido_at) FROM instagram_media_metricas x WHERE x.ig_media_id=m.ig_media_id) AS ultima
    FROM instagram_media m WHERE m.ig_user_id=$1 AND m.publicado_at >= $2`,
  [account.ig_user_id, from])).rows;
  const listed = await graph.listMedia(account.ig_user_id, from, now);
  // Graph can observe posts published while its pages are being read. Keep
  // this observation as-of the captured now, including for injected adapters.
  // Malformed dates remain for the shared builder to reject, not hide.
  const media = listed.filter(item => !(item?.publishedAt instanceof Date && +item.publishedAt > +now));
  const snapshots = buildFeedCountSnapshots({ clientId: account.cliente_id,
    igUserId: account.ig_user_id, username: account.username, from, to: now, media });

  const known = new Map(existing.map(row => [row.ig_media_id, row]));
  const metrics = new Map();
  for (const item of media) {
    const prior = known.get(item.igMediaId);
    const lastMeasuredAt = prior?.ultima ? new Date(prior.ultima) : null;
    if (!needsMetrics({ publishedAt: item.publishedAt, lastMeasuredAt }, now)) continue;
    try {
      metrics.set(item.igMediaId, await graph.mediaInsights(item.igMediaId));
    } catch (error) {
      // Una pieza sin métricas (p. ej. colaboración ajena) no frena la cuenta.
      if (error instanceof GraphError && ['metric', 'permission'].includes(error.kind)) continue;
      throw error;
    }
  }
  const stored = await storeAccountData(pool, account, media, metrics, snapshots, now);
  return { media: media.length, metricas: stored };
}

export async function runInstagramSync(pool, { now = new Date(), env = process.env, graph } = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Fecha inválida');
  const client = graph ?? createGraphClient(resolveGraphConfig(env));
  await storeAccounts(pool, await client.listInstagramAccounts(), now);

  const accounts = (await pool.query(`SELECT a.ig_user_id, a.username, a.cliente_id
    FROM instagram_cuentas a JOIN clientes c ON c.id=a.cliente_id
    WHERE a.activa AND COALESCE(c.activo,TRUE) ORDER BY a.ig_user_id`)).rows;

  const summary = { version: 1, cuentas: accounts.length, ok: 0, errores: 0, media: 0, metricas: 0 };
  for (const account of accounts) {
    try {
      const result = await syncAccount(pool, client, account, now);
      summary.ok += 1; summary.media += result.media; summary.metricas += result.metricas;
    } catch (error) {
      const kind = error instanceof GraphError ? error.kind : 'interno';
      summary.errores += 1;
      // Token inválido o límite de Meta: cortar y reintentar en la próxima corrida.
      if (kind === 'auth' || kind === 'rate') {
        await pool.query(auditSQL, ['sync_detenida', 'error', JSON.stringify({ version: 1, motivo: kind })]);
        await pool.query(auditSQL, ['sync_resumen', 'parcial', JSON.stringify(summary)]);
        throw error;
      }
      await pool.query(auditSQL, ['sync_cuenta', 'error',
        JSON.stringify({ version: 1, ig_user_id: account.ig_user_id, motivo: kind })]);
    }
  }
  await pool.query(auditSQL, ['sync_resumen', summary.errores ? 'parcial' : 'ok', JSON.stringify(summary)]);
  if (accounts.length && summary.ok === 0) throw new Error('Ninguna cuenta de Instagram se pudo sincronizar');
  // A partial result must not earn the runner's hourly completion checkpoint.
  if (summary.errores) throw new Error('La sincronización de Instagram quedó parcial');
  return summary;
}
