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
  assert.match(text(wrapper), /const sesion = props\.sesion \|\| getSesion\(\)/);
  assert.match(text(wrapper), /props\.dominio.*props\.pieza\.id.*props\.pieza\.cliente_id.*sessionViewKey\(sesion\)/);
  assert.doesNotMatch(text(wrapper), /sesion\?\.token|sesion\.token/);
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

test('business logic and footer actions stay byte-for-byte intact when modal chrome is shared', () => {
  // Baseline from pre-migration source, excluding only the old keyboard/focus
  // effect and presentation reporting. The new invoker ref is presentation.
  const reporting = new Set(openEffects().map(call => call.parent));
  const existingLogic = internal.body.statements.filter(statement => !ts.isReturnStatement(statement)
    && !reporting.has(statement) && !text(statement).startsWith('const opener = useRef(')).map(text).join('\n');
  assert.equal(hash(existingLogic), 'd5e8c86baa45aa878d92015ae5a7a2fd5008b7ba0420da21bb337c4d885a408e',
    'All non-focus business statements stay unchanged');
  const portals = calls(internal, 'createPortal'); assert.equal(portals.length, 1);
  const footer = nodes(portals[0], ts.isJsxElement).find(node => text(node.openingElement.tagName) === 'footer');
  assert.equal(hash(text(footer)), 'faeacd4005ac19dbc832fc990a235c5db3173101fe3a83bc973f350f5a1c3841',
    'Existing footer actions, acknowledgement and retry guards remain unchanged');
  assert.equal(hash(text(internal.body.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'load'))), 'fc9c26ccff2434f765dec6ded19de46c81d42b6ef97336ac20fd776d4515884e');
  assert.equal(hash(text(internal.body.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'save'))), '56fbdd2a19d4b112182298a79b5d3f6848b67277ca691d6933483bad7de7f8b5');
});
