import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { cordobaOccurrence, createEditorialAttempt, createEditorialSessionGuard, editorialFields, mergeEditorialStatus, validateEditorialStatus } from '../components/EditorialPublicationControl.model.js';
import { isConfirmedPublication } from '../shared/editorial/publication-evidence.js';

const requestId = '10000000-0000-4000-8000-000000000001';
const piece = { id: 1, cliente_id: 2, dominio: 'historia', estado: 'lista', fecha_programada: '2026-10-01', copy: 'Preservar' };
const status = (confirmed = true) => ({ piece: { id: 1, cliente_id: 2, dominio: 'historia', estado: confirmed ? 'publicada' : 'lista', revision: confirmed ? 1 : 2, fecha_programada: '2026-10-02', fecha_publicacion_real: confirmed ? '2026-10-01T15:00:00.000Z' : null }, classification: confirmed ? 'confirmada_manualmente' : 'no_publicada', current_confirmation: confirmed ? { id: requestId, actor_id: 3, source: 'manual', occurred_at: '2026-10-01T15:00:00.000Z', recorded_at: '2026-10-01T15:01:00.000Z' } : null, can_confirm: !confirmed });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('Córdoba occurrence is explicit UTC−03 independent of browser timezone', () => {
  assert.equal(cordobaOccurrence('2026-10-01T12:00', Date.parse('2026-10-02T00:00Z')), '2026-10-01T15:00:00.000Z');
  for (const value of ['', '2026-02-30T12:00', '2026-10-01', '2026-10-01T24:00']) assert.throws(() => cordobaOccurrence(value));
  assert.throws(() => cordobaOccurrence('2026-10-01T12:00', 0), /futuro/);
});

test('merge accepts closed evidence and preserves content while syncing planned date', () => {
  const result = mergeEditorialStatus(piece, status());
  assert.equal(result.copy, 'Preservar'); assert.equal(result.fecha_programada, '2026-10-02');
  assert.equal(isConfirmedPublication(result), true);
  assert.equal(isConfirmedPublication(mergeEditorialStatus(result, status(false))), false);
});

test('domain, piece, client and date mismatches cannot gain credit', () => {
  for (const fields of [{ id: 9 }, { cliente_id: 9 }, { dominio: 'publicacion' }, { fecha_programada: '2026-02-30' }]) {
    const dto = status(); Object.assign(dto.piece, fields);
    assert.throws(() => validateEditorialStatus(dto, piece, 'historia'));
    assert.throws(() => mergeEditorialStatus(piece, dto));
  }
});

test('legacy publication state and proof-shaped metadata never confer confirmation', () => {
  const historical = { ...piece, estado: 'publicada', metadata: { publicacion_evidencia: status() } };
  assert.equal(isConfirmedPublication(historical), false);
  assert.deepEqual(editorialFields(historical, { estado: 'publicada', copy: 'nuevo' }), { copy: 'nuevo' });
  assert.deepEqual(editorialFields(mergeEditorialStatus(piece, status()), { estado: 'lista', copy: 'nuevo' }), { copy: 'nuevo' });
});

test('uncertain retry reuses exact UUID/body and rejects changed intention', async () => {
  const calls = []; let fail = true;
  const writer = createEditorialAttempt(async (url, options) => { calls.push([url, options.body]); if (fail) throw new Error('transport'); return status(); }, () => requestId, piece);
  await assert.rejects(writer.send('historia', 1, 'confirmar', 0, '2026-10-01T15:00:00.000Z'));
  await assert.rejects(writer.send('historia', 1, 'confirmar', 1, '2026-10-01T15:00:00.000Z'), /pendiente/);
  fail = false; await writer.send('historia', 1, 'confirmar', 0, '2026-10-01T15:00:00.000Z');
  assert.deepEqual(calls[0], calls[1]); assert.equal(writer.pending, null);
});

test('synchronous duplicate submit gate sends once', async () => {
  const wait = deferred(); let calls = 0;
  const writer = createEditorialAttempt(() => { calls++; return wait.promise; }, () => requestId);
  const first = writer.send('historia', 1, 'retirar', 1);
  assert.equal(await writer.send('historia', 1, 'retirar', 1), undefined);
  wait.resolve(status(false)); await first; assert.equal(calls, 1);
});

