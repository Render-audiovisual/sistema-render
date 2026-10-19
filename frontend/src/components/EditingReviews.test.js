import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { correctionNotes, createEditingReviewsModel, decodeEditingReviews } from './EditingReviews.model.js';

const requestId = '00000000-0000-4000-8000-000000000001';
const deliveryId = '00000000-0000-4000-8000-000000000002';
const decisionId = '00000000-0000-4000-8000-000000000003';
const task = { id: 17, revision: 7, estado: 'en_revision', tipo_tarea: 'edicion', propiedades_extra: { workspace: 'render_os' } };
const session = () => ({ token: 'captured', usuario: { id: 4, rol: 'admin' } });
const latest = () => ({ id: deliveryId, task_id: 17, actor_id: 9, task_revision: 6, url: 'https://example.org/edit', notes: 'Versión', recorded_at: '2026-10-19T15:00:00.000Z' });
const decision = () => ({ id: decisionId, task_id: 17, delivery_id: deliveryId, actor_id: 4, action: 'correcciones', task_revision: 8, notes: 'Cambiar cierre', recorded_at: '2026-10-19T16:00:00.000Z' });
const history = () => ({ task: { id: 17, revision: 7, estado: 'en_revision' }, latest_delivery: latest(), decisions: [], total: 0, truncated: false, can_request_corrections: true });
const accepted = () => ({ ...history(), task: { id: 17, revision: 8, estado: 'en_progreso' }, decisions: [decision()], total: 1, can_request_corrections: false, decision_id: decisionId, replayed: false });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
function fakeTimers() {
  let next = 0; const jobs = new Map();
  return { jobs, setTimeout(fn, ms) { assert.equal(ms, 15000); jobs.set(++next, fn); return next; }, clearTimeout(id) { jobs.delete(id); }, fire() { for (const [id, fn] of [...jobs]) { jobs.delete(id); fn(); } } };
}
function fixture(request, overrides = {}) {
  const currentSession = session(), states = [], timers = fakeTimers();
  const model = createEditingReviewsModel({ task, sesion: currentSession, readSession: () => currentSession, request, timers, uuid: () => requestId,
    onChange: state => states.push(state), ...overrides });
  return { model, currentSession, states, timers };
}
async function draft(model) { await model.refresh(); model.setNotes(' Cambiar cierre '); model.acknowledge(true); }

test('notes are explicit nonempty trimmed text with bounded length and no NUL', () => {
  assert.equal(correctionNotes(' Cambiar cierre '), 'Cambiar cierre');
  for (const notes of ['', ' ', null, [], 'x'.repeat(4001), 'bad\0']) assert.throws(() => correctionNotes(notes));
});

test('closed DTO drops arbitrary fields and preserves latest artifact and historical decisions separately', () => {
  const raw = accepted(); raw.task.metadata = { proof: 'secret' }; raw.latest_delivery.private = 'secret'; raw.decisions[0].token = 'secret';
  const dto = decodeEditingReviews(raw, 17, true);
  assert.equal(JSON.stringify(dto).includes('secret'), false);
  assert.deepEqual(Object.keys(dto.task), ['id', 'revision', 'estado']);
  assert.deepEqual(Object.keys(dto.decisions[0]), ['id', 'task_id', 'delivery_id', 'actor_id', 'action', 'task_revision', 'notes', 'recorded_at']);
  assert.equal(dto.latest_delivery.task_revision, 6); assert.equal(dto.decisions[0].task_revision, 8);
});

test('decoder rejects cross-task identity, malformed URLs/UUIDs/notes/dates and counterfeit approval', () => {
  for (const patch of [{ task_id: 9 }, { actor_id: 0 }, { id: 'bad' }, { delivery_id: 'bad' }, { action: 'publicada' },
    { task_revision: 0 }, { task_revision: 10 }, { notes: '' }, { recorded_at: '2026-02-30T00:00:00Z' }]) {
    const dto = accepted(); Object.assign(dto.decisions[0], patch); assert.throws(() => decodeEditingReviews(dto, 17));
  }
  for (const patch of [{ task_id: 9 }, { url: 'javascript:evil' }, { id: 'bad' }, { task_revision: 20 }]) {
    const dto = history(); Object.assign(dto.latest_delivery, patch); assert.throws(() => decodeEditingReviews(dto, 17));
  }
  const dto = accepted(); dto.decisions[0].action = 'aprobada'; assert.throws(() => decodeEditingReviews(dto, 17));
  dto.decisions[0].notes = ''; assert.equal(decodeEditingReviews(dto, 17).decisions[0].action, 'aprobada');
});

