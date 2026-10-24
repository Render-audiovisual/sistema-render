import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskCommentCreation } from './taskCommentCreation.js';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';
import { createCapturedRequest } from '../shared/session/captured-request.js';

const key = '11111111-2222-4333-8444-555555555555', otherKey = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const input = extra => ({ taskId: 9, autor: 'Cached staff name', contenido: '  A  ', generation: 4, ...extra });
const comment = extra => ({ id: 21, tarea_id: 9, autor: 'Renamed DB staff', contenido: 'A', created_at: '2026-10-24T12:00:00.123Z', creation_request_id: key, ...extra });
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function fixture({ request, randomUUID = () => key, onState = () => {} } = {}) {
  const store = createBrowserSessionState(), calls = [], states = [];
  const accept = id => store.acceptBootstrap(store.beginBootstrap(), { usuario: { id, usuario: 'qa', nombre: 'QA', rol: 'diseno' }, session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) });
  accept(7); const session = store.getSession(); let active = true, captures = 0, ids = 0;
  const model = createTaskCommentCreation({ capture() { captures++; return createCapturedRequest({ session, readSession: store.getSession,
    isActive: () => active, request(url, options) { calls.push({ url, options }); return request ? request(url, options) : Promise.resolve(comment()); } }); },
  randomUUID() { ids++; return randomUUID(); }, onState(value) { states.push(value); onState(value); } });
  return { model, calls, states, store, get captures() { return captures; }, get ids() { return ids; },
    replace(id = 8) { accept(id); }, unmount() { active = false; } };
}

test('one immutable UUID/body/owner captured before POST; staff rename accepted and receipt projected closed', async () => {
  const wait = deferred(), f = fixture({ request: () => wait.promise }), value = input();
  const pending = f.model.start(value); Object.assign(value, input({ taskId: 10, autor: 'Other', contenido: 'B', generation: 99 }));
  assert.equal(f.model.snapshot.phase, 'writing'); assert.equal(f.model.snapshot.busy, true);
  assert.equal(f.captures, 1); assert.equal(f.ids, 1); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, '/api/tareas/9/comentarios?workspace=render_os');
  assert.deepEqual(JSON.parse(f.calls[0].options.body), { autor: 'Cached staff name', contenido: 'A', request_id: key });
  assert.ok(f.calls[0].options.sessionIntent); assert.equal(f.calls[0].options.headers.Authorization, undefined);
  wait.resolve(comment({ private_finance: 'not projected' })); assert.equal(await pending, true);
  assert.deepEqual(f.model.snapshot.comment, comment()); assert.equal(Object.isFrozen(f.model.snapshot.comment), true);
  assert.equal(f.model.snapshot.attempt.generation, 4); assert.equal(Object.isFrozen(f.model.snapshot.attempt), true);
  assert.equal(f.model.snapshot.phase, 'confirmed'); assert.equal(f.model.snapshot.locked, false);
});

test('double click/admission during POST or GET never dispatches a concurrent operation', async () => {
  const writes = deferred(), reads = deferred(), f = fixture({ request: (_url, options) => options.method === 'POST' ? writes.promise : reads.promise });
  const first = f.model.start(input()); assert.equal(await f.model.start(input({ contenido: 'B' })), false);
  assert.equal(await f.model.verify(), false); writes.reject(new Error('ACK lost')); assert.equal(await first, false);
  const check = f.model.verify(); assert.equal(await f.model.verify(), false); assert.equal(await f.model.start(input()), false);
  reads.resolve(comment()); assert.equal(await check, true); assert.equal(f.calls.length, 2); assert.equal(f.ids, 1);
});

