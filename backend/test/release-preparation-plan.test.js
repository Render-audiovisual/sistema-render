import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { RELEASE_PREPARATION_VERSION, RELEASE_PREPARATION_LIMITS,
  prepareReleasePreparationPlan, assertReleasePreparationPlanCurrent } from '../src/release-preparation-plan.js';

const h = text => createHash('sha256').update(text).digest('hex');
function fixture() {
  return {
    version: 1, action: 'prepare', artifact: { manifestHash: h('current files manifest'), sourceCommit: 'a'.repeat(40) },
    sql: [{ name: '093_previous.sql', sha256: h('previous sql') }, { name: '20261027144706_ledger.sql', sha256: h('next sql') }],
    observation: { identity: { database: 'fixture_metadata', username: 'read_only_observer', address: '127.0.0.1', port: 55991 },
      snapshotHash: h('full-state incl task rows and IDs'), currentSourceCommit: 'b'.repeat(40) },
    assignmentPlanHash: h('explicit assignments'), configReport: { status: 'pass', sha256: h('redacted config report') },
    backup: { status: 'missing', sha256: null, snapshotHash: null },
    authority: { status: 'missing', evidenceHash: null, scopeHash: null }, maintenance: [],
  };
}
function allReported() {
  const input = fixture(); input.backup = { status: 'reported', sha256: h('backup bytes'), snapshotHash: input.observation.snapshotHash };
  const scopeHash = prepareReleasePreparationPlan(input).scopeHash;
  input.authority = { status: 'reported', evidenceHash: h('external authority report'), scopeHash };
  input.maintenance = ['writes_paused', 'jobs_paused', 'exclusive_window'].map(kind => ({ kind, status: 'reported', evidenceHash: h(kind), scopeHash }));
  return input;
}
function reversedKeys(value) {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).reverse().map(key => [key, reversedKeys(value[key])]));
  return value;
}
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);

test('versioned metadata-only export produces reproducible exact hash and normalized checklist', () => {
  assert.equal(RELEASE_PREPARATION_VERSION, 1);
  const input = fixture(), plan = prepareReleasePreparationPlan(input);
  assert.deepEqual(plan, prepareReleasePreparationPlan(reversedKeys(input)));
  const { planHash, ...payload } = plan;
  assert.equal(planHash, h(canonical(payload)), 'Hash binds every returned field except itself');
  assert.deepEqual(plan.metadata.observation, input.observation);
  assert.notEqual(plan.metadata.artifact.sourceCommit, plan.metadata.observation.currentSourceCommit);
  assert.deepEqual(plan.checklist.map(row => row.key), ['artifact_manifest', 'ordered_sql', 'database_snapshot',
    'assignment_plan', 'configuration', 'backup', 'authority', 'writes_paused', 'jobs_paused', 'exclusive_window']);
  assert.equal(plan.checklist.find(row => row.key === 'database_snapshot').status, 'requires_fresh_readonly_comparison');
});

test('matching metadata and every reported attestation NEVER authorize execution or prove current DB freshness', () => {
  const input = allReported(), plan = prepareReleasePreparationPlan(input);
  assert.equal(plan.state, 'NOT_EXECUTABLE'); assert.equal(plan.executable, false); assert.equal(plan.authorized, false);
  assert.ok(plan.blockers.includes('EXTERNAL_AUTHORITY_VERIFICATION_REQUIRED'));
  assert.ok(plan.blockers.includes('FRESH_READONLY_SNAPSHOT_COMPARISON_REQUIRED'));
  assert.equal(plan.checklist.find(row => row.key === 'authority').status, 'reported_unverified');
  assert.deepEqual(assertReleasePreparationPlanCurrent({ expectedPlanHash: plan.planHash, input }), plan);
});

