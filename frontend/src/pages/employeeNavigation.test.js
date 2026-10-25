import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {registerNavigationGuard,installUnsavedNavigation} from '../shared/navigation/unsaved.js';

const source=readFileSync(new URL('./Empleados.jsx',import.meta.url),'utf8');
const file=ts.createSourceFile('Empleados.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
const all=[];function visit(node){all.push(node);ts.forEachChild(node,visit)}visit(file);
const declaration=all.find(node=>ts.isVariableDeclaration(node)&&node.name.getText(file)==='employeeNavigationStatus');

test('managed account uses shared native modality without a competing global Escape handler',()=>{
 const modal=all.find(node=>ts.isJsxOpeningElement(node)&&node.tagName.getText(file)==='Modal'
   &&node.attributes.properties.some(prop=>prop.name?.getText(file)==='className'&&prop.initializer?.text==='usuarios-panel'));
 assert.ok(modal);
 const attrs=new Map(modal.attributes.properties.map(prop=>[prop.name?.getText(file),prop.initializer?.getText(file)]));
 assert.equal(attrs.get('native'),undefined);assert.ok(attrs.has('native'));
 assert.equal(attrs.get('onClose'),'{cerrarAdministracion}');
 assert.equal(attrs.get('closeDisabled'),'{mutationBusy}');
 assert.equal(attrs.get('initialFocusRef'),'{managedHeadingRef}');
 assert.ok(attrs.has('closeOnBackdropClick'));
 assert.equal(attrs.get('headerClassName'),'"usuarios-panel-header"');
 assert.doesNotMatch(source,/window\.addEventListener\('keydown',escape\)/);
 assert.doesNotMatch(source,/<aside\b/);
 assert.match(source,/ref=\{managedHeadingRef\} tabIndex=\{-1\}/);
});
// Execute the actual getter, not a substitute policy or mounted React tree.
function fixture(){
 const state={current:true,modalAltaAbierto:false,altaDirty:false,usuarioAdministrado:null,adminDirty:false,pending:{current:false}};
 const get=()=>new Function('capture','modalAltaAbierto','altaDirty','usuarioAdministrado','adminDirty','pending',`return (${declaration.initializer.getText(file)})();`)(()=>({current:()=>state.current}),state.modalAltaAbierto,state.altaDirty,state.usuarioAdministrado,state.adminDirty,state.pending);
 return {state,get};
}
class Target{
 listeners=new Map();
 addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn)}
 removeEventListener(type,fn){this.listeners.get(type)?.delete(fn)}
 dispatchEvent(event){for(const fn of this.listeners.get(event.type)||[])fn(event);return !event.defaultPrevented}
}
function windowFixture(){const win=new Target();win.location=new URL('https://render.test/empleados');win.navigation=new Target();win.prompts=[];win.accept=false;win.confirm=message=>{win.prompts.push(message);return win.accept};return win}
function event(type,extra={}){return {type,cancelable:true,defaultPrevented:false,preventDefault(){this.defaultPrevented=true},...extra}}
function link(win){const e=event('render:before-navigation',{detail:{href:'/inicio'}});win.dispatchEvent(e);return e}
function traverse(win){const e=event('navigate',{navigationType:'traverse',destination:{sameDocument:true,url:'https://render.test/perfil'}});win.navigation.dispatchEvent(e);return e}

test('hook is unconditional after existing dirty derivations and before unchanged local close guard',()=>{
 assert.equal(file.parseDiagnostics.length,0);
 assert.match(source,/import \{ useNavigationGuard \} from '..\/shared\/navigation\/useNavigationGuard.js'/);
 const calls=all.filter(node=>ts.isCallExpression(node)&&node.expression.getText(file)==='useNavigationGuard');
 assert.equal(calls.length,1);assert.equal(calls[0].arguments[0].getText(file),'employeeNavigationStatus');
 const admin=all.find(node=>ts.isVariableDeclaration(node)&&node.name.getText(file)==='adminDirty');
 const close=all.find(node=>ts.isVariableDeclaration(node)&&node.name.getText(file)==='allowDiscard');
 assert.ok(admin.pos<declaration.pos&&declaration.pos<calls[0].pos&&calls[0].pos<close.pos);
 assert.match(close.initializer.getText(file),/!pending.current && capture\(\).current\(\)/);
});
test('actual getter ignores closed leftover forms and readonly details, tracks open edits and synchronous pending',()=>{
 const f=fixture();f.state.altaDirty=true;f.state.adminDirty=true;
 assert.deepEqual(f.get(),{dirty:false,busy:false});
 f.state.modalAltaAbierto=true;assert.equal(f.get().dirty,true);
 f.state.modalAltaAbierto=false;f.state.usuarioAdministrado={id:7};f.state.adminDirty=false;
 assert.deepEqual(f.get(),{dirty:false,busy:false});
 f.state.adminDirty=true;assert.equal(f.get().dirty,true);
 f.state.pending.current=true;assert.equal(f.get().busy,true);
 f.state.current=false;assert.deepEqual(f.get(),{dirty:false,busy:false});
});
test('actual registered getter cancels/approves link and traversal without clearing draft or busy bypass',()=>{
 const f=fixture(),win=windowFixture(),installation=installUnsavedNavigation(win),unregister=registerNavigationGuard(win,f.get);
 try{
  assert.equal(link(win).defaultPrevented,false);
  f.state.usuarioAdministrado={id:7};f.state.adminDirty=true;
  assert.equal(link(win).defaultPrevented,true);assert.equal(traverse(win).defaultPrevented,true);assert.equal(win.prompts.length,2);
  win.accept=true;assert.equal(link(win).defaultPrevented,false);assert.equal(traverse(win).defaultPrevented,false);
  assert.equal(f.state.adminDirty,true);assert.equal(f.state.usuarioAdministrado.id,7);
  f.state.pending.current=true;const prompts=win.prompts.length;
  assert.equal(link(win).defaultPrevented,true);assert.equal(traverse(win).defaultPrevented,true);assert.equal(win.prompts.length,prompts);
  f.state.current=false;assert.equal(link(win).defaultPrevented,false);assert.equal(traverse(win).defaultPrevented,false);assert.equal(win.prompts.length,prompts);
 }finally{unregister();installation.dispose()}
});
test('beforeunload is protected for dirty or busy; unmount registration cleanup removes protection',()=>{
 const f=fixture(),win=windowFixture(),installation=installUnsavedNavigation(win),unregister=registerNavigationGuard(win,f.get);
 f.state.modalAltaAbierto=true;f.state.altaDirty=true;
 const unload=event('beforeunload');win.dispatchEvent(unload);assert.equal(unload.defaultPrevented,true);assert.equal(unload.returnValue,'');assert.equal(win.prompts.length,0);
 f.state.altaDirty=false;f.state.pending.current=true;const busy=event('beforeunload');win.dispatchEvent(busy);assert.equal(busy.defaultPrevented,true);
 unregister();assert.equal(link(win).defaultPrevented,false);const after=event('beforeunload');win.dispatchEvent(after);assert.equal(after.defaultPrevented,false);
 installation.dispose();assert.equal(win.listeners.get('beforeunload').size,0);assert.equal(win.navigation.listeners.get('navigate').size,0);
});