for (const failure of [new Error('Offline'), Object.assign(new Error('Unauthorized'), { status: 401 }),
  Object.assign(new Error('Denied'), { status: 403 }), Object.assign(new Error('Conflict'), { status: 409 })]) {
  test(`POST failure retains original draft/UUID and distinguishes unavailable authority (status=${failure.status ?? 'network'})`, async () => {
    const f = fixture({ request: () => Promise.reject(failure) });
    const unavailable = [401, 403, 409].includes(failure.status);
    assert.equal(await f.model.start(input()), false); assert.equal(f.model.snapshot.phase, unavailable ? 'unavailable' : 'uncertain');
    assert.equal(f.model.snapshot.attempt.contenido, 'A'); assert.equal(f.model.snapshot.attempt.generation, 4);
    assert.equal(f.model.snapshot.locked, true); assert.equal(f.model.snapshot.canVerify, !unavailable); assert.equal(f.model.snapshot.busy, false);
    assert.equal(await f.model.start(input({ contenido: 'B' })), false); assert.equal(f.calls.length, 1);
    if (unavailable) {
      assert.match(f.model.snapshot.error, /no está disponible o no tenés acceso/);
      assert.equal(await f.model.verify(), false); assert.equal(f.calls.length, 1);
    }
  });
}

test('lost ACK recovery is only explicit GET with same UUID/task and no auto-rePOST, including repeated 404', async () => {
  let stage = 0;
  const f = fixture({ request(_url, options) {
    if (options.method === 'POST') return Promise.reject(new Error('ACK lost'));
    return ++stage < 3 ? Promise.reject(Object.assign(new Error('Not found'), { status: 404 })) : Promise.resolve(comment());
  } });
  await f.model.start(input()); assert.equal(f.calls.length, 1);
  for (let i = 0; i < 2; i++) { assert.equal(await f.model.verify(), false); assert.equal(f.model.snapshot.phase, 'uncertain'); }
  assert.equal(await f.model.verify(), true);
  assert.deepEqual(f.calls.map(c => c.options.method), ['POST', 'GET', 'GET', 'GET']);
  for (const call of f.calls.slice(1)) {
    assert.equal(call.url, `/api/tareas/9/comentarios/solicitudes/${key}?workspace=render_os`);
    assert.equal(call.options.cache, 'no-store'); assert.equal(call.options.body, undefined);
  }
  assert.equal(f.captures, 1); assert.equal(f.ids, 1);
});

for (const value of [null, [], {}, comment({ creation_request_id: otherKey }), comment({ tarea_id: 10 }), comment({ contenido: 'B' }),
  comment({ id: '21' }), comment({ id: 0 }), comment({ id: 2147483648 }), comment({ created_at: 'invalid' }), comment({ autor: 7 })]) {
  test(`malformed/mismatched ACK remains uncertain (${JSON.stringify(value)})`, async () => {
    const f = fixture({ request: async () => value });
    assert.equal(await f.model.start(input()), false); assert.equal(f.model.snapshot.phase, 'uncertain');
    assert.equal(f.model.snapshot.comment, null); assert.equal(f.calls.length, 1);
    assert.equal(await f.model.verify(), false); assert.deepEqual(f.calls.map(c => c.options.method), ['POST', 'GET']);
  });
}

test('admin opt-in validates held author, staff mode never requires old cached author match', async () => {
  const admin = fixture(); assert.equal(await admin.model.start(input({ validateAuthor: true })), false);
  assert.equal(admin.model.snapshot.phase, 'uncertain');
  const exact = fixture({ request: async () => comment({ autor: 'Admin' }) });
  assert.equal(await exact.model.start(input({ autor: ' Admin ', validateAuthor: true })), true);
  const staff = fixture(); assert.equal(await staff.model.start(input({ autor: undefined })), true);
});

test('typing B and A/B/A cannot mutate the held text or generation; only later explicit start creates another UUID', async () => {
  let id = 0; const wait = deferred(), f = fixture({ randomUUID: () => ++id === 1 ? key : otherKey, request: () => wait.promise });
  const value = input(), pending = f.model.start(value);
  value.contenido = 'B'; value.generation++; value.contenido = 'A'; value.generation++;
  assert.equal(f.model.snapshot.attempt.generation, 4); assert.equal(f.model.snapshot.attempt.contenido, 'A');
  wait.resolve(comment()); await pending;
  assert.equal(f.calls.length, 1); assert.equal(f.ids, 1);
  await f.model.start(input({ generation: 6 })); // Same text is a different deliberate action, never dedup by text.
  assert.equal(f.ids, 2); assert.equal(f.calls.length, 2);
  assert.equal(JSON.parse(f.calls[1].options.body).request_id, otherKey);
});