test('source/manifest/SQL order or bytes, DB identity, tasks/new IDs, config/backup/assignment changes invalidate', () => {
  const baseline = prepareReleasePreparationPlan(fixture());
  const changes = [
    x => { x.artifact.manifestHash = h('changed manifest'); },
    x => { x.artifact.sourceCommit = 'c'.repeat(40); },
    x => { x.observation.currentSourceCommit = 'c'.repeat(40); },
    x => { x.sql.reverse(); }, x => { x.sql[0].sha256 = h('changed SQL'); },
    x => { x.sql[0].name = '094_changed.sql'; }, x => { x.sql.pop(); },
    ...['changed task content', 'new task ID', 'new user ID', 'new table or security policy'].map(change => x => { x.observation.snapshotHash = h(change); }),
    x => { x.observation.identity.database = 'other_db'; }, x => { x.observation.identity.username = 'other_user'; },
    x => { x.observation.identity.address = '::1'; }, x => { x.observation.identity.port = 55992; },
    x => { x.assignmentPlanHash = h('changed assignment ID'); }, x => { x.configReport.sha256 = h('new config report'); },
    x => { x.backup = { status: 'reported', sha256: h('backup'), snapshotHash: x.observation.snapshotHash }; },
  ];
  for (const change of changes) {
    const input = fixture(); change(input);
    assert.notEqual(prepareReleasePreparationPlan(input).planHash, baseline.planHash);
    assert.throws(() => assertReleasePreparationPlanCurrent({ expectedPlanHash: baseline.planHash, input }), { status: 409, code: 'RELEASE_PREPARATION_STALE' });
  }
});

test('authority/maintenance are bound to current scope, not a boolean or stale old-source attestation', () => {
  const input = allReported(), plan = prepareReleasePreparationPlan(input);
  input.observation.snapshotHash = h('fresh comparison finds new task');
  const changed = prepareReleasePreparationPlan(input);
  assert.notEqual(changed.scopeHash, plan.scopeHash);
  for (const key of ['authority', 'writes_paused', 'jobs_paused', 'exclusive_window', 'backup']) {
    assert.equal(changed.checklist.find(row => row.key === key).status, 'scope_mismatch');
  }
  const altered = allReported(); altered.authority.evidenceHash = h('different authority evidence');
  assert.notEqual(prepareReleasePreparationPlan(altered).planHash, plan.planHash);
  assert.equal(prepareReleasePreparationPlan(altered).scopeHash, plan.scopeHash, 'No circular attestation hash');
  for (const mutate of [x => { x.authority = true; }, x => { x.maintenance = true; }, x => { x.authorized = true; },
    x => { x.authority.status = true; }, x => { x.maintenance[0].status = true; }]) {
    const invalid = allReported(); mutate(invalid); assert.throws(() => prepareReleasePreparationPlan(invalid), { status: 400 });
  }
});

test('deep frozen defensive copies cannot be changed by caller or mutated through result', () => {
  const input = allReported(), before = structuredClone(input), plan = prepareReleasePreparationPlan(input);
  function verifyFrozen(value) {
    if (value && typeof value === 'object') { assert.equal(Object.isFrozen(value), true); Object.values(value).forEach(verifyFrozen); }
  }
  verifyFrozen(plan); assert.deepEqual(input, before); assert.equal(Object.isFrozen(input), false);
  input.sql[0].sha256 = h('caller mutation'); input.observation.identity.port = 1; input.maintenance[0].evidenceHash = h('caller mutation');
  assert.deepEqual(plan, prepareReleasePreparationPlan(before));
  assert.throws(() => { plan.metadata.sql.push({}); }, TypeError);
  assert.throws(() => { plan.metadata.observation.identity.port = 1; }, TypeError);
});

test('apply/execute/production requests are rejected, with no executor export or side effects', () => {
  for (const action of ['apply', 'execute', 'deploy', 'migrate', 'production', true, null]) {
    const input = fixture(); input.action = action;
    assert.throws(() => prepareReleasePreparationPlan(input), { status: 403, code: 'RELEASE_PREPARATION_NOT_EXECUTABLE' });
  }
});

test('closed records reject unknown/missing/secret/raw-snapshot fields and prototype/accessor tricks without invoking getters', () => {
  const mutations = [
    x => { x.DATABASE_URL = 'DO_NOT_ECHO'; }, x => { x.artifact.secret = 'DO_NOT_ECHO'; },
    x => { x.configReport.values = { password: 'DO_NOT_ECHO' }; }, x => { x.observation.tables = []; },
    x => { x.observation.task_ids = [9]; }, x => { delete x.assignmentPlanHash; },
    x => { x.observation.identity.url = 'postgres://user:DO_NOT_ECHO@host/db'; },
    x => { x.observation.identity.address = 'https://user:DO_NOT_ECHO@host'; },
    x => { x.artifact.manifestHash = '4eacd'; }, x => { x.artifact.sourceCommit = 'main'; },
    x => { x[Symbol('extra')] = true; }, x => { Object.defineProperty(x, 'hidden', { value: true }); },
    x => { Object.setPrototypeOf(x.observation, { secret: 'DO_NOT_ECHO' }); },
  ];
  for (const mutation of mutations) {
    const input = fixture(); mutation(input);
    assert.throws(() => prepareReleasePreparationPlan(input), error => error.status === 400 && !error.message.includes('DO_NOT_ECHO'));
  }
  const input = fixture(); let invoked = false;
  Object.defineProperty(input.artifact, 'manifestHash', { enumerable: true, get() { invoked = true; throw Error('DO_NOT_ECHO'); } });
  assert.throws(() => prepareReleasePreparationPlan(input), { status: 400 }); assert.equal(invoked, false);
});

