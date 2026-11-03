import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const source=readFileSync(new URL('./ReportViews.jsx',import.meta.url),'utf8');
const code=ts.transpileModule(source.replace(/^import .*;$/gm,''),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const api={};
Function('exports','React','handleAppLinkClick',code)(api,React,()=>{});
const render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));
test('hub contains exactly two controls, Equipo and Clientes, with no promotional copy',()=>{
 const html=render(api.ReportHub,{onSelect(){}});
 assert.equal((html.match(/<button /g)||[]).length,2);
 assert.match(html,/>Equipo</);assert.match(html,/>Clientes</);
 assert.doesNotMatch(html,/<p|<input|Estadísticas de|Ver cuentas/);
 const selected=[];const tree=api.ReportHub({onSelect:value=>selected.push(value)});
 tree.props.children.forEach(button=>button.props.onClick());assert.deepEqual(selected,['equipo','clientes']);
});
test('client list has one direct statistics link per client and no quotas or progress',()=>{
 const html=render(api.ClientReportList,{period:'2026-10',clients:[{clave:'cliente-11',nombre:'Bendita',instagram:[{username:'benditaburgergoya'}]},{clave:'grupo-1',nombre:'Lavalle',instagram:[{username:'lavalle.market'},{username:'lavallehorticola_srl'}]},{clave:'cliente-1956',nombre:'Maquinor',instagram:[]}]});
 assert.equal((html.match(/<a /g)||[]).length,3);
 assert.match(html,/\/instagram\/estadisticas\?cliente=cliente-11&amp;periodo=2026-10/);
 assert.match(html,/@lavalle.market · @lavallehorticola_srl/);assert.match(html,/Sin cuenta vinculada/);
 assert.doesNotMatch(html,/progressbar|Cuota|Carruseles|Reels|Ver reporte|<button/);
});
test('team cards show one server count per person, preserving zero and unavailable',()=>{
 const html=render(api.TeamReportCards,{people:[{id:10,name:'Germán',count:34,available:true,productionPending:[{quantity:2}]},{id:9,name:'Luciano',count:48,available:true},{id:8,name:'Augusto',count:0,available:true},{id:99,name:'Otra persona',count:7,available:false,label:'Trabajos'}]});
 assert.equal((html.match(/<article /g)||[]).length,4);
 for(const value of ['Germán','Luciano','Augusto','>34<','>48<','>0<','>—<','Videos grabados','Videos editados','Carruseles realizados'])assert.ok(html.includes(value),value);
 assert.doesNotMatch(html,/Ver detalle|registros únicos|<details|<button|cargas por revisar|>36</);
});
test('names and account handles are text, never HTML',()=>{
 const html=render(api.ClientReportList,{period:'2026-11',clients:[{clave:'cliente-1',nombre:'<script>name</script>',instagram:[{username:'<img>'}]}]});
 assert.doesNotMatch(html,/<script>|<img>/);assert.match(html,/&lt;script&gt;/);
});
