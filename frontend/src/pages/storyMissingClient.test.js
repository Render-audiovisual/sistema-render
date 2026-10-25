import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {storyPlanillaFilterQuery} from './storyPlanillaContext.js';
import {buildContextUrl} from '../shared/navigation/url-context.js';

const source=readFileSync(new URL('./Historias.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('Historias.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX),nodes=[];
(function walk(node){nodes.push(node);ts.forEachChild(node,walk);})(tree);
assert.equal(tree.parseDiagnostics.length,0);
const select=nodes.find(node=>ts.isJsxElement(node)&&node.openingElement.tagName.getText(tree)==='select'
  &&node.openingElement.attributes.properties.some(p=>p.name?.text==='aria-label'&&p.initializer?.text==='Filtrar planilla por cliente'));
assert.ok(select);
const visible=nodes.find(node=>ts.isVariableDeclaration(node)&&node.name.getText(tree)==='historiasPlanillaVisibles').initializer;
const compiled=ts.transpileModule(`const element=(${select.getText(tree)});`,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
const options=html=>[...html.matchAll(/<option\b([^>]*)>(.*?)<\/option>/g)].map(([,attrs,label])=>({
  value:/\bvalue="([^"]*)"/.exec(attrs)?.[1],selected:/\bselected=""/.test(attrs),disabled:/\bdisabled=""/.test(attrs),label,
}));
function fixture(filter,clients,allowed=true){
  let href=`/planificacion-historias?vista=planilla&cliente=2&filtro=${filter||'all'}&mes=2026-10`;
  const calls=[];
  const deps={React,filtroClientePlanilla:filter,clientes:clients,storyPlanillaFilterQuery,
    approveContextChange:changes=>{calls.push(['approve',changes]);return allowed;},
    pushUrlContext:changes=>{calls.push(['url',changes]);href=buildContextUrl('https://render.test'+href,changes);},
    setFiltroClientePlanilla:value=>calls.push(['state',value])};
  const element=Function(...Object.keys(deps),compiled+';return element;')(...Object.values(deps));
  return{element,calls,html:renderToStaticMarkup(element),get href(){return href;}};
}
test('real missing-client selector preserves explicit ID2 instead of appearing Todos, while actual filter stays ID2 with zero rows',()=>{
  const clients=Object.freeze([Object.freeze({id:1,nombre:'Available'})]),f=fixture('2',clients);
  assert.equal(f.element.props.value,'2');
  assert.deepEqual(options(f.html).filter(row=>row.selected),[{value:'2',selected:true,disabled:true,label:'Cliente no disponible (2)'}]);
  const stories=Object.freeze([Object.freeze({id:1,cliente_id:1,fecha_programada:'2026-10-24'})]);
  const actual=Function('filtroClientePlanilla','historias',`return (${visible.getText(tree)});`)('2',stories);
  assert.deepEqual(actual,[]);assert.equal(stories.length,1);assert.deepEqual(f.calls,[]);
  assert.equal(new URL(f.href,'https://render.test').searchParams.get('filtro'),'2');
});
test('real missing-client onChange clears to Todos using explicit all, preserving creation cliente and normal guard order',()=>{
  const f=fixture('2',[{id:1,nombre:'Available'}]);f.element.props.onChange({target:{value:''}});
  assert.deepEqual(f.calls,[['approve',{filtro:'all'}],['url',{filtro:'all'}],['state','']]);
  const params=new URL(f.href,'https://render.test').searchParams;
  assert.equal(params.get('filtro'),'all');assert.equal(params.get('cliente'),'2');
  const veto=fixture('2',[{id:1,nombre:'Available'}],false);const before=veto.href;
  veto.element.props.onChange({target:{value:''}});
  assert.deepEqual(veto.calls,[['approve',{filtro:'all'}]]);assert.equal(veto.href,before);
});
test('loaded existing ID keeps its canonical option with no duplicate or unavailable label',()=>{
  const f=fixture('2',[{id:1,nombre:'One'},{id:2,nombre:'Canonical two'}]),values=options(f.html);
  assert.equal(values.length,3);assert.deepEqual(values.filter(row=>row.selected),[{value:'2',selected:true,disabled:false,label:'Canonical two'}]);
  assert.doesNotMatch(f.html,/Cliente no disponible/);assert.deepEqual(f.calls,[]);
});
test('empty catalog retains missing ID; empty filter remains Todos and does not invent a client',()=>{
  const missing=fixture('2',[]);assert.deepEqual(options(missing.html).filter(row=>row.selected),[{value:'2',selected:true,disabled:true,label:'Cliente no disponible (2)'}]);
  for(const clients of [[],[{id:1,nombre:'One'}]]){
    const all=fixture('',clients);assert.equal(all.element.props.value,'');
    assert.deepEqual(options(all.html).filter(row=>row.selected),[{value:'',selected:true,disabled:false,label:'Todos los clientes'}]);
    assert.doesNotMatch(all.html,/Cliente no disponible/);assert.deepEqual(all.calls,[]);
  }
});