test('bounded dense arrays, int ports, scalar hashes and exact status/evidence pairs fail closed', () => {
  const changes = [
    x => { x.sql = Array.from({ length: RELEASE_PREPARATION_LIMITS.sqlFiles + 1 }, (_, n) => ({ name: `${n}_a.sql`, sha256: h('sql') })); },
    x => { x.sql = Array(2); }, x => { x.sql.push({ ...x.sql[0] }); }, x => { x.sql.custom = true; },
    x => { x.sql[0].name = '../migrations/001_a.sql'; }, x => { x.sql[0].name = '1_' + 'x'.repeat(160) + '.sql'; },
    x => { x.sql[0].sha256 = 'A'.repeat(64); }, x => { x.observation.identity.port = '5432'; },
    x => { x.observation.identity.port = 65536; }, x => { x.observation.identity.port = NaN; },
    x => { x.observation.identity.database = 'x'.repeat(64); }, x => { x.observation.identity.username = 'user\nname'; },
    x => { x.configReport = { status: 'pass', sha256: null }; }, x => { x.configReport.status = 'verified'; },
    x => { x.backup = { status: 'missing', sha256: h('backup'), snapshotHash: null }; },
    x => { x.authority = { status: 'reported', evidenceHash: h('report'), scopeHash: null }; },
    x => { x.maintenance = Array(4).fill({ kind: 'writes_paused', status: 'missing', evidenceHash: null, scopeHash: null }); },
    x => { x.maintenance = Array(2).fill({ kind: 'writes_paused', status: 'missing', evidenceHash: null, scopeHash: null }); },
  ];
  for (const change of changes) { const input = fixture(); change(input); assert.throws(() => prepareReleasePreparationPlan(input), { status: 400 }); }
});

test('empty SQL list is metadata, unknown config blocks, maintenance normalization is deterministic', () => {
  const input = allReported(), baseline = prepareReleasePreparationPlan(input);
  input.maintenance.reverse(); assert.equal(prepareReleasePreparationPlan(input).planHash, baseline.planHash);
  input.sql = []; input.configReport = { status: 'unknown', sha256: null };
  const plan = prepareReleasePreparationPlan(input);
  assert.equal(plan.metadata.sql.length, 0); assert.ok(plan.blockers.includes('CHECK_CONFIGURATION_UNKNOWN'));
  assert.equal(plan.blockers.includes('SQL_ORDER_REVIEW_REQUIRED'), false, 'Up-to-date DB may have zero pending migrations');
  assert.equal(plan.state, 'NOT_EXECUTABLE');
});

test('nonlex SQL order is preserved and explicitly blocked, never silently normalized for a runner', () => {
  const input = fixture(); input.sql.reverse();
  const plan = prepareReleasePreparationPlan(input);
  assert.deepEqual(plan.metadata.sql, input.sql);
  assert.ok(plan.blockers.includes('SQL_ORDER_REVIEW_REQUIRED'));
  assert.equal(plan.checklist.find(row => row.key === 'ordered_sql').status, 'order_review');
  const sorted = fixture();
  assert.equal(prepareReleasePreparationPlan(sorted).blockers.includes('SQL_ORDER_REVIEW_REQUIRED'), false);
  assert.notEqual(plan.planHash, prepareReleasePreparationPlan(sorted).planHash);
  assert.equal(plan.executable, false); assert.equal(plan.authorized, false);
});

test('staleness wrapper is itself closed and rejects invalid expected digest', () => {
  assert.throws(() => assertReleasePreparationPlanCurrent({ expectedPlanHash: 'short', input: fixture() }), { status: 400 });
  assert.throws(() => assertReleasePreparationPlanCurrent({ expectedPlanHash: h('x'), input: fixture(), apply: true }), { status: 400 });
});
