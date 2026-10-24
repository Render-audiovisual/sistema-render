import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { notifyViewPreferenceChange } from '../shared/navigation/viewPreferenceEvent.js';
import { buildContextUrl } from '../shared/navigation/url-context.js';
import { goalClientLocationUrl, parseGoalClientId } from './clientGoalLocation.js';

function tree(path) { return ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX); }
const goals = tree('./ClientesObjetivos.jsx'), reports = tree('./Reportes.jsx');
const context = tree('../shared/navigation/url-context.js');
function find(root, predicate) {
  const result = []; function walk(n) { if (predicate(n)) result.push(n); ts.forEachChild(n, walk); }
  walk(root); assert.equal(result.length, 1); return result[0];
}
const fn = (root, name) => find(root, n => ts.isFunctionDeclaration(n) && n.name?.text === name);
const variable = name => find(goals, n => ts.isVariableDeclaration(n) && n.name.getText(goals) === name).initializer;
function evaluate(node, file, deps) {
  const text = node.getText(file).replace(/^export\s+/, '');
  return Function(...Object.keys(deps), `return (${text});`)(...Object.values(deps));
}
function browser(href) {
  const events = [], writes = [], order = [], state = { opaque: 'Keep' };
  const win = { location: new URL(href), history: { state }, CustomEvent: class { constructor(type) { this.type = type; } },
    dispatchEvent(event) { events.push({ type: event.type, href: win.location.href }); order.push(event.type); return true; } };
  for (const method of ['replaceState', 'pushState']) win.history[method] = (held, title, url) => {
    writes.push({ method, state: held, title, url: String(url) }); order.push(method); win.location = new URL(url, win.location);
  };
  return { win, events, writes, order };
}
const notices = h => h.events.filter(e => e.type === 'render:view-preference-change');
function goalFixture() {
  const h = browser('https://render.test/clientes?cliente=7&periodo=2026-10&other=keep#detail');
  const deps = { window: h.win, notifyViewPreferenceChange, goalClientLocationUrl, parseGoalClientId,
    goalPeriod: evaluate(fn(goals, 'goalPeriod'), goals, { currentMonth: () => '2026-10' }),
    capture: () => ({ current: () => true, request: () => new Promise(() => {}) }),
    requestAppNavigation: () => true, PopStateEvent: h.win.CustomEvent,
    selectedClientId: 7, period: '2026-10', modalOpen: { current: false }, preparing: false,
    activeHref: { current: h.win.location.href }, pendingPeriod: { current: null }, deferred: { current: false },
    readGeneration: { current: 0 }, loaded: { current: true }, locationError: '',
    AbortController,
  };
  for (const name of ['Period', 'SelectedClientId', 'LocationError', 'Notice', 'Preparing', 'SelectedPiece', 'Loading', 'Revision', 'Error', 'Data']) deps[`set${name}`] = () => {};
  return { ...h, deps };
}

test('report canonical period effect and click use actual URL helpers, then notify, without extra entries/popstate', () => {
  const effect = find(reports, n => ts.isCallExpression(n) && n.expression.getText(reports) === 'useEffect' && n.arguments[0].getText(reports).includes('replaceUrlContext(')).arguments[0];
  const click = find(reports, n => ts.isJsxAttribute(n) && n.name.getText(reports) === 'onClick' && n.initializer?.getText(reports).includes('pushUrlContext(')).initializer.expression;
  for (const kind of ['effect', 'click']) {
    const h = browser('https://render.test/reportes?selectedPerson=7#details');
    const deps = { window: h.win, notifyViewPreferenceChange, period: 'mes_pasado', id: 'ultimos_30', setPeriod() {},
      replaceUrlContext: evaluate(fn(context, 'replaceUrlContext'), context, { window: h.win, buildContextUrl }),
      pushUrlContext: evaluate(fn(context, 'pushUrlContext'), context, { window: h.win, buildContextUrl }) };
    const run = evaluate(kind === 'effect' ? effect : click, reports, deps);
    run();
    assert.deepEqual(h.order, [kind === 'effect' ? 'replaceState' : 'pushState', 'render:view-preference-change']);
    assert.equal(h.writes.length, 1); assert.equal(notices(h).length, 1);
    assert.equal(h.events[0].href, h.win.location.href);
    assert.equal(h.win.location.searchParams.get('periodo'), kind === 'effect' ? 'mes_pasado' : 'ultimos_30');
    assert.equal(h.win.location.searchParams.get('selectedPerson'), '7'); assert.equal(h.win.location.hash, '#details');
    h.win.history[kind === 'effect' ? 'replaceState' : 'pushState'] = () => { throw new Error('History failed'); };
    assert.throws(run, /History failed/); assert.equal(notices(h).length, 1);
  }
});

