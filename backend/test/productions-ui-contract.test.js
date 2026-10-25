import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCapturedRequest} from '../../frontend/src/shared/session/captured-request.js';
import {createProductionDraft,productionMediaDraft,verifiedProductionDraftVisit} from '../../frontend/src/pages/productionDraft.js';
import {productionReadUrl,assertProductionClient} from '../../frontend/src/pages/productionRouteContext.js';
import {notifyViewPreferenceChange} from '../../frontend/src/shared/navigation/viewPreferenceEvent.js';

const source=readFileSync(new URL('../../frontend/src/pages/Productions.jsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../../frontend/src/pages/Productions.css',import.meta.url),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const pure=section('const VIDEO_STATES','function SafeLink');
const helpers=new Function('apiRequest','notifyViewPreferenceChange',`${pure}\nreturn {positiveId,safeProductionUrl,productionMonthDays,shiftProductionMonth,productionWrite};`)(()=>assert.fail('unexpected request'),notifyViewPreferenceChange);
const visit=Object.freeze({id:'11111111-1111-4111-8111-111111111111',revision:7,cliente_id:1,
  cliente_nombre:'QA client',fecha:'2026-10-20',titulo:'QA visit',observaciones:'',participante_ids:[3],
  drive_url:'https://drive.google.com/folder',videos:[],fotos:[]});

// Execute the actual hook with the real draft model/validator. Only React's
// state/ref/layout scheduling is injected; no always-successful form substitute.
function draftHooks() {
  const states=[],refs=[],effects=[];let stateIndex=0,refIndex=0,effectIndex=0,pending=[],form;
  const useState=initial=>{
    const index=stateIndex++;if(!(index in states))states[index]=typeof initial==='function'?initial():initial;
    return[states[index],value=>{states[index]=typeof value==='function'?value(states[index]):value;}];
  };
  const useRef=initial=>refs[refIndex++] ||= {current:initial};
  const useLayoutEffect=(setup,deps)=>{
    const index=effectIndex++,previous=effects[index];
    if(!previous || !deps || deps.some((value,i)=>value!==previous.deps?.[i])){
      pending.push(()=>{previous?.cleanup?.();effects[index]={deps,cleanup:setup()};});
    }
  };
  const hook=new Function('useState','useRef','useLayoutEffect','createProductionDraft','verifiedProductionDraftVisit','visitDTO','window',
    `${section('function useProductionDraft(', 'function DraftRecovery(')}\nreturn useProductionDraft;`)(
    useState,useRef,useLayoutEffect,createProductionDraft,verifiedProductionDraftVisit,value=>value?.visita||value,{confirm:()=>true});
  return {useState,useRef,useLayoutEffect,useProductionDraft:options=>(form=hook(options)),get form(){return form;},
    render(render){stateIndex=0;refIndex=0;effectIndex=0;const result=render();const work=pending;pending=[];work.forEach(effect=>effect());return result;},
    cleanup(){effects.forEach(effect=>effect?.cleanup?.());}};
}

test('URLs render only absolute http(s), never script, data or relative URLs',()=>{
  for(const url of ['javascript:alert(1)','data:text/html,test','file:///tmp/x','/relative','//evil.test','not a URL','']) assert.equal(helpers.safeProductionUrl(url),null);
  assert.equal(helpers.safeProductionUrl('https://drive.google.com/folder'),'https://drive.google.com/folder');
  assert.equal(helpers.safeProductionUrl('http://example.com/a'),'http://example.com/a');
  assert.match(source,/rel="noopener noreferrer"/);
});

test('calendar has Monday-first days, leap years and year-safe navigation',()=>{
  assert.equal(helpers.productionMonthDays('2026-06')[0],'2026-06-01');
  assert.equal(helpers.productionMonthDays('2026-03').filter(Boolean).length,31);
  assert.equal(helpers.productionMonthDays('2028-02').at(-1),'2028-02-29');
  assert.equal(helpers.shiftProductionMonth('2026-12',1),'2027-01');
  assert.equal(helpers.shiftProductionMonth('2026-01',-1),'2025-12');
});

test('writes carry visible visit revision, IDs and exact handoff fields',async()=>{
  const requests=[];
  const data={editor_id:3,fecha_entrega:'2026-10-30',expected_revision:99};
  const result=await helpers.productionWrite({visit,path:'/videos/video-id/enviar-edicion',method:'POST',data,
    request:async(url,options)=>{requests.push({url,...options,body:JSON.parse(options.body)});return {revision:8};}});
  assert.equal(result.revision,8);
  assert.equal(requests[0].url,`/api/producciones/${visit.id}/videos/video-id/enviar-edicion`);
  assert.deepEqual(requests[0].body,{editor_id:3,fecha_entrega:'2026-10-30',expected_revision:7});
});

test('409 refreshes exactly once without retry or mutating the input; failed refresh also preserves input',async()=>{
  for(const offline of [false,true]) {
    const input=Object.freeze({titulo:'Original title',guion:'Keep this script',estado:'repetir'});
    let writes=0,refreshes=0;
    await assert.rejects(helpers.productionWrite({visit,path:'/videos',method:'POST',data:input,
      request:async()=>{writes++;throw Object.assign(new Error('stale'),{status:409});},
      refresh:async(id)=>{assert.equal(id,visit.id);refreshes++;if(offline)throw Error('offline');return {...visit,revision:8};},
    }),error=>error.status===409 && /Conservamos|conservamos/.test(error.message));
    assert.equal(writes,1);assert.equal(refreshes,1);
    assert.equal(input.guion,'Keep this script');assert.equal(visit.revision,7);
  }
});

test('invalid visit revisions fail locally; other errors do not refresh or retry',async()=>{
  for(const revision of [undefined,null,0,-1,'7',1.5,NaN]) await assert.rejects(helpers.productionWrite({visit:{...visit,revision},data:{}}),/revisión actual/);
  let refreshes=0,writes=0;
  await assert.rejects(helpers.productionWrite({visit,data:{},request:async()=>{writes++;throw Object.assign(new Error('forbidden'),{status:403});},refresh:async()=>{refreshes++;}}),{status:403});
  assert.equal(writes,1);assert.equal(refreshes,0);
});

test('bank resumes by source ID only, same-client destination mandatory; source history untouched',async()=>{
  const body=section('  const resume = async video','  return <main');
  const sourceVideo=Object.freeze({id:'source-video',cliente_id:1,guion:'Existing script'});
  const run=async selected=>{
    const writes=[],notices=[];
    const resume=new Function('selected','writeVisit','setNotice',`${body}\nreturn resume;`)(selected,async(...args)=>writes.push(args),msg=>notices.push(msg));
    await resume(sourceVideo);return {writes,notices};
  };
  assert.equal((await run(null)).writes.length,0);
  assert.equal((await run({...visit,cliente_id:2})).writes.length,0);
  assert.deepEqual((await run(visit)).writes,[[visit,'/videos','POST',{video_origen_id:'source-video'}]]);
  assert.equal(sourceVideo.guion,'Existing script');
});

function handoff({editor='3',date='2026-10-30',material='',drive=visit.drive_url}={}) {
  const body=section('function SendToEditing(', '  return <details className="prod-handoff"');
  const inner=body.slice(body.indexOf(') {')+3);
  const writes=[],hooks=draftHooks();
  const current={...visit,drive_url:drive};
  const context={visit:current,video:{id:'video',material_url:material},onWrite:async(...args)=>{
    writes.push(args);return {...current,revision:8};
  },onDirty(){},onReload:async()=>current,safeProductionUrl:helpers.safeProductionUrl,positiveId:helpers.positiveId,
    useState:hooks.useState,useProductionDraft:hooks.useProductionDraft};
  const render=()=>new Function(...Object.keys(context),`${inner}\nreturn submit;`)(...Object.values(context));
  hooks.render(render);
  assert.deepEqual(hooks.form.draft,{editorId:'',date:''},'handoff must not infer editor/date');
  hooks.form.edit({editorId:editor,date});
  const submit=hooks.render(render);
  return {submit,writes,cleanup:()=>hooks.cleanup()};
}
test('handoff requires explicit editor/date/material; valid video or visit URL satisfies material',async()=>{
  for(const args of [{editor:''},{date:''},{drive:'javascript:bad'}]) {
    const h=handoff(args);try{await h.submit({preventDefault(){}});assert.equal(h.writes.length,0);}finally{h.cleanup();}
  }
  for(const args of [{},{drive:'',material:'https://example.com/video'}]) {
    const h=handoff(args);try{await h.submit({preventDefault(){}});
      assert.equal(h.writes.length,1);
      assert.deepEqual(h.writes[0][3],{editor_id:3,fecha_entrega:'2026-10-30'});
      assert.equal(h.writes[0][0].revision,visit.revision);
    }finally{h.cleanup();}
  }
  assert.match(source,/isAdmin && kind === 'videos'/);
  assert.match(source,/user.activo === true && \['admin','edicion'\].includes\(user.rol\)/);
  assert.match(source,/source:\(\)=>\(\{editorId:'',date:''\}\)/);
});

test('real API/auth import, ID participants and complete principal read/write endpoints',()=>{
  assert.match(source,/import \{ apiRequest \} from '..\/features\/render-os\/services\/render-os-api.js'/);
  for(const token of ['/api/usuarios','/api/clientes','video_origen_id','expected_revision:visit.revision']) assert.ok(source.includes(token),token);
  assert.equal(productionReadUrl({month:'2026-10',clientId:'1',tab:'calendar'}),'/api/producciones?mes=2026-10&cliente_id=1');
  assert.equal(productionReadUrl({month:'2026-10',clientId:'1',tab:'pending'}),'/api/producciones/pendientes?cliente_id=1');
  assert.match(source,/export function ProductionsPage\(\{sesion\}\)/);
  assert.match(source,/selected.includes\(user.id\)/);
  assert.match(source,/tarea_estado/);
  assert.match(source,/\/workspace\/tareas\?task=/);
  assert.doesNotMatch(source,/localStorage|sessionStorage|iPhone|https:\/\/images\.|fetch\(/);
});

test('day agenda shows actual media titles/states on desktop and mobile, no editor required',()=>{
  const agenda=section('function VisitAgendaItem','function VisitDetail');
  for(const token of ['video.titulo','video.estado','photo.tipo','photo.estado']) assert.ok(agenda.includes(token));
  assert.equal((source.match(/selectedDayVisits.map\(visit=><VisitAgendaItem/g)||[]).length,2);
  assert.match(source,/Vincular tarea existente \(opcional\)/);
  assert.match(css,/@media\(max-width:680px\)/);
  assert.match(css,/min-height:44px/);
  assert.match(css,/:focus-visible/);
  assert.match(css,/prefers-reduced-motion/);
  assert.doesNotMatch(css,/@import|url\(/);
});

test('editing video pending/repeat preserves guion in actual form submit payload',async()=>{
  const body=section('function MediaForm(', '  return <form className="prod-form prod-media-form"');
  const inner=body.slice(body.indexOf(') {')+3);
  for(const estado of ['pendiente','repetir']) {
    const item=Object.freeze({id:'video-id',visita_id:visit.id,titulo:'Scripted video',guion:'Texto a conservar',estado,material_url:'',observaciones:'Nota'});
    const current={...visit,videos:[item]},calls=[],dirty=[],hooks=draftHooks();
    const context={visit:current,item,kind:'videos',onWrite:async(...args)=>{calls.push(args);return {...current,revision:8};},onDirty:(...args)=>dirty.push(args),onCreated:()=>assert.fail('existing media is not new'),
      onReload:async()=>current,productionMediaDraft,safeProductionUrl:helpers.safeProductionUrl,
      useState:hooks.useState,useRef:hooks.useRef,useLayoutEffect:hooks.useLayoutEffect,useProductionDraft:hooks.useProductionDraft};
    try{
      const submit=hooks.render(()=>new Function(...Object.keys(context),`${inner}\nreturn submit;`)(...Object.values(context)));
      await submit({preventDefault(){}});
      assert.equal(calls.length,1);assert.equal(calls[0][2],'PATCH');
      assert.equal(calls[0][0].revision,7);
      assert.equal(calls[0][3].guion,'Texto a conservar');
      assert.equal(calls[0][3].estado,estado);
      assert.ok(dirty.some(([key,value])=>key==='videos:video-id'&&value===true),'begin publishes busy guard synchronously');
      assert.deepEqual(dirty.at(-1),['videos:video-id',false]);
    }finally{hooks.cleanup();}
  }
});

test('confirmed ACK plus failed readback reports saved recovery and blocks duplicate registration',async()=>{
  const body=section('  const writeVisit = async', '  const createVisit = async');
  let writes=0;const messages=[];const busy=[];
  const sesion={token:'qa-production124',usuario:{id:7,rol:'admin',activo:true}};
  const context={writeLock:{current:false},batchDraft:{current:{dirty:false,busy:false}},resultDraft:{current:{busy:false,locked:false}},setBusy:value=>busy.push(value),setNotice:value=>messages.push(value),
    readEpoch:{current:0},openVersion:{current:0},createCapturedRequest,sesion,getSesion:()=>sesion,apiRequest:()=>assert.fail('stubbed productionWrite owns dispatch'),
    productionWrite:async()=>{writes++;return {visita:{...visit,revision:8}};},refreshVisit:async()=>{throw Error('offline');},setReload:()=>{},
    visitDTO:value=>value?.visita||value,positiveId:helpers.positiveId};
  const write=new Function(...Object.keys(context),`${body}\nreturn writeVisit;`)(...Object.values(context));
  const model=createProductionDraft(visit,productionMediaDraft(null,'videos'));
  model.edit({...model.snapshot.draft,titulo:'New video'});const intent=model.begin(visit);
  await assert.rejects(write(intent.visit,'/videos','POST',intent.draft),error=>{
    assert.equal(error.productionSaved,true);assert.match(error.message,/se guardó/);assert.match(error.message,/No repitas/);
    model.fail(error);return true;
  });
  assert.equal(writes,1);assert.equal(model.snapshot.saved,true);assert.equal(model.snapshot.uncertain,false);
  assert.equal(model.snapshot.draft.titulo,'New video');assert.equal(model.snapshot.blocked,true);
  assert.throws(()=>model.begin(visit),{status:409});assert.equal(writes,1,'second click cannot dispatch');
  assert.match(messages.at(-1),/se guardó/);
  assert.deepEqual(busy,[true,false]);
});

for(const resultState of [{busy:true,locked:false},{busy:false,locked:true}])
test(`result busy=${resultState.busy} locked=${resultState.locked} blocks actual visit writer before capture or dispatch`,async()=>{
  const body=section('  const writeVisit = async','  const createVisit = async');
  const context={writeLock:{current:false},batchDraft:{current:{dirty:false,busy:false}},resultDraft:{current:resultState},
    createCapturedRequest:()=>assert.fail('Result guard must precede session capture'),
    productionWrite:()=>assert.fail('Result guard must precede transport'),
    setBusy:()=>assert.fail('Denied writer must not publish busy'),setNotice:()=>assert.fail('Denied writer must not publish notice')};
  const write=new Function(...Object.keys(context),`${body}\nreturn writeVisit;`)(...Object.values(context));
  await assert.rejects(write(visit,'/videos','POST',{}),/otra operación/);
  assert.equal(context.writeLock.current,false);assert.deepEqual(context.resultDraft.current,resultState);
});

test('conflict refresh does not key forms by revision or silently discard unsaved input',()=>{
  assert.match(source,/VisitDetail key=\{selected.id\}/);
  assert.doesNotMatch(source,/key=\{selected.revision\}/);
  assert.match(source,/useNavigationGuard/);
  assert.match(source,/useNavigationConfirmation/);
  assert.match(source,/confirm:intent=>contextConfirmation.request/);
  assert.match(source,/onDiscard:\(\)=>dirty.current.clear\(\)/);
  assert.match(source,/throw error; \/\/ Never retry/);
});

test('visit creation sends only creation fields, never expected_revision',async()=>{
  const body=section('  const createVisit = async','  const navigateMonth =');
  const requests=[];
  const data={cliente_id:1,fecha:'2026-10-30',titulo:'Visita',participante_ids:[2],tarea_origen_id:null,observaciones:'',drive_url:'',request_id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'};
  const noop=()=>{};
  const context={writeLock:{current:false},setBusy:noop,verifiedProductionDraftVisit,assertProductionClient,
    setCreating:noop,setSelected:noop,setMonth:noop,setDay:noop,setReload:noop,setNotice:noop,writeProductionLocation:noop};
  const guard={assertCurrent:noop,current:()=>true,request:async(url,options)=>{
    requests.push({url,body:JSON.parse(options.body)});
    return {visita:{...visit,...data,revision:1}};
  }};
  const create=new Function(...Object.keys(context),`${body}\nreturn createVisit;`)(...Object.values(context));
  const result=await create(JSON.stringify(data),guard);
  assert.equal(result.id,visit.id);assert.equal(result.fecha,data.fecha);
  assert.deepEqual(requests,[{url:'/api/producciones',body:data}]);
  assert.equal(Object.hasOwn(requests[0].body,'expected_revision'),false);
});
