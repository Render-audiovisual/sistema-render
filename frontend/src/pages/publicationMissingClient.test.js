import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

// Real JSX select + React SSR, not a mounted DOM/native-browser claim.
const source=readFileSync(new URL('./Publicaciones.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('Publicaciones.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX),nodes=[];
(function walk(node){nodes.push(node);ts.forEachChild(node,walk);})(tree);
assert.equal(tree.parseDiagnostics.length,0);
const select=nodes.find(node=>ts.isJsxElement(node)&&node.openingElement.tagName.getText(tree)==='select'
  &&node.openingElement.attributes.properties.some(p=>p.name?.text==='aria-label'&&p.initializer?.text==='Elegir cliente para planificar publicaciones'));
assert.ok(select);
const compiled=ts.transpileModule(`function render(){return (${select.getText(tree)});}`,{
  compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022},
}).outputText;
function fixture(selected,clients){
  const calls=[];
  const element=Function('React','clienteSeleccionado','clientes','irAPlanillaDeCliente',`${compiled};return render();`)(React,selected,clients,id=>calls.push(id));
  return{element,calls,html:renderToStaticMarkup(element)};
}
const options=html=>[...html.matchAll(/<option\b([^>]*)>(.*?)<\/option>/g)].map(([,attrs,label])=>({
  value:/\bvalue="([^"]*)"/.exec(attrs)?.[1],selected:/\bselected=""/.test(attrs),disabled:/\bdisabled=""/.test(attrs),label,
}));
test('missing selected client has an explicit selected unavailable option; render never adopts another client',()=>{
  const clients=Object.freeze([Object.freeze({id:1,nombre:'Available'})]),f=fixture(2,clients);
  const values=options(f.html),selected=values.filter(option=>option.selected);
  assert.equal(f.element.props.value,2);
  assert.deepEqual(selected,[{value:'2',selected:true,disabled:true,label:'Cliente no disponible (2)'}]);
  assert.equal(values.find(option=>option.value==='1').selected,false);
  assert.deepEqual(f.calls,[]);assert.deepEqual(clients,[{id:1,nombre:'Available'}]);
});
test('existing selected client keeps its canonical label with no duplicate or unavailable option',()=>{
  const f=fixture(2,[{id:1,nombre:'One'},{id:2,nombre:'Canonical two'}]),values=options(f.html);
  assert.equal(values.length,2);
  assert.deepEqual(values.filter(option=>option.selected),[{value:'2',selected:true,disabled:false,label:'Canonical two'}]);
  assert.doesNotMatch(f.html,/Cliente no disponible/);assert.deepEqual(f.calls,[]);
});
test('empty catalog retains an explicit selected ID, while no selection does not invent one',()=>{
  const missing=fixture(2,[]);
  assert.deepEqual(options(missing.html),[{value:'2',selected:true,disabled:true,label:'Cliente no disponible (2)'}]);
  const empty=fixture(null,[]);
  assert.equal(empty.element.props.value,'');assert.deepEqual(options(empty.html),[]);
  assert.deepEqual(missing.calls,[]);assert.deepEqual(empty.calls,[]);
});
test('actual onChange still delegates the explicitly chosen numeric ID exactly once',()=>{
  const f=fixture(2,[{id:1,nombre:'Available'}]);
  f.element.props.onChange({target:{value:'1'}});
  assert.deepEqual(f.calls,[1]);
  assert.equal(f.element.props.value,2,'Controlled render does not mutate its captured selection');
  const handler=select.openingElement.attributes.properties.find(p=>p.name?.text==='onChange').initializer.expression;
  assert.equal(handler.getText(tree),'(event) => irAPlanillaDeCliente(Number(event.target.value))');
});
