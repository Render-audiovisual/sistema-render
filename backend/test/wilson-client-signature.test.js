import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { buildWilsonSignatureMessage } from '../src/wilson-integration.js';

test('Telegram Python client matches v2 framing including exact query without credentials or network', () => {
  const script = fileURLToPath(new URL('../../tools/wilson/render_os_task.py', import.meta.url));
  const path = '/api/integraciones/wilson/consulta-tareas?persona=QA%20Editor&after=12';
  const bodyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const python = spawnSync('python3', ['-c',
    'import runpy,sys; m=runpy.run_path(sys.argv[1]); print(m["signature_message"]("100","nonce","GET",sys.argv[2],"qa-actor",sys.argv[3]),end="")',
    script, path, bodyHash], { encoding: 'utf8', timeout: 5000, env: { PATH: '/usr/bin:/bin:/opt/homebrew/bin' } });
  assert.equal(python.status, 0, python.stderr);
  assert.equal(python.stdout, buildWilsonSignatureMessage({ timestamp: '100', nonce: 'nonce', channel: 'telegram',
    actorId: 'qa-actor', method: 'GET', path, body: undefined }));
});

test('both clients retain query when selecting the exact signed request target', () => {
  for (const file of ['../../tools/wilson/render_os_task.py', '../scripts/mia_render_os_task.py']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /signature_path = f"\{urllib\.parse\.urlparse\(base_url\)\.path\}\{path\}"/);
    assert.match(source, /"X-Wilson-Signature-Version": "2"/);
  }
});
