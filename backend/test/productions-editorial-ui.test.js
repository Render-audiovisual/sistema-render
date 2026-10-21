import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../frontend/src/pages/Productions.jsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../../frontend/src/pages/Productions.css',import.meta.url),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const positiveId=value=>Number.isSafeInteger(value)&&value>0;
const build=new Function('positiveId',`${section('function buildProductionEditorialInput','function EditorialLinkSummary')}return buildProductionEditorialInput;`)(positiveId);
const visit={id:'11111111-1111-4111-8111-111111111111',fecha:'2026-10-19',revision:7,cliente_id:3};
const video={id:'22222222-2222-4222-8222-222222222222',titulo:'Video',guion:'Not editorial copy'};
const piece={publicacion_id:101,titulo:'Reel',fecha_programada:'2026-10-27',publicacion_updated_at:'2026-10-19T13:00:00.123456Z',tarea_id:201,tarea_revision:8};
const slot={objetivo_pieza_id:301,titulo:'Reel 2',numero:2,periodo:'2026-10',objetivo_updated_at:'2026-10-19T12:00:00.654321Z',tarea_id:202,tarea_revision:9};
const catalog={actual:null,publicaciones:[piece],casilleros:[slot]};

test('existing publication payload reuses exactly the canonical task and all original version precision',()=>{
  const input=build({revision:7,kind:'piece',candidate:piece});
  assert.deepEqual(input,{path:'vincular-pieza',data:{expected_revision:7,tarea_id:201,expected_tarea_revision:8,publicacion_id:101,expected_publicacion_updated_at:piece.publicacion_updated_at}});
  for(const key of ['fecha_programada','editor_id','fecha_entrega','guion','copy','estado']) assert.equal(Object.hasOwn(input.data,key),false);
});
test('publication with a goal cannot silently omit acknowledgement or its version',()=>{
  const candidate={...piece,objetivo_pieza_id:301,objetivo_updated_at:slot.objetivo_updated_at};
  assert.throws(()=>build({revision:7,kind:'piece',candidate}),/Confirmá/);
  assert.throws(()=>build({revision:7,kind:'piece',candidate:{...candidate,objetivo_updated_at:null},acknowledged:true}),/Confirmá/);
  const input=build({revision:7,kind:'piece',candidate,acknowledged:true});
  assert.equal(input.data.objetivo_pieza_id,301);assert.equal(input.data.expected_objetivo_updated_at,slot.objetivo_updated_at);
});
test('empty objective slot payload requires explicit valid programming date, not handoff date or script/copy',()=>{
  for(const plannedDate of [undefined,'','2026-02-30','2026-10-99']) assert.throws(()=>build({revision:7,kind:'goal',candidate:slot,plannedDate}),/manualmente/);
  assert.deepEqual(build({revision:7,kind:'goal',candidate:slot,plannedDate:'2026-10-28'}),{path:'vincular-objetivo',data:{expected_revision:7,tarea_id:202,expected_tarea_revision:9,objetivo_pieza_id:301,expected_objetivo_updated_at:slot.objetivo_updated_at,fecha_programada:'2026-10-28'}});
});
test('missing or coercible IDs/revisions fail before any association request',()=>{
  for(const revision of [undefined,null,'7',0,-1,1.5]) assert.throws(()=>build({revision,kind:'piece',candidate:piece}),/Actualizá/);
  for(const candidate of [null,{...piece,tarea_id:'201'},{...piece,tarea_revision:0},{...piece,publicacion_updated_at:''}]) assert.throws(()=>build({revision:7,kind:'piece',candidate}));
  assert.throws(()=>build({revision:7,kind:'goal',candidate:{...slot,objetivo_updated_at:null},plannedDate:'2026-10-28'}),/casillero/);
});

