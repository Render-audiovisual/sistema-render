import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionResultIntent, verifyProductionResult, verifyProductionResultPage } from './productionResultIntent.js';
import { createCapturedRequest } from '../shared/session/captured-request.js';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';

const visitId = '11111111-2222-4333-8444-555555555555';
const requestId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const eventId = '99999999-aaaa-4bbb-8ccc-dddddddddddd';
const videoId = '12345678-abcd-4abc-8abc-123456789abc';
const photoId = '23456789-abcd-4abc-8abc-123456789abc';
const input = () => ({ id: visitId, revision: 7 });
function result(revision = 7) {
  return { id: eventId, visita_id: visitId, visita_revision: revision, revision_resultante: revision + 1,
    registrado_por_id: 91003, registrado_at: '2026-10-29T12:34:56.123Z', vigente: true,
    resumen: { version: 1, visita: { id: visitId, tarea_origen_id: 12, cliente_id: 3, fecha: '2026-10-29',
      titulo: 'Visita', participante_ids: [91001, 91003], drive_url: 'https://example.invalid/drive', observaciones: 'Visit notes' },
    videos: [{ id: videoId, video_origen_id: null, titulo: 'Video', guion: 'Script\nSecond line', estado: 'pendiente',
      material_url: 'https://example.invalid/material', observaciones: 'Video notes' }],
    fotos: [{ id: photoId, tipo: 'Producto', estado: 'realizada', drive_url: 'https://example.invalid/photos', observaciones: 'Photo notes' }],
    previstos: 1, conteos: { videos_grabados: 0, videos_pendientes: 1, videos_repetir: 0,
      fotos_realizadas: 1, fotos_pendientes: 0, fotos_repetir: 0 }, parcial: true } };
}
const ack = row => ({ created: true, resultado: row ?? result() });
const failure = status => Object.assign(new Error('Untrusted server diagnostics'), { status });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture({ transport = async () => ack(), observer = () => {}, uuid = () => requestId } = {}) {
  const calls = [], states = []; let active = true, captures = 0, ids = 0;
  const scope = { actorId: 91003, current: () => active,
    assertCurrent() { if (!active) throw Object.assign(Error('Retired'), { code: 'session_binding_obsolete' }); } };
  const model = createProductionResultIntent({ capture() { captures++; return scope; },
    randomUUID() { ids++; return uuid(); },
    send(command, captured) { calls.push({ command, scope: captured }); return transport(command, captured, calls.length); },
    onState(state) { states.push(state); observer(state); } });
  return { model, scope, calls, states, retire() { active = false; }, get captures() { return captures; }, get ids() { return ids; } };
}

test('result parser validates owned evidence, strips all unknown properties and returns a detached frozen object', () => {
  const raw = result(), original = structuredClone(raw);
  raw.payload_hash = 'private'; raw.saldo = 999; raw.resumen.finanzas = { secret: true };
  raw.resumen.visita.precio = 100; raw.resumen.videos[0].cost = 9; raw.resumen.fotos[0].financial = true;
  raw.resumen.conteos.facturacion = 888;
  const parsed = verifyProductionResult(raw, { visitId, expectedRevision: 7, actorId: 91003 });
  assert.deepEqual(parsed, original); assert.notEqual(parsed.resumen, raw.resumen);
  raw.resumen.videos[0].guion = 'Later mutation'; assert.equal(parsed.resumen.videos[0].guion, original.resumen.videos[0].guion);
  assert.equal(Object.isFrozen(parsed.resumen.videos[0]), true);
  assert.throws(() => parsed.resumen.visita.participante_ids.push(7), TypeError);
});

