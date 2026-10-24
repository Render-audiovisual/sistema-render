import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Actual page controllers, not a substitute modal or native focus proof.
const source = readFileSync(new URL('./Projects.jsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('Projects.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const nodes = []; (function visit(node) { nodes.push(node); ts.forEachChild(node, visit); })(ast);
function fixture() {
  let active = true;
  const scope = { current: () => active };
  const form = { kind: 'stage-edit', scope, draft: { titulo: 'B' }, initial: { titulo: 'A' }, baseRevision: 2, busy: false };
  const changes = [], pending = [], deps = {
    formRef: { current: form }, formReturnFocus: { current: null }, mutationBusy: { current: false },
    discardIntentRef: { current: null },
    discardClosingRef: { current: false },
    setForm: value => { changes.push(value); deps.formRef.current = value; },
    setDiscardIntent: value => pending.push(value),
  };
  const controller = name => {
    const node = nodes.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(node, name);
    return new Function(...Object.keys(deps), `return (${node.getText(ast)});`)(...Object.values(deps));
  };
  deps.closeProjectForm = controller('closeProjectForm');
  const handlers = Object.fromEntries(['cancelForm', 'keepProjectForm', 'discardProjectForm'].map(name => [name, controller(name)]));
  return { form, deps, changes, pending, ...handlers, retire: () => { active = false; } };
}

test('dirty cancellation opens exactly one shared decision; keep preserves draft, original revision and focus intent', () => {
  const f = fixture(); f.cancelForm(); const intent = f.deps.discardIntentRef.current;
  assert.equal(intent.form, f.form); assert.equal(intent.scope, f.form.scope);
  f.cancelForm(); assert.equal(f.pending.length, 1); assert.deepEqual(f.changes, []);
  f.keepProjectForm(intent);
  assert.equal(f.deps.discardIntentRef.current, null); assert.equal(f.pending.at(-1), null);
  assert.equal(f.deps.formRef.current, f.form); assert.equal(f.form.draft.titulo, 'B'); assert.equal(f.form.baseRevision, 2);
  assert.equal(f.deps.formReturnFocus.current, null);
});

test('discard consumes the exact decision once and only closes that form, queuing existing focus restoration', () => {
  const f = fixture(); f.cancelForm(); const intent = f.deps.discardIntentRef.current;
  f.discardProjectForm(intent); f.discardProjectForm(intent);
  assert.deepEqual(f.changes, [null]); assert.equal(f.deps.formRef.current, null);
  assert.deepEqual(f.deps.formReturnFocus.current, { kind: 'stage-edit', scope: f.form.scope });
  assert.equal(f.deps.discardIntentRef.current, null);
});

test('clean cancellation closes directly; uncertain sending requires a decision even with unchanged fields', () => {
  const clean = fixture(); clean.form.draft = { ...clean.form.initial }; clean.cancelForm();
  assert.deepEqual(clean.changes, [null]); assert.deepEqual(clean.pending, []);
  const uncertain = fixture(); uncertain.form.draft = { ...uncertain.form.initial }; uncertain.form.uncertain = true;
  uncertain.cancelForm(); assert.deepEqual(uncertain.changes, []);
  assert.equal(uncertain.deps.discardIntentRef.current.form, uncertain.form);
  assert.match(source, /no cancela una operación que el servidor pudo haber guardado/);
});

test('busy or retired lifetime refuses cancellation before a decision can be opened', () => {
  for (const kind of ['form', 'mutation', 'scope']) {
    const f = fixture();
    if (kind === 'form') f.form.busy = true;
    if (kind === 'mutation') f.deps.mutationBusy.current = true;
    if (kind === 'scope') f.retire();
    f.cancelForm(); assert.deepEqual(f.changes, []); assert.deepEqual(f.pending, []);
  }
});

test('discard after form replacement, busy change or session withdrawal preserves the current form', () => {
  for (const kind of ['replacement', 'form-busy', 'mutation-busy', 'scope']) {
    const f = fixture(); f.cancelForm(); const intent = f.deps.discardIntentRef.current;
    if (kind === 'replacement') f.deps.formRef.current = { ...f.form, draft: { titulo: 'Replacement' } };
    if (kind === 'form-busy') f.form.busy = true;
    if (kind === 'mutation-busy') f.deps.mutationBusy.current = true;
    if (kind === 'scope') f.retire();
    const current = f.deps.formRef.current; f.discardProjectForm(intent);
    assert.equal(f.deps.formRef.current, current); assert.deepEqual(f.changes, []);
    assert.equal(f.deps.formReturnFocus.current, null); assert.equal(f.deps.discardIntentRef.current, null);
  }
});

test('retained callbacks from decision A cannot consume or clear a new decision B', () => {
  const f = fixture(); f.cancelForm(); const first = f.deps.discardIntentRef.current; f.keepProjectForm(first);
  f.cancelForm(); assert.equal(f.deps.discardIntentRef.current, null, 'Wait for the closed React commit before reopening');
  f.deps.discardClosingRef.current = false; // Model the effect after open=false commits.
  const replacement = { ...f.form, draft: { titulo: 'New B' } }; f.deps.formRef.current = replacement;
  f.cancelForm(); const second = f.deps.discardIntentRef.current; assert.notEqual(second, first);
  f.keepProjectForm(first); f.discardProjectForm(first);
  assert.equal(f.deps.discardIntentRef.current, second); assert.equal(f.deps.formRef.current, replacement);
  assert.deepEqual(f.changes, []); f.discardProjectForm(second); assert.deepEqual(f.changes, [null]);
});

test('local form close uses the shared dialog without replacing the separate navigation guard', () => {
  assert.match(source, /import \{ DiscardChangesDialog \} from '\.\.\/components\/DiscardChangesDialog.jsx'/);
  assert.match(source, /<DiscardChangesDialog open=\{Boolean\(discardIntent && discardIntent.form === form && discardIntent.scope.current\(\)\)\}/);
  assert.match(source, /onKeepEditing=\{\(\) => keepProjectForm\(discardIntent\)\}/);
  assert.match(source, /onDiscard=\{\(\) => discardProjectForm\(discardIntent\)\}/);
  assert.equal((source.match(/useNavigationGuard\(navigationStatus\)/g) || []).length, 1);
});
