import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('./ClienteModals.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('ClienteModals.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function find(root,predicate){const out=[];function visit(node){if(predicate(node))out.push(node);ts.forEachChild(node,visit);}visit(root);return out;}
const editor=find(tree,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='EditarCuotaSession')[0];
test('monthly price input accepts Argentine grouped and decimal prices without multiplying or truncating the amount',()=>{
 const input=find(editor,ts.isJsxSelfClosingElement).find(n=>n.tagName.getText(tree)==='input'&&n.getText(tree).includes('Abono mensual en pesos'));
 const change=input.attributes.properties.find(p=>p.name?.getText(tree)==='onChange').initializer.expression.getText(tree);
 for(const [typed,expected] of [['550.000,50','550000.50'],['550.000','550000'],['550000','550000'],['550000.50','550000.50'],['0,50','0.50'],['$ 550.000,00','550000.00'],['','']]){
  let saved;Function('pending','setAbonoMensual',`return (${change})`)({current:false},v=>{saved=v;})({target:{value:typed}});assert.equal(saved,expected);
 }
 let saved=false;Function('pending','setAbonoMensual',`return (${change})`)({current:true},()=>{saved=true;})({target:{value:'999'}});assert.equal(saved,false);
});
test('editor removes day pickers while retaining their saved values and exposes safe back navigation',()=>{
 assert.doesNotMatch(editor.getText(tree),/<WeekdayPicker|Días preferidos/);
 assert.match(editor.getText(tree),/dias_reels: diasReels/);assert.match(editor.getText(tree),/dias_carruseles: diasCarruseles/);
 assert.match(editor.getText(tree),/closeEditor\(onBack\)/);assert.match(editor.getText(tree),/Descartar los cambios del cliente sin guardar/);
 const card=readFileSync(new URL('./ClientCardEditor.jsx',import.meta.url),'utf8');assert.match(card,/onBack=\{\(\)=>setMode\('choose'\)\}/);assert.match(card,/close\(onBack\)/);
});
