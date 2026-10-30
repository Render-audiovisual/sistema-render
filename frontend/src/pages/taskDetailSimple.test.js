import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('./WorkspaceReadOnly.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('WorkspaceReadOnly.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function nodes(root,predicate){const result=[];function visit(node){if(predicate(node))result.push(node);ts.forEachChild(node,visit);}visit(root);return result;}
test('simple document retains keyboard editing, workflows and comments while folding insertion tools',()=>{
 const content=nodes(tree,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='TaskContentWorkspace')[0];
 assert.match(content.getText(tree),/<h3>Contenido<\/h3>/);
 const tools=nodes(content,n=>ts.isJsxElement(n)&&n.openingElement.tagName.getText(tree)==='details');
 assert.equal(tools.length,1);assert.match(tools[0].getText(tree),/Agregar bloque/);assert.match(tools[0].getText(tree),/onInsertTemplate/);
 assert.ok(!tools[0].openingElement.attributes.properties.some(p=>p.name?.getText(tree)==='open'));
 assert.match(content.getText(tree),/aria-label="Brief · Contenido de trabajo" rows=\{8\}/);
 assert.match(content.getText(tree),/onSaveEdit/);assert.match(source,/ros-task-workspace ros-task-simple/);
 const css=readFileSync(new URL('./TaskDetailSimple.css',import.meta.url),'utf8');
 assert.doesNotMatch(css, /\.ros-(?:approval|production|task-comments|inline-property)[^{]*\{[^}]*display:\s*none/);
 assert.match(css,/@media\(max-width:640px\)/);assert.match(css,/:focus-visible/);
});
