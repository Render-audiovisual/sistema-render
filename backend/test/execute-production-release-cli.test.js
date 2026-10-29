import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm, symlink, access } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildHostingerOutput } from '../../scripts/build-hostinger-output.mjs';
import { parseProductionReleaseArgs, runProductionReleaseCli, verifyInstalledReleaseArtifact } from '../scripts/execute-production-release.js';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const root = await mkdtemp('/private/tmp/render-execution-cli-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), artifact = path.join(root, 'artifact'), privateRoot = path.join(root, 'private');
  await mkdir(privateRoot, { mode: 0o700 });
  for (const directory of ['backend/src', 'backend/scripts', 'backend/migrations', 'shared', 'frontend/dist/assets']) await mkdir(path.join(source, directory), { recursive: true });
  for (const [name, contents] of Object.entries({
    'package.json': JSON.stringify({ version: '0.0.0', engines: { node: '>=24 <25' } }),
    'backend/package.json': '{"name":"isolated-release-qa","type":"module","dependencies":{}}', 'backend/package-lock.json': '{}',
    'backend/src/server.js': '// QA only', 'backend/src/runtime-entrypoint.js': '// QA controlled runtime only',
    'backend/src/production-release-executor.js': 'export async function executeProductionRelease(){throw Error("QA_STUB_NOT_ACTUAL_EXECUTOR");}',
    'backend/scripts/migrate.js': '// QA only', 'backend/migrations/000_qa.sql': 'SELECT 1;', 'shared/qa.js': '// QA only',
    'frontend/dist/index.html': '<script type="module" src="/assets/index-QA.js"></script>', 'frontend/dist/assets/index-QA.js': '// QA only',
  })) await writeFile(path.join(source, name), contents);
  const output = buildHostingerOutput({ sourceRoot: source, outputRoot: artifact, installDependencies: true, install: () => {} });
  const requestFile = path.join(privateRoot, 'request.json'), approvalFile = path.join(privateRoot, 'approval.json'), receipt = path.join(privateRoot, 'receipt.json');
  const request = { version: 1, environment: 'test', manifestSha256: output.manifestSha256,
    assignmentIntent: { choices: [{ task_id: 1, owner_id: 2, collaborator_ids: [] }], exceptions: [] } };
  const requestBytes = JSON.stringify(request);
  const approval = { version: 1, purpose: 'isolated-rehearsal', environment: 'test', requestSha256: digest(requestBytes),
    nonce: 'a'.repeat(64), issuedAt: 1000, expiresAt: 61000, executorApproval: { environment: 'test', purpose: 'isolated-rehearsal',
      scopeSha256: 'b'.repeat(64), expiresAt: new Date(61000).toISOString(), artifactSha256: output.manifestSha256,
      sql: [{ name: '000_qa.sql', sha256: digest('SELECT 1;') }], backup: { sha256: digest('QA synthetic private backup') } } };
  await writeFile(requestFile, requestBytes, { mode: 0o600 });
  await writeFile(approvalFile, JSON.stringify(approval), { mode: 0o600 });
  const backup = path.join(privateRoot, 'backup.dump'); await writeFile(backup, 'QA synthetic private backup', { mode: 0o600 });
  const argv = ['execute', '--request', requestFile, '--approval', approvalFile, '--artifact', artifact, '--backup', backup, '--receipt', receipt];
  const env = { RENDER_DB_ENVIRONMENT: 'test', DATABASE_URL: 'postgresql://qa:SECRET_CANARY@127.0.0.1:55996/qa' };
  const events = [], calls = [];
  const run = (options = {}) => runProductionReleaseCli({ argv, env, now: () => 2000,
    loadExecutor: async verifiedRoot => { calls.push(['load', verifiedRoot]); return { executeProductionRelease: async (pool, input, options) => {
      calls.push(['execute', pool, input, options]);
      await options.consumeApproval({ scopeSha256: input.approval.scopeSha256, expiresAt: input.approval.expiresAt });
      return { state: 'COMMITTED', scopeSha256: input.approval.scopeSha256 };
    } }; },
    createPool: async config => { calls.push(['connect', config]); return { end: async () => calls.push(['end']) }; },
    write: line => events.push(line), writeError: line => events.push(line), ...options });
  return { root, artifact, privateRoot, requestFile, approvalFile, backup, receipt, argv, env, events, calls, request, approval, run };
}

