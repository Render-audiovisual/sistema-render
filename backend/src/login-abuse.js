import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

export const LOGIN_PEER_LIMIT = 120;
export const LOGIN_IDENTIFIER_LIMIT = 20;
export const LOGIN_WINDOW_SECONDS = 15 * 60;
export const LOGIN_PRUNE_LIMIT = 100;
export const LOGIN_ACQUIRE_TIMEOUT_MS = 2000;
export const LOGIN_QUERY_TIMEOUT_MS = 3000;
export const LOGIN_PENDING_ACQUISITION_LIMIT = 32;
// Resource guard only, not rate state. Timed-out callers retain their slot until
// the underlying pg acquisition settles, preventing an unbounded pending queue.
const pendingAcquisitions = new WeakMap();
const INVALID_PEER = 'invalid-peer';
const unavailable = () => Object.assign(new Error('El acceso no está disponible temporalmente. Intentá nuevamente.'), { status: 503 });

/** Direct socket address only. No header, proxy, hostname or DNS interpretation. */
export function normalizeLoginPeer(peer) {
  if (typeof peer !== 'string' || peer.length > 128 || peer.includes('%')) return INVALID_PEER;
  const family = isIP(peer);
  if (family === 4) return peer;
  if (family !== 6) return INVALID_PEER;
  try {
    const canonical = new URL(`http://[${peer}]/`).hostname.slice(1, -1).toLowerCase();
    const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(canonical);
    if (!mapped) return canonical;
    const hi = parseInt(mapped[1], 16), lo = parseInt(mapped[2], 16);
    return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
  } catch { return INVALID_PEER; }
}

export function normalizeLoginIdentifier(value) {
  if (typeof value !== 'string') throw unavailable();
  const trimmed = value.trim();
  if (!trimmed || Buffer.byteLength(trimmed, 'utf8') > 320 || /\p{Cc}/u.test(value)) throw unavailable();
  return trimmed.toLowerCase();
}

function assertSecret(secret) {
  if (typeof secret !== 'string' || !secret.trim() || secret.includes('\0')) throw unavailable();
}

export function loginAbuseBucketKey(kind, value, secret) {
  assertSecret(secret);
  if (!['peer', 'identifier'].includes(kind)) throw unavailable();
  const normalized = kind === 'peer' ? normalizeLoginPeer(value) : normalizeLoginIdentifier(value);
  return createHmac('sha256', secret).update(JSON.stringify(['auth-login-bucket-v1', kind, normalized])).digest('hex');
}

export function loginAttemptBuckets(input, secret) {
  assertSecret(secret);
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['peer', 'identifier'].includes(k))) throw unavailable();
  const buckets = [{ key: loginAbuseBucketKey('peer', input.peer, secret), limit: LOGIN_PEER_LIMIT }];
  if (input.identifier !== undefined) buckets.push({ key: loginAbuseBucketKey('identifier', input.identifier, secret), limit: LOGIN_IDENTIFIER_LIMIT });
  return buckets.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

// An acquisition cannot be cancelled by pg. Always observe the late promise;
// dispose its client if our deadline already passed, without leaking a checkout.
function acquire(pool) {
  if (!pool || !['object', 'function'].includes(typeof pool) || typeof pool.connect !== 'function') return Promise.reject(unavailable());
  const pending = pendingAcquisitions.get(pool) ?? 0;
  if (pending >= LOGIN_PENDING_ACQUISITION_LIMIT) return Promise.reject(unavailable());
  pendingAcquisitions.set(pool, pending + 1);
  const freeSlot = () => {
    const remaining = (pendingAcquisitions.get(pool) ?? 1) - 1;
    if (remaining > 0) pendingAcquisitions.set(pool, remaining);
    else pendingAcquisitions.delete(pool);
  };
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { settled = true; reject(unavailable()); }, LOGIN_ACQUIRE_TIMEOUT_MS);
    Promise.resolve().then(() => pool.connect()).then(client => {
      freeSlot();
      if (settled) { try { client?.release(true); } catch { /* no sensitive errors escape */ } return; }
      settled = true; clearTimeout(timer); resolve(client);
    }, () => {
      freeSlot();
      if (!settled) { settled = true; clearTimeout(timer); reject(unavailable()); }
    });
  });
}

// Driver-side timeout also bounds network failures where server SQL timers
// cannot deliver a response. Never race an orphaned query promise ourselves.
const query = (db, text, values = []) => db.query({ text, values, query_timeout: LOGIN_QUERY_TIMEOUT_MS });

