import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createCapturedRequest} from '../../shared/session/captured-request.js';
import {createBrowserSessionState} from '../../shared/session/browser-session-state.js';
import {driveRequest,uploadFileToDrive} from './drive-api.js';
import {createUploadRecovery} from './upload-recovery.js';

const response=(body,status=body?.token?201:200)=>new Response(JSON.stringify(body?.token?{name:'synthetic.mp4',...body}:body),{status});
const file=(name='synthetic.mp4',size=2)=>Object.assign(new Blob([new Uint8Array(size)],{type:'video/mp4'}),{name});
const fileAck=(id,name='synthetic.mp4',size=2)=>({id,name,size,mimeType:'video/mp4',webViewLink:`https://drive.google.com/file/d/${id}/view`});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
function actor(){const store=createBrowserSessionState();const accept=id=>{const ticket=store.beginBootstrap();store.acceptBootstrap(ticket,{usuario:{id,nombre:'Synthetic',usuario:'qa',rol:'community'},session_context:'a'.repeat(43),csrf_token:'b'.repeat(43)});};accept(1);return{session:store.getSession(),readSession:store.getSession,replace:()=>accept(2)};}

for(const kind of ['DRIVE_UPLOAD_UNCERTAIN','DRIVE_REPLACEMENT_UNCERTAIN','http500','network','body'])test(`${kind} stops after one PUT, no callback/progress or blind recovery POST`,async()=>{
 const a=actor(),calls=[],progress=[],confirmed=[];let busy=true;
 const request=async(url,options)=>{calls.push({url,options});if(options.method==='POST')return response({token:'opaque-upload'});if(kind==='network')throw new TypeError('uncertain connection');if(kind==='body')return{status:200,ok:true,json:async()=>{throw new SyntaxError('malformed')}};return response({error:'Revisar estado',code:kind.startsWith('DRIVE_')?kind:'DRIVE_UPLOAD_UNCERTAIN',retryable:false},kind==='http500'?500:409)};
 const scope=createCapturedRequest({...a,request,isActive:()=>busy});
 const model=createUploadRecovery({capture:()=>scope,upload:(f,options)=>uploadFileToDrive(f,{...options,...a,request}),onConfirmed:value=>confirmed.push(value)}),selected=[{file:file()}];
 await assert.rejects(model.run(selected,{parentId:'original-folder',taskId:42},value=>progress.push(value)),error=>error.retryable===false);
 assert.equal(calls.length,2);assert.equal(calls[1].options.method,'PUT');assert.equal(model.snapshot.blocked,true);assert.deepEqual(confirmed,[]);assert.deepEqual(progress,[]);
 await assert.rejects(model.run(selected,{parentId:'other-folder',taskId:99}));assert.equal(calls.length,2);assert.equal(JSON.parse(calls[0].options.body).taskId,42);assert.equal(JSON.parse(calls[0].options.body).parentId,'original-folder');
 const intent=calls[0].options.sessionIntent;assert.ok(intent);assert.ok(calls.every(call=>call.options.sessionIntent===intent));
 await model.refresh(async original=>{original.assertCurrent();return[]});assert.equal(model.snapshot.blocked,true,'Read absence/title never proves no commit or authorizes re-POST');assert.equal(calls.length,2);busy=false;await assert.rejects(model.refresh(async()=>[]));
});
test('typed error projection keeps only bounded code/retryable and duplicate compatibility, no raw private bag',async()=>{
 await assert.rejects(driveRequest('/synthetic',{},async()=>response({error:'Safe',code:'DRIVE_UPLOAD_UNCERTAIN',retryable:false,private_secret:'never attach'},409)),error=>{assert.equal(error.status,409);assert.equal(error.code,'DRIVE_UPLOAD_UNCERTAIN');assert.equal(error.retryable,false);assert.equal(JSON.stringify(error).includes('private_secret'),false);return true});
});
test('bad202 range, final202 and malformed200 ACK never advance to another chunk or report completion',async()=>{
 for(const mode of ['wrong-range','final202','malformed200']){const a=actor(),calls=[],progress=[];
 await assert.rejects(uploadFileToDrive(file('synthetic',mode==='final202'?1:8*1024*1024+1),{...a,parentId:'folder',onProgress:value=>progress.push(value),request:async(url,options)=>{calls.push(options);if(options.method==='POST')return response({token:'opaque'});return mode==='malformed200'?response({}):response({received:'bytes=0-0'},202)}}));assert.equal(calls.length,2);assert.deepEqual(progress,[]);
 }
});
test('confirmed first file is published immediately; uncertain second blocks batch without repeating either entry',async()=>{
 const a=actor(),calls=[],observations=[];const scope=createCapturedRequest({...a,request:()=>{}});let count=0;
 const model=createUploadRecovery({capture:()=>scope,upload:async f=>{calls.push(f);if(++count===2){assert.equal(observations[0].id,'one');throw Object.assign(new Error('uncertain'),{retryable:false,status:409,code:'DRIVE_UPLOAD_UNCERTAIN'})}return fileAck('one','one')},onConfirmed:(value,all)=>observations.push(...all)});
 const selected=[{file:file('one')},{file:file('two')}];await assert.rejects(model.run(selected,{parentId:'original'}));assert.equal(model.snapshot.confirmed[0].id,'one');assert.equal(model.snapshot.entries[1].phase,'uncertain');await assert.rejects(model.run(selected,{parentId:'new'}));assert.equal(calls.length,2);
});
test('safe initial duplicate rejection permits explicit keep under original actor/task/folder, never redirects',async()=>{
 const a=actor(),calls=[];let rejected=true;const scope=createCapturedRequest({...a,request:()=>{}});
 const model=createUploadRecovery({capture:()=>scope,upload:async(_file,options)=>{calls.push(options);if(rejected)throw Object.assign(new Error('duplicate'),{status:409,uploadStage:'init',retryable:false,code:'DRIVE_DUPLICATE_REJECTED'});return fileAck('saved')}});
 const selected=[{file:file()}];await assert.rejects(model.run(selected,{parentId:'original',taskId:42}));assert.equal(model.snapshot.blocked,false);rejected=false;await model.run(selected,{parentId:'retarget',taskId:99,duplicateAction:'keep'});assert.equal(calls[1].parentId,'original');assert.equal(calls[1].taskId,42);assert.equal(calls[1].duplicateAction,'keep');
});