test('result parser rejects identity, revision, timestamps, malformed summary, states, URLs and inconsistent counts', () => {
  const mutations = [
    row => { row.id += '\n'; }, row => { row.visita_id = requestId; }, row => { row.visita_revision = '7'; },
    row => { row.revision_resultante = 9; }, row => { row.registrado_por_id = 9; },
    row => { row.registrado_at = '2026-02-30T12:00:00Z'; }, row => { row.registrado_at = 'tomorrow'; },
    row => { row.vigente = 1; }, row => { row.resumen.version = '1'; }, row => { row.resumen.visita.id = requestId; },
    row => { row.resumen.visita.fecha = '2026-02-30'; }, row => { row.resumen.visita.participante_ids = [1, 1]; },
    row => { row.resumen.videos[0].estado = 'planificado'; }, row => { row.resumen.videos[0].guion = ' '; },
    row => { row.resumen.videos[0].material_url = 'javascript:alert(1)'; },
    row => { row.resumen.fotos[0].drive_url = 'https://user:password@example.invalid/'; },
    row => { row.resumen.videos.push(structuredClone(row.resumen.videos[0])); },
    row => { row.resumen.fotos[0].estado = 'grabado'; }, row => { row.resumen.conteos.videos_pendientes = 0; },
    row => { row.resumen.parcial = false; }, row => { row.resumen.previstos = 2; },
    row => { row.resumen.videos = []; row.resumen.fotos = []; },
  ];
  for (const mutate of mutations) {
    const row = result(); mutate(row);
    assert.throws(() => verifyProductionResult(row, { visitId, expectedRevision: 7, actorId: 91003 }));
  }
  assert.throws(() => verifyProductionResult(result(), { visitId, expectedRevision: 6 }));
});

test('photos-only and all-recorded evidence preserve real counts rather than requiring a recorded video', () => {
  const photo = result(); photo.resumen.videos = []; photo.resumen.previstos = 0;
  photo.resumen.conteos.videos_pendientes = 0; photo.resumen.parcial = false;
  assert.equal(verifyProductionResult(photo, { visitId }).resumen.parcial, false);
  const recorded = result(); recorded.resumen.videos[0].estado = 'grabado'; recorded.resumen.videos[0].guion = '';
  recorded.resumen.conteos.videos_pendientes = 0; recorded.resumen.conteos.videos_grabados = 1; recorded.resumen.parcial = false;
  assert.equal(verifyProductionResult(recorded, { visitId }).resumen.conteos.videos_grabados, 1);
});

function page(size = 20) {
  return { visita_id: visitId, revision: 31, resultados: Array.from({ length: size }, (_, index) => ({ ...result(30 - index),
    id: `${String(index + 1).padStart(8, '0')}-aaaa-4bbb-8ccc-dddddddddddd`, vigente: index === 0 })),
    next_before_revision: size === 20 ? 11 : null };
}
test('page parser enforces bounded descending unique evidence and last-source cursor, sanitizing the full page', () => {
  const raw = page(); raw.internal = true; raw.resultados[0].balance = 9;
  const parsed = verifyProductionResultPage(raw, visitId);
  assert.equal(parsed.resultados.length, 20); assert.equal(parsed.next_before_revision, 11);
  assert.equal('internal' in parsed, false); assert.equal('balance' in parsed.resultados[0], false);
  assert.equal(Object.isFrozen(parsed.resultados), true);
  assert.deepEqual(verifyProductionResultPage({ visita_id: visitId, revision: 1, resultados: [], next_before_revision: null }, visitId).resultados, []);
  for (const mutate of [body => { body.visita_id = requestId; }, body => { body.revision = 0; },
    body => { body.resultados.push(result()); }, body => { body.resultados[1] = body.resultados[0]; },
    body => { body.resultados[1].visita_revision = 30; body.resultados[1].revision_resultante = 31; },
    body => { body.resultados.reverse(); }, body => { body.resultados[0].vigente = false; },
    body => { body.revision = 30; }, body => { body.next_before_revision = '11'; },
    body => { body.next_before_revision = 12; }, body => { body.resultados.pop(); },
    body => { delete body.next_before_revision; }]) {
    const body = page(); mutate(body); assert.throws(() => verifyProductionResultPage(body, visitId));
  }
});

test('double start synchronously captures one scope/UUID and freezes a closed POST before awaiting', async () => {
  const wait = deferred(), f = fixture({ transport: () => wait.promise }), visit = input();
  const pending = f.model.start(visit);
  assert.equal(await f.model.start(input()), false); assert.equal(await f.model.verify(), false); assert.equal(await f.model.retry(), false);
  visit.id = requestId; visit.revision = 90;
  assert.equal(f.captures, 1); assert.equal(f.ids, 1); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].scope, f.scope);
  assert.deepEqual(f.calls[0].command, { method: 'POST', path: `/api/producciones/${visitId}/resultados`,
    body: { request_id: requestId, expected_revision: 7 } });
  assert.equal(Object.isFrozen(f.calls[0].command.body), true);
  assert.equal(f.model.snapshot.busy, true); assert.equal(f.model.snapshot.locked, true);
  wait.resolve(ack()); assert.equal(await pending, true);
  assert.equal(f.model.snapshot.status, 'confirmed'); assert.equal(f.model.snapshot.busy, false); assert.equal(f.model.snapshot.locked, false);
});

