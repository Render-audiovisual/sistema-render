import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { normalizeDatabaseIdentity, isLoopbackAddress } from './startup-policy.js';
import { readMigrationIdentity, readMigrationStatus } from './migrations.js';
import { validateReleaseSnapshot } from './release-preservation-snapshot.js';
import { readApplicationObjectInventory, protectNewApplicationObjects, securityPolicyFingerprint } from './application-object-security.js';

// Dedicated library, no CLI/env/pool creation or remote calls at import. The
// external approval consumer is trusted code, NOT a boolean supplied in JSON.
// Session/direct connection + drained writers + exclusive schema ownership are
// operational prerequisites; no SQL probe proves a pooler's operating mode.
const directory = new URL('../migrations/', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const qi = name => '"' + name.replaceAll('"', '""') + '"';
const error = code => Object.assign(new Error('Scoped release stopped; inspect private evidence before any new attempt.'), { code });
const exact = (v, names) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === names.length && names.every(n => Object.hasOwn(v, n));
const positive = n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'
    : JSON.stringify(value);

export function productionAssignmentIntentHash(intent) {
  return hash(canonical(normalizeIntent(intent)));
}
function normalizeIntent(intent) {
  if (!exact(intent, ['choices', 'exceptions']) || !Array.isArray(intent.choices) || !intent.choices.length
    || intent.choices.length > 10000 || !Array.isArray(intent.exceptions) || intent.exceptions.length > 10000) throw error('INVALID_INTENT');
  const seen = new Set();
  const choices = intent.choices.map(c => {
    if (!exact(c, ['task_id', 'owner_id', 'collaborator_ids']) || !positive(c.task_id) || !positive(c.owner_id)
      || seen.has(c.task_id) || !Array.isArray(c.collaborator_ids) || c.collaborator_ids.length > 100
      || c.collaborator_ids.some(id => !positive(id) || id === c.owner_id)
      || new Set(c.collaborator_ids).size !== c.collaborator_ids.length) throw error('INVALID_INTENT');
    seen.add(c.task_id);
    return { task_id: c.task_id, owner_id: c.owner_id, collaborator_ids: [...c.collaborator_ids].sort((a,b) => a-b) };
  }).sort((a,b) => a.task_id-b.task_id);
  const exceptions = intent.exceptions.map(e => {
    if (!exact(e, ['task_id', 'reason']) || !positive(e.task_id) || seen.has(e.task_id)
      || typeof e.reason !== 'string' || !e.reason.trim() || e.reason.length > 500 || /[\u0000-\u001f\u007f]/.test(e.reason)) throw error('INVALID_INTENT');
    seen.add(e.task_id); return { task_id: e.task_id, reason: e.reason };
  }).sort((a,b) => a.task_id-b.task_id);
  return { choices, exceptions };
}

// Closed release train, not a lower-number boundary or recognition allowlist.
// Reads only these trusted repository bytes; alternate historical 054/055 never
// qualify. An intentional source change needs a new scope and external approval.
function trustedTrain() {
  const names = readdirSync(directory).filter(n => /^(?:0(?:5[4-9]|[6-8][0-9]|9[0-3])_|20261027144706_editing_progress_unified_ledger\.sql$)/.test(n)).sort();
  if (names.length !== 41 || names[0] !== '054_verified_user_sessions.sql'
    || names[1] !== '055_decouple_goal_publication.sql') throw error('INVALID_RELEASE_TRAIN');
  return names.map(name => ({ name, bytes: readFileSync(new URL(name, directory)) }));
}

/** Hash the complete closed approval body (all fields except scopeSha256).
 * Does not certify consent, evidence authenticity, maintenance or backup.
 */
export function productionReleaseScopeHash(body) { return hash(canonical(body)); }

function freezeInputs(input) {
  if (!exact(input, ['approval', 'artifactBytes', 'migrations', 'assignmentIntent'])) throw error('INVALID_SCOPE');
  const a = structuredClone(input.approval), intent = normalizeIntent(input.assignmentIntent);
  if (!exact(a, ['version', 'purpose', 'environment', 'identity', 'artifactSha256', 'securityPolicyFingerprint',
    'prestate', 'ledger', 'sql', 'assignmentPlanSha256', 'expiresAt', 'scopeSha256',
    'backup', 'maintenance', 'config', 'connectionMode', 'artifact'])
    || a.version !== 1 || !['production', 'test', 'sandbox'].includes(a.environment) || !sha(a.scopeSha256)
    || !sha(a.artifactSha256) || a.securityPolicyFingerprint !== securityPolicyFingerprint
    || !sha(a.assignmentPlanSha256) || a.assignmentPlanSha256 !== productionAssignmentIntentHash(intent)
    || typeof a.expiresAt !== 'string' || !Number.isFinite(Date.parse(a.expiresAt))) throw error('INVALID_SCOPE');
  if (!exact(a.backup, ['sha256', 'snapshotSha256', 'restorationEvidenceSha256'])
    || !Object.values(a.backup).every(sha)
    || !exact(a.maintenance, ['evidenceSha256', 'writesPaused', 'jobsPaused', 'exclusiveWindow'])
    || !sha(a.maintenance.evidenceSha256) || a.maintenance.writesPaused !== true
    || a.maintenance.jobsPaused !== true || a.maintenance.exclusiveWindow !== true
    || !exact(a.config, ['sha256', 'verified']) || !sha(a.config.sha256) || a.config.verified !== true
    || !exact(a.connectionMode, ['mode', 'verified', 'evidenceSha256'])
    || !['direct', 'session'].includes(a.connectionMode.mode) || a.connectionMode.verified !== true
    || !sha(a.connectionMode.evidenceSha256)
    || !exact(a.artifact, ['sourceCommit', 'inventorySha256'])
    || !/^[a-f0-9]{40}$/.test(a.artifact.sourceCommit) || !sha(a.artifact.inventorySha256)) throw error('INVALID_SCOPE');
  a.identity = normalizeDatabaseIdentity(a.identity);
  if (a.purpose === 'isolated-rehearsal' ? !['test', 'sandbox'].includes(a.environment) || !isLoopbackAddress(a.identity.address)
    : a.purpose !== 'production-release' || a.environment !== 'production') throw error('INVALID_SCOPE');
  a.prestate = validateReleaseSnapshot(a.prestate);
  if (a.backup.snapshotSha256 !== a.prestate.sha256 || !same(a.identity, a.prestate.identity) || !Array.isArray(a.ledger) || a.ledger.length !== 58
    || a.ledger.some(r => !exact(r, ['id', 'nombre', 'aplicada_at']) || !positive(r.id)
      || typeof r.nombre !== 'string' || typeof r.aplicada_at !== 'string' || !Number.isFinite(Date.parse(r.aplicada_at)))
    || new Set(a.ledger.map(r => r.id)).size !== 58 || new Set(a.ledger.map(r => r.nombre)).size !== 58) throw error('INVALID_SCOPE');
  const { scopeSha256, ...body } = a;
  if (productionReleaseScopeHash(body) !== scopeSha256) throw error('INVALID_SCOPE');
  if (!Buffer.isBuffer(input.artifactBytes) || hash(Buffer.from(input.artifactBytes)) !== a.artifactSha256) throw error('ARTIFACT_CHANGED');
  let manifest;
  try { manifest = JSON.parse(input.artifactBytes.toString('utf8')); } catch { throw error('ARTIFACT_CHANGED'); }
  if (manifest?.version !== 2 || manifest.nodeMajor !== 24 || manifest.dependenciesInstalled !== true
    || !Array.isArray(manifest.files) || !manifest.files.length || !Array.isArray(manifest.directories)
    || !sha(manifest.dependencyProof?.sha256)
    || hash(canonical({ files: manifest.files, directories: manifest.directories,
      dependencyProof: manifest.dependencyProof, rootPackageSha256: manifest.rootPackageSha256,
      sourceRootPackageSha256: manifest.sourceRootPackageSha256 })) !== a.artifact.inventorySha256) throw error('ARTIFACT_CHANGED');
  const trusted = trustedTrain();
  if (!Array.isArray(input.migrations) || input.migrations.length !== 41) throw error('SQL_CHANGED');
  const migrations = input.migrations.map((m, i) => {
    if (!exact(m, ['name', 'bytes']) || m.name !== trusted[i].name || !Buffer.isBuffer(m.bytes)) throw error('SQL_CHANGED');
    const bytes = Buffer.from(m.bytes);
    if (!bytes.equals(trusted[i].bytes)) throw error('SQL_CHANGED');
    return { name: m.name, bytes };
  });
  if (!same(a.sql, migrations.map(m => ({ name: m.name, sha256: hash(m.bytes) })))) throw error('SQL_CHANGED');
  return { approval: a, migrations, intent };
}

const tableSQL = `SELECT c.relname AS name,c.oid::text AS oid,row_security_active(c.oid) AS filtered
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname COLLATE "C"`;
// Same logical security serialization as captureReleaseSnapshot. This reader
// deliberately supports our RW transaction; the public RO capturer is unchanged.
const securitySQL = `SELECT encode(sha256(convert_to(jsonb_build_object(
  'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'rls',c.relrowsecurity,'force',c.relforcerowsecurity,
  'columns',(SELECT jsonb_agg(jsonb_build_array(a.attname,a.attacl::text,a.attcollation::text,
    pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
  'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=c.oid),
  'constraints',(SELECT jsonb_agg(jsonb_build_array(k.conname,k.convalidated,k.condeferrable,
    pg_get_constraintdef(k.oid)) ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid=c.oid),
  'indexes',(SELECT jsonb_agg(jsonb_build_array(ic.relname,i.indisvalid,i.indisready,
    pg_get_indexdef(i.indexrelid)) ORDER BY ic.relname) FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid WHERE i.indrelid=c.oid),
  'triggers',(SELECT jsonb_agg(jsonb_build_array(g.tgname,g.tgenabled,pg_get_triggerdef(g.oid),
    md5(p.prosrc),p.prosecdef,p.proconfig) ORDER BY g.tgname)
    FROM pg_trigger g JOIN pg_proc p ON p.oid=g.tgfoid WHERE g.tgrelid=c.oid AND NOT g.tgisinternal)
  )::text,'UTF8')),'hex') AS hash FROM pg_class c WHERE c.oid=$1::oid`;

async function columns(db, oid) {
  return (await db.query(`SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,
    a.attnotnull AS "notNull" FROM pg_attribute a WHERE a.attrelid=$1::oid
    AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [oid])).rows;
}
async function dataHash(db, table, names, exclusion = '', params = [], physical = false) {
  // Names are validated snapshot/catalog identifiers, never raw user SQL.
  const projection = names ? names.map(qi).join(',') : '*';
  return (await db.query(`SELECT count(*)::text AS rows,
    encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h COLLATE "C"),''),'UTF8')),'hex') AS hash
    FROM (SELECT encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') AS h
      FROM (SELECT ${projection}${physical ? ',xmin::text AS __release_xmin,ctid::text AS __release_ctid' : ''}
        FROM ONLY public.${qi(table)} ${exclusion}) r) hashed`, params)).rows[0];
}
async function acl(db, oid, names) {
  // Retain old columns only: additive nullable columns are intentional DDL.
  return (await db.query(`SELECT jsonb_build_object('owner',c.relowner::text,'acl',c.relacl::text,
    'rls',c.relrowsecurity,'force',c.relforcerowsecurity,
    'columns',(SELECT jsonb_agg(jsonb_build_array(a.attname,a.attacl::text) ORDER BY a.attnum)
      FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname=ANY($2::text[])),
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=c.oid)
    ) AS value FROM pg_class c WHERE c.oid=$1::oid`, [oid, names])).rows[0]?.value;
}
async function ledger(db) {
  return (await db.query(`SELECT id,nombre,to_char(aplicada_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS aplicada_at FROM public._migrations ORDER BY nombre`)).rows;
}

/** No production execution is performed by tests/import. Caller supplies a
 * dedicated session pool and an EXTERNAL durable one-use approval consumer.
 * consumeApproval must throw unless authentic, exact, unexpired and atomically
 * consumed; it must not make DB changes or acquire a second transaction here.
 */
export async function executeProductionRelease(pool, input, { environment, consumeApproval, now = () => Date.now() } = {}) {
  const { approval: a, migrations, intent } = freezeInputs(input);
  if (typeof consumeApproval !== 'function' || typeof now !== 'function') throw error('APPROVAL_CONSUMER_REQUIRED');
  if (environment !== a.environment) throw error('ENVIRONMENT_CHANGED');
  const fresh = () => { if (now() >= Date.parse(a.expiresAt)) throw error('APPROVAL_EXPIRED'); };
  fresh();
  let db, began = false, destroy = false, committing = false;
  try {
    db = await pool.connect();
    destroy = true;
    await db.query('BEGIN ISOLATION LEVEL READ COMMITTED'); began = true; destroy = false;
    await db.query(`SET LOCAL search_path TO public`);
    await db.query(`SET LOCAL lock_timeout TO '10s'`);
    await db.query(`SET LOCAL statement_timeout TO '120s'`);
    await db.query(`SET LOCAL TIME ZONE 'UTC'`);
    await db.query(`SET LOCAL DateStyle TO 'ISO, MDY'`);
    await db.query(`SET LOCAL IntervalStyle TO 'postgres'`);
    await db.query(`SET LOCAL extra_float_digits TO 3`);
    if (!same(await readMigrationIdentity(db), a.identity)) throw error('IDENTITY_CHANGED');
    await db.query('SELECT pg_advisory_xact_lock(728194, 1)');
    const initial = (await db.query(tableSQL)).rows;
    if (!initial.length || initial.length > 1000 || initial.some(t => !/^[1-9]\d*$/.test(t.oid)
      || typeof t.name !== 'string' || !t.name || /[\u0000-\u001f\u007f]/.test(t.name))) throw error('PRESTATE_CHANGED');
    await db.query(`LOCK TABLE ${initial.map(t => `public.${qi(t.name)}`).join(',')} IN EXCLUSIVE MODE`);
    const locked = (await db.query(tableSQL)).rows;
    if (!same(initial, locked) || locked.some(t => t.filtered !== false)) throw error('PRESTATE_CHANGED');
    fresh();
    const observations = [], originals = [];
    // The RO snapshot uses pg_catalog deparsing; match it exactly, then restore
    // public for the trusted migration chain. No RO/RW transaction switching.
    await db.query('SET LOCAL search_path TO pg_catalog');
    for (const table of locked) {
      const cols = await columns(db, table.oid), names = cols.map(c => c.name);
      const data = await dataHash(db, table.name);
      const security = (await db.query(securitySQL, [table.oid])).rows[0];
      observations.push({ name: table.name, columns: cols, rows: data.rows, dataSha256: data.hash, securitySha256: security?.hash });
      originals.push({ ...table, columns: cols, names, data,
        physical: await dataHash(db, table.name, names, '', [], true), acl: await acl(db, table.oid, names) });
    }
    const body = { version: 1, identity: a.identity, tables: observations };
    if (hash(JSON.stringify(body)) !== a.prestate.sha256) throw error('PRESTATE_CHANGED');
    if (!same((await db.query(tableSQL)).rows, locked)) throw error('PRESTATE_CHANGED');
    await db.query('SET LOCAL search_path TO public');
    const oldLedger = await ledger(db);
    // Timestamp normalization is exact microsecond UTC, matching approval.
    if (!same(oldLedger, a.ledger)) throw error('LEDGER_CHANGED');
    const status = await readMigrationStatus(db);
    if (!status.ledgerExists || status.unknownApplied.length || !same(status.pending, a.sql)) throw error('LEDGER_CHANGED');
    const universe = (await db.query('SELECT id FROM public.tareas ORDER BY id')).rows.map(r => r.id);
    const coverage = [...intent.choices, ...intent.exceptions].map(c => c.task_id).sort((x,y) => x-y);
    if (!same(universe, coverage)) throw error('TASK_UNIVERSE_CHANGED');
    fresh();
    // Only this externally implemented, durable capability can grant authority.
    // Burned approval after any failure must be independently re-issued.
    if (await consumeApproval(Object.freeze({ scopeSha256: a.scopeSha256, expiresAt: a.expiresAt })) !== true)
      throw error('APPROVAL_REJECTED');
    fresh();
    const inventory = await readApplicationObjectInventory(db);
    for (const migration of migrations) {
      await db.query(migration.bytes.toString('utf8'));
      await protectNewApplicationObjects(db, inventory);
      await db.query('INSERT INTO public._migrations(nombre) VALUES($1)', [migration.name]);
    }
    // Assignment intent contains only IDs. No name inference/backfill fallback.
    const ids = [...new Set(intent.choices.flatMap(c => [c.owner_id, ...c.collaborator_ids]))].sort((x,y) => x-y);
    const users = (await db.query('SELECT id FROM public.usuarios WHERE id=ANY($1::int[]) AND activo IS TRUE ORDER BY id FOR SHARE', [ids])).rows.map(r => r.id);
    if (!same(users, ids)) throw error('ASSIGNMENT_USER_UNAVAILABLE');
    const selected = intent.choices.map(c => c.task_id);
    if ((await db.query('SELECT tarea_id FROM public.tarea_asignaciones WHERE tarea_id=ANY($1::int[]) LIMIT 1', [selected])).rows.length)
      throw error('ASSIGNMENTS_EXIST');
    const newBindings = intent.choices.flatMap(c => [[c.task_id, c.owner_id, 'responsable'],
      ...c.collaborator_ids.map(id => [c.task_id, id, 'colaborador'])]);
    if (newBindings.length > 20000) throw error('ASSIGNMENT_POSTCONDITION');
    const parameters = newBindings.flat();
    const values = newBindings.map((_, i) => `($${3*i+1},$${3*i+2},$${3*i+3})`).join(',');
    const inserted = await db.query(`INSERT INTO public.tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES ${values}`, parameters);
    if (inserted.rowCount !== newBindings.length) throw error('ASSIGNMENT_POSTCONDITION');
    const actualBindings = (await db.query(`SELECT tarea_id,usuario_id,tipo FROM public.tarea_asignaciones
      WHERE tarea_id=ANY($1::int[]) ORDER BY tarea_id,usuario_id`, [selected])).rows;
    const expectedBindings = newBindings.map(([tarea_id,usuario_id,tipo]) => ({ tarea_id,usuario_id,tipo })).sort((x,y) => x.tarea_id-y.tarea_id || x.usuario_id-y.usuario_id);
    if (!same(actualBindings, expectedBindings)) throw error('ASSIGNMENT_POSTCONDITION');
    if (!originals.some(t => t.name === 'tarea_asignaciones')
      && (await db.query('SELECT count(*)::int AS n FROM public.tarea_asignaciones')).rows[0]?.n !== newBindings.length)
      throw error('ASSIGNMENT_POSTCONDITION');
    for (const old of originals) {
      const currentCols = await columns(db, old.oid);
      if (!old.columns.every(c => currentCols.some(n => same(c, n))) || !same(await acl(db, old.oid, old.names), old.acl))
        throw error('OLD_SECURITY_CHANGED');
      let exclusion = '', params = [];
      if (old.name === '_migrations') { exclusion = 'WHERE NOT (nombre=ANY($1::text[]))'; params = [migrations.map(m => m.name)]; }
      if (old.name === 'tarea_asignaciones') { exclusion = 'WHERE NOT (tarea_id=ANY($1::int[]))'; params = [selected]; }
      if (!same(await dataHash(db, old.name, old.names, exclusion, params), old.data)) throw error('OLD_ROWS_CHANGED');
      if (!same(await dataHash(db, old.name, old.names, exclusion, params, true), old.physical)) throw error('OLD_ROWS_CHANGED');
      const currentOid = (await db.query('SELECT to_regclass($1)::oid::text AS oid', [`public.${qi(old.name)}`])).rows[0]?.oid;
      if (currentOid !== old.oid) throw error('OLD_OBJECT_REPLACED');
    }
    const finalLedger = await ledger(db);
    if (finalLedger.length !== 99 || !same(finalLedger.filter(r => !a.sql.some(m => m.name === r.nombre)), oldLedger)
      || !same(finalLedger.map(r => r.nombre).sort(), [...oldLedger.map(r => r.nombre), ...a.sql.map(r => r.name)].sort())) throw error('LEDGER_POSTCONDITION');
    fresh();
    // A failed COMMIT is ambiguous even if the driver reports a server error.
    // Never issue ROLLBACK/auto-retry or return this connection to the pool.
    committing = true;
    await db.query('COMMIT'); began = false;
    return Object.freeze({ state: 'COMMITTED', scopeSha256: a.scopeSha256, migrations: 41, assignments: newBindings.length });
  } catch (cause) {
    if (committing) { destroy = true; throw error('OUTCOME_UNKNOWN'); }
    if (began) { try { await db.query('ROLLBACK'); } catch { destroy = true; } }
    throw error(['INVALID_SCOPE', 'APPROVAL_EXPIRED', 'IDENTITY_CHANGED', 'PRESTATE_CHANGED', 'LEDGER_CHANGED',
      'TASK_UNIVERSE_CHANGED', 'APPROVAL_REJECTED', 'ASSIGNMENT_USER_UNAVAILABLE', 'ASSIGNMENTS_EXIST',
      'ASSIGNMENT_POSTCONDITION', 'OLD_SECURITY_CHANGED', 'OLD_ROWS_CHANGED', 'OLD_OBJECT_REPLACED',
      'LEDGER_POSTCONDITION'].includes(cause?.code) ? cause.code : 'RELEASE_ABORTED');
  } finally {
    // A pool bookkeeping failure after a successful COMMIT must not turn a
    // confirmed release into a raw-error/false-failure response.
    if (db) { try { db.release(destroy ? error('DISCARD_RELEASE_CONNECTION') : undefined); } catch { /* No retry, no raw error. */ } }
  }
}
