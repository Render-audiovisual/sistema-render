import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import ts from 'typescript';
import postcss from 'postcss';
import {createCapturedRequest} from '../../shared/session/captured-request.js';

const source=readFileSync(new URL('./DriveUploader.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('DriveUploader.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
assert.equal(tree.parseDiagnostics.length,0);
const owner=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='FolderPicker');assert.ok(owner);
function nodes(root,predicate){const result=[];function walk(node){if(predicate(node))result.push(node);ts.forEachChild(node,walk);}walk(root);return result;}
const attr=(node,key)=>node.attributes.properties.find(value=>ts.isJsxAttribute(value)&&value.name.getText(tree)===key);
const expr=(node,key)=>attr(node,key)?.initializer?.expression?.getText(tree);
function extract(node,deps){const code=ts.transpileModule(`const extracted=(${node.getText(tree)});`,{
  compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
  return Function(...Object.keys(deps),`${code}\nreturn extracted;`)(...Object.values(deps));}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({driveFiles=async()=>[]}={}){
  const states=[],refs=[],events=[],requests=[];let si=0,ri=0,effect,cleanup,current,active=true;
  const session={token:'synthetic-local-test-token',usuario:{id:7,usuario:'qa_picker',rol:'produccion'}},sessionRef={current:session};
  const root={id:'root-id',label:'QA Root'},returnFocusRef={current:{kind:'exact-picker-button'}};
  function Modal(){return null;}
  const Picker=extract(owner,{React,Modal,createCapturedRequest,
    useRef:value=>refs[ri++]||=( {current:value} ),
    useState(initial){const i=si++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;
      return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;events.push(['state',i]);}];},
    useEffect:fn=>{effect=fn;},
    driveFiles:(id,query,options)=>{requests.push({id,query,options});return driveFiles(id,query,options);},
  });
  const render=()=>{si=0;ri=0;current=Picker({root,returnFocusRef,session,readSession:()=>sessionRef.current,isActive:()=>active,
    onClose:()=>events.push(['close']),onSelect:folder=>events.push(['select',folder])});return current;};
  function find(predicate){const result=[];function walk(value){if(Array.isArray(value)){value.forEach(walk);return;}
    if(!React.isValidElement(value))return;if(predicate(value))result.push(value);walk(value.props.children);}walk(current);return result;}
  render();
  return{root,sessionRef,returnFocusRef,refs,states,events,requests,render,find,Modal,get tree(){return current;},
    mount(){cleanup?.();cleanup=effect();},unmount(){active=false;cleanup?.();},
    button:label=>find(element=>element.type==='button'&&(element.props['aria-label']===label||element.props.children===label))[0]};
}

test('actual picker delegates native focus/return and cancellation to exactly one chrome-free shared kernel',()=>{
  const f=fixture(),modal=f.tree;
  assert.equal(modal.type,f.Modal);assert.equal(modal.props.native,true);assert.equal(modal.props.chrome,false);
  assert.equal(modal.props.overlayClassName,'drive-picker-backdrop');assert.equal(modal.props.overlayAriaLabel,'Elegir carpeta');
  assert.equal(modal.props.initialFocusRef,f.refs[0]);assert.equal(modal.props.returnFocusRef,f.returnFocusRef);
  assert.equal(f.button('Cerrar selector de carpetas').props.ref,f.refs[0]);
  assert.equal(f.button('Cerrar selector de carpetas').props.type,'button');
  assert.equal(f.find(element=>element.type===f.Modal).length,1);
  assert.equal(f.find(element=>element.props.role==='dialog'||element.props['aria-modal']).length,0);
  assert.equal(f.find(element=>element.type==='p'&&element.props.role==='status')[0].props.children,'Cargando carpetas…');
});

test('toolbar close, Cancel and shared cancel callback invoke the existing close action only',()=>{
  for(const action of ['Cerrar selector de carpetas','Cancelar','kernel']){
    const f=fixture();if(action==='kernel')f.tree.props.onClose();else f.button(action).props.onClick();
    assert.deepEqual(f.events,[['close']]);assert.equal(f.requests.length,0);
  }
});

test('actual folder read filters files; navigation/back and selection retain exact folder context',async()=>{
  const folder={id:'child-id',name:'Child folder',isFolder:true},file={id:'file-id',name:'Not a folder',isFolder:false};
  const f=fixture({driveFiles:async id=>id==='root-id'?[folder,file]:[]});
  f.mount();await flush();f.render();assert.equal(f.requests.length,1);assert.equal(f.requests[0].id,'root-id');
  assert.equal(f.requests[0].query,'');assert.ok(f.requests[0].options.signal instanceof AbortSignal);
  const rows=f.find(element=>element.type==='button'&&element.key==='child-id');assert.equal(rows.length,1);
  assert.equal(f.find(element=>element.key==='file-id').length,0);
  rows[0].props.onClick();f.render();f.mount();await flush();f.render();
  assert.equal(f.requests[1].id,'child-id');assert.equal(f.requests[0].options.signal.aborted,true);
  assert.equal(f.find(element=>element.type==='small')[0].props.children,'QA Root / Child folder');
  f.events.length=0;f.button('Usar esta carpeta').props.onClick();assert.deepEqual(f.events,[['select',folder]]);
  f.button('← Volver').props.onClick();f.render();f.mount();await flush();f.render();
  assert.equal(f.requests[2].id,'root-id');assert.equal(f.button('← Volver'),undefined);
  f.events.length=0;f.button('Usar esta carpeta').props.onClick();assert.deepEqual(f.events,[['select',{id:'root-id',name:'QA Root'}]]);
  f.unmount();
});

test('late folder read after unmount or retired session cannot update the picker',async()=>{
  for(const retired of ['unmount','session']){
    let release;const pending=new Promise(resolve=>{release=resolve;}),f=fixture({driveFiles:()=>pending});
    f.mount();f.events.length=0;
    if(retired==='unmount')f.unmount();else f.sessionRef.current=null;
    release([{id:'late-id',name:'Late folder',isFolder:true}]);await flush();
    assert.deepEqual(f.events,[]);assert.equal(f.states[1].length,0);
    if(retired==='unmount')assert.equal(f.requests[0].options.signal.aborted,true);
    f.unmount();
  }
});

test('actual UploadScope wires the existing picker invoker and preserves guarded selection and close',()=>{
  const upload=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='UploadScope');assert.ok(upload);
  const declarations=nodes(upload,node=>ts.isVariableDeclaration(node)&&node.name.getText(tree)==='pickerButtonRef');
  assert.equal(declarations.length,1);assert.equal(declarations[0].initializer.getText(tree),'useRef(null)');
  const openings=nodes(upload,node=>ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node));
  const invoker=openings.find(node=>node.tagName.getText(tree)==='button'&&expr(node,'onClick')==='() => setPickerRoot(destination?.root)');assert.ok(invoker);
  assert.equal(expr(invoker,'ref'),'pickerButtonRef');
  // Selecting a destination replaces Elegir carpeta with Subir. The shared
  // return ref must follow that new button rather than a disconnected opener.
  const resolved=openings.find(node=>node.tagName.getText(tree)==='button'&&expr(node,'onClick')==='() => upload()');assert.ok(resolved);
  assert.equal(expr(resolved,'ref'),'pickerButtonRef');
  assert.equal(openings.filter(node=>node.tagName.getText(tree)==='button'&&expr(node,'ref')==='pickerButtonRef').length,2);
  const picker=openings.find(node=>node.tagName.getText(tree)==='FolderPicker');assert.ok(picker);
  assert.equal(expr(picker,'returnFocusRef'),'pickerButtonRef');assert.equal(expr(picker,'root'),'pickerRoot');
  const effects=[],deps={session:{usuario:{id:7}},getSesion:()=>null,isActive:()=>true,
    createCapturedRequest:()=>({current:()=>true}),setDestination:value=>effects.push(['destination',value]),setPickerRoot:value=>effects.push(['picker',value])};
  const selected={id:'chosen',name:'Chosen folder'};
  extract(attr(picker,'onSelect').initializer.expression,deps)(selected);
  assert.deepEqual(effects,[['destination',{status:'resolved',folder:selected,breadcrumb:'Chosen folder'}],['picker',null]]);
  effects.length=0;extract(attr(picker,'onSelect').initializer.expression,{...deps,createCapturedRequest:()=>({current:()=>false})})(selected);
  assert.deepEqual(effects,[]);
  extract(attr(picker,'onClose').initializer.expression,deps)();assert.deepEqual(effects,[['picker',null]]);
});

test('picker adds no competing keyboard/native lifecycle and its shared scroll surface contains overscroll',()=>{
  assert.doesNotMatch(owner.getText(tree),/addEventListener|removeEventListener|keydown|Escape|showModal\(|\.focus\(|localStorage|sessionStorage/);
  const css=postcss.parse(readFileSync(new URL('./DriveUploader.css',import.meta.url),'utf8'));let overscroll;
  css.walkRules(rule=>{if(postcss.list.comma(rule.selector).includes('.drive-folder-picker'))rule.walkDecls('overscroll-behavior',decl=>{overscroll=decl.value;});});
  assert.equal(overscroll,'contain');
});
