import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';
test('legacy GET carries the initial exact bearer without cookie aliases or dispatch recapture', async () => {
  let live = session(); const captured = live, events = []; let calls = 0;
  const request = async (_url, options) => {
    calls++; assert.equal(options.headers.Authorization, `Bearer ${captured.token}`);
    assert.equal(options.sessionIntent, undefined);
    assert.equal(new Headers(options.headers).has('X-Render-Session-Context'), false);
    assert.equal(options.method, 'GET'); return dto();
  };
  const loader = createHomeEscalationsLoader({ sesion: captured, readSession: () => live, request, onChange: value => events.push(value) });
  await loader.refresh(); assert.equal(events.at(-1).status, 'ready');
  live = { ...session(), token: 'replacement-bearer' };
  await loader.refresh(); assert.equal(calls, 1); assert.equal(events.at(-1).data, null); loader.dispose();
});


test('genuine cookie binding pins GET intent without bearer and blocks stale same-context generations', async () => {
  const store = createBrowserSessionState();
  const value = { usuario: { id: 7, usuario: 'synthetic', nombre: 'QA', rol: 'admin' }, session_context: 'A'.repeat(43), csrf_token: 'C'.repeat(43) };
  store.acceptBootstrap(store.beginBootstrap(), value);
  const captured = store.getSession(), events = [], calls = [];
  assert.equal(canReadHomeEscalations(captured), true); assert.equal(canReadHomeEscalations({ ...captured }), false);
  const request = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.method, 'GET'); assert.ok(options.signal instanceof AbortSignal);
    assert.equal(new Headers(options.headers).has('Authorization'), false);
    assert.equal(new Headers(options.headers).get('X-Render-Session-Context'), captured.session_context);
    assert.equal(new Headers(options.headers).get('X-Render-CSRF'), captured.csrf_token);
    assert.equal(options.sessionIntent.session, captured);
    assert.equal(store.isCurrent(options.sessionIntent), true);
    assert.equal('body' in options, false);
    return dto();
  };
  const loader = createHomeEscalationsLoader({ sesion: captured, readSession: () => store.getSession(), request, onChange: value => events.push(value) });
  await loader.refresh(); assert.equal(events.at(-1).status, 'ready'); assert.equal(calls.length, 1);
  store.acceptBootstrap(store.beginBootstrap(), value);
  await loader.refresh(); assert.equal(calls.length, 1); assert.equal(events.at(-1).status, 'error'); assert.equal(events.at(-1).data, null);
  loader.dispose();
});

test('cookie late success/error and replacement account never publish or recapture a new intent', async () => {
  for (const failure of [false, true]) {
    const store = createBrowserSessionState();
    const value = { usuario: { id: 7, usuario: 'synthetic', nombre: 'QA', rol: 'admin' }, session_context: 'A'.repeat(43), csrf_token: 'C'.repeat(43) };
    store.acceptBootstrap(store.beginBootstrap(), value);
    const captured = store.getSession(), events = []; let resolve, reject, calls = 0;
    const request = () => { calls++; return new Promise((yes, no) => { resolve = yes; reject = no; }); };
    const loader = createHomeEscalationsLoader({ sesion: captured, readSession: () => store.getSession(), request, onChange: value => events.push(value) });
    const pending = loader.refresh();
    store.acceptBootstrap(store.beginBootstrap(), { ...value, usuario: { ...value.usuario, id: 17 }, session_context: 'B'.repeat(43) });
    if (failure) reject(new Error('old request failed')); else resolve(dto());
    await pending;
    assert.equal(events.at(-1).status, 'error'); assert.equal(events.at(-1).data, null);
    await loader.refresh(); assert.equal(calls, 1); loader.dispose();
  }
});

test('forged cookie DTO is never an accepted loader identity', async () => {
  const store = createBrowserSessionState();
  store.acceptBootstrap(store.beginBootstrap(), { usuario: { id: 7, usuario: 'synthetic', nombre: 'QA', rol: 'admin' }, session_context: 'A'.repeat(43), csrf_token: 'C'.repeat(43) });
  const captured = { ...store.getSession() }, events = []; let calls = 0;
  const request = async () => { calls++; return dto(); };
  const loader = createHomeEscalationsLoader({ sesion: captured, readSession: () => store.getSession(), request, onChange: value => events.push(value) });
  await loader.refresh(); assert.equal(calls, 0); assert.equal(events.at(-1).status, 'error'); loader.dispose();
});

import { readFileSync } from 'node:fs';
import { canReadHomeEscalations, parseHomeEscalations, createHomeEscalationsLoader } from './homeEscalations.js';
import { subscribePersonalHomeRefresh } from '../pages/personalHome.js';

