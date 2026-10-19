import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEditingDeliveriesModel, decodeEditingDeliveries, deliveryInput, deliveryUrl, editingReviewContext, isEditingDeliveryTask } from '../components/EditingDeliveries.model.js';

const key = '00000000-0000-4000-8000-000000000001';
const eventId = '00000000-0000-4000-8000-000000000002';
const task = { id: 17, revision: 7, estado: 'en_revision', tipo_tarea: 'edicion', propiedades_extra: { workspace: 'render_os' }, material_referencia: 'https://example.org/raw' };
const session = () => ({ token: 'test-token', usuario: { id: 4, rol: 'edicion' } });
const event = () => ({ id: eventId, task_id: 17, actor_id: 4, task_revision: 8, url: 'https://example.org/edit', notes: 'Versión editada', recorded_at: '2026-10-19T15:00:00.000Z' });
const history = (revision = 7, deliveries = [], can_deliver = true) => ({ task: { id: 17, revision, estado: 'en_revision' }, deliveries, can_deliver });
const accepted = () => ({ ...history(8, [event()]), delivery_id: eventId, replayed: false });
const input = { url: 'https://example.org/edit', notes: 'Versión editada' };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture(request, options = {}) {
  const currentSession = session(), states = [];
  const model = createEditingDeliveriesModel({ task, sesion: currentSession, readSession: () => currentSession, request,
    uuid: () => key, onChange: value => states.push(value), ...options });
  return { model, currentSession, states };
}

test('only persisted Render OS editing tasks expose the component', () => {
  assert.equal(isEditingDeliveryTask(task), true);
  for (const invalid of [{ ...task, id: 0 }, { ...task, tipo_tarea: 'produccion' }, { ...task, propiedades_extra: {} },
    { ...task, workspace: 'other' }, { ...task, propiedades_extra: { workspace: 'preview' } }]) assert.equal(isEditingDeliveryTask(invalid), false);
});

test('URL and notes normalization matches strict backend input without resolving external resources', () => {
  assert.deepEqual(deliveryInput({ url: ' https://EXAMPLE.org ', notes: ' texto ' }), { url: 'https://example.org/', notes: 'texto' });
  for (const url of ['javascript:alert(1)', 'https://user:password@example.org', 'https://example.org/a b', 'https://example.org/a\\b',
    'https:example.org', 'https://example.org/\n', '', 'https://example.org/' + 'é'.repeat(600)]) assert.throws(() => deliveryUrl(url));
  for (const notes of [null, 'x'.repeat(4001), 'bad\0']) assert.throws(() => deliveryInput({ url: input.url, notes }));
});

test('closed DTO drops arbitrary task/event fields and sorts newest last', () => {
  const older = { ...event(), id: key, task_revision: 7, recorded_at: '2026-10-18T15:00:00.000Z' };
  const dto = history(8, [{ ...event(), financial_secret: 'never' }, older]); dto.task.material_referencia = 'never'; dto.opaque = { secret: true };
  const result = decodeEditingDeliveries(dto, 17);
  assert.deepEqual(Object.keys(result.task), ['id', 'revision', 'estado']);
  assert.equal(JSON.stringify(result).includes('never'), false);
  assert.equal(result.deliveries.at(-1).id, eventId);
  assert.deepEqual(Object.keys(result.deliveries[0]), ['id', 'task_id', 'actor_id', 'task_revision', 'url', 'notes', 'recorded_at']);
});

test('latest delivery means highest task revision, then timestamp and UUID, never wall clock alone', () => {
  const newestRevision = { ...event(), id: '00000000-0000-4000-8000-000000000004', task_revision: 9, recorded_at: '2026-10-18T12:00:00Z' };
  const laterClock = { ...event(), task_revision: 8, recorded_at: '2026-10-19T15:00:00Z' };
  const sameRevision = { ...newestRevision, id: '00000000-0000-4000-8000-000000000003' };
  const earlierClock = { ...newestRevision, id: '00000000-0000-4000-8000-000000000005', recorded_at: '2026-10-18T11:00:00Z' };
  const data = history(10, [newestRevision, laterClock, sameRevision, earlierClock]);
  assert.equal(decodeEditingDeliveries(data, 17).deliveries.at(-1).id, newestRevision.id);
  const context = editingReviewContext({ data }, task);
  assert.deepEqual(context.latestDelivery, { id: newestRevision.id, task_revision: 9, url: newestRevision.url });
});

