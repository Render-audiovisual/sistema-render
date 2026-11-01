import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readMigrationIdentity, readMigrationStatus } from './migrations.js';
import { isLoopbackAddress } from './startup-policy.js';
import { readApplicationObjectInventory, protectNewApplicationObjects, securityPolicyFingerprint } from './application-object-security.js';

// A separate closed upgrade, never an extension of the historical 41-file
// release or a way to execute arbitrary pending SQL. No pools/env/startup jobs.
export const INSTAGRAM_MIGRATIONS = Object.freeze([
  Object.freeze({ name: '094_instagram_metricas.sql', sha256: '1fed7890d2e9223f2fd760f6b9c69846bdd417574b8a20e76d6a303a5826bc50' }),
  Object.freeze({ name: '095_instagram_reportes.sql', sha256: '2c36e4f513ac3259873897dd8c15a2884d2666ebcf2dbf6a4d23f42ff77511c0' }),
]);
const newTables = ['instagram_cuenta_seguidores', 'instagram_cuentas', 'instagram_media', 'instagram_media_metricas', 'instagram_reportes'];
const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => hash(JSON.stringify(value));
const qi = name => '"' + name.replaceAll('"', '""') + '"';
const fail = code => Object.assign(new Error('La actualización de Instagram se detuvo; no se autoriza publicar.'), { code });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function sqlFiles() {
  return INSTAGRAM_MIGRATIONS.map(file => {
    const bytes = readFileSync(new URL(`../migrations/${file.name}`, import.meta.url));
    if (hash(bytes) !== file.sha256) throw fail('INSTAGRAM_SQL_CHANGED');
    return { ...file, bytes };
  });
}
async function settings(db) {
  // Do not inherit PGOPTIONS/search_path or per-lease date/float formatting.
  // LOCAL settings are restored automatically on COMMIT/ROLLBACK.
  await db.query('SET LOCAL search_path TO public');
  await db.query("SET LOCAL TimeZone TO 'UTC'");
  await db.query("SET LOCAL DateStyle TO 'ISO, MDY'");
  await db.query("SET LOCAL IntervalStyle TO 'postgres'");
  await db.query('SET LOCAL extra_float_digits TO 3');
  await db.query("SET LOCAL lock_timeout='5s'");
  await db.query("SET LOCAL statement_timeout='30s'");
}
async function state(db, { after = false } = {}) {
  const identity = await readMigrationIdentity(db);
  const status = await readMigrationStatus(db);
  const names = INSTAGRAM_MIGRATIONS.map(f => f.name);
  if (!status.ledgerExists || status.unknownApplied.length
    || !same(status.pending, after ? [] : INSTAGRAM_MIGRATIONS)) throw fail('INSTAGRAM_MIGRATION_SCOPE_CHANGED');
  const tables = (await db.query(`SELECT c.relname AS name,c.oid::text AS oid,row_security_active(c.oid) AS filtered
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname COLLATE "C"`)).rows;
  if (!tables.length || tables.length > 1000 || tables.some(t => t.filtered !== false)) throw fail('INSTAGRAM_FILTERED_SNAPSHOT');
  if (after ? newTables.some(name => !tables.some(t => t.name === name)) : tables.some(t => newTables.includes(t.name)))
    throw fail('INSTAGRAM_SCHEMA_CHANGED');
  const records = [];
  for (const table of tables.filter(t => !after || !newTables.includes(t.name))) {
    const filter = after && table.name === '_migrations' ? 'WHERE NOT (nombre=ANY($1::text[]))' : '';
    const row = (await db.query(`SELECT count(*)::text AS rows,
      encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h COLLATE "C"),''),'UTF8')),'hex') AS hash
      FROM (SELECT encode(sha256(convert_to(jsonb_build_array(to_jsonb(r),r.xmin::text,r.ctid::text)::text,'UTF8')),'hex') AS h
      FROM ONLY public.${qi(table.name)} r ${filter}) q`, filter ? [names] : [])).rows[0];
    const schema = (await db.query(`SELECT jsonb_build_object('owner',c.relowner::text,'acl',c.relacl::text,
      'rls',c.relrowsecurity,'force',c.relforcerowsecurity,
      'columns',(SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,
        a.attacl::text,pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a
        LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
      'constraints',(SELECT jsonb_agg(pg_get_constraintdef(k.oid) ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid=c.oid),
      'indexes',(SELECT jsonb_agg(pg_get_indexdef(i.indexrelid) ORDER BY i.indexrelid) FROM pg_index i WHERE i.indrelid=c.oid),
      'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=c.oid),
      'triggers',(SELECT jsonb_agg(jsonb_build_array(g.tgname,g.tgenabled,pg_get_triggerdef(g.oid),md5(p.prosrc),p.prosecdef,p.proconfig)
        ORDER BY g.tgname) FROM pg_trigger g JOIN pg_proc p ON p.oid=g.tgfoid WHERE g.tgrelid=c.oid AND NOT g.tgisinternal)
      ) AS value FROM pg_class c WHERE c.oid=$1::oid`, [table.oid])).rows[0]?.value;
    if (!row || !schema) throw fail('INSTAGRAM_SNAPSHOT_FAILED');
    records.push({ name: table.name, oid: table.oid, ...row, schema });
  }
  return { identity, records };
}
function target(environment, identity) {
  if (!['test', 'sandbox', 'production'].includes(environment)
    || (environment !== 'production' && !isLoopbackAddress(identity.address))) throw fail('INSTAGRAM_TARGET_INVALID');
}
function planFor(environment, snapshot) {
  target(environment, snapshot.identity);
  const body = { version: 1, scope: 'instagram-094-095', environment, identity: snapshot.identity,
    prestateSha256: digest(snapshot), sql: INSTAGRAM_MIGRATIONS, securityPolicyFingerprint };
  return { ...body, planSha256: digest(body) };
}
export async function inspectInstagramMigration(pool, { environment } = {}) {
  sqlFiles();
  const db = await pool.connect(); let discard;
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await settings(db);
    const plan = planFor(environment, await state(db));
    await db.query('COMMIT'); return plan;
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch { discard = true; }
    if (error?.code?.startsWith('INSTAGRAM_')) throw error;
    throw fail('INSTAGRAM_INSPECTION_FAILED');
  } finally { try { db.release(discard); } catch { /* Never expose private driver details from lease cleanup. */ } }
}

