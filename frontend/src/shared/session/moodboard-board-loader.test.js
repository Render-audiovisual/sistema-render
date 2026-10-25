import test from 'node:test';
import assert from 'node:assert/strict';
import { createMoodboardBoardLoader } from './moodboard-board-loader.js';
import { createCapturedRequest } from './captured-request.js';
import { createBrowserSessionState } from './browser-session-state.js';

// Pure actual-loader tests. Deferred transports deliberately ignore abort;
// cancellation must be enforced by observation/generation, not fetch behavior.
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const collection = label => [[{ id: `${label}-reference` }], [{ id: `${label}-category` }], [{ id: `${label}-task` }]];
const expected = values => ({ references: values[0], categories: values[1], tasks: values[2] });

test('contextual task beyond the first page is verified separately without expanding the legacy task catalog', async () => {
  const calls=[], item={id:152,titulo:'Task152'};
  const loader=createMoodboardBoardLoader({request:async(url,options)=>{
    calls.push({url,options});return url.endsWith('/tasks/152')?{version:1,item}:[];
  }});
  assert.deepEqual(await loader.load(7,152),{references:[],categories:[],tasks:[],contextTask:item});
  assert.equal(calls.length,4);assert.equal(calls[3].url,'/api/moodboards/boards/7/tasks/152');
  assert.ok(calls.every(call=>call.options.signal===calls[0].options.signal));
});
test('wrong or malformed contextual task fails closed; explicit context is never silently dropped', async () => {
  for(const context of [null,{version:1,item:{id:151,titulo:'Other'}},{version:2,item:{id:152,titulo:'Wrong version'}},{version:1,item:{id:152}}]){
    const loader=createMoodboardBoardLoader({request:async url=>url.endsWith('/tasks/152')?context:[]});
    await assert.rejects(loader.load(7,152),/No se pudo verificar la tarea/);
  }
  const loader=createMoodboardBoardLoader({request:async url=>{if(url.endsWith('/tasks/152'))throw Object.assign(new Error('Unavailable'),{status:404});return[];}});
  await assert.rejects(loader.load(7,152),{status:404});
});
test('canceled contextual response cannot paint after board replacement even if transport ignores abort', async () => {
  let resolve;
  const loader=createMoodboardBoardLoader({request:async url=>url.endsWith('/tasks/152')?new Promise(yes=>{resolve=yes;}):[]});
  const old=loader.load(7,152);await loader.load(8);
  resolve({version:1,item:{id:152,titulo:'Old private context'}});assert.equal(await old,null);
});
function fixture({ defaultCurrent = false } = {}) {
  const calls = []; let active = true;
  const request = (url, options) => { const item = deferred(); calls.push({ url, options, ...item }); return item.promise; };
  const loader = createMoodboardBoardLoader({ request, ...(defaultCurrent ? {} : { isCurrent: () => active }) });
  const complete = (offset, values = collection(String(offset))) => {
    values.forEach((value, index) => calls[offset + index].resolve(value)); return expected(values);
  };
  return { loader, calls, complete, inactive: () => { active = false; } };
}

test('one coherent board read uses exact three GET collection URLs and a shared fresh AbortSignal', async () => {
  const f = fixture({ defaultCurrent: true }); assert.equal(f.calls.length, 0);
  const pending = f.loader.load(7), values = collection('seven');
  assert.deepEqual(f.calls.map(call => call.url), ['references', 'categories', 'tasks'].map(resource => `/api/moodboards/boards/7/${resource}`));
  const signal = f.calls[0].options.signal;
  assert.ok(signal instanceof AbortSignal); assert.equal(signal.aborted, false);
  for (const call of f.calls) { assert.equal(call.options.signal, signal); assert.deepEqual(Object.keys(call.options), ['signal']); }
  f.complete(0, values); assert.deepEqual(await pending, expected(values));
  const next = f.loader.load(Number.MAX_SAFE_INTEGER);
  assert.notEqual(f.calls[3].options.signal, signal);
  assert.equal(f.calls[3].url, `/api/moodboards/boards/${Number.MAX_SAFE_INTEGER}/references`);
  f.complete(3); await next;
});