// Execute actual component handlers/effects with deterministic hooks, not a browser or DB.
function association({read=async()=>catalog,write=async()=>({}),initialVisit=visit,initialVideo=video}={}) {
  const state=[],refs=[],effects=[];let pending=[],cursor=0,refCursor=0,effectCursor=0;
  let props={visit:initialVisit,video:initialVideo,busy:false};
  const reads=[],writes=[],dirty=[];
  const component=section('function EditorialAssociation','  return <details className="prod-editorial-association"');
  const inner=component.slice(component.indexOf(') {')+3);
  const evaluate=new Function('visit','video','busy','onWrite','onDirty','useState','useRef','useEffect','apiRequest','positiveId','buildProductionEditorialInput',`${inner}\nreturn {submit,setOpen,setPeriod,setKind,setChoice,setPlannedDate,setAcknowledged,setRefreshKey,open,period,kind,choice,plannedDate,acknowledged,catalog,catalogReady,needsRefresh,error,saved,alreadyLinked,candidate};`);
  const render=(next={})=>{
    props={...props,...next};cursor=0;refCursor=0;effectCursor=0;
    return evaluate(props.visit,props.video,props.busy,async(...args)=>{writes.push(args);return write(...args);},(...args)=>dirty.push(args),
      initial=>{const index=cursor++;if(!(index in state))state[index]=typeof initial==='function'?initial():initial;return [state[index],value=>{state[index]=typeof value==='function'?value(state[index]):value;}];},
      initial=>{const index=refCursor++;return refs[index] ||= {current:initial};},
      (fn,deps)=>{const index=effectCursor++;if(!effects[index] || deps.some((value,i)=>value!==effects[index].deps[i])){effects[index]?.cleanup?.();effects[index]={deps};pending.push(()=>{effects[index].cleanup=fn();});}},
      async(...args)=>{reads.push(args);return read(...args);},positiveId,build);
  };
  const flush=async()=>{const work=pending;pending=[];work.forEach(fn=>fn());await new Promise(resolve=>setImmediate(resolve));};
  const load=async()=>{render().setOpen(true);render();await flush();return render();};
  const cleanup=()=>effects.forEach(effect=>effect.cleanup?.());
  return {render,load,flush,reads,writes,dirty,cleanup};
}
const event={preventDefault(){}};
test('candidate reads are lazy, scoped by UUID/month, and never auto-select a publication or programming date',async()=>{
  const h=association();h.render();await h.flush();assert.equal(h.reads.length,0);
  const view=await h.load();
  assert.equal(h.reads.length,1);
  assert.equal(h.reads[0][0],`/api/producciones/${visit.id}/videos/${video.id}/vinculo?periodo=2026-10`);
  assert.equal(view.choice,'');assert.equal(view.plannedDate,'');assert.equal(view.catalog.revision,7);
  h.cleanup();assert.equal(h.reads[0][1].signal.aborted,true);
});
test('publication association sends canonical task and loaded visit snapshot, not a later hidden revision',async()=>{
  const h=association();const view=await h.load();view.setChoice('101');
  const latest=h.render({visit:{...visit,revision:10}});await latest.submit(event);
  assert.equal(h.reads.length,1,'visit change must not silently rebase candidate versions');
  assert.equal(h.writes.length,1);
  assert.equal(h.writes[0][0].revision,7);
  assert.equal(h.writes[0][1],`/videos/${video.id}/vincular-pieza`);
  assert.equal(h.writes[0][3].expected_tarea_revision,8);
  assert.deepEqual(h.dirty,[[`editorial:${video.id}`,false]]);
});
test('409 retains kind, selection and manual date; explicit refresh is required before a second intent',async()=>{
  const h=association({write:async()=>{throw Object.assign(new Error('conflict'),{status:409});}});
  const initial=await h.load();initial.setKind('goal');initial.setChoice('301');initial.setPlannedDate('2026-10-28');
  await h.render().submit(event);
  const failed=h.render();
  assert.equal(failed.kind,'goal');assert.equal(failed.choice,'301');assert.equal(failed.plannedDate,'2026-10-28');
  assert.equal(failed.needsRefresh,true);assert.equal(failed.catalogReady,false);assert.equal(h.writes.length,1);
  await failed.submit(event);assert.equal(h.writes.length,1,'not even an explicit submit may reuse invalidated versions');
  failed.setRefreshKey(value=>value+1);h.render({visit:{...visit,revision:8}});await h.flush();
  const refreshed=h.render();assert.equal(refreshed.catalog.revision,8);assert.equal(refreshed.choice,'301');assert.equal(refreshed.plannedDate,'2026-10-28');
  assert.equal(refreshed.catalogReady,true);assert.equal(h.writes.length,1,'candidate refresh never writes');
});
test('read failures preserve choices/date and cannot submit stale candidates',async()=>{
  let fail=false;const h=association({read:async()=>{if(fail)throw Error('offline');return catalog;}});
  const initial=await h.load();initial.setKind('goal');initial.setChoice('301');initial.setPlannedDate('2026-10-28');
  fail=true;initial.setRefreshKey(value=>value+1);h.render();await h.flush();
  const failed=h.render();assert.equal(failed.catalog.status,'error');assert.equal(failed.choice,'301');assert.equal(failed.plannedDate,'2026-10-28');
  await failed.submit(event);assert.equal(h.writes.length,0);
});
test('actual slot submission sends only manual programming date and existing canonical task/slot versions',async()=>{
  const h=association();const initial=await h.load();initial.setKind('goal');initial.setChoice('301');initial.setPlannedDate('2026-10-28');
  await h.render().submit(event);
  assert.equal(h.writes.length,1);
  assert.equal(h.writes[0][1],`/videos/${video.id}/vincular-objetivo`);
  assert.deepEqual(h.writes[0][3],build({revision:7,kind:'goal',candidate:slot,plannedDate:'2026-10-28'}).data);
  assert.equal(h.render().saved,true);
});
test('candidate removed by deliberate refresh keeps former choice visible but cannot submit another task',async()=>{
  let removed=false;const h=association({read:async()=>removed?{...catalog,publicaciones:[]}:catalog});
  const initial=await h.load();initial.setChoice('101');removed=true;initial.setRefreshKey(value=>value+1);h.render();await h.flush();
  const latest=h.render();assert.equal(latest.choice,'101');assert.equal(latest.candidate,undefined);
  await latest.submit(event);assert.equal(h.writes.length,0);
});
test('existing handoff cannot be fused with a different canonical delivery task',async()=>{
  const h=association({initialVideo:{...video,tarea_edicion_id:999}});(await h.load()).setChoice('101');
  await h.render().submit(event);assert.equal(h.writes.length,0);assert.match(h.render().error,/No se fusionarán/);
});
test('current linked association remains readable after progression and prevents a second association',async()=>{
  const actual={publicacion_id:101,tarea_entrega_id:201,objetivo_pieza_id:301};
  const h=association({read:async()=>({...catalog,actual,publicaciones:[],casilleros:[]})});const view=await h.load();
  assert.equal(view.alreadyLinked,true);await view.submit(event);assert.equal(h.writes.length,0);
});
test('a double submit while first association is pending makes only one write',async()=>{
  let resolve;const h=association({write:()=>new Promise(done=>{resolve=done;})});(await h.load()).setChoice('101');
  const view=h.render();const pending=view.submit(event);await view.submit(event);assert.equal(h.writes.length,1);resolve({});await pending;
});
test('shared UI exposes safe linkage IDs/task link; admin alone mounts candidate controls and handoff stays separate',()=>{
  const shared=section('function EditorialLinkSummary','function EditorialAssociation');
  assert.match(shared,/video.publicacion_id/);assert.match(shared,/video.tarea_entrega_id/);assert.match(shared,/\/workspace\/tareas\?task=/);
  assert.doesNotMatch(shared,/apiRequest|publicacion_updated_at|objetivo_updated_at|capabilit/);
  assert.match(source,/isAdmin && kind === 'videos' && <EditorialAssociation/);
  const ui=section('  return <details className="prod-editorial-association"','function VisitDetail');
  assert.match(ui,/Vincular pieza u objetivo/);assert.match(ui,/Publicación existente/);assert.match(ui,/Casillero vacío de objetivo/);
  assert.match(ui,/kind === 'goal' && <label.*Fecha de programación/);
  assert.match(ui,/tarea de entrega/);assert.match(ui,/No se crea otra tarea/);
  assert.match(ui,/El guion no se usa como copy/);
  assert.match(source,/fecha_entrega:intent.draft.date/);
  assert.match(css,/prod-editorial-kind label.*min-height:44px/);
  assert.doesNotMatch(source,/localStorage|sessionStorage/);
});
