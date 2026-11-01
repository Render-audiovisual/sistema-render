import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const source=readFileSync(new URL('./InstagramPanel.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('InstagramPanel.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
const declaration=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='FormatProgress');
assert.ok(declaration);
const code=ts.transpileModule(declaration.getText(tree),{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
const Component=Function('React','fmt',`${code};return FormatProgress;`)(React,String);
const html=(format,status='current')=>renderToStaticMarkup(React.createElement(Component,{label:'Carruseles',format,status}));
test('unknown count is a dash and never a zero progressbar',()=>{
  const result=html({cantidad:null,cuota:4,incluido:true},'unavailable');assert.match(result,/— \/ 4/);assert.doesNotMatch(result,/role="progressbar"|aria-valuenow/);
});
test('verified zero is a real zero with zero progress, separate from unavailable',()=>{
  const result=html({cantidad:0,cuota:4,incluido:true});assert.match(result,/0 \/ 4/);assert.match(result,/aria-valuenow="0"/);
});
test('excess is visible but the accessible progress never exceeds the quota',()=>{
  const result=html({cantidad:6,cuota:4,incluido:true});assert.match(result,/6 \/ 4/);assert.match(result,/aria-valuenow="4"/);assert.match(result,/width:100%/);
});
test('zero quota and absent quota are not confused, stale data does not claim live progress',()=>{
  assert.match(html({cantidad:2,cuota:0,incluido:false}),/2 registrados · No incluido/);
  assert.match(html({cantidad:2,cuota:null,incluido:null}),/2 \/ —/);
  assert.doesNotMatch(html({cantidad:2,cuota:4,incluido:true},'stale'),/role="progressbar"|aria-valuenow/);
});
