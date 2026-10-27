import { createHash } from 'node:crypto';

/** Pure metadata contract. No file/env/DB reads, SQL, execution or credentials.
 * Main owns captureReleaseSnapshot/compareReleaseSnapshot and manifest reads.
 * A digest is a binding, NOT authenticity, currentness, consent or authority.
 *
 * prepareReleasePreparationPlan({
 *   version:1, action:'prepare', artifact:{manifestHash,sourceCommit},
 *   sql:[{name,sha256}], // exact order is hash-significant; nonlex adds blocker
 *   observation:{identity:{database,username,address,port},snapshotHash,currentSourceCommit},
 *   assignmentPlanHash, configReport:{status:'pass'|'blocked'|'unknown',sha256:null|hash},
 *   backup:{status:'missing'|'reported',sha256:null|hash,snapshotHash:null|hash},
 *   authority:{status:'missing'|'reported',evidenceHash:null|hash,scopeHash:null|hash},
 *   maintenance:[{kind:'writes_paused'|'jobs_paused'|'exclusive_window',
 *     status:'missing'|'reported',evidenceHash:null|hash,scopeHash:null|hash}]
 * })
 * scopeHash binds metadata EXCEPT authority/maintenance, avoiding circular
 * attestations. Collect external evidence against this scope, then re-prepare.
 * planHash binds the ENTIRE normalized metadata AND fixed checklist/blockers.
 * No evidence is verified here, even when its status says reported/pass.
 */
export const RELEASE_PREPARATION_VERSION = 1;
export const RELEASE_PREPARATION_LIMITS = Object.freeze({ sqlFiles: 512, maintenanceAttestations: 3 });
const MAINTENANCE = Object.freeze(['writes_paused', 'jobs_paused', 'exclusive_window']);
const invalid = () => Object.assign(new Error('Invalid release preparation metadata.'), { status: 400, code: 'RELEASE_PREPARATION_INVALID' });
const rejectExecution = () => Object.assign(new Error('Release preparation cannot authorize or apply changes.'),
  { status: 403, code: 'RELEASE_PREPARATION_NOT_EXECUTABLE' });
