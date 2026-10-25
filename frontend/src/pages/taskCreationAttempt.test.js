import test from 'node:test';
import assert from 'node:assert/strict';
import { taskCreationBody, parseTaskCreationAck, createTaskCreationAttempt } from './taskCreationAttempt.js';
import { createCapturedRequest } from '../shared/session/captured-request.js';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';

const key = '11111111-2222-4333-8444-555555555555';
const otherKey = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
test('retiring scope from synchronous state observer prevents dispatch before transport',async()=>{
  let active=true,calls=0;
  const model=createTaskCreationAttempt({capture:()=>({current:()=>active}),randomUUID:()=>key,
    send:async()=>{calls++;throw Error('Must not dispatch');},
    onState:state=>{if(state.phase==='writing')active=false;}});
  assert.equal(await model.start({titulo:'Retired',asignado_a_id:7}),false);assert.equal(calls,0);
});
const draft = patch => ({ titulo: 'Original', asignado_a_id: 7, colaborador_ids: [9, 7, 8, 9],
  cliente_id: '3', estado: 'pendiente', tipo_tarea: 'desarrollo', etiquetas: ' a, b, ', ...patch });
const ack = (patch = {}) => ({ version: 1, operation: { request_id: key, task_id: 21, replayed: false },
  task: { id: 21, revision: 1, titulo: 'Original', asignado_a_id: 7, colaborador_ids: [8, 9], propiedades_extra: { workspace: 'render_os' } }, ...patch });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture({ send = async () => ack(), randomUUID = () => key } = {}) {
  const states = [], calls = []; let active = true, captures = 0, ids = 0;
  const scope = { current: () => active };
  const model = createTaskCreationAttempt({ capture() { captures++; return scope; },
    randomUUID() { ids++; return randomUUID(); },
    send(input, options) { calls.push({ input, ...options }); return send(input, options, calls.length); },
    onState: state => states.push(state) });
  return { model, states, calls, scope, retire() { active = false; }, get captures() { return captures; }, get ids() { return ids; } };
}

test('closed creation body strips display labels/UI fields and normalizes IDs/defaults without mutating draft', () => {
  const value = draft({ asignado_a: 'Stale label', colaboradores: ['Other label'], showDetails: true,
    suggestionMessage: 'UI only', propiedades_extra: { injected: true }, request_id: otherKey,
    fecha_vencimiento: '', subtipo: '', resumen: '  Summary  ', tarea_padre_id: '4' });
  const before = structuredClone(value), body = taskCreationBody(value, key.toUpperCase());
  assert.deepEqual(body, { request_id: key, workspace: 'render_os', titulo: 'Original',
    asignado_a_id: 7, colaborador_ids: [8, 9], cliente_id: 3, estado: 'pendiente', prioridad: 'media',
    fecha_vencimiento: null, tipo_tarea: 'desarrollo', subtipo: null, aclaraciones: null,
    material_referencia: null, resumen: 'Summary', etiquetas: ['a', 'b'], tarea_padre_id: 4 });
  assert.deepEqual(value, before);
  assert.equal(taskCreationBody(draft({ produccion_videos_previstos: '3', tipo_tarea: 'produccion' }), key).produccion_videos_previstos, 3);
});

test('invalid local draft or insecure UUID never dispatches and remains editable', async () => {
  for (const value of [draft({ titulo: ' ' }), draft({ asignado_a_id: '7' }), draft({ colaborador_ids: ['8'] }),
    draft({ estado: 'finalizada' }), draft({ cliente_id: 'invalid' }), draft({ etiquetas: [1] })]) {
    const f = fixture(); assert.equal(await f.model.start(value), false);
    assert.equal(f.calls.length, 0); assert.equal(f.model.snapshot.locked, false);
  }
  for (const randomUUID of [() => 'invalid', () => key + '\n', () => { throw Error('No secure UUID'); }]) {
    const f = fixture({ randomUUID }); assert.equal(await f.model.start(draft()), false);
    assert.equal(f.calls.length, 0); assert.equal(f.model.snapshot.phase, 'idle');
  }
});

