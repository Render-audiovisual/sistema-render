import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
const source=readFileSync(new URL('./Productions.jsx',import.meta.url),'utf8');
const file=ts.createSourceFile('Productions.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
const declarations=['safeProductionUrl','PendingProductionPhotos'].map(name=>file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name));
assert.ok(declarations.every(Boolean));
const js=ts.transpileModule(declarations.map(n=>n.getText(file)).join('\n'),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText;
const Component=Function('React','PHOTO_STATES',`${js};return PendingProductionPhotos;`)(React,{pendiente:'Pendiente',repetir:'Repetir'});
const photo={id:'photo-1',visita_id:'source-visit',tipo:'Retratos del equipo',estado:'repetir',cliente_nombre:'Cliente QA',fecha:'2026-09-15',observaciones:'Repetir con mejor luz',drive_url:'https://example.invalid/material'};
const html=photos=>renderToStaticMarkup(React.createElement(Component,{photos,busy:false,onOpen(){}}));
test('pending photos show type, state, source date, notes and safe material, never quantities',()=>{
 const result=html([photo]);for(const text of ['Fotos pendientes','Retratos del equipo','Repetir','Cliente QA','2026-09-15','Repetir con mejor luz','Abrir material','Ver visita de origen'])assert.ok(result.includes(text),text);
 assert.match(result,/rel="noopener noreferrer"/);assert.doesNotMatch(result,/type="number"|cantidad|Retomar en la visita/);
});
test('photo source action only opens the original visit and respects busy presentation',()=>{
 const calls=[];for(const busy of [false,true]){
  const tree=Component({photos:[photo],busy,onOpen:id=>calls.push(id)});
  const article=tree.props.children[2][0],button=article.props.children.at(-1);
  assert.equal(button.props.disabled,busy);if(!busy)button.props.onClick();
 }assert.deepEqual(calls,['source-visit']);
});
test('no pending photos is an explicit empty state',()=>{assert.match(html([]),/No hay fotos pendientes para este filtro/);});
test('untrusted text is escaped and unsafe material protocols have no link',()=>{
 for(const url of ['javascript:alert(1)','data:text/html,test','file:///private/test','https://user:password@example.invalid/material','invalid']){
  const result=html([{...photo,drive_url:url,tipo:'<script>bad</script>',observaciones:'<img src=x>'}]);
  assert.doesNotMatch(result,/<a |<script>|<img /);assert.match(result,/&lt;script&gt;/);
 }
});
test('shared production controls retain compact layout and touch targets',()=>{
 const css=readFileSync(new URL('./Productions.css',import.meta.url),'utf8');assert.match(css,/\.prod-pending-photos button,\.prod-pending-photos a\{min-height:44px/);
 assert.match(source,/<PendingProductionPhotos photos=\{pendingPhotos\} busy=\{busy\} onOpen=\{openVisit\}/);
});