export async function executeInstagramMigration(pool, approval, { environment, consumeApproval, now = Date.now } = {}) {
  // External durable approval consumption is mandatory even in rehearsals.
  // Neither a boolean in JSON nor an old rehearsal grants production authority.
  const accepted = structuredClone(approval), files = sqlFiles();
  const clock = () => { const value = now(); if (!Number.isSafeInteger(value)) throw fail('INSTAGRAM_APPROVAL_EXPIRED'); return value; };
  if (typeof consumeApproval !== 'function' || typeof now !== 'function'
    || !accepted?.plan || accepted.plan.environment !== environment
    || !hex(accepted.backupSha256) || !hex(accepted.restorationEvidenceSha256)
    || !Number.isSafeInteger(accepted.expiresAt) || accepted.expiresAt <= clock()
    || accepted.expiresAt - clock() > 30 * 60 * 1000
    || accepted.maintenance?.writesPaused !== true || accepted.maintenance?.jobsPaused !== true
    || accepted.maintenance?.exclusiveSchema !== true) throw fail('INSTAGRAM_APPROVAL_REQUIRED');
  const fresh = () => { if (clock() >= accepted.expiresAt) throw fail('INSTAGRAM_APPROVAL_EXPIRED'); };
  const db = await pool.connect(); let discard, committing = false;
  try {
    // Capture only AFTER the table locks, at READ COMMITTED, so a writer that
    // finished while locks were being acquired cannot hide behind an old RR
    // snapshot. The retained locks then freeze all existing application rows.
    await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await settings(db);
    await db.query('SELECT pg_advisory_xact_lock(728194,1)');
    const tables = (await db.query(`SELECT tablename AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename`)).rows;
    if (!tables.length || tables.length > 1000) throw fail('INSTAGRAM_SCHEMA_CHANGED');
    await db.query(`LOCK TABLE ${tables.map(t => `public.${qi(t.name)}`).join(',')} IN EXCLUSIVE MODE`);
    fresh();
    const before = await state(db), actual = planFor(environment, before);
    if (!same(actual, accepted.plan)) throw fail('INSTAGRAM_PLAN_CHANGED');
    const inventory = await readApplicationObjectInventory(db);
    if (await consumeApproval(Object.freeze({ approvalSha256: digest(accepted), planSha256: actual.planSha256 })) !== true)
      throw fail('INSTAGRAM_APPROVAL_REJECTED');
    fresh();
    for (const file of files) {
      await db.query(file.bytes.toString('utf8'));
      await db.query('INSERT INTO public._migrations(nombre) VALUES($1)', [file.name]);
    }
    await protectNewApplicationObjects(db, inventory);
    if (!same(before, await state(db, { after: true }))) throw fail('INSTAGRAM_EXISTING_DATA_CHANGED');
    fresh(); committing = true;
    await db.query('COMMIT');
    return Object.freeze({ state: 'COMMITTED', scope: actual.scope, planSha256: actual.planSha256,
      migrations: files.map(f => f.name), preservedTables: before.records.length, existingDataUnchanged: true });
  } catch (error) {
    if (committing) { discard = true; throw fail('INSTAGRAM_COMMIT_UNCERTAIN'); }
    try { await db.query('ROLLBACK'); } catch { discard = true; throw fail('INSTAGRAM_ROLLBACK_UNCERTAIN'); }
    if (error?.code?.startsWith('INSTAGRAM_')) throw error;
    throw fail('INSTAGRAM_EXECUTION_FAILED');
  } finally { try { db.release(discard); } catch { /* Cleanup cannot falsify a confirmed COMMIT or expose driver details. */ } }
}