for(const change of [value=>({id:value.id}),value=>({...value,name:'another.mp4'}),value=>({...value,mimeType:'image/png'}),value=>({...value,size:3}),value=>({...value,size:'2'}),value=>({...value,webViewLink:'javascript:alert(1)'}),value=>({...value,webViewLink:'https://drive.google.com.evil.test/file/d/saved/view'}),value=>({...value,webViewLink:'https://drive.google.com/file/d/other/view'}),value=>({...value,webViewLink:value.webViewLink+'?redirect=1'}),value=>({...value,webViewLink:'https://user@drive.google.com/file/d/saved/view'})])test(`invalid final DTO ${JSON.stringify(change(fileAck('saved')))} is uncertain, no progress100/result or resubmission`,async()=>{
 const a=actor(),progress=[],confirmed=[],calls=[];const scope=createCapturedRequest({...a,request:()=>{}});
 const model=createUploadRecovery({capture:()=>scope,onConfirmed:value=>confirmed.push(value),upload:(f,options)=>uploadFileToDrive(f,{...options,...a,request:async(url,settings)=>{calls.push(settings);return settings.method==='POST'?response({token:'opaque',name:f.name}):response(change(fileAck('saved')))}})});
 const selected=[{file:file()}];await assert.rejects(model.run(selected,{},value=>progress.push(value)));
 assert.deepEqual(progress,[]);assert.deepEqual(confirmed,[]);assert.deepEqual(model.snapshot.confirmed,[]);assert.equal(model.snapshot.blocked,true);
 await assert.rejects(model.run(selected,{}));assert.equal(calls.length,2);
});

