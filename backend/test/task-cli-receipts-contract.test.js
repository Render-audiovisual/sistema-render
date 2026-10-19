import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const scripts = {
  whatsapp: fileURLToPath(new URL('../scripts/mia_render_os_task.py', import.meta.url)),
  telegram: fileURLToPath(new URL('../../tools/wilson/render_os_task.py', import.meta.url)),
};
const runner = `
import json, runpy, sys, urllib.request, contextlib, io
def forbidden(*args, **kwargs):
    raise AssertionError("Real HTTP/signing forbidden")
urllib.request.urlopen = forbidden
namespace = runpy.run_path(sys.argv[1])
calls = []
def fake_request(method, path, *args, **kwargs):
    calls.append(dict(method=method, path=path, **kwargs))
    return {"ok": True}
main = namespace["main"]
main.__globals__["request"] = fake_request
main.__globals__["sign_request"] = forbidden
sys.argv = [sys.argv[1]] + json.loads(sys.argv[2])
error = None
with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
    try:
        main()
    except (RuntimeError, ValueError, SystemExit) as exc:
        error = str(exc)
print(json.dumps(dict(calls=calls, error=error)))
`;
function cli(channel, args) {
  const result = spawnSync('python3', ['-c', runner, scripts[channel], JSON.stringify(args)], { encoding: 'utf8', timeout: 5000, env: { PATH: '/usr/bin:/bin:/opt/homebrew/bin' } });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
const identity = (channel) => channel === 'telegram' ? ['--telegram-user-id', 'synthetic-user'] : [];
const key = ['--idempotency-key', ' task-receipt '];
const token = ['--confirmation-token', 'synthetic-token'];
const json = JSON.stringify;
const updateFields = ['--append-desc', 'Brief adicional'];
const createFields = ['--list', 'edicion', '--name', 'Entrega', '--client-id', '11', '--assignee-id', '21', '--collaborator-id', '22', '--due', '2026-10-23'];
const telegramCreate = { titulo: 'Entrega', descripcion: '', cliente_id: 11, asignado_a_id: 21, colaborador_ids: [22], fecha_vencimiento: '2026-10-23', sector: 'edicion', prioridad: 'media', material: '', referencia: '', permitir_duplicado: false };

for (const channel of Object.keys(scripts)) {
  for (const [operation, command, method, path] of [
    ['crear', 'create', 'POST', '/tareas'],
    ['editar', 'update', 'PATCH', '/tareas/8'],
    ['archivar', 'archive', 'POST', '/tareas/8/archivar'],
    ['eliminar', 'delete', 'DELETE', '/tareas/8'],
  ]) test(`${channel}: ${operation} proposal and mutation have identical intention/key, exact token and observed revision`, () => {
    const creating = operation === 'crear';
    const business = creating ? (channel === 'telegram' ? telegramCreate : { titulo: 'Entrega', asignado_a_id: 21, colaborador_ids: [] })
      : operation === 'editar' ? { append_descripcion: 'Brief adicional' } : {};
    const intention = { ...business, ...(!creating ? { expected_revision: 7 } : {}) };
    const proposal = cli(channel, ['propose', '--operation', operation, ...(!creating ? ['--task-id', '8'] : []), '--payload', json(intention), ...key, ...identity(channel)]);
    assert.equal(proposal.error, null);
    const mutationArgs = [command, ...(!creating ? ['--task-id', '8'] : []), ...key, ...token, ...identity(channel)];
    if (channel === 'telegram' && creating) mutationArgs.push(...createFields);
    else if (channel === 'telegram' && operation === 'editar') mutationArgs.push(...updateFields, '--expected-revision', '7');
    else mutationArgs.push('--payload', json(intention));
    const mutation = cli(channel, mutationArgs);
    assert.equal(mutation.error, null);
    assert.equal(mutation.calls.length, 1, 'no preflight/refetch/retry');
    const sent = mutation.calls[0];
    assert.equal(sent.method, method);
    assert.equal(sent.path, path);
    assert.equal(sent.payload.confirmacion_token, 'synthetic-token');
    assert.equal(sent.payload.confirmado, undefined);
    const { confirmacion_token: _, ...actualIntention } = sent.payload;
    assert.deepEqual(actualIntention, proposal.calls[0].payload.payload);
    assert.equal(sent.idempotency_key, 'task-receipt');
    assert.equal(proposal.calls[0].idempotency_key, 'task-receipt');
    assert.equal(sent.payload.idempotency_key, 'task-receipt');
    assert.equal(sent.payload.expected_revision, creating ? undefined : 7);
  });

  test(`${channel}: missing/invalid key or revision fails before HTTP, no sensitive-value echo`, () => {
    const cases = [
      ['propose', '--operation', 'crear'],
      ['propose', '--operation', 'editar', '--task-id', '8', ...key],
      ['propose', '--operation', 'editar', '--task-id', '8', ...key, '--payload', '{"expected_revision":true}'],
      ['propose', '--operation', 'editar', '--task-id', '8', ...key, '--payload', '{"expected_revision":"7"}'],
      ['propose', '--operation', 'crear', '--idempotency-key', 'secret\nkey'],
      ['propose', '--operation', 'crear', '--idempotency-key', 'x'.repeat(201)],
      ['propose', '--operation', 'crear', ...key, '--payload', '{"idempotency_key":"secret-other"}'],
      ['propose', '--operation', 'crear', ...key, '--payload', '{"idempotency_key":null}'],
      ['propose', '--operation', 'editar', '--task-id', '8', ...key, '--expected-revision', '8', '--payload', '{"expected_revision":7}'],
      ['archive', '--task-id', '8', ...key, ...token],
      ['delete', '--task-id', '8', ...token, '--expected-revision', '7'],
      ['archive', '--task-id', '8', ...key, ...token, '--expected-revision', '0'],
      ['archive', '--task-id', '8', ...key, ...token, '--expected-revision', '-1'],
    ];
    for (const args of cases) {
      const result = cli(channel, [...args, ...identity(channel)]);
      assert.ok(result.error, json(args));
      assert.deepEqual(result.calls, []);
      assert.doesNotMatch(result.error, /secret-other|secret\nkey|synthetic-token/);
    }
  });

  test(`${channel}: archived GET is explicit and keeps signed query target`, () => {
    const read = cli(channel, ['get', '--task-id', '8', '--include-archived', ...identity(channel)]);
    assert.equal(read.error, null);
    assert.equal(read.calls[0].path, '/tareas/8?include_archived=true');
    const normal = cli(channel, ['get', '--task-id', '8', ...identity(channel)]);
    assert.equal(normal.calls[0].path, '/tareas/8');
  });
}

test('WhatsApp explicit revision flag and JSON omissions/nulls remain unchanged; no-op edit can be confirmed', () => {
  const payload = { aclaraciones: null, referencia: '', colaborador_ids: [], asignado_a_id: 21 };
  const sent = cli('whatsapp', ['update', '--task-id', '8', '--payload', json(payload), '--expected-revision', '7', ...key, ...token]);
  assert.equal(sent.error, null);
  assert.deepEqual(sent.calls[0].payload, { ...payload, expected_revision: 7, idempotency_key: 'task-receipt', confirmacion_token: 'synthetic-token' });
  const noop = cli('whatsapp', ['update', '--task-id', '8', '--payload', '{"titulo":"Same observed title","expected_revision":7}', ...key, ...token]);
  assert.equal(noop.error, null);
  assert.equal(noop.calls.length, 1);
});

test('Telegram no longer accepts boolean-only create/update and display names are not authority', () => {
  for (const args of [['create', ...createFields], ['update', '--task-id', '8', ...updateFields, '--expected-revision', '7']]) {
    const result = cli('telegram', [...args, ...key, ...identity('telegram')]);
    assert.ok(result.error);
    assert.deepEqual(result.calls, []);
  }
  const result = cli('telegram', ['update', '--task-id', '8', ...updateFields, '--expected-revision', '7', ...token, ...key, ...identity('telegram'), '--confirmed-by', 'Any display label']);
  assert.equal(result.error, null);
  assert.equal(result.calls[0].payload.confirmado_por, undefined);
});

test('Telegram exact JSON supports collaborator removal, null/empty and no-op without inferred assignments', () => {
  for (const intention of [
    { expected_revision: 7, colaborador_ids: [], aclaraciones: null, referencia: '' },
    { expected_revision: 7, titulo: 'Same observed title' },
  ]) {
    const result = cli('telegram', ['update', '--task-id', '8', '--payload', json(intention), ...key, ...token, ...identity('telegram')]);
    assert.equal(result.error, null);
    assert.deepEqual(result.calls[0].payload, { ...intention, idempotency_key: 'task-receipt', confirmacion_token: 'synthetic-token' });
  }
  const mixed = cli('telegram', ['update', '--task-id', '8', '--payload', '{"expected_revision":7}', '--name', 'Secret draft', ...key, ...token, ...identity('telegram')]);
  assert.ok(mixed.error);
  assert.deepEqual(mixed.calls, []);
  assert.doesNotMatch(mixed.error, /Secret draft/);
  const proposal = cli('telegram', ['propose', '--operation', 'editar', '--task-id', '8', '--payload', '{"idempotency_key":"task-receipt","expected_revision":7}', ...identity('telegram')]);
  assert.equal(proposal.error, null);
  assert.equal(proposal.calls[0].idempotency_key, 'task-receipt');
});

test('WhatsApp wrapper remains a direct canonical delegation', () => {
  const wrapper = readFileSync(new URL('../../scripts/mia_render_os_task.py', import.meta.url), 'utf8');
  assert.match(wrapper, /"backend" \/ "scripts" \/ "mia_render_os_task.py"/);
  assert.match(wrapper, /runpy.run_path\(str\(CLIENT\), run_name="__main__"\)/);
});
