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
  const loader = createHomeTeamLoader({ sesion: captured, readSession: () => live, request, onChange: value => events.push(value) });
  await loader.refresh(); assert.equal(events.at(-1).status, 'ready');
  live = { ...session(), token: 'replacement-bearer' };
  await loader.refresh(); assert.equal(calls, 1); assert.equal(events.at(-1).data, null); loader.dispose();
});


test('genuine cookie binding pins GET intent without bearer and blocks stale same-context generations', async () => {
  const store = createBrowserSessionState();
  const value = { usuario: { id: 7, usuario: 'synthetic', nombre: 'QA', rol: 'admin' }, session_context: 'A'.repeat(43), csrf_token: 'C'.repeat(43) };
  store.acceptBootstrap(store.beginBootstrap(), value);
  const captured = store.getSession(), events = [], calls = [];

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
  const loader = createHomeTeamLoader({ sesion: captured, readSession: () => store.getSession(), request, onChange: value => events.push(value) });
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
    const loader = createHomeTeamLoader({ sesion: captured, readSession: () => store.getSession(), request, onChange: value => events.push(value) });
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
  const loader = createHomeTeamLoader({ sesion: captured, readSession: () => store.getSession(), request, onChange: value => events.push(value) });
  await loader.refresh(); assert.equal(calls, 0); assert.equal(events.at(-1).status, 'error'); loader.dispose();
});

import { readFileSync } from 'node:fs';
import { parseHomeTeamWorkload, homeTeamTaskHref, createHomeTeamLoader } from './homeTeamWorkload.js';
const session = () => ({ token: 'qa-token', usuario: { id: 7, rol: 'admin', activo: true } });
const dto = (offset = 0, total = 21) => ({ version: 1, today: '2028-02-29', offset, limit: 20,
  total_tasks: 60, total_overdue: 22, total_people: total, has_more: offset + 20 < total,
  unassigned: { open: 2, overdue: 1 }, items: Array.from({ length: Math.min(20, Math.max(0, total - offset)) }, (_, i) => ({
    user: { id: offset + i + 1, nombre: 'Homónimo <script>', activo: true }, open: 3, overdue: 1, review: 1, approved: 1 })) });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('closed team projection allows homonyms, collaboration and inactive accounts without financial bags', () => {
  const raw = dto(); raw.finance = 999; raw.items[0].user.salary = 123; raw.items[0].metadata = 'secret'; raw.items[0].user.activo = false;
  const result = parseHomeTeamWorkload(raw);
  assert.equal(result.items.length, 20); assert.equal(result.items[0].user.nombre, 'Homónimo <script>');
  assert.equal(result.items[0].user.activo, false);
  assert.ok(result.items.reduce((sum, item) => sum + item.open, 0) > result.total_tasks - result.unassigned.open);
  assert.equal(JSON.stringify(result).includes('finance'), false); assert.equal(JSON.stringify(result).includes('salary'), false);
  assert.equal(JSON.stringify(result).includes('metadata'), false);
  assert.equal(parseHomeTeamWorkload(dto(20), 20).items.length, 1);
  assert.deepEqual(parseHomeTeamWorkload(dto(40), 40).items, []);
});

test('parser rejects inconsistent counts, pages, identities, dates, order and duplicate IDs', () => {
  for (const patch of [{ version: 2 }, { today: '2027-02-29' }, { total_tasks: -1 }, { total_overdue: 61 },
    { total_people: '21' }, { has_more: false }, { items: [] }, { offset: 20 }, { limit: 500 },
    { unassigned: { open: 61, overdue: 1 } }, { unassigned: { open: 2, overdue: 3 } }]) {
    assert.throws(() => parseHomeTeamWorkload({ ...dto(), ...patch }));
  }
  for (const patch of [{ open: 0 }, { open: '3' }, { overdue: 4 }, { review: 2, approved: 2 },
    { user: { id: 0, nombre: 'A', activo: true } }, { user: { id: 2147483648, nombre: 'A', activo: true } },
    { user: { id: 1, nombre: 'A', activo: null } }]) {
    const raw = dto(); Object.assign(raw.items[0], patch); assert.throws(() => parseHomeTeamWorkload(raw));
  }
  const duplicate = dto(); duplicate.items[1].user.id = 1; assert.throws(() => parseHomeTeamWorkload(duplicate));
  const unordered = dto(); unordered.items[1].overdue = 2; assert.throws(() => parseHomeTeamWorkload(unordered));
  for (const offset of [-20, 1, 1000020, '0']) assert.throws(() => parseHomeTeamWorkload(dto(), offset));
});