test('history is latest 200 with honest total/truncation, ordered by task revision, no fabricated old approvals', () => {
  const raw = history(); raw.task.revision = 250; raw.can_request_corrections = false; raw.total = 250; raw.truncated = true;
  raw.decisions = Array.from({ length: 200 }, (_, i) => ({ ...decision(), id: `00000000-0000-4000-8000-${String(i + 100).padStart(12, '0')}`, task_revision: i + 51 }));
  const dto = decodeEditingReviews(raw, 17); assert.equal(dto.total, 250); assert.equal(dto.decisions.length, 200); assert.equal(dto.decisions.at(-1).task_revision, 250);
  assert.throws(() => decodeEditingReviews({ ...raw, truncated: false }, 17));
  assert.throws(() => decodeEditingReviews({ ...raw, decisions: raw.decisions.slice(1) }, 17));
  const empty = { ...history(), latest_delivery: null, can_request_corrections: false };
  assert.equal(decodeEditingReviews(empty, 17).decisions.length, 0);
  assert.throws(() => decodeEditingReviews({ ...accepted(), latest_delivery: null }, 17));
});

test('receipt replay may name a decision outside the newest 200 without certifying current artifact approval', () => {
  const raw = { ...history(), task: { id: 17, revision: 20, estado: 'programada' }, can_request_corrections: false, decision_id: decisionId, replayed: true };
  assert.equal(decodeEditingReviews(raw, 17, true).replayed, true);
  assert.throws(() => decodeEditingReviews({ ...raw, replayed: false }, 17, true));
});

test('GET and POST have exact independent endpoints and closed business body with explicit acknowledgement', async () => {
  const calls = [], saved = [];
  const { model } = fixture(async (url, options = {}) => { calls.push([url, options]); return options.method ? accepted() : history(); }, { onSaved: dto => saved.push(dto) });
  await model.refresh(); model.setNotes(' Cambiar cierre '); await model.submit(); assert.equal(calls.length, 1);
  model.acknowledge(true); await model.submit();
  assert.equal(calls[0][0], '/api/tareas-edicion/17/revisiones'); assert.equal(calls[1][0], '/api/tareas-edicion/17/correcciones');
  assert.deepEqual(JSON.parse(calls[1][1].body), { request_id: requestId, expected_revision: 7, expected_entrega_id: deliveryId, notes: 'Cambiar cierre' });
  assert.equal(saved.length, 1); assert.equal(model.snapshot.notes, ''); model.dispose();
});

test('same-task revision changes clear acknowledgement and cannot silently rebase notes onto new version', async () => {
  let writes = 0; const { model } = fixture(async (url, options = {}) => { if (options.method) writes++; return history(); });
  await draft(model); assert.equal(model.snapshot.acknowledged, true);
  model.updateContext({ ...task, revision: 8 });
  assert.equal(model.snapshot.acknowledged, false); assert.equal(model.snapshot.notes, ' Cambiar cierre ');
  model.acknowledge(true); await model.submit(); assert.equal(writes, 0);
  await model.refresh(); model.acknowledge(true); assert.equal(model.snapshot.acknowledged, false); model.dispose();
});

test('latest delivery refresh clears checkbox while keeping notes', async () => {
  let read = history(); const { model } = fixture(async () => read);
  await draft(model); read = { ...history(), latest_delivery: { ...latest(), id: requestId } };
  await model.refresh(); assert.equal(model.snapshot.acknowledged, false); assert.equal(model.snapshot.notes, ' Cambiar cierre '); model.dispose();
});

test('409 preserves draft, discards pending receipt and requires manual refresh plus acknowledgement', async () => {
  let calls = 0; const { model } = fixture(async (url, options = {}) => { calls++; if (options.method) throw Object.assign(new Error(), { status: 409 }); return history(); });
  await draft(model); await model.submit(); assert.equal(calls, 2); assert.equal(model.snapshot.conflict, true);
  assert.equal(model.snapshot.notes, ' Cambiar cierre '); assert.equal(model.snapshot.acknowledged, false);
  await model.submit(); await model.retry(); assert.equal(calls, 2);
  await model.refresh(); assert.equal(calls, 3); assert.equal(model.snapshot.conflict, false); assert.equal(model.snapshot.acknowledged, false); model.dispose();
});

