import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {readMoodboardLocation,resolveMoodboardBoard,moodboardBoardUrl,moodboardTaskIntent} from './moodboardLocation.js';
import {createMoodboardBoardLoader} from '../shared/session/moodboard-board-loader.js';
import {createCapturedRequest} from '../shared/session/captured-request.js';

const boards=[{id:1,clientes:[{id:10}]},{id:2,clientes:[{id:20}]}];
test('canonical positive IDs, absent intent and strict duplicate/range validation',()=>{
  assert.deepEqual(readMoodboardLocation('?board=123&cliente=10&task=2147483647'),{boardId:123,clientId:10,taskId:2147483647});
  assert.deepEqual(readMoodboardLocation(''),{boardId:null,clientId:null,taskId:null});
  for(const key of ['board','cliente','task'])for(const value of ['0','01','-1','1.0','2147483648','1%0A','', 'abc'])assert.throws(()=>readMoodboardLocation(`?${key}=${value}`));
  for(const key of ['board','cliente','task'])assert.throws(()=>readMoodboardLocation(`?${key}=1&${key}=1`));
});
test('explicit board wins; unavailable board/client never silently falls back',()=>{
  assert.equal(resolveMoodboardBoard(boards,readMoodboardLocation('?board=2&cliente=10')),2);
  assert.equal(resolveMoodboardBoard(boards,readMoodboardLocation('?cliente=20')),2);
  assert.equal(resolveMoodboardBoard(boards,readMoodboardLocation('')),1);
  assert.equal(resolveMoodboardBoard([],readMoodboardLocation('')),null);
  assert.throws(()=>resolveMoodboardBoard(boards,readMoodboardLocation('?board=99&cliente=10')));
  assert.throws(()=>resolveMoodboardBoard(boards,readMoodboardLocation('?cliente=99')));
});
test('board URL preserves client/task/other intent and hash without mutation',()=>{
  const url=new URL('https://render.test/moodboards?cliente=10&task=7&filter=x#detail');
  assert.equal(moodboardBoardUrl(url,2),'/moodboards?cliente=10&task=7&filter=x&board=2#detail');
  assert.equal(url.searchParams.has('board'),false);
  for(const value of ['/other','javascript:alert(1)','https://user:secret@render.test/moodboards'])assert.throws(()=>moodboardBoardUrl(value,1));
});
test('task intent belongs to loaded tasks AND original requested client, never unrelated composer',()=>{
  const location=readMoodboardLocation('?cliente=10&task=7'),before=JSON.stringify({boards,location});
  assert.equal(moodboardTaskIntent(location,boards[0],[{id:7}]),7);
  assert.equal(moodboardTaskIntent(location,boards[1],[{id:7}]),null);
  assert.equal(moodboardTaskIntent(location,boards[0],[{id:8}]),null);
  assert.equal(moodboardTaskIntent(null,boards[0],[{id:7}]),null);
  assert.equal(JSON.stringify({boards,location}),before);
});

