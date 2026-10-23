import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { createHomeProductionPageLoader, PRODUCTION_PAGE_LIMIT } from './homeProductionPage.js';

// Actual component and real bound loader, simulated hooks/transport only.
const source = readFileSync(new URL('./HomeProductionMonthly.jsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('HomeProductionMonthly.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const owner = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'HomeProductionMonthly');
const compiled = ts.transpileModule(owner.getText(ast), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const session = id => ({ token: `synthetic-${id}`, usuario: { id, rol: 'produccion', activo: true } });
const dto = (offset = 0, period = '2026-10', id = 7, label = 'Client') => ({ version: 1, user: { id }, period, today: '2026-10-20', offset, limit: 20,
  total: 21, completed: 0, client_count: 21, has_more: offset === 0,
  clients: Array.from({ length: offset === 0 ? 20 : 1 }, (_, i) => ({ client: { id: offset + i + 1, nombre: `${label} ${offset + i + 1}` }, total: 1, completed: 0 })) });
const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
function fixture() {
  const slots = [], pending = [], requests = []; let cursor = 0, effects = [], tree, live = session(7), view = { session: live };
  const request = (url, options) => new Promise((resolve, reject) => { requests.push({ url, options }); pending.push({ resolve, reject }); });
  let props = { data: dto(), period: '2026-10', sesion: live, request };
  const deps = { React, PRODUCTION_PAGE_LIMIT, createHomeProductionPageLoader, getSesion: () => live, useSessionView: () => view,
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useState(initial) { const i = cursor++; if (!slots[i]) slots[i] = { value: initial }; return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }]; },
    useMemo(fn, dependencies) { const i = cursor++, old = slots[i]; if (!old || dependencies.some((value, j) => !Object.is(value, old.dependencies[j]))) slots[i] = { value: fn(), dependencies }; return slots[i].value; },
    useEffect(fn, dependencies) { const i = cursor++, old = slots[i]; if (!old || dependencies.some((value, j) => !Object.is(value, old.dependencies[j]))) { slots[i] = { dependencies, cleanup: old?.cleanup }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  const exports = {}; new Function('exports', ...Object.keys(deps), compiled)(exports, ...Object.values(deps));
  const render = (changes = {}) => { props = { ...props, ...changes }; cursor = 0; tree = exports.HomeProductionMonthly(props); return tree; };
  const commit = () => { const scheduled = effects; effects = []; scheduled.forEach(fn => fn()); };
  const descendants = element => !React.isValidElement(element) ? [] : [element, ...React.Children.toArray(element.props.children).flatMap(descendants)];
  const button = label => descendants(tree).find(el => el.type === 'button' && el.props.children === label);
  render(); commit();
  return { requests, pending, render, commit, button, html: () => renderToStaticMarkup(tree),
    changeSession(id) { live = session(id); view = { session: live }; },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); }, get props() { return props; } };
}
async function pageTwo(f) {
  f.button('Siguiente').props.onClick(); await settle(); f.pending[0].resolve(dto(20)); await settle(); f.render();
  assert.match(f.html(), /Página 2/); assert.match(f.html(), /Client 21/);
}
test('same-session same-period parent refresh retains offset and re-reads through real session-bound loader', async () => {
  const f = fixture(); assert.equal(f.requests.length, 0); await pageTwo(f);
  f.render({ data: dto(0, '2026-10', 7, 'Parent refreshed') });
  assert.doesNotMatch(f.html(), /Client 21|Parent refreshed|Página 1/); f.commit(); await settle();
  assert.match(f.requests[1].url, /period=2026-10&offset=20&limit=20$/); assert.equal(f.requests[1].options.method, 'GET');
  assert.equal(f.requests[1].options.headers.Authorization, 'Bearer synthetic-7');
  f.pending[1].resolve(dto(20, '2026-10', 7, 'Refreshed')); await settle(); f.render();
  assert.match(f.html(), /Página 2/); assert.match(f.html(), /Refreshed 21/); f.dispose();
});
test('older page response cannot paint after parent snapshot render even before passive cleanup', async () => {
  const f = fixture(); f.button('Siguiente').props.onClick();
  f.render({ data: dto(0, '2026-10', 7, 'Parent') });
  f.pending[0].resolve(dto(20, '2026-10', 7, 'Obsolete')); await settle(); f.render();
  assert.doesNotMatch(f.html(), /Obsolete|Página 1|Página 2/); f.commit();
  assert.equal(f.requests[0].options.signal.aborted, true);
  f.pending[1].resolve(dto(20, '2026-10', 7, 'Latest')); await settle(); f.render();
  assert.match(f.html(), /Latest 21/); assert.match(f.html(), /Página 2/); f.dispose();
});
test('identity or period replacement hides old rows immediately and resets requested offset to zero', async () => {
  for (const change of ['identity', 'period']) {
    const f = fixture(); await pageTwo(f);
    const period = change === 'period' ? '2026-11' : '2026-10', id = change === 'identity' ? 8 : 7;
    if (change === 'identity') f.changeSession(8);
    f.render({ period }); assert.doesNotMatch(f.html(), /Client 21|Página 2|0 \/ 21/);
    f.commit(); assert.match(f.requests[1].url, new RegExp(`period=${period}&offset=0&limit=20$`));
    f.pending[1].resolve(dto(0, period, id, 'New owner')); await settle(); f.render();
    assert.match(f.html(), /Página 1/); assert.match(f.html(), /New owner 1/); f.dispose();
  }
});
test('failed snapshot refresh shows honest unavailable state; explicit retry retains selected offset', async () => {
  const f = fixture(); await pageTwo(f); f.render({ data: dto() }); f.commit();
  f.pending[1].reject(Error('offline')); await settle(); f.render();
  assert.match(f.html(), /role="alert"/); assert.match(f.html(), /Sin resultado confirmado/);
  assert.doesNotMatch(f.html(), /No hay clientes|Página 1|Client 21|0 \/ 21/);
  assert.equal(f.requests.length, 2); f.button('Reintentar').props.onClick(); await settle();
  assert.match(f.requests[2].url, /offset=20&limit=20$/);
  f.pending[2].resolve(dto(20)); await settle(); f.render(); assert.match(f.html(), /Página 2/); f.dispose();
});
test('snapshot refresh at initial offset also uses real loader, and explicit first page recovers errors', async () => {
  const f = fixture(); f.render({ data: dto() }); f.commit(); assert.match(f.requests[0].url, /offset=0&limit=20$/);
  f.pending[0].resolve({ invalid: true }); await settle(); f.render(); assert.match(f.html(), /role="alert"/);
  f.button('Primera página').props.onClick(); f.pending[1].resolve(dto()); await settle(); f.render(); assert.match(f.html(), /Página 1/); f.dispose();
});
test('disposed and superseded snapshot loaders suppress late success/error without mutation or automatic retry', async () => {
  for (const fail of [false, true]) {
    const f = fixture(); await pageTwo(f); f.render({ data: dto() }); f.commit();
    f.render({ data: dto() }); f.commit(); assert.equal(f.requests[1].options.signal.aborted, true);
    f.pending[2].resolve(dto(20, '2026-10', 7, 'Newest')); await settle(); f.render();
    const before = f.html(); if (fail) f.pending[1].reject(Error('old')); else f.pending[1].resolve(dto(20, '2026-10', 7, 'Old'));
    await settle(); f.render(); assert.equal(f.html(), before); assert.equal(f.requests.length, 3); f.dispose();
  }
});
test('retained old page handler cannot dispatch into replacement snapshot loader', async () => {
  const f = fixture(); await pageTwo(f); const oldPrevious = f.button('Anterior').props.onClick;
  f.render({ data: dto() }); f.commit(); assert.equal(f.requests.length, 2);
  oldPrevious(); assert.equal(f.requests.length, 2);
  f.pending[1].resolve(dto(20)); await settle(); f.render(); assert.match(f.html(), /Página 2/); f.dispose();
});
test('unmount aborts active request and suppresses its late completion', async () => {
  const f = fixture(); f.button('Siguiente').props.onClick(); f.render(); const before = f.html(); f.dispose();
  assert.equal(f.requests[0].options.signal.aborted, true);
  f.pending[0].resolve(dto(20)); await settle(); f.render(); assert.equal(f.html(), before); assert.equal(f.requests.length, 1);
});