test('help is inert and execution accepts no force/environment/URL overrides or preparer commands', async () => {
  const lines = [];
  assert.equal(await runProductionReleaseCli({ argv: [], write: x => lines.push(x), createPool: () => assert.fail('help connected') }), 0);
  assert.match(lines[0], /isolated-rehearsal/);
  for (const argv of [['prepare'], ['check'], ['apply'], ['execute', '--force'], ['execute', '--environment', 'test'],
    ['execute', '--request', 'relative', '--approval', '/a', '--artifact', '/b', '--receipt', '/c']]) assert.throws(() => parseProductionReleaseArgs(argv));
});
test('actual Buffer bytes reach the real executor signature with unchanged test environment on isolated rehearsal', async t => {
  const f = await fixture(t);
  assert.equal(verifyInstalledReleaseArtifact(f.artifact, f.request.manifestSha256).root, f.artifact);
  assert.equal(await f.run(), 0);
  const args = f.calls.find(call => call[0] === 'execute')[2];
  assert.equal(args.approval.environment, 'test'); assert.equal(args.approval.purpose, 'isolated-rehearsal');
  assert.deepEqual(args.assignmentIntent, f.request.assignmentIntent); assert.deepEqual(args.approval, f.approval.executorApproval);
  assert.ok(Buffer.isBuffer(args.artifactBytes)); assert.equal(digest(args.artifactBytes), f.request.manifestSha256);
  assert.ok(Buffer.isBuffer(args.migrations[0].bytes)); assert.equal(args.migrations[0].bytes.toString(), 'SELECT 1;');
  assert.equal(JSON.parse(await readFile(f.receipt, 'utf8')).configurationActual, 'unverified-by-cli');
  assert.doesNotMatch(f.events.join(''), /SECRET_CANARY|QA_ONLY|postgresql:/);
});
test('one-use approval rejects replay and copied approval in its retained directory before connection', async t => {
  const f = await fixture(t); assert.equal(await f.run(), 0);
  const copyApproval = path.join(f.privateRoot, 'approval-copy.json'); await writeFile(copyApproval, await readFile(f.approvalFile), { mode: 0o600 });
  const count = f.calls.filter(call => call[0] === 'execute').length;
  const secondReceipt = path.join(f.privateRoot, 'second.json');
  assert.equal(await f.run({ argv: [...f.argv.slice(0, -1), secondReceipt] }), 1);
  const copiedArgs = [...f.argv]; copiedArgs[4] = copyApproval; copiedArgs[10] = path.join(f.privateRoot, 'copied-receipt.json');
  assert.equal(await f.run({ argv: copiedArgs }), 1);
  assert.equal(f.calls.filter(call => call[0] === 'execute').length, count);
  assert.equal(f.calls.filter(call => call[0] === 'connect').length, 1);
  assert.equal(JSON.parse(await readFile(f.receipt, 'utf8')).event, 'RELEASE_EXECUTION_COMPLETED');
});
test('failed execution burns approval, does not retry, redacts errors and closes pool', async t => {
  const f = await fixture(t); let attempts = 0;
  const loadExecutor = async () => ({ executeProductionRelease: async () => { attempts++; throw Error('SECRET_CANARY provider SQL'); } });
  assert.equal(await f.run({ loadExecutor }), 1);
  assert.equal(attempts, 1); assert.equal(f.calls.filter(call => call[0] === 'end').length, 1);
  const receipt = JSON.parse(await readFile(f.receipt, 'utf8'));
  assert.equal(receipt.approvalAttemptConsumed, true); assert.equal(receipt.stateRequiresInspection, true);
  assert.equal(await f.run({ loadExecutor, argv: [...f.argv.slice(0, -1), path.join(f.privateRoot, 'retry.json')] }), 1);
  assert.equal(attempts, 1); assert.doesNotMatch(f.events.join(''), /SECRET_CANARY|provider SQL/);
});
test('installed artifact mutation, extra file, missing file and symlink reject before executor loading', async t => {
  for (const variant of ['changed', 'extra', 'missing', 'symlink']) await t.test(variant, async t => {
    const f = await fixture(t), file = path.join(f.artifact, 'shared/qa.js');
    if (variant === 'changed') await writeFile(file, '// altered');
    if (variant === 'extra') await writeFile(path.join(f.artifact, 'unlisted'), 'unlisted');
    if (variant === 'missing') await rm(file);
    if (variant === 'symlink') { await rm(file); await symlink(path.join(f.artifact, 'backend/src/server.js'), file); }
    assert.equal(await f.run(), 1); assert.deepEqual(f.calls, []); await assert.rejects(access(f.receipt));
  });
});
test('approval environment, expiry, scope, permissions and remote rehearsal are fail-closed before connection', async t => {
  for (const variant of ['environment', 'expiry', 'scope', 'permissions', 'remote', 'symlink', 'directory']) await t.test(variant, async t => {
    const f = await fixture(t);
    if (variant === 'environment') f.approval.environment = 'production';
    if (variant === 'expiry') f.approval.expiresAt = 1999;
    if (variant === 'scope') f.approval.requestSha256 = 'b'.repeat(64);
    await writeFile(f.approvalFile, JSON.stringify(f.approval));
    if (variant === 'permissions') await chmod(f.approvalFile, 0o644);
    if (variant === 'directory') await chmod(f.privateRoot, 0o755);
    if (variant === 'symlink') { await rm(f.approvalFile); await symlink(f.requestFile, f.approvalFile); }
    const env = variant === 'remote' ? { ...f.env, DATABASE_URL: 'postgresql://qa:SECRET_CANARY@unverified.invalid:5432/qa' } : f.env;
    assert.equal(await f.run({ env }), 1); assert.deepEqual(f.calls, []); assert.doesNotMatch(f.events.join(''), /SECRET_CANARY|postgresql:/);
  });
});
test('receipt cannot overwrite or enter verified artifact and artifact changes during load are caught before connecting', async t => {
  const f = await fixture(t);
  await writeFile(f.receipt, 'DO_NOT_OVERWRITE', { mode: 0o600 });
  assert.equal(await f.run(), 1); assert.equal(await readFile(f.receipt, 'utf8'), 'DO_NOT_OVERWRITE');
  assert.equal(f.calls.some(row => row[0] === 'connect'), false);
  await rm(f.receipt);
  assert.equal(await f.run({ argv: [...f.argv.slice(0, -1), path.join(f.artifact, 'new-receipt.json')] }), 1);
  assert.equal(await f.run({ loadExecutor: async () => { await writeFile(path.join(f.artifact, 'shared/qa.js'), '// race'); return { executeProductionRelease: () => assert.fail('changed artifact executed') }; } }), 1);
  assert.equal(f.calls.some(row => row[0] === 'connect'), false);
});

