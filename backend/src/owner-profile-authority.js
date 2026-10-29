import { readDatabaseTarget, isLoopbackAddress } from './startup-policy.js';
import { databaseAuthorityPool, bindDatabaseAuthorityClient } from './database-authority-context.js';
import { buildDatabasePoolConfig } from './database-transport.js';

// Delegation is opt-in and tied to persisted actors and one pool. Production
// additionally requires the explicit shared-v1 mode and canonical internal
// accounts provisioned separately; no user is created or promoted at startup.
const keys = ['franco', 'agustin'];
const labels = { franco: 'Franco', agustin: 'Agustín' };
const positive = n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
const exact = (v, fields) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === fields.length && fields.every(k => Object.hasOwn(v, k));
const fail = (status = 403) => Object.assign(new Error('Perfil de dueño no disponible.'), { status, code: 'owner_profile_unavailable' });
const policies = new WeakSet(), authorities = new WeakMap(), materials = new WeakSet();
const writeAuthorities = new WeakMap();
const capturedAuthorities = new WeakMap();
const policyPools = new WeakMap();
const productionPolicies = new WeakSet();
function assertAuthorityContext(db, policy) {
  const expected=policyPools.get(policy);
  if (!expected || databaseAuthorityPool(db)!==expected) throw fail(401);
}
export const hasOwnerProfileClaims = claims => ['root_id', 'root_session_version', 'root_exp', 'owner_profile']
  .some(key => claims && Object.hasOwn(claims, key));

export function parseOwnerProfilePolicy(env = {}) {
  if (env.RENDER_OWNER_PROFILES === undefined || env.RENDER_OWNER_PROFILES === '') return null;
  let mapping, target;
  try { mapping = JSON.parse(env.RENDER_OWNER_PROFILES); target = readDatabaseTarget(env); } catch { throw fail(); }
  if (!exact(mapping, ['accountId', 'francoUserId', 'agustinUserId'])
    || !Object.values(mapping).every(positive) || new Set(Object.values(mapping)).size !== 3
    || Object.values(mapping).includes(14)) throw fail();
  const local=['development','test'].includes(env.NODE_ENV)
    && ['development','test','sandbox'].includes(target.environment) && isLoopbackAddress(target.hostname)
    && [1,91001,91002].includes(mapping.accountId)
    && (mapping.accountId===1 || (env.NODE_ENV==='test' && ['test','sandbox'].includes(target.environment)))
    && [undefined,'','shared-v1'].includes(env.RENDER_OWNER_PROFILE_MODE);
  const production=env.NODE_ENV==='production' && target.environment==='production'
    && !isLoopbackAddress(target.hostname) && mapping.accountId===1
    && !Object.values(mapping).some(id=>[91001,91002,91003,91004,91005,91006].includes(id))
    && env.RENDER_OWNER_PROFILE_MODE==='shared-v1'
    && env.RENDER_BROWSER_SESSIONS==='true' && env.RENDER_BROWSER_ALLOW_LOCAL_HTTP==='false'
    && env.RENDER_BROWSER_ORIGIN==='https://sistema.rendercorrientes.com'
    && env.APP_URL===env.RENDER_BROWSER_ORIGIN;
  if(!local && !production)throw fail();
  if(production){try{if(buildDatabasePoolConfig(env)?.ssl?.rejectUnauthorized!==true)throw fail();}catch{throw fail();}}
  const policy = Object.freeze({ ...mapping }); policies.add(policy);
  if(production)productionPolicies.add(policy);
  return policy;
}
const validPolicy = policy => policy && policies.has(policy);
const targetId = (policy, key) => key === 'franco' ? policy.francoUserId : policy.agustinUserId;
const validUser = user => user && positive(user.id) && user.activo === true && user.rol === 'admin'
  && positive(Number(user.session_version));
const version = user => Number(user.session_version);
const validProfileUser=(user,key,policy)=>validUser(user) && (!productionPolicies.has(policy)
  || (user.usuario===`render.owner.${key}` && user.owner_profile_internal===true));

function validateDelegation(claims, policy) {
  if (!validPolicy(policy) || !keys.includes(claims.owner_profile)
    || claims.root_id !== policy.accountId || claims.id !== targetId(policy, claims.owner_profile)
    || !positive(claims.root_session_version) || !positive(claims.session_version)
    || !Number.isSafeInteger(claims.root_exp) || !Number.isSafeInteger(claims.exp)
    || claims.exp > claims.root_exp || claims.exp <= Math.floor(Date.now() / 1000)
    || claims.root_exp <= Math.floor(Date.now() / 1000)) throw fail(401);
}
async function readUsers(db, policy, lock = false) {
  assertAuthorityContext(db,policy);
  const ids = [policy.accountId, policy.francoUserId, policy.agustinUserId].sort((a,b) => a-b);
  return (await db.query(`SELECT id,usuario,nombre,rol,activo,session_version,foto_perfil,
    (password_hash='!RENDER_OWNER_PROFILE_V1_NO_LOGIN' AND google_id IS NULL
      AND google_email IS NULL AND email_notificaciones IS NULL) AS owner_profile_internal
    FROM usuarios WHERE id=ANY($1::int[]) ORDER BY id${lock === 'update' ? ' FOR UPDATE' : lock ? ' FOR SHARE' : ''}`, [ids])).rows;
}
function checkCurrent(auth, rows, policy) {
  const delegated = hasOwnerProfileClaims(auth);
  if (delegated) validateDelegation(auth, policy);
  const root = rows.find(u => u.id === policy.accountId), actor = rows.find(u => u.id === auth.id);
  if (!validUser(root) || !validUser(actor)
    || (delegated && !validProfileUser(actor,auth.owner_profile,policy))
    || (delegated ? version(root) !== auth.root_session_version : auth.id !== policy.accountId)
    || version(actor) !== auth.session_version) throw fail(401);
  return { root, actor };
}

