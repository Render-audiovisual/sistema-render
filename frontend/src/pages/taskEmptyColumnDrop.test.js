import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('./WorkspaceReadOnly.jsx',import.meta.url),'utf8');
const file=ts.createSourceFile('WorkspaceReadOnly.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function find(predicate){let found;function walk(n){if(predicate(n))found=n;ts.forEachChild(n,walk);}walk(file);assert.ok(found);return found;}
const attribute=(node,name)=>node.attributes.properties.find(p=>p.name?.text===name);
const column=find(n=>ts.isJsxOpeningElement(n)&&n.tagName.getText(file)==='section'&&attribute(n,'className')?.getText(file).includes('ros-column ${'));
test('empty column keeps creation as a separate accessible button, not a full-column button',()=>{
 assert.equal(file.parseDiagnostics.length,0);
 const empty=find(n=>ts.isJsxOpeningElement(n)&&attribute(n,'className')?.initializer?.text==='ros-empty-column ros-empty-dropzone');
 assert.equal(empty.tagName.getText(file),'div');
 const button=find(n=>ts.isJsxOpeningElement(n)&&attribute(n,'className')?.initializer?.text==='ros-empty-create');
 assert.equal(button.tagName.getText(file),'button');assert.equal(attribute(button,'type').initializer.text,'button');
 let chosen;const callback=attribute(button,'onClick').initializer.expression;
 new Function('column','setCreatingStatus',`return (${callback.getText(file)})`)({id:'finalizadas',dropState:'finalizada'},v=>chosen=v)();
 assert.equal(chosen,'finalizada');
});
test('column drag enter and over accept only task transfers, preserving the canonical state transition handler',()=>{
 for(const name of ['onDragEnter','onDragOver']){
  const callback=attribute(column,name).initializer.expression;let highlighted='';
  const run=new Function('column','setDragOver',`return (${callback.getText(file)})`)({id:'finalizadas'},v=>highlighted=v);
  for(const types of [[],['text/plain'],['text/task-id']]){
   let prevented=false;const e={dataTransfer:{types,dropEffect:'none'},preventDefault(){prevented=true;}};run(e);
   assert.equal(prevented,types.includes('text/task-id'));if(prevented){assert.equal(highlighted,'finalizadas');assert.equal(e.dataTransfer.dropEffect,'move');}
  }
 }
 assert.match(attribute(column,'onDrop').getText(file),/dropOnProcessButton\(event,column\)/);
});
test('active drag hit-testing exposes the real column even before its hover state updates',()=>{
 const css=readFileSync(new URL('./WorkspaceReadOnly.css',import.meta.url),'utf8');
 assert.match(css,/\.ros-board:has\(\.ros-task-card\.is-dragging\) \.ros-empty-dropzone\{pointer-events:none\}/);
 assert.match(css,/\.ros-empty-create:focus-visible\{outline:2px solid var\(--render-accent\)/);
});