test('review context is closed, distinguishes empty history, and blocks loading/error/uncertain/conflict/busy', () => {
  const data = history(8, [{ ...event(), financial_secret: 'never' }]);
  const ready = editingReviewContext({ data }, task);
  assert.deepEqual(ready, { status: 'ready', task: { id: 17, revision: 8, estado: 'en_revision' },
    latestDelivery: { id: eventId, task_revision: 8, url: input.url }, can_deliver: true });
  assert.deepEqual(Object.keys(ready.latestDelivery), ['id', 'task_revision', 'url']);
  const empty = editingReviewContext({ data: history(7, [], false) }, task);
  assert.equal(empty.status, 'ready'); assert.equal(empty.latestDelivery, null); assert.equal(empty.can_deliver, false);
  for (const block of [{ loading: true }, { busy: true }, { error: 'failed' }, { uncertain: true }, { conflict: true }]) {
    const context = editingReviewContext({ data, ...block }, task);
    assert.equal(context.status, block.loading || block.busy ? 'loading' : 'error');
    assert.equal(context.latestDelivery, null); assert.equal(context.can_deliver, false);
  }
  assert.equal(editingReviewContext({ data: { ...data, task: { ...data.task, id: 99 } } }, task).status, 'error');
  const legacy = editingReviewContext({ data: { ...history(8, [event()], false), task: { id: 17, revision: 8, estado: 'programada' } } }, task);
  assert.equal(legacy.status, 'ready'); assert.equal(legacy.task.estado, 'programada'); assert.equal(legacy.can_deliver, false);
});

test('review callback emits loading/ready and clears to a closed error context on cleanup', async () => {
  const contexts = [], wait = deferred();
  const { model } = fixture(() => wait.promise, { onReviewContext: value => contexts.push(value) });
  const pending = model.refresh();
  assert.deepEqual(contexts.at(-1), { status: 'loading', task: { id: 17, revision: 7, estado: 'en_revision' }, latestDelivery: null, can_deliver: false });
  wait.resolve(history(8, [event()])); await pending;
  assert.equal(contexts.at(-1).status, 'ready'); assert.equal(contexts.at(-1).latestDelivery.id, eventId);
  model.dispose();
  assert.deepEqual(contexts.at(-1), { status: 'error', task: { id: 17, revision: 7, estado: 'en_revision' }, latestDelivery: null, can_deliver: false });
  const count = contexts.length; model.dispose(); assert.equal(contexts.length, count);
});

test('obsolete reads after session drift or disposal cannot emit ready review context', async () => {
  for (const mode of ['session', 'selection']) {
    const contexts = [], wait = deferred();
    const { model, currentSession } = fixture(() => wait.promise, { onReviewContext: value => contexts.push(value) });
    const pending = model.refresh();
    if (mode === 'session') currentSession.token = 'replacement'; else model.dispose();
    wait.resolve(history(8, [event()])); await pending;
    assert.equal(contexts.at(-1).status, 'error'); assert.equal(contexts.some(value => value.status === 'ready'), false);
    model.dispose();
  }
});

test('review remains loading throughout accepted write and awaited parent refresh; then emits exact observed DTO revision', async () => {
  const contexts = [], parent = deferred();
  const { model } = fixture(async (url, options = {}) => options.method ? accepted() : history(), {
    onReviewContext: context => contexts.push(context), onSaved: async () => { await parent.promise; },
  });
  await model.refresh(); const sending = model.submit(input); await new Promise(resolve => setImmediate(resolve));
  assert.equal(contexts.at(-1).status, 'loading'); assert.equal(contexts.at(-1).latestDelivery, null);
  parent.resolve(); await sending;
  assert.deepEqual(contexts.at(-1), { status: 'ready', task: { id: 17, revision: 8, estado: 'en_revision' }, latestDelivery: { id: eventId, task_revision: 8, url: input.url }, can_deliver: true });
  model.dispose();
});