test('lost ACK then GET404 remains locked; explicit retry uses identical body/scope and no UUID rebase', async () => {
  const f = fixture({ transport: async (_command, _scope, index) => {
    if (index === 1) throw Error('lost'); if (index === 2) throw failure(404); return { created: false, resultado: result() };
  } });
  assert.equal(await f.model.start(input()), false); assert.equal(f.model.snapshot.status, 'uncertain');
  assert.equal(await f.model.verify(), false); assert.equal(f.model.snapshot.status, 'uncertain'); assert.equal(f.model.snapshot.locked, true);
  assert.equal(await f.model.start({ id: visitId, revision: 100 }), false);
  assert.deepEqual(f.calls[1].command, { method: 'GET', path: `/api/producciones/${visitId}/resultados/intentos/${requestId}`, body: undefined });
  assert.equal(await f.model.retry(), true);
  assert.equal(f.calls[2].command.body, f.calls[0].command.body);
  assert.equal(JSON.stringify(f.calls[2].command.body), JSON.stringify(f.calls[0].command.body));
  assert.equal(f.calls[2].scope, f.scope); assert.equal(f.ids, 1); assert.equal(f.captures, 1);
  assert.equal(await f.model.verify(), true); assert.equal(await f.model.retry(), false); assert.equal(f.calls.length, 3);
});

test('GET can confirm an obsolete owned snapshot without claiming current visit state', async () => {
  const f = fixture({ transport: async command => { if (command.method === 'POST') throw failure(503);
    return { resultado: { ...result(), vigente: false } }; } });
  await f.model.start(input()); assert.equal(await f.model.verify(), true);
  assert.equal(f.model.snapshot.accepted.vigente, false); assert.equal(f.calls.length, 2);
});

test('initial validation rejection releases review, but retry validation cannot release an uncertain attempt', async () => {
  for (const status of [400, 413, 422]) {
    const initial = fixture({ transport: async () => { throw failure(status); } });
    await initial.model.start(input()); assert.equal(initial.model.snapshot.status, 'idle'); assert.equal(initial.model.snapshot.locked, false);
    await initial.model.start(input()); assert.equal(initial.ids, 2);
    const retried = fixture({ transport: async (_command, _scope, index) => { throw index === 1 ? Error('lost') : failure(status); } });
    await retried.model.start(input()); await retried.model.retry();
    assert.equal(retried.model.snapshot.status, 'uncertain'); assert.equal(retried.model.snapshot.locked, true); assert.equal(retried.ids, 1);
    assert.equal(retried.model.snapshot.error.includes('Untrusted'), false);
  }
});

test('409 retains conflict and permits only verification, whose valid owned ACK confirms', async () => {
  const f = fixture({ transport: async command => { if (command.method === 'POST') throw failure(409); return { resultado: result() }; } });
  await f.model.start(input()); assert.equal(f.model.snapshot.status, 'conflict'); assert.equal(f.model.snapshot.locked, true);
  assert.equal(await f.model.retry(), false); assert.equal(await f.model.start(input()), false);
  assert.equal(await f.model.verify(), true); assert.equal(f.model.snapshot.status, 'confirmed'); assert.equal(f.ids, 1);
});

test('failed verification cannot downgrade a conflict into permission to retry POST', async () => {
  for (const reason of [failure(404), failure(503), Error('offline')]) {
    const f = fixture({ transport: async command => { throw command.method === 'POST' ? failure(409) : reason; } });
    await f.model.start(input()); await f.model.verify();
    assert.equal(f.model.snapshot.status, 'conflict'); assert.equal(f.model.snapshot.locked, true);
    assert.equal(await f.model.retry(), false); assert.deepEqual(f.calls.map(row => row.command.method), ['POST', 'GET']);
  }
});

test('401/403 and retired session errors block and never redispatch', async () => {
  for (const reason of [failure(401), failure(403), Object.assign(Error('retired'), { code: 'session_binding_obsolete' })]) {
    const f = fixture({ transport: async () => { throw reason; } });
    await f.model.start(input()); assert.equal(f.model.snapshot.status, 'blocked'); assert.equal(f.model.snapshot.locked, true);
    assert.equal(await f.model.verify(), false); assert.equal(await f.model.retry(), false); assert.equal(await f.model.start(input()), false);
    assert.equal(f.calls.length, 1);
  }
});