export const LOGIN_PRUNE_SQL = `WITH candidates AS MATERIALIZED (
  SELECT bucket_key FROM auth_login_buckets
  WHERE expires_at <= CURRENT_TIMESTAMP AND bucket_key <> ALL($1::text[])
  ORDER BY expires_at,bucket_key LIMIT 100
), eligible AS MATERIALIZED (
  SELECT bucket_key FROM candidates
  WHERE pg_try_advisory_xact_lock(hashtext('auth-login-bucket'),hashtext(bucket_key))
), locked AS MATERIALIZED (
  SELECT b.bucket_key FROM auth_login_buckets b JOIN eligible e ON e.bucket_key=b.bucket_key
  WHERE b.expires_at <= clock_timestamp() ORDER BY b.bucket_key FOR UPDATE OF b SKIP LOCKED
)
DELETE FROM auth_login_buckets b USING locked l
WHERE b.bucket_key=l.bucket_key AND b.expires_at <= clock_timestamp()`;

export const LOGIN_RESERVE_SQL = `WITH stamp AS MATERIALIZED (SELECT clock_timestamp() AS now)
INSERT INTO auth_login_buckets AS b(bucket_key,attempts,window_started_at,expires_at)
SELECT $1,1,now,now+make_interval(secs => $2::int) FROM stamp
ON CONFLICT (bucket_key) DO UPDATE SET
  attempts=CASE WHEN b.expires_at <= (SELECT now FROM stamp) THEN 1 ELSE LEAST(b.attempts+1,$3::int) END,
  window_started_at=CASE WHEN b.expires_at <= (SELECT now FROM stamp) THEN (SELECT now FROM stamp) ELSE b.window_started_at END,
  expires_at=CASE WHEN b.expires_at <= (SELECT now FROM stamp) THEN (SELECT now FROM stamp)+make_interval(secs => $2::int) ELSE b.expires_at END
RETURNING attempts`;

/** Reserve before password/provider verification. Denials commit their counters.
 * No raw identity/address, auth result, credential or token enters SQL/storage.
 */
export async function reserveLoginAttempt(pool, input, secret) {
  let db;
  let failed = false;
  try {
    const buckets = loginAttemptBuckets(input, secret), keys = buckets.map(b => b.key);
    db = await acquire(pool);
    await query(db, 'BEGIN ISOLATION LEVEL READ COMMITTED');
    await query(db, "SET LOCAL lock_timeout='1000ms'");
    await query(db, "SET LOCAL statement_timeout='2000ms'");
    // Reserve every current key in the same total order BEFORE cleanup. Cleanup
    // uses try-only advisory acquisition before SKIP LOCKED row acquisition,
    // so it cannot delete a bucket another reservation will later need.
    for (const key of keys) await query(db, "SELECT pg_advisory_xact_lock(hashtext('auth-login-bucket'),hashtext($1))", [key]);
    await query(db, LOGIN_PRUNE_SQL, [keys]);
    for (const bucket of buckets) {
      // Separate statement: database clock in the upsert is captured only AFTER
      // an existing bucket's row lock/wait. Missing rows are advisory-protected.
      await query(db, 'SELECT bucket_key FROM auth_login_buckets WHERE bucket_key=$1 FOR UPDATE', [bucket.key]);
      const result = await query(db, LOGIN_RESERVE_SQL, [bucket.key, LOGIN_WINDOW_SECONDS, bucket.limit + 1]);
      if (result.rows.length !== 1) throw unavailable();
    }
    const result = await query(db, `SELECT bucket_key,attempts,
      GREATEST(1,ceil(extract(epoch FROM (expires_at-clock_timestamp()))))::int AS retry_after
      FROM auth_login_buckets WHERE bucket_key=ANY($1::text[]) ORDER BY bucket_key`, [keys]);
    if (result.rows.length !== buckets.length) throw unavailable();
    const rows = new Map(result.rows.map(row => [row.bucket_key, row]));
    let retryAfter = 1, allowed = true;
    for (const bucket of buckets) {
      const row = rows.get(bucket.key);
      if (!row || !Number.isSafeInteger(row.attempts) || row.attempts < 1 || row.attempts > bucket.limit + 1
        || !Number.isSafeInteger(row.retry_after) || row.retry_after < 1) throw unavailable();
      if (row.attempts > bucket.limit) { allowed = false; retryAfter = Math.max(retryAfter, row.retry_after); }
    }
    await query(db, 'COMMIT');
    return { allowed, retryAfter };
  } catch {
    failed = true;
    if (db) { try { await query(db, 'ROLLBACK'); } catch { /* bounded, preserve sanitized failure */ } }
    throw unavailable();
  } finally {
    if (db) { try { db.release(failed); } catch { /* no raw driver details */ } }
  }
}