test('board links contain stable IDs only', () => {
  assert.equal(homeTeamTaskHref(91003), '/workspace/tareas?responsible=id%3A91003');
  for (const id of ['Franco', '91003', -1, 0, 1.5, 2147483648]) assert.equal(homeTeamTaskHref(id), null);
});

test('team loader requests bounded read pages and throttles background refresh', async () => {
  const current = session(), states = []; let calls = 0, now = 0;
  const loader = createHomeTeamLoader({ sesion: current, readSession: () => current, now: () => now, onChange: state => states.push(state),
    request: async (url, options) => { calls++; assert.equal(options.method, 'GET'); assert.ok(options.signal instanceof AbortSignal);
      assert.equal(url, `/api/inicio/equipo?offset=${calls === 1 ? 0 : 20}&limit=20`); assert.equal('body' in options, false); return dto(calls === 1 ? 0 : 20); } });
  await loader.refresh(); assert.equal(states.at(-1).status, 'ready');
  assert.equal(await loader.refresh({ background: true }), false);
  now = 30000; await loader.refresh({ offset: 20 }); assert.equal(states.at(-1).data.offset, 20);
  loader.dispose(); assert.equal(await loader.refresh(), false); assert.equal(calls, 2);
});

test('late success and failure cannot override a newer team page or disposed loader', async () => {
  for (const reject of [false, true]) {
    const current = session(), a = deferred(), b = deferred(), states = []; let calls = 0, signal;
    const loader = createHomeTeamLoader({ sesion: current, readSession: () => current, onChange: state => states.push(state),
      request: (_url, options) => { if (++calls === 1) { signal = options.signal; return a.promise; } return b.promise; } });
    const first = loader.refresh(); const second = loader.refresh({ offset: 20 });
    assert.equal(signal.aborted, true); b.resolve(dto(20)); await second; const size = states.length;
    if (reject) a.reject(new Error('private')); else a.resolve(dto()); await first;
    assert.equal(states.length, size); assert.equal(states.at(-1).data.offset, 20); loader.dispose();
  }
  const pending = deferred(), states = [], current = session();
  const loader = createHomeTeamLoader({ sesion: current, readSession: () => current, onChange: state => states.push(state), request: () => pending.promise });
  const run = loader.refresh(); loader.dispose(); pending.resolve(dto()); await run;
  assert.deepEqual(states.map(state => state.status), ['loading']);
});

test('session changes suppress team data and prevent new dispatches', async () => {
  for (const next of [null, { ...session(), token: 'other' }, { ...session(), usuario: { id: 8, rol: 'admin', activo: true } },
    { ...session(), usuario: { id: 7, rol: 'community', activo: true } }, { ...session(), usuario: { id: 7, rol: 'admin', activo: false } }]) {
    let current = session(), calls = 0; const pending = deferred(), states = [];
    const loader = createHomeTeamLoader({ sesion: current, readSession: () => current, onChange: state => states.push(state), request: () => { calls++; return pending.promise; } });
    const run = loader.refresh(); current = next; pending.resolve(dto()); await run;
    assert.equal(states.at(-1).data, null); await loader.refresh(); assert.equal(calls, 1); loader.dispose();
  }
});

test('server and malformed-response failures clear old totals and hide private diagnostics', async () => {
  let mode = 0; const states = [], current = session();
  const loader = createHomeTeamLoader({ sesion: current, readSession: () => current, onChange: state => states.push(state), request: async () => {
    if (mode === 1) throw new Error('private salary 999'); if (mode === 2) return {}; return dto(); } });
  await loader.refresh();
  for (mode = 1; mode <= 2; mode++) { await loader.refresh(); assert.equal(states.at(-1).data, null); assert.doesNotMatch(states.at(-1).error, /salary|999/); }
  loader.dispose();
});

test('principal mounts guarded team component with safe labels, cleanup and semantic navigation', () => {
  const source = readFileSync(new URL('./HomeTeamWorkload.jsx', import.meta.url), 'utf8');
  assert.match(source, /if \(!allowed\) return null/); assert.match(source, /identityRef.current === identity/);
  assert.match(source, /unsubscribe\(\); loader.dispose\(\)/); assert.match(source, /aria-label="Páginas del trabajo del equipo"/);
  assert.match(source, /item.user.activo/); assert.match(source, /homeTeamTaskHref\(item.user.id\)/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|localStorage/);
  assert.match(readFileSync(new URL('../pages/QuickHome.jsx', import.meta.url), 'utf8'), /<HomeTeamWorkload sesion=\{sesion\}/);
});
