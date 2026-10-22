import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Execute the actual callback extracted from canonical JSX. This is not a
// mounted React test or a claim about native dialog/browser behavior.
const source = readFileSync(new URL('./Productions.jsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('Productions.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
assert.equal(tree.parseDiagnostics.length, 0);
function find(root, predicate) {
  const found = [];
  function visit(node) { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); }
  visit(root); return found;
}
const page = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ProductionsPage');
assert.ok(page);
const declarations = find(page, node => ts.isVariableDeclaration(node) && node.name.getText(tree) === 'startCreateVisit');
assert.equal(declarations.length, 1, 'One canonical named create-entry callback');
const initializer = declarations[0].initializer;
assert.ok(ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer));
function callback(bindings) {
  return Function(...Object.keys(bindings), `return (${initializer.getText(tree)});`)(...Object.values(bindings));
}
function harness({ creating, dirty = false, uncertain = false, busy = false, allow = true }) {
  const draft = { titulo: 'Borrador conservado', cliente_id: '37', observaciones: 'Sin enviar' };
  const pendingIntent = uncertain ? { request_id: '11111111-1111-4111-8111-111111111111', body: JSON.stringify(draft) } : null;
  const state = { creating, detailLoading: true, selected: { id: 'observed-visit' }, dirty: new Set(dirty ? ['create'] : []), draft, pendingIntent, busy };
  const effects = [], openVersion = { current: 19 };
  let asks = 0;
  const deps = {
    creating, openVersion,
    mayLeave() {
      asks++;
      effects.push(['mayLeave']);
      if (busy || !allow) return false;
      state.dirty.clear();
      return true;
    },
    setDetailLoading(value) { effects.push(['detailLoading', value, openVersion.current]); state.detailLoading = value; },
    setSelected(value) { effects.push(['selected', value]); state.selected = value; },
    setCreating(value) { effects.push(['creating', value]); state.creating = value; },
  };
  return { state, effects, openVersion, deps, asks: () => asks };
}

for (const [name, flags] of [
  ['clean', {}],
  ['dirty', { dirty: true }],
  ['uncertain create receipt', { dirty: true, uncertain: true }],
  ['busy', { dirty: true, uncertain: true, busy: true }],
]) {
  test(`already creating (${name}) is a strict no-op before mayLeave`, () => {
    const h = harness({ creating: true, ...flags });
    const before = structuredClone(h.state), draft = h.state.draft, pendingIntent = h.state.pendingIntent;
    h.deps.mayLeave = () => assert.fail('Reentry must not ask, clear dirty or touch the recovery intent');
    callback(h.deps)();
    assert.deepEqual(h.effects, []);
    assert.equal(h.openVersion.current, 19);
    assert.deepEqual(h.state, before);
    assert.equal(h.state.draft, draft);
    assert.equal(h.state.pendingIntent, pendingIntent);
  });
}

for (const [name, flags] of [['discard refused', { allow: false }], ['operation busy', { busy: true }]]) {
  test(`initial create denied (${name}) preserves all observations`, () => {
    const h = harness({ creating: false, dirty: true, uncertain: true, ...flags });
    const before = structuredClone(h.state);
    callback(h.deps)();
    assert.equal(h.asks(), 1);
    assert.deepEqual(h.effects, [['mayLeave']]);
    assert.equal(h.openVersion.current, 19);
    assert.deepEqual(h.state, before);
  });
}

test('accepted initial entry fences the old detail and opens exactly once; next creating observation is no-op', () => {
  const h = harness({ creating: false, dirty: true });
  callback(h.deps)();
  assert.equal(h.asks(), 1);
  assert.equal(h.openVersion.current, 20);
  assert.deepEqual(h.effects, [['mayLeave'], ['detailLoading', false, 20], ['selected', null], ['creating', true]]);
  assert.equal(h.state.creating, true);
  assert.equal(h.state.detailLoading, false);
  assert.equal(h.state.selected, null);
  // A new render supplies the new creating primitive. Do not pretend an
  // extracted callback simulates React batching or two pre-render clicks.
  callback({ ...h.deps, creating: h.state.creating })();
  assert.equal(h.asks(), 1);
  assert.equal(h.openVersion.current, 20);
  assert.equal(h.effects.length, 4);
});

test('the actual Nueva visita button delegates to the named callback and keeps native busy disabling', () => {
  const buttons = find(page, node => ts.isJsxElement(node)
    && node.openingElement.tagName.getText(tree) === 'button'
    && node.children.some(child => ts.isJsxText(child) && child.text.trim() === 'Nueva visita'));
  assert.equal(buttons.length, 1);
  const attribute = name => buttons[0].openingElement.attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.text === name);
  const click = attribute('onClick')?.initializer;
  assert.ok(ts.isJsxExpression(click) && ts.isIdentifier(click.expression));
  assert.equal(click.expression.text, 'startCreateVisit');
  const disabled = attribute('disabled')?.initializer;
  assert.ok(ts.isJsxExpression(disabled) && ts.isIdentifier(disabled.expression));
  assert.equal(disabled.expression.text, 'busy');
  assert.equal(attribute('type')?.initializer?.text, 'button');
});
