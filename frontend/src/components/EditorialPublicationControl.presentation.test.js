import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';

// Actual component AST/source contracts, not React mounting or browser QA.
const source = readFileSync(new URL('./EditorialPublicationControl.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('EditorialPublicationControl.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const text = node => node.getText(file);
function nodes(root, predicate) {
  const found = [];
  function visit(node) { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); }
  visit(root); return found;
}
const calls = (root, name) => nodes(root, node => ts.isCallExpression(node) && text(node.expression) === name);
const internal = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'PublicationControl');
const wrapper = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'EditorialPublicationControl');
const hash = value => createHash('sha256').update(value).digest('hex');
const openEffects = () => calls(internal, 'useEffect').filter(call => calls(call.arguments[0], 'onOpenChange').length);

test('optional presentation props retain existing defaults and wrapper forwards them unchanged', () => {
  const bindings = internal.parameters[0].name.elements;
  assert.equal(text(bindings.find(binding => text(binding.name) === 'hideSummary').initializer), 'false');
  assert.equal(text(bindings.find(binding => text(binding.name) === 'openLabel').initializer), "'Ver publicación'");
  assert.ok(bindings.some(binding => text(binding.name) === 'onOpenChange' && !binding.initializer));
  assert.match(text(wrapper), /\{\.\.\.props\} sesion=\{sesion\}/);
  assert.equal(hash(text(wrapper)), '60ca7586f4970d9a46562157e29490dc01e551cdcbf708aee47abb7be162140a',
    'Wrapper identity key, session resolution and prop spreading are unchanged');
});

test('hideSummary only controls existing summary span; openLabel is escaped React button text', () => {
  const returned = internal.body.statements.find(ts.isReturnStatement);
  assert.match(text(returned), /\{!hideSummary && <span>\{label\}<\/span>\}/);
  const buttons = nodes(returned, ts.isJsxElement).filter(node => text(node.openingElement.tagName) === 'button');
  const opener = buttons.find(button => button.children.some(child => ts.isJsxExpression(child)
    && child.expression && text(child.expression) === 'openLabel'));
  assert.ok(opener);
  assert.match(text(opener), /onClick=\{\(\) => \{ setOpen\(true\); if \(!uncertain\) load\(\); \}\}/);
  assert.equal(nodes(internal.body, node => ts.isIdentifier(node) && text(node) === 'hideSummary').length, 1);
  assert.equal(nodes(internal.body, node => ts.isIdentifier(node) && text(node) === 'openLabel').length, 1);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|publication_classification/,
    'Compact card classification must not become evidence or raw HTML');
});

test('optional opening callback is a top-level lifecycle effect with explicit close cleanup', () => {
  const effects = openEffects(); assert.equal(effects.length, 1);
  const effect = effects[0];
  assert.equal(text(effect.arguments[1]), '[open, onOpenChange]');
  assert.match(text(effect.arguments[0]), /onOpenChange\?\.\(open\)/);
  assert.match(text(effect.arguments[0]), /return \(\) => \{ if \(open\) onOpenChange\?\.\(false\); \}/);
  const statement = effect.parent;
  assert.ok(ts.isExpressionStatement(statement) && statement.parent === internal.body,
    'Lifecycle hook is unconditional and top-level');
  const returns = internal.body.statements.filter(ts.isReturnStatement);
  assert.ok(returns.every(returned => effect.end < returned.getStart(file)));
  assert.equal(nodes(internal.body, node => ts.isIdentifier(node) && text(node) === 'onOpenChange').length, 3,
    'Callback is only used for reporting open/cleanup and the effect dependency');
});

test('record description visibly disambiguates domain, piece ID and client ID without private titles', () => {
  const portal = calls(internal, 'createPortal')[0];
  const paragraph = nodes(portal, ts.isJsxElement).find(node => text(node.openingElement.tagName) === 'p'
    && text(node).includes('Registro manual; no es una verificación externa.'));
  assert.ok(paragraph);
  assert.match(text(paragraph), /\{dominio === 'historia' \? 'Historia' : 'Publicación'\} #\{pieza.id\} · Cliente #\{pieza.cliente_id\}/);
  assert.doesNotMatch(text(paragraph), /metadata|titulo|nombre|Pieza #/);
});

test('existing load, mutations, evidence checks, session guards and remaining dialog markup are byte-for-byte retained', () => {
  // Captured from the actual source before this presentation-only change.
  // Exclude only the newly introduced optional callback lifecycle statement.
  const reporting = new Set(openEffects().map(call => call.parent));
  const existingLogic = internal.body.statements.filter(statement => !ts.isReturnStatement(statement)
    && !reporting.has(statement)).map(text).join('\n');
  assert.equal(hash(existingLogic), 'afd2a77a9a8b8ccb9a28c123bb42f1a6c15bdd7aeba625f55c6d0e2d7b1cea00',
    'Existing read/write/session/evidence logic must not change for presentation props');
  const portals = calls(internal, 'createPortal'); assert.equal(portals.length, 1);
  const existingDialog = text(portals[0]).replace(
    "{dominio === 'historia' ? 'Historia' : 'Publicación'} #{pieza.id} · Cliente #{pieza.cliente_id}.",
    'Pieza #{pieza.id}.');
  assert.equal(hash(existingDialog), '5839026d2e4eb90bece68f1b5993b8f11b44c3f4085ee5efa1741d03356d1040',
    'Only record identity text changes; actions, disabled guards and portal remain unchanged');
});