test('real typed preexternal duplicate409 retryablefalse permits only explicit keep and honors confirmed renamed init name',async()=>{
 const a=actor(),calls=[],scope=createCapturedRequest({...a,request:()=>{}});let duplicate=true;
 const model=createUploadRecovery({capture:()=>scope,upload:(f,options)=>uploadFileToDrive(f,{...options,...a,request:async(url,settings)=>{
  calls.push(settings);if(settings.method==='POST'){if(duplicate)return response({error:'Duplicado',code:'DRIVE_DUPLICATE_REJECTED',retryable:false,duplicate:{id:'existing',name:f.name}},409);return response({token:'opaque',name:'synthetic (copia).mp4'});}
  return response(fileAck('saved','synthetic (copia).mp4'));
 }})});
 const selected=[{file:file()}];await assert.rejects(model.run(selected,{parentId:'original',taskId:42}),error=>error.code==='DRIVE_DUPLICATE_REJECTED'&&error.retryable===false);
 assert.equal(calls.length,1);assert.equal(model.snapshot.blocked,false);duplicate=false;
 await model.run(selected,{parentId:'other',taskId:99,duplicateAction:'keep'});
 assert.equal(calls.length,3);const body=JSON.parse(calls[1].body);assert.equal(body.duplicateAction,'keep');assert.equal(body.parentId,'original');assert.equal(body.taskId,42);assert.equal(model.snapshot.confirmed[0].name,'synthetic (copia).mp4');
});