const digest = value => createHash('sha256').update(value).digest('hex');
const hash = value => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw invalid();
  return value;
};
const nullableHash = value => value === null ? null : hash(value);
const commit = value => {
  if (typeof value !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) throw invalid();
  return value;
};
function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw invalid();
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) throw invalid();
  const result = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw invalid();
    result[key] = descriptor.value;
  }
  return result;
}
function list(value, limit) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > limit) throw invalid();
  if (Reflect.ownKeys(value).length !== value.length + 1) throw invalid();
  const result = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw invalid();
    result.push(descriptor.value);
  }
  return result;
}
function enumeration(value, allowed) {
  if (!allowed.includes(value)) throw invalid();
  return value;
}
function identifier(value, max = 63) {
  if (typeof value !== 'string' || value.length > max || !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(value)) throw invalid();
  return value;
}
function identity(value) {
  const row = record(value, ['database', 'username', 'address', 'port']);
  // Address is metadata only, not a DSN, socket path, hostname URL or credential.
  if (typeof row.address !== 'string' || row.address.length > 253
    || !/^[A-Za-z0-9:.][A-Za-z0-9:.-]*$/.test(row.address)
    || !Number.isSafeInteger(row.port) || row.port < 1 || row.port > 65535) throw invalid();
  return { database: identifier(row.database), username: identifier(row.username), address: row.address, port: row.port };
}
function attestation(value, withKind = false) {
  const row = record(value, [...(withKind ? ['kind'] : []), 'status', 'evidenceHash', 'scopeHash']);
  const status = enumeration(row.status, ['missing', 'reported']);
  const evidenceHash = nullableHash(row.evidenceHash), scopeHash = nullableHash(row.scopeHash);
  if (status === 'missing' ? evidenceHash !== null || scopeHash !== null : evidenceHash === null || scopeHash === null) throw invalid();
  return { ...(withKind ? { kind: enumeration(row.kind, MAINTENANCE) } : {}), status, evidenceHash, scopeHash };
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
// Only normalized scalar/plain-array/plain-record copies reach this serializer.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function prepareReleasePreparationPlan(value) {
  const input = record(value, ['version', 'action', 'artifact', 'sql', 'observation', 'assignmentPlanHash',
    'configReport', 'backup', 'authority', 'maintenance']);
  if (input.action !== 'prepare') throw rejectExecution();
  if (input.version !== RELEASE_PREPARATION_VERSION) throw invalid();
  const artifact = record(input.artifact, ['manifestHash', 'sourceCommit']);
  const observation = record(input.observation, ['identity', 'snapshotHash', 'currentSourceCommit']);
  const config = record(input.configReport, ['status', 'sha256']);
  const backup = record(input.backup, ['status', 'sha256', 'snapshotHash']);
  const sql = list(input.sql, RELEASE_PREPARATION_LIMITS.sqlFiles).map(value => {
    const row = record(value, ['name', 'sha256']);
    if (typeof row.name !== 'string' || row.name.length > 160 || !/^[0-9]+_[A-Za-z0-9_]+\.sql$/.test(row.name)) throw invalid();
    return { name: row.name, sha256: hash(row.sha256) };
  });
  if (new Set(sql.map(row => row.name)).size !== sql.length) throw invalid();
  const configReport = { status: enumeration(config.status, ['pass', 'blocked', 'unknown']), sha256: nullableHash(config.sha256) };
  if (configReport.status !== 'unknown' && configReport.sha256 === null) throw invalid();
  const normalizedBackup = { status: enumeration(backup.status, ['missing', 'reported']),
    sha256: nullableHash(backup.sha256), snapshotHash: nullableHash(backup.snapshotHash) };
  if (normalizedBackup.status === 'missing' ? normalizedBackup.sha256 !== null || normalizedBackup.snapshotHash !== null
    : normalizedBackup.sha256 === null || normalizedBackup.snapshotHash === null) throw invalid();
  const reportedMaintenance = list(input.maintenance, RELEASE_PREPARATION_LIMITS.maintenanceAttestations).map(row => attestation(row, true));
  if (new Set(reportedMaintenance.map(row => row.kind)).size !== reportedMaintenance.length) throw invalid();
  const maintenance = MAINTENANCE.filter(kind => reportedMaintenance.some(row => row.kind === kind))
    .map(kind => reportedMaintenance.find(row => row.kind === kind));
  const core = {
    version: input.version, action: 'prepare', artifact: { manifestHash: hash(artifact.manifestHash), sourceCommit: commit(artifact.sourceCommit) }, sql,
    observation: { identity: identity(observation.identity), snapshotHash: hash(observation.snapshotHash), currentSourceCommit: commit(observation.currentSourceCommit) },
    assignmentPlanHash: hash(input.assignmentPlanHash), configReport, backup: normalizedBackup,
  };
  const scopeHash = digest(canonical({ contract: 'release-preparation-scope-v1', metadata: core }));
  const metadata = { ...core, authority: attestation(input.authority), maintenance };
  // Same code-point ordering as the runner's filename .sort(), not localeCompare.
  // Preserve unsorted input verbatim for review rather than silently reordering.
  const sqlOrdered = sql.every((row, index) => index === 0 || sql[index - 1].name < row.name);
  const checklist = [
    { key: 'artifact_manifest', status: 'recorded_unverified' },
    { key: 'ordered_sql', status: sqlOrdered ? 'recorded_unverified' : 'order_review' },
    { key: 'database_snapshot', status: 'requires_fresh_readonly_comparison' },
    { key: 'assignment_plan', status: 'recorded_unverified' },
    { key: 'configuration', status: configReport.status === 'pass' ? 'reported_unverified' : configReport.status },
    { key: 'backup', status: normalizedBackup.status === 'missing' ? 'missing'
      : normalizedBackup.snapshotHash === core.observation.snapshotHash ? 'reported_unverified' : 'scope_mismatch' },
    { key: 'authority', status: metadata.authority.status === 'missing' ? 'missing'
      : metadata.authority.scopeHash === scopeHash ? 'reported_unverified' : 'scope_mismatch' },
    ...MAINTENANCE.map(kind => {
      const report = maintenance.find(row => row.kind === kind);
      return { key: kind, status: !report || report.status === 'missing' ? 'missing'
        : report.scopeHash === scopeHash ? 'reported_unverified' : 'scope_mismatch' };
    }),
  ];
  const blockers = ['EXECUTION_NOT_SUPPORTED', 'FRESH_READONLY_SNAPSHOT_COMPARISON_REQUIRED', 'EXTERNAL_AUTHORITY_VERIFICATION_REQUIRED',
    ...(!sqlOrdered ? ['SQL_ORDER_REVIEW_REQUIRED'] : []),
    ...checklist.filter(row => ['missing', 'blocked', 'unknown', 'scope_mismatch'].includes(row.status)).map(row => `CHECK_${row.key.toUpperCase()}_${row.status.toUpperCase()}`)];
  const plan = { version: RELEASE_PREPARATION_VERSION, kind: 'release_preparation', state: 'NOT_EXECUTABLE',
    executable: false, authorized: false, scopeHash, metadata, checklist, blockers };
  return freeze({ ...plan, planHash: digest(canonical(plan)) });
}

/** Metadata equality only. Main must separately re-capture/compare full DB
 * state, then pass its current digest here; replaying old input proves nothing
 * about live state. Changed tasks/new IDs affect snapshotHash and invalidate.
 */
export function assertReleasePreparationPlanCurrent(value) {
  const input = record(value, ['expectedPlanHash', 'input']);
  const expected = hash(input.expectedPlanHash), current = prepareReleasePreparationPlan(input.input);
  if (current.planHash !== expected) throw Object.assign(new Error('Release preparation metadata changed; prepare a new plan.'),
    { status: 409, code: 'RELEASE_PREPARATION_STALE' });
  return current; // Still NOT_EXECUTABLE, even for a matching hash.
}
