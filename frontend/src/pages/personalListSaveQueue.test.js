import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonalListSaveQueue } from './personalListSaveQueue.js';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';

const session = () => ({ token: 'synthetic-token', usuario: { id: 17, rol: 'edicion', activo: true } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 16; i += 1) await Promise.resolve(); };
function timers() {
  let now = 0, serial = 0;
  const tasks = new Map();
  return { setTimer(fn, delay) { const id = ++serial; tasks.set(id, { fn, at: now + delay }); return id; },
    clearTimer(id) { tasks.delete(id); }, size: () => tasks.size,
    async tick(ms) {
      const end = now + ms;
      while (true) {
        const first = [...tasks].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!first) break;
        now = first[1].at; tasks.delete(first[0]); first[1].fn(); await settle();
      }
      now = end; await settle();
    } };
}
function setup(options = {}) {
  const clock = timers(), calls = [], states = [], saved = [], denied = [];
  let live = session();
  const queue = createPersonalListSaveQueue({ session: live, readSession: () => live,
    request(url, settings) { const d = deferred(); calls.push({ url, ...settings, ...d }); return d.promise; },
    onState: state => states.push(state), onSaved: value => saved.push(value), onDenied: () => denied.push(true),
    ...clock, ...options });
  return { queue, clock, calls, states, saved, denied, changeSession: value => { live = value; } };
}
const record = (extra = {}) => ({ key: 'block:31', url: '/api/listas-personales/bloques/31', version: 4,
  payload: { tipo: 'texto', contenido: { texto: 'first' } }, meta: { listId: 9, blockId: 31, recordId: 31 }, ...extra });
const success = async (call, version = 5, extra = {}) => { call.resolve({ id: 31, version, ...extra }); await settle(); };
const failure = async (call, status, message = 'Synthetic save failure') => { call.reject(Object.assign(new Error(message), { status })); await settle(); };

function cookieSetup() {
  const store = createBrowserSessionState(), clock = timers(), calls = [], saved = [], denied = [];
  const accept = (id = 17, context = 'a', csrf = 'b') => {
    const ticket = store.beginBootstrap();
    store.acceptBootstrap(ticket, { usuario: { id, usuario: `synthetic-${id}`, nombre: 'Synthetic user', rol: 'edicion', activo: true },
      session_context: context.repeat(43), csrf_token: csrf.repeat(43) });
    return store.getSession();
  };
  const initial = accept();
  const queue = createPersonalListSaveQueue({ session: initial, readSession: () => store.getSession(), ...clock,
    request(url, settings) { const d = deferred(); calls.push({ url, ...settings, ...d }); return d.promise; },
    onSaved: value => saved.push(value), onDenied: () => denied.push(true) });
  return { store, clock, calls, saved, denied, queue, accept };
}

test('registered cookie identity saves BIGSERIAL IDs and retries with the same genuine intent, headers and CAS body', async () => {
  const h = cookieSetup(), item = record({ meta: { listId: '9', blockId: '31', recordId: '31' } });
  assert.equal(h.queue.schedule(item), true); await h.clock.tick(650);
  assert.equal(h.calls.length, 1);
  const first = h.calls[0], headers = new Headers(first.headers);
  assert.equal(headers.has('Authorization'), false);
  assert.equal(headers.get('X-Render-Session-Context'), 'a'.repeat(43));
  assert.equal(headers.get('X-Render-CSRF'), 'b'.repeat(43));
  assert.equal(h.store.isCurrent(first.sessionIntent), true);
  await failure(first, undefined);
  h.queue.schedule({ ...item, payload: { contenido: { texto: 'later cookie draft' } } });
  const retry = h.queue.retry(); await settle();
  assert.equal(h.calls[1].sessionIntent, first.sessionIntent);
  assert.deepEqual([...new Headers(h.calls[1].headers)], [...headers]);
  assert.equal(h.calls[1].body, first.body);
  h.calls[1].resolve({ id: '31', version: 5 }); await settle();
  assert.equal(h.saved[0].hasNewer, true);
  assert.deepEqual(JSON.parse(h.calls[2].body), { contenido: { texto: 'later cookie draft' }, expected_version: 5 });
  assert.equal(h.calls[2].sessionIntent, first.sessionIntent);
  h.calls[2].resolve({ id: '31', version: 6 }); assert.equal(await retry, true);
  assert.equal(h.queue.snapshot().dirty, false); h.queue.dispose();
});

