import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { notifyViewPreferenceChange } from '../shared/navigation/viewPreferenceEvent.js';
import * as model from './calendarModel.js';
import { createBrowserSessionState } from '../shared/session/browser-session-state.js';

const { CALENDAR_PAGE_LIMIT, MAX_CALENDAR_PAGE, readCalendarSelection, calendarHref, calendarQuery, calendarGrid, decodePagedCalendar, createCalendarLoader } = model;
const selection = readCalendarSelection('?mes=2026-10&dia=2026-10-19&scope=team&cliente=3', '2026-10-19');
const snapshot = `c1:${'a'.repeat(64)}`, nextSnapshot = `c1:${'b'.repeat(64)}`;
const event = (id, date = selection.dia) => ({ key: `tarea:tarea:${id}`, kind: 'tarea', source: 'tarea', source_id: id, date, title: `Task ${id}`,
  cliente_id: 3, cliente_nombre: 'Client', estado: 'pendiente', href: `/workspace/tareas?task=${id}`, responsable_ids: [4], evidence: null });
const sorted = rows => rows.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
function payload({ filters = selection, offset = 0, total = 401, token = snapshot, otherTotal = 2501 } = {}) {
  const candidates = sorted(Array.from({ length: total }, (_, i) => event(i + 1, filters.dia)));
  const events = candidates.slice(offset, offset + 200);
  const other = filters.dia === '2026-10-20' ? '2026-10-21' : '2026-10-20';
  const days = [
    ...(total ? [{ date: filters.dia, total, preview: candidates.slice(0, 2).map(row => ({ ...row })) }] : []),
    ...(otherTotal ? [{ date: other, total: otherTotal, preview: [event(10000, other), ...(otherTotal > 1 ? [event(10001, other)] : [])] }] : []),
  ].sort((a, b) => a.date < b.date ? -1 : 1);
  const grid = calendarGrid(filters.mes);
  return { range: { desde: grid.desde, hasta: grid.hasta }, scope: filters.scope, kind: filters.tipo, timezone: 'America/Argentina/Cordoba', clients: [{ id: 3, nombre: 'Client' }],
    events, truncated: events.length < total,
    pagination: { version: 1, limit: 200, offset, total, has_more: offset + events.length < total, snapshot: token, day: filters.dia, days } };
}
const legacySession = () => ({ token: 'synthetic-calendar', usuario: { id: 4, rol: 'admin', activo: true } });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const params = url => new URL(url, 'https://render.test').searchParams;