for (const transition of ['session', 'session ABA', 'unmount', 'dispose']) {
  test(`${transition} fences late results and never emits another owner's private state`, async () => {
    const wait = deferred(), f = fixture({ request: () => wait.promise });
    const pending = f.model.start(input()), count = f.states.length;
    if (transition === 'session') f.replace(); else if (transition === 'session ABA') { f.replace(); f.replace(7); }
    else if (transition === 'unmount') f.unmount(); else f.model.dispose();
    wait.resolve(comment()); assert.equal(await pending, false); assert.equal(f.states.length, count);
    assert.equal(f.model.snapshot.phase, 'blocked'); assert.equal(f.model.snapshot.comment, null); assert.equal(f.model.snapshot.attempt, null);
    assert.equal(await f.model.verify(), false); assert.equal(f.calls.length, 1);
  });
}

test('explicit discard does not cancel/revoke server work; old completion cannot unlock a fresh request', async () => {
  const old = deferred(), fresh = deferred(); let n = 0;
  const f = fixture({ randomUUID: () => n++ ? otherKey : key, request: (_url, options) => JSON.parse(options.body).request_id === key ? old.promise : fresh.promise });
  const first = f.model.start(input()); f.model.discard(); assert.equal(f.model.snapshot.phase, 'idle');
  const second = f.model.start(input({ contenido: 'B', generation: 5 })), count = f.states.length;
  old.resolve(comment()); assert.equal(await first, false); assert.equal(f.model.snapshot.busy, true); assert.equal(f.states.length, count);
  fresh.resolve(comment({ id: 22, contenido: 'B', creation_request_id: otherKey })); assert.equal(await second, true);
  assert.equal(f.model.snapshot.comment.id, 22); assert.equal(f.model.snapshot.busy, false);
});

for (const randomUUID of [() => undefined, () => 'unsafe', () => '11111111-2222-1333-8444-555555555555', () => { throw new Error('Unavailable'); }]) {
  test('UUID failure is closed with no transport, no fallback and no invented recovery receipt', async () => {
    const f = fixture({ randomUUID }); assert.equal(await f.model.start(input()), false);
    assert.equal(f.calls.length, 0); assert.equal(f.model.snapshot.attempt, null); assert.equal(f.model.snapshot.canVerify, false);
  });
}

test('observer discard before dispatch and thrown observers cannot accidentally send/retry or corrupt ownership', async () => {
  let f;
  f = fixture({ onState: state => { if (state.phase === 'writing') f.model.discard(); } });
  assert.equal(await f.model.start(input()), false); assert.equal(f.calls.length, 0);
  const safe = fixture({ onState() { throw new Error('Observer failed'); } });
  assert.equal(await safe.model.start(input()), true); assert.equal(safe.calls.length, 1);
});

test('malformed input never dispatches; snapshot/attempt/comment are immutable projections, not mutable transport state', async () => {
  const f = fixture();
  for (const patch of [{ taskId: '9' }, { taskId: 2147483648 }, { contenido: '' }, { contenido: 'A\u0000' }, { contenido: 42 },
    { generation: -1 }, { generation: NaN }, { validateAuthor: 'true' }, { autor: '', validateAuthor: true }]) {
    assert.equal(await f.model.start(input(patch)), false);
  }
  assert.equal(f.calls.length, 0); assert.equal(Object.isFrozen(f.model.snapshot), true);
});

test('observer discard during confirmation suppresses a stale success return without touching server work', async () => {
  let f;
  f = fixture({ onState: state => { if (state.phase === 'confirmed') f.model.discard(); } });
  assert.equal(await f.model.start(input()), false);
  assert.equal(f.model.snapshot.phase, 'idle'); assert.equal(f.model.snapshot.comment, null);
  assert.equal(f.calls.length, 1);
});