// Actual source callbacks with injected effects; not mounted React/browser.
const source=readFileSync(new URL('./MoodboardPreview.jsx',import.meta.url),'utf8');
const file=ts.createSourceFile('MoodboardPreview.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function nodes(root,predicate){const found=[];function visit(n){if(predicate(n))found.push(n);ts.forEachChild(n,visit)}visit(root);return found}
function callback(name,deps){const node=nodes(file,n=>ts.isVariableDeclaration(n)&&n.name.getText(file)===name)[0].initializer;return new Function(...Object.keys(deps),`return (${node.getText(file)});`)(...Object.values(deps))}
test('actual activation clears collections, overlays and filters synchronously, including ABA',()=>{
  const effects=[],deps={operationOwners:{current:new Set()},boardLoader:{current:{cancel(){effects.push('cancel')}}},loadGeneration:{current:0},boardObservation:{current:{id:1,generation:0}}};
  for(const key of ['Refs','Categories','Tasks','Selected','Composer','CategoryEditor','Status','Category','Query','BoardId','BoardEpoch','Loading'])deps[`set${key}`]=value=>effects.push([key,value]);
  const activate=callback('activateBoard',deps),old=deps.boardObservation.current;
  activate(2);activate(1);assert.notEqual(deps.boardObservation.current,old);assert.equal(deps.boardObservation.current.generation,2);
  for(const key of ['Refs','Categories','Tasks'])assert.ok(effects.some(([name,value])=>name===key&&Array.isArray(value)&&!value.length));
  assert.ok(effects.some(([name,value])=>name==='Selected'&&value===null));
  assert.ok(effects.some(([name,value])=>name==='Composer'&&value===false));
});
test('actual load fences late success/error/finally on board ABA, session change and unmount',async()=>{
  for(const change of ['board','session','unmount'])for(const fail of [false,true]){
    const calls=[],effects=[],session={token:'original',usuario:{id:1,rol:'admin',activo:true}},deps={sesion:structuredClone(session),mounted:{current:true},boardObservation:{current:{id:1,generation:1}},boardLoader:{current:null},loadGeneration:{current:0},getSesion:()=>session,api:()=>new Promise((resolve,reject)=>calls.push({resolve,reject})),createCapturedRequest,createMoodboardBoardLoader,moodboardTaskIntent,locationRef:{current:{selection:readMoodboardLocation('')}},catalog:{current:boards}};
    for(const key of ['Loading','Refs','Categories','Tasks','Error','Composer'])deps[`set${key}`]=value=>effects.push([key,value]);
    const pending=callback('load',deps)(1);assert.equal(calls.length,3);const count=effects.length;
    if(change==='board')deps.boardObservation.current={id:1,generation:3};
    if(change==='session')session.token='new';
    if(change==='unmount')deps.mounted.current=false;
    for(const call of calls)fail?call.reject(new Error('private stale error')):call.resolve([]);
    await pending;assert.equal(effects.length,count);
  }
});
test('source wires popstate, genuine reads, keyed overlays and origin-only writer refreshes',()=>{
  assert.equal(file.parseDiagnostics.length,0);
  assert.match(source,/addEventListener\('popstate',pop\)/);
  assert.match(source,/pushState\(window.history.state,"",href\)/);
  assert.doesNotMatch(source,/heldURL|heldUrl|history\.(?:go|back|forward)\(/);
  assert.match(source,/initialTask=\{moodboardTaskIntent\(location.selection,board,tasks\)\}/);
  assert.doesNotMatch(source,/initialTask=\{requestedTask\}/);
  assert.match(source,/key=\{`\$\{boardEpoch\}:composer`\}/);
  const composer=nodes(file,n=>ts.isJsxSelfClosingElement(n)&&n.tagName.getText(file)==='Composer')[0];
  const saved=composer.attributes.properties.find(n=>n.name?.getText(file)==='saved');
  assert.equal(saved.initializer.expression.getText(file),'finishReference');
  assert.match(source,/session:sesion,readSession:getSesion,request:api/);
});
test('actual same-board reload refreshes selected DTO by ID and closes removed references',async()=>{
  for(const missing of [false,true]){
    let selected={id:7,tareas:[]};const fresh={id:7,tareas:[{id:9}]};
    const session={token:'original',usuario:{id:1,rol:'admin',activo:true}};
    const deps={sesion:structuredClone(session),mounted:{current:true},boardObservation:{current:{id:1,generation:1}},boardLoader:{current:null},loadGeneration:{current:0},getSesion:()=>session,api:async url=>url.endsWith('/references')?(missing?[]:[fresh]):[],createCapturedRequest,createMoodboardBoardLoader,moodboardTaskIntent,locationRef:{current:{selection:readMoodboardLocation('')}},catalog:{current:boards},setSelected:update=>{selected=update(selected)}};
    for(const key of ['Loading','Refs','Categories','Tasks','Error','Composer'])deps[`set${key}`]=()=>{};
    await callback('load',deps)(1);assert.equal(selected,missing?null:fresh);
  }
});

test('actual finish consumes only task intent with current origin/session; draft close preserves location',()=>{
  const rendered={token:'original',usuario:{id:1,rol:'admin',activo:true}},effects=[];
  let live=structuredClone(rendered),active=true;
  const initial={selection:readMoodboardLocation('?board=2&cliente=20&task=7'),error:''};
  const locationRef={current:initial},win={location:{href:'https://render.test/moodboards?board=2&cliente=20&task=7&filter=x#detail'},history:{state:{fromTasks:'/workspace/tareas?task=7'},replaceState(...args){effects.push(['history',...args]);}}};
  const originCurrent=()=>active;
  const scope=createCapturedRequest({session:rendered,readSession:()=>live,request:()=>assert.fail('finish never writes or reloads'),isActive:originCurrent});
  const deps={window:win,locationRef,originCurrent,setLocation:value=>effects.push(['location',value]),setComposer:value=>effects.push(['composer',value])};
  const composer=nodes(file,n=>ts.isJsxSelfClosingElement(n)&&n.tagName.getText(file)==='Composer')[0];
  const close=composer.attributes.properties.find(n=>n.name?.getText(file)==='close').initializer.expression;
  new Function(...Object.keys(deps),`return (${close.getText(file)});`)(...Object.values(deps))();
  assert.deepEqual(effects,[['composer',false]]);
  assert.equal(locationRef.current,initial);
  effects.length=0;
  callback('finishReference',deps)(scope);
  assert.deepEqual(effects.map(([name])=>name),['history','location','composer']);
  assert.deepEqual(effects[0],['history',win.history.state,'','/moodboards?board=2&cliente=20&filter=x#detail']);
  assert.deepEqual(locationRef.current,{...initial,selection:{...initial.selection,taskId:null}});
  assert.deepEqual(initial.selection,{boardId:2,clientId:20,taskId:7});
  assert.deepEqual(effects.at(-1),['composer',false]);

  for(const obsolete of ['session','origin']){
    effects.length=0;locationRef.current=initial;live=structuredClone(rendered);active=true;
    const captured=createCapturedRequest({session:rendered,readSession:()=>live,request:()=>assert.fail('no request'),isActive:originCurrent});
    if(obsolete==='session')live={...live,token:'another-account',usuario:{...live.usuario,id:2}};
    else active=false;
    assert.throws(()=>callback('finishReference',deps)(captured),error=>error.code==='session_binding_obsolete');
    assert.deepEqual(effects,[]);assert.equal(locationRef.current,initial);
  }
});

test('composer success and explicit finish invoke saved, while idle draft close does not',()=>{
  const composer=nodes(file,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='Composer')[0];
  const local=name=>nodes(composer,n=>ts.isVariableDeclaration(n)&&n.name.getText(file)===name)[0].initializer.getText(file);
  const saved=[],scope={assertCurrent(){}};
  const model={snapshot:{phase:'idle'},finish:()=>({scope})};
  const completed=new Function('model','saved',`return (${local('completed')});`)(model,value=>saved.push(value));
  completed({scope});assert.deepEqual(saved,[]);
  model.snapshot.phase='complete';completed({scope});assert.deepEqual(saved,[scope]);
  assert.match(local('finish'),/model.refresh\(\)/);
  assert.match(local('finish'),/saved\(model.finish\(\).scope\)/);
  const actions=[];
  const leave=new Function('busy','state','close','finish',`return (${local('leave')});`);
  leave(false,{phase:'idle'},()=>actions.push('close'),()=>actions.push('finish'))();
  leave(false,{phase:'created'},()=>actions.push('close'),()=>actions.push('finish'))();
  leave(true,{phase:'created'},()=>actions.push('close'),()=>actions.push('finish'))();
  assert.deepEqual(actions,['close','finish']);
});

test('actual controlled board selection checks busy owner and navigation approval before pushing history',()=>{
  const effects=[],owners={current:new Set(['pending-write'])},selection={selection:readMoodboardLocation('?board=2&cliente=20&task=7'),error:''};
  let allow=true;
  const win={location:{href:'https://render.test/moodboards?board=1&cliente=20&task=7#detail'},history:{state:{origin:'test'},pushState(...args){effects.push(['push',...args]);}}};
  const choose=callback('chooseBoard',{operationOwners:owners,window:win,moodboardBoardUrl,
    requestAppNavigation:(_win,href)=>{effects.push(['approval',href]);return allow},
    applyLocation:value=>effects.push(['apply',value]),currentMoodboardLocation:()=>selection});
  choose(2);assert.deepEqual(effects,[]);
  owners.current.clear();allow=false;choose(2);
  assert.deepEqual(effects,[['approval','/moodboards?board=2&cliente=20&task=7#detail']]);
  effects.length=0;allow=true;choose(2);
  assert.deepEqual(effects,[['approval','/moodboards?board=2&cliente=20&task=7#detail'],
    ['push',win.history.state,'','/moodboards?board=2&cliente=20&task=7#detail'],['apply',selection]]);
});

test('actual escaped pop passes allowEscape and busy activation invalidates old scope without history compensation',()=>{
  const selection={selection:readMoodboardLocation('?board=2&cliente=20&task=7'),error:''},effects=[];
  callback('pop',{currentMoodboardLocation:()=>selection,applyLocation:(...args)=>effects.push(args)})();
  assert.deepEqual(effects,[[selection,undefined,true]]);
  const deps={operationOwners:{current:new Set(['pending-write'])},boardLoader:{current:{cancel(){effects.push('cancel')}}},loadGeneration:{current:0},boardObservation:{current:{id:1,generation:0}}};
  for(const key of ['Refs','Categories','Tasks','Selected','Composer','CategoryEditor','Status','Category','Query','BoardId','BoardEpoch','Loading'])deps[`set${key}`]=value=>effects.push([key,value]);
  const rendered={token:'original',usuario:{id:1,rol:'admin'}},old=deps.boardObservation.current;
  const scope=createCapturedRequest({session:rendered,readSession:()=>rendered,request:()=>assert.fail('no request'),isActive:()=>deps.boardObservation.current===old});
  const activate=callback('activateBoard',deps);
  effects.length=0;activate(2);assert.deepEqual(effects,[]);assert.equal(scope.current(),true);
  activate(2,true);assert.equal(deps.boardObservation.current.id,2);assert.equal(scope.current(),false);
  assert.throws(()=>scope.assertCurrent(),error=>error.code==='session_binding_obsolete');
  assert.ok(effects.some(([name,value])=>name==='Selected'&&value===null));
  const applyNode=nodes(file,n=>ts.isVariableDeclaration(n)&&n.name.getText(file)==='applyLocation')[0].initializer;
  assert.match(applyNode.getText(file),/activateBoard\(id,allowEscape\)/);
  assert.doesNotMatch(source,/heldURL|heldUrl|history\.(?:go|back|forward)\(/);
});