test('408, network and 500 keep exact UUID/body/notes; competing edits cannot replace uncertain intention', async () => {
  for (const status of [408, 500, undefined]) {
    const calls = []; let fail = true, keys = 0;
    const { model } = fixture(async (url, options = {}) => { calls.push(options); if (!options.method) return history(); if (fail) throw Object.assign(new Error(), { status }); return accepted(); }, { uuid: () => { keys++; return requestId; } });
    await draft(model); await model.submit(); assert.equal(model.snapshot.uncertain, true);
    model.setNotes('changed'); model.acknowledge(true); await model.refresh(); await model.submit();
    assert.equal(model.snapshot.notes, ' Cambiar cierre '); assert.equal(calls.length, 2);
    fail = false; await model.retry(); assert.equal(calls[1].body, calls[2].body); assert.equal(keys, 1); model.dispose();
  }
});

test('mismatched receipt notes stay uncertain, preserve draft and exact retry before clearing acceptance', async () => {
  let wrong = true, saved = 0; const bodies = [];
  const { model } = fixture(async (url, options = {}) => {
    if (!options.method) return history();
    bodies.push(options.body); const dto = accepted();
    if (wrong) dto.decisions[0].notes = 'Otra intención';
    return dto;
  }, { onSaved: () => saved++ });
  await draft(model); await model.submit();
  assert.equal(model.snapshot.uncertain, true); assert.equal(model.snapshot.notes, ' Cambiar cierre ');
  assert.equal(model.snapshot.accepted, null); assert.equal(saved, 0);
  wrong = false; await model.retry();
  assert.equal(bodies[0], bodies[1]); assert.equal(saved, 1); assert.equal(model.snapshot.notes, ''); model.dispose();
});

test('disabled and nonadmin/current permission checks deny writes without name-derived privileges', async () => {
  for (const role of ['employee', 'edicion', 'admin']) {
    const current = { ...session(), usuario: { id: 4, rol: role, nombre: 'Franco' } }; let writes = 0;
    const { model } = fixture(async (url, options = {}) => { if (options.method) writes++; return { ...history(), can_request_corrections: role !== 'admin' }; }, { sesion: current, readSession: () => current });
    await draft(model); await model.submit(); assert.equal(writes, 0); model.dispose();
  }
  const { model } = fixture(async () => history()); await draft(model); model.updateContext(task, true);
  model.setNotes('changed'); await model.submit(); assert.equal(model.snapshot.notes, ' Cambiar cierre '); model.dispose();
});

test('duplicate submit gate and awaited parent refresh keep busy without replay after callback failure', async () => {
  const parent = deferred(); let writes = 0, receivedGuard;
  const { model } = fixture(async (url, options = {}) => { if (options.method) { writes++; return accepted(); } return history(); },
    { onSaved: async (dto, isCurrent) => { receivedGuard = isCurrent; await parent.promise; throw new Error('refresh'); } });
  await draft(model); const pending = model.submit(); await model.submit(); await flush();
  assert.equal(writes, 1); assert.equal(model.snapshot.busy, true); assert.equal(receivedGuard(), true);
  parent.resolve(); await pending; await model.retry(); assert.equal(writes, 1); assert.equal(model.snapshot.uncertain, false);
  assert.ok(model.snapshot.accepted); assert.match(model.snapshot.message, /Pedido registrado/); model.dispose();
});

test('session ID/token/role races suppress late reads/writes and prevent retry with changed identity', async () => {
  for (const field of ['id', 'token', 'role']) for (const write of [false, true]) for (const fail of [false, true]) {
    const wait = deferred(); let saved = 0, calls = 0;
    const { model, currentSession } = fixture(async (url, options = {}) => { calls++; if (write && !options.method) return history(); return wait.promise; }, { onSaved: () => saved++ });
    if (write) await draft(model);
    const pending = write ? model.submit() : model.refresh();
    if (field === 'id') currentSession.usuario.id = 5; else if (field === 'role') currentSession.usuario.rol = 'employee'; else currentSession.token = 'changed';
    if (fail) wait.reject(new Error()); else wait.resolve(write ? accepted() : history());
    assert.equal(await pending, undefined); assert.equal(model.snapshot.data, null); assert.equal(saved, 0);
    const before = calls; await model.refresh(); await model.retry(); assert.equal(calls, before); model.dispose();
  }
});