// Called only after JWT signature/issuer/audience/expiry validation. The WeakMap
// keeps the original expiration outside public auth/DTOs and survives sanitizing.
export function rememberOwnerProfileSession(auth, claims, policy = null) {
  const delegated = hasOwnerProfileClaims(claims);
  const binding = delegated ? Object.freeze({ id:claims.id,session_version:claims.session_version,
    root_id:claims.root_id,root_session_version:claims.root_session_version,
    owner_profile:claims.owner_profile,root_exp:claims.root_exp,exp:claims.exp }) : null;
  authorities.set(auth, Object.freeze({ exp: claims.exp, root_exp: claims.root_exp ?? claims.exp, policy, binding }));
}

// Capture before waiting for a connection. Delegation is retained out-of-band:
// copying a DTO or supplying root_* fields cannot manufacture write authority.
export function captureOwnerProfileWriteAuthority(auth) {
  if (capturedAuthorities.has(auth)) return capturedAuthorities.get(auth);
  const session = authorities.get(auth);
  if (!session?.binding) {
    if (hasOwnerProfileClaims(auth)) throw fail(401);
    return null;
  }
  if (!session || !validPolicy(session.policy)) throw fail(401);
  const claims = session.binding;
  if (Object.keys(claims).some(key => auth[key] !== claims[key])) throw fail(401);
  validateDelegation(claims, session.policy);
  const handle = Object.freeze({});
  writeAuthorities.set(handle, { claims, policy: session.policy });
  return handle;
}

// Preserve trusted delegation through existing immutable scalar projections.
// The target must represent exactly the same persisted actor, not a new ID.
export function bindCapturedOwnerProfileAuthority(auth, captured) {
  const handle = captureOwnerProfileWriteAuthority(auth);
  if (!captured || !Object.isFrozen(captured) || captured.id !== auth?.id
    || captured.session_version !== auth?.session_version) throw fail(401);
  capturedAuthorities.set(captured, handle);
  return captured;
}

// Caller owns a READ COMMITTED transaction and must acquire any global mutex
// first. Ordered principal locks precede actor/domain locks and last to COMMIT.
export async function retainCapturedOwnerProfileAuthority(db, handle, { lockMode = 'share' } = {}) {
  if (!['share','update'].includes(lockMode)) throw fail(401);
  if (handle === null) return;
  const captured = writeAuthorities.get(handle);
  if (!captured) throw fail(401);
  assertAuthorityContext(db,captured.policy);
  checkCurrent(captured.claims, await readUsers(db, captured.policy, lockMode === 'update' ? 'update' : true), captured.policy);
}

// Read-only snapshots cannot acquire row locks. Validate the same principal
// against that snapshot; this does not promise revocation after snapshot start.
export async function checkCapturedOwnerProfileAuthority(db, handle) {
  if (handle === null) return;
  const captured = writeAuthorities.get(handle);
  if (!captured) throw fail(401);
  assertAuthorityContext(db,captured.policy);
  checkCurrent(captured.claims, await readUsers(db, captured.policy), captured.policy);
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
  if (!validPolicy(policy) || !materials.has(delegation) || !validProfileUser(user,delegation?.owner_profile,policy)
    || delegation.root_id !== policy.accountId || !positive(delegation.root_session_version)
    || user.id !== targetId(policy, delegation.owner_profile)
    || delegation.root_exp <= Math.floor(Date.now() / 1000)) throw fail(401);
  return { root_id: delegation.root_id, root_session_version: delegation.root_session_version,
    root_exp: delegation.root_exp, owner_profile: delegation.owner_profile };
}

export function configuredOwnerProfiles(env, pool) {
  const policy = parseOwnerProfilePolicy(env);
  if (!policy) return null;
  policyPools.set(policy,pool);
  bindDatabaseAuthorityClient(pool,pool);
  return Object.freeze({
    policy,
    async describe(auth) {
      if (!auth || (!hasOwnerProfileClaims(auth) && auth.id !== policy.accountId)) return undefined;
      const rows = await readUsers(pool, policy);
      checkCurrent(auth, rows, policy);
      // Both explicit target accounts must be active administrators. No auto
      // promotion, creation, assignment transfer or fallback to a namesake.
      if (keys.some(key => !validProfileUser(rows.find(u => u.id === targetId(policy, key)),key,policy))) throw fail();
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
        if (!validProfileUser(user,key,policy)) throw fail();
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
