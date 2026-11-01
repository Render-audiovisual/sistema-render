import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {instagramReportHref} from './instagramNavigation.js';
const source=readFileSync(new URL('./InstagramPanel.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('InstagramPanel.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
const functions=['FormatProgress','ClientReportCard'];
const declarations=tree.statements.filter(n=>ts.isFunctionDeclaration(n)&&functions.includes(n.name?.text));assert.equal(declarations.length,2);
const code=ts.transpileModule(declarations.map(d=>d.getText(tree)).join('\n'),{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
const {ClientReportCard}=Function('React','fmt','dateLabel','instagramReportHref',`${code};return {ClientReportCard};`)(React,String,new Intl.DateTimeFormat('es-AR',{dateStyle:'short',timeZone:'America/Argentina/Cordoba'}),instagramReportHref);
const client={clave:'cliente-1',nombre:'Cliente QA',instagram:[{username:'cliente_qa'}],format_counts:{status:'historical',checkedAt:'2026-11-01T15:00:00Z'},fulfillment:{reels:{cantidad:4,cuota:4,incluido:true},carruseles:{cantidad:0,cuota:2,incluido:true}}};
const render=c=>renderToStaticMarkup(React.createElement(ClientReportCard,{client:c,period:'2026-10',onOpen(){}}));
test('each client has an isolated real report link and two independent format bars',()=>{
  const html=render(client);assert.match(html,/href="\/instagram\/reporte\?cliente=cliente-1&amp;periodo=2026-10"/);
  assert.match(html,/aria-label="Ver reporte de Cliente QA"/);assert.match(html,/4 \/ 4/);assert.match(html,/0 \/ 2/);
  assert.equal((html.match(/role="progressbar"/g)||[]).length,2);assert.match(html,/@cliente_qa/);assert.doesNotMatch(html,/cliente-2/);
});
test('unknown, manual owner records and images remain distinct from verified zero',()=>{
  const unknown=render({...client,instagram:[],format_counts:{status:'unavailable'},fulfillment:{reels:{cantidad:null,cuota:4,incluido:true},carruseles:{cantidad:null,cuota:2,incluido:true}}});
  assert.match(unknown,/Cuenta sin conectar/);assert.match(unknown,/— \/ 4/);assert.doesNotMatch(unknown,/role="progressbar"/);
  const owner=render({...client,format_counts:{status:'owner_record',checkedAt:'2026-10-30T15:00:00Z'},fulfillment:{reels:{cantidad:3,cuota:4,incluido:true},carruseles:{cantidad:1,cuota:2,incluido:true}}});
  assert.match(owner,/Registrado por dirección/);assert.match(owner,/3 \/ 4/);assert.doesNotMatch(owner,/Mes comprobado/);
});
test('logo and title are escaped and actions remain distinct, without nested buttons or links',()=>{
  const html=render({...client,nombre:'<script>bad</script>',logo:'https://example.test/logo.png'});assert.match(html,/loading="lazy"/);assert.doesNotMatch(html,/<script>/);
  assert.equal((html.match(/<a /g)||[]).length,1);assert.equal((html.match(/<button /g)||[]).length,1);
});
test('client spaces are a responsive grid, not a wide table of mixed reports',()=>{
  const css=readFileSync(new URL('./InstagramPanel.css',import.meta.url),'utf8');assert.match(css,/\.ig-client-grid\{[^}]*grid-template-columns:repeat\(auto-fill,minmax\(min\(100%,280px\),1fr\)\)/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);assert.match(css,/min-height:44px/);assert.match(source,/Resumen general del mes/);
});