test('actual goal context change notifies after push and keeps its one existing popstate; noop/veto/obsolete/modal do not notify', () => {
  const h = goalFixture(), change = () => evaluate(fn(goals, 'changeGoalContext'), goals, h.deps);
  assert.equal(change()({ clientId: 8 }), true);
  assert.deepEqual(h.order, ['pushState', 'render:view-preference-change', 'popstate']);
  assert.equal(h.writes[0].state, h.win.history.state); assert.equal(notices(h)[0].href, h.win.location.href);
  assert.equal(change()({ clientId: 8 }), true); assert.equal(h.writes.length, 1);
  h.deps.requestAppNavigation = () => false; assert.equal(change()({ clientId: 9 }), false);
  h.deps.requestAppNavigation = () => true; h.deps.capture = () => ({ current: () => false });
  assert.equal(change()({ clientId: 9 }), false);
  h.deps.capture = () => ({ current: () => true }); h.deps.modalOpen.current = true;
  assert.equal(change()({ clientId: 9 }), false); assert.equal(notices(h).length, 1);
  h.deps.modalOpen.current = false; h.win.history.pushState = () => { throw new Error('History failed'); };
  assert.throws(() => change()({ clientId: 9 }), /History failed/); assert.equal(notices(h).length, 1);
});

test('actual deferred goal restoration and close apply each notify after replace, without routing events', () => {
  const h = goalFixture(), pop = evaluate(variable('pop'), goals, h.deps);
  h.deps.modalOpen.current = true;
  h.win.location = new URL('https://render.test/clientes?cliente=8&periodo=2026-11#next');
  pop();
  assert.deepEqual(h.order, ['replaceState', 'render:view-preference-change']);
  assert.equal(h.win.location.href, h.deps.activeHref.current);
  assert.equal(h.deps.pendingPeriod.current.clientId, 8);
  evaluate(variable('closeModal'), goals, h.deps)();
  assert.deepEqual(h.order, ['replaceState', 'render:view-preference-change', 'replaceState', 'render:view-preference-change']);
  assert.equal(h.win.location.searchParams.get('cliente'), '8'); assert.equal(h.win.location.searchParams.get('periodo'), '2026-11');
  assert.equal(h.deps.pendingPeriod.current, null); assert.equal(h.deps.modalOpen.current, false);
  evaluate(variable('closeModal'), goals, h.deps)(); assert.equal(notices(h).length, 2, 'No pending context means no write or notification');
});

test('actual goal canonical load effect notifies after replace; invalid context or history failure does not notify', () => {
  const effect = find(goals, n => ts.isCallExpression(n) && n.expression.getText(goals) === 'useEffect' && n.arguments[0].getText(goals).includes('goalClientLocationUrl(window.location.href')).arguments[0];
  const h = goalFixture();
  const run = () => evaluate(effect, goals, h.deps)();
  run()(); assert.deepEqual(h.order, ['replaceState', 'render:view-preference-change']);
  h.deps.locationError = 'Invalid context'; run()(); assert.equal(notices(h).length, 1);
  h.deps.locationError = ''; h.win.history.replaceState = () => { throw new Error('History failed'); };
  assert.throws(run, /History failed/); assert.equal(notices(h).length, 1);
});
