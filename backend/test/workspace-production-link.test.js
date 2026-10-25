import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {notifyViewPreferenceChange} from '../../frontend/src/shared/navigation/viewPreferenceEvent.js';
import {canonicalTaskState} from '../../frontend/src/features/render-os/constants.js';
import {getCanonicalTaskContentMetadata,isLinkedProductionEditorialTask} from '../../frontend/src/features/render-os/utils/task-content.js';
import {createCapturedRequest,isSessionFailure} from '../../frontend/src/shared/session/captured-request.js';
import {verifiedProductionDraftVisit} from '../../frontend/src/pages/productionDraft.js';
import {createProductionVisitObserver} from '../../frontend/src/pages/productionVisitObservation.js';
import {productionLocation,productionCalendarDay,assertProductionClient} from '../../frontend/src/pages/productionRouteContext.js';
import {workspaceBriefSave} from './helpers/workspace-brief-fixture.js';
const session={token:'synthetic-production-link',usuario:{id:1,rol:'admin',activo:true}};
const captureFor=request=>()=>createCapturedRequest({session,readSession:()=>session,request});
const workspace=readFileSync(new URL('../../frontend/src/pages/WorkspaceReadOnly.jsx',import.meta.url),'utf8');
const productions=readFileSync(new URL('../../frontend/src/pages/Productions.jsx',import.meta.url),'utf8');
const extract=(source,start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const registryState=new Function(`${extract(workspace,'function taskProductionRegistryState','function TaskDetail')}return taskProductionRegistryState;`)();
const id='11111111-1111-4111-8111-111111111111';
const task={id:10,revision:7};
const link={id,fecha:'2026-09-12',revision:2,tipo:'origen',videos_total:0,videos_grabados:0,fotos_total:0,usa_registro_individual:false};

test('loading, lookup failure and stale responses cannot enable legacy writes or source field edits',()=>{
  for(const lookup of [{status:'loading',key:'10:7'},{status:'error',key:'10:7'},{status:'ready',key:'10:6',vinculo:null}]) {
    const state=registryState(task,lookup);
    assert.equal(state.ready,false);assert.equal(state.legacyEnabled,false);assert.equal(state.clientEditable,false);assert.equal(state.dateEditable,false);
  }
});

test('linked source date labels and material message distinguish visit context without hiding real task attachments',()=>{
  assert.match(workspace,/registry.vinculo\?\.tipo === "origen" \? "Fecha de visita" : "Entrega"/);
  assert.match(workspace,/registry.vinculo\?\.tipo === "origen" \? "Fecha de visita" : "Vencimiento"/);
  const material=extract(workspace,'<h3>{isProductionVisit ? "Material de producción"','<details className="ros-more-information"');
  assert.match(material,/registry.vinculo\?\.tipo === "origen" && <p>Consultá el material de esta visita en Producciones/);
  assert.match(material,/href=\{`\/producciones\?visita=\$\{encodeURIComponent\(registry.vinculo.id\)\}`\}/);
  assert.match(material,/registry.vinculo\?\.tipo !== "origen" && !task.material_referencia && driveFiles.length === 0/);
  assert.match(material,/isProductionVisit && registry.vinculo\?\.tipo !== "origen" && <small className="ros-drive-help"/);
  assert.match(material,/task.material_referencia && <a/);
  assert.match(material,/driveFiles.filter/);
  assert.match(material,/links.map/);
  assert.match(material,/DriveUploader task=\{task\}/);
  assert.doesNotMatch(material,/registry.vinculo.drive_url/);
});
test('explicit null binding retains legacy flow; empty canonical visit selects individual workflow',()=>{
  const standalone=registryState(task,{status:'ready',key:'10:7',vinculo:null});
  assert.equal(standalone.legacyEnabled,true);assert.equal(standalone.clientEditable,true);assert.equal(standalone.dateEditable,true);
  const empty=registryState(task,{status:'ready',key:'10:7',vinculo:link});
  assert.equal(empty.legacyEnabled,false);assert.equal(empty.usesIndividual,true);assert.equal(empty.clientEditable,false);assert.equal(empty.dateEditable,false);assert.equal(empty.vinculo.id,id);
});
test('canonical origin selects individual workflow without guessing media or changing reporting flag',()=>{
  const individual=registryState(task,{status:'ready',key:'10:7',vinculo:{...link,fotos_total:1,usa_registro_individual:true}});
  assert.equal(individual.usesIndividual,true);assert.equal(individual.legacyEnabled,false);
  const historical=registryState(task,{status:'ready',key:'10:7',vinculo:{...link,videos_total:9,usa_registro_individual:false}});
  assert.equal(historical.legacyEnabled,false);assert.equal(historical.vinculo.usa_registro_individual,false);
  const editing=registryState(task,{status:'ready',key:'10:7',vinculo:{...link,tipo:'edicion',usa_registro_individual:true}});
  assert.equal(editing.clientEditable,false);assert.equal(editing.dateEditable,true);assert.equal(editing.vinculo.id,id);
});

test('actual lookup effect uses separate endpoint and failures stay errors rather than null success',async()=>{
  const start=workspace.lastIndexOf('  useEffect(() => {',workspace.indexOf('guard.request(`/api/producciones/tareas/'));
  const end=workspace.indexOf('  }, [task?.id, task?.revision, task?.updated_at, registryRetry, captureRequest]);',start);
  assert.ok(start>=0 && end>start,'Extract the actual guarded registry effect');
  const effect=workspace.slice(start,end)+'  }, []);';
  for(const response of [{vinculo:null},{vinculo:link},null,{oops:true},Error('offline')]) {
    const states=[];let url;
    const events={addEventListener(){},removeEventListener(){}};
    new Function('task','registryRetry','useEffect','captureRequest','setRegistryLookup','window','document',effect)(task,0,fn=>fn(),
      captureFor(async(path,options)=>{url=path;assert.equal(new Headers(options.headers).get('Authorization'),'Bearer synthetic-production-link');if(response instanceof Error)throw response;return response;}),value=>states.push(value),events,{...events,visibilityState:'visible'});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(url,'/api/producciones/tareas/10');
    assert.equal(states[0].status,'loading');
    assert.equal(states.at(-1).status,response && Object.hasOwn(response,'vinculo') ? 'ready' : 'error');
  }
});

test('drawer focus/visible rechecks independent registry, blocks legacy immediately and cleans up listeners',async()=>{
  const start=workspace.lastIndexOf('  useEffect(() => {',workspace.indexOf('guard.request(`/api/producciones/tareas/'));
  const end=workspace.indexOf('  }, [task?.id, task?.revision, task?.updated_at, registryRetry, captureRequest]);',start);
  assert.ok(start>=0 && end>start,'Extract the actual guarded registry effect');
  const effect=workspace.slice(start,end)+'  }, []);';
  const windowListeners=new Map(),documentListeners=new Map();
  const events=listeners=>({addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{assert.equal(listeners.get(name),fn);listeners.delete(name);}});
  const window=events(windowListeners),document={...events(documentListeners),visibilityState:'visible'};
  let cleanup,lookup,retries=0,signal;
  const run=new Function('task','registryRetry','useEffect','captureRequest','setRegistryLookup','setRegistryRetry','window','document',effect);
  run(task,0,fn=>{cleanup=fn();},captureFor(async(_url,options)=>{signal=options.signal;return {vinculo:link};}),value=>{lookup=value;},fn=>{retries=fn(retries);},window,document);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(registryState(task,lookup).legacyEnabled,false);
  document.visibilityState='hidden';documentListeners.get('visibilitychange')();windowListeners.get('focus')();
  assert.equal(retries,0);
  document.visibilityState='visible';documentListeners.get('visibilitychange')();
  assert.equal(lookup.status,'loading');assert.equal(registryState(task,lookup).legacyEnabled,false);
  assert.equal(retries,1);assert.equal(signal.aborted,true);
  windowListeners.get('focus')();assert.equal(retries,1,'paired focus/visible events coalesce before effect restart');
  cleanup();assert.equal(windowListeners.size,0);assert.equal(documentListeners.size,0);
  // The new effect request sees media added independently, even with unchanged task revision.
  run(task,retries,fn=>{cleanup=fn();},captureFor(async()=>({vinculo:{...link,usa_registro_individual:true,videos_total:1}})),value=>{lookup=value;},fn=>{retries=fn(retries);},window,document);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(registryState(task,lookup).usesIndividual,true);
  windowListeners.get('focus')();assert.equal(retries,2);
  cleanup();assert.equal(windowListeners.size,0);assert.equal(documentListeners.size,0);
  assert.doesNotMatch(effect,/setDraft|setEditing|setProductionAmount|setProductionDate/);
});

test('legacy action and date/client controls are guarded without disabling the task content editor',()=>{
  assert.match(workspace,/\(isAdmin \|\| sesion.usuario.rol === "produccion"\) && legacyProductionEnabled/);
  assert.match(workspace,/const canConfirmProduction = legacyProductionEnabled/);
  assert.match(workspace,/if \(!canRegisterProduction\) return;/);
  assert.match(workspace,/isProductionVisit && registry.ready && !registry.usesIndividual && <section/);
  for(const permission of ['canEditVisitClient','canEditVisitDate']) {
    assert.ok(workspace.includes(`canEditTask && ${permission}`));
    assert.ok(workspace.includes(`editing && ${permission}`));
  }
  assert.match(workspace,/field === "cliente_id" && !canEditVisitClient/);
  assert.match(workspace,/field === "fecha_vencimiento" && !canEditVisitDate/);
  assert.match(workspace,/El cliente de esta tarea viene de la visita/);
  assert.match(workspace,/\/producciones\?visita=\$\{encodeURIComponent\(registry.vinculo.id\)\}/);
  assert.match(workspace,/TaskContentWorkspace task=\{task\}.*editing=\{canEditTask \|\| editing\}/);
});

test('saving linked source text cannot rewrite registry date/client or legacy production planning',async()=>{
  const original={...task,titulo:'Visit',cliente_id:1,fecha_vencimiento:'2026-09-12',estado:'pendiente',propiedades_extra:{produccion_videos_previstos:3}};
  const writes=[];
  const context={task:original,draft:{...original,aclaraciones:'New text',cliente_id:9,fecha_vencimiento:'2026-10-30',produccion_videos_previstos:0},
    captureRequest:captureFor(),isSessionFailure,
    canEditTask:true,canEditVisitClient:false,canEditVisitDate:false,legacyProductionEnabled:false,isProductionVisit:true,productionProgress:{planned:3},
    metadata:original.propiedades_extra,tags:[],collaborators:[],canonicalTaskState,getCanonicalTaskContentMetadata,isLinkedProductionEditorialTask,
    setSaving:()=>{},setEditing:()=>{},onUpdate:async(id,data)=>writes.push(data)};
  const save=workspaceBriefSave(workspace,context);
  await save();
  assert.deepEqual(writes,[{aclaraciones:'New text'}]);
});

test('linked editing task can save delivery date but never client changes',async()=>{
  const original={...task,titulo:'Editing',cliente_id:1,fecha_vencimiento:'2026-09-12',estado:'pendiente',propiedades_extra:{}};
  const writes=[];
  const permissions=registryState(task,{status:'ready',key:'10:7',vinculo:{...link,tipo:'edicion'}});
  const context={task:original,draft:{...original,cliente_id:9,fecha_vencimiento:'2026-10-30'},
    captureRequest:captureFor(),isSessionFailure,
    canEditTask:true,canEditVisitClient:permissions.clientEditable,canEditVisitDate:permissions.dateEditable,
    legacyProductionEnabled:false,isProductionVisit:false,productionProgress:{},metadata:{},tags:[],collaborators:[],canonicalTaskState,getCanonicalTaskContentMetadata,isLinkedProductionEditorialTask,
    setSaving:()=>{},setEditing:()=>{},onUpdate:async(id,data)=>writes.push(data)};
  const save=workspaceBriefSave(workspace,context);
  await save();
  assert.deepEqual(writes,[{fecha_vencimiento:'2026-10-30'}]);
});

const locationFns=extract(productions,'function writeProductionLocation','// CAS always uses');
test('deep-link URL validates UUID and persists real visit/month query across reload/back/forward',()=>{
  const events=[];
  const window={location:{href:'https://render.test/producciones?other=keep'},history:{state:{existing:1}}};
  for(const method of ['pushState','replaceState']) window.history[method]=(state,title,url)=>{events.push({method,url:String(url)});window.location.href=String(url);};
  const h=new Function('window','productionLocation','notifyViewPreferenceChange',`${locationFns}return {productionLocation,writeProductionLocation};`)(window,productionLocation,notifyViewPreferenceChange);
  h.writeProductionLocation({id,month:'2026-09',day:'2026-09-12'});
  assert.deepEqual(h.productionLocation(window.location.href),{id,month:'2026-09',day:'2026-09-12',clientId:'',tab:'calendar'});
  assert.equal(new URL(window.location.href).searchParams.get('other'),'keep');
  const visitUrl=window.location.href;
  h.writeProductionLocation({month:'2026-10'});
  assert.deepEqual(h.productionLocation(window.location.href),{id:null,month:'2026-10',day:null,clientId:'',tab:'calendar'});
  assert.deepEqual(h.productionLocation(visitUrl),{id,month:'2026-09',day:'2026-09-12',clientId:'',tab:'calendar'});
  assert.equal(new URL(window.location.href).searchParams.has('dia'),false,'month-only navigation clears the old day');
  assert.throws(()=>h.productionLocation('https://render.test/producciones?visita=invalid'),/no es válido/);
  assert.equal(events.length,2);
});

function visitLoader(request, {href=`https://render.test/producciones?visita=${id}`,clientId='1',tab='calendar'} = {}) {
  const state={selected:null,month:null,day:null,error:null,busy:false};
  const writes=[];const openVersion={current:0};
  const historyEvents=[],window={location:{href},history:{state:{existing:1}}};
  for(const method of ['pushState','replaceState'])window.history[method]=(saved,title,url)=>{historyEvents.push(method);window.location.href=String(url);};
  const write=new Function('window','notifyViewPreferenceChange',`${locationFns}return writeProductionLocation;`)(window,notifyViewPreferenceChange);
  const observer=createProductionVisitObserver(()=>0);
  const context={observeProductionVisit:value=>observer.observe(value),mayLeave:action=>action(),openVersion,assertProductionClient,productionLocation,window,clientId,tab,setCreating:()=>{},setSelected:value=>{state.selected=value;},setDetailLoading:value=>{state.busy=value;},setError:value=>{state.error=value;},
    setMonth:value=>{state.month=value;},setDay:value=>{state.day=value;},verifiedProductionDraftVisit,apiRequest:request,writeProductionLocation:value=>{writes.push(value);write(value);}};
  const open=new Function(...Object.keys(context),`${extract(productions,'  const openVisit =','  const restoreProductionLocation =')}return openVisit;`)(...Object.values(context));
  return {open,state,writes,historyEvents,window};
}
const fullVisit=(visitId,fecha)=>({id:visitId,revision:1,cliente_id:1,cliente_nombre:'QA observed client',
  fecha,titulo:'QA observed visit',observaciones:'',drive_url:'',participante_ids:[],videos:[],fotos:[]});
test('actual deep-link loader selects remote month/day and avoids pushing history on reload or popstate',async()=>{
  const calls=[];
  const h=visitLoader(async url=>{calls.push(url);return fullVisit(id,'2026-09-12');},{href:`https://render.test/producciones?visita=${id}&cliente=1&mes=2026-09&dia=2026-09-12`});
  await h.open(id,{history:false});
  assert.equal(calls[0],`/api/producciones/${id}`);
  assert.equal(h.state.month,'2026-09');assert.equal(h.state.day,'2026-09-12');assert.equal(h.state.selected.id,id);
  assert.equal(h.writes.length,0);
  await h.open(id);
  assert.deepEqual(h.writes,[{id,month:'2026-09',day:'2026-09-12',clientId:'1',tab:'calendar'}]);
});
test('late visit response cannot replace a newer navigation selection',async()=>{
  let resolveFirst;
  const h=visitLoader(url=>url.endsWith(id) ? new Promise(resolve=>{resolveFirst=resolve;}) : Promise.resolve(fullVisit('second','2026-10-20')));
  const first=h.open(id,{history:false});await h.open('second',{history:false});
  resolveFirst(fullVisit(id,'2026-09-12'));await first;
  assert.equal(h.state.selected.id,'second');assert.equal(h.state.month,'2026-10');
  assert.deepEqual(h.writes,[],'obsolete response cannot canonicalize history');
});
test('verified date canonicalization replaces missing/differing month or day and uses URL client/tab, not old closure',async()=>{
  for(const [month,day,replace] of [['2026-09','2026-09-12',false],['2026-09',null,true],['2026-09','2026-09-13',true],['2026-10',null,true],[null,null,true]]) {
    const h=visitLoader(async()=>fullVisit(id,'2026-09-12'),{
      href:`https://render.test/producciones?visita=${id}&cliente=1&tab=pending${month ? `&mes=${month}` : ''}${day ? `&dia=${day}` : ''}`,
      clientId:'9',tab:'calendar',
    });
    await h.open(id,{history:false,checkDirty:false,expectedClient:'1'});
    assert.equal(h.state.error,'');assert.equal(h.state.selected.id,id);
    assert.deepEqual(h.writes,replace ? [{id,month:'2026-09',day:'2026-09-12',clientId:'1',tab:'pending',replace:true}] : []);
    assert.deepEqual(h.historyEvents,replace ? ['replaceState'] : []);
    assert.equal(productionLocation(h.window.location.href).day,'2026-09-12');
    assert.equal(productionLocation(h.window.location.href).tab,'pending');
    assert.equal(productionLocation(h.window.location.href).clientId,'1');
  }
});
test('foreign-client response cannot canonicalize mismatching URL month',async()=>{
  const h=visitLoader(async()=>({...fullVisit(id,'2026-09-12'),cliente_id:2}),{
    href:`https://render.test/producciones?visita=${id}&cliente=1&tab=pending&mes=2026-10`,
  });
  await h.open(id,{history:false,checkDirty:false,expectedClient:'1'});
  assert.match(h.state.error,/no pertenece/);assert.equal(h.state.selected,null);assert.deepEqual(h.writes,[]);
  assert.deepEqual(h.historyEvents,[]);
});
test('late version cannot replace URL even when its verified date differs',async()=>{
  const resolvers=[];
  const h=visitLoader(()=>new Promise(yes=>resolvers.push(yes)),{href:`https://render.test/producciones?visita=${id}&cliente=1&tab=pending&mes=2026-10`});
  const pending=h.open(id,{history:false,checkDirty:false,expectedClient:'1'});
  const newer=h.open('newer',{history:false,checkDirty:false});
  resolvers[1](fullVisit('newer','2026-10-20'));await newer;
  resolvers[0](fullVisit(id,'2026-09-12'));await pending;
  assert.equal(h.state.selected.id,'newer');assert.deepEqual(h.writes,[]);
  assert.deepEqual(h.historyEvents,[]);
});
test('actual deep-link loader rejects incomplete readback instead of publishing an empty visit',async()=>{
  const h=visitLoader(async()=>({id,revision:2,fecha:'2026-09-12'}));
  await h.open(id,{history:false});
  assert.equal(h.state.selected,null);assert.equal(h.state.month,null);assert.equal(h.writes.length,0);
  assert.match(h.state.error,/detalle completo/);assert.equal(h.state.busy,false);
});
test('popstate listener uses latest handler, cleans up and never stores business data',()=>{
  assert.match(productions,/navigationRef.current = restoreProductionLocation/);
  assert.match(productions,/window.addEventListener\('popstate',restore\)/);
  assert.match(productions,/window.removeEventListener\('popstate',restore\)/);
  assert.match(productions,/openVisit\(location.id,\{history:false,checkDirty:false,expectedClient:location.clientId\}\)/);
  assert.doesNotMatch(productions,/localStorage|sessionStorage/);
});

test('committed popstate restores UUID or calendar without a second dirty prompt or history rollback',async()=>{
  for(const [href,allow] of [[`https://render.test/producciones?visita=${id}`,true],['https://render.test/producciones?mes=2026-08',true],['https://render.test/producciones?mes=2026-08&dia=2026-08-21',true],[`https://render.test/producciones?visita=${id}`,false]]) {
    const calls=[];const state={selected:{id:'current'},month:'2026-10',day:null};
    let prompts=0,invalidations=0;
    const context={window:{location:{href}},mayLeave:()=>{prompts++;return allow;},selected:{id:'current'},month:'2026-10',today:'2026-10-19',
      contextGate:{current:{invalidate:()=>{invalidations++;}}},productionLocation,productionCalendarDay,writeProductionLocation:value=>calls.push(['write',value]),openVisit:async(...args)=>calls.push(['open',...args]),openVersion:{current:0},
      readEpoch:{current:0},setListAvailable:()=>{},setContextError:()=>{},setClientId:()=>{},setTab:()=>{},setReload:()=>{},dirty:{current:new Set(['draft'])},
      setSelected:value=>{state.selected=value;},setCreating:()=>{},setDetailLoading:()=>{},setError:()=>{},setMonth:value=>{state.month=value;},setDay:value=>{state.day=value;}};
    const restore=new Function(...Object.keys(context),`${extract(productions,'  const restoreProductionLocation =','  navigationRef.current =')}return restoreProductionLocation;`)(...Object.values(context));
    await restore();
    assert.equal(prompts,0,'committed restoration never asks a second dirty prompt');
    assert.equal(invalidations,1,'committed restoration invalidates pending context consent');
    assert.equal(context.readEpoch.current,1,'restoration fences earlier collection reads');
    assert.equal(context.dirty.current.size,1,'manual restoration is not a confirmed discard');
    if(href.includes('visita=')) assert.deepEqual(calls,[['open',id,{history:false,checkDirty:false,expectedClient:''}]]);
    else {assert.equal(state.selected,null);assert.equal(state.month,'2026-08');assert.equal(state.day,href.includes('dia=')?'2026-08-21':'2026-08-01');assert.equal(calls.length,0);}
  }
});