test('cookie B replaces A during a flight: no old ACK publication, retry or B draft transmission', async () => {
  const h = cookieSetup(); h.queue.schedule(record()); const pending = h.queue.flush(); await settle();
  h.accept(18, 'c', 'd');
  await success(h.calls[0]);
  assert.equal(await pending, false); assert.equal(h.saved.length, 0);
  assert.equal(h.denied.length, 1); assert.equal(h.queue.snapshot().pending, 0);
  assert.equal(h.queue.schedule(record({ payload: { contenido: { texto: 'must not send as B' } } })), false);
  assert.equal(await h.queue.retry(), false); await h.clock.tick(20000);
  assert.equal(h.calls.length, 1); assert.equal(h.denied.length, 1); h.queue.dispose();
});

test('same cookie user with a new registered observation cannot rebase a pending A debounce', async () => {
  const h = cookieSetup(); h.queue.schedule(record()); h.accept(17, 'c', 'd');
  await h.clock.tick(650);
  assert.equal(h.calls.length, 0); assert.equal(h.denied.length, 1);
  assert.equal(h.queue.snapshot().pending, 0); h.queue.dispose();
});

test('unregistered cookie-shaped data is not session authority', () => {
  const fake = { usuario: { id: 17, rol: 'edicion', activo: true }, session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) };
  const h = setup({ session: fake, readSession: () => fake });
  assert.equal(h.queue.schedule(record()), false); assert.equal(h.calls.length, 0); h.queue.dispose();
});