test('409 performs no automatic read/rebase/retry', async () => {
  let calls = 0;
  const writer = createEditorialAttempt(async () => { calls++; throw Object.assign(new Error(), { status: 409 }); }, () => requestId);
  await assert.rejects(writer.send('historia', 1, 'retirar', 1));
  assert.equal(calls, 1); assert.equal(writer.pending, null);
});

test('408 and undefined 4xx preserve immutable attempt; only declared rejections discard it', async () => {
  for (const code of [408, 429, 499, 500, 400, 401, 403, 404, 409]) {
    const calls = []; let fail = true, keys = 0;
    const writer = createEditorialAttempt(async (url, options) => {
      calls.push(options.body);
      if (fail) throw Object.assign(new Error(), { status: code });
      return status();
    }, () => { keys++; return requestId; });
    await assert.rejects(writer.send('historia', 1, 'confirmar', 0, '2026-10-01T15:00:00.000Z'));
    const definitive = [400, 401, 403, 404, 409].includes(code);
    assert.equal(writer.pending === null, definitive);
    if (!definitive) {
      fail = false; await writer.send('historia', 1, 'confirmar', 0, '2026-10-01T15:00:00.000Z');
      assert.equal(calls[0], calls[1]); assert.equal(keys, 1);
    }
  }
});

const session = () => ({ token: 'captured-token', usuario: { id: 3, rol: 'admin' } });
const sessionChanges = [value => { value.token = 'new-token'; }, value => { value.usuario.id = 9; }, value => { value.usuario.rol = 'employee'; }];

test('guard rejects ID/token/role drift before dispatch without rerender', async () => {
  for (const change of sessionChanges) {
    const captured = session(); let current = structuredClone(captured), requests = 0, invalidations = 0;
    const guard = createEditorialSessionGuard(captured, () => current, () => invalidations++);
    change(current);
    assert.equal(await guard.request(async () => { requests++; }, '/api/example'), undefined);
    assert.equal(requests, 0); assert.equal(invalidations, 1);
    current = session(); assert.equal(guard.isCurrent(), false); // No revival after a session switch.
  }
});

test('GET suppresses late success and failure after ID/token/role drift', async () => {
  for (const change of sessionChanges) for (const fail of [false, true]) {
    const captured = session(), current = structuredClone(captured), wait = deferred(); let signal;
    const guard = createEditorialSessionGuard(captured, () => current);
    const pending = guard.request((url, options) => { signal = options.signal; return wait.promise; }, '/api/editorial-publicacion/historia/1');
    change(current);
    if (fail) wait.reject(new Error('private transport detail')); else wait.resolve(status());
    assert.equal(await pending, undefined); assert.equal(signal.aborted, true);
  }
});

test('write session race suppresses late result/error, clears attempt and never permits retry as another actor', async () => {
  for (const change of sessionChanges) for (const fail of [false, true]) {
    const captured = session(), current = structuredClone(captured), wait = deferred(); let calls = 0;
    const guard = createEditorialSessionGuard(captured, () => current);
    const writer = createEditorialAttempt((url, options) => guard.request(() => { calls++; return wait.promise; }, url, options), () => requestId, piece, guard.isCurrent);
    const pending = writer.send('historia', 1, 'confirmar', 0, '2026-10-01T15:00:00.000Z');
    change(current);
    if (fail) wait.reject(new Error()); else wait.resolve(status());
    assert.equal(await pending, undefined); assert.equal(writer.pending, null);
    assert.equal(await writer.send('historia', 1, 'confirmar', 0, '2026-10-01T15:00:00.000Z'), undefined);
    assert.equal(calls, 1);
  }
});

test('session change before retry of a 408 never dispatches the captured intent as the new session', async () => {
  const current = session(), guard = createEditorialSessionGuard(current, () => current); let calls = 0;
  const writer = createEditorialAttempt((url, options) => guard.request(async () => {
    calls++; throw Object.assign(new Error(), { status: 408 });
  }, url, options), () => requestId, piece, guard.isCurrent);
  await assert.rejects(writer.send('historia', 1, 'confirmar', 0, '2026-10-01T15:00:00.000Z'));
  assert.ok(writer.pending);
  current.token = 'replacement-session-token';
  assert.equal(await writer.send('historia', 1, 'confirmar', 0, '2026-10-01T15:00:00.000Z'), undefined);
  assert.equal(writer.pending, null); assert.equal(calls, 1);
});

