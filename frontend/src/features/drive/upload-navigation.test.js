import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {uploadNavigationState} from './upload-navigation.js';
import {requestDriveFolderChange} from './folder-navigation.js';
import {installUnsavedNavigation,registerNavigationGuard} from '../../shared/navigation/unsaved.js';

const source=readFileSync(new URL('./DriveUploader.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('DriveUploader.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
assert.equal(tree.parseDiagnostics.length,0);
function nodes(root,predicate){const result=[];function walk(node){if(predicate(node))result.push(node);ts.forEachChild(node,walk);}walk(root);return result;}
const owner=name=>tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);
const scope=owner('UploadScope');assert.ok(scope);
const calls=name=>nodes(scope,node=>ts.isCallExpression(node)&&node.expression.getText(tree)===name);
const attr=(node,key,ast=tree)=>node.attributes.properties.find(value=>ts.isJsxAttribute(value)&&value.name.getText(ast)===key);
const expr=(node,key,ast=tree)=>attr(node,key,ast)?.initializer?.expression?.getText(ast);
function extract(node,deps){return Function(...Object.keys(deps),`return (${node.getText(tree)});`)(...Object.values(deps));}

test('pure upload navigation flags cover every file/upload/uncertainty/readback combination without mutation',()=>{
  for(const hasFile of [false,true])for(const uploading of [false,true])for(const blocked of [false,true])for(const refreshFailed of [false,true]){
    const input=Object.freeze({hasFile,uploading,blocked,refreshFailed});
    assert.deepEqual(uploadNavigationState(input),{dirty:hasFile||blocked||refreshFailed,busy:uploading});
  }
  assert.deepEqual(uploadNavigationState({}),{dirty:false,busy:false});
});

test('actual guard callback reads the synchronous pending ref before React reports uploading and retires on inactive scope',()=>{
  const guardCalls=calls('useNavigationGuard');assert.equal(guardCalls.length,1);
  const pending={current:false};let active=true;
  const navigation={dirty:false,busy:false};
  const guard=extract(guardCalls[0].arguments[0],{pending,navigation,isActive:()=>active});
  assert.deepEqual(guard(),{dirty:false,busy:false});
  pending.current=true;assert.deepEqual(guard(),{dirty:false,busy:true});
  navigation.dirty=true;assert.deepEqual(guard(),{dirty:true,busy:true});
  pending.current=false;navigation.busy=true;assert.deepEqual(guard(),{dirty:true,busy:true});
  active=false;assert.deepEqual(guard(),{dirty:false,busy:false});
  assert.deepEqual(navigation,{dirty:true,busy:true});assert.equal(pending.current,false);
});

test('actual layout reports dirty/busy and clears each parent flag through cleanup including StrictMode replay',()=>{
  const effects=calls('useLayoutEffect');
  for(const [callback,flag] of [['onDirty','dirty'],['onBusy','busy']]){
    const effect=effects.find(node=>node.arguments[0].getText(tree).includes(callback));assert.ok(effect);
    assert.equal(effect.arguments[1].getText(tree),`[navigation.${flag},${callback}]`);
    for(const state of [false,true]){
      const values=[],deps={navigation:{[flag]:state},[callback]:value=>values.push(value)};
      const run=extract(effect.arguments[0],deps),cleanup=run();assert.deepEqual(values,[state]);
      assert.equal(typeof cleanup,'function');cleanup();const second=run();second();
      assert.deepEqual(values,[state,false,state,false]);
      const optional=extract(effect.arguments[0],{navigation:{[flag]:state},[callback]:undefined});
      assert.doesNotThrow(()=>optional()());
    }
  }
});

test('actual model observation and shared uploader forward both callbacks to the scoped owner',()=>{
  const declaration=nodes(scope,node=>ts.isVariableDeclaration(node)&&node.name.getText(tree)==='navigation')[0];assert.ok(declaration);
  assert.equal(declaration.initializer.expression.getText(tree),'uploadNavigationState');
  const args=declaration.initializer.arguments[0];
  const fields=new Map(args.properties.map(node=>[node.name.getText(tree),ts.isShorthandPropertyAssignment(node)?node.name.getText(tree):node.initializer.getText(tree)]));
  assert.deepEqual(Object.fromEntries(fields),{hasFile:'Boolean(file)',uploading:'uploading',blocked:'recoveryState.blocked',refreshFailed:'refreshFailed'});
  const wrapper=owner('DriveUploader');assert.ok(wrapper);
  const child=nodes(wrapper,node=>ts.isJsxSelfClosingElement(node)&&node.tagName.getText(tree)==='UploadScope')[0];assert.ok(child);
  assert.equal(expr(child,'onDirty'),'onDirty');assert.equal(expr(child,'onBusy'),'onBusy');
  assert.equal(expr(child,'key'),'context');
});

test('TaskDetail feeds uploader flags into existing dirty/busy closure gates without replacing task guards',()=>{
  const parentSource=readFileSync(new URL('../../pages/WorkspaceReadOnly.jsx',import.meta.url),'utf8');
  const parent=ts.createSourceFile('WorkspaceReadOnly.jsx',parentSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  const detail=parent.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='TaskDetail');assert.ok(detail);
  const variables=nodes(detail,node=>ts.isVariableDeclaration(node));
  for(const name of ['uploadDirty','uploadBusy']){
    const state=variables.find(node=>ts.isArrayBindingPattern(node.name)&&node.name.elements[0].name?.getText(parent)===name);assert.ok(state);
    assert.equal(state.initializer.getText(parent),'useState(false)');
  }
  const dirty=variables.find(node=>node.name.getText(parent)==='taskDraftDirty'),busy=variables.find(node=>node.name.getText(parent)==='taskWriteBusy');
  assert.ok(nodes(dirty.initializer,node=>ts.isIdentifier(node)&&node.text==='uploadDirty').length);
  assert.ok(nodes(busy.initializer,node=>ts.isIdentifier(node)&&node.text==='uploadBusy').length);
  assert.match(dirty.initializer.getText(parent),/isTaskDraftDirty\(task, draft\)/);
  assert.match(busy.initializer.getText(parent),/saving.*commenting/);
  const uploader=nodes(detail,node=>ts.isJsxSelfClosingElement(node)&&node.tagName.getText(parent)==='DriveUploader');assert.equal(uploader.length,1);
  assert.equal(expr(uploader[0],'onDirty',parent),'setUploadDirty');assert.equal(expr(uploader[0],'onBusy',parent),'setUploadBusy');
  const close=variables.find(node=>node.name.getText(parent)==='closeDetail');assert.ok(close);
  assert.match(close.initializer.getText(parent),/taskWriteBusy/);assert.match(close.initializer.getText(parent),/taskDraftDirty/);
});

function navigationWindow(accepted){
  class DetailEvent extends Event{constructor(type,options){super(type,options);this.detail=options.detail;}}
  const win=new EventTarget(),effects=[];win.CustomEvent=DetailEvent;
  win.location=new URL('https://render.test/drive?folder=original#files');
  win.history={pushState:()=>assert.fail('Folder guard must not push history'),replaceState:()=>assert.fail('Folder guard must not replace history')};
  win.confirm=()=>{effects.push('confirm');return accepted;};
  return{win,effects};
}
const folderCases=[
  {name:'dirty cancelled',status:{dirty:true,busy:false},accepted:false,allowed:false,confirms:1},
  {name:'busy',status:{dirty:true,busy:true},accepted:true,allowed:false,confirms:0},
  {name:'clean',status:{dirty:false,busy:false},accepted:false,allowed:true,confirms:0},
  {name:'dirty confirmed',status:{dirty:true,busy:false},accepted:true,allowed:true,confirms:1},
];
test('real folder navigation dispatch uses installed shared refresh guards, never history or location writes',()=>{
  for(const scenario of folderCases){
    const {win,effects}=navigationWindow(scenario.accepted),installed=installUnsavedNavigation(win),observations=[];
    const remove=registerNavigationGuard(win,context=>{observations.push(context);return scenario.status;});
    const before=win.location.href;
    try{
      assert.equal(requestDriveFolderChange(win),scenario.allowed,scenario.name);
      assert.deepEqual(observations,[{from:'/drive?folder=original#files',to:'/drive?folder=original#files',type:'refresh'}]);
      assert.equal(effects.length,scenario.confirms);assert.equal(win.location.href,before);
    }finally{remove();installed.dispose();}
  }
});

test('actual Drive root, folder and breadcrumb callbacks preserve local selection when shared guards deny',()=>{
  const driveSource=readFileSync(new URL('../../pages/Drive.jsx',import.meta.url),'utf8');
  const driveTree=ts.createSourceFile('Drive.jsx',driveSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  assert.equal(driveTree.parseDiagnostics.length,0);
  const variable=name=>nodes(driveTree,node=>ts.isVariableDeclaration(node)&&node.name.getText(driveTree)===name)[0]?.initializer;
  const breadcrumb=nodes(driveTree,node=>ts.isJsxOpeningElement(node)&&node.tagName.getText(driveTree)==='button'
    &&expr(node,'onClick',driveTree)?.includes('items.slice(0, index + 1)'))[0];assert.ok(breadcrumb);
  const callbacks={root:variable('selectRoot'),folder:variable('openFolder'),breadcrumb:attr(breadcrumb,'onClick',driveTree).initializer.expression};
  for(const [kind,node] of Object.entries(callbacks))for(const scenario of folderCases){
    assert.ok(node,kind);assert.match(node.getText(driveTree),/requestDriveFolderChange\(window\)/);
    const {win,effects}=navigationWindow(scenario.accepted),installed=installUnsavedNavigation(win);
    const remove=registerNavigationGuard(win,()=>scenario.status),changes=[];
    let stack=[{id:'root',name:'Root'},{id:'child',name:'Child'}],query='original',rootKey='original';
    const before=structuredClone({stack,query,rootKey}),href=win.location.href;
    const deps={window:win,requestDriveFolderChange,status:{roots:{next:'new-root'}},ROOT_LABELS:{next:'New root'},index:0,
      setRootKey:value=>{rootKey=value;changes.push('root');},setQuery:value=>{query=value;changes.push('query');},
      setStack:value=>{stack=typeof value==='function'?value(stack):value;changes.push('stack');},
      current:{id:'child'},view:{session:{}},getSesion:()=>null,mounted:{current:true},live:{current:'same'},context:'same',
      createCapturedRequest:()=>({current:()=>true})};
    try{
      const callback=Function(...Object.keys(deps),`return (${node.getText(driveTree)});`)(...Object.values(deps));
      if(kind==='root')callback('next');else if(kind==='folder')callback({id:'next-folder',name:'Next',isFolder:true},1);else callback();
      if(!scenario.allowed){assert.deepEqual({stack,query,rootKey},before);assert.deepEqual(changes,[]);}
      else if(kind==='root')assert.deepEqual({stack,query,rootKey},{stack:[{id:'new-root',name:'New root'}],query:'',rootKey:'next'});
      else if(kind==='folder')assert.deepEqual(stack,[...before.stack,{id:'next-folder',name:'Next'}]);
      else assert.deepEqual(stack,[before.stack[0]]);
      assert.equal(effects.length,scenario.confirms);assert.equal(win.location.href,href);
    }finally{remove();installed.dispose();}
  }
});