test('synchronous double start has one UUID/scope/POST; frozen payload cannot follow later draft edits', async () => {
  const wait = deferred(), f = fixture({ send: () => wait.promise }), value = draft();
  const first = f.model.start(value);
  assert.equal(f.model.snapshot.busy, true); assert.equal(f.model.snapshot.phase, 'writing');
  assert.equal(await f.model.start(draft({ titulo: 'Second' })), false);
  assert.equal(await f.model.verify(), false); assert.equal(await f.model.retry(), false);
  value.titulo = 'Edited'; value.colaborador_ids.push(10); value.etiquetas = 'Changed';
  assert.equal(f.calls.length, 1); assert.equal(f.ids, 1); assert.equal(f.captures, 1);
  const held = f.calls[0].input;
  assert.equal(Object.isFrozen(held), true); assert.equal(Object.isFrozen(held.colaborador_ids), true);
  assert.equal(Object.isFrozen(held.etiquetas), true);
  assert.equal(held.titulo, 'Original'); assert.deepEqual(held.colaborador_ids, [8, 9]);
  assert.deepEqual(held.etiquetas, ['a', 'b']); assert.equal(f.calls[0].scope, f.scope);
  assert.throws(() => { held.titulo = 'Cannot mutate'; }, TypeError);
  wait.resolve(ack()); assert.equal(await first, true);
});

test('lost ACK permits explicit GET verification only and accepts CURRENT task content/revision', async () => {
  const f = fixture({ send: async (_input, options) => {
    if (options.method === 'POST') throw Error('Response lost after commit');
    return ack({ operation: { request_id: key, task_id: 21, replayed: true },
      task: { ...ack().task, titulo: 'Current title', revision: 6 } });
  } });
  assert.equal(await f.model.start(draft()), false);
  assert.equal(f.model.snapshot.phase, 'uncertain'); assert.equal(f.calls.length, 1);
  assert.equal(f.model.snapshot.canVerify, true); assert.equal(f.model.snapshot.canRetry, true);
  assert.equal(await f.model.verify(), true); assert.equal(f.model.snapshot.phase, 'confirmed');
  assert.equal(f.model.snapshot.accepted.task.id, 21); assert.equal(f.model.snapshot.accepted.task.revision, 6);
  assert.equal(f.model.snapshot.accepted.task.titulo, 'Current title');
  assert.deepEqual(f.calls.map(call => call.method), ['POST', 'GET']);
  assert.equal(f.calls[0].input, f.calls[1].input); assert.equal(f.calls[0].scope, f.calls[1].scope);
  assert.equal(f.ids, 1); assert.equal(f.captures, 1);
});

test('GET404 retains locked same UUID; manual retry sends byte-identical immutable intent, never a fresh draft', async () => {
  const f = fixture({ send: async (_input, _options, count) => {
    if (count === 1) throw Error('Lost');
    if (count === 2) throw Object.assign(Error('Not currently available'), { status: 404 });
    return ack({ operation: { request_id: key, task_id: 21, replayed: true } });
  } });
  const value = draft(); await f.model.start(value); const original = JSON.stringify(f.calls[0].input);
  assert.equal(await f.model.verify(), false);
  assert.equal(f.model.snapshot.phase, 'uncertain'); assert.equal(f.model.snapshot.locked, true);
  assert.equal(f.model.snapshot.requestId, key);
  value.titulo = 'Different draft'; assert.equal(await f.model.start(value), false);
  assert.equal(await f.model.retry(), true);
  assert.deepEqual(f.calls.map(call => call.method), ['POST', 'GET', 'POST']);
  assert.ok(f.calls.every(call => call.input === f.calls[0].input && call.scope === f.calls[0].scope));
  assert.ok(f.calls.every(call => JSON.stringify(call.input) === original));
  assert.equal(f.ids, 1); assert.equal(f.captures, 1);
});

test('initial400 permits corrected intent/new UUID, but400 on uncertain retry retains the old attempt', async () => {
  let serial = 0;
  const editable = fixture({ randomUUID: () => ++serial === 1 ? key : otherKey,
    send: async (input, _options, count) => {
      if (count === 1) throw Object.assign(Error('Invalid input'), { status: 400 });
      return ack({ operation: { request_id: input.request_id, task_id: 21, replayed: false } });
    } });
  assert.equal(await editable.model.start(draft()), false);
  assert.equal(editable.model.snapshot.phase, 'idle'); assert.equal(editable.model.snapshot.requestId, null);
  assert.equal(await editable.model.start(draft({ titulo: 'Corrected' })), true);
  assert.equal(editable.ids, 2); assert.equal(editable.calls[1].input.request_id, otherKey);
  const uncertain = fixture({ send: async (_input, _options, count) => {
    throw count === 1 ? Error('Lost') : Object.assign(Error('Later400'), { status: 400 });
  } });
  await uncertain.model.start(draft()); assert.equal(await uncertain.model.retry(), false);
  assert.equal(uncertain.model.snapshot.phase, 'uncertain'); assert.equal(uncertain.model.snapshot.locked, true);
  assert.equal(uncertain.model.snapshot.requestId, key); assert.equal(uncertain.ids, 1);
});