test('callback guard invalidates across its awaited parent refresh and task disposal', async () => {
  for (const change of ['session', 'dispose']) {
    const parent = deferred(); let dispatched = 0;
    const { model, currentSession } = fixture(async (url, options = {}) => options.method ? accepted() : history(), { onSaved: async (dto, isCurrent) => { await parent.promise; if (isCurrent()) dispatched++; } });
    await draft(model); const pending = model.submit(); await flush();
    if (change === 'session') currentSession.token = 'changed'; else model.dispose();
    parent.resolve(); await pending; assert.equal(dispatched, 0); model.dispose();
  }
});

test('out-of-order GET, parent revision change and selection change suppress stale data', async () => {
  for (const change of ['refresh', 'revision', 'selection']) {
    const wait = deferred(); let reads = 0;
    const { model } = fixture(async () => ++reads === 1 ? wait.promise : history());
    const old = model.refresh();
    if (change === 'refresh') await model.refresh(); else model.updateContext({ ...task, ...(change === 'revision' ? { revision: 8 } : { id: 18 }) });
    wait.resolve(history()); assert.equal(await old, undefined);
    if (change !== 'refresh') assert.equal(model.snapshot.data, null); model.dispose();
  }
});

test('GET deadline aborts at 15 seconds, clears loading and reports failure, not empty success', async () => {
  let signal;
  const { model, timers } = fixture((url, options) => { signal = options.signal; return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('abort')), { once: true })); });
  const pending = model.refresh(); assert.equal(model.snapshot.loading, true); assert.equal(timers.jobs.size, 1);
  timers.fire(); await pending;
  assert.equal(signal.aborted, true); assert.equal(model.snapshot.loading, false); assert.equal(model.snapshot.data, null);
  assert.match(model.snapshot.error, /No se pudo consultar/); assert.equal(timers.jobs.size, 0); model.dispose();
});

test('POST deadline preserves draft and exact uncertain intent for successful explicit retry', async () => {
  const bodies = []; let hanging = true;
  const { model, timers } = fixture(async (url, options = {}) => {
    if (!options.method) return history(); bodies.push(options.body);
    if (hanging) return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('abort')), { once: true }));
    return accepted();
  });
  await draft(model); const pending = model.submit(); timers.fire(); await pending;
  assert.equal(model.snapshot.busy, false); assert.equal(model.snapshot.uncertain, true); assert.equal(model.snapshot.notes, ' Cambiar cierre ');
  hanging = false; await model.retry(); assert.equal(bodies[0], bodies[1]); assert.equal(timers.jobs.size, 0); model.dispose();
});

test('timers clear on successful/failing requests, context abort and disposal', async () => {
  for (const mode of ['success', 'failure', 'revision', 'dispose']) {
    const wait = deferred();
    const { model, timers } = fixture(() => wait.promise); const pending = model.refresh();
    if (mode === 'revision') model.updateContext({ ...task, revision: 8 });
    if (mode === 'dispose') model.dispose();
    if (mode === 'failure') wait.reject(new Error('failure')); else wait.resolve(history());
    await pending; assert.equal(timers.jobs.size, 0); model.dispose();
  }
});

test('component source preserves explicit correction acknowledgement, callbacks cleanup and honest history labels', () => {
  const source = readFileSync(new URL('./EditingReviews.jsx', import.meta.url), 'utf8');
  assert.match(source, /Revisión y correcciones/); assert.match(source, /Revisé esta versión para pedir correcciones/);
  assert.match(source, /Revisión de tarea \{item.task_revision\}/); assert.match(source, /Entrega \{item.delivery_id\}/);
  assert.match(source, /últimas 200/); assert.match(source, /no se infieren del estado/);
  assert.match(source, /await saved.current\?\.\(dto, isCurrent\)/);
  assert.match(source, /onDirty\?\.\(false\)/); assert.match(source, /onBusy\?\.\(false\)/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|aprobar-publicacion|Aprobar revisión/);
  const css = readFileSync(new URL('./EditingReviews.css', import.meta.url), 'utf8'); assert.match(css, /min-height:44px/); assert.match(css, /focus-visible/);
});