test('409 and uncertain writes invalidate reviewer context until explicit resolution', async () => {
  for (const status of [408, 409]) {
    const contexts = [];
    const { model } = fixture(async (url, options = {}) => {
      if (options.method) throw Object.assign(new Error(), { status }); return history(8, [event()]);
    }, { onReviewContext: context => contexts.push(context) });
    await model.refresh(); await model.submit(input);
    assert.equal(contexts.at(-1).status, 'error'); assert.equal(contexts.at(-1).latestDelivery, null); model.dispose();
  }
});

test('review callback failure cannot convert accepted delivery into uncertain retry', async () => {
  const { model } = fixture(async (url, options = {}) => options.method ? accepted() : history(), { onReviewContext: () => { throw new Error('consumer failure'); } });
  await model.refresh(); await model.submit(input);
  assert.ok(model.snapshot.accepted); assert.equal(model.snapshot.uncertain, false); assert.equal(model.snapshot.busy, false); model.dispose();
});

test('DTO rejects identity/version/date/unsafe URL and incomplete mutation receipts', () => {
  for (const patch of [{ task_id: 9 }, { actor_id: 0 }, { task_revision: 9 }, { url: 'javascript:evil' }, { recorded_at: '2026-02-30T00:00:00Z' }]) {
    assert.throws(() => decodeEditingDeliveries(history(8, [{ ...event(), ...patch }]), 17));
  }
  assert.throws(() => decodeEditingDeliveries(history(0), 17));
  assert.throws(() => decodeEditingDeliveries(history(8, [event(), event()]), 17));
  assert.throws(() => decodeEditingDeliveries(history(8, [event()]), 17, true));
  assert.throws(() => decodeEditingDeliveries({ ...history(), task: { id: 9, revision: 7, estado: 'en_revision' } }, 17));
});

test('GET empty means no event, never infer from raw material, approval or task metadata', async () => {
  const { model } = fixture(async () => history()); await model.refresh();
  assert.equal(model.snapshot.data.deliveries.length, 0);
  assert.equal(task.material_referencia, 'https://example.org/raw'); model.dispose();
});

test('historical programada state remains readable without enabling delivery', async () => {
  const dto = { ...history(8, [event()], false), task: { id: 17, revision: 8, estado: 'programada' } };
  let writes = 0;
  const { model } = fixture(async (url, options = {}) => {
    if (options.method) writes++;
    return dto;
  });
  await model.refresh();
  assert.equal(model.snapshot.data.task.estado, 'programada');
  assert.equal(model.snapshot.data.deliveries.length, 1);
  assert.equal(model.snapshot.data.can_deliver, false);
  await model.submit(input);
  await model.retry();
  assert.equal(writes, 0);
  model.dispose();
});

test('POST contains only canonical business input, UUID and observed revision, no query parameters', async () => {
  const calls = [], saved = [];
  const { model } = fixture(async (url, options = {}) => { calls.push([url, options]); return options.method ? accepted() : history(); }, { onSaved: dto => saved.push(dto) });
  await model.refresh(); await model.submit(input);
  assert.equal(calls[0][0], '/api/tareas-edicion/17/entregas'); assert.equal(calls[1][0], calls[0][0]);
  assert.deepEqual(JSON.parse(calls[1][1].body), { request_id: key, expected_revision: 7, ...input });
  assert.equal(saved.length, 1); assert.deepEqual(saved[0].task, { id: 17, revision: 8, estado: 'en_revision' });
  model.dispose();
});

test('uncertain 408/network/500 retry keeps exact body, UUID, revision and no GET/rebase', async () => {
  for (const status of [408, 500, undefined]) {
    const calls = []; let fail = true, keys = 0;
    const { model } = fixture(async (url, options = {}) => {
      calls.push(options); if (!options.method) return history();
      if (fail) throw Object.assign(new Error(), { status }); return accepted();
    }, { uuid: () => { keys++; return key; } });
    await model.refresh(); await model.submit(input);
    assert.equal(model.snapshot.uncertain, true); await model.refresh(); await model.submit({ ...input, notes: 'changed' });
    assert.equal(calls.length, 2); fail = false; await model.retry();
    assert.equal(calls[1].body, calls[2].body); assert.equal(keys, 1); assert.equal(model.snapshot.uncertain, false); model.dispose();
  }
});

