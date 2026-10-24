import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { parseGoalClientId, goalClientLocationUrl, resolveGoalClient } from './clientGoalLocation.js';
import { goalQuotaProgress, validGoalQuotaRevision } from './clientGoalQuota.js';
import { clientOperationHref } from './clientOperation.js';

// Real location helpers + actual GoalPage JSX/callbacks. Inert effects and
// controlled hook observations are not mounted browser, API or ACL proof.
const text = readFileSync(new URL('./ClientesObjetivos.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('ClientesObjetivos.jsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
assert.equal(file.parseDiagnostics.length, 0);
function nodes(root, predicate) { const result = []; function walk(n) { if (predicate(n)) result.push(n); ts.forEachChild(n, walk); } walk(root); return result; }
const owner = name => file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
const page = owner('GoalPage'); assert.ok(page);
const initializer = name => { const found = nodes(page, n => ts.isVariableDeclaration(n) && n.name.getText(file) === name); assert.equal(found.length, 1, name); return found[0].initializer; };
const localFunction = name => { const found = nodes(page, n => ts.isFunctionDeclaration(n) && n.name?.text === name); assert.equal(found.length, 1, name); return found[0]; };
function evaluate(node, deps) {
  const js = ts.transpileModule(`const actual = (${node.getText(file)});`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return Function(...Object.keys(deps), `${js};return actual;`)(...Object.values(deps));
}
const group = (clave, ids, nombre) => Object.freeze({ clave, nombre, cuentas: ids.map(id => Object.freeze({ id, nombre: `Cuenta ${id}` })), preparado: false,
  reels: 0, carruseles: 0, cuota_actual: { reels: 0, carruseles: 0 }, cuota_desactualizada: false, cuota_revision: null,
  preparacion_revision: 'a'.repeat(64), piezas: [] });
const clients = Object.freeze([group('cliente-7', [7], 'Primero'), group('grupo-3', [8, 9], 'Segundo compartido')]);

test('real parser accepts optional canonical positive PG IDs and rejects ambiguous or malformed selectors', () => {
  assert.equal(parseGoalClientId('?periodo=2026-10'), null);
  for (const id of [7, 9, 2147483647]) assert.equal(parseGoalClientId(`?cliente=${id}&periodo=2026-10`), id);
  for (const query of ['cliente=', 'cliente=0', 'cliente=-1', 'cliente=01', 'cliente=1.0', 'cliente=1e2', 'cliente=2147483648',
    'cliente=9007199254740993', 'cliente=9%0A', 'cliente=%209', 'cliente=9&cliente=9', 'cliente=8&cliente=9',
    'cliente[]=9', 'cliente[id]=9', 'cliente=9&cliente[]=8']) assert.throws(() => parseGoalClientId(`?${query}`), query);
});

test('real resolver selects only exact account ID, including sibling feed; explicit missing IDs never fall back', () => {
  const before = JSON.stringify(clients);
  for (const id of [8, 9]) assert.equal(resolveGoalClient(clients, id, 'cliente-7'), clients[1]);
  assert.equal(resolveGoalClient(clients, 7, 'grupo-3'), clients[0]);
  for (const id of [99, '9', 0, -1, 1.5]) assert.equal(resolveGoalClient(clients, id, 'cliente-7'), null);
  assert.equal(resolveGoalClient(clients, null, 'grupo-3'), clients[1]);
  assert.equal(resolveGoalClient(clients, null, ''), clients[0]);
  assert.equal(JSON.stringify(clients), before);
});

function renderPage(id, search = `?cliente=${id}&periodo=2026-10`) {
  let index = 0;
  const state = ['2026-10', '', { periodo: '2026-10', clientes: clients }, '', false, 'cliente-7', null, 0, false, '', id];
  const noWrite = () => assert.fail('SSR must not request or mutate');
  const deps = { React, useRef: current => ({ current }), useState: () => [state[index++], noWrite], useEffect() {},
    currentMonth: () => '2026-10', goalPeriod: evaluate(owner('goalPeriod'), { currentMonth: () => '2026-10' }),
    parseGoalClientId, goalClientLocationUrl, resolveGoalClient, goalQuotaProgress, validGoalQuotaRevision, clientOperationHref,
    useGoalSession: () => ({ view: { role: 'edicion', session: {} }, capture: noWrite, epoch: 0 }),
    window: { location: { search, href: `https://render.test/clientes${search}` } },
    GoalIcon: () => null, GoalLoading: () => null, PageState: ({ title, description }) => React.createElement('p', null, title, description),
    monthLabel: () => 'octubre de 2026', GoalPieceButton: () => null,
  };
  return renderToStaticMarkup(React.createElement(evaluate(page, deps), { sesion: {} }));
}

test('actual GoalPage SSR follows the second account and sibling feed instead of stale selectedKey or first group', () => {
  for (const id of [8, 9]) {
    const html = renderPage(id);
    assert.match(html, /aria-label="Objetivo mensual de Segundo compartido"/);
    assert.doesNotMatch(html, /aria-label="Objetivo mensual de Primero"/);
    assert.match(html, /value="grupo-3" selected=""/);
    assert.match(html, /cliente=8&amp;periodo=2026-10/);
    assert.match(html, /cliente=9&amp;periodo=2026-10/);
    assert.doesNotMatch(html, /Abono mensual|\$|gestion=1|Preparar objetivo del mes/);
  }
  const missing = renderPage(99);
  assert.doesNotMatch(missing, /aria-label="Objetivo mensual de (Primero|Segundo compartido)"/);
  assert.match(missing, /El cliente #99 no tiene un objetivo disponible en este período/);
  assert.match(missing, /no se seleccionó un objetivo diferente\./);
  assert.doesNotMatch(missing, /aria-pressed="true"/);
});

function navigationFixture() {
  let url = new URL('https://render.test/clientes?cliente=7&periodo=2026-10&other=keep#objetivo');
  const historyState = { preserved: 1 }, events = [], handlers = new Map();
  const window = { get location() { return url; }, history: { state: historyState,
    pushState(state, _title, href) { assert.equal(state, historyState); events.push(['push', href]); url = new URL(href, url); },
    replaceState(state, _title, href) { assert.equal(state, historyState); events.push(['replace', href]); url = new URL(href, url); } },
    addEventListener(type, fn) { handlers.set(type, fn); }, removeEventListener(type, fn) { assert.equal(handlers.get(type), fn); handlers.delete(type); },
    dispatchEvent(event) { events.push(['dispatch', event.type]); handlers.get(event.type)?.(event); return true; } };
  let current = true, allow = true;
  const deps = { window, clients, selectedClientId: 7, period: '2026-10', modalOpen: { current: false },
    preparing: false, loaded: { current: true }, deferred: { current: false }, pendingPeriod: { current: null },
    activeHref: { current: url.href }, goalId: n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647,
    parseGoalClientId, goalClientLocationUrl, goalPeriod: evaluate(owner('goalPeriod'), { currentMonth: () => '2026-10' }),
    capture: () => ({ current: () => current }), requestAppNavigation: (_window, href) => { events.push(['consent', href]); return allow; },
    PopStateEvent: class { constructor(type) { this.type = type; } },
  };
  for (const name of ['Period', 'SelectedClientId', 'LocationError', 'Notice', 'SelectedKey', 'SelectedPiece', 'Preparing', 'Loading', 'Revision']) {
    deps[`set${name}`] = value => events.push([name, typeof value === 'function' ? value(4) : value]);
  }
  deps.changeGoalContext = evaluate(localFunction('changeGoalContext'), deps);
  return { deps, events, window, handlers, go: href => { url = new URL(href, url); }, stale: () => { current = false; }, veto: () => { allow = false; } };
}

test('actual chooseClient and month input preserve client/month/hash with one navigation and no API call', () => {
  const h = navigationFixture();
  evaluate(localFunction('chooseClient'), h.deps)('grupo-3');
  assert.equal(h.window.location.searchParams.get('cliente'), '8');
  assert.equal(h.window.location.searchParams.get('periodo'), '2026-10');
  assert.equal(h.window.location.searchParams.get('other'), 'keep'); assert.equal(h.window.location.hash, '#objetivo');
  assert.deepEqual(h.events.filter(([name]) => ['SelectedKey', 'SelectedPiece'].includes(name)), [['SelectedKey', 'grupo-3'], ['SelectedPiece', null]]);
  const input = nodes(page, n => ts.isJsxSelfClosingElement(n) && n.tagName.getText(file) === 'input'
    && n.attributes.properties.some(p => p.name?.getText(file) === 'type' && p.initializer?.text === 'month'))[0];
  const onChange = input.attributes.properties.find(p => p.name?.getText(file) === 'onChange').initializer.expression;
  const month = navigationFixture(); evaluate(onChange, month.deps)({ target: { value: '2026-11' } });
  assert.equal(month.window.location.searchParams.get('cliente'), '7');
  assert.equal(month.window.location.searchParams.get('periodo'), '2026-11'); assert.equal(month.window.location.hash, '#objetivo');
  assert.equal(month.events.filter(([name]) => name === 'push').length, 1);
  for (const value of ['', '2026-13', '0000-01']) { const blocked = navigationFixture(); evaluate(onChange, blocked.deps)({ target: { value } }); assert.deepEqual(blocked.events, []); }
});

test('actual context callback and selection respect modal, stale identity, unknown key and navigation veto', () => {
  for (const reason of ['modal', 'stale', 'veto', 'unknown']) {
    const h = navigationFixture();
    if (reason === 'modal') h.deps.modalOpen.current = true;
    if (reason === 'stale') h.stale(); if (reason === 'veto') h.veto();
    evaluate(localFunction('chooseClient'), h.deps)(reason === 'unknown' ? 'missing' : 'grupo-3');
    assert.equal(h.events.some(([name]) => ['push', 'SelectedKey', 'SelectedPiece'].includes(name)), false, reason);
  }
  const h = navigationFixture();
  h.deps.requestAppNavigation = () => { h.stale(); return true; };
  assert.equal(evaluate(localFunction('changeGoalContext'), h.deps)({ clientId: 9 }), false);
  assert.deepEqual(h.events, [], 'Identity changed inside consent listener cannot commit navigation');
});

test('real pop callback defers BOTH month and account with modal open; close restores pending URL/hash before context', () => {
  const h = navigationFixture();
  const pop = evaluate(initializer('pop'), h.deps);
  h.deps.modalOpen.current = true;
  h.go('/clientes?cliente=9&periodo=2026-11&other=keep#nuevo');
  pop();
  assert.deepEqual(h.deps.pendingPeriod.current, { period: '2026-11', clientId: 9, error: '', href: 'https://render.test/clientes?cliente=9&periodo=2026-11&other=keep#nuevo' });
  assert.equal(h.window.location.searchParams.get('cliente'), '7'); assert.equal(h.window.location.hash, '#objetivo');
  assert.equal(h.events.some(([name]) => ['Period', 'SelectedClientId'].includes(name)), false);
  evaluate(initializer('closeModal'), h.deps)();
  assert.equal(h.deps.pendingPeriod.current, null); assert.equal(h.deps.modalOpen.current, false);
  assert.equal(h.window.location.searchParams.get('cliente'), '9'); assert.equal(h.window.location.searchParams.get('periodo'), '2026-11');
  assert.equal(h.window.location.hash, '#nuevo');
  assert.equal(h.deps.activeHref.current, h.window.location.href);
  assert.ok(h.events.some(([name, value]) => name === 'Period' && value === '2026-11'));
  assert.ok(h.events.some(([name, value]) => name === 'SelectedClientId' && value === 9));
  assert.ok(h.events.findIndex(([name, href]) => name === 'replace' && href.endsWith('#nuevo')) < h.events.findIndex(([name]) => name === 'Period'));
  const clean = navigationFixture(); clean.go('/clientes?cliente=9&periodo=2026-11#back'); evaluate(initializer('pop'), clean.deps)();
  assert.equal(clean.deps.pendingPeriod.current, null);
  assert.ok(clean.events.some(([name, value]) => name === 'SelectedClientId' && value === 9));
  assert.equal(clean.events.some(([name]) => name === 'push'), false, 'Back restoration never pushes another entry');
});

test('real pop rejects malformed account without choosing another; unrelated route events are ignored', () => {
  const h = navigationFixture();
  h.go('/clientes?cliente=8&cliente=9&periodo=2026-11#bad');
  evaluate(initializer('pop'), h.deps)();
  assert.ok(h.events.some(([name, value]) => name === 'LocationError' && /Cliente inválido/.test(value)));
  assert.ok(h.events.some(([name, value]) => name === 'SelectedClientId' && value === 7));
  assert.equal(h.events.some(([name]) => ['SelectedKey', 'push'].includes(name)), false);
  const other = navigationFixture(); other.go('/proyectos?cliente=9');
  evaluate(initializer('pop'), other.deps)(); assert.deepEqual(other.events, []);
});
