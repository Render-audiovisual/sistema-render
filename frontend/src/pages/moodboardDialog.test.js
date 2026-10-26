import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

// Actual JSX/callback contracts, not native-browser focus or top-layer proof.
const source = readFileSync(new URL('./MoodboardPreview.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('MoodboardPreview.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
function nodes(root, predicate) {const found = []; const walk = node => {if (predicate(node)) found.push(node); ts.forEachChild(node, walk);}; walk(root); return found;}
const component = name => {const value = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name); assert.ok(value, name); return value;};
const attr = (node, name) => node.attributes.properties.find(value => value.name?.getText(file) === name);
function expression(node, name) {const value = attr(node, name); assert.ok(value, `Actual ${name} prop`); assert.ok(value.initializer && ts.isJsxExpression(value.initializer)); return value.initializer.expression;}
const literal = (node, name) => attr(node, name)?.initializer?.text;
function evaluate(node, deps) {const js = ts.transpileModule(`const callback=(${node.getText(file)});`, {
  compilerOptions: {target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, module: ts.ModuleKind.None},
}).outputText; return new Function(...Object.keys(deps), `${js};return callback;`)(...Object.values(deps));}
const local = (root, name) => {const value = nodes(root, ts.isVariableDeclaration).find(node => node.name.getText(file) === name); assert.ok(value, name); return value.initializer;};
const openingNodes = root => nodes(root, node => ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node));

for (const [name, label, contentClass] of [['Composer', 'Nueva referencia', 'moodboard-composer'],
  ['CategoryEditor', 'Editar categorías', 'moodboard-category-modal'], ['ReferencePanel', 'Referencia visual', 'moodboard-detail-panel']]) {
  test(`${name} uses the single shared native kernel with explicit focus refs and existing guarded leave`, () => {
    const root = component(name), openings = openingNodes(root);
    const dialogs = openings.filter(node => node.tagName.getText(file) === 'Modal');
    assert.equal(dialogs.length, 1, 'Custom overlay must migrate to one shared Modal');
    const modal = dialogs[0];
    assert.ok(attr(modal, 'native')); assert.equal(attr(modal, 'native').initializer, undefined);
    assert.equal(evaluate(expression(modal, 'chrome'), {}), false);
    assert.equal(literal(modal, 'overlayAriaLabel'), label);
    assert.equal(expression(modal, 'onClose').getText(file), 'leave', 'Never bypass existing draft/recovery guards');
    assert.equal(expression(modal, 'returnFocusRef').getText(file), 'returnFocusRef');
    const focusRef = expression(modal, 'initialFocusRef').getText(file);
    const focusTarget = openings.find(node => attr(node, 'ref') && expression(node, 'ref').getText(file) === focusRef);
    assert.ok(focusTarget, 'Initial focus ref must belong to an actual rendered target');
    const close = openings.find(node => node.tagName.getText(file) === 'button' && literal(node, 'aria-label')?.startsWith('Cerrar'));
    assert.ok(close, 'Named custom close button remains independently guarded');
    if (name === 'ReferencePanel' || name === 'CategoryEditor') {
      assert.equal(focusTarget.tagName.getText(file), name === 'ReferencePanel' ? 'aside' : 'section');
      assert.equal(literal(focusTarget, 'className'), contentClass);
      assert.equal(evaluate(expression(focusTarget, 'tabIndex'), {}), -1);
      assert.equal(attr(focusTarget, 'disabled'), undefined, 'Initial container focus must remain available while close is disabled during hydration');
      assert.equal(attr(focusTarget, 'inert'), undefined);
      assert.notStrictEqual(focusTarget, close);
    } else assert.strictEqual(focusTarget, close);
    assert.ok(literal(close, 'aria-label').startsWith('Cerrar'));
    assert.equal(expression(close, 'onClick').getText(file), 'leave');
    assert.ok(openings.some(node => literal(node, 'className') === contentClass), 'Existing inner form/panel styling remains');
    const backdrop = openings.find(node => literal(node, 'className') === 'moodboard-panel-backdrop');
    assert.ok(backdrop); assert.equal(evaluate(expression(backdrop, 'tabIndex'), {}), -1);
    const hidden = attr(backdrop, 'aria-hidden'); assert.ok(hidden);
    assert.equal(hidden.initializer?.text === 'true' || hidden.initializer?.expression?.getText(file) === 'true', true);
    assert.equal(expression(backdrop, 'onClick').getText(file), 'leave');
    const flags = name === 'ReferencePanel'
      ? [{busy: false, model: {snapshot: {busy: false, locked: true}}, write: {busy: false, snapshot: {locked: false}}},
        {busy: true, model: {snapshot: {busy: false}}, write: {busy: false, snapshot: {locked: false}}},
        {busy: false, model: {snapshot: {busy: true}}, write: {busy: false, snapshot: {locked: false}}},
        {busy: false, model: {snapshot: {busy: false}}, write: {busy: true, snapshot: {locked: false}}},
        {busy: false, model: {snapshot: {busy: false}}, write: {busy: false, snapshot: {locked: true}}}]
      : [{busy: false}, {busy: true}];
    for (const [index, deps] of flags.entries()) {
      const expected = index !== 0;
      // ReferencePanel aliases write.snapshot as writeState in its real render.
      const scope = {...deps, writeState: deps.write?.snapshot};
      assert.equal(evaluate(expression(modal, 'closeDisabled'), scope), expected);
      assert.equal(evaluate(expression(close, 'disabled'), scope), expected);
    }
    assert.equal(nodes(root, node => ts.isCallExpression(node) && /addEventListener/.test(node.expression.getText(file))
      && /keydown|Escape/.test(node.getText(file))).length, 0, 'No second global Escape implementation');
  });
}

