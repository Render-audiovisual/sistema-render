import { readDatabaseTarget, isLoopbackAddress } from './startup-policy.js';

// LOCAL ONLY. These are delegated real actor IDs, never identity by a label.
// Enabling production requires a separate audit/integration of principal locks
// inside ALL business write transactions. Middleware alone cannot close races.
const keys = ['franco', 'agustin'];
const labels = { franco: 'Franco', agustin: 'Agustín' };
const positive = n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
const exact = (v, fields) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === fields.length && fields.every(k => Object.hasOwn(v, k));
const fail = (status = 403) => Object.assign(new Error('Perfil de dueño no disponible.'), { status, code: 'owner_profile_unavailable' });
const policies = new WeakSet(), authorities = new WeakMap(), materials = new WeakSet();
export const hasOwnerProfileClaims = claims => ['root_id', 'root_session_version', 'root_exp', 'owner_profile']
  .some(key => claims && Object.hasOwn(claims, key));

export function parseOwnerProfilePolicy(env = {}) {
  if (env.RENDER_OWNER_PROFILES === undefined || env.RENDER_OWNER_PROFILES === '') return null;
  let mapping, target;
  try { mapping = JSON.parse(env.RENDER_OWNER_PROFILES); target = readDatabaseTarget(env); } catch { throw fail(); }
  if (!['development', 'test'].includes(env.NODE_ENV)
    || !['development', 'test', 'sandbox'].includes(target.environment) || !isLoopbackAddress(target.hostname)
    || !exact(mapping, ['accountId', 'francoUserId', 'agustinUserId'])
    || !Object.values(mapping).every(positive) || new Set(Object.values(mapping)).size !== 3
    || ![1, 91001, 91002].includes(mapping.accountId)
    || (mapping.accountId !== 1 && (env.NODE_ENV !== 'test' || !['test', 'sandbox'].includes(target.environment)))
    || Object.values(mapping).includes(14)) throw fail();
  const policy = Object.freeze({ ...mapping }); policies.add(policy); return policy;
}
const validPolicy = policy => policy && policies.has(policy);
const targetId = (policy, key) => key === 'franco' ? policy.francoUserId : policy.agustinUserId;
const validUser = user => user && positive(user.id) && user.activo === true && user.rol === 'admin'
  && positive(Number(user.session_version));
const version = user => Number(user.session_version);

function validateDelegation(claims, policy) {
  if (!validPolicy(policy) || !keys.includes(claims.owner_profile)
    || claims.root_id !== policy.accountId || claims.id !== targetId(policy, claims.owner_profile)
    || !positive(claims.root_session_version) || !positive(claims.session_version)
    || !Number.isSafeInteger(claims.root_exp) || !Number.isSafeInteger(claims.exp)
    || claims.exp > claims.root_exp || claims.root_exp <= Math.floor(Date.now() / 1000)) throw fail(401);
}
async function readUsers(db, policy, lock = false) {
  const ids = [policy.accountId, policy.francoUserId, policy.agustinUserId].sort((a,b) => a-b);
  return (await db.query(`SELECT id,usuario,nombre,rol,activo,session_version,foto_perfil
    FROM usuarios WHERE id=ANY($1::int[]) ORDER BY id${lock ? ' FOR SHARE' : ''}`, [ids])).rows;
}
function checkCurrent(auth, rows, policy) {
  const delegated = hasOwnerProfileClaims(auth);
  if (delegated) validateDelegation(auth, policy);
  const root = rows.find(u => u.id === policy.accountId), actor = rows.find(u => u.id === auth.id);
  if (!validUser(root) || !validUser(actor)
    || (delegated ? version(root) !== auth.root_session_version : auth.id !== policy.accountId)
    || version(actor) !== auth.session_version) throw fail(401);
  return { root, actor };
}

// Called only after JWT signature/issuer/audience/expiry validation. The WeakMap
// keeps the original expiration outside public auth/DTOs and survives sanitizing.
export function rememberOwnerProfileSession(auth, claims) {
  authorities.set(auth, Object.freeze({ exp: claims.exp, root_exp: claims.root_exp ?? claims.exp }));
}
export async function authenticateOwnerProfile(pool, claims, policy) {
  validateDelegation(claims, policy);
  return checkCurrent(claims, await readUsers(pool, policy), policy).actor;
}

export async function retainOwnerProfileAuthority(db, auth, policy) {
  if (!hasOwnerProfileClaims(auth)) return;
  if (!validPolicy(policy)) throw fail(401);
  checkCurrent(auth, await readUsers(db, policy, true), policy);
}

export function assertOwnerProfileSessionMaterial(user, delegation, policy) {
  if (!validPolicy(policy) || !materials.has(delegation) || !validUser(user)
    || delegation.root_id !== policy.accountId || !positive(delegation.root_session_version)
    || user.id !== targetId(policy, delegation.owner_profile)
    || delegation.root_exp <= Math.floor(Date.now() / 1000)) throw fail(401);
  return { root_id: delegation.root_id, root_session_version: delegation.root_session_version,
    root_exp: delegation.root_exp, owner_profile: delegation.owner_profile };
}

export function configuredOwnerProfiles(env, pool) {
  const policy = parseOwnerProfilePolicy(env);
  if (!policy) return null;
  return Object.freeze({
    policy,
    async describe(auth) {
      if (!auth || (!hasOwnerProfileClaims(auth) && auth.id !== policy.accountId)) return undefined;
      const rows = await readUsers(pool, policy);
      checkCurrent(auth, rows, policy);
      // Both explicit target accounts must be active administrators. No auto
      // promotion, creation, assignment transfer or fallback to a namesake.
      if (keys.some(key => !validUser(rows.find(u => u.id === targetId(policy, key))))) throw fail();
      return { principal_id: policy.accountId, active: auth.owner_profile ?? null,
        profiles: keys.map(key => ({ key, user_id: targetId(policy, key), name: labels[key] })) };
    },
    async switchProfile(auth, key) {
      if (!keys.includes(key) || !auth || !authorities.has(auth)) throw fail();
      if (!hasOwnerProfileClaims(auth) && auth.id !== policy.accountId) throw fail();
      const ceiling = authorities.get(auth).root_exp;
      if (!Number.isSafeInteger(ceiling) || ceiling <= Math.floor(Date.now() / 1000)) throw fail(401);
      let db, began = false, discard = false;
      try {
        db = await pool.connect();
        discard = true; await db.query('BEGIN'); began = true; discard = false;
        await db.query("SET LOCAL lock_timeout TO '3s'");
        await db.query("SET LOCAL statement_timeout TO '10s'");
        const rows = await readUsers(db, policy, true), { root } = checkCurrent(auth, rows, policy);
        const user = rows.find(u => u.id === targetId(policy, key));
        if (!validUser(user)) throw fail();
        const delegation = Object.freeze({ root_id: root.id, root_session_version: version(root), root_exp: ceiling, owner_profile: key });
        discard = true; await db.query('COMMIT'); began = false; discard = false;
        materials.add(delegation);
        return { user: Object.freeze({ ...user, session_version: version(user) }), delegation };
      } catch (error) {
        if (began) { try { await db.query('ROLLBACK'); } catch { discard = true; } }
        throw error.status ? error : fail(503);
      } finally { if (db) db.release(discard ? fail(503) : undefined); }
    },
  });
}

export function ownerProfileLogoutSubject(auth) {
  return { id: auth.root_id ?? auth.id, session_version: auth.root_session_version ?? auth.session_version };
}
