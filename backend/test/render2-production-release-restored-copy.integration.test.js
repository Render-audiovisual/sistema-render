import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, access } from 'node:fs/promises';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { withRestoredExecutorCopy, readonlySnapshot, originalColumnHashes, fileSha256, qaHash } from './helpers/release-executor-restored-copy.js';

const ARTIFACT = '/private/tmp/render-executor-final-sYriWq/app';
const MANIFEST = '85169c1ea45a867870e435bf3028000a1e6a97f6cf15ad9940e54f3c1d9de8d9';
const APPROVED_ASSIGNMENTS = '/private/tmp/render2-upgrade-4JITEY/fresh-assignment-plan.private.json';
const run = promisify(execFile);
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}` : JSON.stringify(value);

test('actual installed executor CLI preserves originals and applies the complete explicitly approved ID assignment intent', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 240000,
}, async t => {
  assert.equal(await fileSha256(`${ARTIFACT}/release-manifest.json`), MANIFEST);
  // Reuse ONLY the explicit choices; never its old hash, identity, exception or
  // task snapshot. Any discrepancy in human-requested totals blocks before IO
  // to a database. Never infer six replacement owners from historical labels.
  const sourcePlan = JSON.parse(await readFile(APPROVED_ASSIGNMENTS, 'utf8'));
  const approvedChoices = sourcePlan.choices.map(c => ({ task_id: c.task_id, owner_id: c.owner_id,
    collaborator_ids: [...c.collaborator_ids] }));
  assert.equal(approvedChoices.length, 338);
  assert.equal(new Set(approvedChoices.map(c => c.task_id)).size, 338);
  assert.equal(approvedChoices.reduce((sum, c) => sum + c.collaborator_ids.length, 0), 12);
  // The fresh26/10 backup has56 Leader owners.62 was an older reference,
  // not authority to manufacture six assignments or repartition existing IDs.
  assert.equal(approvedChoices.filter(c => c.owner_id === 1).length, 56,
    'Preserve the actual reviewed ID choices, never force an obsolete count');
  const engine = await import(pathToFileURL(`${ARTIFACT}/backend/src/production-release-executor.js`).href);
  const { securityPolicyFingerprint } = await import(pathToFileURL(`${ARTIFACT}/backend/src/application-object-security.js`).href);
  const artifactBytes = await readFile(`${ARTIFACT}/release-manifest.json`), manifest = JSON.parse(artifactBytes);
  const names = (await readdir(`${ARTIFACT}/backend/migrations`)).filter(n => /^(?:0(?:5[4-9]|[6-8][0-9]|9[0-3])_|20261027144706_editing_progress_unified_ledger\.sql$)/.test(n)).sort();
  assert.equal(names.length, 41);
  const migrations = await Promise.all(names.map(async name => ({ name, bytes: await readFile(`${ARTIFACT}/backend/migrations/${name}`) })));
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  const sourceCommit = (await run('/usr/bin/git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();
  assert.match(sourceCommit, /^[a-f0-9]{40}$/);
  const evidence = await withRestoredExecutorCopy(async f => {
    const completed = [];
    let committedReceiptPath, committedScopeHash, rolledBackReceiptPath;
    t.diagnostic(`Owned isolated target ${f.target}; original source DB is never changed; all attestations here are QA-only, NOT external production proof.`);
    assert.equal(f.restorationEvidence.originalColumnProjectionsMatch, true);
    assert.equal(f.restorationEvidence.aclOwnershipVerified, false);
    assert.equal(f.freshSnapshot.tables.find(t => t.name === 'tareas').rows, '339');
    const physical = await originalColumnHashes(f.pool, f.freshSnapshot);
    const ledger = (await f.pool.query(`SELECT id,nombre,to_char(aplicada_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS aplicada_at FROM public._migrations ORDER BY nombre`)).rows;
    assert.equal(ledger.length, 58);
    assert.equal((await f.pool.query('SELECT id FROM public.usuarios WHERE id=9')).rowCount, 1, 'Explicit synthetic-task owner ID exists; no name/role inference');
    const universe = (await f.pool.query('SELECT id FROM public.tareas ORDER BY id')).rows.map(r => r.id);
    assert.deepEqual(approvedChoices.map(c => c.task_id).sort((a,b) => a-b), universe.filter(id => id !== f.taskId),
      'All338 approved task IDs must match this restored backup exactly');
    const fullIntent = { choices: [...approvedChoices, { task_id: f.taskId, owner_id: 9, collaborator_ids: [] }], exceptions: [] };
    const fullBindings = fullIntent.choices.flatMap(c => [{ tarea_id: c.task_id, usuario_id: c.owner_id, tipo: 'responsable' },
      ...c.collaborator_ids.map(usuario_id => ({ tarea_id: c.task_id, usuario_id, tipo: 'colaborador' }))])
      .sort((a,b) => a.tarea_id-b.tarea_id || a.usuario_id-b.usuario_id);
    assert.equal(fullIntent.choices.length, 339); assert.equal(fullBindings.length, 351);
    const intent = owner => ({ choices: [{ task_id: f.taskId, owner_id: owner, collaborator_ids: [] }],
      exceptions: universe.filter(id => id !== f.taskId).map(task_id => ({ task_id, reason: 'QA ONLY: preserve this original task without assignment or person inference.' })) });
    const evidence = { purpose: 'isolated-rehearsal-only', noProductionAuthority: true, hostingerAuthenticated: false,
      liveConfigurationVerified: false, isolatedWritersDrained: true, directOwnedLocalPg18: true };
    const evidenceHash = qaHash(JSON.stringify(evidence));
    const scope = (prestate, assignmentIntent) => {
      const body = { version: 1, purpose: 'isolated-rehearsal', environment: 'test', identity: prestate.identity,
        artifactSha256: MANIFEST, securityPolicyFingerprint, prestate, ledger,
        sql: migrations.map(m => ({ name: m.name, sha256: qaHash(m.bytes) })),
        assignmentPlanSha256: engine.productionAssignmentIntentHash(assignmentIntent), expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        backup: { sha256: f.archiveHash, snapshotSha256: prestate.sha256, restorationEvidenceSha256: f.restorationEvidenceHash },
        maintenance: { evidenceSha256: evidenceHash, writesPaused: true, jobsPaused: true, exclusiveWindow: true },
        config: { sha256: evidenceHash, verified: true },
        connectionMode: { mode: 'direct', verified: true, evidenceSha256: evidenceHash },
        artifact: { sourceCommit, inventorySha256: qaHash(canonical({ files: manifest.files, directories: manifest.directories,
          dependencyProof: manifest.dependencyProof, rootPackageSha256: manifest.rootPackageSha256, sourceRootPackageSha256: manifest.sourceRootPackageSha256 })) },
      };
      return { ...body, scopeSha256: engine.productionReleaseScopeHash(body) };
    };
    const cli = async (label, assignmentIntent) => {
      const approval = scope(f.freshSnapshot, assignmentIntent), suffix = randomBytes(6).toString('hex');
      const request = { version: 1, environment: 'test', manifestSha256: MANIFEST, assignmentIntent };
      const requestBytes = JSON.stringify(request), requestPath = `${f.root}/${label}-${suffix}.request.json`, approvalPath = `${f.root}/${label}-${suffix}.approval.json`;
      const receiptPath = `${f.root}/${label}-${suffix}.receipt.json`;
      const now = Date.now(), nonce = randomBytes(32).toString('hex');
      const envelope = { version: 1, purpose: 'isolated-rehearsal', environment: 'test', requestSha256: qaHash(requestBytes),
        nonce, issuedAt: now, expiresAt: Date.parse(approval.expiresAt), executorApproval: approval };
      await writeFile(requestPath, requestBytes, { mode: 0o600, flag: 'wx' });
      await writeFile(approvalPath, JSON.stringify(envelope), { mode: 0o600, flag: 'wx' });
      let result;
      try {
        result = await run(process.execPath, [`${ARTIFACT}/backend/scripts/execute-production-release.js`, 'execute',
          '--request', requestPath, '--approval', approvalPath, '--artifact', ARTIFACT, '--backup', f.archivePath, '--receipt', receiptPath],
        { cwd: f.root, timeout: 120000, maxBuffer: 2000000, env: { PATH: '/usr/bin:/bin:/opt/homebrew/bin', LANG: 'C',
          NODE_ENV: 'test', RENDER_DB_ENVIRONMENT: 'test', DATABASE_URL: f.connectionUrl, DOTENV_CONFIG_PATH: '/dev/null' } });
        result.code = 0;
      } catch (error) { result = { code: error.code, stdout: error.stdout || '', stderr: error.stderr || '' }; }
      assert.doesNotMatch(result.stdout + result.stderr, /postgresql:\/\/|QA POSTBACKUP|SCRAM-SHA-256/);
      await access(`${f.root}/.release-used-${nonce}`);
      const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
      assert.equal(receipt.requestSha256, qaHash(requestBytes), 'Success/failure receipt binds exact private request');
      assert.equal(receipt.scopeSha256, approval.scopeSha256, 'Success/failure receipt binds exact executor scope');
      return { ...result, receipt, receiptPath };
    };
    await t.test('new real archive was restored and contains every original projection plus the synthetic postbackup task', async () => {
      assert.equal(await fileSha256(f.archivePath), f.archiveHash);
      assert.equal(f.restorationEvidence.postBackupTaskId, f.taskId);
      assert.equal(f.backupSnapshot.tables.find(t => t.name === 'tareas').rows, '338');
      assert.notEqual(f.backupSnapshot.sha256, f.freshSnapshot.sha256);
      assert.deepEqual(await originalColumnHashes(f.pool, f.freshSnapshot), physical);
      completed.push('archive_restored');
    });
    await t.test('installed engine rejects old snapshot before consuming test authority or running DDL', async () => {
      let consumed = 0;
      await assert.rejects(engine.executeProductionRelease(f.pool, { approval: scope(f.backupSnapshot, intent(9)),
        artifactBytes, migrations, assignmentIntent: intent(9) }, { environment: 'test', consumeApproval: async () => { consumed++; return true; } }), { code: 'PRESTATE_CHANGED' });
      assert.equal(consumed, 0); assert.deepEqual(await readonlySnapshot(f.pool), f.freshSnapshot);
      completed.push('stale_rejected');
    });
    await t.test('actual installed CLI late assignment failure rolls back ALL41 migrations, data and bindings', async () => {
      const failure = await cli('qa-atomic-rollback', intent(2147483646));
      assert.equal(failure.code, 1, failure.stdout + failure.stderr);
      assert.equal(failure.receipt.event, 'RELEASE_EXECUTION_FAILED'); assert.equal(failure.receipt.approvalAttemptConsumed, true);
      assert.deepEqual(await readonlySnapshot(f.pool), f.freshSnapshot, 'Full logical schema/data/security snapshot must roll back');
      assert.deepEqual(await originalColumnHashes(f.pool, f.freshSnapshot), physical, 'All original tuples remain physically unchanged');
      assert.equal((await f.pool.query("SELECT to_regclass('public.tarea_asignaciones') AS relation")).rows[0].relation, null);
      rolledBackReceiptPath = failure.receiptPath; completed.push('atomic_rollback');
      t.diagnostic('PostgreSQL sequence gaps after rolled-back nextval are not a rollback guarantee; schema/rows/bindings verified atomically.');
    });
    await t.test('actual installed CLI commits41 SQL plus339 owners and12 collaborators, preserving all339 tasks and every original row', async () => {
      const success = await cli('qa-atomic-success', fullIntent);
      assert.equal(success.code, 0, success.stdout + success.stderr);
      assert.equal(success.receipt.event, 'RELEASE_EXECUTION_COMPLETED'); assert.equal(success.receipt.state, 'COMMITTED');
      assert.equal(success.receipt.backupFileBytesShaVerified, true); assert.equal(success.receipt.backupRestorationProven, false,
        'CLI honestly does not itself prove the separate restoration evidence');
      assert.equal(success.receipt.hostingerAuthenticated, false);
      assert.deepEqual(await originalColumnHashes(f.pool, f.freshSnapshot, names), physical);
      assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM public._migrations')).rows[0].n, 99);
      const applied = (await f.pool.query('SELECT nombre FROM public._migrations WHERE nombre=ANY($1::text[]) ORDER BY nombre', [names])).rows.map(r => r.nombre);
      assert.deepEqual(applied, names);
      assert.deepEqual((await f.pool.query('SELECT tarea_id,usuario_id,tipo FROM public.tarea_asignaciones ORDER BY tarea_id,usuario_id')).rows,
        fullBindings, 'Every task/member/type is exactly the approved ID choice; no inference or splitting');
      const counts = (await f.pool.query(`SELECT count(*) FILTER(WHERE tipo='responsable')::int AS owners,
        count(*) FILTER(WHERE tipo='colaborador')::int AS collaborators,
        count(*) FILTER(WHERE tipo='responsable' AND usuario_id=1)::int AS leader_owners FROM public.tarea_asignaciones`)).rows[0];
      assert.deepEqual(counts, { owners: 339, collaborators: 12, leader_owners: 56 });
      assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM public.tareas')).rows[0].n, 339);
      const orphans = (await f.pool.query(`SELECT count(*) FILTER (WHERE t.id IS NULL)::int AS task_orphans,
        count(*) FILTER (WHERE u.id IS NULL)::int AS user_orphans FROM public.tarea_asignaciones a
        LEFT JOIN public.tareas t ON t.id=a.tarea_id LEFT JOIN public.usuarios u ON u.id=a.usuario_id`)).rows[0];
      assert.deepEqual(orphans, { task_orphans: 0, user_orphans: 0 });
      committedReceiptPath = success.receiptPath; committedScopeHash = success.receipt.scopeSha256;
      completed.push('actual_cli_committed');
    });
    await t.test('committed upgrade, original projections and postbackup assignment survive real PG restart', async () => {
      const before = await readonlySnapshot(f.pool); await f.restart();
      assert.deepEqual(await readonlySnapshot(f.pool), before);
      assert.deepEqual(await originalColumnHashes(f.pool, f.freshSnapshot, names), physical);
      assert.deepEqual((await f.pool.query('SELECT tarea_id,usuario_id,tipo FROM public.tarea_asignaciones ORDER BY tarea_id,usuario_id')).rows,
        fullBindings);
      completed.push('restart_persisted');
    });
    assert.equal(completed.length, 5, 'All physical stages must pass before emitting acceptance evidence');
    return { version: 1, purpose: 'isolated-rehearsal-only', artifact: ARTIFACT, manifestSha256: MANIFEST,
      root: f.root, target: f.target, restoredBackupDatabase: f.restorationEvidence.restoredDatabase,
      originalTables: f.freshSnapshot.tables.length, originalTasks: 338, postBackupTaskId: f.taskId, finalTasks: 339,
      migrations: 41, assignments: 351, owners: 339, collaborators: 12, sharedLeaderTasksUnsplit: 56,
      assignmentChoicesSource: APPROVED_ASSIGNMENTS, ledgerRows: 99, backupPath: f.archivePath, backupSha256: f.archiveHash,
      restorationEvidencePath: f.restorationEvidencePath, restorationEvidenceSha256: f.restorationEvidenceHash,
      committedReceiptPath, committedScopeHash, rolledBackReceiptPath, taskOrphans: 0, userOrphans: 0, completed,
      hostingerAuthenticated: false, productionAuthority: false, liveConfigurationVerified: false };
  });
  const evidencePath = `${evidence.root}/final-executor-qa-${randomBytes(6).toString('hex')}.json`;
  await writeFile(evidencePath, JSON.stringify({ ...evidence, originalRestoredDatabaseUnchanged: true, clusterStopped: true }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  t.diagnostic(`FINAL_EXECUTOR_QA_EVIDENCE ${JSON.stringify({ evidencePath, target: evidence.target, committedReceiptPath: evidence.committedReceiptPath,
    rolledBackReceiptPath: evidence.rolledBackReceiptPath, backupPath: evidence.backupPath, restorationEvidencePath: evidence.restorationEvidencePath })}`);
  t.diagnostic('Owned restored-copy cluster stopped; original source DB preserved, backup directories untouched; no production access/approval.');
});