test('mutable guard/request dependencies are captured before asynchronous dispatch, not reread during verify', async () => {
  const calls = [], wait = deferred();
  const guard = { current: () => true, request(url, options) { calls.push({ url, options }); return options.method === 'POST' ? wait.promise : Promise.resolve(comment()); } };
  const model = createTaskCommentCreation({ capture: () => guard, randomUUID: () => key });
  const sent = model.start(input());
  guard.request = () => assert.fail('Must use the captured request method');
  wait.reject(new Error('Lost ACK')); await sent;
  assert.equal(await model.verify(), true); assert.equal(calls.length, 2);
});

test('a guard already stale before admission never generates a UUID or sends', async () => {
  let ids = 0;
  const model = createTaskCommentCreation({ capture: () => ({ current: () => false, request() { assert.fail('Stale dispatch'); } }),
    randomUUID() { ids++; return key; } });
  assert.equal(await model.start(input()), false); assert.equal(ids, 0);
  assert.equal(model.snapshot.phase, 'blocked'); assert.equal(model.snapshot.attempt, null);
});

for (const status of [401, 403, 409]) {
  test(`recovery ${status} retains a locked unavailable attempt without offering another GET or new POST`, async () => {
    const f = fixture({ request: (_url, options) => Promise.reject(options.method === 'POST'
      ? new Error('ACK lost') : Object.assign(new Error('Unavailable'), { status })) });
    await f.model.start(input()); const held = f.model.snapshot.attempt;
    assert.equal(f.model.snapshot.canVerify, true);
    assert.equal(await f.model.verify(), false);
    assert.equal(f.model.snapshot.phase, 'unavailable'); assert.equal(f.model.snapshot.locked, true);
    assert.equal(f.model.snapshot.attempt, held); assert.equal(f.model.snapshot.canVerify, false);
    assert.equal(f.model.snapshot.busy, false); assert.match(f.model.snapshot.error, /No se reenviará automáticamente/);
    assert.equal(await f.model.verify(), false); assert.equal(await f.model.start(input({ contenido: 'B' })), false);
    assert.deepEqual(f.calls.map(c => c.options.method), ['POST', 'GET']);
  });
}

for (const method of ['POST', 'GET']) {
  for (const action of ['discard', 'session', 'new attempt']) {
    test(`${method} confirmation observer ${action} fences old return after publication and preserves new ownership`, async () => {
      let f, next, id = 0;
      const fresh = deferred();
      f = fixture({ randomUUID: () => ++id === 1 ? key : otherKey,
        request: (_url, options) => {
          if (options.method === 'POST' && JSON.parse(options.body).request_id === otherKey) return fresh.promise;
          if (method === 'GET' && options.method === 'POST') return Promise.reject(new Error('ACK lost'));
          return Promise.resolve(comment());
        },
        onState: state => {
          if (state.phase !== 'confirmed' || state.comment?.id !== 21) return;
          if (action === 'discard') f.model.discard();
          else if (action === 'session') f.replace();
          else next = f.model.start(input({ contenido: 'B', generation: 5 }));
        } });
      let result = await f.model.start(input());
      if (method === 'GET') { assert.equal(result, false); result = await f.model.verify(); }
      assert.equal(result, false, 'Observer superseded the exact accepted result before send returned');
      if (action === 'discard') {
        assert.equal(f.model.snapshot.phase, 'idle'); assert.equal(f.model.snapshot.comment, null);
      } else if (action === 'session') {
        assert.equal(f.model.snapshot.phase, 'blocked'); assert.equal(f.model.snapshot.comment, null);
      } else {
        assert.ok(next); assert.equal(f.model.snapshot.phase, 'writing'); assert.equal(f.model.snapshot.busy, true);
        assert.equal(f.model.snapshot.attempt.requestId, otherKey); assert.equal(f.model.snapshot.comment, null);
        fresh.resolve(comment({ id: 22, contenido: 'B', creation_request_id: otherKey }));
        assert.equal(await next, true); assert.equal(f.model.snapshot.comment.id, 22);
      }
    });
  }
}
