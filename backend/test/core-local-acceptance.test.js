import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { coreAcceptanceFiles, coreAcceptancePlan } from '../scripts/render2-core-acceptance.js';

test('core QA uses the fixed principal journeys, serially, with an isolated child environment', () => {
  const plan = coreAcceptancePlan();
  assert.equal(plan.command, process.execPath);
  assert.equal(plan.options.shell, false);
  assert.equal(plan.options.stdio, 'inherit');
  assert.equal(coreAcceptanceFiles.length, 23);
  assert.equal(new Set(coreAcceptanceFiles).size, 23);
  assert.ok(coreAcceptanceFiles.includes('test/render2-task-create-http.integration.test.js'));
  assert.ok(coreAcceptanceFiles.includes('test/render2-production-empty-registry-boundary.integration.test.js'));
  assert.ok(coreAcceptanceFiles.includes('test/render2-production-results.integration.test.js'));
  assert.ok(coreAcceptanceFiles.includes('test/render2-production-results-upgrade.integration.test.js'));
  assert.ok(coreAcceptanceFiles.includes('test/render2-production-result-edit-race.integration.test.js'));
  assert.ok(coreAcceptanceFiles.includes('test/render2-user-administration.integration.test.js'));
  assert.ok(coreAcceptanceFiles.includes('test/render2-task-bulk-authority.integration.test.js'));
  assert.ok(coreAcceptanceFiles.includes('test/render2-legacy-production-authority.integration.test.js'));
  assert.ok(coreAcceptanceFiles.includes('test/render2-task-comment-actor.integration.test.js'));
  assert.ok(coreAcceptanceFiles.includes('test/render2-task-comment-actor-upgrade.integration.test.js'));
  assert.ok(coreAcceptanceFiles.includes('test/render2-task-delete-authority.integration.test.js'));
  assert.ok(coreAcceptanceFiles.includes('test/render2-subtask-consumer.integration.test.js'));
  assert.ok(coreAcceptanceFiles.includes('test/render2-audiovisual-cookie-concurrency.integration.test.js'));
  assert.equal(Object.isFrozen(coreAcceptanceFiles), true);
  assert.deepEqual(plan.args, ['--test', '--test-concurrency=1', ...coreAcceptanceFiles]);
  for (const file of coreAcceptanceFiles) {
    assert.match(file, /^test\/render2-[a-z-]+\.integration\.test\.js$/);
    assert.equal(existsSync(path.join(plan.options.cwd, file)), true);
  }
  assert.deepEqual(Object.keys(plan.options.env).sort(), [
    'PATH', 'TMPDIR', 'LANG', 'NODE_ENV', 'DOTENV_CONFIG_PATH',
    'RENDER_DISABLE_SERVER_START', 'RENDER2_RUN_LOCAL_INTEGRATION',
  ].sort());
  assert.equal(plan.options.env.RENDER2_RUN_LOCAL_INTEGRATION, 'true');
  assert.equal(plan.options.env.DOTENV_CONFIG_PATH, '/dev/null');
  assert.equal(plan.options.env.RENDER_DISABLE_SERVER_START, 'true');
  assert.equal(plan.options.env.NODE_ENV, 'test');
  // Fresh objects: a consumer cannot poison a later invocation's plan.
  plan.options.env.DATABASE_URL = 'synthetic-not-a-real-target';
  plan.args.length = 0;
  assert.equal(Object.hasOwn(coreAcceptancePlan().options.env, 'DATABASE_URL'), false);
  assert.equal(coreAcceptancePlan().args.length, 25);
});

test('core QA refuses flags, URLs and fixture overrides instead of choosing a configured target', () => {
  for (const args of [['--help'], ['--test-name-pattern=skip'], ['--database=production'], ['test/other.js'], null, {}])
    assert.throws(() => coreAcceptancePlan(args), /no arguments or target overrides/);
});

test('npm entrypoint invokes only the isolated QA coordinator', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['qa:core:local'], 'node scripts/render2-core-acceptance.js');
});