test('partial success never publishes a mixed snapshot while the other collections remain pending', async () => {
  const f = fixture(), pending = f.loader.load(7); let finished = false;
  void pending.then(() => { finished = true; });
  f.calls[2].resolve([]); f.calls[0].resolve([{ id: 'reference' }]); await settle();
  assert.equal(finished, false);
  f.calls[1].resolve([{ id: 'category' }]);
  assert.deepEqual(await pending, { references: [{ id: 'reference' }], categories: [{ id: 'category' }], tasks: [] });
});

test('new board cancels previous reads and late old completion returns null even when transport ignores abort', async () => {
  const f = fixture(), old = f.loader.load(1), current = f.loader.load(2);
  assert.equal(f.calls[0].options.signal.aborted, true); assert.equal(f.calls[3].options.signal.aborted, false);
  const values = collection('two'); f.complete(3, values); assert.deepEqual(await current, expected(values));
  f.complete(0, collection('one')); assert.equal(await old, null);
});

test('A-B-A board selection cannot revive either earlier observation of the same resource', async () => {
  const f = fixture(), firstA = f.loader.load(1), b = f.loader.load(2), secondA = f.loader.load(1);
  assert.equal(f.calls.length, 9);
  assert.equal(f.calls[0].options.signal.aborted, true); assert.equal(f.calls[3].options.signal.aborted, true);
  f.complete(0, collection('old-A')); f.complete(3, collection('B'));
  assert.equal(await firstA, null); assert.equal(await b, null);
  const values = collection('new-A'); f.complete(6, values); assert.deepEqual(await secondA, expected(values));
});

for (const outcome of ['success', 'error']) test(`obsolete ${outcome} finally cannot clear current board controller`, async () => {
  const f = fixture(), old = f.loader.load(1), current = f.loader.load(2);
  if (outcome === 'error') f.calls[0].reject(new Error('Obsolete private failure'));
  else f.complete(0);
  assert.equal(await old, null);
  f.loader.cancel(); assert.equal(f.calls[3].options.signal.aborted, true, 'Current controller must survive old finally');
  f.complete(3); assert.equal(await current, null);
  if (outcome === 'error') { f.calls[1].resolve([]); f.calls[2].resolve([]); }
});

test('cancel is idempotent, aborts all current siblings and permits a distinct later load', async () => {
  const f = fixture(), old = f.loader.load(1);
  f.loader.cancel(); f.loader.cancel();
  assert.ok(f.calls.every(call => call.options.signal.aborted));
  f.complete(0); assert.equal(await old, null);
  const next = f.loader.load(2); f.complete(3); assert.notEqual(await next, null);
});

for (const failure of ['success', 'error', 'malformed']) test(`inactive/unmounted owner suppresses late ${failure} and sends no new requests`, async () => {
  const f = fixture(), pending = f.loader.load(1); f.inactive();
  if (failure === 'error') f.calls[0].reject(new Error('Private late account A error'));
  else f.complete(0, failure === 'malformed' ? [null, {}, 'private invalid data'] : collection('late'));
  assert.equal(await pending, null);
  assert.equal(await f.loader.load(2), null); assert.equal(f.calls.length, 3);
  if (failure === 'error') { f.calls[1].resolve([]); f.calls[2].resolve([]); }
});

test('inactive or throwing current predicate fails closed before any collection request', async () => {
  for (const isCurrent of [() => false, () => { throw new Error('Unmounted owner'); }]) {
    const loader = createMoodboardBoardLoader({ request: () => assert.fail('Must not dispatch'), isCurrent });
    assert.equal(await loader.load(1), null);
  }
});

test('invalid IDs fail before dispatch and also invalidate any previous in-flight resource', async () => {
  for (const id of [undefined, null, 0, -1, 1.5, NaN, Infinity, '1', {}, [], Number.MAX_SAFE_INTEGER + 1]) {
    const f = fixture(); await assert.rejects(f.loader.load(id), { message: 'El moodboard no es válido.' });
    assert.equal(f.calls.length, 0);
  }
  const f = fixture(), old = f.loader.load(1);
  await assert.rejects(f.loader.load('2'), { message: 'El moodboard no es válido.' });
  assert.equal(f.calls[0].options.signal.aborted, true); f.complete(0); assert.equal(await old, null);
});

