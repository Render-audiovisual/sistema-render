import { createHash, randomUUID } from 'node:crypto';
import { driveError } from './drive-upload-authority.js';

export const driveChunkHash = bytes => createHash('sha256').update(bytes).digest('hex');
export const drivePhaseId = () => randomUUID();
const conflict = (code = 'DRIVE_UPLOAD_UNCERTAIN') => driveError(409, code);

export async function insertDriveIntent(db, session) {
  await db.query(`INSERT INTO drive_upload_intents
    (id,actor_id,session_version,task_id,name,mime_type,size,parent_id,replace_id,state,phase_id,replacement_state,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'starting',$10,$11,to_timestamp($12))`,
    [session.jti, session.actorId, session.sessionVersion, session.taskId, session.name, session.mimeType, session.size, session.parentId, session.replaceId, session.phaseId, session.replaceId ? 'pending' : 'none', session.exp]);
}
export async function lockDriveIntent(db, session) {
  const row = (await db.query('SELECT * FROM drive_upload_intents WHERE id=$1 AND expires_at>clock_timestamp() FOR UPDATE', [session.jti])).rows[0];
  if (!row || row.actor_id !== session.actorId || row.session_version !== session.sessionVersion || row.task_id !== session.taskId || row.name !== session.name || row.mime_type !== session.mimeType || Number(row.size) !== session.size || row.parent_id !== session.parentId || row.replace_id !== session.replaceId)
    throw driveError(401, 'DRIVE_SESSION_INVALID');
  return row;
}
export function driveCachedAck(row, range, hash) {
  if (row.state === 'in_flight' || row.state === 'starting' || row.state === 'uncertain') throw conflict();
  if (row.last_range === range && row.last_chunk_hash === hash && row.last_ack) {
    if (row.state === 'completed' && !['none','completed'].includes(row.replacement_state)) throw conflict('DRIVE_REPLACEMENT_UNCERTAIN');
    return { status: row.last_status, body: row.last_ack };
  }
  if (row.state === 'completed') throw conflict('DRIVE_UPLOAD_ALREADY_COMPLETED');
  return null;
}
export function parseDriveChunk(range, bytes, size) {
  if (size === 0 && bytes.length === 0 && range === 'bytes */0') return { start: 0, end: -1, final: true };
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
  if (!match || match[0] !== range) throw driveError(400, 'DRIVE_RANGE_INVALID');
  const [start,end,total] = match.slice(1).map(Number);
  if (![start,end,total].every(Number.isSafeInteger) || total !== size || start > end || end >= size || end-start+1 !== bytes.length) throw driveError(400, 'DRIVE_RANGE_INVALID');
  return { start, end, final: end === size-1 };
}
export async function claimDriveChunk(db, session, range, hash, chunk, phaseId) {
  const row = await lockDriveIntent(db, session), cached = driveCachedAck(row, range, hash);
  if (cached) return { cached };
  if (row.state !== 'ready' || Number(row.next_offset) !== chunk.start) throw conflict('DRIVE_OFFSET_CONFLICT');
  await db.query(`UPDATE drive_upload_intents SET state='in_flight',phase_id=$2,last_range=$3,last_chunk_hash=$4,updated_at=clock_timestamp() WHERE id=$1`, [session.jti, phaseId, range, hash]);
  return { claimed: true };
}
export function assertDrivePhase(row, state, phaseId) {
  if (row.state !== state || row.phase_id !== phaseId) throw conflict();
}
export function driveReceivedOffset(response, chunk, size) {
  const match = /^bytes=0-(\d+)$/.exec(response.received || '');
  if (!match || match[0] !== response.received || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) !== chunk.end || chunk.end+1 >= size) throw conflict();
  return chunk.end+1;
}
export async function saveDriveAck(db, session, { status, body, offset, phaseId }) {
  await db.query(`UPDATE drive_upload_intents SET state=$2,next_offset=$3,last_status=$4,last_ack=$5::jsonb,updated_at=clock_timestamp()
    WHERE id=$1 AND state='in_flight' AND phase_id=$6`, [session.jti, status === 200 ? 'completed' : 'ready', offset, status, JSON.stringify(body), phaseId]);
}
export async function claimDriveReplacement(db, session, phaseId) {
  const row = await lockDriveIntent(db, session);
  if (row.state !== 'completed' || row.replacement_state !== 'pending') throw conflict('DRIVE_REPLACEMENT_UNCERTAIN');
  await db.query(`UPDATE drive_upload_intents SET replacement_state='in_flight',phase_id=$2,updated_at=clock_timestamp() WHERE id=$1`, [session.jti, phaseId]);
}
export async function createDriveOAuthNonce(db, session) {
  await db.query(`INSERT INTO drive_oauth_nonces(id,actor_id,session_version,expires_at) VALUES($1,$2,$3,to_timestamp($4))`, [session.jti, session.actorId, session.sessionVersion, session.exp]);
}
export async function consumeDriveOAuthNonce(db, session, claimId) {
  const result = await db.query(`UPDATE drive_oauth_nonces SET consumed_at=clock_timestamp(),claim_id=$4
    WHERE id=$1 AND actor_id=$2 AND session_version=$3 AND purpose='google_drive' AND consumed_at IS NULL AND expires_at>clock_timestamp() RETURNING id`, [session.jti, session.actorId, session.sessionVersion, claimId]);
  if (!result.rows.length) throw conflict('DRIVE_OAUTH_STATE_CONSUMED');
}
export async function lockConsumedDriveOAuthNonce(db, session, claimId) {
  const row = (await db.query('SELECT * FROM drive_oauth_nonces WHERE id=$1 FOR UPDATE', [session.jti])).rows[0];
  if (!row || row.actor_id !== session.actorId || row.session_version !== session.sessionVersion || row.claim_id !== claimId || !row.consumed_at || row.completed_at) throw conflict('DRIVE_OAUTH_STATE_CONSUMED');
  // A WHERE predicate in the locking SELECT can be evaluated before its wait.
  // Observe the database clock in a separate statement after acquiring the row.
  const current = (await db.query('SELECT expires_at>clock_timestamp() AS unexpired FROM drive_oauth_nonces WHERE id=$1', [session.jti])).rows[0];
  if (current?.unexpired !== true) throw conflict('DRIVE_OAUTH_STATE_CONSUMED');
}
