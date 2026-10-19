import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('WhatsApp CLI cannot confirm production without the observed revision', () => {
  const script = fileURLToPath(new URL('../scripts/mia_render_os_task.py', import.meta.url));
  const result = spawnSync('python3', [script, '--actor-id', 'qa-actor', '--actor-name', 'QA',
    'confirm-production', '--task-id', '1', '--confirmation-token', 'qa-token'], {
    encoding: 'utf8', timeout: 5000, env: { PATH: '/usr/bin:/bin:/opt/homebrew/bin' },
  });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /expected-revision/);
  assert.doesNotMatch(result.stderr, /clave privada|urlopen|Traceback/);
});
