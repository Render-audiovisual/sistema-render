import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {hasNoConfiguredMonthlyAgreement} from './clientCreate.js';

const parse=path=>ts.createSourceFile(path,readFileSync(new URL(path,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
const page=parse('./Clientes.jsx'),modals=parse('../components/ClienteModals.jsx');
function nodes(root,predicate){const result=[];function visit(node){if(predicate(node))result.push(node);ts.forEachChild(node,visit);}visit(root);return result;}
function expression(node,ast,deps){const js=ts.transpileModule(`const render=()=>(${node.getText(ast)});`,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.None}}).outputText;return new Function(...Object.keys(deps),`${js};return render();`)(...Object.values(deps));}
const moneyNode=nodes(page,node=>ts.isVariableDeclaration(node)&&node.name.getText(page)==='MONEY')[0];
const MONEY=new Function(`return (${moneyNode.initializer.getText(page)});`)();

test('actual desktop/mobile client money cells and create preview render 125000.50 as 125.000,50, never rounded 125.001',()=>{
 assert.equal(page.parseDiagnostics.length,0);assert.equal(modals.parseDiagnostics.length,0);
 const cells=nodes(page,node=>ts.isJsxElement(node)&&node.openingElement.tagName.getText(page)==='strong'&&node.getText(page).includes('MONEY.format'));
 assert.equal(cells.length,2);
 for(const cell of cells){const html=renderToStaticMarkup(expression(cell,page,{React,MONEY,cliente:{abono_mensual:'125000.50'}}));assert.match(html,/125\.000,50/);assert.doesNotMatch(html,/125\.001/);const empty=renderToStaticMarkup(expression(cell,page,{React,MONEY,cliente:{abono_mensual:null}}));assert.match(empty,/Sin abono configurado/);assert.doesNotMatch(empty,/\$|0,00/);}
 const preview=nodes(page,node=>ts.isJsxElement(node)&&node.openingElement.tagName.getText(page)==='small'&&node.getText(page).includes('nuevoCliente.disenador_responsable'))[0];
 const html=renderToStaticMarkup(expression(preview,page,{React,nuevoCliente:{disenador_responsable:'Augusto',abono_mensual:'125000.50'}}));assert.match(html,/125\.000,50/);assert.doesNotMatch(html,/125\.001/);
 assert.equal(MONEY.resolvedOptions().minimumFractionDigits,2);assert.equal(MONEY.resolvedOptions().maximumFractionDigits,2);
});
test('actual detail renders observed cents and basic detail still renders no invented fee',()=>{
 const detail=nodes(modals,node=>ts.isFunctionDeclaration(node)&&node.name?.text==='DetalleClienteSession')[0];
 const code=ts.transpileModule(detail.getText(modals),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.None}}).outputText;
 const deps={React,useRef:current=>({current}),useState:initial=>[initial,()=>{}],hasNoConfiguredMonthlyAgreement,Modal:({children,title})=>React.createElement('section',null,title,children),getEstadoLabel:()=> 'Sin clasificación',getTipoPublicacionLabel:()=> 'Pieza'};
 const Detail=new Function(...Object.keys(deps),`${code};return DetalleClienteSession;`)(...Object.values(deps));
 const base={id:7,nombre:'QA',activo:true,grupo_feed_id:null,cuota_reels:0,cuota_carruseles:0,fecha_inicio:null,fecha_fin:null,configuracion_vigente_desde:null,configuracion_completa:false,abono_mensual:null};
 const render=cliente=>renderToStaticMarkup(React.createElement(Detail,{cliente,periodo:'2026-10',capture:()=>({current:()=>true}),historias:[],publicaciones:[]}));
 const html=render({...base,configuracion_completa:true,abono_mensual:'125000.50',cuota_reels:1});assert.match(html,/125\.000,50/);assert.doesNotMatch(html,/125\.001/);
 const basic=render(base);assert.match(basic,/Sin acuerdo mensual vigente en este período/);assert.doesNotMatch(basic,/\$|0,00|Abono mensual<|cliente-detail-metrics/);
});
test('actual create/edit fee inputs accept cent steps without relaxing integer quota inputs',()=>{
 for(const [ast,field] of [[page,'nuevoCliente.abono_mensual'],[modals,'abonoMensual']]){
  const input=nodes(ast,node=>ts.isJsxSelfClosingElement(node)&&node.tagName.getText(ast)==='input'&&node.attributes.properties.some(prop=>prop.name?.getText(ast)==='value'&&prop.initializer?.expression?.getText(ast).includes(field)))[0];assert.ok(input);
  const html=renderToStaticMarkup(expression(input,ast,{React,guardando:false,editingAmount:false,abonoMensual:'125000.50',nuevoCliente:{abono_mensual:'125000.50'}}));
  if(ast===page){assert.match(html,/step="0\.01"/);assert.match(html,/value="125000\.50"/);assert.match(html,/type="number"/);assert.match(html,/min="0"/);}
  else {assert.match(html,/inputMode="decimal"/);assert.match(html,/value="125\.000,50"/);assert.match(html,/type="text"/);}
  const quotaInputs=nodes(ast,node=>ts.isJsxSelfClosingElement(node)&&node.tagName.getText(ast)==='input'&&node.attributes.properties.some(prop=>prop.name?.getText(ast)==='value'&&/cuota/i.test(prop.initializer?.expression?.getText(ast)||'')));
  assert.ok(quotaInputs.length>=2);for(const quota of quotaInputs){const step=quota.attributes.properties.find(prop=>prop.name?.getText(ast)==='step');assert.equal(step.initializer.text,'1');}
 }
});