const composerSource=readFileSync(new URL('../../components/PublicationComposer.jsx',import.meta.url),'utf8');
const uploaderSource=readFileSync(new URL('./DriveUploader.jsx',import.meta.url),'utf8');
function callback(source,name,deps){const ast=ts.createSourceFile('Source.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);let found;function walk(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)===name)found=node.initializer;ts.forEachChild(node,walk)}walk(ast);assert.ok(found,name);return Function(...Object.keys(deps),`return (${found.getText(ast)})`)(...Object.values(deps));}
function composer(){const a=actor(),calls=[],effects=[],entries=[{id:'one',file:file('one')},{id:'two',file:file('two')}],controller=new AbortController();let raw=async(_url,options)=>options.method==='POST'?response({token:'opaque'}):response({id:'file',webViewLink:'https://drive.google.com/file'});
 const scope=createCapturedRequest({...a,signal:controller.signal,request:async(url,options)=>{calls.push({url,options});return raw(url,options)}}),guard={...scope,signal:controller.signal,release(){},cancel(){controller.abort()}};
 const state={assets:[],draft:{material:''}},deps={uploads:entries,uploadingMaterial:false,pending:{current:false},uploadRecoveryModel:{current:null},uploadAttemptGuard:{current:null},uploadDestination:{current:null},captureRequest:()=>guard,fetch:()=>{},session:a.session,getSesion:a.readSession,draftsGeneration:{current:0},draftEdited:{current:false},createUploadRecovery,uploadFileToDrive,
 publicationUploadPlan:async options=>{const r=await guard.request('/api/drive/publication-upload-plan',options);return r.json()},setUploadingMaterial:value=>effects.push(['busy',value]),setFileError:value=>effects.push(['error',value]),setDriveReconnectRequired:()=>{},setNotice:value=>effects.push(['notice',value]),setUploadProgress:value=>effects.push(['progress',value]),setUploadRecovery:value=>effects.push(['recovery',value]),setUploadedAssets:value=>{state.assets=value;effects.push(['assets',value])},setDraft:update=>{state.draft=update(state.draft);effects.push(['draft',state.draft])}};
 return{a,calls,effects,state,deps,raw:fn=>{raw=fn},run:callback(composerSource,'uploadMaterial',deps)};
}
test('actual Composer callback preserves first ACK before second error and second click sends no new POST',async()=>{
 const h=composer();let posts=0,puts=0;
 h.raw(async(url,options)=>{if(url.includes('publication-upload-plan'))return response({status:'resolved',folder:{id:'original-folder'}});if(options.method==='POST'){posts++;return response({token:`opaque-${posts}`,name:JSON.parse(options.body).name})}puts++;if(puts===1)return response(fileAck('first','one'));assert.equal(h.state.assets[0].id,'first');return response({error:'Revisión necesaria',code:'DRIVE_UPLOAD_UNCERTAIN',retryable:false},409)});
 await h.run();assert.equal(h.state.assets.length,1);assert.equal(h.state.draft.material,'https://drive.google.com/file/d/first/view');assert.equal(h.deps.uploadRecoveryModel.current.snapshot.blocked,true);const count=h.calls.length;await h.run();assert.equal(h.calls.length,count);assert.equal(posts,2);assert.equal(puts,2);
});
test('actual Composer pinned actor rejects late PUT and never begins second file under B',async()=>{
 const h=composer(),d=deferred();h.raw(async(url,options)=>url.includes('publication-upload-plan')?response({status:'resolved',folder:{id:'folder'}}):options.method==='POST'?response({token:'opaque',name:JSON.parse(options.body).name}):d.promise);
 const pending=h.run();for(let n=0;n<40;n++)await Promise.resolve();assert.equal(h.calls.length,3);const count=h.effects.length;h.a.replace();d.resolve(response({id:'old',webViewLink:'https://drive.google.com/old'}));await pending;assert.equal(h.calls.length,3);assert.equal(h.effects.length,count);assert.deepEqual(h.state.assets,[]);
});
for(const failedRead of ['throw','false'])test(`actual uploader confirmed ACK plus onUploaded ${failedRead} offers GET-only callback recovery, no second upload`,async()=>{
 const a=actor(),calls=[],effects=[],inputRef={current:{value:'file'}},recovery={current:null},uploadScope={current:null},operation={current:null},pending={current:false};let reads=0;
 const deps={file:file(),destination:{folder:{id:'folder'}},task:{id:42},uploading:false,pending,isActive:()=>true,recovery,uploadScope,operation,generation:{current:0},session:a.session,getSesion:a.readSession,createCapturedRequest,createUploadRecovery,inputRef,
 uploadFileToDrive:(f,options)=>uploadFileToDrive(f,{...options,request:async(url,settings)=>{calls.push({url,settings});return settings.method==='POST'?response({token:'opaque',name:f.name}):response(fileAck('saved',f.name,f.size))}}),
 onUploaded:async(_file,scope)=>{scope.assertCurrent();reads++;if(reads===1){if(failedRead==='false')return false;throw new Error('read failed')}},setUploading:v=>effects.push(['busy',v]),setError:v=>effects.push(['error',v]),setDuplicate:()=>{},setProgress:()=>{},setRecoveryState:()=>{},setRefreshFailed:v=>effects.push(['refresh',v]),setFile:v=>effects.push(['file',v])};
 await callback(uploaderSource,'upload',deps)();assert.equal(calls.length,2);assert.equal(reads,1);assert.ok(effects.some(([kind,value])=>kind==='refresh'&&value===true));assert.ok(effects.some(([kind,value])=>kind==='file'&&value===null));
 await callback(uploaderSource,'retryRefresh',{...deps,refreshFailed:true})();assert.equal(calls.length,2);assert.equal(reads,2);assert.ok(effects.some(([kind,value])=>kind==='refresh'&&value===false));
});
test('uncertain entries cannot be cleared/reselected by UI callbacks; source uses existing classes and no business storage',()=>{
 const blocked={current:{snapshot:{blocked:true}}};callback(composerSource,'clearUploads',{pending:{current:false},uploadRecoveryModel:blocked})();callback(composerSource,'chooseFiles',{pending:{current:false},uploadRecoveryModel:blocked})([]);callback(composerSource,'selectPublication',{pending:{current:false},uploadRecoveryModel:blocked})(99);
 for(const source of [composerSource,uploaderSource]){assert.equal(ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.React},reportDiagnostics:true}).diagnostics.length,0);assert.doesNotMatch(source,/localStorage|sessionStorage/);assert.match(source,/Revisar Drive|Revisá Drive|revisión manual/);}
});