test('captured session is immutable and cancellation ignores transport that ignores AbortSignal', async () => {
  const captured = session(), current = structuredClone(captured), wait = deferred();
  const guard = createEditorialSessionGuard(captured, () => current);
  captured.usuario.id = 99; captured.token = 'mutated';
  assert.equal(guard.isCurrent(), true);
  const pending = guard.request(() => wait.promise, '/api/example'); guard.cancel(); wait.resolve(status());
  assert.equal(await pending, undefined);
  assert.deepEqual(await guard.request(async () => status(false), '/api/example'), status(false));
});

test('unchanged session forwards transport options and failures normally', async () => {
  const current = session(), guard = createEditorialSessionGuard(current, () => current);
  const options = { method: 'POST', body: 'immutable-body', headers: { 'Content-Type': 'application/json' } };
  const result = await guard.request(async (url, sent) => { assert.equal(url, '/api/example'); assert.equal(sent.body, options.body); assert.equal(sent.method, 'POST'); return status(); }, '/api/example', options);
  assert.deepEqual(result, status());
  await assert.rejects(guard.request(async () => { throw Object.assign(new Error(), { status: 408 }); }, '/api/example'), { status: 408 });
});

test('canceled selection ignores late successful or failed transport', async () => {
  for (const fail of [false, true]) {
    const wait = deferred(); let signal;
    const writer = createEditorialAttempt((url, options) => { signal = options.signal; return wait.promise; }, () => requestId);
    const pending = writer.send('historia', 1, 'retirar', 1); writer.cancel();
    assert.equal(signal.aborted, true);
    if (fail) wait.reject(new Error()); else wait.resolve(status(false));
    assert.equal(await pending, undefined);
  }
});

test('replay status current withdrawal is not counted as original confirmation', async () => {
  const writer = createEditorialAttempt(async () => ({ ...status(false), replayed: true }), () => requestId);
  const dto = await writer.send('historia', 1, 'confirmar', 0, '2026-10-01T15:00:00.000Z');
  assert.equal(isConfirmedPublication(mergeEditorialStatus(piece, dto)), false);
});

test('POST response from a relocated client is rejected, not merged', async () => {
  const dto = status(); dto.piece.cliente_id = 8;
  const writer = createEditorialAttempt(async () => dto, () => requestId, piece);
  await assert.rejects(writer.send('historia', 1, 'confirmar', 0, '2026-10-01T15:00:00.000Z'), /Recargá/);
});

const source = name => readFileSync(new URL(name, import.meta.url), 'utf8');
test('daily planning writer cannot PATCH or optimistically mutate story state', () => {
  const text = source('./Historias.jsx');
  const file = ts.createSourceFile('Historias.jsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  let node;
  function visit(current) {
    if (ts.isVariableDeclaration(current) && current.name.getText(file) === 'marcarPlanificacion') node = current.initializer;
    ts.forEachChild(current, visit);
  }
  visit(file); assert.ok(node, 'inspect the actual planning callback, not adjacent publication-confirmation callbacks');
  const handler = node.getText(file);
  assert.match(handler, /check-publicacion/); assert.doesNotMatch(handler, /PATCH|onHistoriasActualizadas|nuevoEstado|historiasDelDia/);
  assert.doesNotMatch(text, /check\?\.publicado \|\| publicadaPorHistorias/);
  assert.match(text, /no prueba de publicación/);
});

test('principal pages wire per-piece control and helper, no direct publication action', () => {
  for (const name of ['./Historias.jsx', './Publicaciones.jsx']) {
    const text = source(name); assert.match(text, /EditorialPublicationControl/); assert.match(text, /filter\(isConfirmedPublication\)/);
    assert.doesNotMatch(text, /cambiarEstadoPublicacion\(piezaSel, "publicada"\)/);
  }
});

test('dialog has explicit date/ack, readonly role gate, Escape cleanup and no storage', () => {
  const text = source('../components/EditorialPublicationControl.jsx');
  assert.match(text, /datetime-local/); assert.match(text, /efectivamente se publicó/); assert.match(text, /rol === 'admin'/);
  assert.match(text, /<Modal native/); assert.match(text, /closeDisabled=\{busy\}/);
  assert.doesNotMatch(text, /document.addEventListener\('keydown'/); assert.match(text, /writer.current.cancel\(\)/);
  assert.doesNotMatch(text, /localStorage|sessionStorage/);
});
