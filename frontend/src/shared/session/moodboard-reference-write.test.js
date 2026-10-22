import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createMoodboardReferenceWrite,moodboardReferenceWriteBody,parseMoodboardReference,parseMoodboardReferenceWrite} from './moodboard-reference-write.js';
import {createMoodboardReferenceOperation} from './moodboard-reference-operation.js';
import {createCapturedRequest} from './captured-request.js';
import {createBrowserSessionState} from './browser-session-state.js';
const uuid='00000000-0000-4000-8000-000000000001';
const row=(extra={})=>({id:9,board_id:7,category_id:1,titulo:'Reference',nota:'saved',etiquetas:[],estado:'libre',tipo_fuente:'enlace',enlace_externo:'https://example.test',archivo_nombre:null,autor_id:1,autor_nombre:'QA',created_at:'2026-10-22T10:00:00.000000Z',updated_at:'2026-10-22T10:00:00.001000Z',categoria:'General',tareas:[],revision:0,...extra});
const fields=()=>({title:'Reference',note:'saved',category_id:1,tags:['one'],external_url:'https://example.test',image_data:null});
const bundle=(references=[row()])=>({references,categories:[],tasks:[]});
const ack=(body,extra={})=>{const rev=body.action==='create'?0:body.action==='delete'?body.expected_revision:body.expected_revision+1;return{version:1,reference:body.action==='delete'?null:row({revision:rev}),operation:{request_id:body.request_id,action:body.action,reference_id:body.reference_id??9,result_revision:rev,replayed:false},...extra}};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}};
function fixture({transport,read,cookie=false}={}){
 let active=true,epoch=0,keys=0,reads=0;
 const store=createBrowserSessionState();if(cookie)store.acceptBootstrap(store.beginBootstrap(),{usuario:{id:1,usuario:'qa',nombre:'QA',rol:'diseno'},session_context:'a'.repeat(43),csrf_token:'b'.repeat(43)});
 let live=cookie?store.getSession():{token:'owner',usuario:{id:1,rol:'diseno'}},rendered=live;const calls=[];
 const capture=()=>{const selected=epoch;return createCapturedRequest({session:rendered,readSession:()=>live,isActive:()=>active&&epoch===selected,request:async(url,options)=>{calls.push({url,options});return transport?transport(url,options):ack(JSON.parse(options.body))}})};
 const refresh=async scope=>{reads++;scope.assertCurrent();return read?read():bundle([row({revision:20})])};
 const model=createMoodboardReferenceWrite({boardId:7,capture,refresh,randomUUID:()=>uuid.slice(0,-1)+String(++keys)});
 return{model,calls,capture,refresh,rendered,get reads(){return reads},switch(){live={token:'other',usuario:{id:2,rol:'admin'}}},aba(){epoch++;epoch++},unmount(){active=false}};
}
test('closed DTO preserves nullable historical title/category/author and clones ACL-filtered task projections',()=>{
 const value=row({titulo:null,category_id:null,categoria:null,autor_id:null,tareas:[{id:3,titulo:'Visible'}]});const parsed=parseMoodboardReference(value,7);
 assert.equal(parsed.titulo,null);assert.equal(parsed.revision,0);assert.notEqual(parsed.tareas,value.tareas);assert.ok(Object.isFrozen(parsed.tareas[0]));
});
for(const patch of [{board_id:8},{id:'9'},{revision:-1},{revision:'0'},{extra:true},{tareas:[{id:3,titulo:'Visible',finance:1}]},{tareas:[{id:3,titulo:'One'},{id:3,titulo:'Two'}]},{etiquetas:[{}]},{estado:'other'},{autor_id:0},{updated_at:'bad'}])test('DTO rejects '+JSON.stringify(patch),()=>assert.throws(()=>parseMoodboardReference(row(patch),7)));
for(const action of ['create','edit','delete'])test(action+' uses dedicated POST with exact observed revision and receipt identity',async()=>{
 const f=fixture();const result=await f.model.submit(action,row({revision:4}),action==='create'?fields():action==='edit'?{status:'aprobada'}:undefined);
 const body=JSON.parse(f.calls[0].options.body);assert.equal(f.calls[0].url,'/api/moodboards/reference-operations');assert.equal(body.board_id,7);assert.equal(body.request_id,uuid);assert.equal(body.action,action);
 if(action==='create')assert.equal(Object.hasOwn(body,'expected_revision'),false);else{assert.equal(body.reference_id,9);assert.equal(body.expected_revision,4)}
 assert.equal(result.ack.operation.result_revision,action==='create'?0:action==='delete'?4:5);
 await f.model.settle();assert.equal(f.calls.length,1);f.model.complete();assert.equal(f.model.snapshot.phase,'idle');
});
test('synchronous lock and captured immutable body survive local draft mutation',async()=>{
 const gate=deferred(),f=fixture({transport:()=>gate.promise}),value=fields(),pending=f.model.submit('create',null,value);value.tags.push('late');value.note='late';
 await assert.rejects(f.model.submit('create',null,fields()));const sent=JSON.parse(f.calls[0].options.body);assert.deepEqual(sent.fields.tags,['one']);assert.equal(sent.fields.note,'saved');gate.resolve(ack(sent));await pending;
});
for(const action of ['create','edit','delete'])test(action+' unknown receipt verifies same UUID/body, with current replay newer or absent',async()=>{
 let count=0;const f=fixture({transport:async(_url,options)=>{const body=JSON.parse(options.body);if(++count===1)throw Error('lost');const first=ack(body);return{...first,reference:action==='delete'?null:row({revision:30,estado:'descartada'}),operation:{...first.operation,replayed:true}}}});
 await assert.rejects(f.model.submit(action,row({revision:2}),action==='create'?fields():action==='edit'?{status:'aprobada'}:undefined));assert.equal(f.model.snapshot.phase,'uncertain');await assert.rejects(f.model.submit(action,row(),fields()));await assert.rejects(f.model.observe());assert.equal(f.calls.length,1);
 const result=await f.model.verify();assert.equal(f.calls[0].options.body,f.calls[1].options.body);if(action!=='delete')assert.equal(result.ack.reference.revision,30);assert.equal(f.model.snapshot.phase,'confirmed');
});
test('confirmed ACK and failed readback retry only GET/read; no repeated mutation',async()=>{
 let failRead=true;const f=fixture({read:()=>{if(failRead)throw Error('GET failed');return bundle()}});await f.model.submit('create',null,fields());await assert.rejects(f.model.settle());assert.equal(f.model.snapshot.phase,'refresh_failed');assert.equal(f.model.snapshot.accepted.reference.id,9);
 await f.model.verify();assert.equal(f.calls.length,1);failRead=false;await f.model.settle();assert.equal(f.calls.length,1);assert.equal(f.reads,2);
});
test('409 observes dedicated closed detail, never adopts its revision or resubmits',async()=>{
 const observed=row({revision:2}),f=fixture({transport:async(url,options)=>{if(options.method==='POST')throw Object.assign(Error('stale'),{status:409});assert.equal(url,'/api/moodboards/references/9/detail');return{version:1,reference:row({revision:12})}}});
 await assert.rejects(f.model.submit('edit',observed,{status:'aprobada'}));await assert.rejects(f.model.verify());await f.model.observe();assert.equal(f.model.snapshot.phase,'reviewed');assert.equal(f.model.snapshot.observed.revision,12);assert.equal(observed.revision,2);assert.equal(JSON.parse(f.calls[0].options.body).expected_revision,2);assert.equal(f.calls.length,2);
 f.model.releaseConflict();assert.equal(f.model.snapshot.phase,'idle');assert.equal(f.calls.length,2);
});
test('404 detail means currently unavailable, while malformed detail never releases conflict',async()=>{
 for(const invalid of [false,true]){const f=fixture({transport:async(_url,options)=>{if(options.method==='POST')throw Object.assign(Error('conflict'),{status:409});if(!invalid)throw Object.assign(Error('gone'),{status:404});return{version:1,reference:row({id:10})}}});
 await assert.rejects(f.model.submit('delete',row()));if(invalid){await assert.rejects(f.model.observe());assert.equal(f.model.snapshot.phase,'conflict');assert.throws(()=>f.model.releaseConflict())}else{await f.model.observe();assert.equal(f.model.snapshot.observed,null);f.model.releaseConflict()}}
});
for(const status of [400,413,422,428])test('known '+status+' rejects before commit, corrected explicit submission can create a new key',async()=>{
 let count=0;const f=fixture({transport:async(_url,options)=>{if(++count===1)throw Object.assign(Error('invalid'),{status});return ack(JSON.parse(options.body))}});
 await assert.rejects(f.model.submit('create',null,fields()));assert.equal(f.model.snapshot.locked,false);assert.equal(f.calls.length,1);await f.model.submit('create',null,fields());assert.notEqual(JSON.parse(f.calls[0].options.body).request_id,JSON.parse(f.calls[1].options.body).request_id);
});
for(const patch of [{reference:row({board_id:8})},{reference:row({id:10})},{operation:{request_id:uuid,action:'edit',reference_id:9,result_revision:0,replayed:false}},{operation:{request_id:uuid,action:'create',reference_id:9,result_revision:1,replayed:false}},{reference:null},{extra:true}])test('malformed ACK remains uncertain '+JSON.stringify(patch),async()=>{
 const f=fixture({transport:async(_url,options)=>ack(JSON.parse(options.body),patch)});await assert.rejects(f.model.submit('create',null,fields()));assert.equal(f.model.snapshot.phase,'uncertain');assert.equal(f.model.snapshot.accepted,null);
});
test('delete receipt carries last revision, never a fabricated deletion increment',()=>{
 const body=moodboardReferenceWriteBody(7,'delete',row({revision:4}),undefined,uuid);assert.equal(parseMoodboardReferenceWrite(ack(body),body).operation.result_revision,4);
 assert.throws(()=>parseMoodboardReferenceWrite(ack(body,{operation:{...ack(body).operation,result_revision:5}}),body));
});
for(const cookie of [false,true])for(const change of ['switch','aba','unmount'])test((cookie?'cookie':'bearer')+' '+change+' suppresses held ACK, refresh and same-intent retry',async()=>{
 const gate=deferred(),f=fixture({cookie,transport:()=>gate.promise}),pending=f.model.submit('create',null,fields());f[change]();gate.resolve(ack(JSON.parse(f.calls[0].options.body)));await assert.rejects(pending);assert.equal(f.model.snapshot.phase,'blocked');await assert.rejects(f.model.verify());assert.equal(f.calls.length,1);assert.equal(f.reads,0);
 if(cookie)assert.equal(f.calls[0].options.sessionIntent.session,f.rendered);else assert.equal(f.calls[0].options.headers.Authorization,'Bearer owner');
});
test('create replay after physical deletion never recreates or dispatches optional tasklink',async()=>{
 let count=0;const f=fixture({transport:async(_url,options)=>{const body=JSON.parse(options.body);if(++count===1)throw Error('lost');return ack(body,{reference:null,operation:{...ack(body).operation,replayed:true}})},read:()=>bundle([])});
 const model=createMoodboardReferenceOperation({boardId:7,taskId:3,capture:f.capture,refresh:f.refresh,randomUUID:()=>uuid});await assert.rejects(model.create(fields()));await assert.rejects(model.refresh());assert.throws(()=>model.finish());await model.verifyCreate();assert.equal(model.snapshot.gone,true);assert.equal(model.finish().referenceId,null);assert.equal(f.calls.length,2);assert.equal(f.calls[0].options.body,f.calls[1].options.body);assert.ok(f.calls.every(call=>call.url.endsWith('/reference-operations')));
});
test('create retry respects current ACL-filtered existing tasklink and does not POST it again',async()=>{
 let count=0;const linked=row({revision:6,tareas:[{id:3,titulo:'Task'}]}),f=fixture({transport:async(_url,options)=>{if(++count===1)throw Error('lost');const body=JSON.parse(options.body);return ack(body,{reference:linked,operation:{...ack(body).operation,replayed:true}})},read:()=>bundle([linked])});
 const model=createMoodboardReferenceOperation({boardId:7,taskId:3,capture:f.capture,refresh:f.refresh,randomUUID:()=>uuid});await assert.rejects(model.create(fields()));await model.verifyCreate();assert.equal(model.snapshot.observedLinked,true);assert.equal(model.snapshot.writeConfirmed,false);assert.equal(f.calls.length,2);
});
test('lost creation ACK followed by peer link/unlink: replay only observes missing link and never restores it',async()=>{
 let count=0,linked=false;const peer=[];
 const f=fixture({transport:async(_url,options)=>{if(++count===1)throw Error('Lost committed ACK');const body=JSON.parse(options.body);return ack(body,{reference:row({tareas:linked?[{id:3,titulo:'Task'}]:[]}),operation:{...ack(body).operation,replayed:true}})},read:()=>bundle([row({tareas:linked?[{id:3,titulo:'Task'}]:[]})])});
 const model=createMoodboardReferenceOperation({boardId:7,taskId:3,capture:f.capture,refresh:f.refresh,randomUUID:()=>uuid});await assert.rejects(model.create(fields()));
 linked=true;peer.push('POST');linked=false;peer.push('DELETE');await model.verifyCreate();
 assert.deepEqual(peer,['POST','DELETE']);assert.equal(model.snapshot.phase,'observed_missing');assert.equal(model.snapshot.observedLinked,false);assert.equal(model.snapshot.writeConfirmed,false);assert.equal(model.snapshot.canRetryLink,false);
 await assert.rejects(model.retryLink());assert.equal(f.calls.length,2);assert.ok(f.calls.every(call=>call.url.endsWith('/reference-operations')));assert.equal(f.calls[0].options.body,f.calls[1].options.body);assert.equal(linked,false);
});
const source=readFileSync(new URL('../../pages/MoodboardPreview.jsx',import.meta.url),'utf8'),file=ts.createSourceFile('MoodboardPreview.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
const nodes=(root,predicate)=>{const result=[];const visit=node=>{if(predicate(node))result.push(node);ts.forEachChild(node,visit)};visit(root);return result};
const fn=name=>file.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);
const evaluate=(node,deps)=>new Function(...Object.keys(deps),`return (${node.getText(file)});`)(...Object.values(deps));
const callback=(owner,name,deps)=>evaluate(nodes(fn(owner),node=>ts.isVariableDeclaration(node)&&node.name.getText(file)===name)[0].initializer,deps);
test('actual recovery copy is neutral while creating/writing; unknown-outcome warnings appear only after uncertainty',()=>{
 const expression=owner=>nodes(fn(owner),node=>ts.isJsxExpression(node)&&node.expression?.getText(file).includes('Guardando referencia…')&&ts.isConditionalExpression(node.expression))[0].expression;
 const composer=expression('Composer'),panel=expression('ReferencePanel');
 assert.equal(evaluate(composer,{state:{phase:'creating',busy:true,createdId:null}}),'Guardando referencia…');
 assert.equal(evaluate(panel,{writeState:{phase:'writing',busy:true,accepted:null}}),'Guardando referencia…');
 assert.match(evaluate(composer,{state:{phase:'creation_uncertain',createdId:null}}),/No pudimos confirmar/);
 assert.match(evaluate(panel,{writeState:{phase:'uncertain',accepted:null}}),/No sabemos/);
 for(const phase of ['creation_conflict','creation_reviewed','blocked'])assert.doesNotMatch(evaluate(composer,{state:{phase,createdId:null}}),/No pudimos confirmar|No sabemos/);
});
test('actual AuthImage held blob after cleanup allocates no URL; StrictMode setup owns/revokes only live URL',async()=>{
 const effectNode=nodes(fn('AuthImage'),node=>ts.isCallExpression(node)&&node.expression.getText(file)==='useEffect')[0];
 const first=deferred(),second=deferred(),reads=[],created=[],revoked=[],sources=[];
 const effect=evaluate(effectNode.arguments[0],{item:{archivo_nombre:'fixture.png',enlace_externo:null},setSrc:value=>sources.push(value),
   fetch:async()=>{const blob=reads.length===0?first:second;reads.push(blob);return{ok:true,blob:()=>blob.promise}},
   URL:{createObjectURL:blob=>{created.push(blob);return 'blob:live'},revokeObjectURL:url=>revoked.push(url)},encodeURIComponent});
 const cleanupOld=effect();cleanupOld();const cleanupLive=effect();
 first.resolve({kind:'old'});await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(created,[]);assert.deepEqual(sources,[]);assert.deepEqual(revoked,[]);
 second.resolve({kind:'live'});await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(created,[{kind:'live'}]);assert.deepEqual(sources,['blob:live']);assert.deepEqual(revoked,[]);
 cleanupLive();assert.deepEqual(revoked,['blob:live']);assert.equal(reads.length,2);
});
test('fresh layout setup cancels only old instance; strict effect replay never retains disposed model',()=>{
 const holder={current:null},models=[],signals=[];
 const initial={current:{capture:active=>({current:active,assertCurrent(){}}),factory:()=>{const model={cancel(){this.disposed=true}};models.push(model);return model},onBusy:(...args)=>signals.push(args)}};
 const layout=nodes(fn('useMoodboardReferenceOperation'),node=>ts.isCallExpression(node)&&node.expression.getText(file)==='useLayoutEffect')[0];
 const effect=evaluate(layout.arguments[0],{holder,initial,setError(){},paint(){}});const old=effect(),oldEntry=holder.current;old();const current=effect();assert.equal(models[0].disposed,true);assert.equal(models[1].disposed,undefined);assert.equal(oldEntry.scope.current(),false);assert.equal(holder.current.scope.current(),true);current();assert.equal(models[1].disposed,true);
});
test('actual hook catches write failure with synchronous owner, old finally cannot clear replacement owner',async()=>{
 const gate=deferred(),events=[],entry={active:true,pending:false,owner:Symbol('old'),scope:{current:()=>true,assertCurrent(){}},model:{snapshot:{phase:'uncertain'}}},holder={current:entry};
 const run=callback('useMoodboardReferenceOperation','run',{holder,initial:{current:{onBusy:(...args)=>events.push(args)}},setError(){},paint(){}});const pending=run(()=>gate.promise);await run(()=>assert.fail('Double submit'));assert.equal(events[0][1],true);
 entry.active=false;entry.scope.current=()=>false;const newer={owner:Symbol('new')};holder.current=newer;gate.resolve({});await pending;assert.ok(events.every(event=>event[0]===entry.owner));assert.notEqual(events.at(-1)[0],newer.owner);
});
test('actual panel edit/delete capture observed row; mutation and tasklink gates cannot race',async()=>{
 const item=row({revision:8}),calls=[];let pending;
 const own={submit:(...args)=>calls.push(args),settle:()=>({})},write={busy:false,snapshot:{locked:false},run:action=>{pending=Promise.resolve(action(own))}},model={snapshot:{busy:false,locked:false}};
 callback('ReferencePanel','changeStatus',{write,model,item,written(){}})('aprobada');await pending;assert.deepEqual(calls[0],['edit',item,{status:'aprobada'}]);
 callback('ReferencePanel','deleteReference',{write,model,item,written(){},confirm:()=>true})();await pending;assert.deepEqual(calls[1],['delete',item]);
 model.snapshot.locked=true;callback('ReferencePanel','changeStatus',{write,model,item,written(){}})('libre');assert.equal(calls.length,2);
});
test('actual composer canceled discard retains dirty draft, pending create cannot close as successful',()=>{
 const win=new EventTarget();win.location={href:'https://render.test/moodboards?board=7'};const Custom=class extends Event{constructor(type,options){super(type,options);this.detail=options.detail}};
 const actions=[],model={snapshot:{phase:'idle'}},leave=callback('Composer','leave',{operation:{busy:false},getModel:()=>model,captureCurrent:()=>({current:()=>true}),window:win,CustomEvent:Custom,close:()=>actions.push('close'),setError:()=>actions.push('blocked')});
 const stop=event=>event.preventDefault();win.addEventListener('render:before-navigation',stop);leave();assert.deepEqual(actions,[]);win.removeEventListener('render:before-navigation',stop);leave();assert.deepEqual(actions,['close']);model.snapshot.phase='creation_uncertain';leave();assert.deepEqual(actions,['close','blocked']);
});
test('source no longer writes through legacy update/delete callbacks and retains category editor unchanged',()=>{
 assert.equal(file.parseDiagnostics.length,0);assert.doesNotMatch(source,/const update=async|const remove=async|method:"PATCH"/);assert.match(source,/Verificar el mismo intento/);assert.match(source,/preserveSelection:true/);assert.match(source,/createMoodboardCategoryOperation/);assert.match(source,/Referencia sin título/);
});