test('409 preserves form responsibility and requires explicit refresh plus another explicit intent', async () => {
  const calls = []; let revision = 7, conflict = true;
  const { model } = fixture(async (url, options = {}) => {
    calls.push(options); if (!options.method) return history(revision);
    if (conflict) throw Object.assign(new Error(), { status: 409 }); return { ...accepted(), task: { id: 17, revision: 10, estado: 'en_revision' } };
  });
  await model.refresh(); await model.submit(input); assert.equal(model.snapshot.conflict, true);
  await model.submit(input); await model.retry(); assert.equal(calls.length, 2);
  revision = 9; await model.refresh(); assert.equal(calls.length, 3); assert.equal(model.snapshot.conflict, false);
  conflict = false; await model.submit(input); assert.equal(JSON.parse(calls[3].body).expected_revision, 9); model.dispose();
});

test('no local role/name heuristic can override can_deliver=false', async () => {
  let writes = 0;
  const { model } = fixture(async (url, options = {}) => { if (options.method) writes++; return history(7, [], false); },
    { sesion: { token: 'test-token', usuario: { id: 4, rol: 'admin', nombre: 'Franco' } } });
  // Match the actual current role; the trusted DTO still controls availability.
  const admin = { token: 'test-token', usuario: { id: 4, rol: 'admin' } };
  model.dispose();
  const another = fixture(async (url, options = {}) => { if (options.method) writes++; return history(7, [], false); }, { sesion: admin, readSession: () => admin }).model;
  await another.refresh(); await another.submit(input); assert.equal(writes, 0); another.dispose();
});

test('synchronous duplicate submission gate and busy held throughout awaited parent refresh', async () => {
  const response = deferred(), parent = deferred(); let writes = 0, callback = false;
  const { model } = fixture(async (url, options = {}) => { if (!options.method) return history(); writes++; return response.promise; },
    { onSaved: async () => { callback = true; await parent.promise; } });
  await model.refresh(); const pending = model.submit(input); await model.submit(input); assert.equal(writes, 1);
  response.resolve(accepted()); await new Promise(resolve => setImmediate(resolve));
  assert.equal(callback, true); assert.equal(model.snapshot.busy, true); assert.ok(model.snapshot.accepted);
  parent.resolve(); await pending; assert.equal(model.snapshot.busy, false); model.dispose();
});

test('parent refresh failure keeps acceptance and never enables uncertain repost', async () => {
  let writes = 0;
  const { model } = fixture(async (url, options = {}) => { if (!options.method) return history(); writes++; return accepted(); }, { onSaved: async () => { throw new Error('refresh failure'); } });
  await model.refresh(); await model.submit(input); await model.retry();
  assert.equal(writes, 1); assert.equal(model.snapshot.uncertain, false); assert.ok(model.snapshot.accepted);
  assert.match(model.snapshot.message, /Entrega registrada.*No se pudo actualizar/); model.dispose();
});

test('session change without rerender blocks dispatch and suppresses late GET/POST success or failure', async () => {
  for (const field of ['id', 'role', 'token']) for (const write of [false, true]) for (const failure of [false, true]) {
    const wait = deferred(); let calls = 0, saved = 0;
    const { model, currentSession } = fixture(async (url, options = {}) => { calls++; if (write && !options.method) return history(); return wait.promise; }, { onSaved: () => saved++ });
    if (write) await model.refresh();
    const pending = write ? model.submit(input) : model.refresh();
    if (field === 'id') currentSession.usuario.id = 5; else if (field === 'role') currentSession.usuario.rol = 'employee'; else currentSession.token = 'new-token';
    if (failure) wait.reject(new Error()); else wait.resolve(write ? accepted() : history());
    assert.equal(await pending, undefined); assert.equal(saved, 0); assert.equal(model.snapshot.data, null);
    const count = calls; await model.submit(input); await model.refresh(); assert.equal(calls, count); model.dispose();
  }
});

