import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Actual source contracts, not a React mount or real keyboard/focus test.
const source = readFileSync(new URL('./WorkspaceReadOnly.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('WorkspaceReadOnly.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const detail = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'TaskDetail');
assert.ok(detail?.body, 'Actual TaskDetail exists');
const text = n => n.getText(file);
const nodes = (root, predicate) => {
  const found = [];
  const visit = n => { if (predicate(n)) found.push(n); ts.forEachChild(n, visit); };
  visit(root);
  return found;
};
const calls = (root, name) => nodes(root, n => ts.isCallExpression(n) && text(n.expression) === name);
const declaration = name => nodes(detail.body, n => ts.isVariableDeclaration(n) && text(n.name) === name)[0];
const callback = name => {
  const node = declaration(name)?.initializer;
  assert.ok(node && ts.isArrowFunction(node) && ts.isBlock(node.body), `${name} is an actual source callback`);
  return node;
};
const identifiers = root => new Set(nodes(root, ts.isIdentifier).map(text));
const attribute = (tag, name) => tag.attributes.properties.find(n => ts.isJsxAttribute(n) && text(n.name) === name);
const expression = (tag, name) => {
  const value = attribute(tag, name)?.initializer;
  assert.ok(value && ts.isJsxExpression(value) && value.expression, `${name} JSX expression exists`);
  return value.expression;
};

test('dialog state is local; navigation busy includes dialog but write busy does not dead-disable it', () => {
  const state = nodes(detail.body, n => ts.isVariableDeclaration(n) && ts.isArrayBindingPattern(n.name)
    && n.name.elements[0]?.name?.getText(file) === 'discardDialogOpen')[0];
  assert.ok(state, 'TaskDetail declares discard dialog state');
  assert.equal(text(state.name.elements[1].name), 'setDiscardDialogOpen');
  assert.equal(text(state.initializer.expression), 'useState');
  assert.equal(state.initializer.arguments[0].kind, ts.SyntaxKind.FalseKeyword);
  const busy = declaration('taskWriteBusy');
  assert.ok(busy?.initializer);
  assert.ok(!identifiers(busy.initializer).has('discardDialogOpen'), 'Dialog visibility is not an in-flight write');
  const guard = calls(detail.body, 'useNavigationGuard');
  assert.equal(guard.length, 1);
  const properties = nodes(guard[0], ts.isPropertyAssignment);
  const busyProperty = properties.find(n => text(n.name) === 'busy' && identifiers(n.initializer).has('taskWriteBusy'));
  assert.ok(busyProperty, 'Dirty-navigation branch carries busy status');
  assert.ok(identifiers(busyProperty.initializer).has('discardDialogOpen'));
  assert.ok(text(busyProperty.initializer).includes('archivePendingRef.current'));
});

test('open discard dialog takes priority over same-task and approved-close navigation shortcuts', () => {
  const guards = calls(detail.body, 'useNavigationGuard');
  assert.equal(guards.length, 1);
  const guard = guards[0].arguments[0];
  assert.ok(ts.isArrowFunction(guard), 'Extract actual navigation-guard callback');
  assert.ok(ts.isConditionalExpression(guard.body), 'Dialog priority is the first guard decision');
  assert.equal(text(guard.body.condition), 'discardDialogOpen');
  for (const dirty of [false, true]) {
    for (const approved of [false, true]) {
      let shortcuts = 0;
      const closeApprovedRef = {};
      Object.defineProperty(closeApprovedRef, 'current', { get() { shortcuts++; return approved; } });
      const evaluate = new Function('discardDialogOpen', 'taskDraftDirty', 'taskWriteBusy',
        'archivePendingRef', 'closeApprovedRef', 'keepsTaskOpen', 'task', `return (${text(guard)});`)(
        true, dirty, false, { current: false }, closeApprovedRef,
        () => { shortcuts++; return true; }, { id: 42 });
      assert.deepEqual(evaluate({ to: '/workspace/tareas?task=42' }), { dirty, busy: true });
      assert.equal(shortcuts, 0, 'Open dialog bypasses neither via same-task URL nor approved-close ref');
    }
  }
});

test('close and explicit discard source callbacks guard before approving or animating close', () => {
  for (const name of ['closeDetail', 'discardDetail']) {
    const fn = callback(name);
    const guard = fn.body.statements[0];
    assert.ok(ts.isIfStatement(guard), `${name} begins with refusal guard`);
    const ids = identifiers(guard.expression);
    assert.ok(ids.has('taskWriteBusy') && ids.has('archivePendingRef') && ids.has('windowMotion'));
    assert.ok(text(guard.expression).includes('windowMotion.closing'));
    assert.ok(nodes(guard.thenStatement, ts.isReturnStatement).length);
    assert.equal(calls(fn, 'window.confirm').length, 0);
    assert.equal(calls(fn, 'windowMotion.close').length, 1);
  }
  const close = callback('closeDetail');
  assert.ok(identifiers(close.body.statements[0].expression).has('discardDialogOpen'));
  const dirty = nodes(close.body, ts.isIfStatement).find(n => identifiers(n.expression).has('taskDraftDirty'));
  assert.ok(dirty, 'Dirty close opens dialog instead of approving');
  assert.ok(calls(dirty.thenStatement, 'setDiscardDialogOpen').some(n => n.arguments[0]?.kind === ts.SyntaxKind.TrueKeyword));
  assert.ok(nodes(dirty.thenStatement, ts.isReturnStatement).length, 'Dirty branch returns before approval');
  assert.doesNotMatch(text(dirty.thenStatement), /closeApprovedRef|windowMotion\.close/);
  assert.equal(calls(detail.body, 'window.confirm').filter(n => /descart|sin guardar/i.test(text(n))).length, 0);
});

// Execute only the two actual source callback initializers with isolated spies.
// This checks their decision paths, not React state commits, animations or UI.
function controller(overrides = {}) {
  const events = [];
  let dialog = false;
  const closeApprovedRef = { current: false };
  const state = { taskWriteBusy: false, archive: false, closing: false, dirty: false, dialog: false, ...overrides };
  const make = name => new Function('taskWriteBusy', 'archivePendingRef', 'windowMotion', 'taskDraftDirty',
    'discardDialogOpen', 'setDiscardDialogOpen', 'closeApprovedRef', 'window', `return (${text(callback(name))});`)(
    state.taskWriteBusy, { current: state.archive }, { closing: state.closing, close: () => {
      assert.equal(closeApprovedRef.current, true, 'Approval precedes animation'); events.push('close');
    } }, state.dirty, state.dialog, value => { dialog = value; events.push(['dialog', value]); },
    closeApprovedRef, { confirm: () => { throw new Error('Native confirm must not be used'); } });
  return { events, approved: closeApprovedRef, get dialog() { return dialog; },
    close: make('closeDetail'), discard: make('discardDetail') };
}

test('actual callbacks refuse busy/archive/closing and repeated parent close while dialog is open', () => {
  for (const flags of [{ taskWriteBusy: true }, { archive: true }, { closing: true }]) {
    for (const action of ['close', 'discard']) {
      const c = controller({ dirty: true, dialog: true, ...flags });
      c[action]();
      assert.deepEqual(c.events, []);
      assert.equal(c.approved.current, false);
    }
  }
  const c = controller({ dirty: true, dialog: true });
  c.close();
  assert.deepEqual(c.events, []);
  assert.equal(c.approved.current, false);
});

test('dirty close only opens dialog; clean close approves; explicit discard clears dialog then approves and closes', () => {
  const dirty = controller({ dirty: true });
  dirty.close();
  assert.deepEqual(dirty.events, [['dialog', true]]);
  assert.equal(dirty.approved.current, false);
  const clean = controller();
  clean.close();
  assert.equal(clean.approved.current, true);
  assert.deepEqual(clean.events, ['close']);
  const discard = controller({ dirty: true, dialog: true });
  discard.discard();
  assert.equal(discard.approved.current, true);
  assert.equal(discard.dialog, false);
  assert.deepEqual(discard.events, [['dialog', false], 'close']);
});

test('TaskDetail mounts controlled discard dialog; keep-editing only closes dialog and parent Escape routes through guarded close', () => {
  const tags = nodes(detail.body, n => ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n));
  const dialogs = tags.filter(n => text(n.tagName) === 'DiscardChangesDialog');
  assert.equal(dialogs.length, 1);
  const dialog = dialogs[0];
  assert.equal(text(expression(dialog, 'open')), 'discardDialogOpen');
  assert.equal(text(expression(dialog, 'busy')), 'taskWriteBusy');
  assert.equal(text(expression(dialog, 'onDiscard')), 'discardDetail');
  const keep = expression(dialog, 'onKeepEditing');
  assert.ok(ts.isArrowFunction(keep));
  const updates = [];
  new Function('setDiscardDialogOpen', `return (${text(keep)});`)(value => updates.push(value))();
  assert.deepEqual(updates, [false], 'Keep-editing cannot approve close or clear the task draft');
  const parent = tags.find(n => text(n.tagName) === 'aside' && attribute(n, 'onKeyDown'));
  assert.ok(parent);
  const escape = expression(parent, 'onKeyDown');
  assert.ok(nodes(escape, n => ts.isStringLiteral(n) && n.text === 'Escape').length);
  assert.equal(calls(escape, 'closeDetail').length, 1);
  assert.equal(calls(escape, 'windowMotion.close').length, 0);
  assert.ok(text(escape).includes('defaultPrevented'));
});

test('imported child dialog contains Escape propagation protection (source evidence only)', () => {
  const imported = file.statements.find(n => ts.isImportDeclaration(n)
    && n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings)
    && n.importClause.namedBindings.elements.some(e => e.name.text === 'DiscardChangesDialog'));
  assert.ok(imported, 'Use actual imported dialog, not an inline substitute');
  const childSource = readFileSync(new URL(imported.moduleSpecifier.text, new URL('./WorkspaceReadOnly.jsx', import.meta.url)), 'utf8');
  const child = ts.createSourceFile('DiscardChangesDialog.jsx', childSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  const handlers = nodes(child, n => ts.isJsxAttribute(n)
    && ['onKeyDownCapture', 'onKeyDown'].includes(n.name.getText(child)));
  assert.ok(handlers.some(n => {
    const value = n.getText(child);
    return value.includes('Escape') && /\.stopPropagation\s*\(/.test(value);
  }), 'Child Escape handler stops bubbling to TaskDetail');
});