test('parent passes one explicit captured invoker ref into all three connected overlays', () => {
  const root = component('MoodboardContent'), openings = openingNodes(root);
  const refs = ['Composer', 'CategoryEditor', 'ReferencePanel'].map(name => {
    const node = openings.find(node => node.tagName.getText(file) === name); assert.ok(node);
    return expression(node, 'returnFocusRef').getText(file);
  });
  assert.deepEqual(refs, ['overlayInvoker', 'overlayInvoker', 'overlayInvoker']);
  const initializer = local(root, 'overlayInvoker');
  assert.equal(initializer.expression.getText(file), 'useRef'); assert.equal(initializer.arguments[0].getText(file), 'null');
});

for (const kind of ['composer', 'category', 'panel']) test(`actual ${kind} launcher captures currentTarget only when opening is admitted`, () => {
  const root = component('MoodboardContent'); let callback;
  if (kind === 'panel') callback = expression(openingNodes(root).find(node => node.tagName.getText(file) === 'Card'), 'open');
  else {
    const text = kind === 'composer' ? 'Nueva referencia' : 'Editar categorías';
    const button = nodes(root, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'button'
      && node.children.some(child => ts.isJsxText(child) && child.text.includes(text)))[0];
    assert.ok(button); callback = expression(button.openingElement, 'onClick');
  }
  for (const blocked of [false, true]) {
    const previous = {}, target = {}, overlayInvoker = {current: previous}, opens = [];
    const deps = {overlayInvoker, operationOwners: {current: new Set(blocked ? [Symbol()] : [])},
      operationObservation: {current: Symbol()}, loading: false, taskContextBlocked: false, item: {id: 7},
      setComposer: value => opens.push(value), setCategoryEditor: value => opens.push(value), setSelected: value => opens.push(value)};
    evaluate(callback, deps)({currentTarget: target});
    assert.strictEqual(overlayInvoker.current, blocked ? previous : target);
    assert.equal(opens.length, blocked ? 0 : 1);
    if (!blocked) {evaluate(callback, deps)(); assert.strictEqual(overlayInvoker.current, target, 'Callback without DOM event cannot erase the last connected invoker');}
  }
});

test('actual Card is a keyboard button: Space/Enter prevent scrolling and forward the exact invoker event', () => {
  const article = openingNodes(component('Card')).find(node => node.tagName.getText(file) === 'article');
  assert.equal(literal(article, 'role'), 'button'); assert.equal(literal(article, 'tabIndex'), '0');
  for (const key of ['Enter', ' ', 'Escape', 'a']) {
    const calls = [], event = {key, currentTarget: {}, preventDefault() {calls.push('prevent');}};
    evaluate(expression(article, 'onKeyDown'), {open: value => calls.push(value)})(event);
    assert.deepEqual(calls, ['Enter', ' '].includes(key) ? ['prevent', event] : []);
  }
  const event = {currentTarget: {}}, calls = [];
  evaluate(expression(article, 'onClick'), {open: value => calls.push(value)})(event);
  assert.deepEqual(calls, [event]);
});

test('actual Composer leave retains dirty cancel and uncertain recovery instead of directly closing', () => {
  let closed = 0, allowed = false; const errors = [];
  const deps = {operation: {busy: false}, getModel: () => ({snapshot: {phase: 'idle'}}),
    captureCurrent: () => ({current: () => true}), setError: value => errors.push(value), close: () => closed++,
    CustomEvent: class {}, window: {location: {href: 'https://render.test/moodboards'}, dispatchEvent: () => allowed}};
  const leave = evaluate(local(component('Composer'), 'leave'), deps);
  leave(); assert.equal(closed, 0); allowed = true; leave(); assert.equal(closed, 1);
  deps.operation.busy = true; leave(); assert.equal(closed, 1); deps.operation.busy = false;
  const uncertain = evaluate(local(component('Composer'), 'leave'), {...deps, getModel: () => ({snapshot: {phase: 'creation_uncertain'}})});
  uncertain(); assert.equal(closed, 1); assert.equal(errors.length, 1);
});

test('actual CategoryEditor leave preserves cancellation and unresolved batch guard', () => {
  let closed = 0, allowed = false; const errors = [];
  const holder = {current: {pending: false, model: {snapshot: {busy: false, phase: 'idle'}}}};
  const leave = evaluate(local(component('CategoryEditor'), 'leave'), {holder, approveDiscard: () => allowed,
    close: () => closed++, setError: value => errors.push(value)});
  leave(); assert.equal(closed, 0); allowed = true; leave(); assert.equal(closed, 1);
  holder.current.pending = true; leave(); assert.equal(closed, 1); holder.current.pending = false;
  holder.current.model.snapshot.phase = 'uncertain'; leave(); assert.equal(closed, 1); assert.equal(errors.length, 1);
});
