import { validateFeedCountSnapshot } from '../../shared/instagram-feed-counts.mjs';

// One membership rule for report galleries and statistics. Retained observations
// are not necessarily still in a later, complete observation of the profile.
export function selectReportMedia(rows, { clientIds, accounts, snapshots, now = new Date() }) {
  const ids = new Set(clientIds);
  const boundAccounts = new Set(accounts.filter(a => ids.has(a.cliente_id)).map(a => `${a.cliente_id}:${a.ig_user_id}`));
  const proofs = new Map();
  for (const value of snapshots) {
    const proof = validateFeedCountSnapshot(value);
    if (!proof || !boundAccounts.has(`${proof.clientId}:${proof.igUserId}`)) continue;
    proofs.set(`${proof.clientId}:${proof.igUserId}:${proof.period}`, {
      checkedAt: Date.parse(proof.checkedAt),
      posts: new Map(proof.posts.map(post => [post.id, post])),
    });
  }
  const seen = new Set();
  return rows.filter(row => {
    const account = `${row.cliente_id}:${row.ig_user_id}`;
    if (!ids.has(row.cliente_id) || !boundAccounts.has(account)) return false;
    const proof = proofs.get(`${account}:${row.periodo}`);
    if (proof && proof.checkedAt <= +now && +new Date(row.publicado_at) <= proof.checkedAt) {
      const post = proof.posts.get(row.ig_media_id);
      if (!post || post.kind !== row.tipo || Date.parse(post.publishedAt) !== +new Date(row.publicado_at)) return false;
    }
    if (seen.has(row.ig_media_id)) return false;
    seen.add(row.ig_media_id);
    return true;
  });
}

// Batch all months needed by the comparison window, never one query per video.
export async function readReportMembershipSnapshots(db, accountIds, periods) {
  if (!periods.length) return [];
  const { rows } = await db.query(`SELECT DISTINCT ON (a.ig_user_id, ia.detalles->>'period')
      a.ig_user_id, a.cliente_id, ia.detalles
    FROM instagram_cuentas a JOIN integracion_auditoria ia
      ON ia.detalles->>'igUserId'=a.ig_user_id AND ia.detalles->>'clientId'=a.cliente_id::text
    WHERE a.ig_user_id=ANY($1::text[]) AND ia.integracion='instagram_graph'
      AND ia.canal='system' AND ia.actor_id='render-worker' AND ia.accion='feed_snapshot_v1'
      AND ia.resultado='ok' AND ia.detalles->>'period'=ANY($2::text[])
    ORDER BY a.ig_user_id, ia.detalles->>'period', ia.created_at DESC, ia.id DESC`, [accountIds, periods]);
  return rows.map(row => validateFeedCountSnapshot(row.detalles,
    { clientId: row.cliente_id, igUserId: row.ig_user_id })).filter(Boolean);
}
