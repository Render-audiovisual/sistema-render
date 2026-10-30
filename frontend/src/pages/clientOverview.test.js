import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClientOverviewLoader } from "./clientOverview.js";
import { createCapturedRequest } from '../shared/session/captured-request.js';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as clientStats from '../clientesStats.js';
import { instagramMonthlyGroupObservation } from '../../../shared/instagram-monthly-observation.mjs';

const monthlySource = readFileSync(new URL('./Clientes.jsx', import.meta.url), 'utf8');
const monthlyTree = ts.createSourceFile('Clientes.jsx', monthlySource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const monthlyFunctions = ['clientMonthlyProgressRows', 'ClientMonthlyFormatBar', 'ClientMonthlyProgressList'];
const monthlyDeclarations = monthlyTree.statements.filter(node => ts.isFunctionDeclaration(node) && monthlyFunctions.includes(node.name?.text));
assert.equal(monthlyDeclarations.length, 3);
const monthlyCode = ts.transpileModule(monthlyDeclarations.map(node => node.getText(monthlyTree).replace(/^export\s+/, '')).join('\n'),
  { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
const monthly = Function('React', 'instagramMonthlyGroupObservation', ...Object.keys(clientStats), `${monthlyCode};return {${monthlyFunctions.join(',')}};`)(React, instagramMonthlyGroupObservation, ...Object.values(clientStats));
const monthClient = { id: 1, nombre: 'Cliente QA', activo: true, cuota_reels: 4, cuota_carruseles: 2 };
const monthPiece = (id, extra = {}) => ({ id, cliente_id: 1, tipo: 'reel', estado: 'publicada', fecha_programada: '2026-10-05', ...extra });
test('client cards offer named edit actions only when authorized by the parent and display stored logos',()=>{
 const props={clients:[{...monthClient,logo:'data:image/png;base64,QA'}],publicaciones:[],period:'2026-10'};
 const plain=renderToStaticMarkup(React.createElement(monthly.ClientMonthlyProgressList,props));
 assert.doesNotMatch(plain,/client-card-edit/);assert.match(plain,/<img/);
 const editable=renderToStaticMarkup(React.createElement(monthly.ClientMonthlyProgressList,{...props,onEdit:()=>{}}));
 assert.match(editable,/aria-label="Editar Cliente QA"/);
});
function observation(clientId=1, posts=[]) {
  return {version:1,period:'2026-10',clientId,handle:'public_test',totalPosts:posts.length,checkedAt:'2026-10-29T15:00:00Z',boundaryVerified:true,posts,
    boundary:[1,2,3].map(id=>({url:`https://www.instagram.com/p/Before${id}/`,publishedAt:'2026-09-30T15:00:00Z'}))};
}
test('observed zero replaces history; absent, invalid or other-month evidence preserves history', () => {
  for (const snapshot of [undefined, {...observation(),period:'2026-09'}, {...observation(),boundaryVerified:false}]) {
    const [row] = monthly.clientMonthlyProgressRows([{...monthClient,instagram_monthly_observation:snapshot}], [monthPiece(1)], '2026-10');
    assert.equal(row.reels.historicalCount,1); assert.equal(row.observation,null);
  }
  const client = {...monthClient,instagram_monthly_observation:observation()};
  const [row] = monthly.clientMonthlyProgressRows([client], [monthPiece(1),confirmedMonthPiece(2)], '2026-10');
  assert.deepEqual(row.reels,{count:0,historicalCount:0,quota:4}); assert.equal(row.noActivity,true);
  const html = renderToStaticMarkup(React.createElement(monthly.ClientMonthlyProgressList,{clients:[client],publicaciones:[monthPiece(1)],period:'2026-10'}));
  assert.match(html,/0 \/ 4/); assert.match(html,/0 \/ 2/); assert.doesNotMatch(html,/Verificado|Faltan/);
  assert.doesNotMatch(html,/0 confirmadas|API/);
});
test('shared evidence requires all members and unions collab shortcodes with one quota', () => {
  const post = {url:'https://www.instagram.com/reel/Collab1/',kind:'reel',publishedAt:'2026-10-05T15:00:00Z'};
  const clients = [1,2].map(id=>({...monthClient,id,grupo_feed_id:9,cuota_feed_reels:8,cuota_feed_carruseles:3,instagram_monthly_observation:observation(id,[post])}));
  const rows = monthly.clientMonthlyProgressRows(clients,[monthPiece(1)],'2026-10');
  assert.equal(rows.length,1); assert.deepEqual(rows[0].reels,{count:1,historicalCount:0,quota:8});
  clients[1].instagram_monthly_observation=undefined;
  assert.equal(monthly.clientMonthlyProgressRows(clients,[monthPiece(1)],'2026-10')[0].observation,null);
});
test('owner attribution displays Render 3/4 reels and 1/2 carousels, keeping profile totals separate',()=>{
 const posts=Array.from({length:11},(_,i)=>({url:`https://www.instagram.com/reel/Video${i}/`,kind:'reel',publishedAt:'2026-10-05T15:00:00Z'}));
 posts.push({url:'https://www.instagram.com/p/Carousel1/',kind:'carrusel',publishedAt:'2026-10-08T15:00:00Z'});
 const snapshot={...observation(1,posts),agencyAttribution:{source:'owner_confirmation',confirmedAt:'2026-10-30T01:00:00Z',reels:3,carruseles:1,carouselUrls:['https://www.instagram.com/p/Carousel1/']}};
 const html=renderToStaticMarkup(React.createElement(monthly.ClientMonthlyProgressList,{clients:[{...monthClient,instagram_monthly_observation:snapshot}],publicaciones:[],period:'2026-10'}));
 assert.doesNotMatch(html,/Hecho por Render|confirmado por dirección|Faltan|Total del perfil|verificadas/);
 assert.match(html,/3 \/ 4/);assert.match(html,/1 \/ 2/);
});
function confirmedMonthPiece(id, extra = {}) {
  return monthPiece(id, { 'fecha_publicación_real': '2026-11-01T12:00:00Z', publicacion_evidencia: {
    classification: 'confirmada_manualmente', revision: 1,
    confirmation: { id: '12345678-1234-4234-8234-123456789abc', actor_id: 7, source: 'manual',
      occurred_at: '2026-11-01T12:00:00Z', recorded_at: '2026-11-01T12:01:00Z' },
  }, ...extra });
}

test('monthly rows keep historical and confirmed progression disjoint, deduplicated and in planned month', () => {
  const historical = monthPiece(1), confirmed = confirmedMonthPiece(2);
  const pieces = [historical, historical, confirmed, monthPiece(3, { fecha_programada: '2026-09-05' }),
    monthPiece(4, { estado: 'pendiente' }), monthPiece(5, { tipo: 'carrusel' })];
  const before = JSON.stringify(pieces);
  const [row] = monthly.clientMonthlyProgressRows([monthClient], pieces, '2026-10');
  assert.deepEqual(row.reels, { count: 1, historicalCount: 1, quota: 4 });
  assert.deepEqual(row.carruseles, { count: 0, historicalCount: 1, quota: 2 });
  assert.equal(row.noActivity, false);
  assert.equal(JSON.stringify(pieces), before);
  const [transition] = monthly.clientMonthlyProgressRows([monthClient], [confirmedMonthPiece(1)], '2026-10');
  assert.equal(transition.reels.count, 1); assert.equal(transition.reels.historicalCount, 0);
});

test('shared feed quota and historical progress appear once, with no task-derived or empty-history credit', () => {
  const clients = [1, 2].map(id => ({ ...monthClient, id, nombre: `Cuenta ${id}`, grupo_feed_id: 9,
    grupo_feed_nombre: 'Lavalle QA', cuota_feed_reels: 8, cuota_feed_carruseles: 3 }));
  const rows = monthly.clientMonthlyProgressRows(clients, [monthPiece(1), monthPiece(2, { cliente_id: 2 })], '2026-10');
  assert.equal(rows.length, 1); assert.deepEqual(rows[0].clientIds, [1, 2]);
  assert.deepEqual(rows[0].reels, { count: 0, historicalCount: 2, quota: 8 });
  const [empty] = monthly.clientMonthlyProgressRows(clients, [], '2026-10');
  assert.equal(empty.noActivity, true); assert.equal(empty.reels.count + empty.reels.historicalCount, 0);
});

test('client cards show only two registered-content bars without claiming confirmed publication', () => {
  const html = renderToStaticMarkup(React.createElement(monthly.ClientMonthlyProgressList,
    { clients: [monthClient], publicaciones: [monthPiece(1)], period: '2026-10' }));
  assert.doesNotMatch(html, /Registradas en historial|client-monthly-history-track/); assert.match(html, /1 \/ 4/);
  assert.doesNotMatch(html, /Las demás muestran|verificad|Faltan/); assert.match(html, /client-monthly-avatar/);
  assert.equal((html.match(/role="progressbar"/g)||[]).length,2);
  const over = renderToStaticMarkup(React.createElement(monthly.ClientMonthlyFormatBar,
    { label: 'Reels', count: 5, historicalCount: 7, quota: 4 }));
  assert.match(over, /12 \/ 4/); assert.doesNotMatch(over, /confirmadas|históricas/);
  assert.equal((over.match(/width:100%/g) || []).length, 1);
  const noQuota = renderToStaticMarkup(React.createElement(monthly.ClientMonthlyFormatBar,
    { label: 'Reels', count: 0, historicalCount: 7, quota: 0 }));
  assert.match(noQuota, /aria-disabled="true"/); assert.match(noQuota, /Reels: no incluido/); assert.doesNotMatch(noQuota, /sin cuota configurada|role="progressbar"|aria-valuemax|7 \/ 0/);
  const css = readFileSync(new URL('./ClientesProgress.css', import.meta.url), 'utf8');
  assert.match(css, /\.client-monthly-list \.client-monthly-history-track>span\{background:repeating-linear-gradient/);
});

// Canonical parsed requests and real captured-session binding, no mounted UI/DB.
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function transport() {
  const calls = [];
  let live = { token: 'qa-client-overview', usuario: { id: 7, nombre: 'QA owner', rol: 'admin' } };
  const request = (url, options) => {
    const pending = deferred();
    calls.push({ ...pending, url, options });
    return pending.promise; // Deliberately ignores AbortSignal.
  };
  const capture = () => createCapturedRequest({ session: live, readSession: () => live, request });
  return { calls, loader: createClientOverviewLoader(capture), switchSession() { live = { ...live, token: 'qa-other', usuario: { ...live.usuario, id: 8 } }; } };
}
function respond(call, data = [], { ok = true, body } = {}) {
  if (!ok) call.reject(Object.assign(new Error('Canonical HTTP failure'), { status: 500 }));
  else call.resolve(body ? body.promise : data);
}
function finish(calls, offset, prefix) {
  const values = [[{ id: `${prefix}-cliente` }], [{ id: `${prefix}-historia` }], [{ id: `${prefix}-publicacion` }]];
  values.forEach((value, index) => respond(calls[offset + index], value));
  return { clientes: values[0], historias: values[1], publicaciones: values[2] };
}
async function boundedRejection(promise) {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof Error);
    assert.ok(typeof error.message === "string" && error.message.length > 0 && error.message.length <= 240, "Current loader errors must be bounded");
    return true;
  });
}
async function microtasks() { for (let index = 0; index < 5; index++) await Promise.resolve(); }

test("valid boundary periods fetch exactly the three editorial resources with one shared signal and no tasks", async () => {
  const { calls, loader } = transport();
  for (const period of ["1000-01", "2026-10", "9999-12"]) {
    const offset = calls.length, result = loader.load(period), batch = calls.slice(offset);
    assert.deepEqual(batch.map(call => call.url), [`/api/clientes?periodo=${period}`, "/api/historias", "/api/publicaciones"]);
    assert.equal(batch[0].options.signal, batch[1].options.signal);
    assert.equal(batch[0].options.signal, batch[2].options.signal);
    assert.equal(batch[0].options.signal.aborted, false);
    for (const call of batch) assert.equal(call.options.method, undefined, "Default GET, never mutation");
    const expected = finish(calls, offset, period);
    assert.deepEqual(await result, expected);
  }
  assert.equal(calls.some(call => /tareas/.test(call.url)), false);
  loader.cancel();
});

test("invalid periods reject before new fetch: exact YYYY-MM, years1000..9999 and months01..12 only", async () => {
  const { calls, loader } = transport();
  for (const value of [undefined, null, 202610, {}, [], "", " ", "0999-12", "0000-01", "10000-01", "2026-00", "2026-13", "2026-1", "26-10", "2026-10-01", " 2026-10", "2026-10 ", "2026-10\n", "2026-10?otro=1"]) {
    await boundedRejection(loader.load(value));
    assert.equal(calls.length, 0);
  }
});

test("invalid new period still aborts and invalidates an older pending load before rejecting, without new requests", async () => {
  for (const staleFailure of [false, true]) {
    const { calls, loader } = transport();
    const old = loader.load("2026-10");
    await boundedRejection(loader.load("2026-13"));
    assert.equal(calls.length, 3);
    assert.ok(calls.every(call => call.options.signal.aborted));
    if (staleFailure) {
      calls[0].reject(new Error("obsolete transport failure"));
      respond(calls[1]); respond(calls[2]);
    } else finish(calls, 0, "obsolete");
    assert.equal(await old, undefined);
  }
});

test("out-of-order periods only resolve the current bundle even when old fetch ignores abort", async () => {
  const { calls, loader } = transport();
  const october = loader.load("2026-10"), november = loader.load("2026-11");
  assert.ok(calls.slice(0, 3).every(call => call.options.signal.aborted));
  assert.ok(calls.slice(3, 6).every(call => !call.options.signal.aborted));
  assert.notEqual(calls[0].options.signal, calls[3].options.signal);
  const current = finish(calls, 3, "november");
  assert.deepEqual(await november, current);
  finish(calls, 0, "october");
  assert.equal(await october, undefined);
  assert.equal(calls.length, 6, "No retry or extra task fetch");
});

test("bundle remains all-or-nothing until all three successful response bodies are arrays", async () => {
  const { calls, loader } = transport();
  const bodies = [deferred(), deferred(), deferred()];
  let settled = false;
  const pending = loader.load("2026-10").then(value => { settled = true; return value; });
  calls.forEach((call, index) => respond(call, undefined, { body: bodies[index] }));
  bodies[0].resolve([{ id: "client" }]); bodies[1].resolve([]);
  await microtasks(); assert.equal(settled, false);
  bodies[2].resolve([{ id: "publication" }]);
  assert.deepEqual(await pending, { clientes: [{ id: "client" }], historias: [], publicaciones: [{ id: "publication" }] });
  assert.ok(calls.every(call => call.options.headers.Authorization === 'Bearer qa-client-overview'));
});

test("each canonical HTTP failure rejects the current bundle without fabricating partial success", async () => {
  for (let failed = 0; failed < 3; failed++) {
    const { calls, loader } = transport();
    const pending = loader.load("2026-10"), checked = boundedRejection(pending);
    calls.forEach((call, index) => respond(call, [], { ok: index !== failed }));
    await checked;
    assert.equal(calls.length, 3);
  }
});

test("non-array bodies and malformed response objects cannot resolve as a successful bundle", async () => {
  for (const body of [null, {}, { error: "business error" }, "[]", false, 0]) {
    const { calls, loader } = transport();
    const pending = loader.load("2026-10"), checked = boundedRejection(pending);
    respond(calls[0], []); respond(calls[1], body); respond(calls[2], []);
    await checked;
  }
  for (const response of [undefined, null, {}, { ok: true }, { ok: true, json: "not a function" }]) {
    const { calls, loader } = transport();
    const pending = loader.load("2026-10"), checked = boundedRejection(pending);
    calls[0].resolve(response); respond(calls[1]); respond(calls[2]);
    await checked;
  }
});

test("malformed current JSON rejects with bounded error, never a transport-sized body diagnostic", async () => {
  const { calls, loader } = transport(), body = deferred();
  const pending = loader.load("2026-10"), checked = boundedRejection(pending);
  respond(calls[0], undefined, { body }); respond(calls[1]); respond(calls[2]);
  body.reject(new SyntaxError("malformed raw JSON: " + "x".repeat(5000)));
  await checked;
});

test("obsolete body success or failure resolves undefined after current load succeeds", async () => {
  for (const fail of [false, true]) {
    const { calls, loader } = transport(), body = deferred();
    const old = loader.load("2026-10");
    respond(calls[0], undefined, { body }); respond(calls[1]); respond(calls[2]);
    await microtasks();
    const current = loader.load("2026-11"), expected = finish(calls, 3, "current");
    assert.deepEqual(await current, expected);
    if (fail) body.reject(new SyntaxError("obsolete JSON failure")); else body.resolve([{ id: "old-client" }]);
    assert.equal(await old, undefined);
    assert.equal(calls.length, 6);
  }
});

test("stale transport failures are ignored without swallowing current failures or retrying", async () => {
  const { calls, loader } = transport();
  const old = loader.load("2026-10"), current = loader.load("2026-11");
  const checked = boundedRejection(current);
  calls[0].reject(new Error("old fetch failure")); respond(calls[1]); respond(calls[2]);
  assert.equal(await old, undefined);
  respond(calls[3]); calls[4].reject(new Error("current fetch failure")); respond(calls[5]);
  await checked;
  assert.equal(calls.length, 6);
});

test("cancel is reusable across pending fetch/body reads; later load and explicit retry can succeed", async () => {
  const { calls, loader } = transport();
  const first = loader.load("2026-10"); loader.cancel(); loader.cancel();
  assert.ok(calls.every(call => call.options.signal.aborted));
  finish(calls, 0, "canceled"); assert.equal(await first, undefined);
  const body = deferred(), second = loader.load("2026-11");
  respond(calls[3], undefined, { body }); respond(calls[4]); respond(calls[5]);
  await microtasks(); loader.cancel(); body.resolve([]);
  assert.equal(await second, undefined);
  const failed = loader.load("2026-12"), checked = boundedRejection(failed);
  respond(calls[6], [], { ok: false }); respond(calls[7]); respond(calls[8]); await checked;
  const retry = loader.load("2026-12"), expected = finish(calls, 9, "retry");
  assert.deepEqual(await retry, expected);
  assert.equal(calls.length, 12);
});

test('session replacement drops the entire old bundle and a new load carries only the new actor', async () => {
  for (const fail of [false,true]) {
    const f = transport(), old = f.loader.load('2026-10');
    f.switchSession();
    if (fail) { f.calls[0].reject(new Error('old failure')); respond(f.calls[1]); respond(f.calls[2]); }
    else finish(f.calls, 0, 'old');
    assert.equal(await old, undefined);
    const next = f.loader.load('2026-10'), expected = finish(f.calls, 3, 'new');
    assert.deepEqual(await next, expected);
    assert.ok(f.calls.slice(0,3).every(call => call.options.headers.Authorization === 'Bearer qa-client-overview'));
    assert.ok(f.calls.slice(3).every(call => call.options.headers.Authorization === 'Bearer qa-other'));
  }
});

test('permission and session errors preserve their typed identity with no automatic retry', async () => {
  for (const error of [Object.assign(new Error('denied'),{status:401}), Object.assign(new Error('forbidden'),{status:403}),
    Object.assign(new Error('context denied'),{name:'BrowserSessionError'})]) {
    const f = transport(), pending = f.loader.load('2026-10');
    f.calls[0].reject(error); respond(f.calls[1]); respond(f.calls[2]);
    await assert.rejects(pending, actual => actual === error);
    assert.equal(f.calls.length,3);
  }
});

test("Clientes integrates loader cleanup/current-bundle commit and never equates task completion with publication", () => {
  const page = readFileSync(new URL("./Clientes.jsx", import.meta.url), "utf8");
  assert.match(page, /import \{ createClientOverviewLoader \} from "\.\/clientOverview\.js"/);
  assert.match(page, /createClientOverviewLoader\(/);
  assert.match(page, /createClientOverviewLoader\(capture\)/);
  assert.match(page, /overviewLoader\.load\(mesSeleccionado\)/);
  assert.match(page, /if \(!data \|\| !scope.current\(\) \|\| generation !== loadGeneration.current\) return;[\s\S]*?setClientes\(data\.clientes\);[\s\S]*?setHistorias\(data\.historias\);[\s\S]*?setPublicaciones\(data\.publicaciones\)/);
  assert.match(page, /return \(\) => \{[\s\S]*?clearInterval\(intervalo\);[\s\S]*?removeEventListener\("visibilitychange", alVolverVisible\);[\s\S]*?overviewLoader\.cancel\(\)/);
  assert.doesNotMatch(page, /tareasFinalizadas|\/api\/tareas|checklist\s*OK/i);
  assert.match(page, /getResumenClientes/);
});