test('callback guard detects session switch during parent await and suppresses parent dispatch', async () => {
  const parent = deferred(); let dispatches = 0;
  const { model, currentSession } = fixture(async (url, options = {}) => options.method ? accepted() : history(), {
    onSaved: async (dto, isCurrent) => { assert.equal(isCurrent(), true); await parent.promise; if (isCurrent()) dispatches++; },
  });
  await model.refresh(); const pending = model.submit(input); await new Promise(resolve => setImmediate(resolve));
  currentSession.token = 'new-session'; parent.resolve(); await pending;
  assert.equal(dispatches, 0); assert.equal(model.snapshot.accepted, null); model.dispose();
});

test('disposal suppresses late responses and callback guard becomes false after task selection change', async () => {
  const wait = deferred(); let saved = 0;
  const { model } = fixture(() => wait.promise, { onSaved: () => saved++ });
  const pending = model.refresh(); model.dispose(); wait.resolve(history()); await pending;
  assert.equal(saved, 0);
  const parent = deferred(); let valid;
  const other = fixture(async (url, options = {}) => options.method ? accepted() : history(), { onSaved: async (dto, isCurrent) => { await parent.promise; valid = isCurrent(); } }).model;
  await other.refresh(); const result = other.submit(input); await new Promise(resolve => setImmediate(resolve)); other.dispose(); parent.resolve(); await result; assert.equal(valid, false);
});

test('manual refresh out-of-order responses never overwrite current history', async () => {
  const first = deferred(), second = deferred(); let calls = 0;
  const { model } = fixture(() => ++calls === 1 ? first.promise : second.promise);
  const old = model.refresh(), latest = model.refresh(); second.resolve(history(9)); await latest; first.resolve(history(7)); await old;
  assert.equal(model.snapshot.data.task.revision, 9); model.dispose();
});

test('GET failure is fail-closed; invalid inputs never POST', async () => {
  let writes = 0, fail = true;
  const { model } = fixture(async (url, options = {}) => { if (options.method) writes++; if (fail) throw new Error('private'); return history(); });
  await model.refresh(); await model.submit(input); assert.equal(writes, 0); assert.equal(model.snapshot.data, null);
  fail = false; await model.refresh(); await model.submit({ url: 'javascript:evil', notes: '' }); assert.equal(writes, 0); model.dispose();
});

test('replay returns current task/history, does not imply approval or recreate a delivery', async () => {
  const dto = { ...accepted(), replayed: true, task: { id: 17, revision: 12, estado: 'finalizada' }, can_deliver: false };
  const { model } = fixture(async (url, options = {}) => options.method ? dto : history()); await model.refresh(); await model.submit(input);
  assert.equal(model.snapshot.data.task.estado, 'finalizada'); assert.equal(model.snapshot.data.deliveries.length, 1); assert.equal(model.snapshot.data.can_deliver, false); model.dispose();
});

test('component source contract: separated material/history, no storage or generic review claims, parent guards cleanup', () => {
  const text = readFileSync(new URL('../components/EditingDeliveries.jsx', import.meta.url), 'utf8');
  assert.match(text, /Material de origen/); assert.match(text, /Sin entrega registrada/); assert.match(text, /Entregar versión y enviar a revisión/);
  assert.match(text, /onDirty\?\.\(false\)/); assert.match(text, /onBusy\?\.\(false\)/); assert.match(text, /await saved.current\?\.\(dto, isCurrent\)/);
  assert.match(text, /onReviewContext: context => reviewContext.current\?\.\(context\)/);
  assert.doesNotMatch(text, /expected_entrega_id|aprobar-publicacion|Aprobar revisión|Aprobar y enviar/);
  assert.match(text, /state\.uncertain/); assert.doesNotMatch(text, /localStorage|sessionStorage|Object\.assign\(task|\.\.\.dto\.task/);
  const css = readFileSync(new URL('../components/EditingDeliveries.css', import.meta.url), 'utf8');
  assert.match(css, /min-height:44px/); assert.match(css, /focus-visible/);
});
