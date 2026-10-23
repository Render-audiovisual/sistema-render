import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { ESTADOS_PUBLICACION, TIPOS_PUBLICACION, MESES } from '../constants.js';
import { normalizePublicationTrackingContext as normalize, readPublicationTrackingContext as read, publicationTrackingUrlChanges as changes } from './publicationTrackingContext.js';
import { buildContextUrl, readUrlContext, readMonthContext } from '../shared/navigation/url-context.js';

// Execute actual extracted callbacks/JSX. SSR is not a mounted browser test.
const source = readFileSync(new URL('./Publicaciones.jsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('Publicaciones.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const text = n => n.getText(ast);
const nodes = (root, predicate) => { const out = []; const visit = n => { if (predicate(n)) out.push(n); ts.forEachChild(n, visit); }; visit(root); return out; };
const owner = name => ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
const parent = owner('PublicacionesPage'), child = owner('PublicacionesGeneralTab');
const evaluate = (node, deps) => new Function(...Object.keys(deps), `return (${text(node)});`)(...Object.values(deps));
const init = name => nodes(parent, n => ts.isVariableDeclaration(n) && text(n.name) === name)[0].initializer;
const defaults = normalize();
const helpers = { normalizePublicationTrackingContext: normalize, readPublicationTrackingContext: read, publicationTrackingUrlChanges: changes };
const fields = { client: 'seg_cliente', month: 'seg_mes', state: 'seg_estado', responsible: 'seg_responsable', type: 'seg_tipo' };
const context = { client: '17', month: '2026-10', state: ESTADOS_PUBLICACION[0].id, responsible: '  QA homónimo  ', type: TIPOS_PUBLICACION[0].id };

test('strict client/month filters and enum whitelists normalize invalid values to todos', () => {
  assert.deepEqual(defaults, { client: 'todos', month: 'todos', responsible: 'todos', state: 'todos', type: 'todos' });
  for (const client of ['1', '2147483647']) assert.equal(normalize({ client }).client, client);
  for (const client of [1, '0', '-1', '+1', '01', '1e2', '1.0', ' 1', '1\n', '2147483648', {}, ['1']]) assert.equal(normalize({ client }).client, 'todos');
  for (const month of ['0000-01', '2026-00', '2026-13', '2026-1', '2026-10\n', ' 2026-10', 202610]) assert.equal(normalize({ month }).month, 'todos');
  assert.equal(normalize({ month: '0001-01' }).month, '0001-01');
  for (const state of ESTADOS_PUBLICACION) assert.equal(normalize({ state: state.id }).state, state.id);
  for (const type of TIPOS_PUBLICACION) assert.equal(normalize({ type: type.id }).type, type.id);
  for (const value of ['unknown', '', null, 1, {}, []]) { assert.equal(normalize({ state: value }).state, 'todos'); assert.equal(normalize({ type: value }).type, 'todos'); }
});
test('responsible is exact display-text filter, bounded and control-free, never an inferred user ID', () => {
  for (const responsible of [' QA ', 'Álex 同名', '7', 'x'.repeat(200)]) assert.equal(normalize({ responsible }).responsible, responsible);
  for (const responsible of ['', '   ', 'x'.repeat(201), 'QA\nName', 'QA\tName', 'QA\u0000', 'QA\u007f', 'QA\u0085', 7, {}]) assert.equal(normalize({ responsible }).responsible, 'todos');
});
test('query defaults, malformed/bracket values, duplicate first occurrence and URL canonicalization', () => {
  assert.deepEqual(read(''), defaults);
  assert.deepEqual(read('?seg_cliente[x]=17&seg_mes[]=2026-10'), defaults);
  assert.deepEqual(read('?seg_cliente=bad&seg_mes=2026-99&seg_estado=bad&seg_tipo=bad&seg_responsable=%0A'), defaults);
  assert.equal(read('?seg_cliente=17&seg_cliente=18').client, '17');
  assert.equal(read('?seg_cliente=bad&seg_cliente=17').client, 'todos');
  const href = 'https://render.test/planificacion-publicaciones?tab=lista&cliente=3&mes=2026-09&cal_vista=semana&other=keep#piece';
  const updated = buildContextUrl(href, changes(context));
  assert.deepEqual(read(new URL(updated, href).search), context);
  assert.equal(buildContextUrl(new URL(updated, href).href, changes(defaults)), new URL(href).pathname + new URL(href).search + '#piece');
  assert.deepEqual(changes(defaults), Object.fromEntries(Object.values(fields).map(key => [key, null])));
});
test('actual parent callback merges one field, approves before push/set and rejects stale/denied/no-op', () => {
  assert.equal(ast.parseDiagnostics.length, 0);
  for (const field of Object.keys(fields)) {
    const calls = [], next = { ...defaults, [field]: context[field] };
    const run = evaluate(init('cambiarSeguimiento'), { ...helpers, trackingContext: defaults, capture: () => ({ current: () => true }),
      approveContextChange: value => { calls.push(['approve', value]); return true; }, pushUrlContext: value => calls.push(['push', value]), setTrackingContext: value => calls.push(['set', value]) });
    run({ [field]: context[field] }); assert.deepEqual(calls, [['approve', changes(next)], ['push', changes(next)], ['set', next]]);
  }
  for (const [current, allow, partial, expectedApproval] of [[false, true, { client: '17' }, false], [true, false, { client: '17' }, true], [true, true, {}, false], [true, true, { client: 'bad' }, false]]) {
    const calls = [];
    evaluate(init('cambiarSeguimiento'), { ...helpers, trackingContext: defaults, capture: () => ({ current: () => current }), approveContextChange: () => { calls.push('approve'); return allow; }, pushUrlContext: () => calls.push('push'), setTrackingContext: () => calls.push('set') })(partial);
    assert.deepEqual(calls, expectedApproval ? ['approve'] : []);
  }
});
test('actual initial state reads tracking query and Back restores it without pushes or second approval', () => {
  const search = new URL(buildContextUrl('https://render.test/planificacion-publicaciones?tab=lista&cliente=3&mes=2026-09', changes(context)), 'https://render.test').search;
  const state = init('[trackingContext, setTrackingContext]');
  assert.deepEqual(evaluate(state.arguments[0], { ...helpers, window: { location: { search } } })(), context);
  const effect = nodes(parent, n => ts.isCallExpression(n) && text(n.expression) === 'useEffect').find(n => text(n.arguments[0]).includes('addEventListener("popstate"'));
  const listeners = new Map(), restored = [], fail = () => assert.fail('Back restoration must not write URL or ask consent');
  const window = { location: { search }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name, fn) => { assert.equal(listeners.get(name), fn); listeners.delete(name); } };
  const cleanup = evaluate(effect.arguments[0], { ...helpers, window, hoyDate: new Date('2026-10-20T12:00:00Z'), readUrlContext, readMonthContext,
    readPublicationCalendarContext: () => ({}), setCalendarContext: () => {}, setTrackingContext: value => restored.push(value),
    setTabPrincipal: () => {}, setClienteSeleccionado: () => {}, setYear: () => {}, setMonth: () => {}, pushUrlContext: fail, replaceUrlContext: fail, approveContextChange: fail })();
  listeners.get('popstate')(); window.location.search = '?tab=lista'; listeners.get('popstate')();
  assert.deepEqual(restored, [context, defaults]); cleanup(); assert.equal(listeners.size, 0);
  const canonical = nodes(parent, n => ts.isCallExpression(n) && text(n.expression) === 'useEffect').find(n => text(n.arguments[0]).includes('replaceUrlContext'));
  assert.match(text(canonical.arguments[0]), /publicationTrackingUrlChanges\(trackingContext\)/); assert.match(text(canonical.arguments[1]), /trackingContext/);
});
test('actual child receives controlled parent props and all five labeled handlers emit partial changes', () => {
  const tag = nodes(parent, n => ts.isJsxSelfClosingElement(n) && text(n.tagName) === 'PublicacionesGeneralTab')[0];
  for (const [name, value] of [['trackingContext', 'trackingContext'], ['onTrackingContextChange', 'cambiarSeguimiento']]) assert.equal(text(tag.attributes.properties.find(n => n.name?.text === name).initializer.expression), value);
  const selects = nodes(child, n => ts.isJsxOpeningElement(n) && text(n.tagName) === 'select'); assert.equal(selects.length, 5);
  const calls = [], names = ['Cliente', 'Mes', 'Estado', 'Responsable', 'Tipo'];
  selects.forEach((select, index) => {
    assert.equal(select.attributes.properties.find(n => n.name?.text === 'aria-label').initializer.text, `${names[index]} de seguimiento`);
    const handler = select.attributes.properties.find(n => n.name?.text === 'onChange').initializer.expression;
    evaluate(handler, { onTrackingContextChange: value => calls.push(value) })({ target: { value: 'selected' } });
  });
  assert.deepEqual(calls, Object.keys(fields).map(field => ({ [field]: 'selected' })));
});

function renderGeneral({ error = null, loading = false, trackingContext = context } = {}) {
  let index = 0; const values = [[], loading, error];
  const compiled = ts.transpileModule(text(child), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const deps = { React, ...helpers, ESTADOS_PUBLICACION, TIPOS_PUBLICACION, MESES,
    usePublicationSession: () => ({ view: { session: {} }, capture: () => ({ current: () => true }) }), useState: () => [values[index++], () => {}], useEffect: () => {}, useCallback: fn => fn,
    PageState: ({ title, description }) => React.createElement('div', { role: 'alert' }, title, description) };
  const exports = {}; new Function('exports', ...Object.keys(deps), compiled)(exports, ...Object.values(deps));
  return renderToStaticMarkup(React.createElement(exports.PublicacionesGeneralTab, { clientes: [], trackingContext }));
}
test('actual SSR exposes unknown selected client/month/responsible rather than hiding active filters', () => {
  const html = renderGeneral();
  for (const [value, label] of [['17', 'Cliente no disponible (17)'], ['2026-10', '2026-10 · sin publicaciones disponibles'], ['  QA homónimo  ', '  QA homónimo   · sin publicaciones disponibles']]) {
    assert.ok(html.includes(`value="${value}" selected=""`), value); assert.ok(html.includes(label), label);
  }
  assert.equal((html.match(/<select\b/g) || []).length, 5);
});
test('actual general GET rejects malformed data; error/loading SSR never claims zero or renders result table', async () => {
  const effect = nodes(child, n => ts.isCallExpression(n) && text(n.expression) === 'useEffect')[0];
  for (const result of [null, {}, { items: [] }, Error('offline'), []]) {
    const calls = []; let requestCount = 0;
    const cleanup = evaluate(effect.arguments[0], { capture: () => ({ current: () => true, request: async (url, options) => { requestCount++; assert.equal(url, '/api/publicaciones'); assert.ok(options.signal); if (result instanceof Error) throw result; return result; } }),
      setPublicaciones: value => calls.push(['rows', value]), setError: value => calls.push(['error', value]), setCargando: value => calls.push(['loading', value]) })();
    for (let i = 0; i < 12; i++) await Promise.resolve();
    assert.deepEqual(calls, Array.isArray(result) ? [['rows', []], ['error', null], ['loading', false]] : [['error', 'No se pudieron cargar las publicaciones.'], ['loading', false]]);
    assert.equal(requestCount, 1); cleanup();
  }
  for (const state of [{ error: 'Read failed' }, { loading: true }]) {
    const html = renderGeneral(state); assert.match(html, /Sin resultado confirmado/); assert.doesNotMatch(html, /<table|0 publicaciones|Sin publicaciones para estos filtros/);
  }
  const empty = renderGeneral(); assert.match(empty, /0 publicaciones/); assert.match(empty, /<table/); assert.match(empty, /Sin publicaciones para estos filtros/);
});
