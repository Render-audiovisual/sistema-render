import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createPersonalListBlockCreation, reconcilePersonalListBlockCreation} from './personalListBlockCreation.js';
import {createPersonalItemDrafts} from './personalItemDrafts.js';
import {keepsPersonalListDrafts} from './personalListLocation.js';

// Actual owner effect/callbacks plus actual model. No mounted React, HTTP/PG,
// browser navigation or native-focus acceptance is inferred from these tests.
const source = readFileSync(new URL('./PersonalLists.jsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('PersonalLists.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
function nodes(root, predicate) {
  const found = []; function walk(node) {if (predicate(node)) found.push(node); ts.forEachChild(node, walk);}
  walk(root); return found;
}
const page = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'PersonalListsPage');
const declaration = name => nodes(page, ts.isVariableDeclaration).find(node => node.name.getText(ast) === name).initializer;
const lifecycle = nodes(page, ts.isCallExpression).find(node => node.expression.getText(ast) === 'useEffect'
  && node.arguments[0].getText(ast).includes('const model=createPersonalListBlockCreation'));
function evaluate(node, deps) {
  const js = ts.transpileModule(`const callback=(${node.getText(ast)});`, {
    compilerOptions: {target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, module: ts.ModuleKind.None},
  }).outputText;
  return new Function(...Object.keys(deps), `${js};return callback;`)(...Object.values(deps));
}
const key = '10000000-0000-4000-8000-000000000384';
const otherKey = '20000000-0000-4000-8000-000000000384';
const row = (patch = {}) => ({id: '71', lista_id: '1', tipo: 'texto', contenido: {texto: ''}, posicion: 1, version: 1,
  created_at: '2026-10-25T12:00:00Z', updated_at: '2026-10-25T12:00:00Z', creation_request_id: key, ...patch});
const failure = status => Object.assign(new Error('Synthetic transport failure'), {status});
function deferred() {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};}
const flush = async () => {for (let index = 0; index < 5; index++) await Promise.resolve();};
function fixture(request) {
  const calls = [], states = [], effects = [];
  const existing = {id: '11', lista_id: '1', version: 4, tipo: 'texto', contenido: {texto: 'Existing local draft'}};
  let lists = [{id: '1', titulo: 'A', bloques: [existing]}, {id: '2', titulo: 'B', bloques: []}], selected = '1';
  let live = true, flushResult = true, setups = 0;
  const deps = {
    blockCreation: {current: null}, mounted: {current: true}, pendingSaves: {current: 0},
    creation: {current: null}, itemDrafts: {current: createPersonalItemDrafts()}, statusRef: {current: 'saved'},
    currentSession: () => live, scopedRequest: async (...args) => {calls.push(args); return request(...args);},
    createPersonalListBlockCreation: options => createPersonalListBlockCreation({...options, createRequestId: () => setups === 1 ? key : otherKey}),
    reconcilePersonalListBlockCreation, keepsPersonalListDrafts,
    updateLists: transform => {lists = transform(lists);},
    window: {location: {href: 'https://render.test/lista?lista=1'}, history: {replaceState() {assert.fail('Block recovery must not navigate');}}},
    queue: {current: {flush: async () => {effects.push(['flush']); return flushResult;},
      snapshot: () => ({dirty: false, busy: false}), discard() {assert.fail('Creation must not discard autosave drafts');}}},
    setBlockCreationState: value => states.push(value),
    setStructuralBusy: value => effects.push(['structuralBusy', value]),
    setStatus: value => {deps.statusRef.current = value; effects.push(['status', value]);},
    setError: value => effects.push(['error', value]), setTemplates: value => effects.push(['templates', value]),
    setActiveId: value => {selected = value; effects.push(['selection', value]);},
  };
  const newBlock = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'newBlock');
  deps.newBlock = evaluate(newBlock, {});
  deps.runSaving = evaluate(declaration('runSaving').arguments[0], deps);
  deps.itemDrafts.current.set('1', '11', 'Unsubmitted item');
  const guard = nodes(page, ts.isCallExpression).find(node => node.expression.getText(ast) === 'useNavigationGuard').arguments[0];
  return {deps, calls, states, effects, existing, lists: () => lists, selected: () => selected,
    setup() {setups++; return evaluate(lifecycle.arguments[0], deps)();},
    add() {return evaluate(declaration('addBlock'), {...deps, activeList: lists.find(list => list.id === selected)} )('texto');},
    recover(action) {return evaluate(declaration('recoverBlockCreation'), deps)(action);},
    guard: context => evaluate(guard, deps)(context),
    select(id) {selected = id; deps.window.location.href = `https://render.test/lista?lista=${id}`;},
    retire() {live = false;}, flushFails() {flushResult = false;},
  };
}

