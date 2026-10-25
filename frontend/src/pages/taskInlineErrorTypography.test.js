import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import postcss from 'postcss';
import ts from 'typescript';

const css=postcss.parse(readFileSync(new URL('./WorkspaceReadOnly.css',import.meta.url),'utf8'));
const rules=[];css.walkRules(rule=>{
  if(postcss.list.comma(rule.selector).map(selector=>selector.trim()).includes('.ros-inline-error'))rules.push(rule);
});
function declarations(){
  assert.equal(rules.length,1,'One authoritative inline error rule, not an appended override');
  const result=new Map();
  for(const node of rules[0].nodes){
    if(node.type!=='decl')continue;
    assert.equal(result.has(node.prop),false,`No duplicate ${node.prop}`);assert.equal(Boolean(node.important),false);
    result.set(node.prop,node.value);
  }
  return result;
}
function luminance(hex){
  assert.match(hex,/^#[0-9a-f]{6}$/i);
  const channels=[1,3,5].map(offset=>parseInt(hex.slice(offset,offset+2),16)/255)
    .map(value=>value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4);
  return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;
}

test('actual inline error floors shared label typography at 13px without shrinking larger tokens',()=>{
  const props=declarations();assert.equal(props.get('font-size'),'max(13px,var(--render-type-label,13px))');
  assert.equal(props.get('line-height'),'1.5');
  const pixels=value=>{
    const match=/^(\d+(?:\.\d+)?)(px|rem)$/.exec(value);assert.ok(match,`Supported absolute/root-relative label token: ${value}`);
    return Number(match[1])*(match[2]==='rem'?16:1);
  };
  const tokens=postcss.parse(readFileSync(new URL('../design-system.css',import.meta.url),'utf8'));
  const labels=[];tokens.walkDecls('--render-type-label',decl=>labels.push(decl.value));assert.ok(labels.length);
  for(const value of labels)assert.ok(Math.max(13,pixels(value))>=13);
  assert.equal(Math.max(13,pixels('12px')),13);
  assert.equal(Math.max(13,pixels('0.8125rem')),13);
  assert.equal(Math.max(13,pixels('1rem')),16);
  assert.equal(Math.max(13,pixels(labels.at(-1))),13,'Current shared 12px token resolves to the explicit 13px error floor');
});

test('inline errors wrap long identifiers/URLs within their container without forced clipping',()=>{
  const props=declarations();
  assert.equal(props.get('min-width'),'0');assert.equal(props.get('max-width'),'100%');assert.equal(props.get('overflow-wrap'),'anywhere');
  assert.equal(props.get('box-sizing'),'border-box');
  for(const property of ['height','max-height','block-size','max-block-size','overflow','overflow-x','overflow-y',
    'text-overflow','white-space','line-clamp','-webkit-line-clamp'])assert.equal(props.has(property),false,`No ${property} clipping or fixed height`);
});

test('actual TaskDetail comment read/write errors and existing brief error expose alert semantics',()=>{
  const source=readFileSync(new URL('./WorkspaceReadOnly.jsx',import.meta.url),'utf8');
  const tree=ts.createSourceFile('WorkspaceReadOnly.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  assert.equal(tree.parseDiagnostics.length,0);
  const owner=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='TaskDetail');assert.ok(owner);
  const alerts=[];function walk(node){
    if(ts.isJsxElement(node)&&node.openingElement.tagName.getText(tree)==='div'){
      const attrs=node.openingElement.attributes.properties;
      if(attrs.some(attr=>ts.isJsxAttribute(attr)&&attr.name.getText(tree)==='className'&&attr.initializer?.text?.split(/\s+/).includes('ros-inline-error')))alerts.push(node);
    }ts.forEachChild(node,walk);
  }walk(owner);
  for(const content of ['commentDraftOwner.current.readError','commentError','briefError']){
    const matches=alerts.filter(node=>node.children.some(child=>ts.isJsxExpression(child)&&child.expression?.getText(tree)===content));
    assert.equal(matches.length,1,`One actual rendered alert for ${content}`);
    const role=matches[0].openingElement.attributes.properties.find(attr=>ts.isJsxAttribute(attr)&&attr.name.getText(tree)==='role');
    assert.equal(role?.initializer?.text,'alert',content);
  }
});

test('existing inline error foreground/background meet normal-text WCAG contrast without rounding up',()=>{
  const props=declarations();assert.equal(props.get('color'),'#98453f');assert.equal(props.get('background'),'#fae9e7');
  const foreground=luminance(props.get('color')),background=luminance(props.get('background'));
  const contrast=(Math.max(foreground,background)+0.05)/(Math.min(foreground,background)+0.05);
  assert.ok(contrast>=4.5,`Actual inline error contrast ${contrast.toFixed(4)} must be at least 4.5:1`);
});
