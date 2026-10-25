import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import ts from 'typescript';
const source=readFileSync(new URL('./Publicaciones.jsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('Publicaciones.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function nodes(root,predicate){const result=[];function walk(n){if(predicate(n))result.push(n);ts.forEachChild(n,walk);}walk(root);return result;}
const owner=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='PublicacionesCalendarioTab');
const attr=(n,key)=>n.attributes.properties.find(p=>p.name?.text===key);
const day=()=>nodes(owner,n=>ts.isJsxElement(n)&&n.openingElement.tagName.getText(ast)==='button'&&attr(n.openingElement,'className')?.initializer?.text?.includes('cal-day-open'))[0];
test('month day entry is a native named button, enabled only when its list can open',()=>{
  const node=day();assert.ok(node,'Day must be reachable through native keyboard activation');
  const code=ts.transpileModule(`const control=(${node.getText(ast)});`,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
  for(const items of [[],[{id:7}]]){
    const calls=[],element=Function('React','iso','dia','items','abrirDia',`${code};return control;`)(React,'2026-10-28',28,items,(...args)=>calls.push(args));
    assert.equal(element.props.type,'button');assert.equal(element.props['aria-label'],'Ver publicaciones del 2026-10-28');
    assert.equal(element.props.disabled,!items.length);
    const invoker={},e={currentTarget:invoker,stopPropagation(){calls.push('stop');}};
    element.props.onClick(e);assert.deepEqual(calls,['stop',['2026-10-28',items,invoker]]);
  }
});
test('actual day opener retains the exact invoker and never changes it for empty days',()=>{
  const declaration=nodes(owner,n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)==='abrirDia')[0];
  const callback=declaration.initializer.arguments[0];
  const dayInvoker={current:null},selected=[];
  const open=Function('dayInvoker','setDiaSel',`return (${callback.getText(ast)});`)(dayInvoker,value=>selected.push(value));
  const invoker={},items=[{id:7}];open('2026-10-28',items,invoker);
  assert.equal(dayInvoker.current,invoker);assert.deepEqual(selected,[{fecha:'2026-10-28',items}]);
  open('2026-10-29',[],{});assert.equal(dayInvoker.current,invoker);assert.equal(selected.length,1);
});
test('day dialog returns focus explicitly and mouse cell/more paths provide connected controls',()=>{
  const modal=nodes(owner,n=>ts.isJsxOpeningElement(n)&&n.tagName.getText(ast)==='Modal'&&attr(n,'className')?.initializer?.text==='day-modal')[0];
  assert.equal(attr(modal,'returnFocusRef')?.initializer?.expression?.getText(ast),'dayInvoker');
  assert.match(source,/abrirDia\(iso, items, event.currentTarget.querySelector\('\.cal-day-open'\)\)/);
  assert.match(source,/abrirDia\(iso, items, event.currentTarget\)/);
});
test('day and overflow invokers are keyed by actual date, never reused for another month',()=>{
  for(const className of ['cal-daynum cal-day-open','cal-more']){
    const [button]=nodes(owner,n=>ts.isJsxOpeningElement(n)&&n.tagName.getText(ast)==='button'&&attr(n,'className')?.initializer?.text===className);
    assert.ok(button);assert.equal(attr(button,'key')?.initializer?.expression?.getText(ast),'iso');
  }
});