const session = () => ({ token: 'token-a', usuario: { id: 7, rol: 'admin', activo: true } });
const item = (id = 1) => ({ id, titulo: '<img src=x onerror=alert(1)>', estado: 'pendiente', prioridad: 'alta',
  revision: 2, fecha_vencimiento: '2028-02-29', cliente: { id: 3, nombre: 'Cliente' }, href: `/workspace/tareas?task=${id}` });
const dto = (offset = 0, total = 21) => ({ version: 1, offset, limit: 20, total,
  has_more: offset + 20 < total, items: Array.from({ length: Math.min(20, Math.max(0, total - offset)) }, (_, i) => item(offset + i + 1)) });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('only token-bearing positive-ID active admin qualifies; names confer nothing', () => {
  assert.equal(canReadHomeEscalations(session()), true);
  for (const id of [0, -1, '7', 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(canReadHomeEscalations({ ...session(), usuario: { id, rol: 'admin' } }), false);
  }
  for (const rol of ['produccion', 'community', 'lider', undefined]) {
    assert.equal(canReadHomeEscalations({ ...session(), usuario: { id: 7, rol, nombre: 'Agustin' } }), false);
  }
  assert.equal(canReadHomeEscalations({ ...session(), token: '' }), false);
  assert.equal(canReadHomeEscalations({ ...session(), usuario: { id: 7, rol: 'admin', activo: false } }), false);
});

test('parser closes projection, preserves literal titulo, real dates and exact safe task href', () => {
  const raw = dto(); raw.reasons = 'secret'; raw.items[0].metadata = { finance: 999 };
  raw.items[0].cliente.finance = 888;
  const parsed = parseHomeEscalations(raw);
  assert.equal(parsed.items.length, 20);
  assert.equal(parsed.items[0].titulo, '<img src=x onerror=alert(1)>');
  assert.equal('metadata' in parsed.items[0], false);
  assert.equal('finance' in parsed.items[0].cliente, false);
  assert.equal('reasons' in parsed, false);
  assert.equal(parseHomeEscalations(dto(20), 20).has_more, false);
  assert.deepEqual(parseHomeEscalations(dto(40), 40).items, []);
  const nullable = dto(0, 1); nullable.items[0].cliente = null; nullable.items[0].fecha_vencimiento = null;
  assert.equal(parseHomeEscalations(nullable).items[0].cliente, null);
});

test('invalid shape, pagination, IDs, dates, revisions and dangerous links fail closed', () => {
  for (const patch of [{ version: 2 }, { offset: 20 }, { limit: 21 }, { total: -1 }, { total: '21' },
    { has_more: false }, { items: [] }, { items: {} }]) assert.throws(() => parseHomeEscalations({ ...dto(), ...patch }));
  for (const patch of [{ id: 0 }, { revision: 0 }, { revision: '2' }, { titulo: undefined, title: 'wrong field' },
    { estado: {} }, { prioridad: null }, { fecha_vencimiento: '2027-02-29' }, { fecha_vencimiento: '2026-04-31' },
    { fecha_vencimiento: 'tomorrow' }, { cliente: { id: '3', nombre: 'x' } }, { cliente: undefined },
    ...['javascript:alert(1)', 'data:text/html,x', '//evil.test', 'https://render.test/workspace/tareas?task=1',
      '/workspace/tareas?task=2', '/workspace/tareas?task=1&role=admin', '/workspace/tareas?task=01',
      '/workspace/tareas?task=1#x'].map(href => ({ href }))]) {
    const raw = dto(0, 1); Object.assign(raw.items[0], patch); assert.throws(() => parseHomeEscalations(raw));
  }
  const duplicates = dto(); duplicates.items[1] = item(1); assert.throws(() => parseHomeEscalations(duplicates));
  assert.throws(() => parseHomeEscalations(dto(), 1));
});

test('loader sends GET only, fixed limit, page offset and abort signal; throttles background refresh', async () => {
  let now = 0, calls = 0; const changes = []; const current = session();
  const loader = createHomeEscalationsLoader({ sesion: current, readSession: () => current, now: () => now,
    onChange: state => changes.push(state), request: async (url, options) => {
      calls++; assert.equal(options.method, 'GET'); assert.ok(options.signal instanceof AbortSignal);
      assert.equal('body' in options, false); assert.equal(url, `/api/inicio/escalaciones?offset=${calls === 1 ? 0 : 20}&limit=20`);
      return dto(calls === 1 ? 0 : 20);
    } });
  await loader.refresh(); assert.equal(changes.at(-1).status, 'ready');
  assert.equal(await loader.refresh({ background: true }), false);
  now = 30000; await loader.refresh({ offset: 20 });
  assert.equal(changes.at(-1).data.offset, 20); assert.equal(calls, 2);
  loader.dispose(); assert.equal(await loader.refresh(), false);
});

test('superseded success/failure and disposed transports cannot publish even if abort is ignored', async () => {
  for (const fail of [false, true]) {
    const first = deferred(), second = deferred(); const states = []; const current = session(); let calls = 0, firstSignal;
    const loader = createHomeEscalationsLoader({ sesion: current, readSession: () => current, onChange: state => states.push(state),
      request: (_url, { signal }) => { if (++calls === 1) firstSignal = signal; return calls === 1 ? first.promise : second.promise; } });
    const a = loader.refresh(); const b = loader.refresh({ offset: 20 });
    assert.equal(firstSignal.aborted, true);
    second.resolve(dto(20)); await b; const length = states.length;
    if (fail) first.reject(new Error('private diagnostic')); else first.resolve(dto());
    await a; assert.equal(states.length, length); assert.equal(states.at(-1).data.offset, 20);
    loader.dispose();
  }
  const pending = deferred(), states = []; const current = session();
  const loader = createHomeEscalationsLoader({ sesion: current, readSession: () => current,
    onChange: state => states.push(state), request: () => pending.promise });
  const run = loader.refresh(); loader.dispose(); pending.resolve(dto()); await run;
  assert.deepEqual(states.map(state => state.status), ['loading']);
});

test('live token/ID/role/activity switches suppress data and prevent further dispatch', async () => {
  for (const switched of [{ ...session(), token: 'new' }, { ...session(), usuario: { id: 8, rol: 'admin', activo: true } },
    { ...session(), usuario: { id: 7, rol: 'produccion', activo: true } },
    { ...session(), usuario: { id: 7, rol: 'admin', activo: false } }, null]) {
    let current = session(), calls = 0; const captured = current, pending = deferred(), states = [];
    const loader = createHomeEscalationsLoader({ sesion: captured, readSession: () => current,
      onChange: state => states.push(state), request: () => { calls++; return pending.promise; } });
    const run = loader.refresh(); current = switched; pending.resolve(dto()); await run;
    assert.equal(states.at(-1).data, null); assert.equal(states.at(-1).status, 'error');
    await loader.refresh(); assert.equal(calls, 1); loader.dispose();
  }
});

test('failures clear data and do not expose server reasons or financial diagnostics', async () => {
  const current = session(), states = []; let fail = false;
  const loader = createHomeEscalationsLoader({ sesion: current, readSession: () => current,
    onChange: state => states.push(state), request: async () => { if (fail) throw Object.assign(new Error('finance secret'), { status: 403 }); return dto(); } });
  await loader.refresh(); fail = true; await loader.refresh();
  assert.equal(states.at(-1).data, null); assert.doesNotMatch(states.at(-1).error, /finance|secret/); loader.dispose();
});

test('existing visible focus/online refresh subscription cleans up listeners', () => {
  const win = new EventTarget(), doc = new EventTarget(); doc.visibilityState = 'hidden'; let calls = 0;
  const unsubscribe = subscribePersonalHomeRefresh({ refresh(options) { assert.equal(options.background, true); calls++; } }, win, doc);
  win.dispatchEvent(new Event('focus')); assert.equal(calls, 0);
  doc.visibilityState = 'visible';
  for (const type of ['focus', 'online']) win.dispatchEvent(new Event(type));
  doc.dispatchEvent(new Event('visibilitychange')); assert.equal(calls, 3);
  unsubscribe(); win.dispatchEvent(new Event('focus')); doc.dispatchEvent(new Event('visibilitychange')); assert.equal(calls, 3);
});

test('component source wires identity isolation, shared navigation/date/state and accessible pagination', () => {
  // Source contracts, not mounted/rendered UI verification.
  const source = readFileSync(new URL('./HomeEscalations.jsx', import.meta.url), 'utf8');
  for (const expected of ["request = apiRequest", "readSession: getSesion", 'identityRef.current === identity',
    'result?.identity === identity', 'subscribePersonalHomeRefresh(loader)', 'unsubscribe(); loader.dispose()',
    'if (!allowed) return null', 'Escaladas a dirección', 'no es la cola de revisión', 'qh-section', 'qh-task-row',
    'personalHomeNavigate(event, task.href, onNavigate)', 'homeStateLabel(task.estado)', 'homeDeadline(task.fecha_vencimiento, today)',
    '{task.titulo}', 'disabled={data.offset === 0}', 'disabled={!data.has_more}', 'Anterior', 'Siguiente', '{data.total} en total']) assert.ok(source.includes(expected), expected);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|\.title\b|\.metadata|motivo_bloqueo|finance|\.css['"]|fetch\(/);
});
