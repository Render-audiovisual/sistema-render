import { createHash } from 'node:crypto';

export const GOAL_QUOTA_SOURCE = Symbol('goal quota source');
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ids = accounts => (accounts || []).map(account => account.id).sort((a,b) => a-b);

export function assertQuotaRevision(value) {
  if (typeof value !== 'string' || value.length !== 64 || !/^[a-f0-9]{64}$/.test(value)) {
    throw fail('La observación de cuotas no es válida.', 400);
  }
}

export function goalQuotaObservation(client, objective, pieces = [], period) {
  if (objective) for (const piece of pieces) goalPieceInQuota(piece, objective);
  const current = client ? { reels: client.reels, carruseles: client.carruseles } : null;
  const membershipMatches = Boolean(client && objective && JSON.stringify(ids(client.cuentas)) === JSON.stringify(ids(objective.cuentas)));
  const sourceFingerprint = digest([period, client?.clave ?? objective?.clave, current,
    ids(client?.cuentas), [...(client?.[GOAL_QUOTA_SOURCE] ?? [])].sort((a,b) => a[0]-b[0])]);
  const revision = digest(['goal-quota-v1', sourceFingerprint,
    objective ? [objective.id, objective.reels, objective.carruseles, ids(objective.cuentas)] : null,
    [...pieces].sort((a,b) => a.id-b.id).map(piece => [piece.id,piece.tipo,piece.numero,
      piece.tarea_id ?? null,piece.publicacion_id ?? null,piece.quota_piece_version ?? piece.updated_at ?? null,piece.tarea_revision ?? null,
      piece.estado ?? null,piece.completada_at ?? null])]);
  return { current, membershipMatches, sourceFingerprint, revision,
    drift: Boolean(objective && (!membershipMatches || objective.reels !== current?.reels || objective.carruseles !== current?.carruseles)) };
}

export function goalPieceInQuota(piece, objective) {
  if (!Number.isSafeInteger(piece?.numero) || piece.numero < 1 || !['video','carrusel'].includes(piece.tipo)) {
    throw fail('No se pudo verificar la numeración de una pieza.');
  }
  return piece.numero <= (piece.tipo === 'video' ? objective.reels : objective.carruseles);
}

export async function lockGoalQuotaReviewer(db, auth) {
  if (!Number.isSafeInteger(auth?.id) || auth.id <= 0 || !Number.isSafeInteger(auth?.session_version) || auth.session_version < 1) {
    throw fail('Sesión requerida.', 401);
  }
  const id = auth.id, epoch = auth.session_version;
  const actor = (await db.query('SELECT id,rol,activo,session_version FROM usuarios WHERE id=$1 FOR SHARE', [id])).rows[0];
  if (!actor || actor.id !== id || actor.activo !== true || actor.session_version !== epoch) throw fail('La sesión ya no está activa.', 401);
  if (actor.rol !== 'admin') throw fail('Solo administración puede reconciliar cuotas.', 403);
  return actor;
}

export async function reviewGoalQuota(db, { client, objective, pieces, period, expected, actorId }) {
  assertQuotaRevision(expected);
  if (!objective) throw fail('Prepará el objetivo antes de reconciliar sus cuotas.');
  const observation = goalQuotaObservation(client, objective, pieces, period);
  if (!observation.membershipMatches) throw fail('Las cuentas del objetivo cambiaron. Requieren revisión específica.');
  if (observation.revision !== expected) throw fail('Las cuotas o piezas cambiaron. Recargá antes de confirmar.');
  if (!observation.drift) return objective;
  await db.query('UPDATE cliente_objetivos_mensuales SET reels=$2,carruseles=$3 WHERE id=$1',
    [objective.id, client.reels, client.carruseles]);
  await db.query(`INSERT INTO cliente_objetivo_cuota_revisiones
    (objetivo_id,actor_user_id,reels_antes,carruseles_antes,reels_despues,carruseles_despues,source_fingerprint)
    VALUES($1,$2,$3,$4,$5,$6,$7)`, [objective.id,actorId,objective.reels,objective.carruseles,
    client.reels,client.carruseles,observation.sourceFingerprint]);
  return { ...objective, reels: client.reels, carruseles: client.carruseles };
}