test('malformed envelopes and wrong actor/source/visit ACKs retain uncertainty without accepted evidence', async () => {
  for (const value of [{}, { created: 'yes', resultado: result() }, ack({ ...result(), registrado_por_id: 91001 }),
    ack({ ...result(), visita_revision: 6, revision_resultante: 7 }), ack({ ...result(), visita_id: requestId })]) {
    const f = fixture({ transport: async () => value }); await f.model.start(input());
    assert.equal(f.model.snapshot.status, 'uncertain'); assert.equal(f.model.snapshot.accepted, null); assert.equal(f.model.snapshot.locked, true);
  }
});

test('late session and unmount deliveries never publish or adopt acceptance', async () => {
  for (const unmount of [false, true]) {
    const wait = deferred(), f = fixture({ transport: () => wait.promise }); const pending = f.model.start(input());
    const count = f.states.length; if (unmount) f.model.dispose(); else f.retire();
    wait.resolve(ack()); assert.equal(await pending, false);
    assert.equal(f.states.length, count); assert.equal(f.model.snapshot.accepted, null);
    assert.equal(f.model.snapshot.status, 'blocked'); assert.equal(f.model.snapshot.busy, false);
  }
});

test('synchronous observer retirement prevents transport; initial obsolete scope never dispatches', async () => {
  let f; f = fixture({ observer: state => { if (state.status === 'writing') f.retire(); } });
  assert.equal(await f.model.start(input()), false); assert.equal(f.calls.length, 0); assert.equal(f.model.snapshot.status, 'blocked');
  const retired = fixture(); retired.retire(); await retired.model.start(input());
  assert.equal(retired.calls.length, 0); assert.equal(retired.model.snapshot.status, 'blocked');
});

test('confirmed attempt requires explicit later material revision before a new UUID and never repeats same source', async () => {
  const f = fixture({ transport: async command => ack(result(command.body.expected_revision)) });
  assert.equal(await f.model.start(input()), true);
  assert.equal(await f.model.start(input()), false); assert.equal(await f.model.start({ id: visitId, revision: 8 }), false);
  assert.equal(f.ids, 1); assert.equal(f.model.snapshot.accepted.visita_revision, 7);
  assert.equal(await f.model.start({ id: visitId, revision: 9 }), true);
  assert.equal(f.ids, 2); assert.equal(f.model.snapshot.accepted.visita_revision, 9);
});

test('invalid input or UUID fails locally without sending and reentrant capture cannot admit a second attempt', async () => {
  for (const visit of [{ id: visitId, revision: '7' }, { id: visitId + '\n', revision: 7 }, { id: visitId, revision: 0 }]) {
    const f = fixture(); assert.equal(await f.model.start(visit), false); assert.equal(f.calls.length, 0);
  }
  const bad = fixture({ uuid: () => requestId + '\n' }); await bad.model.start(input()); assert.equal(bad.calls.length, 0);
  let model, nested, sends = 0;
  model = createProductionResultIntent({ capture() { nested = model.start(input()); return { actorId: 91003, current: () => true }; },
    randomUUID: () => requestId, send: async () => { sends++; return ack(); } });
  assert.equal(await model.start(input()), true); assert.equal(await nested, false); assert.equal(sends, 1);
});

test('actual captured cookie session scope rejects ABA even if the same identity and context return', async () => {
  const store = createBrowserSessionState();
  const dto = { usuario: { id: 91003, usuario: 'qa_luciano', nombre: 'Luciano QA', rol: 'edicion' },
    session_context: 'A'.repeat(43), csrf_token: 'B'.repeat(43) };
  const authenticate = value => { const ticket = store.beginBootstrap(); assert.equal(store.acceptBootstrap(ticket, value), true); };
  authenticate(dto);
  const wait = deferred(); let sends = 0;
  const scope = createCapturedRequest({ session: store.getSession(), readSession: store.getSession, request: async () => {} });
  const model = createProductionResultIntent({ capture: () => ({ ...scope, actorId: 91003 }), randomUUID: () => requestId,
    send: () => { sends++; return wait.promise; } });
  const pending = model.start(input()); assert.equal(sends, 1); assert.equal(model.snapshot.status, 'writing');
  authenticate({ ...dto, usuario: { ...dto.usuario, id: 91001, usuario: 'qa_franco' } });
  authenticate(dto);
  wait.resolve(ack()); assert.equal(await pending, false); assert.equal(model.snapshot.accepted, null);
  assert.equal(model.snapshot.status, 'blocked'); assert.equal(await model.retry(), false); assert.equal(sends, 1);
});