test('actual addBlock lost ACK retains one attempt; no fresh POST or premature retry and UI cannot report saved', async () => {
  let writes = 0;
  const f = fixture(async (_, options) => {if (options.method === 'POST') {writes++; throw failure(503);} return row();});
  const cleanup = f.setup();
  try {
    await f.add(); assert.equal(f.deps.blockCreation.current.snapshot().phase, 'uncertain');
    await f.add(); await f.recover('retry'); assert.equal(writes, 1);
    assert.equal(f.lists()[0].bloques.length, 1); assert.strictEqual(f.lists()[0].bloques[0], f.existing);
    assert.equal(f.deps.itemDrafts.current.get('1', '11'), 'Unsubmitted item');
    const effective = evaluate(declaration('effectiveStatus'), {saveState: {status: 'saved', dirty: false, busy: false},
      status: 'saved', structuralBusy: false, creationState: {busy: false, unresolved: false},
      blockCreationState: f.deps.blockCreation.current.snapshot(), itemDrafts: {current: {dirty: false}}});
    assert.equal(effective, 'pending', 'Generic runSaving completion cannot falsely label an uncertain block Guardado');
    f.select('2'); await f.recover('verify');
    assert.equal(writes, 1); assert.equal(f.selected(), '2');
    assert.equal(f.lists()[0].bloques[1].id, '71'); assert.equal(f.lists()[1].bloques.length, 0);
    assert.strictEqual(f.lists()[0].bloques[0], f.existing);
    assert.equal(f.deps.itemDrafts.current.get('1', '11'), 'Unsubmitted item');
    assert.equal(f.effects.some(([name]) => name === 'selection'), false);
  } finally {cleanup();}
});

test('actual explicit GET404 then retry preserves exact body and origin list despite selecting another list', async () => {
  let writes = 0;
  const f = fixture(async (_, options) => {
    if (options.method === 'GET') throw failure(404);
    if (++writes === 1) throw failure(503); return row();
  });
  const cleanup = f.setup();
  try {
    await f.add(); const original = f.calls[0]; f.select('2');
    await f.recover('verify'); assert.equal(f.deps.blockCreation.current.snapshot().phase, 'missing');
    assert.equal(f.calls.length, 2); await f.add(); assert.equal(f.calls.length, 2);
    await f.recover('retry'); assert.equal(f.calls[2][0], original[0]);
    assert.equal(f.calls[2][1].body, original[1].body);
    assert.equal(f.selected(), '2'); assert.equal(f.lists()[0].bloques.length, 2); assert.equal(f.lists()[1].bloques.length, 0);
    await f.recover('verify'); await f.recover('retry'); assert.equal(f.calls.length, 3);
  } finally {cleanup();}
});

test('actual owner guard sees model busy/unresolved synchronously before state repaint, including internal list links', async () => {
  const waiting = deferred(), f = fixture(() => waiting.promise), cleanup = f.setup();
  try {
    const work = f.add();
    assert.deepEqual(f.guard({type: 'link', to: '/lista?lista=2'}), {dirty: false, busy: true},
      'Structural latch blocks navigation during flush before a creation intent exists');
    await flush(); assert.equal(f.calls.length, 1);
    for (const context of [{type: 'link', to: '/lista?lista=2'}, {type: 'link', to: '/inicio'}, {type: 'unload'}])
      assert.deepEqual(f.guard(context), {dirty: true, busy: true});
    await f.add(); assert.equal(f.calls.length, 1);
    waiting.reject(failure(503)); await work;
    assert.deepEqual(f.guard({type: 'link', to: '/lista?lista=2'}), {dirty: true, busy: false});
    f.retire(); assert.deepEqual(f.guard({type: 'link', to: '/inicio'}), {dirty: true, busy: false},
      'Existing unrelated local drafts remain protected; retired block model contributes no busy');
  } finally {cleanup();}
});

test('actual failed autosave flush sends no block POST, allocates no intent and keeps local drafts', async () => {
  const f = fixture(() => assert.fail('No POST after failed autosave flush')), cleanup = f.setup();
  try {
    f.flushFails(); await f.add();
    assert.equal(f.calls.length, 0); assert.equal(f.deps.blockCreation.current.snapshot().phase, 'idle');
    assert.equal(f.deps.pendingSaves.current, 0); assert.strictEqual(f.lists()[0].bloques[0], f.existing);
    assert.equal(f.deps.itemDrafts.current.get('1', '11'), 'Unsubmitted item');
  } finally {cleanup();}
});

test('actual effect cleanup/setup drops late old ACK without clearing or reconciling over replacement model', async () => {
  const delayed = deferred(); let writes = 0;
  const f = fixture(async (_, options) => ++writes === 1 ? delayed.promise : row({creation_request_id: JSON.parse(options.body).request_id}));
  const cleanupA = f.setup(), a = f.deps.blockCreation.current;
  const work = f.add(); await flush(); assert.equal(f.calls.length, 1);
  cleanupA(); const cleanupB = f.setup(), b = f.deps.blockCreation.current;
  try {
    assert.notStrictEqual(a, b); delayed.resolve(row()); await work;
    assert.strictEqual(f.deps.blockCreation.current, b); assert.equal(f.lists()[0].bloques.length, 1);
    await f.add(); assert.equal(f.lists()[0].bloques.length, 2);
    assert.equal(b.snapshot().phase, 'confirmed'); assert.equal(a.snapshot().phase, 'denied');
  } finally {cleanupB();}
});

