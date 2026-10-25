import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createCapturedRequest} from '../shared/session/captured-request.js';
import {createBrowserSessionState} from '../shared/session/browser-session-state.js';

// Actual JSX event expressions and navigation callback. No mounted browser,
// Google transport or synthetic replacement for the production handler.
const source=readFileSync(new URL('./Drive.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('Drive.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX),nodes=[];
(function walk(node){nodes.push(node);ts.forEachChild(node,walk);})(tree);
const variable=name=>nodes.find(node=>ts.isVariableDeclaration(node)&&node.name.getText(tree)===name)?.initializer;
const evaluate=(node,deps)=>Function(...Object.keys(deps),`return (${node.getText(tree)});`)(...Object.values(deps));
const opening=className=>nodes.find(node=>ts.isJsxOpeningElement(node)&&node.attributes.properties.some(p=>p.name?.text==='className'&&p.initializer?.text===className));
const attribute=(node,name)=>node.attributes.properties.find(p=>p.name?.text===name)?.initializer?.expression;
const card=nodes.find(node=>ts.isJsxOpeningElement(node)&&node.tagName.getText(tree)==='article');
const button=opening('drive-file-main');
const crumb=nodes.find(node=>ts.isJsxOpeningElement(node)&&node.tagName.getText(tree)==='button'&&attribute(node,'onClick')?.getText(tree).includes('items.slice(0, index + 1)'));
const folder=(id='A')=>({id,name:`Folder ${id}`,isFolder:true});
function fixture({deferUpdates=false}={}){
  const store=createBrowserSessionState();
  const accept=id=>store.acceptBootstrap(store.beginBootstrap(),{usuario:{id,usuario:`qa${id}`,nombre:'QA',rol:'edicion',activo:true},session_context:String(id).repeat(43),csrf_token:'c'.repeat(43)});
  accept(1);let stack=[{id:'root',name:'Root'}],query='',view={key:'A',session:store.getSession()};
  const mounted={current:true},live={current:''},requests=[],updates=[],queued=[];
  const apply=value=>{stack=typeof value==='function'?value(stack):value;updates.push(stack);};
  const setStack=value=>{if(deferUpdates)queued.push(value);else apply(value);};
  function render(file=folder()){
    const current=stack.at(-1),context=JSON.stringify([view.key,current?.id,query]);live.current=context;
    const deps={current,context,query,view,mounted,live,createCapturedRequest,getSesion:()=>store.getSession(),setStack,
      window:{open:(...args)=>requests.push(args)}};
    const openFolder=variable('openFolder')?evaluate(variable('openFolder'),deps):undefined;
    const onClick=evaluate(attribute(button,'onClick'),{...deps,file,openFolder});
    return{open:openFolder,click:(event={detail:1})=>onClick(event),
      double:attribute(card,'onDoubleClick')?evaluate(attribute(card,'onDoubleClick'),{...deps,file,openFolder}):()=>{},
      breadcrumb:index=>evaluate(attribute(crumb,'onClick'),{setStack,index})()};
  }
  return{render,accept,store,mounted,live,requests,updates,queued,flush(){while(queued.length)apply(queued.shift());},get stack(){return stack;},
    query(value){query=value;},root(){stack=[{id:'other-root',name:'Other'}];},
    replaceSession(id){accept(id);view={key:`session-${id}`,session:store.getSession()};}};
}
test('actual click/click/dblclick gesture appends folder once and article has no competing double-click action',()=>{
  const f=fixture(),render=f.render();render.click();render.click();render.double();
  assert.deepEqual(f.stack.map(row=>row.id),['root','A']);assert.equal(attribute(card,'onDoubleClick'),undefined);
  assert.match(attribute(button,'onClick').getText(tree),/openFolder\(file(?:,|\))/);assert.deepEqual(f.requests,[]);
});
test('second pointer click hitting a newly rendered child does not descend twice; fresh click and keyboard remain usable',()=>{
  const f=fixture();f.render(folder('A')).click({detail:1});
  const child=f.render(folder('B'));child.click({detail:2});
  assert.deepEqual(f.stack.map(row=>row.id),['root','A']);
  child.click({detail:1});assert.deepEqual(f.stack.map(row=>row.id),['root','A','B']);
  f.render(folder('C')).click({detail:0});assert.deepEqual(f.stack.map(row=>row.id),['root','A','B','C']);
  assert.deepEqual(f.requests,[]);
});
test('sequential navigation after rerender opens nested folders normally; old parent callback cannot append siblings',()=>{
  const f=fixture(),root=f.render(folder('A'));root.click();const child=f.render(folder('B'));child.click();root.click();
  assert.deepEqual(f.stack.map(row=>row.id),['root','A','B']);
});
for(const change of ['root','query','session','sessionABA','unmount'])test(`retained same-parent card cannot publish after ${change}`,()=>{
  const f=fixture(),old=f.render(folder());
  if(change==='root'){f.root();f.render();}
  if(change==='query'){f.query('new query');f.render();}
  if(change==='session')f.accept(2); // Guard must work even before React rerenders.
  if(change==='sessionABA'){f.accept(2);f.accept(1);}
  if(change==='unmount')f.mounted.current=false;
  const before=f.stack,count=f.updates.length;old.click();old.double();
  assert.equal(f.stack,before);assert.equal(f.updates.length,count);assert.deepEqual(f.requests,[]);
});
test('functional parent check rejects second append even before the render context advances',()=>{
  const f=fixture(),old=f.render(folder('A'));old.click();const before=f.stack;old.click();
  assert.equal(f.stack,before);assert.deepEqual(f.stack.map(row=>row.id),['root','A']);
});
for(const change of ['query','root','session','sessionABA','unmount'])test(`queued real updater refuses publication if ${change} changes after click admission`,()=>{
  const f=fixture({deferUpdates:true}),old=f.render(folder('A'));old.click();assert.equal(f.queued.length,1);
  assert.deepEqual(f.stack.map(row=>row.id),['root']);
  if(change==='query'){f.query('replacement');f.render();}
  if(change==='root'){f.root();f.render();}
  if(change==='session')f.accept(2);
  if(change==='sessionABA'){f.accept(2);f.accept(1);}
  if(change==='unmount')f.mounted.current=false;
  const before=f.stack;f.flush();assert.equal(f.stack,before);assert.deepEqual(f.requests,[]);
});
test('two queued clicks under the unchanged observation still append exactly once',()=>{
  const f=fixture({deferUpdates:true}),r=f.render(folder('A'));r.click();r.click();assert.equal(f.queued.length,2);
  f.flush();assert.deepEqual(f.stack.map(row=>row.id),['root','A']);
});
test('actual breadcrumb return allows fresh folder reentry and nested navigation without duplicate ancestors',()=>{
  const f=fixture();f.render(folder('A')).click();f.render(folder('B')).click();
  f.render().breadcrumb(0);assert.deepEqual(f.stack.map(row=>row.id),['root']);
  f.render(folder('A')).click();f.render(folder('B')).click();
  assert.deepEqual(f.stack.map(row=>row.id),['root','A','B']);
  f.render(folder('root')).click();assert.deepEqual(f.stack.map(row=>row.id),['root','A','B']);
});
test('actual folder handler rejects nonfolders, invalid IDs and current folder; ordinary files retain external-open behavior',()=>{
  const f=fixture(),r=f.render(),before=f.stack;
  for(const value of [null,{},folder(''),{...folder(),id:3},{...folder(),isFolder:false},folder('root')])r.open(value);
  assert.equal(f.stack,before);assert.deepEqual(f.requests,[]);
  f.render({id:'file',name:'File',isFolder:false,webViewLink:'https://example.invalid/file'}).click();
  assert.deepEqual(f.requests,[['https://example.invalid/file','_blank','noopener,noreferrer']]);assert.equal(f.stack,before);
});
