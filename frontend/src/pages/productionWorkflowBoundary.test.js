import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const source=readFileSync(new URL('./WorkspaceReadOnly.jsx',import.meta.url),'utf8');
const file=ts.createSourceFile('WorkspaceReadOnly.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
const nodes=[];function visit(n){nodes.push(n);ts.forEachChild(n,visit);}visit(file);
const fn=nodes.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='taskProductionRegistryState');
const state=Function(`return (${fn.getText(file)})`)();
const task={id:1,revision:2},key='1:2';
test('canonical empty origin selects individual workflow without changing the artifact/reporting flag',()=>{
 const vinculo={id:'visit',tipo:'origen',usa_registro_individual:false,videos_total:0,fotos_total:0};
 const result=state(task,{status:'ready',key,vinculo});
 assert.equal(result.usesIndividual,true);assert.equal(result.legacyEnabled,false);assert.equal(result.vinculo,vinculo);
 assert.equal(vinculo.usa_registro_individual,false);assert.equal(result.clientEditable,false);assert.equal(result.dateEditable,false);
});
test('legacy unlinked remains usable; loading/error/stale lookup never enables a legacy writer',()=>{
 const legacy=state(task,{status:'ready',key,vinculo:null});assert.equal(legacy.legacyEnabled,true);
 assert.equal(legacy.usesIndividual,false);assert.equal(legacy.dateEditable,true);
 for(const lookup of [{status:'loading',key},{status:'error',key},{status:'ready',key:'1:1',vinculo:null}])assert.equal(state(task,lookup).legacyEnabled,false);
});
test('actual aggregate JSX gate excludes canonical empty origin and unverified lookup',()=>{
 const expression=nodes.find(n=>ts.isJsxExpression(n)&&n.getText(file).startsWith('{isProductionVisit && registry.ready && !registry.usesIndividual &&'));
 assert.ok(expression);
 const gate=Function('isProductionVisit','registry',`return (${expression.expression.left.getText(file)})`);
 assert.equal(gate(true,state(task,{status:'ready',key,vinculo:{tipo:'origen',usa_registro_individual:false}})),false);
 assert.equal(gate(true,state(task,{status:'loading',key})),false);
 assert.equal(gate(true,state(task,{status:'ready',key,vinculo:null})),true);
});
test('linked aggregate history remains readable without correction or completion controls',()=>{
 const expression=nodes.filter(n=>ts.isJsxExpression(n)&&n.getText(file).includes('<h4>Registro histórico de grabación</h4>')).sort((a,b)=>a.getWidth(file)-b.getWidth(file))[0];
 const jsx=`function History(){return <>${expression.getText(file)}</>}`;
 const compiled=ts.transpileModule(jsx,{compilerOptions:{jsx:ts.JsxEmit.React}}).outputText;
 const metadata={produccion_registros:[{id:'old',cantidad:4,fecha:'2026-09-20',usuario:'Equipo histórico',corregido_at:'2026-09-21',corregido_por:'Franco'}]};
 const before=JSON.stringify(metadata);
 const History=Function('React','isProductionVisit','registry','metadata','formatDate',`${compiled};return History;`)(React,true,{usesIndividual:true},metadata,value=>value);
 const html=renderToStaticMarkup(React.createElement(History));
 assert.match(html,/Registro histórico de grabación/);assert.match(html,/4/);assert.match(html,/2026-09-20/);assert.match(html,/Equipo histórico/);assert.match(html,/Corregido por Franco/);
 assert.doesNotMatch(html,/<button|Guardar avance|Confirmar grabación/);assert.equal(JSON.stringify(metadata),before);
});
