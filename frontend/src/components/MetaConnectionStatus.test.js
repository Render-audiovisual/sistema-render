import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const source=readFileSync(new URL('./MetaConnectionStatus.jsx',import.meta.url),'utf8');
const code=ts.transpileModule(source.replace(/^import .*;$/gm,''),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const api={};
Function('exports','React','useState','useEffect','useScopedRequest','isSessionFailure',code)(api,React,React.useState,React.useEffect,()=>{},()=>false);
const render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));
const data={configurado:true,valido:true,vence_at:null,sin_vencimiento:true,scopes:['instagram_basic'],scopes_esperados:['instagram_basic','ads_read'],scopes_faltantes:['ads_read'],
 paginas_estado:'ok',paginas:[{id:'1',nombre:'Página QA',tiene_instagram:true,tasks_informadas:true,tasks:['MESSAGING']}],
 cuentas_publicitarias_estado:'ok',cuentas_publicitarias:[{id:'act_2',nombre:'Anuncios QA',account_status:1}],errores:[]};
test('only leaders get the small collapsed diagnostic; ordinary team gets no markup or automatic request',()=>{
 for(const rol of ['diseno','edicion','produccion','community','programacion',undefined])assert.equal(render(api.MetaConnectionStatus,{sesion:{usuario:{rol}}}),'');
 const html=render(api.MetaConnectionStatus,{sesion:{usuario:{rol:'admin'}}});
 assert.match(html,/Estado de conexión Meta/);assert.match(html,/aria-expanded="false"/);assert.doesNotMatch(html,/<table|Consultando Meta/);
 const panel=readFileSync(new URL('../pages/InstagramPanel.jsx',import.meta.url),'utf8');assert.match(panel,/canManage&&!navigation.error&&tab==='resumen'&&<MetaConnectionStatus/);
});
test('tables distinguish granted and missing scopes/tasks with text as well as green/red classes',()=>{
 const html=render(api.MetaConnectionTables,{data});
 assert.match(html,/instagram_basic<\/th><td><span class="meta-state-ok">Presente/);
 assert.match(html,/ads_read<\/th><td><span class="meta-state-missing">Falta/);
 assert.match(html,/MESSAGING/);assert.match(html,/MODERATE/);assert.match(html,/CREATE_CONTENT/);
 assert.match(html,/Página QA/);assert.match(html,/act_2/);assert.match(html,/Sin vencimiento informado/);
 assert.equal((html.match(/<table/g)||[]).length,3);assert.doesNotMatch(html,/<input|access_token|Bearer/);
});
test('unknown or failed sections do not look like verified empty inventories',()=>{
 const html=render(api.MetaConnectionTables,{data:{...data,valido:null,paginas_estado:'error',cuentas_publicitarias_estado:'no_consultado',errores:['paginas_no_disponibles']}});
 assert.match(html,/Sin comprobar/);assert.match(html,/No disponibles/);assert.doesNotMatch(html,/No se encontraron páginas/);
 const tasks=render(api.MetaConnectionTables,{data:{...data,paginas:[{...data.paginas[0],tasks_informadas:false}]}});assert.match(tasks,/No informado/);
});
test('Graph names are escaped; fetch is scoped, abortable and never receives credentials from the browser',()=>{
 const html=render(api.MetaConnectionTables,{data:{...data,paginas:[{...data.paginas[0],nombre:'<script>bad</script>'}]}});
 assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
 assert.match(source,/guard.request\('\/api\/instagram\/conexion\/estado',\{cache:'no-store',signal:controller.signal\}\)/);
 assert.match(source,/guard.current\(\)&&!controller.signal.aborted/);assert.match(source,/return\(\)=>controller.abort\(\)/);
 assert.doesNotMatch(source,/access_token|localStorage|Authorization|console\./);
});
