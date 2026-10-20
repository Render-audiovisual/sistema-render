import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Actual JSX AST and extracted controller callbacks with isolated spies only.
// No React mount, browser/history integration, storage integration or duplicate
// tests of Carson's pure context policy. Main owns actual browser verification.
const source = readFileSync(new URL('./HomeEditorialControl.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('HomeEditorialControl.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const component = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'HomeEditorialControl');
assert.ok(component?.body);
const text = n => n.getText(file);
const nodes = (root, predicate) => {
  const result = [];
  const visit = n => { if (predicate(n)) result.push(n); ts.forEachChild(n, visit); };
  visit(root); return result;
};
const calls = (root, name) => nodes(root, n => ts.isCallExpression(n) && text(n.expression) === name);
const declaration = name => nodes(component.body, n => ts.isVariableDeclaration(n) && text(n.name) === name)[0];
const callback = name => {
  const value = declaration(name)?.initializer;
  assert.ok(value && ts.isArrowFunction(value), `${name} actual callback exists`); return value;
};
const compact = n => text(n).replace(/\s+/g, '');
const execute = (node, bindings) => new Function(...Object.keys(bindings), `return (${text(node)});`)(...Object.values(bindings));
const effect = calls(component.body, 'useEffect').find(n => calls(n.arguments[0], 'createHomeEditorialLoader').length);
assert.ok(effect);

test('effect applies real closed URL/preference context before initial loader refresh using only current user ID', () => {
  const imported = file.statements.find(n => ts.isImportDeclaration(n) && n.moduleSpecifier.text === './homeEditorialViewContext.js');
  assert.ok(imported);
  const names = imported.importClause.namedBindings.elements.map(n => n.name.text);
  for (const name of ['readEditorialLocation', 'loadEditorialView', 'saveEditorialView', 'normalizeEditorialView', 'editorialViewUrl']) assert.ok(names.includes(name));
  const apply = callback('applyLocation');
  const first = apply.body.statements[0];
  assert.ok(ts.isIfStatement(first));
  assert.match(compact(first.expression), /window.location.pathname!==['"]\/inicio['"]/);
  assert.match(compact(first.expression), /identityRef.current!==identity/);
  const selected = nodes(apply, n => ts.isVariableDeclaration(n) && text(n.name) === 'selected')[0];
  assert.ok(selected);
  assert.equal(compact(selected.initializer), 'fromUrl??loadEditorialView(storage,id)');
  const refresh = calls(apply, 'loader.refresh'); assert.equal(refresh.length, 1);
  assert.deepEqual(refresh[0].arguments.map(text), ['selected']);
  const save = calls(apply, 'saveEditorialView'); assert.equal(save.length, 1);
  assert.deepEqual(save[0].arguments.map(text), ['storage', 'id', 'selected']);
  const replace = calls(apply, 'window.history.replaceState'); assert.equal(replace.length, 1);
  assert.deepEqual(replace[0].arguments.slice(0, 2).map(text), ['window.history.state', "''"]);
  const url = nodes(apply, n => ts.isVariableDeclaration(n) && n.initializer
    && ts.isCallExpression(n.initializer) && text(n.initializer.expression) === 'editorialViewUrl')[0];
  assert.ok(url);
  assert.equal(text(replace[0].arguments[2]), text(url.name), 'Replace with the closed context helper output');
  assert.ok(replace[0].pos < save[0].pos && save[0].pos < refresh[0].pos);
  const topCalls = effect.arguments[0].body.statements.filter(ts.isExpressionStatement).map(n => n.expression);
  assert.ok(topCalls.some(n => ts.isCallExpression(n) && text(n.expression) === 'applyLocation'), 'Initial load uses URL application, not bare default refresh');
  assert.equal(calls(effect.arguments[0], 'loader.refresh').filter(n => n.arguments.length === 0).length, 0);
});

test('invalid URL clears selection/data with safe error and never falls back, writes preference/history or fetches', () => {
  const identity = {}, events = [], selectionRef = { current: { bucket: 'today', offset: 0 } };
  const apply = execute(callback('applyLocation'), {
    window: { location: { pathname: '/inicio', search: '?invalid', href: 'https://render.test/inicio?invalid' },
      history: { replaceState: () => events.push('history') } },
    identityRef: { current: identity }, identity, selectionRef, storage: {}, id: 42,
    readEditorialLocation: () => { throw new Error('Invalid context'); },
    loadEditorialView: () => events.push('fallback'), saveEditorialView: () => events.push('save'),
    editorialViewUrl: () => events.push('url'), loader: { refresh: () => events.push('fetch') },
    setResult: value => events.push(value),
  });
  apply();
  assert.equal(selectionRef.current, null);
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'error'); assert.equal(events[0].data, null);
  assert.equal(events[0].identity, identity); assert.equal(typeof events[0].error, 'string');
});

test('onChange accepts only current identity AND selected bucket/page, not a late prior selection', () => {
  const create = calls(effect.arguments[0], 'createHomeEditorialLoader')[0];
  const onChange = create.arguments[0].properties.find(n => ts.isPropertyAssignment(n) && text(n.name) === 'onChange').initializer;
  const identity = {}, identityRef = { current: identity }, selectionRef = { current: { bucket: 'blocked', offset: 20 } }, results = [];
  const update = execute(onChange, { identity, identityRef, selectionRef, setResult: value => results.push(value) });
  update({ bucket: 'today', offset: 20 }); update({ bucket: 'blocked', offset: 0 });
  assert.deepEqual(results, []);
  update({ bucket: 'blocked', offset: 20, status: 'ready' }); assert.equal(results.length, 1);
  selectionRef.current = null; update({ bucket: 'blocked', offset: 20 }); assert.equal(results.length, 1);
  selectionRef.current = { bucket: 'blocked', offset: 20 }; identityRef.current = {};
  update({ bucket: 'blocked', offset: 20 }); assert.equal(results.length, 1);
});

test('popstate is deferred while record is open and applied once only after synchronous close notification', () => {
  const recordOpenRef = { current: true }, deferredLocationRef = { current: null }, events = [];
  const applyLocation = () => events.push('apply');
  const pop = execute(callback('onLocation'), { recordOpenRef, deferredLocationRef, applyLocation });
  pop(); pop(); assert.deepEqual(events, []); assert.equal(deferredLocationRef.current, applyLocation);
  const memo = declaration('changeRecordOpen').initializer;
  const change = execute(memo.arguments[0], { recordOpenRef, deferredLocationRef,
    setRecordOpen: open => { assert.equal(recordOpenRef.current, open); events.push(['state', open]); },
    onRecordOpenChange: open => events.push(['parent', open]),
  });
  change(false);
  assert.deepEqual(events, [['state', false], ['parent', false], 'apply']);
  assert.equal(deferredLocationRef.current, null);
  pop(); assert.equal(events.at(-1), 'apply');
  const subscription = calls(effect.arguments[0], 'window.addEventListener').find(n => n.arguments[0]?.text === 'popstate');
  assert.ok(subscription); assert.equal(text(subscription.arguments[1]), 'onLocation');
});

test('effect cleanup removes exact popstate listener, clears deferred context and disposes its own loader', () => {
  const cleanup = nodes(effect.arguments[0], ts.isReturnStatement).find(n => n.expression && ts.isArrowFunction(n.expression));
  assert.ok(cleanup);
  const events = [], onLocation = () => {}, loader = { dispose: () => events.push('dispose') };
  const deferredLocationRef = { current: () => events.push('stale apply') }, loaderRef = { current: loader };
  execute(cleanup.expression, { window: { removeEventListener: (type, listener) => {
    assert.equal(type, 'popstate'); assert.equal(listener, onLocation); events.push('remove');
  } }, onLocation, deferredLocationRef, loaderRef, loader, unsubscribe: () => events.push('unsubscribe') })();
  assert.equal(deferredLocationRef.current, null); assert.equal(loaderRef.current, null);
  assert.deepEqual(events, ['remove', 'unsubscribe', 'dispose']);
  const deps = effect.arguments[1].elements.map(text);
  for (const name of ['identity', 'allowed', 'id', 'role', 'active', 'token']) assert.ok(deps.includes(name));
});

test('selectPage refuses modal/loading absence and verifies committed URL before user-scoped persistence and fetch', () => {
  const state = { current: true }, events = [], selected = { bucket: 'overdue', offset: 20 }, selectionRef = { current: null };
  let actual = selected;
  const storage = {}, historyState = { draft: 'preserve' }, window = { localStorage: storage,
    location: { href: 'https://render.test/inicio', search: '?view' },
    history: { state: historyState, pushState: (value, title, href) => { assert.equal(value, historyState); events.push(['push', href]); } } };
  const loaderRef = { current: { refresh: value => events.push(['fetch', value]) } };
  const select = execute(callback('selectPage'), { recordOpenRef: state, loaderRef, selectionRef, bucket: 'today', id: 42, window,
    normalizeEditorialView: value => { events.push(['normalize', value]); return selected; },
    editorialViewUrl: () => '/inicio?view', readEditorialLocation: () => actual,
    saveEditorialView: (target, id, value) => { assert.equal(target, storage); assert.equal(id, 42); events.push(['save', value]); },
  });
  select({ bucket: 'overdue', offset: 20 }); assert.deepEqual(events, []);
  state.current = false; const loader = loaderRef.current; loaderRef.current = null;
  select({ bucket: 'overdue', offset: 20 }); assert.deepEqual(events, []); loaderRef.current = loader;
  actual = { bucket: 'today', offset: 0 }; select({ bucket: 'overdue', offset: 20 });
  assert.equal(selectionRef.current, null); assert.ok(!events.some(e => e[0] === 'save' || e[0] === 'fetch'));
  events.length = 0; actual = selected; select({ bucket: 'overdue', offset: 20 });
  assert.equal(selectionRef.current, selected); assert.deepEqual(events.map(e => e[0]), ['normalize', 'push', 'save', 'fetch']);
  assert.deepEqual(events.at(-1), ['fetch', selected]);
});