test('actual pending block ACK preserves an existing same-ID local block and unrelated unsubmitted draft', async () => {
  const f = fixture(async () => row({id: 11, version: 1, contenido: {texto: 'Older ACK'}})), cleanup = f.setup();
  try {
    await f.add(); assert.equal(f.lists()[0].bloques.length, 1); assert.strictEqual(f.lists()[0].bloques[0], f.existing);
    assert.equal(f.deps.itemDrafts.current.get('1', '11'), 'Unsubmitted item');
  } finally {cleanup();}
});

test('direct delayed ACK is admitted only into its origin list after selection changes, with no navigation or draft reset', async () => {
  const waiting = deferred(), f = fixture(() => waiting.promise), cleanup = f.setup();
  try {
    const work = f.add(); await flush();
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0][0], '/api/listas-personales/1/bloques');
    f.select('2'); waiting.resolve(row()); await work;
    assert.equal(f.selected(), '2'); assert.equal(f.lists()[0].bloques.length, 2);
    assert.equal(f.lists()[1].bloques.length, 0); assert.strictEqual(f.lists()[0].bloques[0], f.existing);
    assert.equal(f.deps.itemDrafts.current.get('1', '11'), 'Unsubmitted item');
    assert.equal(f.effects.some(([name]) => name === 'selection'), false);
  } finally {cleanup();}
});

test('actual empty and normal page returns retain the same block recovery controls even when origin list is unavailable', () => {
  assert.equal(ast.parseDiagnostics.length, 0);
  const empty = nodes(page, ts.isIfStatement).find(node => node.expression.getText(ast) === '!lists.length');
  assert.ok(empty && ts.isReturnStatement(empty.thenStatement));
  const directRecovery = jsx => jsx.children.filter(child => ts.isJsxExpression(child)
    && child.expression?.getText(ast) === 'blockCreationRecovery');
  assert.equal(directRecovery(empty.thenStatement.expression).length, 1);
  const normal = nodes(page, ts.isReturnStatement).find(node => node.expression && ts.isJsxElement(node.expression)
    && node.expression.openingElement.attributes.properties.some(attribute => attribute.name?.getText(ast) === 'className'
      && attribute.initializer?.expression?.getText(ast).startsWith('`personal-lists-page')));
  assert.ok(normal); assert.equal(directRecovery(normal.expression).length, 0,
    'Recovery must not add another direct child to the canonical rail/document grid');
  const selection = nodes(normal.expression, ts.isConditionalExpression).find(node => node.condition.getText(ast) === 'activeList');
  assert.ok(selection);
  assert.equal(selection.whenTrue.openingElement.tagName.getText(ast), 'article');
  assert.equal(directRecovery(selection.whenTrue).length, 1, 'Active document retains recovery');
  assert.equal(selection.whenFalse.openingElement.tagName.getText(ast), 'section');
  const fallbackRecovery = nodes(selection.whenFalse, node => ts.isJsxExpression(node)
    && node.expression?.getText(ast) === 'blockCreationRecovery');
  assert.equal(fallbackRecovery.length, 1, 'Unavailable-list document retains recovery without becoming a grid sibling');
});

test('actual recovery renders explicit verify/retry/close actions, never claims a new automatic save', () => {
  const state = {phase: 'missing', busy: false, canVerify: true, canRetry: true, canReset: false, error: 'Known missing attempt'};
  const actions = [];
  const jsx = evaluate(declaration('blockCreationRecovery'), {React, blockCreationState: state, structuralBusy: false,
    recoverBlockCreation: action => actions.push(action), blockCreation: {current: {resetRejected: () => actions.push('reset')}}});
  const html = renderToStaticMarkup(jsx);
  assert.match(html, /Recuperar creación de bloque/); assert.match(html, /Verificar bloque/);
  assert.match(html, /Reintentar el mismo bloque/); assert.doesNotMatch(html, /Cerrar intento rechazado/);
  const buttons = React.Children.toArray(jsx.props.children).filter(node => React.isValidElement(node) && node.type === 'button');
  buttons[0].props.onClick(); buttons[1].props.onClick(); assert.deepEqual(actions, ['verify', 'retry']);
  const menu = nodes(page, ts.isJsxSelfClosingElement).find(node => node.tagName.getText(ast) === 'AddBlockMenu');
  const disabled = menu.attributes.properties.find(node => node.name?.getText(ast) === 'disabled');
  assert.equal(disabled.initializer.expression.getText(ast), 'blockCreationBlocked');
  for (const phase of ['uncertain', 'missing', 'rejected', 'denied'])
    assert.equal(evaluate(declaration('blockCreationBlocked'), {blockCreationState: {phase, unresolved: ['uncertain', 'missing'].includes(phase)}}), true);
});
