import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const parse=path=>{const source=readFileSync(new URL(path,import.meta.url),'utf8');return {source,ast:ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX)};};
function nodes(root,predicate){const result=[];function visit(n){if(predicate(n))result.push(n);ts.forEachChild(n,visit);}visit(root);return result;}
const attr=(node,name)=>node.attributes.properties.find(p=>p.name?.text===name);
const expr=(node,name,ast)=>attr(node,name)?.initializer?.expression?.getText(ast);
test('editorial record portal uses shared top-layer modality with busy and focus ownership',()=>{
  const {source,ast}=parse('./EditorialPublicationControl.jsx');
  const [modal]=nodes(ast,n=>ts.isJsxOpeningElement(n)&&n.tagName.getText(ast)==='Modal');
  assert.ok(modal);assert.ok(attr(modal,'native'));assert.equal(attr(modal,'native').initializer,undefined);
  assert.equal(expr(modal,'closeDisabled',ast),'busy');
  assert.equal(expr(modal,'initialFocusRef',ast),'dialog');
  assert.equal(expr(modal,'returnFocusRef',ast),'opener');
  assert.equal(attr(modal,'overlayAriaLabel')?.initializer?.text,'Registro de publicación');
  assert.equal(attr(modal,'overlayClassName')?.initializer?.text,'ep-overlay');
  assert.equal(attr(modal,'className')?.initializer?.text,'ep-dialog');
  assert.equal(attr(modal,'closeOnBackdropClick'),undefined);
  assert.match(source,/createPortal\(<Modal/);assert.match(source,/<button ref=\{opener\}/);
  assert.doesNotMatch(source,/document.addEventListener\('keydown'|document.removeEventListener\('keydown'/);
});
test('both publication calendar layers are native and labelled, without adding backdrop dismissal',()=>{
  const {ast}=parse('../pages/Publicaciones.jsx');
  const modals=nodes(ast,n=>ts.isJsxOpeningElement(n)&&n.tagName.getText(ast)==='Modal');
  assert.equal(modals.length,2);
  for(const modal of modals){assert.ok(attr(modal,'native'));assert.ok(attr(modal,'overlayAriaLabel'));assert.equal(attr(modal,'closeOnBackdropClick'),undefined);}
});
