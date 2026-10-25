import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('./ClientesObjetivos.jsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('ClientesObjetivos.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
function find(root, predicate) {
  const found = [];
  function walk(node) { if (predicate(node)) found.push(node); ts.forEachChild(node, walk); }
  walk(root); return found;
}
for (const name of ['PrepareGoal', 'PieceDetail']) {
  test(`${name} delegates modality and busy close protection to shared native Modal`, () => {
    const owner = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    const [modal] = find(owner, node => ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === 'Modal');
    assert.ok(modal);
    const attr = key => modal.attributes.properties.find(node => node.name?.getText(ast) === key);
    assert.ok(attr('native'), 'use actual top-layer dialog, not aria-modal on a div');
    assert.equal(attr('native').initializer, undefined);
    assert.equal(attr('closeDisabled')?.initializer?.expression?.getText(ast), 'busy');
    assert.equal(attr('onClose')?.initializer?.expression?.getText(ast), 'closeSafely');
    assert.ok(attr('overlayAriaLabel'));
  });
}
test('goal modal lifecycle locks scroll without registering a competing document focus trap', () => {
  const owner = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'useGoalModalScrollLock');
  assert.ok(owner);
  let effect;
  const body = { style: { overflow: 'auto' } };
  const hook = Function('useEffect', 'document', `${owner.getText(ast)}; return useGoalModalScrollLock;`)(fn => { effect = fn; }, { body });
  hook(); const cleanup = effect();
  assert.equal(body.style.overflow, 'hidden'); cleanup(); assert.equal(body.style.overflow, 'auto');
  assert.doesNotMatch(owner.getText(ast), /addEventListener|querySelectorAll/);
  assert.equal((source.match(/useGoalModalScrollLock\(\);/g) || []).length, 2);
});
