import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { normalizePublicationCalendarContext as normalize, readPublicationCalendarContext as read, publicationCalendarUrlChanges as changes } from './publicationCalendarContext.js';
import { buildContextUrl, readUrlContext, readMonthContext, formatMonthContext } from '../shared/navigation/url-context.js';

// Pure helpers and actual AST-extracted callbacks, not a mounted browser claim.
const source = readFileSync(new URL('./Publicaciones.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('Publicaciones.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const text = n => n.getText(file);
const nodes = (root, predicate) => { const result = []; const visit = n => { if (predicate(n)) result.push(n); ts.forEachChild(n, visit); }; visit(root); return result; };
const parent = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'PublicacionesPage');
const child = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'PublicacionesCalendarioTab');
const evaluate = (n, deps) => new Function(...Object.keys(deps), `return (${text(n)});`)(...Object.values(deps));
const initializer = name => nodes(parent, n => ts.isVariableDeclaration(n) && text(n.name) === name)[0].initializer;
const defaults = { view: 'mes', type: 'todos' };

test('calendar context accepts only the explicit view/type whitelist and omits default URL keys', () => {
  for (const view of ['mes', 'semana']) for (const type of ['todos', 'video', 'carrusel']) {
    const value = { view, type };
    assert.deepEqual(normalize(value), value);
    assert.deepEqual(changes(value), { cal_vista: view === 'mes' ? null : view, cal_tipo: type === 'todos' ? null : type });
  }
  assert.deepEqual(normalize(), defaults);
  for (const value of ['', 'SEMANA', ' semana', 'mes\n', 'unknown', 1, [], {}]) assert.deepEqual(normalize({ view: value, type: value }), defaults);
});
test('query defaults and malformed values normalize without treating bracket keys as scalar context', () => {
  for (const search of ['', '?unrelated=video', '?cal_vista=&cal_tipo=', '?cal_vista=bad&cal_tipo=bad', '?cal_vista=SEMANA&cal_tipo=VIDEO', '?cal_vista=semana%20&cal_tipo=video%0A', '?cal_vista[x]=semana&cal_tipo[]=video']) {
    assert.deepEqual(read(search), defaults, search);
  }
  assert.deepEqual(read('?cal_vista=semana&cal_tipo=carrusel'), { view: 'semana', type: 'carrusel' });
});
test('duplicate scalar query uses the first occurrence; canonical changes collapse duplicates', () => {
  assert.deepEqual(read('?cal_vista=semana&cal_vista=mes&cal_tipo=video&cal_tipo=carrusel'), { view: 'semana', type: 'video' });
  assert.deepEqual(read('?cal_vista=bad&cal_vista=semana&cal_tipo=bad&cal_tipo=video'), defaults);
  const url = new URL(buildContextUrl('https://render.test/planificacion-publicaciones?cal_vista=semana&cal_vista=mes&cal_tipo=video&cal_tipo=carrusel#piece', changes({ view: 'semana', type: 'video' })), 'https://render.test');
  assert.deepEqual(url.searchParams.getAll('cal_vista'), ['semana']);
  assert.deepEqual(url.searchParams.getAll('cal_tipo'), ['video']); assert.equal(url.hash, '#piece');
});
test('calendar URL changes preserve tab/client/month, unrelated query and hash; defaults remove only owned keys', () => {
  const original = 'https://render.test/planificacion-publicaciones?tab=calendario&cliente=17&mes=2026-10&other=keep#piece';
  const updated = buildContextUrl(original, changes({ view: 'semana', type: 'carrusel' }));
  assert.deepEqual(read(new URL(updated, original).search), { view: 'semana', type: 'carrusel' });
  assert.equal(buildContextUrl(new URL(updated, original).href, changes(defaults)), new URL(original).pathname + new URL(original).search + '#piece');
});

