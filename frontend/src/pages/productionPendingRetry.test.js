import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createProductionVisitObserver} from './productionVisitObservation.js';

const source=readFileSync(new URL('./Productions.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('Productions.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
const nodes=[];(function walk(n){nodes.push(n);ts.forEachChild(n,walk);})(tree);
assert.equal(tree.parseDiagnostics.length,0);
const declaration=name=>{const node=nodes.find(n=>ts.isVariableDeclaration(n)&&n.name.getText(tree)===name);assert.ok(node,name);return node.initializer;};
const evaluate=(node,deps)=>Function(...Object.keys(deps),`return (${node.getText(tree)});`)(...Object.values(deps));
function fixture(){
  let reload=4;const events=[],dirty=new Set(['held draft']);
  const deps={writeLock:{current:false},batchDraft:{current:{busy:false,dirty:true}},
    setReload:update=>{reload=update(reload);events.push('reload');},
    mayLeave:()=>assert.fail('read retry must not prompt or discard'),
    dirty:{current:dirty},setSelected:()=>assert.fail('do not close detail'),
    setCreating:()=>assert.fail('do not close form'),writeProductionLocation:()=>assert.fail('no navigation'),
    apiRequest:()=>assert.fail('retry only schedules the existing GET effect')};
  return{deps,events,dirty,retry:evaluate(declaration('retryPendingBank'),deps),get reload(){return reload;}};
}
test('actual pending retry only schedules reload, retaining dirty detail without a leave prompt or write',()=>{
  const f=fixture();f.retry();assert.equal(f.reload,5);assert.deepEqual(f.events,['reload']);
  assert.deepEqual([...f.dirty],['held draft']);assert.equal(f.deps.batchDraft.current.dirty,true);
});
for(const busy of ['write','batch'])test(`actual pending retry refuses while ${busy} owns a write lease`,()=>{
  const f=fixture();if(busy==='write')f.deps.writeLock.current=true;else f.deps.batchDraft.current.busy=true;
  f.retry();assert.equal(f.reload,4);assert.deepEqual(f.events,[]);assert.deepEqual([...f.dirty],['held draft']);
});

const outer=nodes.find(n=>ts.isConditionalExpression(n)&&n.condition.getText(tree)==='loading'&&n.getText(tree).includes('Actualizar pendientes'));
assert.ok(outer,'actual schedule conditional');
function renderSchedule(overrides={}){
  const deps={React,loading:false,listAvailable:true,contextError:'',tab:'pending',pendingAvailable:false,busy:false,retryPendingBank:()=>{},...overrides};
  const compiled=ts.transpileModule(`const element=(${outer.getText(tree)});`,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
  return renderToStaticMarkup(Function(...Object.keys(deps),`${compiled};return element;`)(...Object.values(deps)));
}
test('actual stale-bank JSX renders an explicit retry before evaluating bank rows or their actions',()=>{
  const html=renderSchedule();assert.match(html,/Las visitas cambiaron/);assert.match(html,/Actualizar pendientes/);
  assert.doesNotMatch(html,/No hay guiones|Retomar en|Guiones pendientes|Fotos pendientes/);
  assert.match(renderSchedule({busy:true}),/<button[^>]*disabled=""/);
});
test('actual unavailable pending JSX offers the same retry, except for invalid URL context',()=>{
  assert.match(renderSchedule({listAvailable:false}),/Actualizar pendientes/);
  assert.doesNotMatch(renderSchedule({listAvailable:false,contextError:'invalid'}),/Actualizar pendientes/);
  assert.doesNotMatch(renderSchedule({loading:true}),/Actualizar pendientes/);
});
test('both actual Actualizar pendientes buttons bind directly to the read-only handler',()=>{
  const buttons=nodes.filter(n=>ts.isJsxElement(n)&&n.openingElement.tagName.getText(tree)==='button'
    &&n.children.some(child=>ts.isJsxText(child)&&child.text.trim()==='Actualizar pendientes'));
  assert.equal(buttons.length,2);
  const f=fixture();for(const button of buttons){
    const click=button.openingElement.attributes.properties.find(a=>a.name?.text==='onClick');
    assert.equal(evaluate(click.initializer.expression,{retryPendingBank:f.retry}),f.retry);
  }
});
test('actual pendingAvailable expression follows real observer content tokens and context reset',()=>{
  const readEpoch={current:0},observer=createProductionVisitObserver(()=>readEpoch.current);
  const row={id:'visit',cliente_id:7,revision:3,titulo:'held'};observer.observe(row);
  const bankObservation={epoch:0,token:observer.token},deps={readEpoch,visitObserver:{current:observer},bankObservation};
  const available=()=>evaluate(declaration('pendingAvailable'),deps);
  assert.equal(available(),true);
  observer.observe({...row});assert.equal(available(),true);
  observer.observe({...row,revision:2,titulo:'old'});assert.equal(available(),true);
  observer.observe({...row,titulo:'new derived observation'});assert.equal(available(),false);
  deps.bankObservation={epoch:0,token:observer.token};assert.equal(available(),true);
  ++readEpoch.current;assert.equal(available(),false);
});
