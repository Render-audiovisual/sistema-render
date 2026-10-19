import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/mia_render_os_task.py', import.meta.url));
const runner = `
import json, runpy, sys, urllib.request, contextlib, io
def forbidden(*args, **kwargs):
    raise AssertionError("Real HTTP forbidden")
urllib.request.urlopen = forbidden
namespace = runpy.run_path(sys.argv[1])
calls = []
def fake_request(method, path, args, **kwargs):
    calls.append(dict(method=method, path=path, **kwargs))
    return {"ok": True}
main = namespace["main"]
main.__globals__["request"] = fake_request
sys.argv = [sys.argv[1]] + json.loads(sys.argv[2])
error = None
with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
    try:
        main()
    except (RuntimeError, ValueError, SystemExit) as exc:
        error = str(exc)
print(json.dumps(dict(calls=calls, error=error)))
`;
function cli(args) {
  const result = spawnSync('python3', ['-c', runner, script, JSON.stringify(args)], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
const version = '2026-10-19T12:00:00.123456Z';
const json = JSON.stringify;
const create = (payload, key = 'receipt') => ['create-feedback', '--payload', json(payload), '--confirmation-token', 'synthetic', '--idempotency-key', key];
const update = (payload, extra = []) => ['update-feedback', '--feedback-id', '8', '--payload', json(payload), '--confirmation-token', 'synthetic', '--idempotency-key', 'receipt', ...extra];
const propose = (operation, payload, extra = []) => ['propose', '--operation', operation, '--payload', json(payload), ...extra];

test('create proposal and mutation carry identical normalized body key; mutation header matches', () => {
  const proposal = cli(propose('crear_feedback', { titulo: 'Pedido' }, ['--idempotency-key', ' receipt ']));
  const mutation = cli(create({ titulo: 'Pedido', idempotency_key: 'receipt' }, ' receipt '));
  assert.equal(proposal.error, null);
  assert.equal(mutation.error, null);
  assert.deepEqual(proposal.calls[0].payload.payload, { titulo: 'Pedido', idempotency_key: 'receipt' });
  assert.equal(mutation.calls[0].payload.idempotency_key, 'receipt');
  assert.equal(mutation.calls[0].idempotency_key, 'receipt');
  assert.equal(proposal.calls[0].payload.tarea_id, null);
});

test('edit takes exact observed CAS from JSON or flag and binds proposal key', () => {
  for (const result of [cli(update({ contenido: 'Cambio', expected_updated_at: version })), cli(update({ contenido: 'Cambio' }, ['--expected-updated-at', version]))]) {
    assert.equal(result.error, null);
    assert.equal(result.calls[0].payload.expected_updated_at, version);
    assert.equal(result.calls[0].payload.idempotency_key, result.calls[0].idempotency_key);
    assert.equal(result.calls[0].path, '/feedback/8');
  }
  const proposal = cli(propose('editar_feedback', { expected_updated_at: version, idempotency_key: 'receipt' }, ['--task-id', '8']));
  assert.equal(proposal.error, null);
  assert.equal(proposal.calls[0].payload.payload.expected_updated_at, version);
  assert.equal(proposal.calls[0].payload.payload.idempotency_key, 'receipt');
});

test('missing keys/CAS, contradictory and malformed inputs fail before HTTP without printing values', () => {
  const cases = [
    propose('crear_feedback', {}),
    propose('editar_feedback', { idempotency_key: 'receipt' }, ['--task-id', '8']),
    create({ idempotency_key: 'private-other' }),
    create({}, ' '), create({}, 'x'.repeat(201)), create({ idempotency_key: null }),
    create([]), update({}), update({ expected_updated_at: 123 }),
    update({ expected_updated_at: version }, ['--expected-updated-at', 'private-other']),
    ['update-feedback', '--feedback-id', '8', '--payload', '{}', '--confirmation-token', 'synthetic'],
  ];
  for (const args of cases) {
    const result = cli(args);
    assert.ok(result.error, json(args));
    assert.deepEqual(result.calls, []);
    assert.doesNotMatch(result.error, /private-other|synthetic/);
  }
});

test('unrelated production proposal stays unchanged by receipt upgrade', () => {
  const proposal = cli(propose('confirmar_grabacion', { expected_revision: 7 }, ['--task-id', '8']));
  assert.equal(proposal.error, null);
  assert.deepEqual(proposal.calls[0].payload, { operacion: 'confirmar_grabacion', tarea_id: 8, payload: { expected_revision: 7 } });
  assert.equal(proposal.calls[0].idempotency_key, null);
});
