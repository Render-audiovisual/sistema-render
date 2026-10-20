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
  const loader = createEditorialPieceDetailLoader({ sesion: captured, piece: item(), readSession: () => live, request, onChange: value => events.push(value) });
  await loader.refresh(); assert.equal(events.at(-1).status, 'ready');
  live = { ...session(), token: 'replacement-bearer' };
  await loader.refresh(); assert.equal(calls, 1); assert.equal(events.at(-1).data, null); loader.dispose();
});


test('genuine cookie binding pins GET intent without bearer and blocks stale same-context generations', async () => {
  const store = createBrowserSessionState();
  const value = { usuario: { id: 8, usuario: 'synthetic', nombre: 'QA', rol: 'community' }, session_context: 'A'.repeat(43), csrf_token: 'C'.repeat(43) };
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
  const loader = createEditorialPieceDetailLoader({ sesion: captured, piece: item(), readSession: () => store.getSession(), request, onChange: value => events.push(value) });
  await loader.refresh(); assert.equal(events.at(-1).status, 'ready'); assert.equal(calls.length, 1);
  store.acceptBootstrap(store.beginBootstrap(), value);
  await loader.refresh(); assert.equal(calls.length, 1); assert.equal(events.at(-1).status, 'error'); assert.equal(events.at(-1).data, null);
  loader.dispose();
});

test('cookie late success/error and replacement account never publish or recapture a new intent', async () => {
  for (const failure of [false, true]) {
    const store = createBrowserSessionState();
    const value = { usuario: { id: 8, usuario: 'synthetic', nombre: 'QA', rol: 'community' }, session_context: 'A'.repeat(43), csrf_token: 'C'.repeat(43) };
    store.acceptBootstrap(store.beginBootstrap(), value);
    const captured = store.getSession(), events = []; let resolve, reject, calls = 0;
    const request = () => { calls++; return new Promise((yes, no) => { resolve = yes; reject = no; }); };
    const loader = createEditorialPieceDetailLoader({ sesion: captured, piece: item(), readSession: () => store.getSession(), request, onChange: value => events.push(value) });
    const pending = loader.refresh();
    store.acceptBootstrap(store.beginBootstrap(), { ...value, usuario: { ...value.usuario, id: 18 }, session_context: 'B'.repeat(43) });
    if (failure) reject(new Error('old request failed')); else resolve(dto());
    await pending;
    assert.equal(events.at(-1).status, 'error'); assert.equal(events.at(-1).data, null);
    await loader.refresh(); assert.equal(calls, 1); loader.dispose();
  }
});

test('forged cookie DTO is never an accepted loader identity', async () => {
  const store = createBrowserSessionState();
  store.acceptBootstrap(store.beginBootstrap(), { usuario: { id: 8, usuario: 'synthetic', nombre: 'QA', rol: 'community' }, session_context: 'A'.repeat(43), csrf_token: 'C'.repeat(43) });
  const captured = { ...store.getSession() }, events = []; let calls = 0;
  const request = async () => { calls++; return dto(); };
  const loader = createEditorialPieceDetailLoader({ sesion: captured, piece: item(), readSession: () => store.getSession(), request, onChange: value => events.push(value) });
  await loader.refresh(); assert.equal(calls, 0); assert.equal(events.at(-1).status, 'error'); loader.dispose();
});

import { readFileSync } from 'node:fs';
import { parseEditorialPieceDetail, createEditorialPieceDetailLoader } from './editorialPieceDetail.js';
const session = () => ({ token: 'qa-token', usuario: { id: 8, rol: 'community', activo: true } });
const item = () => ({ domain: 'historia', id: 2, cliente: { id: 3, nombre: 'QA' }, titulo: 'QA', tipo: 'historia',
  estado: 'bloqueada', fecha_programada: '2026-10-19', publication_classification: 'no_publicada' });
