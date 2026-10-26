import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanEnvironment } from './render2-local-test.js';

// Fixed principal-system journeys, not a caller-selected command or DB target.
export const coreAcceptanceFiles = Object.freeze([
  'test/render2-cross-sector-workflow.integration.test.js',
  'test/render2-production-full-workflow.integration.test.js',
  'test/render2-cookie-role-financial-boundary.integration.test.js',
  'test/render2-project-workflow-journey.integration.test.js',
  'test/render2-editorial-confirmation.integration.test.js',
  'test/render2-editorial-control.integration.test.js',
  'test/render2-editorial-piece-detail.integration.test.js',
  'test/render2-editorial-adoption.integration.test.js',
  'test/render2-report-approval-projection.integration.test.js',
  'test/render2-editing-deliveries.integration.test.js',
  'test/render2-editing-delivery-notifications.integration.test.js',
  'test/render2-editing-reviews.integration.test.js',
  'test/render2-editing-correction-notifications.integration.test.js',
  'test/render2-editing-approval.integration.test.js',
  'test/render2-task-board-order.integration.test.js',
  'test/render2-unified-three-video-journey.integration.test.js',
  'test/render2-personal-list-persistence.integration.test.js',
  'test/render2-personal-list-block-creation.integration.test.js',
  'test/render2-personal-list-block-receipts-upgrade.integration.test.js',
  'test/render2-login-destination.integration.test.js',
  'test/render2-finance-snapshot.integration.test.js',
  'test/render2-task-create-http.integration.test.js',
  'test/render2-production-empty-registry-boundary.integration.test.js',
  'test/render2-production-results.integration.test.js',
  'test/render2-production-results-upgrade.integration.test.js',
  'test/render2-production-result-edit-race.integration.test.js',
  'test/render2-user-administration.integration.test.js',
  'test/render2-task-bulk-authority.integration.test.js',
  'test/render2-legacy-production-authority.integration.test.js',
  'test/render2-wilson-web-production-authority.integration.test.js',
  'test/render2-wilson-review-batch-authority.integration.test.js',
  'test/render2-wilson-review-batch-lock-order.integration.test.js',
  'test/render2-task-comment-actor.integration.test.js',
  'test/render2-task-comment-actor-upgrade.integration.test.js',
  'test/render2-task-delete-authority.integration.test.js',
  'test/render2-subtask-consumer.integration.test.js',
  'test/render2-audiovisual-cookie-concurrency.integration.test.js',
]);

export function coreAcceptancePlan(args = []) {
  if (!Array.isArray(args) || args.length) throw new Error('Core local QA accepts no arguments or target overrides.');
  return {
    command: process.execPath,
    args: ['--test', '--test-concurrency=1', ...coreAcceptanceFiles],
    options: {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env: { ...cleanEnvironment(), RENDER2_RUN_LOCAL_INTEGRATION: 'true' },
      shell: false,
      stdio: 'inherit',
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const plan = coreAcceptancePlan(process.argv.slice(2));
    console.info('Render core local QA: disposable PostgreSQL only; no configured DB, providers or deployment.');
    const child = spawn(plan.command, plan.args, plan.options);
    let interrupted = false;
    const interrupt = () => { interrupted = true; child.kill('SIGINT'); };
    const terminate = () => { interrupted = true; child.kill('SIGTERM'); };
    process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
    const dispose = () => { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); };
    child.once('error', () => { dispose(); console.error('Could not start core local QA.'); process.exitCode = 1; });
    child.once('close', (code, signal) => {
      dispose(); process.exitCode = Number.isInteger(code) ? code : 1;
      if (signal || interrupted) {
        process.exitCode = 1;
        console.error('QA interrupted: fixture cleanup is unproven. Inspect owned processes/data directories before removing anything.');
      }
    });
  } catch {
    console.error('Core local QA accepts no arguments or target overrides.'); process.exitCode = 2;
  }
}
