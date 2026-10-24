import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import * as constants from '../constants.js';
import { isConfirmedPublication } from '../shared/editorial/publication-evidence.js';

const configs=[
  {file:'Historias.jsx',owner:'HistoriasPlanillaTab',variable:'h',entity:'historia',fields:{cliente:'Cliente',fecha:'Fecha programada',hora:'Hora',tipo:'Tema / formato',copy:'Texto / copy',material:'Enlace de material',aclaraciones:'Notas',responsable:'Responsable',estado:'Estado'}},
  {file:'Publicaciones.jsx',owner:'PublicacionesPlanillaTab',variable:'p',entity:'publicación',fields:{fecha:'Fecha programada',tipo:'Tipo de publicación',idea:'Idea',copy:'Texto / copy',material:'Enlace de material',aclaraciones:'Notas',responsable:'Responsable',estado:'Estado'}},
];
const all=(node,predicate)=>{const found=[];function visit(n){if(predicate(n))found.push(n);ts.forEachChild(n,visit);}visit(node);return found;};
function sourceFor(config){
  const text=readFileSync(new URL(`./${config.file}`,import.meta.url),'utf8');
  const ast=ts.createSourceFile(config.file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  assert.equal(ast.parseDiagnostics.length,0);
  const owners=all(ast,n=>ts.isFunctionDeclaration(n)&&n.name?.text===config.owner);assert.equal(owners.length,1);
  const controls=all(owners[0],n=>(ts.isJsxElement(n)||ts.isJsxSelfClosingElement(n))&&
    (n.openingElement||n).attributes.properties.some(p=>ts.isJsxAttribute(p)&&p.name.text==='data-cell'));
  const field=node=>{
    const attribute=(node.openingElement||node).attributes.properties.find(p=>p.name?.text==='data-cell');
    return attribute.initializer.expression.getText(ast).match(/:([a-z]+)`$/)[1];
  };
  return {ast,owner:owners[0],controls,field};
}
function render(node,ast,deps){
  const code=ts.transpileModule(`const control=(${node.getText(ast)});`,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText;
  return new Function('React',...Object.keys(deps),`${code};return control;`)(React,...Object.values(deps));
}
function fixture(config,id=41,role='admin'){
  const calls=[];
  const piece={id,cliente_id:7,cliente_nombre:'Cliente QA',fecha_programada:'2026-10-26',tipo:'video',estado:'pendiente',
    copy:'Copy QA',idea:'Idea QA',material_referencia:'https://example.invalid/material',aclaraciones:'Notas QA',
    responsable:'Persona QA',responsable_diseño:'Persona QA',metadata:{hora:'10:00',tipo:'Testimonio'}};
  const record=name=>(...args)=>calls.push([name,...args]);
  return {calls,piece,deps:{...constants,[config.variable]:piece,rowIndex:2,view:{role},est:{bg:'white',fg:'black'},
    clientes:[{id:7,nombre:'Cliente QA'}],responsables:[{id:8,nombre:'Persona QA'}],isConfirmedPublication,
    actualizarLocal:record('local'),guardarEnServidor:record('save'),confirmarCampoTexto:record('text'),
    ajustarAltura:record('height'),manejarEnterOTab:record('keyboard'),manejarPaste:record('paste')}};
}
for(const config of configs){
  test(`${config.owner}: every canonical sheet control has a field/piece-specific SSR name without changing order or tabIndex`,()=>{
    const {ast,controls,field}=sourceFor(config);
    assert.deepEqual(controls.map(field),Object.keys(config.fields),'Exact existing column/DOM order');
    for(const id of [41,42]){
      const f=fixture(config,id);
      for(const node of controls){
        const key=field(node),element=render(node,ast,f.deps);
        assert.ok(['input','select','textarea'].includes(element.type));
        assert.equal(element.props['aria-label'],`${config.fields[key]} · ${config.entity} #${id}`);
        assert.equal(element.props['data-cell'],`2:${key}`);assert.equal(element.props.tabIndex,undefined);
        const html=renderToStaticMarkup(element);
        assert.ok(html.includes(`aria-label="${config.fields[key]} · ${config.entity} #${id}"`));
        assert.equal(typeof element.props.onChange,'function');assert.equal(typeof element.props.onKeyDown,'function');
      }
      assert.deepEqual(f.calls,[],'Rendering does not save or change data');
    }
  });
  test(`${config.owner}: real select handlers retain original payload, keyboard delegation and state permissions`,()=>{
    const {ast,controls,field}=sourceFor(config),f=fixture(config);
    const key=config.variable==='h'?'cliente':'tipo';
    const control=render(controls.find(n=>field(n)===key),ast,f.deps);
    const event={target:{value:key==='cliente'?'19':'carrusel'}};
    control.props.onChange(event);
    const payload=key==='cliente'?{cliente_id:19}:{tipo:'carrusel'};
    assert.deepEqual(f.calls,[['local',41,payload],['save',41,payload]]);
    f.calls.length=0;
    const keyboard={key:'Tab',shiftKey:true};control.props.onKeyDown(keyboard);
    assert.deepEqual(f.calls,[['keyboard',keyboard,2,key]]);
    const state=controls.find(n=>field(n)==='estado');
    assert.equal(render(state,ast,f.deps).props.disabled,false);
    const employee=fixture(config,41,'edicion');
    assert.equal(render(state,ast,employee.deps).props.disabled,true);
    assert.deepEqual(employee.calls,[]);
  });
  test(`${config.owner}: real text handlers keep local editing and observed blur save separate`,()=>{
    const {ast,controls,field}=sourceFor(config),f=fixture(config);
    const control=render(controls.find(n=>field(n)==='material'),ast,f.deps);
    const event={target:{value:'  https://example.invalid/new  '}};
    control.props.onChange(event);
    assert.deepEqual(f.calls,[['local',41,{material_referencia:event.target.value}]]);
    control.props.onBlur(event);
    assert.deepEqual(f.calls.at(-1),['text',41,{material_referencia:'https://example.invalid/new'}]);
  });
  test(`${config.owner}: sheet action glyphs are decorative and their actual button retains an accessible name`,()=>{
    const {ast,owner}=sourceFor(config),f=fixture(config);
    const buttons=all(owner,n=>ts.isJsxElement(n)&&n.openingElement.tagName.getText(ast)==='button'&&
      n.openingElement.attributes.properties.some(p=>p.name?.text==='title'&&/Copiar fila|Duplicar historia/.test(p.initializer?.getText(ast)||'')));
    assert.equal(buttons.length,config.variable==='h'?2:1);
    for(const node of buttons){
      const element=render(node,ast,{...f.deps,copiarFila:()=>{},onDuplicar:()=>{}});
      assert.match(element.props['aria-label'],/Copiar|Duplicar/);
      const html=renderToStaticMarkup(element);assert.match(html,/aria-hidden="true"/);
    }
  });
}