test('schedule marks dirty immediately; debounce coalesces and sends immutable payload with explicit captured auth/CAS', async () => {
  const h = setup(), desired = record();
  assert.equal(h.queue.schedule(desired), true);
  assert.deepEqual(h.queue.snapshot(), { status: 'pending', dirty: true, busy: false, error: '', conflict: false, pending: 1 });
  desired.payload.contenido.texto = 'mutated outside'; desired.meta.recordId = 99;
  await h.clock.tick(649); assert.equal(h.calls.length, 0);
  await h.clock.tick(1); assert.equal(h.calls.length, 1);
  const call = h.calls[0]; assert.equal(call.method, 'PATCH');
  assert.deepEqual(call.headers, { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-token' });
  assert.deepEqual(JSON.parse(call.body), { tipo: 'texto', contenido: { texto: 'first' }, expected_version: 4 });
  assert.equal(h.queue.snapshot().status, 'saving'); assert.equal(h.queue.snapshot().busy, true);
  await success(call);
  assert.deepEqual(h.saved, [{ key: 'block:31', meta: { listId: 9, blockId: 31, recordId: 31 }, row: { id: 31, version: 5 }, hasNewer: false }]);
  assert.deepEqual(h.queue.snapshot(), { status: 'saved', dirty: false, busy: false, error: '', conflict: false, pending: 0 });
});

test('one flight per key; newer content survives old ACK and next write uses ACK not stale render version', async () => {
  const h = setup(); h.queue.schedule(record()); await h.clock.tick(650);
  h.queue.schedule(record({ version: 1, payload: { contenido: { texto: 'newer' } } }));
  await h.clock.tick(650); assert.equal(h.calls.length, 1);
  await success(h.calls[0], 8); assert.equal(h.saved[0].hasNewer, true);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(JSON.parse(h.calls[1].body), { contenido: { texto: 'newer' }, expected_version: 8 });
  await success(h.calls[1], 9); assert.equal(h.saved[1].hasNewer, false); assert.equal(h.queue.snapshot().dirty, false);
});

test('last ACK remains canonical after clean state and observer mutation cannot alter queue identity', async () => {
  const h = setup({ onSaved(value) { value.row.version = 800; value.meta.recordId = 999; } });
  h.queue.schedule(record()); const first = h.queue.flush(); await settle(); await success(h.calls[0], 7);
  assert.equal(await first, true);
  h.queue.schedule(record({ version: 4, payload: { contenido: { texto: 'later edit' } } }));
  const next = h.queue.flush(); await settle();
  assert.equal(JSON.parse(h.calls[1].body).expected_version, 7);
  await success(h.calls[1], 8); assert.equal(await next, true);
  assert.equal(h.queue.schedule(record({ meta: { listId: 9, blockId: 32, recordId: 32 } })), false);
});

test('concurrent flush callers share the same per-record flight, without lost desired changes', async () => {
  const h = setup(); h.queue.schedule(record());
  const a = h.queue.flush(), b = h.queue.flush(); await settle(); assert.equal(h.calls.length, 1);
  h.queue.schedule(record({ payload: { contenido: { texto: 'latest' } } }));
  await success(h.calls[0]); assert.equal(h.calls.length, 2);
  await success(h.calls[1], 6); assert.deepEqual(await Promise.all([a, b]), [true, true]);
});

test('explicit denial aborts other records already in flight and ignores their late responses', async () => {
  const h = setup(); h.queue.schedule(record());
  h.queue.schedule(record({ key: 'list:9', url: '/api/listas-personales/9', meta: { listId: 9, recordId: 9 } }));
  const all = h.queue.flush(); await settle(); assert.equal(h.calls.length, 2);
  await failure(h.calls[0], 401); assert.equal(h.calls[1].signal.aborted, true); assert.equal(await all, false);
  h.calls[1].resolve({ id: 9, version: 5 }); await settle();
  assert.equal(h.saved.length, 0); assert.equal(h.denied.length, 1); assert.equal(h.queue.snapshot().pending, 0);
});

test('metadata changes during a flight coalesce without consuming server row fields as desired payload', async () => {
  const h = setup(), meta = { listId: 9, recordId: 9 };
  h.queue.schedule(record({ key: 'list:9', url: '/api/listas-personales/9', meta, merge: true, payload: { titulo: 'title' } }));
  await h.clock.tick(650);
  h.queue.schedule(record({ key: 'list:9', url: '/api/listas-personales/9', meta, merge: true, payload: { emoji: '📝' } }));
  await h.clock.tick(650);
  h.calls[0].resolve({ id: 9, version: 5, titulo: 'server title', private_unused_field: 'never resend' }); await settle();
  assert.deepEqual(JSON.parse(h.calls[1].body), { emoji: '📝', expected_version: 5 });
  h.calls[1].resolve({ id: 9, version: 6 }); await settle(); assert.equal(h.queue.snapshot().dirty, false);
});

test('metadata merge combines only desired fields, content replace drops obsolete fields, multiple keys remain independent', async () => {
  const h = setup();
  const meta = { listId: 9, recordId: 9 };
  h.queue.schedule(record({ key: 'list:9', url: '/api/listas-personales/9', meta, merge: true, payload: { titulo: 'A' } }));
  h.queue.schedule(record({ key: 'list:9', url: '/api/listas-personales/9', meta, merge: true, payload: { emoji: '📝' } }));
  h.queue.schedule(record({ payload: { contenido: { texto: 'discard me' }, obsolete: true } }));
  h.queue.schedule(record({ payload: { contenido: { texto: 'replacement' } } }));
  const flushed = h.queue.flush(); await settle(); assert.equal(h.calls.length, 2);
  const list = h.calls.find(call => call.url.endsWith('/9')), block = h.calls.find(call => call !== list);
  assert.deepEqual(JSON.parse(list.body), { titulo: 'A', emoji: '📝', expected_version: 4 });
  assert.deepEqual(JSON.parse(block.body), { contenido: { texto: 'replacement' }, expected_version: 4 });
  await success(block); assert.equal(h.queue.snapshot().dirty, true);
  list.resolve({ id: 9, version: 5, titulo: 'A', emoji: '📝' }); assert.equal(await flushed, true);
});

test('flush bypasses debounce and waits for flight plus latest queued desired state', async () => {
  const h = setup(); h.queue.schedule(record());
  let done = false; const flushed = h.queue.flush().then(result => { done = true; return result; });
  await settle(); assert.equal(h.calls.length, 1); assert.equal(done, false);
  h.queue.schedule(record({ payload: { contenido: { texto: 'last' } } }));
  await success(h.calls[0]); assert.equal(done, false); assert.equal(h.calls.length, 2);
  assert.equal(JSON.parse(h.calls[1].body).expected_version, 5);
  await success(h.calls[1], 6); assert.equal(await flushed, true); assert.equal(h.clock.size(), 0);
});

test('uncertain failure retains dirty; explicit retry replays exact serialized body/version before newer desired', async () => {
  const h = setup(); h.queue.schedule(record()); await h.clock.tick(650);
  const firstBody = h.calls[0].body;
  await failure(h.calls[0], undefined); assert.equal(h.queue.snapshot().dirty, true); assert.equal(h.queue.snapshot().status, 'error');
  h.queue.schedule(record({ version: 200, payload: { contenido: { texto: 'typed after failure' } } }));
  await h.clock.tick(650); assert.equal(h.calls.length, 1); assert.equal(await h.queue.flush(), false);
  const retried = h.queue.retry(); await settle(); assert.equal(h.calls[1].body, firstBody);
  await success(h.calls[1], 5); assert.equal(h.saved[0].hasNewer, true);
  assert.equal(h.calls.length, 3);
  assert.deepEqual(JSON.parse(h.calls[2].body), { contenido: { texto: 'typed after failure' }, expected_version: 5 });
  await success(h.calls[2], 6); assert.equal(await retried, true);
});

test('409 retains newer content drafts while blocking all retries, timers and CAS rebase until explicit discard', async () => {
  const h = setup(); h.queue.schedule(record()); await h.clock.tick(650);
  await failure(h.calls[0], 409);
  assert.equal(h.queue.snapshot().conflict, true); assert.equal(h.queue.snapshot().dirty, true);
  assert.equal(await h.queue.retry(), false); assert.equal(await h.queue.flush(), false);
  const error = h.queue.snapshot().error;
  const later = record({ version: 100, payload: { contenido: { texto: 'B2 after conflict' } } });
  assert.equal(h.queue.schedule(later), true);
  later.payload.contenido.texto = 'outside mutation';
  assert.equal(h.queue.snapshot().dirty, true); assert.equal(h.queue.snapshot().conflict, true);
  assert.equal(h.queue.snapshot().error, error); assert.equal(h.queue.snapshot().pending, 1);
  assert.equal(h.clock.size(), 0);
  assert.equal(await h.queue.retry(), false); assert.equal(await h.queue.flush(), false);
  await h.clock.tick(20000); assert.equal(h.calls.length, 1); assert.equal(h.saved.length, 0);
  h.queue.discard(); assert.equal(h.queue.snapshot().dirty, false); assert.equal(h.queue.snapshot().conflict, false);
});

test('409 accepts and merges later metadata drafts without a transport attempt or clearing the error', async () => {
  const h = setup(), meta = { listId: 9, recordId: 9 };
  const item = extra => record({ key: 'list:9', url: '/api/listas-personales/9', meta, merge: true, ...extra });
  h.queue.schedule(item({ payload: { titulo: 'B1' } })); await h.clock.tick(650); await failure(h.calls[0], 409);
  const before = h.queue.snapshot();
  assert.equal(h.queue.schedule(item({ version: 20, payload: { titulo: 'B2' } })), true);
  assert.equal(h.queue.schedule(item({ version: 21, payload: { emoji: '📝' } })), true);
  assert.deepEqual(h.queue.snapshot(), before);
  assert.equal(h.clock.size(), 0); assert.equal(await h.queue.retry(), false);
  await h.clock.tick(20000); assert.equal(h.calls.length, 1); assert.equal(h.saved.length, 0);
  h.queue.discard(); assert.equal(h.queue.snapshot().status, 'saved');
});

test('PG int maximum applies to versions and session ID, independently of BIGSERIAL record IDs', async () => {
  const max = 2147483647, h = setup();
  for (const bad of [record({ version: max + 1 }), record({ version: '4' })])
    assert.equal(h.queue.schedule(bad), false);
  assert.equal(h.queue.snapshot().dirty, false);
  h.queue.schedule(record()); await h.clock.tick(650); await success(h.calls[0], max + 1);
  assert.equal(h.saved.length, 0); assert.equal(h.queue.snapshot().dirty, true);
  const valid = setup(); assert.equal(valid.queue.schedule(record({ version: max })), true); valid.queue.dispose();
  const invalidSession = setup({ session: { ...session(), usuario: { ...session().usuario, id: max + 1 } } });
  assert.equal(invalidSession.queue.schedule(record()), false);
});

test('actual BIGSERIAL string IDs preserve exact metadata type and advance ACK version over stale renders', async () => {
  const h = setup(), meta = { listId: '1', blockId: '1', recordId: '1' };
  const item = extra => record({ key: 'block:1', url: '/api/listas-personales/bloques/1', meta, ...extra });
  assert.equal(h.queue.schedule(item()), true);
  const first = h.queue.flush(); await settle();
  assert.equal(h.calls[0].url, '/api/listas-personales/bloques/1');
  h.calls[0].resolve({ id: '1', version: 5 }); assert.equal(await first, true);
  assert.deepEqual(h.saved[0].meta, meta); assert.equal(h.saved[0].row.id, '1');
  assert.equal(h.queue.schedule(item({ version: 4, payload: { contenido: { texto: 'new draft' } } })), true);
  const second = h.queue.flush(); await settle();
  assert.equal(JSON.parse(h.calls[1].body).expected_version, 5);
  h.calls[1].resolve({ id: '1', version: 6 }); assert.equal(await second, true);
  assert.equal(h.saved[1].key, 'block:1'); assert.equal(h.queue.snapshot().status, 'saved');
  assert.equal(h.queue.schedule(item({ meta: { listId: '1', blockId: 1, recordId: 1 } })), false);
  assert.equal(h.queue.schedule(item({ url: '/api/listas-personales/bloques/2' })), false);
});

test('BIGINT maximum and adjacent large IDs remain exact and independent; safe numeric IDs remain supported', async () => {
  const h = setup(), ids = ['9223372036854775806', '9223372036854775807'];
  for (const id of ids) assert.equal(h.queue.schedule(record({ key: `block:${id}`,
    url: `/api/listas-personales/bloques/${id}`, meta: { listId: id, blockId: id, recordId: id } })), true);
  const flushed = h.queue.flush(); await settle(); assert.equal(h.calls.length, 2);
  for (let i = 0; i < ids.length; i += 1) h.calls[i].resolve({ id: ids[i], version: 5 });
  assert.equal(await flushed, true); assert.deepEqual(h.saved.map(value => value.row.id), ids);
  assert.deepEqual(h.saved.map(value => value.meta.recordId), ids);
  for (const id of [2147483648, Number.MAX_SAFE_INTEGER]) {
    const safe = setup(); assert.equal(safe.queue.schedule(record({ meta: { listId: id, blockId: id, recordId: id } })), true);
    const done = safe.queue.flush(); await settle(); safe.calls[0].resolve({ id, version: 5 }); assert.equal(await done, true);
  }
});

test('record IDs reject noncanonical/overflow strings, native bigint and lossy numbers in every metadata position', () => {
  const h = setup();
  const invalid = ['0', '01', '-1', '+1', ' 1', '1 ', '1.0', '1e3', '9223372036854775808',
    '99999999999999999999', '', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, 1n, null];
  for (const value of invalid) for (const field of ['listId', 'blockId', 'recordId'])
    assert.equal(h.queue.schedule(record({ meta: { listId: '9', blockId: '31', recordId: '31', [field]: value } })), false);
  assert.equal(h.queue.snapshot().dirty, false); assert.equal(h.clock.size(), 0);
});

test('ACK record ID must match the captured string or numeric type exactly, not just its decimal value', async () => {
  for (const [expected, actual] of [['31', 31], [31, '31'], ['9223372036854775807', '9223372036854775806']]) {
    const h = setup(); h.queue.schedule(record({ meta: { listId: '9', blockId: expected, recordId: expected } }));
    const done = h.queue.flush(); await settle(); h.calls[0].resolve({ id: actual, version: 5 });
    assert.equal(await done, false); assert.equal(h.saved.length, 0); assert.equal(h.queue.snapshot().dirty, true);
  }
});

for (const status of [400, 413, 422]) test(`${status} retains desired error but corrected input can resume with original CAS`, async () => {
  const h = setup(); h.queue.schedule(record()); await h.clock.tick(650); await failure(h.calls[0], status);
  assert.equal(await h.queue.retry(), false); assert.equal(h.queue.snapshot().dirty, true);
  assert.equal(h.queue.schedule(record({ version: 500, payload: { contenido: { texto: 'corrected' } } })), true);
  await h.clock.tick(650); assert.equal(JSON.parse(h.calls[1].body).expected_version, 4);
  await success(h.calls[1]); assert.equal(h.queue.snapshot().dirty, false);
});

for (const status of [401, 403]) test(`${status} clears private queue and calls onDenied once`, async () => {
  const h = setup(); h.queue.schedule(record()); await h.clock.tick(650);
  h.queue.schedule(record({ key: 'other', url: '/api/listas-personales/9', meta: { listId: 9, recordId: 9 } }));
  await failure(h.calls[0], status); assert.equal(h.queue.snapshot().pending, 0);
  assert.equal(h.queue.snapshot().dirty, false); assert.equal(h.saved.length, 0); assert.equal(h.denied.length, 1);
  assert.equal(h.queue.schedule(record()), false); assert.equal(await h.queue.retry(), false);
  await h.clock.tick(20000); assert.equal(h.calls.length, 1); assert.equal(h.denied.length, 1);
});

for (const field of ['id', 'token', 'role', 'active']) test(`changed session ${field} suppresses late old-user ACK`, async () => {
  const h = setup(); h.queue.schedule(record()); await h.clock.tick(650);
  const next = session();
  if (field === 'id') next.usuario.id = 18;
  if (field === 'token') next.token = 'different-synthetic-token';
  if (field === 'role') next.usuario.rol = 'admin';
  if (field === 'active') next.usuario.activo = false;
  h.changeSession(next); await success(h.calls[0]);
  assert.equal(h.saved.length, 0); assert.equal(h.denied.length, 1); assert.equal(h.queue.snapshot().pending, 0);
});

test('session changes before debounce deny without sending; missing identity never saves', async () => {
  const h = setup(); h.queue.schedule(record()); h.changeSession(null); await h.clock.tick(650);
  assert.equal(h.calls.length, 0); assert.equal(h.denied.length, 1);
  const invalid = setup({ session: null }); assert.equal(invalid.queue.schedule(record()), false); assert.equal(invalid.calls.length, 0);
});

for (const row of [{ id: 32, version: 5 }, { id: 31, version: 4 }, { id: 31, version: '5' }, null])
  test(`invalid ACK ${JSON.stringify(row)} keeps dirty and never notifies saved`, async () => {
    const h = setup(); h.queue.schedule(record()); await h.clock.tick(650);
    h.calls[0].resolve(row); await settle(); assert.equal(h.saved.length, 0); assert.equal(h.queue.snapshot().dirty, true);
    assert.equal(h.queue.snapshot().status, 'error');
  });

test('bounded timeout aborts, retains exact retry and ignores late transport success', async () => {
  const h = setup({ timeoutMs: 50 }); h.queue.schedule(record()); await h.clock.tick(650);
  await h.clock.tick(50); assert.equal(h.calls[0].signal.aborted, true); assert.equal(h.queue.snapshot().status, 'error');
  await success(h.calls[0]); assert.equal(h.saved.length, 0);
  const retry = h.queue.retry(); await settle(); assert.equal(h.calls[1].body, h.calls[0].body);
  await success(h.calls[1]); assert.equal(await retry, true);
});

test('discard explicitly cleans/aborts generation and stale response cannot affect a new draft', async () => {
  const h = setup(); h.queue.schedule(record()); const first = h.queue.flush(); await settle();
  h.queue.discard(); assert.equal(h.calls[0].signal.aborted, true); assert.equal(await first, false);
  assert.equal(h.queue.snapshot().status, 'saved');
  h.queue.schedule(record({ payload: { contenido: { texto: 'new generation' } } }));
  await success(h.calls[0]); assert.equal(h.saved.length, 0); assert.equal(h.queue.snapshot().dirty, true);
  await h.clock.tick(650); await success(h.calls[1]); assert.equal(h.saved.length, 1);
});

test('dispose clears timers/aborts and emits no further callbacks even after transport settles', async () => {
  const h = setup(); h.queue.schedule(record()); const flushed = h.queue.flush(); await settle();
  const count = h.states.length; h.queue.dispose(); assert.equal(h.calls[0].signal.aborted, true);
  assert.equal(await flushed, false); await success(h.calls[0]); await h.clock.tick(20000);
  assert.equal(h.states.length, count); assert.equal(h.saved.length, 0); assert.equal(h.denied.length, 0); assert.equal(h.clock.size(), 0);
  assert.equal(h.queue.schedule(record()), false);
});

test('dispose before debounce prevents transport; invalid schedules never acquire dirty state', async () => {
  const h = setup();
  for (const bad of [record({ version: 0 }), record({ payload: null }), record({ url: 'https://example.invalid/api' }),
    record({ meta: { listId: 9, recordId: 0 } })]) assert.equal(h.queue.schedule(bad), false);
  assert.equal(h.queue.snapshot().dirty, false);
  h.queue.schedule(record()); const count = h.states.length;
  h.queue.dispose(); await h.clock.tick(20000);
  assert.equal(h.calls.length, 0); assert.equal(h.states.length, count); assert.equal(h.clock.size(), 0);
});

test('late failures after discard are ignored without denial or error callbacks', async () => {
  const h = setup(); h.queue.schedule(record()); const pending = h.queue.flush(); await settle();
  h.queue.discard(); const count = h.states.length;
  await failure(h.calls[0], 403); assert.equal(await pending, false);
  assert.equal(h.denied.length, 0); assert.equal(h.states.length, count); assert.equal(h.queue.snapshot().status, 'saved');
});

test('synchronous transport/observer exceptions never discard dirty or report false failure after ACK', async () => {
  const h = setup({ request() { throw new Error('transport failed'); } }); h.queue.schedule(record());
  assert.equal(await h.queue.flush(), false); assert.equal(h.queue.snapshot().dirty, true);
  const good = setup({ onSaved() { throw new Error('observer failed'); }, onState() { throw new Error('observer failed'); } });
  good.queue.schedule(record()); const flushed = good.queue.flush(); await settle(); await success(good.calls[0]);
  assert.equal(await flushed, true); assert.equal(good.queue.snapshot().status, 'saved');
});
