import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createFeedbackScopedRequest,createFeedbackNotesReader,readFeedbackNotesLocation,feedbackNotesLocationUrl,feedbackNotesPageUrl,normalizeFeedbackNotesSelection,parseFeedbackNotesPage,parseFeedbackNote} from './feedbackNotesPagination.js';
import {createBrowserSessionState} from '../shared/session/browser-session-state.js';
import {createFeedbackNotesMutation} from './feedbackNotesMutation.js';
import {installUnsavedNavigation,registerNavigationGuard} from '../shared/navigation/unsaved.js';
import {navigateWithinApp} from '../shared/navigation/location.js';
const token='a'.repeat(64),other='b'.repeat(64);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}};
const note=(id=620,extra={})=>({id,titulo:'Feedback',contenido:'Texto',categoria:'general',feedback:{cliente:'Cliente',responsables:['Ana'],origen:'manual'},creado_por:'Autor',modificado_por:'Editor',eliminado_at:null,created_at:'2026-10-20T10:00:00.123456Z',updated_at:'2026-10-20T10:00:01.654321Z',resolved_client:'Cliente',section:'clients',...extra});
const selection=extra=>normalizeFeedbackNotesSelection({limit:2,...extra});
function page(s=selection(),extra={}){return{version:1,limit:s.limit,offset:s.offset,total:620,has_more:true,snapshot:token,context:{section:s.section,papelera:s.papelera,categoria:s.categoria,q:s.q},items:Array.from({length:s.limit},(_,i)=>note(620-s.offset-i)),...extra}}
function scopedFixture(transport,cookie=false){
  let epoch=0,active=true;
  const store=createBrowserSessionState();if(cookie)store.acceptBootstrap(store.beginBootstrap(),{usuario:{id:1,usuario:'qa',nombre:'QA',rol:'admin'},session_context:'a'.repeat(43),csrf_token:'b'.repeat(43)});
  let session=cookie?store.getSession():{token:'owner',usuario:{id:1,rol:'admin'}};const original=session,calls=[];
  const request=createFeedbackScopedRequest({session,readSession:()=>session,isActive:()=>active,readContext:()=>epoch,request:async(url,options)=>{calls.push({url,options});return transport(url,options)}});
  return{request,calls,original,context(){epoch++},switch(){session={token:'new',usuario:{id:2,rol:'community'}}},unmount(){active=false}};
}
test('shareable URL roundtrips context, snapshot, note and unrelated inventory/hash without credentials',()=>{
  const s=selection({section:'team',papelera:true,categoria:'reunion',q:'  Buscar á  ',offset:600,expected_snapshot:token});
  const href=feedbackNotesLocationUrl('https://render.test/feedback?inv_view=all#detalle',s,620);
  assert.match(href,/inv_view=all/);assert.match(href,/#detalle$/);assert.deepEqual(readFeedbackNotesLocation(new URL(href,'https://render.test').search),{...s,note:620});
  const first=feedbackNotesLocationUrl('https://render.test'+href,{...s,offset:0},null);assert.doesNotMatch(first,/expected_snapshot|note=/);
  assert.deepEqual(readFeedbackNotesLocation(''),{...normalizeFeedbackNotesSelection(),note:null});
});
for(const search of ['?section=clients&section=team','?q=a&q=b','?offset=2','?offset=-1','?offset=01','?offset=1000001','?limit=101','?limit=0','?note=0','?note=1&note=2','?mode=false','?categoria=other','?q=%00','?expected_snapshot=bad','?section=other'])test('invalid URL fails closed '+search,()=>assert.throws(()=>readFeedbackNotesLocation(search)));
test('query sends complete server classification/search and snapshot; defaults remain fifty, no legacy collection route',()=>{
  const s=selection({section:'team',papelera:true,q:'  TODO  ',categoria:'reunion',offset:600,expected_snapshot:token}),url=new URL(feedbackNotesPageUrl(s),'https://render.test');
  assert.equal(url.pathname,'/api/notas/pagina');assert.deepEqual(Object.fromEntries(url.searchParams),{limit:'2',offset:'600',section:'team',papelera:'true',categoria:'reunion',q:'TODO',expected_snapshot:token});
  assert.equal(new URL(feedbackNotesPageUrl({}),'https://render.test').searchParams.get('limit'),'50');
  assert.throws(()=>normalizeFeedbackNotesSelection({q:'x'.repeat(201)}));assert.throws(()=>normalizeFeedbackNotesSelection({papelera:'false'}));
});
test('page beyond 500 retains exact full collection total and canonical inferred client without client suggestions',()=>{
  const s=selection({offset:600,expected_snapshot:token});const value=page(s,{items:[note(20,{feedback:{},resolved_client:'Inferred server client'}),note(19)]});
  const result=parseFeedbackNotesPage(value,s);assert.equal(result.total,620);assert.equal(result.items.length,2);assert.equal(result.items[0].resolved_client,'Inferred server client');
  assert.equal(result.items[0].updated_at,'2026-10-20T10:00:01.654321Z');assert.notEqual(result.items[0],value.items[0]);
});
for(const patch of [{version:2},{offset:1},{limit:50},{total:'620'},{has_more:false},{snapshot:other},{context:{section:'team',papelera:false,categoria:null,q:''}},{items:[note()]},{items:[note(),note()]},{extra:true}])test('closed page/context/snapshot/count rejects '+JSON.stringify(patch),()=>{
  const s=selection({offset:2,expected_snapshot:token});assert.throws(()=>parseFeedbackNotesPage(page(s,patch),s));
});
for(const patch of [{extra:true},{section:'team'},{resolved_client:''},{eliminado_at:'2026-10-20T10:00:00Z'},{feedback:{wilson_idempotency_key:'private'}},{feedback:{responsables:[1]}},{feedback:{confirmado_por_id:'9'}},{updated_at:null}])test('detail projection fails closed '+JSON.stringify(patch),()=>assert.throws(()=>parseFeedbackNote(note(620,patch),false)));
test('detail by ID outside loaded pages uses one request and exact trash mode; wrong identity is rejected',async()=>{
  const calls=[],reader=createFeedbackNotesReader({request:async(url)=>{calls.push(url);return{version:1,item:note(620)}},onChange(){}});
  assert.equal((await reader.detail(620,false)).id,620);assert.deepEqual(calls,['/api/notas/620/detalle?papelera=false']);
  await assert.rejects(reader.detail(621,false));reader.dispose();await assert.rejects(reader.detail(620,false));
});
test('later page server 409 clears data and requires explicit restart, never mixing or automatic reread',async()=>{
  let count=0;const changes=[],reader=createFeedbackNotesReader({request:async()=>{if(++count===1)return page();throw Object.assign(Error('Changed'),{status:409})},onChange:value=>changes.push(value)});
  await reader.load(selection());await reader.load(selection({offset:2,expected_snapshot:token}));assert.equal(count,2);assert.equal(changes.at(-1).status,'stale');assert.equal(changes.at(-1).data,null);assert.equal(changes.at(-2).data,null);
});
test('new context wins over held old page including ignored AbortSignal; old detail cannot overwrite new selection',async()=>{
  const first=deferred(),detail=deferred(),changes=[];let count=0;
  const reader=createFeedbackNotesReader({request:async url=>url.includes('/detalle')?detail.promise:++count===1?first.promise:page(selection({q:'new'})),onChange:value=>changes.push(value)});
  const old=reader.load(selection()),oldDetail=reader.detail(620,false);await reader.load(selection({q:'new'}));first.resolve(page());detail.resolve({version:1,item:note()});
  await old;await assert.rejects(oldDetail);assert.equal(changes.at(-1).data.context.q,'new');assert.equal(changes.filter(value=>value.status==='ready').length,1);
});
test('explicit invalidation and disposal suppress pending successes and failures',async()=>{
  for(const reject of [false,true]){const gate=deferred(),changes=[],reader=createFeedbackNotesReader({request:()=>gate.promise,onChange:value=>changes.push(value)});const pending=reader.load(selection());reader.invalidate();reader.dispose();if(reject)gate.reject(Error('late'));else gate.resolve(page());await pending;assert.equal(changes.length,1);}
});
for(const cookie of [false,true])for(const change of ['switch','context','unmount'])test((cookie?'cookie':'bearer')+' '+change+' fences held read and captured chained write',async()=>{
  const gate=deferred(),f=scopedFixture(async()=>gate.promise,cookie),captured=f.request.capture();
  const pending=captured('/api/notas/similares');f[change]();gate.resolve({similares:[]});await assert.rejects(pending,{code:'session_binding_obsolete'});
  await assert.rejects(captured('/api/notas',{method:'POST'}),{code:'session_binding_obsolete'});assert.equal(f.calls.length,1);
  if(cookie)assert.equal(f.calls[0].options.sessionIntent.session,f.original);else assert.equal(f.calls[0].options.headers.Authorization,'Bearer owner');
});
const source=readFileSync(new URL('./Feedback.jsx',import.meta.url),'utf8'),file=ts.createSourceFile('Feedback.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
const nodes=(root,predicate)=>{const result=[];const visit=node=>{if(predicate(node))result.push(node);ts.forEachChild(node,visit)};visit(root);return result};
const component=file.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='FeedbackContent');
const evaluate=(node,deps)=>new Function(...Object.keys(deps),`return (${node.getText(file)});`)(...Object.values(deps));
const handler=(name,deps)=>evaluate(nodes(component,node=>ts.isFunctionDeclaration(node)&&node.name?.text===name)[0],deps);
test('canonical UI renders server items directly; no loaded-page classification, capped warning, or legacy GET',()=>{
  assert.equal(file.parseDiagnostics.length,0);assert.match(source,/const visible = notes;/);assert.doesNotMatch(source,/isClientFeedback|resolveFeedbackClient|normalizeFeedbackText|500 notas|request\(`\/api\/notas\?/);
  assert.match(source,/note\.resolved_client/);assert.match(source,/note\.section/);assert.match(source,/Páginas de notas/);assert.match(source,/key=\{view.key\}/);
});
test('actual active-section click is a no-op, preserving draft even before URL defaults are canonicalized',()=>{
  for(const section of ['clients','team']){
    const draft={titulo:'Unsaved',contenido:'Keep this draft'},before=structuredClone(draft),moves=[];
    const win={location:new URL('https://render.test/feedback'+(section==='team'?'?section=team':''))};
    const changeSection=handler('changeSection',{section,window:win,moveNotes:changes=>moves.push(changes)});
    changeSection(section);assert.deepEqual(moves,[]);assert.deepEqual(draft,before);
    assert.equal(win.location.search,section==='team'?'?section=team':'');
    changeSection(section==='clients'?'team':'clients');assert.deepEqual(moves,[{section:section==='clients'?'team':'clients',offset:0,expected_snapshot:null}]);
  }
});
test('actual restart invalidates before reload, resets first page and token, preserves created ID in URL for fresh detail',()=>{
  const effects=[],contextEpoch={current:4},panelEpoch={current:2},linkedNoteId={current:null};let next;
  const win={location:{href:'https://render.test/feedback?section=clients&offset=600&expected_snapshot='+token},history:{state:{fromTasks:'/workspace/tareas'},replaceState(_state,_title,url){effects.push(url)}}};
  handler('restartNotes',{contextEpoch,panelEpoch,readerRef:{current:{invalidate:()=>effects.push('invalidated')}},selection:selection({offset:600,expected_snapshot:token}),window:win,feedbackNotesLocationUrl,linkedNoteId,
    preparedPage:{current:null},setNotes:value=>effects.push(value),setPage(){},setLoading(){},setLocation:value=>{next=value}})(note());
  assert.equal(effects[0],'invalidated');assert.equal(contextEpoch.current,5);assert.equal(panelEpoch.current,3);assert.equal(next.selection.offset,0);assert.equal(next.selection.expected_snapshot,null);assert.equal(linkedNoteId.current,620);assert.match(effects[1],/note=620/);assert.doesNotMatch(effects[1],/expected_snapshot/);
});
test('actual duplicate jump outside page reads exact target version, preserving user text and provenance-free draft',async()=>{
  const gate=deferred(),calls=[],reader={detail:(...args)=>{calls.push(args);return gate.promise}},readerRef={current:reader},panelEpoch={current:2},lock={current:false};let draft={titulo:'My draft',contenido:'Keep',feedback:{cliente:'Mine'}};
  handler('updateDuplicate',{lock,mutationRef:{current:null},notes:[],readerRef,panelEpoch,setBusy(){},setError:assert.fail,setDraft:update=>{draft=update(draft)},setDuplicates(){},setMessage(){}})(620);
  assert.equal(lock.current,true);assert.deepEqual(calls,[[620,false]]);gate.resolve(note());await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert.equal(draft.id,620);assert.equal(draft.updated_at,note().updated_at);assert.equal(draft.titulo,'My draft');assert.equal(draft.feedback.cliente,'Mine');assert.equal(Object.hasOwn(draft,'origen'),false);
});
test('actual chained save cannot dispatch POST after context or account changes during similarity request',async()=>{
  for(const change of ['switch','context']){const gate=deferred(),f=scopedFixture(async()=>gate.promise),errors=[],draft={titulo:'Title',contenido:'Body',categoria:'general',feedback:{cliente:'Cliente',responsables:['Ana']}};
    const model=createFeedbackNotesMutation({capture:()=>({current:()=>true,assertCurrent(){},request:f.request.capture()}),refresh:()=>assert.fail('No read after obsolete preflight'),randomUUID:()=> '00000000-0000-4000-8000-000000000001'});
    const mutationRef={current:{active:true,scope:{current:()=>true},model}},lock={current:false};
    const runMutation=handler('runMutation',{mutationRef,lock,setBusy(){},setError:value=>errors.push(value),setDuplicates(){},setConflict(){},acceptMutation:()=>assert.fail('Obsolete preflight cannot publish ACK')});
    const save=handler('persistDraft',{draft,section:'clients',lock,mutationRef,conflict:false,runMutation,feedbackResponsibles:value=>value.feedback.responsables,feedbackBusinessInput:value=>({cliente:value.cliente,responsables:[...value.responsables]})});
    const pending=save();f[change]();gate.resolve({similares:[]});await pending;assert.equal(f.calls.length,1);assert.deepEqual(errors,['']);}
});
test('actual status controller input uses business projection and exact microsecond observation',async()=>{
  const feedback={cliente:'Cliente',responsables:['Ana'],estado:'pendiente'},original=note(620,{feedback:{...feedback,wilson_idempotency_key:'must-not-write'}}),calls=[];
  const project=value=>Object.fromEntries(Object.entries(value).filter(([key])=>['cliente','responsables','estado'].includes(key)));
  const model={snapshot:{locked:false},start:value=>calls.push(value)},deps={mutationRef:{current:{model}},runMutation:action=>action(model),lock:{current:false},feedbackBusinessInput:project};
  await handler('toggleStatus',deps)(original);assert.deepEqual(calls,[{action:'edit',note:{id:original.id,updated_at:original.updated_at},fields:{feedback:{...feedback,estado:'resuelto'}}}]);
});
test('navigation to a filtered page consults existing dirty/busy product guard and preserves canceled URL',()=>{
  const win=new EventTarget();win.location=new URL('https://render.test/feedback?section=clients');win.CustomEvent=class extends Event{constructor(type,options){super(type,options);this.detail=options.detail}};win.PopStateEvent=class extends Event{};win.scrollTo=()=>{};let accept=false,pushes=0,busy=false;
  win.confirm=()=>accept;win.history={pushState(){pushes++}};const installation=installUnsavedNavigation(win),off=registerNavigationGuard(win,()=>({dirty:true,busy}));
  try{const move=handler('moveNotes',{selection:selection(),window:win,feedbackNotesLocationUrl,navigateWithinApp,setError:assert.fail});move({section:'team',offset:0});assert.equal(pushes,0);accept=true;busy=true;move({section:'team',offset:0});assert.equal(pushes,0);busy=false;move({section:'team',offset:0});assert.equal(pushes,1);}finally{off();installation.dispose()}
});