test('uncertain COMMIT, unconfirmed abort and post-COMMIT receipt failure have distinct redacted outcomes', async t => {
  for (const [code, state] of [['OUTCOME_UNKNOWN', 'OUTCOME_UNKNOWN'], ['RELEASE_ABORTED', 'ABORTED_OR_UNCONFIRMED'],
    ['SECRET_CANARY', 'ABORTED_OR_UNCONFIRMED']]) await t.test(state + ':' + code, async t => {
    const f = await fixture(t);
    assert.equal(await f.run({ loadExecutor: async () => ({ executeProductionRelease: async () => {
      throw Object.assign(Error('SECRET_CANARY raw driver error'), { code });
    } }) }), 1);
    assert.equal(JSON.parse(await readFile(f.receipt, 'utf8')).state, state);
    assert.equal(JSON.parse(f.events.at(-1)).state, state); assert.doesNotMatch(f.events.join(''), /SECRET_CANARY|driver/);
  });
  await t.test('confirmed commit followed by disk failure is not called rollback', async t => {
    const f = await fixture(t); let persisted = 0;
    assert.equal(await f.run({ persistReceipt: async () => { persisted++; throw Error('SECRET_CANARY disk failure'); } }), 1);
    assert.equal(f.calls.filter(row => row[0] === 'execute').length, 1); assert.equal(persisted, 2);
    assert.equal(JSON.parse(f.events.at(-1)).state, 'COMMITTED_RECEIPT_UNCONFIRMED');
    assert.doesNotMatch(f.events.join(''), /SECRET_CANARY|disk/);
  });
});
test('purpose and environment cannot be relabeled and actual private backup bytes are mandatory', async t => {
  for (const variant of ['production-on-test', 'rehearsal-on-production', 'backup-bytes', 'backup-permissions', 'backup-symlink']) await t.test(variant, async t => {
    const f = await fixture(t);
    if (variant === 'production-on-test') { f.approval.purpose = 'production-release'; f.approval.executorApproval.purpose = 'production-release'; }
    if (variant === 'rehearsal-on-production') {
      f.request.environment = 'production'; f.approval.environment = 'production'; f.approval.executorApproval.environment = 'production';
      const bytes = JSON.stringify(f.request); await writeFile(f.requestFile, bytes); f.approval.requestSha256 = digest(bytes);
    }
    await writeFile(f.approvalFile, JSON.stringify(f.approval));
    if (variant === 'backup-bytes') await writeFile(f.backup, 'not the approved backup');
    if (variant === 'backup-permissions') await chmod(f.backup, 0o644);
    if (variant === 'backup-symlink') { await rm(f.backup); await symlink(f.requestFile, f.backup); }
    assert.equal(await f.run({ env: variant === 'rehearsal-on-production' ? { ...f.env, RENDER_DB_ENVIRONMENT: 'production' } : f.env }), 1);
    assert.deepEqual(f.calls, []);
  });
});
test('engine must consume matching scope exactly once and return explicit COMMITTED', async t => {
  for (const variant of ['not-consumed', 'wrong-scope', 'double-consume', 'no-commit']) await t.test(variant, async t => {
    const f = await fixture(t);
    assert.equal(await f.run({ loadExecutor: async () => ({ executeProductionRelease: async (pool, input, options) => {
      if (variant !== 'not-consumed') await options.consumeApproval({ scopeSha256: variant === 'wrong-scope' ? 'c'.repeat(64) : input.approval.scopeSha256,
        expiresAt: input.approval.expiresAt });
      if (variant === 'double-consume') await options.consumeApproval({ scopeSha256: input.approval.scopeSha256, expiresAt: input.approval.expiresAt });
      return { state: variant === 'no-commit' ? 'PREPARED' : 'COMMITTED', scopeSha256: input.approval.scopeSha256 };
    } }) }), 1);
    assert.equal(JSON.parse(await readFile(f.receipt, 'utf8')).state, 'ABORTED_OR_UNCONFIRMED');
  });
});
test('two concurrent CLI attempts sharing a nonce invoke engine only once', async t => {
  const f = await fixture(t);
  const results = await Promise.all([f.run(), f.run({ argv: [...f.argv.slice(0, -1), path.join(f.privateRoot, 'racing.json')] })]);
  assert.deepEqual(results.sort(), [0, 1]); assert.equal(f.calls.filter(row => row[0] === 'execute').length, 1);
});