for (const [status, phase] of [[409, 'conflict'], [401, 'blocked'], [403, 'blocked']]) {
  test(`${status} locks the attempt as ${phase} without permitting another dispatch`, async () => {
    const f = fixture({ send: async () => { throw Object.assign(Error('Denied'), { status }); } });
    assert.equal(await f.model.start(draft()), false); assert.equal(f.model.snapshot.phase, phase);
    assert.equal(f.model.snapshot.locked, true); assert.equal(f.model.snapshot.busy, false);
    assert.equal(await f.model.verify(), false); assert.equal(await f.model.retry(), false);
    assert.equal(await f.model.start(draft()), false); assert.equal(f.calls.length, 1);
  });
}

test('invalid ACK version, UUID, ID or task DTO stays uncertain and never accepts success', async () => {
  const invalid = [null, {}, ack({ version: 2 }), ack({ operation: { request_id: otherKey, task_id: 21, replayed: false } }),
    ack({ operation: { request_id: key, task_id: 22, replayed: false } }),
    ack({ operation: { request_id: key, task_id: 21, replayed: 'false' } }),
    ...[{ revision: '1' }, { revision: 0 }, { titulo: null }, { propiedades_extra: { workspace: 'historical' } },
      { asignado_a_id: '7' }, { colaborador_ids: ['8'] }].map(patch => ack({ task: { ...ack().task, ...patch } }))];
  for (const response of invalid) {
    const f = fixture({ send: async () => response });
    assert.equal(await f.model.start(draft()), false);
    assert.equal(f.model.snapshot.phase, 'uncertain'); assert.equal(f.model.snapshot.accepted, null);
    assert.equal(f.model.snapshot.requestId, key); assert.equal(f.model.snapshot.locked, true);
  }
  assert.throws(() => parseTaskCreationAck(ack(), key, 22));
});

test('confirmed attempt cannot start, verify or retry again', async () => {
  const f = fixture(); assert.equal(await f.model.start(draft()), true);
  assert.equal(await f.model.start(draft()), false); assert.equal(await f.model.verify(), false);
  assert.equal(await f.model.retry(), false); assert.equal(f.calls.length, 1); assert.equal(f.ids, 1);
});

for (const boundary of ['scope', 'dispose']) for (const reject of [false, true]) {
  test(`late ${reject ? 'failure' : 'ACK'} after ${boundary} never publishes or accepts`, async () => {
    const wait = deferred(), f = fixture({ send: () => wait.promise });
    const pending = f.model.start(draft()), before = f.states.length;
    if (boundary === 'scope') f.retire(); else f.model.dispose();
    if (reject) wait.reject(Error('Late private failure')); else wait.resolve(ack());
    assert.equal(await pending, false); assert.equal(f.states.length, before);
    assert.equal(f.model.snapshot.accepted, null); assert.equal(f.model.snapshot.locked, true);
    assert.equal(await f.model.verify(), false); assert.equal(await f.model.retry(), false);
    assert.equal(await f.model.start(draft()), false); assert.equal(f.calls.length, 1);
  });
}

test('real captured cookie scope rejects identity ABA even with same account and credential strings', async () => {
  const store = createBrowserSessionState();
  const publish = id => store.acceptBootstrap(store.beginBootstrap(), { usuario: { id, usuario: `qa${id}`, nombre: 'Synthetic QA', rol: 'diseno' },
    session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) });
  publish(7); const session = store.getSession(), wait = deferred(), states = [], calls = [];
  let captures = 0;
  const model = createTaskCreationAttempt({ randomUUID: () => key,
    capture() { captures++; return createCapturedRequest({ session, readSession: store.getSession,
      request: async (_url, options) => { calls.push(options); return wait.promise; } }); },
    send: (input, { scope, method }) => scope.request('/api/tareas', { method, body: JSON.stringify(input) }),
    onState: value => states.push(value) });
  const pending = model.start(draft()), before = states.length;
  publish(8); publish(7); wait.resolve(ack());
  assert.equal(await pending, false); assert.equal(states.length, before);
  assert.equal(model.snapshot.accepted, null); assert.equal(await model.retry(), false);
  assert.equal(await model.verify(), false); assert.equal(captures, 1); assert.equal(calls.length, 1);
  assert.equal(new Headers(calls[0].headers).has('Authorization'), false);
});