for (const index of [0, 1, 2]) test(`collection ${index} must be an array; malformed data has closed generic error and aborts siblings`, async () => {
  for (const invalid of [null, {}, 'PRIVATE_MOODBOARD_COLLECTION', 17]) {
    const f = fixture(), pending = f.loader.load(1), values = collection('valid'); values[index] = invalid;
    const rejected = assert.rejects(pending, error => {
      assert.equal(error.message, 'No se pudieron verificar los datos del moodboard. Volvé a cargar.');
      assert.deepEqual(Object.keys(error), []); assert.equal(error.message.includes('PRIVATE_MOODBOARD_COLLECTION'), false); return true;
    });
    f.complete(0, values); await rejected;
    assert.ok(f.calls.every(call => call.options.signal.aborted));
  }
});

test('current request errors propagate unchanged, abort siblings and do not poison a later successful load', async () => {
  const f = fixture(), failure = Object.assign(new Error('Synthetic transport failure'), { status: 503, code: 'TEMPORARILY_UNAVAILABLE' });
  const pending = f.loader.load(1), rejected = assert.rejects(pending, error => error === failure);
  f.calls[1].reject(failure); await rejected;
  assert.ok(f.calls.every(call => call.options.signal.aborted));
  const next = f.loader.load(2), values = collection('recovered');
  f.calls[0].reject(new Error('Late sibling failure')); f.calls[2].resolve([]);
  f.complete(3, values); assert.deepEqual(await next, expected(values));
});

test('cancelled rejection including AbortError is suppressed while a current AbortError remains a real request failure', async () => {
  const f = fixture(), pending = f.loader.load(1); f.loader.cancel();
  f.calls[0].reject(new DOMException('Synthetic abort', 'AbortError')); assert.equal(await pending, null);
  f.calls[1].resolve([]); f.calls[2].resolve([]);
  const current = f.loader.load(2), error = new DOMException('Current transport abort', 'AbortError');
  const rejected = assert.rejects(current, value => value === error); f.calls[3].reject(error); await rejected;
  f.calls[4].resolve([]); f.calls[5].resolve([]);
});

test('synchronous current transport failure is propagated, not converted to an empty successful board', async () => {
  const error = new Error('Synthetic synchronous request failure');
  const loader = createMoodboardBoardLoader({ request: () => { throw error; } });
  await assert.rejects(loader.load(1), value => value === error);
});

for (const replacement of ['B', 'A-B-A', 'unmount']) test(`actual captured cookie scope: ${replacement} fences collections, errors and later dispatch`, async () => {
  const store = createBrowserSessionState(), calls = []; let mounted = true;
  const publish = id => {
    const ticket = store.beginBootstrap();
    assert.equal(store.acceptBootstrap(ticket, { usuario: { id, nombre: 'Synthetic owner', usuario: `qa${id}`, rol: 'diseno' },
      session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) }), true);
  };
  publish(7); const session = store.getSession();
  const scope = createCapturedRequest({ session, readSession: store.getSession, isActive: () => mounted,
    request: (url, options) => { const item = deferred(); calls.push({ url, options, ...item }); return item.promise; } });
  const loader = createMoodboardBoardLoader({ request: scope.request, isCurrent: scope.current });
  const pending = loader.load(4); assert.equal(calls.length, 3);
  const intent = calls[0].options.sessionIntent; assert.equal(store.isCurrent(intent), true);
  for (const call of calls) {
    assert.equal(call.options.sessionIntent, intent); assert.ok(call.options.signal instanceof AbortSignal);
    const headers = new Headers(call.options.headers);
    assert.equal(headers.has('Authorization'), false); assert.equal(headers.get('X-Render-Session-Context'), session.session_context);
  }
  if (replacement === 'unmount') { mounted = false; loader.cancel(); }
  else { publish(8); if (replacement === 'A-B-A') publish(7); }
  calls[0].resolve([{ id: 'private-A-reference' }]); calls[1].reject(new Error('Private-A transport error')); calls[2].resolve([]);
  assert.equal(await pending, null); assert.equal(scope.current(), false);
  assert.equal(await loader.load(4), null); assert.equal(calls.length, 3, 'Never recapture or dispatch under replacement session');
});
