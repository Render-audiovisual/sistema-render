import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { editingDeliveryRefreshNeeded } from '../components/EditingDeliveries.model.js';

const source = readFileSync(new URL('../components/EditingDeliveries.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('EditingDeliveries.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const component = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'DeliverySection');
const find = predicate => {
  const found = [];
  function visit(n) { if (predicate(n)) found.push(n); ts.forEachChild(n, visit); }
  visit(component); return found;
};
const layout = find(n => ts.isCallExpression(n) && n.expression.getText(file) === 'useLayoutEffect')[0];
const evaluate = (node, deps) => new Function(...Object.keys(deps), `return (${node.getText(file)});`)(...Object.values(deps));
function fixture() {
  let calls = 0;
  const deps = { task: { revision: 2 }, observedRevision: { current: 1 }, dirty: false,
    state: { loading: false, busy: false, data: { task: { revision: 1 } } }, editingDeliveryRefreshNeeded,
    model: { current: { refresh() { calls++; assert.equal(deps.observedRevision.current, deps.task.revision, 'Capture before dispatch'); } } } };
  return { deps, run: () => evaluate(layout.arguments[0], deps)(), get calls() { return calls; } };
}

test('pure refresh predicate accepts only newer positive integer observations and pristine settled state', () => {
  const input = { revision: 2, observedRevision: 1, dirty: false, state: {} };
  assert.equal(editingDeliveryRefreshNeeded(input), true);
  for (const revision of [0, -1, 1.5, '2', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null]) {
    assert.equal(editingDeliveryRefreshNeeded({ ...input, revision }), false);
    assert.equal(editingDeliveryRefreshNeeded({ ...input, observedRevision: revision }), false);
  }
  for (const revision of [1, 0]) assert.equal(editingDeliveryRefreshNeeded({ ...input, revision }), false);
  for (const dirty of [true, undefined, null]) assert.equal(editingDeliveryRefreshNeeded({ ...input, dirty }), false);
  assert.equal(editingDeliveryRefreshNeeded({ ...input, state: null }), false);
  for (const flag of ['loading', 'busy', 'uncertain', 'conflict', 'error'])
    assert.equal(editingDeliveryRefreshNeeded({ ...input, state: { [flag]: true } }), false, flag);
});

test('actual layout effect refreshes N→N+1 once and matching DTO advances observation without GET', () => {
  const f = fixture(); f.run(); f.run();
  assert.equal(f.calls, 1); assert.equal(f.deps.observedRevision.current, 2);
  const matching = fixture(); matching.deps.state.data.task.revision = 2;
  matching.run(); matching.run();
  assert.equal(matching.calls, 0); assert.equal(matching.deps.observedRevision.current, 2);
});

test('actual layout effect preserves original observation and draft/recovery/pending/error without GET', () => {
  for (const flag of ['dirty', 'loading', 'busy', 'uncertain', 'conflict', 'error']) {
    const f = fixture();
    if (flag === 'dirty') f.deps.dirty = true; else f.deps.state[flag] = true;
    f.run(); f.run(); assert.equal(f.calls, 0, flag); assert.equal(f.deps.observedRevision.current, 1, flag);
  }
  const absent = fixture(); absent.deps.model.current = null; absent.run();
  assert.equal(absent.deps.observedRevision.current, 1);
});

test('actual layout effect waits for loading then refreshes once; failed GET never automatically repeats', () => {
  const f = fixture(); f.deps.state.loading = true; f.run();
  assert.equal(f.calls, 0); assert.equal(f.deps.observedRevision.current, 1);
  f.deps.state.loading = false; f.run(); assert.equal(f.calls, 1);
  f.deps.state.error = 'offline'; f.run();
  f.deps.state.error = ''; f.run(); assert.equal(f.calls, 1);
  assert.equal(f.deps.observedRevision.current, 2);
});

test('actual setup resets observed revision per fresh model and layout dependencies include every gate', () => {
  assert.equal(file.parseDiagnostics.length, 0);
  assert.deepEqual(layout.arguments[1].elements.map(n => n.getText(file)), [
    'task.revision', 'dirty', 'state.loading', 'state.busy', 'state.uncertain', 'state.conflict', 'state.error', 'state.data',
  ]);
  const init = find(n => ts.isVariableDeclaration(n) && n.name.getText(file) === 'observedRevision')[0].initializer;
  assert.equal(evaluate(init, { useRef: value => value, task: { revision: 7 } }), 7);
  const setup = find(n => ts.isCallExpression(n) && n.expression.getText(file) === 'useEffect'
    && n.arguments[0].getText(file).includes('createEditingDeliveriesModel'))[0];
  const observation = { current: -1 }, model = { current: null }; let disposed = 0, refreshed = 0;
  const instance = { refresh: () => refreshed++, dispose: () => disposed++ };
  const cleanup = evaluate(setup.arguments[0], { createEditingDeliveriesModel: () => instance,
    task: { revision: 9 }, sesion: {}, getSesion: () => null, apiRequest: () => {}, setState: () => {},
    reviewContext: { current: null }, saved: { current: null }, model, observedRevision: observation })();
  assert.equal(observation.current, 9); assert.equal(model.current, instance); assert.equal(refreshed, 1);
  cleanup(); assert.equal(disposed, 1); assert.equal(model.current, null);
});
