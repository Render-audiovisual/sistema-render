import { createHash } from 'node:crypto';

// Internal explicit provisioning only. No pool, environment, routes or transaction
// ownership. prepare issues SELECTs only. apply requires the caller's READ
// COMMITTED read/write transaction; LOCK TABLE also rejects autocommit use.
// On ANY error the caller must ROLLBACK. Sequence consumption is not reversible.
const PASSWORD = '!RENDER_OWNER_PROFILE_V1_NO_LOGIN';
const usernames = ['render.owner.franco', 'render.owner.agustin'];
const names = ['Franco', 'Agustín'];
const positive = n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
const hex = value => typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
const count = value => typeof value === 'string' && /^[1-9][0-9]{0,5}$/.test(value)
  && String(Number(value)) === value && Number(value) <= 100000;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exact = (v, fields) => v && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v))
  && Reflect.ownKeys(v).length === fields.length && fields.every(key => Object.hasOwn(v, key));
const fail = (code, status = 409) => Object.assign(new Error('No se pudo verificar la preparación de perfiles de dueño.'), { code, status });
const requireCheck = (value, code, status) => { if (!value) throw fail(code, status); };
const required = {
  id: ['integer', true], usuario: ['text', true], nombre: ['text', true], rol: ['text', true],
  password_hash: ['text', true], google_id: ['text', false], google_email: ['text', false],
  email_notificaciones: ['text', false], activo: ['boolean', true], session_version: ['integer', true],
  user_admin_version: ['integer', true], whatsapp_id_hash: ['character(64)', false], whatsapp_habilitado: ['boolean', true],
};
async function schema(db) {
  const result = await db.query(`SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,
    a.attnotnull AS "notNull",coalesce(pg_get_expr(d.adbin,d.adrelid),'') AS "defaultSql",
    a.attidentity AS identity,a.attgenerated AS generated,
    EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid=c.oid AND k.contype='p'
      AND k.conkey=ARRAY[a.attnum]::smallint[] AND k.convalidated AND NOT k.condeferrable) AS "primaryKey",
    EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid=c.oid AND k.contype IN ('u','p')
      AND k.conkey=ARRAY[a.attnum]::smallint[] AND k.convalidated AND NOT k.condeferrable) AS "uniqueColumn",
    pg_get_serial_sequence('public.usuarios','id') AS sequence,
    c.relkind='r' AND NOT c.relispartition AND NOT row_security_active(c.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_inherits WHERE inhrelid=c.oid OR inhparent=c.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_rewrite WHERE ev_class=c.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal AND (tgtype & 4)<>0)
      AS compatible
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=to_regclass('public.usuarios') AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`);
  for (const [name, [type, notNull]] of Object.entries(required)) {
    const column = result.rows.find(c => c.name === name);
    requireCheck(column && column.type === type && column.notNull === notNull && column.compatible === true
      && column.identity === '' && column.generated === '', 'OWNER_PROVISIONING_SCHEMA');
  }
  const byName = Object.fromEntries(result.rows.map(c => [c.name, c]));
  requireCheck(byName.id.primaryKey === true && byName.usuario.uniqueColumn === true
    && typeof byName.id.sequence === 'string' && /^nextval\('.+'::regclass\)$/.test(byName.id.defaultSql)
    && byName.activo.defaultSql === 'true' && byName.session_version.defaultSql === '1'
    && byName.user_admin_version.defaultSql === '1', 'OWNER_PROVISIONING_DEFAULTS');
}
// All users (including secret-bearing columns) contribute to a SQL-side hash;
// only that digest and closed identity metadata leave the database.
async function observe(db, excludedIds = []) {
  const result = await db.query(`SELECT
    (SELECT jsonb_build_object('id',id,'role',rol,'active',activo,'version',session_version)
      FROM public.usuarios WHERE id=1) AS root,
    (SELECT count(*)::text FROM public.usuarios WHERE id<>ALL($1::int[])) AS "usersCount",
    (SELECT encode(sha256(convert_to(coalesce(string_agg(
      encode(sha256(convert_to(to_jsonb(u)::text,'UTF8')),'hex'),'' ORDER BY u.id),''),'UTF8')),'hex')
      FROM public.usuarios u WHERE id<>ALL($1::int[])) AS "usersFingerprint",
    (SELECT coalesce(jsonb_agg(jsonb_build_object('username',usuario,'id',id,'canonical',
      usuario=ANY($2::text[]) AND nombre=CASE usuario WHEN $3 THEN $5 WHEN $4 THEN $6 ELSE NULL END
      AND rol='admin' AND password_hash=$7 AND google_id IS NULL AND google_email IS NULL
      AND email_notificaciones IS NULL AND activo IS TRUE AND session_version>0 AND user_admin_version>0
      AND whatsapp_id_hash IS NULL AND whatsapp_habilitado IS FALSE) ORDER BY usuario),'[]'::jsonb)
      FROM public.usuarios WHERE lower(usuario)=ANY($2::text[])) AS profiles`,
  [excludedIds, usernames, ...usernames, ...names, PASSWORD]);
  const row = result.rows[0];
  requireCheck(result.rows.length === 1 && row && exact(row.root, ['id','role','active','version'])
    && row.root.id === 1 && row.root.role === 'admin' && row.root.active === true && positive(row.root.version),
  'OWNER_PROVISIONING_ROOT', 401);
  requireCheck(hex(row.usersFingerprint) && count(row.usersCount) && Array.isArray(row.profiles), 'OWNER_PROVISIONING_OBSERVATION');
  requireCheck(row.profiles.length === 0 || row.profiles.length === 2, 'OWNER_PROVISIONING_PARTIAL_OR_COLLISION');
  const profiles = { francoUserId: null, agustinUserId: null };
  if (row.profiles.length) {
    for (const [index, username] of usernames.entries()) {
      const found = row.profiles.filter(p => exact(p, ['username','id','canonical']) && p.username === username);
      requireCheck(found.length === 1 && positive(found[0].id) && ![1,14].includes(found[0].id)
        && found[0].canonical === true, 'OWNER_PROVISIONING_PARTIAL_OR_COLLISION');
      profiles[index === 0 ? 'francoUserId' : 'agustinUserId'] = found[0].id;
    }
    requireCheck(profiles.francoUserId !== profiles.agustinUserId, 'OWNER_PROVISIONING_PARTIAL_OR_COLLISION');
  }
  return { rootVersion: row.root.version, usersCount: row.usersCount, usersFingerprint: row.usersFingerprint, profiles };
}
function freezePlan(observation) {
  const body = { version: 1, rootVersion: observation.rootVersion, usersCount: observation.usersCount,
    usersFingerprint: observation.usersFingerprint, profiles: Object.freeze({ ...observation.profiles }) };
  return Object.freeze({ ...body, sha256: digest(body) });
}
function validatePlan(plan) {
  requireCheck(exact(plan, ['version','rootVersion','usersCount','usersFingerprint','profiles','sha256']) && plan.version === 1
    && positive(plan.rootVersion) && hex(plan.usersFingerprint) && hex(plan.sha256)
    && count(plan.usersCount)
    && exact(plan.profiles, ['francoUserId','agustinUserId']), 'OWNER_PROVISIONING_PLAN', 400);
  const { francoUserId: franco, agustinUserId: agustin } = plan.profiles;
  requireCheck(franco === null && agustin === null || positive(franco) && positive(agustin)
    && franco !== agustin && ![1,14].includes(franco) && ![1,14].includes(agustin), 'OWNER_PROVISIONING_PLAN', 400);
  const copy = freezePlan(plan);
  requireCheck(copy.sha256 === plan.sha256, 'OWNER_PROVISIONING_PLAN', 400);
  return copy;
}