const dto = () => ({ version: 1, piece: item(), content: { idea: null, copy: '', material_referencia: 'https://example.invalid/qa',
  aclaraciones: '  No recortar\n<script>literal</script>\n' + 'a'.repeat(6000) } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
test('closed detail keeps exact root text/nulls and rejects mismatched domain/ID/client without projecting bags', () => {
  const raw = dto(); raw.metadata = { salary: 123 }; raw.content.metadata = 'private'; raw.piece.cliente.salary = 789;
  const result = parseEditorialPieceDetail(raw, item());
  assert.equal(result.content.aclaraciones, raw.content.aclaraciones); assert.equal(result.content.idea, null);
  assert.equal(result.content.copy, ''); assert.doesNotMatch(JSON.stringify(result), /salary|metadata|private/);
  for (const patch of [{ domain: 'publicacion' }, { id: 3 }, { cliente: { id: 4, nombre: 'QA' } },
    { publication_classification: 'confirmada_manualmente' }, { fecha_programada: '2026-02-30' }, { tipo: 'wrong' }]) {
    const value = dto(); Object.assign(value.piece, patch); assert.throws(() => parseEditorialPieceDetail(value, item()));
  }
  for (const content of [null, {}, { ...dto().content, aclaraciones: {} }]) assert.throws(() => parseEditorialPieceDetail({ ...dto(), content }, item()));
});
test('detail reads a fixed domain/ID endpoint, no name filters or mutations, with abort and current session', async () => {
  const current = session(), states = [];
  const loader = createEditorialPieceDetailLoader({ sesion: current, piece: item(), readSession: () => current,
    onChange: state => states.push(state), request: async (url, options) => {
      assert.equal(url, '/api/editorial-control/historia/2'); assert.equal(options.method, 'GET');
      assert.ok(options.signal instanceof AbortSignal); assert.equal('body' in options, false); return dto(); } });
  await loader.refresh(); assert.equal(states.at(-1).data.content.aclaraciones, dto().content.aclaraciones);
  loader.dispose(); assert.equal(await loader.refresh(), false);
});
test('superseded success/failure, dispose and identity changes cannot expose stale notes', async () => {
  for (const failure of [false, true]) {
    const a = deferred(), b = deferred(), current = session(), states = []; let calls = 0;
    const loader = createEditorialPieceDetailLoader({ sesion: current, piece: item(), readSession: () => current,
      onChange: state => states.push(state), request: () => ++calls === 1 ? a.promise : b.promise });
    const first = loader.refresh(), second = loader.refresh(); b.resolve(dto()); await second; const size = states.length;
    failure ? a.reject(new Error('private')) : a.resolve(dto()); await first; assert.equal(states.length, size); loader.dispose();
  }
  for (const mode of ['dispose', 'session', 'role', 'active']) {
    let current = session(); const pending = deferred(), states = [], captured = current;
    const loader = createEditorialPieceDetailLoader({ sesion: captured, piece: item(), readSession: () => current,
      onChange: state => states.push(state), request: () => pending.promise });
    const run = loader.refresh();
    if (mode === 'dispose') loader.dispose();
    else if (mode === 'session') current = { ...session(), token: 'changed' };
    else current = { ...session(), usuario: { ...current.usuario, [mode === 'role' ? 'rol' : 'activo']: mode === 'role' ? 'qa_unknown' : false } };
    pending.resolve(dto()); await run; assert.ok(!states.at(-1).data); loader.dispose();
  }
});
test('detail failures clear data and redact diagnostics', async () => {
  const current = session(), states = []; let fail = false;
  const loader = createEditorialPieceDetailLoader({ sesion: current, piece: item(), readSession: () => current,
    onChange: state => states.push(state), request: async () => { if (fail) throw new Error('SQL private 999'); return dto(); } });
  await loader.refresh(); fail = true; await loader.refresh();
  assert.equal(states.at(-1).data, null); assert.doesNotMatch(states.at(-1).error, /SQL|999/); loader.dispose();
});
test('actual component lazy-loads details, renders text only and cleans up loader; principal mounts it', () => {
  const source = readFileSync(new URL('./EditorialPieceDetails.jsx', import.meta.url), 'utf8');
  assert.match(source, /const view = useSessionView\(sesion\)/);
  assert.match(source, /canReadEditorialControl\(view.session\)/);
  assert.match(source, /sesion: view.session/);
  assert.match(source, /\[id, domain, clientId, view\]/);
  assert.match(source, /if \(!open \|\| !allowed\) return undefined/);
  assert.match(source, /identityRef.current === identity/); assert.match(source, /loader.dispose\(\)/);
  assert.match(source, /current.data.content\[key\]/); assert.match(source, /<summary>Ver contenido y aclaraciones/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|localStorage|href=|window.open/);
  assert.match(readFileSync(new URL('./HomeEditorialControl.jsx', import.meta.url), 'utf8'), /<EditorialPieceDetails piece=\{item\} sesion=\{view.session\} request=\{request\}/);
});
