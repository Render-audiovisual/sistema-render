import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import ts from 'typescript';
import { productionReportVisitHref } from './production-report-links.js';
import { productionLocation } from '../../pages/productionRouteContext.js';
import { navigateWithinApp } from '../navigation/location.js';

const visitId = '11111111-2222-4333-8444-555555555555';
const visit = (fecha = '2026-10-29') => ({ id: visitId, fecha });
const reportSource = readFileSync(new URL('../../pages/Reportes.jsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('Reportes.jsx', reportSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
assert.equal(tree.parseDiagnostics.length, 0);
const declaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ProductionVisitLink');
assert.ok(declaration, 'Test must exercise the actual Reportes link component');
const compiled = ts.transpileModule(declaration.getText(tree), {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const component = (window, navigate) => Function('React', 'window', 'navigateWithinApp', `${compiled}\nreturn ProductionVisitLink;`)(React, window, navigate);
function event(patch = {}) {
  let prevents = 0;
  return { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    preventDefault() { prevents++; }, get prevents() { return prevents; }, ...patch };
}

test('canonical helper roundtrips exact visit/month/day with no inherited report filters or destination URLs', () => {
  for (const fecha of ['2026-10-29', '2028-02-29', '2026-12-31', '2027-01-01', '0099-01-02']) {
    const source = { ...visit(fecha), cliente_id: 900, href: 'https://external.invalid/injected',
      mes: '1900-01', dia: '1900-01-01', tab: 'pending', query: '&cliente=900#injected' };
    const before = structuredClone(source), href = productionReportVisitHref(source);
    assert.equal(href, `/producciones?visita=${visitId}&mes=${fecha.slice(0, 7)}&dia=${fecha}`);
    const url = new URL(href, 'https://render.test/reportes-historias?mes=2025-01#old');
    assert.equal(url.origin, 'https://render.test'); assert.equal(url.pathname, '/producciones'); assert.equal(url.hash, '');
    assert.deepEqual([...url.searchParams.keys()], ['visita', 'mes', 'dia']);
    const context = productionLocation(url.href);
    assert.deepEqual(context, { id: visitId, month: fecha.slice(0, 7), day: fecha, clientId: '', tab: 'calendar' });
    assert.deepEqual(productionLocation(new URL(productionReportVisitHref({ id: context.id, fecha: context.day }), url).href), context);
    assert.deepEqual(source, before);
  }
});

test('invalid whole UUIDs and injection never produce a navigable link or invoke coercion', () => {
  let coercions = 0;
  const hostile = { toString() { coercions++; return visitId; } };
  for (const id of [undefined, null, 1, hostile, '', visitId + '\n', ` ${visitId}`, visitId.slice(1),
    visitId.replace('1', 'z'), `${visitId}&cliente=7`, `${visitId}#fragment`, 'javascript:alert(1)', '//external.invalid/']) {
    assert.equal(productionReportVisitHref({ id, fecha: '2026-10-29' }), null);
  }
  for (const value of [undefined, null, false, {}, []]) assert.equal(productionReportVisitHref(value), null);
  assert.equal(coercions, 0);
});

test('only exact real calendar dates are accepted, with no timestamp, whitespace, URL or date-object coercion', () => {
  let coercions = 0;
  for (const fecha of [undefined, null, 20261029, { toString() { coercions++; return '2026-10-29'; } },
    new Date('2026-10-29T00:00:00Z'), '', '0000-01-01', '2026-02-29', '2026-02-30', '2026-04-31',
    '2026-13-01', '2026-00-01', '2026-01-00', '2026-1-01', '2026-01-1', '2026-10-29\n',
    ' 2026-10-29', '2026-10-29 ', '2026-10-29T00:00:00Z', '2026-10-29&tab=pending', 'https://external.invalid/']) {
    assert.equal(productionReportVisitHref({ id: visitId, fecha }), null);
  }
  assert.equal(coercions, 0);
});

test('actual Reportes link preserves native anchor semantics and invokes shared navigation once for a plain left click', () => {
  const window = {}, calls = [], href = productionReportVisitHref(visit());
  const Link = component(window, (...args) => { calls.push(args); return true; });
  const element = Link({ href });
  assert.equal(element.type, 'a'); assert.equal(element.props.href, href);
  assert.match(element.props.children, /Abrir registro en Producciones/);
  const click = event(); element.props.onClick(click);
  assert.equal(click.prevents, 1); assert.deepEqual(calls, [[window, href]]);
});

test('modified and non-left clicks keep browser defaults without calling navigation', () => {
  const Link = component({}, () => assert.fail('Modified click must remain a native browser action'));
  const element = Link({ href: productionReportVisitHref(visit()) });
  for (const patch of [{ button: 1 }, { button: 2 }, { metaKey: true }, { ctrlKey: true },
    { shiftKey: true }, { altKey: true }, { ctrlKey: true, shiftKey: true }]) {
    const click = event(patch); element.props.onClick(click); assert.equal(click.prevents, 0);
  }
});

test('null helper output renders no anchor and cannot initiate any navigation', () => {
  const Link = component({}, () => assert.fail('No destination must mean no action'));
  assert.equal(Link({ href: productionReportVisitHref({ id: 'invalid', fecha: '2026-10-29' }) }), null);
  assert.equal(Link({ href: null }), null);
});

function navigationWindow(veto = false) {
  const calls = [];
  class WindowEvent {
    constructor(type, options = {}) { this.type = type; Object.assign(this, options); this.defaultPrevented = false; }
    preventDefault() { this.defaultPrevented = true; }
  }
  const win = { location: new URL('https://render.test/reportes-historias?periodo=mes_actual'),
    CustomEvent: WindowEvent, PopStateEvent: WindowEvent,
    history: { state: null, pushState(state, _title, href) { calls.push(['push', href]); this.state = state; win.location = new URL(href, win.location); } },
    dispatchEvent(value) { calls.push(['event', value.type]); if (veto && value.type === 'render:before-navigation') value.preventDefault(); return !value.defaultPrevented; },
    scrollTo(value) { calls.push(['scroll', value]); } };
  return { win, calls };
}
test('actual handler interoperates with real shared navigator: one canonical commit or veto with no fallback reload', () => {
  for (const veto of [false, true]) {
    const { win, calls } = navigationWindow(veto), href = productionReportVisitHref(visit());
    const Link = component(win, navigateWithinApp), click = event(); Link({ href }).props.onClick(click);
    assert.equal(click.prevents, 1);
    assert.equal(calls.filter(row => row[0] === 'event' && row[1] === 'render:before-navigation').length, 1);
    assert.equal(calls.filter(row => row[0] === 'push').length, veto ? 0 : 1);
    assert.equal(calls.filter(row => row[0] === 'event' && row[1] === 'popstate').length, veto ? 0 : 1);
    assert.equal(calls.filter(row => row[0] === 'scroll').length, veto ? 0 : 1);
    if (!veto) assert.deepEqual(productionLocation(win.location.href), {
      id: visitId, month: '2026-10', day: '2026-10-29', clientId: '', tab: 'calendar',
    });
    else assert.equal(win.location.pathname, '/reportes-historias');
  }
});

test('actual page wires reconstructed visit context rather than trusting a report-provided href', () => {
  let link;
  function walk(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'ProductionVisitLink') link = node;
    ts.forEachChild(node, walk);
  }
  walk(tree); assert.ok(link);
  const href = link.attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.getText(tree) === 'href');
  assert.equal(href.initializer.expression.getText(tree), 'productionReportVisitHref(visit)');
  const navigationImport = tree.statements.find(node => ts.isImportDeclaration(node)
    && node.moduleSpecifier.text === '../shared/navigation/location.js');
  assert.ok(navigationImport?.importClause?.namedBindings?.elements.some(node => node.name.text === 'navigateWithinApp'));
});