export async function prepareOwnerProfileProvisioning(db) {
  try { await schema(db); return freezePlan(await observe(db)); }
  catch (error) { if (error.code?.startsWith('OWNER_PROVISIONING_')) throw error; throw fail('OWNER_PROVISIONING_SCHEMA'); }
}

export async function applyOwnerProfileProvisioning(db, plan) {
  const expected = validatePlan(plan); // immutable copy before the first await
  try {
    const context = (await db.query(`SELECT current_setting('transaction_isolation') AS isolation,
      current_setting('transaction_read_only') AS "readOnly"`)).rows[0];
    requireCheck(context?.isolation === 'read committed' && context.readOnly === 'off', 'OWNER_PROVISIONING_TRANSACTION');
    await db.query('SELECT pg_advisory_xact_lock(20261019, 1)');
    await db.query('LOCK TABLE public.usuarios IN SHARE ROW EXCLUSIVE MODE');
    await schema(db);
    await db.query('SELECT id FROM public.usuarios WHERE id=1 ORDER BY id FOR UPDATE');
    const current = freezePlan(await observe(db));
    requireCheck(current.rootVersion === expected.rootVersion, 'OWNER_PROVISIONING_ROOT_REVOKED', 401);
    requireCheck(current.sha256 === expected.sha256, 'OWNER_PROVISIONING_STALE');
    if (current.profiles.francoUserId !== null) return Object.freeze({ accountId: 1, ...current.profiles });
    const inserted = await db.query(`INSERT INTO public.usuarios
      (usuario,nombre,rol,password_hash,google_id,google_email,email_notificaciones,activo,session_version,
        whatsapp_id_hash,whatsapp_habilitado)
      VALUES ($1,$3,'admin',$5,NULL,NULL,NULL,TRUE,1,NULL,FALSE),
             ($2,$4,'admin',$5,NULL,NULL,NULL,TRUE,1,NULL,FALSE)
      RETURNING id,usuario`, [...usernames, ...names, PASSWORD]);
    requireCheck(inserted.rows.length === 2 && inserted.rows.every(r => positive(r.id) && ![1,14].includes(r.id))
      && new Set(inserted.rows.map(r => r.id)).size === 2 && usernames.every(name => inserted.rows.filter(r => r.usuario === name).length === 1),
    'OWNER_PROVISIONING_INSERT');
    const after = await observe(db, inserted.rows.map(r => r.id));
    requireCheck(after.rootVersion === expected.rootVersion && after.usersFingerprint === expected.usersFingerprint
      && after.usersCount === expected.usersCount, 'OWNER_PROVISIONING_ORIGINAL_USERS_CHANGED');
    for (const [index, name] of usernames.entries()) requireCheck(
      after.profiles[index === 0 ? 'francoUserId' : 'agustinUserId'] === inserted.rows.find(r => r.usuario === name).id,
      'OWNER_PROVISIONING_INSERT');
    return Object.freeze({ accountId: 1, ...after.profiles });
  } catch (error) {
    if (error.code?.startsWith('OWNER_PROVISIONING_')) throw error;
    throw fail('OWNER_PROVISIONING_APPLY_FAILED'); // caller must roll back; never swallow into success
  }
}