function monthlyPublicationPayload(filters) {
  const raw=payload({filters,total:2,otherTotal:1});
  const convert=row=>({...row,key:`programacion:publicacion:${row.source_id}`,kind:'programacion',source:'publicacion',title:`Programación editorial · Reel #${row.source_id}`,href:'/planificacion-publicaciones?tab=calendario&cliente=3&mes=2026-10'});
  raw.pagination.days=raw.pagination.days.map(day=>({...day,preview:day.preview.map(convert)}));
  raw.events=raw.pagination.days.flatMap(day=>day.preview);raw.pagination.day=null;raw.pagination.total=3;raw.pagination.has_more=false;raw.truncated=false;
  return raw;
}
test('renewal exposes a bounded display-only preview but still performs a fresh authenticated read',async()=>{
  const filters={...selection,vista:'publicaciones'},current=legacySession(),held=deferred();let time=0,calls=0;
  const loader=createCalendarLoader({monthly:true,sesion:current,readSession:()=>current,now:()=>time,request:async()=>++calls===1?monthlyPublicationPayload(filters):held.promise});
  await loader.load(filters);time=16000;
  assert.equal(loader.peek(filters).pagination.total,2);
  assert.equal(loader.peek({...filters,cliente:'99'}).pagination.total,0);
  assert.equal(loader.peek({...filters,mes:'2026-11',dia:'2026-11-01'}),undefined);
  const renewing=loader.load(filters);await settle();assert.equal(calls,2);
  assert.equal(loader.peek(filters).pagination.snapshot,snapshot);
  const next=monthlyPublicationPayload(filters);next.pagination.snapshot=nextSnapshot;held.resolve(next);
  assert.equal((await renewing).pagination.snapshot,nextSnapshot);
  assert.equal(loader.peek(filters).pagination.snapshot,nextSnapshot);
  time=150000;assert.equal(loader.peek(filters),undefined);loader.dispose();assert.equal(loader.peek(filters),undefined);
});
test('a failed renewal clears its display-only preview rather than claiming success',async()=>{
  const filters={...selection,vista:'publicaciones'},current=legacySession();let time=0,calls=0;
  const loader=createCalendarLoader({monthly:true,sesion:current,readSession:()=>current,now:()=>time,request:async()=>{if(++calls===1)return monthlyPublicationPayload(filters);throw Error('offline');}});
  await loader.load(filters);time=16000;assert.ok(loader.peek(filters));await assert.rejects(loader.load(filters));assert.equal(loader.peek(filters),undefined);loader.dispose();
});
test('session invalidation during peek cannot be overwritten by a loading repaint',()=>{
  const source=readFileSync(new URL('./Calendar.jsx',import.meta.url),'utf8');
  const file=ts.createSourceFile('Calendar.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  let effect;const walk=node=>{if(ts.isCallExpression(node)&&node.expression.getText(file)==='useEffect'&&node.arguments[0]?.getText(file).includes('const preview=loader.current'))effect=node.arguments[0];ts.forEachChild(node,walk);};walk(file);assert.ok(effect);
  const generation={current:0},paints=[];
  const deps={generation,requestObservation:{current:{}},lastRetry:{current:0},retry:0,selection:{},
    loader:{current:{peek(){generation.current++;paints.push('invalidated');},load(){assert.fail('must not fetch after invalidation');}}},setResult(){assert.fail('must not overwrite session error');}};
  Function(...Object.keys(deps),`return (${effect.getText(file)});`)(...Object.values(deps))();assert.deepEqual(paints,['invalidated']);
});
test('complete monthly mode switches clients and days without repeating requests and still expires',async()=>{
  const filters={...selection,vista:'publicaciones'},current=legacySession();let calls=0,time=0;
  const loader=createCalendarLoader({monthly:true,sesion:current,readSession:()=>current,now:()=>time,request:async url=>{calls++;assert.equal(params(url).has('dia'),false);assert.equal(params(url).has('cliente_id'),false);return monthlyPublicationPayload(filters);}});
  const a=await loader.load(filters);assert.equal(a.events.length,2);
  const b=await loader.load({...filters,cliente:'4'});assert.equal(b.events.length,0);assert.equal(b.pagination.days.length,0);
  const c=await loader.load({...filters,cliente:'',dia:'2026-10-20'});assert.equal(c.events.length,1);assert.equal(c.pagination.total,1);assert.equal(calls,1);
  const d=await loader.load({...filters,formato:'carrusel'});assert.equal(d.events.length,0);assert.equal(calls,1);
  time=15000;await loader.load(filters);assert.equal(calls,2);await loader.load(filters,{refresh:true});assert.equal(calls,3);loader.dispose();
});
test('month decoder rejects missing events, dishonest counts and previews; session change cannot reuse a full month',async()=>{
  const filters={...selection,vista:'publicaciones'};
  for(const mutate of [raw=>raw.events.pop(),raw=>raw.pagination.days[0].total++,raw=>raw.pagination.days[0].preview.pop()]){const raw=monthlyPublicationPayload(filters);mutate(raw);assert.throws(()=>model.decodeCalendarMonth(raw,filters));}
  let live=legacySession();const original=live;
  const loader=createCalendarLoader({monthly:true,sesion:original,readSession:()=>live,request:async()=>monthlyPublicationPayload(filters)});
  await loader.load(filters);live={...live,usuario:{...live.usuario,id:99}};await assert.rejects(loader.load(filters),/sesión cambió/);loader.dispose();
});
test('oversized monthly result falls back to real paged day reads without fetching the oversized month again',async()=>{
  const filters={...selection,vista:'publicaciones'};let calls=[];const current=legacySession();
  const convert=row=>({...row,key:`programacion:publicacion:${row.source_id}`,kind:'programacion',source:'publicacion',title:`Programación editorial · Reel #${row.source_id}`,href:'/planificacion-publicaciones?tab=calendario&cliente=3&mes=2026-10'});
  const loader=createCalendarLoader({monthly:true,sesion:current,readSession:()=>current,request:async url=>{
    const p=params(url);calls.push(p.has('dia'));
    const raw=payload({filters,total:401});raw.events=raw.events.map(convert);raw.pagination.days=raw.pagination.days.map(day=>({...day,preview:day.preview.map(convert)}));
    if(!p.has('dia')){raw.pagination.day=null;raw.pagination.total=2902;}
    return raw;
  }});
  const first=await loader.load(filters);assert.equal(first.pagination.total,401);assert.equal(first.events.length,200);assert.equal(first.pagination.has_more,true);assert.deepEqual(calls,[false,true]);
  await loader.load({...filters,formato:'reel'});assert.deepEqual(calls,[false,true,true]);loader.dispose();
});

test('publication day switching reuses complete previews and remembered days, with expiry and explicit refresh',async()=>{
  const filters={...selection,vista:'publicaciones'},current=legacySession();let time=0,calls=0;
  const loader=createCalendarLoader({sesion:current,readSession:()=>current,now:()=>time,request:async()=>{
    calls++;
    const raw=payload({filters,total:2,otherTotal:1});
    const convert=row=>({...row,key:`programacion:publicacion:${row.source_id}`,kind:'programacion',source:'publicacion',title:`Programación editorial · Reel #${row.source_id}`,href:'/planificacion-publicaciones?tab=calendario&cliente=3&mes=2026-10'});
    raw.events=raw.events.map(convert);raw.pagination.days=raw.pagination.days.map(day=>({...day,preview:day.preview.map(convert)}));
    return raw;
  }});
  await loader.load(filters);assert.equal(calls,1);
  assert.equal((await loader.load({...filters,dia:'2026-10-20'})).events.length,1);assert.equal(calls,1);
  assert.equal((await loader.load({...filters,dia:'2026-10-21'})).events.length,0);assert.equal(calls,1);
  await loader.load(filters);assert.equal(calls,1);
  time=15000;await loader.load(filters);assert.equal(calls,2);
  await loader.load(filters,{refresh:true});assert.equal(calls,3);loader.dispose();
});

test('pagina URL is canonical safe offset, reload/Back round-trip all context, malformed aliases normalize zero', () => {
  for (const pagina of [0, 1, 2, MAX_CALENDAR_PAGE]) {
    const value = { ...selection, pagina }; assert.deepEqual(readCalendarSelection(params(calendarHref(value)).toString()), value);
    assert.equal(params(calendarQuery(value)).get('offset'), String(pagina * 200));
  }
  for (const query of ['pagina=-1', 'pagina=01', 'pagina=1.0', 'pagina=1e2', 'pagina=%201', 'pagina=1%0A', `pagina=${MAX_CALENDAR_PAGE + 1}`, 'pagina=1&pagina=2', 'pagina[]=1', 'pagina=2&pagina[x]=1']) {
    assert.equal(readCalendarSelection(`?mes=2026-10&${query}`, '2026-10-19').pagina, 0, query);
  }
  assert.equal(model.shiftCalendarMonth({ ...selection, pagina: 9 }, 1).pagina, 0);
  const p = params(calendarQuery({ ...selection, pagina: 1 }, { snapshot }));
  assert.equal(p.get('dia'), selection.dia); assert.equal(p.get('limit'), '200'); assert.equal(p.get('expected_snapshot'), snapshot);
});
test('paged decoder demands exact page/count/day/snapshot metadata and closes all events/previews', () => {
  const raw = payload(); raw.events[0].private = 'secret'; raw.pagination.days[0].private = 'secret'; raw.clients[0].private = 'secret';
  const decoded = decodePagedCalendar(raw, selection);
  assert.equal(decoded.events.length, 200); assert.equal(decoded.pagination.days[1].total, 2501); assert.equal(decoded.pagination.days[1].preview.length, 2);
  assert.doesNotMatch(JSON.stringify(decoded), /secret|private/);
  const legacy = payload(); delete legacy.pagination; assert.throws(() => decodePagedCalendar(legacy, selection));
  for (const patch of [{ version: 2 }, { limit: 500 }, { offset: 200 }, { total: -1 }, { total: 201.5 }, { total: Number.MAX_SAFE_INTEGER + 1 }, { has_more: false }, { day: null }, { day: '2026-10-20' }, { snapshot: `${snapshot}\n` }, { snapshot: `c1:${'A'.repeat(64)}` }]) {
    const bad = payload(); Object.assign(bad.pagination, patch); assert.throws(() => decodePagedCalendar(bad, selection), JSON.stringify(patch));
  }
  assert.throws(() => decodePagedCalendar(payload(), selection, { snapshot: nextSnapshot }));
});
test('day summaries are full-range sorted nonzero, accurate totals and at most two fully validated previews', () => {
  for (const mutate of [
    raw => raw.pagination.days.reverse(), raw => raw.pagination.days.push(raw.pagination.days[0]),
    raw => raw.pagination.days[0].total = 0, raw => raw.pagination.days[0].total++,
    raw => raw.pagination.days[1].date = '2026-12-01', raw => raw.pagination.days[1].preview.pop(),
    raw => raw.pagination.days[1].preview.push(event(10002, '2026-10-20')),
    raw => raw.pagination.days[0].preview[0].href = '//evil.test',
    raw => raw.pagination.days[0].preview[0].date = '2026-10-20',
    raw => raw.pagination.days[0].preview[0].title = 'Mismatching first-page preview',
    raw => raw.events.reverse(), raw => raw.events.pop(), raw => raw.truncated = false,
    raw => raw.events[0].date = '2026-10-20',
  ]) { const raw = payload(); mutate(raw); assert.throws(() => decodePagedCalendar(raw, selection)); }
});
test('publication previews require real manual evidence just like agenda events, never legacy state/date', () => {
  const raw = payload(), item = raw.pagination.days[1].preview[0];
  Object.assign(item, { kind: 'publicacion', source: 'historia', key: `publicacion:historia:${item.source_id}`, estado: 'publicada',
    href: '/planificacion-historias?vista=checklist&cliente=3&mes=2026-10', evidence: null });
  assert.throws(() => decodePagedCalendar(raw, selection));
});
test('empty selected day and beyond-end page retain honest totals and full-range days', () => {
  const empty = decodePagedCalendar(payload({ total: 0 }), selection); assert.equal(empty.events.length, 0); assert.equal(empty.pagination.days[0].total, 2501); assert.equal(empty.truncated, false);
  const later = { ...selection, pagina: 3 }, data = decodePagedCalendar(payload({ offset: 600 }), later);
  assert.equal(data.events.length, 0); assert.equal(data.pagination.total, 401); assert.equal(data.truncated, true); assert.equal(data.pagination.has_more, false);
});
test('reload later page bootstraps snapshot at zero then requested page; navigation reuses anchor and manual refresh replaces it', async () => {
  const calls = [], current = legacySession();
  const loader = createCalendarLoader({ sesion: current, readSession: () => current, request: async (url, options) => {
    calls.push({ p: params(url), options }); assert.equal(options.method, 'GET'); assert.equal(options.cache, 'no-store');
    return payload({ offset: Number(params(url).get('offset')) });
  } });
  const later = { ...selection, pagina: 1 }; assert.equal((await loader.load(later)).pagination.offset, 200);
  assert.deepEqual(calls.map(c => [c.p.get('offset'), c.p.get('expected_snapshot')]), [['0', null], ['200', snapshot]]);
  loader.cancel(); await loader.load({ ...selection, pagina: 2 }); assert.equal(calls.length, 3); assert.equal(calls[2].p.get('expected_snapshot'), snapshot);
  await loader.load(later, { refresh: true }); assert.deepEqual(calls.slice(3).map(c => [c.p.get('offset'), c.p.get('expected_snapshot')]), [['0', null], ['200', snapshot]]);
  loader.dispose();
});
test('409 drops anchor, emits bounded explicit-refresh error and never automatically retries', async () => {
  const calls = [], current = legacySession(); let conflict = true;
  const loader = createCalendarLoader({ sesion: current, readSession: () => current, request: async url => {
    const p = params(url); calls.push(p);
    if (p.get('offset') !== '0' && conflict) throw Object.assign(Error('private database text'), { status: 409 });
    return payload({ offset: Number(p.get('offset')), token: conflict ? snapshot : nextSnapshot });
  } });
  const later = { ...selection, pagina: 1 };
  await assert.rejects(loader.load(later), error => /calendario cambió.*explícitamente/i.test(error.message) && !error.message.includes('private'));
  await settle(); assert.equal(calls.length, 2);
  conflict = false; const result = await loader.load(later); assert.equal(result.pagination.snapshot, nextSnapshot);
  assert.deepEqual(calls.slice(2).map(p => [p.get('offset'), p.get('expected_snapshot')]), [['0', null], ['200', nextSnapshot]]); loader.dispose();
});
test('anchor never crosses day/filter changes, and failed/legacy bootstrap never dispatches second page', async () => {
  const current = legacySession();
  for (const failure of ['legacy', 'malformed', 'transport']) {
    let count = 0; const loader = createCalendarLoader({ sesion: current, readSession: () => current, request: async () => {
      count++; if (failure === 'transport') throw Error('offline'); const raw = payload(); if (failure === 'legacy') delete raw.pagination; else raw.pagination.snapshot = 'bad'; return raw;
    } });
    await assert.rejects(loader.load({ ...selection, pagina: 1 })); assert.equal(count, 1); loader.dispose();
  }
  const calls = [], loader = createCalendarLoader({ sesion: current, readSession: () => current, request: async url => {
    const p = params(url); calls.push(p); const filters = { ...selection, dia: p.get('dia'), scope: p.get('scope') };
    return payload({ filters, offset: Number(p.get('offset')) });
  } });
  await loader.load(selection); await loader.load({ ...selection, dia: '2026-10-20', pagina: 1 });
  await loader.load({ ...selection, scope: 'mine', pagina: 1 });
  assert.deepEqual(calls.map(p => p.get('offset')), ['0', '0', '200', '0', '200']); loader.dispose();
});
test('superseding bootstraps, cancellation, identity change and cookie epochs fence both requests', async () => {
  for (const change of ['supersede', 'cancel', 'dispose', 'identity']) {
    let current = legacySession(); const first = deferred(), calls = [];
    const loader = createCalendarLoader({ sesion: current, readSession: () => current, request: url => { calls.push(url); return calls.length === 1 ? first.promise : Promise.resolve(payload()); } });
    const pending = loader.load({ ...selection, pagina: 1 });
    if (change === 'supersede') await loader.load(selection); else if (change === 'identity') current = { ...current, token: 'replaced' }; else loader[change]();
    first.resolve(payload()); assert.equal(await pending, undefined); assert.equal(calls.length, change === 'supersede' ? 2 : 1); loader.dispose();
  }
  const store = createBrowserSessionState(); const accept = () => store.acceptBootstrap(store.beginBootstrap(), { usuario: { id: 4, rol: 'admin', usuario: 'QA', nombre: 'QA' }, session_context: 'a'.repeat(43), csrf_token: 'b'.repeat(43) });
  accept(); const original = store.getSession(), held = deferred(), calls = [];
  const loader = createCalendarLoader({ sesion: original, readSession: () => store.getSession(), request: (url, options) => {
    calls.push({ url, options }); return calls.length === 1 ? Promise.resolve(payload()) : held.promise;
  } });
  const pending = loader.load({ ...selection, pagina: 1 }); await settle(); assert.equal(calls.length, 2);
  assert.equal(calls[1].options.sessionIntent.session, original); assert.equal(new Headers(calls[1].options.headers).has('Authorization'), false);
  accept(); held.resolve(payload({ offset: 200 })); assert.equal(await pending, undefined); assert.equal(calls.length, 2); loader.dispose();
});

const source = readFileSync(new URL('./Calendar.jsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('Calendar.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const owner = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'CalendarContent');
const nodes = (root, predicate) => { const out = []; const visit = n => { if (predicate(n)) out.push(n); ts.forEachChild(n, visit); }; visit(root); return out; };
const text = n => n.getText(ast);
const evaluate = (n, deps) => new Function(...Object.keys(deps), `return (${text(n)});`)(...Object.values(deps));
test('actual UI callback resets page on filter/day/month changes but preserves context on page navigation', () => {
  const change = nodes(owner, n => ts.isFunctionDeclaration(n) && n.name?.text === 'change')[0];
  for (const fields of [{ mes: '2026-11', dia: '2026-11-01' }, { dia: '2026-10-20' }, { dia: selection.dia }, { cliente: '4' }, { pagina: 3 }]) {
    const calls = [], current = { ...selection, pagina: 2 };
    evaluate(change, { notifyViewPreferenceChange, selection: current, today: selection.dia, readCalendarSelection, calendarHref, window: { location: { origin: 'https://render.test' } }, navigateWithinApp: (win, href) => calls.push(href) })(fields);
    const next = readCalendarSelection(params(calls[0]).toString()); assert.equal(next.pagina, Object.hasOwn(fields, 'pagina') ? 3 : 0);
    assert.equal(next.cliente, fields.cliente ?? current.cliente); assert.equal(next.scope, fields.scope ?? current.scope);
  }
});
test('actual request effect marks manual retry fresh and rejects completions before passive cleanup', async () => {
  const effect = nodes(owner, n => ts.isCallExpression(n) && text(n.expression) === 'useEffect').find(n => text(n.arguments[0]).includes('loader.current?.load'));
  for (const retry of [0, 1]) for (const replacement of ['different-key', 'same-key-ABA']) {
    const pending = deferred(), results = [], loads = [], deps = { selection: { ...selection, pagina: 1 }, retry, requestKey: 'owned',
      generation: { current: 0 }, lastRetry: { current: 0 }, requestObservation: { current: { key: 'owned', retry } },
      setResult: value => results.push(value), loader: { current: { load: (s, options) => { loads.push(options); return pending.promise; }, cancel() {} } } };
    const cleanup = evaluate(effect.arguments[0], deps)(); assert.deepEqual(loads, [{ refresh: retry === 1 }]);
    deps.requestObservation.current = { key: replacement === 'same-key-ABA' ? 'owned' : 'new-day', retry };
    pending.resolve(payload()); await settle(); assert.equal(results.length, 1); cleanup();
  }
});
test('actual popstate restores pagina and filters without writing history', () => {
  const effect = nodes(owner, n => ts.isCallExpression(n) && text(n.expression) === 'useEffect').find(n => text(n.arguments[0]).includes("addEventListener('popstate'"));
  const listeners = new Map(), restored = [], window = { location: { search: params(calendarHref({ ...selection, pagina: 2 })).toString() },
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name, fn) => { assert.equal(listeners.get(name), fn); listeners.delete(name); } };
  const cleanup = evaluate(effect.arguments[0], { window, readCalendarSelection, setSelection: value => restored.push(value) })(); listeners.get('popstate')();
  assert.deepEqual(restored, [{ ...selection, pagina: 2 }]); cleanup(); assert.equal(listeners.size, 0);
});
function renderCalendar(data, filters = selection, status = 'ready', obsolete = false) {
  let index = 0, refIndex = 0; const requestKey = calendarQuery(filters), observation = { key: requestKey, retry: 0 }, values = [filters, { key: requestKey, attempt: 0, observation: obsolete ? { ...observation } : observation, status, data, error: "Read unavailable" }, 0, true];
  const compiled = ts.transpileModule(text(owner), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const deps = { React, Modal: ({children}) => React.createElement("div",null,children), ...model, dateLabel: day => day, eventCount: count => `${count} eventos`,
    useState: () => [values[index++], () => {}], useRef: value => ({ current: refIndex++ === 3 ? observation : value }), useEffect: () => {},
    FilterSelect: ({ label, children, ...props }) => React.createElement('label', null, label, React.createElement('select', props, children)) };
  const component = new Function(...Object.keys(deps), `${compiled}; return CalendarContent;`)(...Object.values(deps));
  return renderToStaticMarkup(React.createElement(component, { sesion: legacySession() }));
}
test('actual SSR month counts/previews are not page-limited; agenda/pager and beyond-end recovery are honest', () => {
  const later = { ...selection, pagina: 1 }, data = decodePagedCalendar(payload({ offset: 200 }), later);
  const html = renderCalendar(data, later); assert.match(html, /2501 eventos/); assert.doesNotMatch(html, /Task 10000/); assert.match(html, /401 eventos/); assert.match(html, /Página 2/);
  const beyond = { ...selection, pagina: 3 }, empty = renderCalendar(decodePagedCalendar(payload({ offset: 600 }), beyond), beyond);
  assert.match(empty, /fuera de los resultados/); assert.match(empty, /Primera página/); assert.doesNotMatch(empty, /Sin eventos para este día/);
  for (const status of ['loading', 'error']) { const unavailable = renderCalendar(null, selection, status); assert.doesNotMatch(unavailable, /0 eventos|Sin eventos para este día|2501 eventos/); }
  const aba = renderCalendar(data, later, 'ready', true); assert.match(aba, /Cargando calendario/); assert.doesNotMatch(aba, /2501 eventos|Task 10000|401 eventos/);
});
test('2107-event day exposes full grid count, 200-event agenda and usable pager before large card list', () => {
  const data = decodePagedCalendar(payload({ total: 2107 }), selection), html = renderCalendar(data);
  assert.match(html, /2107 eventos/);
  assert.match(html, /aria-label="2026-10-19 · 2107 eventos"/);
  assert.doesNotMatch(html, /Task 10000/); assert.match(html, /2501 eventos/);
  assert.equal((html.match(/<h3>/g) || []).length, 200);
  assert.ok(html.indexOf('aria-label="Páginas de agenda"') < html.indexOf('<ol>'), 'Pager must precede all 200 agenda cards');
  assert.match(html, /Página 1/); assert.match(html, />Siguiente<\/button>/);
});