function callbackFixture({ current = true, allow = true, context = defaults } = {}) {
  const events = [];
  const deps = { capture: () => ({ current: () => current }), calendarContext: context,
    normalizePublicationCalendarContext: normalize, publicationCalendarUrlChanges: changes,
    approveContextChange: value => { events.push(['approve', value]); return allow; },
    pushUrlContext: value => events.push(['push', value]), setCalendarContext: value => events.push(['set', value]) };
  return { events, run: evaluate(initializer('cambiarCalendario'), deps) };
}
test('actual parent callback merges partial context and approves before URL push and state change', () => {
  assert.equal(file.parseDiagnostics.length, 0);
  for (const [context, partial, expected] of [[{ view: 'semana', type: 'todos' }, { type: 'video' }, { view: 'semana', type: 'video' }], [{ view: 'mes', type: 'carrusel' }, { view: 'semana' }, { view: 'semana', type: 'carrusel' }]]) {
    const f = callbackFixture({ context }); f.run(partial);
    assert.deepEqual(f.events, [['approve', changes(expected)], ['push', changes(expected)], ['set', expected]]);
  }
});
test('actual parent callback denies all writes when rejected, stale, or unchanged', () => {
  const denied = callbackFixture({ allow: false }); denied.run({ view: 'semana' });
  assert.deepEqual(denied.events, [['approve', changes({ view: 'semana' })]]);
  const stale = callbackFixture({ current: false }); stale.run({ type: 'video' }); assert.deepEqual(stale.events, []);
  for (const partial of [{}, { view: 'mes' }, { type: 'todos' }, { view: 'invalid', type: 'invalid' }]) {
    const f = callbackFixture(); f.run(partial); assert.deepEqual(f.events, []);
  }
});
test('actual initialization reads URL; canonical replacement includes calendar keys without pushing', () => {
  const state = nodes(parent, n => ts.isVariableDeclaration(n) && text(n.name) === '[calendarContext, setCalendarContext]')[0];
  const initial = evaluate(state.initializer.arguments[0], { readPublicationCalendarContext: read, window: { location: { search: '?cal_vista=semana&cal_tipo=video' } } });
  assert.deepEqual(initial(), { view: 'semana', type: 'video' });
  const effect = nodes(parent, n => ts.isCallExpression(n) && text(n.expression) === 'useEffect').find(n => text(n.arguments[0]).includes('replaceUrlContext'));
  assert.match(text(effect.arguments[1]), /calendarContext/);
  const calls = [];
  evaluate(effect.arguments[0], { tabPrincipal: 'calendario', clienteSeleccionado: 17, year: 2026, month: 9,
    calendarContext: { view: 'semana', type: 'video' }, publicationCalendarUrlChanges: changes, formatMonthContext,
    replaceUrlContext: value => calls.push(value), pushUrlContext: () => assert.fail('Canonical effect must not push') })();
  assert.deepEqual(calls, [{ tab: 'calendario', cliente: 17, mes: '2026-10', cal_vista: 'semana', cal_tipo: 'video' }]);
});
test('actual Back/Forward restoration restores calendar context and cleans listener with no URL writes or prompts', () => {
  const effect = nodes(parent, n => ts.isCallExpression(n) && text(n.expression) === 'useEffect').find(n => text(n.arguments[0]).includes('addEventListener("popstate"'));
  const listeners = new Map(), calls = [];
  const window = { location: { search: '' }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name, fn) => { assert.equal(listeners.get(name), fn); listeners.delete(name); } };
  const forbidden = () => assert.fail('Restoration cannot write history or request consent');
  const deps = { window, hoyDate: new Date('2026-10-20T12:00:00Z'), readUrlContext, readMonthContext, readPublicationCalendarContext: read,
    pushUrlContext: forbidden, replaceUrlContext: forbidden, approveContextChange: forbidden,
    setTabPrincipal: value => calls.push(['tab', value]), setClienteSeleccionado: value => calls.push(['client', value]),
    setYear: value => calls.push(['year', value]), setMonth: value => calls.push(['month', value]), setCalendarContext: value => calls.push(['calendar', value]) };
  const cleanup = evaluate(effect.arguments[0], deps)();
  for (const [search, expected] of [['?tab=calendario&cliente=17&mes=2026-08&cal_vista=semana&cal_tipo=carrusel', { view: 'semana', type: 'carrusel' }], ['?tab=calendario&cliente=17&mes=2026-08', defaults]]) {
    calls.length = 0; window.location.search = search; listeners.get('popstate')();
    assert.deepEqual(calls, [['tab', 'calendario'], ['client', 17], ['year', 2026], ['month', 7], ['calendar', expected]]);
  }
  cleanup(); assert.equal(listeners.size, 0);
});
test('actual child is controlled by parent props and delegates view/type handlers as partial changes', () => {
  const tag = nodes(parent, n => ts.isJsxSelfClosingElement(n) && text(n.tagName) === 'PublicacionesCalendarioTab')[0];
  for (const [name, expression] of [['calendarContext', 'calendarContext'], ['onCalendarContextChange', 'cambiarCalendario']]) {
    const attr = tag.attributes.properties.find(n => n.name?.text === name); assert.equal(text(attr.initializer.expression), expression);
  }
  const declaration = nodes(child, n => ts.isVariableDeclaration(n) && text(n.name).includes('filtroTipo') && text(n.name).includes('vista'))[0];
  assert.deepEqual(evaluate(declaration.initializer, { normalizePublicationCalendarContext: normalize, calendarContext: { view: 'semana', type: 'video' } }), { view: 'semana', type: 'video' });
  const handlers = nodes(child, n => ts.isJsxAttribute(n) && ['onClick', 'onChange'].includes(n.name.text) && text(n.initializer).includes('onCalendarContextChange'));
  assert.equal(handlers.length, 3);
  const calls = [];
  for (const attr of handlers) evaluate(attr.initializer.expression, { onCalendarContextChange: value => calls.push(value) })({ target: { value: 'carrusel' } });
  assert.deepEqual(calls, [{ view: 'mes' }, { view: 'semana' }, { type: 'carrusel' }]);
  assert.equal(nodes(child, n => ts.isVariableDeclaration(n) && /setVista|setFiltroTipo/.test(text(n.name))).length, 0);
});