test('failure receipts retain validated scope/request SHA linkage, never untrusted error fields', async t => {
  for (const code of ['OUTCOME_UNKNOWN', 'RELEASE_ABORTED']) await t.test(code, async t => {
    const f = await fixture(t);
    assert.equal(await f.run({ loadExecutor: async () => ({ executeProductionRelease: async () => {
      throw Object.assign(Error('SECRET_CANARY'), { code, scopeSha256: 'SECRET_CANARY', requestSha256: { secret: 'SECRET_CANARY' } });
    } }) }), 1);
    const bytes = await readFile(f.receipt, 'utf8'), receipt = JSON.parse(bytes);
    assert.equal(receipt.scopeSha256, f.approval.executorApproval.scopeSha256);
    assert.equal(receipt.requestSha256, digest(await readFile(f.requestFile)));
    assert.match(receipt.scopeSha256, /^[a-f0-9]{64}$/); assert.match(receipt.requestSha256, /^[a-f0-9]{64}$/);
    assert.equal(receipt.state, code === 'OUTCOME_UNKNOWN' ? code : 'ABORTED_OR_UNCONFIRMED');
    assert.doesNotMatch(bytes + f.events.join(''), /SECRET_CANARY/);
  });
  await t.test('post-COMMIT receipt failure retains identical linkage', async t => {
    const f = await fixture(t), attempts = [];
    assert.equal(await f.run({ persistReceipt: async (handle, value) => {
      attempts.push(value); if (attempts.length === 1) throw Error('SECRET_CANARY disk failure');
      await handle.writeFile(JSON.stringify(value)); await handle.sync();
    } }), 1);
    const receipt = JSON.parse(await readFile(f.receipt, 'utf8'));
    assert.equal(receipt.state, 'COMMITTED_RECEIPT_UNCONFIRMED');
    assert.equal(receipt.scopeSha256, attempts[0].scopeSha256);
    assert.equal(receipt.requestSha256, attempts[0].requestSha256);
    assert.equal(receipt.scopeSha256, f.approval.executorApproval.scopeSha256);
    assert.equal(receipt.requestSha256, digest(await readFile(f.requestFile)));
  });
});
