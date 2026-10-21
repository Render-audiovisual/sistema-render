import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getSesion } from '../utils.jsx';
import { createMoodboardInitialization } from '../shared/session/moodboard-initialization.js';
import { createCapturedRequest } from '../shared/session/captured-request.js';
import { useSessionView } from '../shared/session/use-session-view.js';
import { useNavigationGuard } from '../shared/navigation/useNavigationGuard.js';
import { requestAppNavigation } from '../shared/navigation/location.js';
import { createMoodboardBoardLoader } from '../shared/session/moodboard-board-loader.js';
import { createMoodboardReferenceOperation, createMoodboardTaskLinkOperation, verifiedMoodboardReference } from '../shared/session/moodboard-reference-operation.js';
import { readMoodboardLocation, resolveMoodboardBoard, moodboardBoardUrl, moodboardTaskIntent } from './moodboardLocation.js';
import "./MoodboardPreview.css";

const STATUS={aprobada:{label:"Aprobada",icon:"✓"},libre:{label:"Libre",icon:"○"},descartada:{label:"Descartada",icon:"×"}};
async function api(url,options){const r=await fetch(url,options);if(r.status===204)return null;const d=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(d?.error||"No se pudo completar la operación."),{status:r.status});if(['POST','DELETE'].includes(options?.method)&&/^\/api\/moodboards\/references\/[1-9]\d*\/tasks\/[1-9]\d*$/.test(url))throw new Error('No se pudo confirmar el vínculo. Actualizá los datos antes de otra decisión.');return d}
function domain(value){try{return new URL(value).hostname.replace(/^www\./,"")}catch{return"Enlace externo"}}

function AuthImage({item,className="",alt=""}){
  const [src,setSrc]=useState(item.archivo_nombre?"":item.enlace_externo||"");
  useEffect(()=>{if(!item.archivo_nombre){setSrc(item.enlace_externo||"");return}let alive=true,objectUrl="";fetch(`/api/moodboards/assets/${encodeURIComponent(item.archivo_nombre)}`).then(r=>{if(!r.ok)throw new Error();return r.blob()}).then(blob=>{objectUrl=URL.createObjectURL(blob);if(alive)setSrc(objectUrl)}).catch(()=>alive&&setSrc(""));return()=>{alive=false;if(objectUrl)URL.revokeObjectURL(objectUrl)}},[item.archivo_nombre,item.enlace_externo]);
  return src?<img className={className} src={src} alt={alt}/>:<div className={`moodboard-image-loading ${className}`}><span>✦</span></div>
}

function boardCatalog(value){if(!Array.isArray(value)||value.some(board=>!Number.isSafeInteger(board?.id)||board.id<=0||typeof board.nombre!=="string"||!Array.isArray(board.clientes)||board.clientes.some(client=>!Number.isSafeInteger(client?.id)||client.id<=0||typeof client.nombre!=="string"))||new Set(value.map(board=>board.id)).size!==value.length)throw new Error("No se pudo verificar la lista de moodboards.");return value}
function currentMoodboardLocation(){try{return{selection:readMoodboardLocation(window.location.search),error:""}}catch(reason){return{selection:null,error:reason.message}}}
export function MoodboardPreviewPage(){
  const view=useSessionView(getSesion()),identity=useRef({view,epoch:0});
  if(identity.current.view!==view)identity.current={view,epoch:identity.current.epoch+1};
  return <MoodboardContent key={identity.current.epoch} sesion={view.session}/>;
}
function MoodboardContent({sesion}){
  const mounted=useRef(false),initialization=useRef(null),initializingRef=useRef(false);
  const operationOwners=useRef(new Set()),recoveryOwners=useRef(new Set());
  const [operationBusy,setOperationBusy]=useState(false);
  const moodboardNavigationStatus=()=>{
    const scope=createCapturedRequest({session:sesion,readSession:getSesion,request:api,isActive:()=>mounted.current});
    return{dirty:scope.current()&&recoveryOwners.current.size>0,busy:scope.current()&&operationOwners.current.size>0};
  };
  useNavigationGuard(moodboardNavigationStatus);
  const boardObservation=useRef({id:null,generation:0}),boardLoader=useRef(null),loadGeneration=useRef(0),listController=useRef(null),listGeneration=useRef(0),catalog=useRef(null);
  const [location,setLocation]=useState(currentMoodboardLocation),locationRef=useRef(location);locationRef.current=location;
  const [boardEpoch,setBoardEpoch]=useState(0);
  const [initializing,setInitializing]=useState(false);
  useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;initialization.current?.abort();listController.current?.abort();boardLoader.current?.cancel();loadGeneration.current++}},[]);
  const activateBoard=(id,allowEscape=false)=>{
    if(operationOwners.current.size&&!allowEscape)return;
    boardLoader.current?.cancel();loadGeneration.current++;
    boardObservation.current={id,generation:boardObservation.current.generation+1};
    setRefs([]);setCategories([]);setTasks([]);setSelected(null);setComposer(false);setCategoryEditor(false);setStatus("all");setCategory("all");setQuery("");
    setBoardId(id);setBoardEpoch(boardObservation.current.generation);setLoading(Boolean(id));
  };
  const applyLocation=(next,items=catalog.current,allowEscape=false)=>{
    if(operationOwners.current.size&&!allowEscape)return;
    locationRef.current=next;setLocation(next);
    if(next.error||!next.selection){activateBoard(null,allowEscape);setError(next.error);return}
    if(!items){activateBoard(null,allowEscape);setLoading(true);return}
    try{const id=resolveMoodboardBoard(items,next.selection);activateBoard(id,allowEscape);setError("");
      if(id){window.history.replaceState(window.history.state,"",moodboardBoardUrl(window.location.href,id));const canonical={selection:{...next.selection,boardId:id},error:""};locationRef.current=canonical;setLocation(canonical)}
    }catch(reason){activateBoard(null,allowEscape);setError(reason.message)}
  };
  const chooseBoard=id=>{if(operationOwners.current.size)return;const href=moodboardBoardUrl(window.location.href,id);if(!requestAppNavigation(window,href))return;window.history.pushState(window.history.state,"",href);applyLocation(currentMoodboardLocation())};
  const readBoards=async()=>{
    listController.current?.abort();const controller=new AbortController();listController.current=controller;const generation=++listGeneration.current;
    const scope=createCapturedRequest({session:sesion,readSession:getSesion,request:api,isActive:()=>mounted.current&&generation===listGeneration.current&&!controller.signal.aborted});
    if(!scope.current())return;
    try{const items=boardCatalog(await scope.request("/api/moodboards/boards",{signal:controller.signal,cache:"no-store"}));if(!scope.current())return;catalog.current=items;setBoards(items);applyLocation(locationRef.current,items)}
    catch(reason){if(scope.current()){setError(reason.message);setLoading(false)}}
  };
  const prepareBoards=async()=>{
    if(initializingRef.current||operationOwners.current.size)return;
    const origin=boardObservation.current;
    const controller=new AbortController();initialization.current=controller;
    const operation=createMoodboardInitialization({session:sesion,readSession:getSesion,isMounted:()=>mounted.current,fetchImpl:window.fetch.bind(window),signal:controller.signal});
    if(!operation.current())return;
    initializingRef.current=true;setInitializing(true);setError('');
    try{const result=await operation.run();if(!operation.current()||!result||origin!==boardObservation.current)return;const items=boardCatalog(result);listController.current?.abort();listGeneration.current++;catalog.current=items;setBoards(items);applyLocation(locationRef.current,items)}
    catch(reason){if(operation.current()&&origin===boardObservation.current)setError(reason.message)}
    finally{initializingRef.current=false;if(operation.current())setInitializing(false)}
  };
  const [boards,setBoards]=useState([]),[boardId,setBoardId]=useState(null),[refs,setRefs]=useState([]),[categories,setCategories]=useState([]),[tasks,setTasks]=useState([]),[status,setStatus]=useState("all"),[category,setCategory]=useState("all"),[query,setQuery]=useState(""),[selected,setSelected]=useState(null),[composer,setComposer]=useState(false),[categoryEditor,setCategoryEditor]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState("");
  // A canceled native traverse emits no popstate. An actual escape must follow
  // its URL and invalidate the old scope, even though memory recovery is lost.
  useEffect(()=>{void readBoards();const pop=()=>applyLocation(currentMoodboardLocation(),undefined,true);window.addEventListener('popstate',pop);return()=>{window.removeEventListener('popstate',pop);listController.current?.abort()}},[]);
  const load=async(id,observation=boardObservation.current,openTask=false,options={})=>{
    if(!id||observation.id!==id||observation!==boardObservation.current||!mounted.current){if(options.throwOnError){options.scope?.assertCurrent();throw new Error('El moodboard cambió. Volvé a abrir la referencia.')}return;}
    options.scope?.assertCurrent();
    boardLoader.current?.cancel();const generation=++loadGeneration.current;
    const scope=options.scope||createCapturedRequest({session:sesion,readSession:getSesion,request:api,isActive:()=>mounted.current&&boardObservation.current===observation});
    const own=createMoodboardBoardLoader({request:scope.request,isCurrent:scope.current});boardLoader.current=own;
    if(!scope.current())return;setLoading(true);
    try{const result=await own.load(id);if(!result||!scope.current()||generation!==loadGeneration.current){if(options.throwOnError){scope.assertCurrent();throw new Error('La lectura fue reemplazada. Actualizá el moodboard para revisar.')}return;}
      setRefs(result.references);setCategories(result.categories);setTasks(result.tasks);setError("");
      setSelected(current=>scope.current()&&generation===loadGeneration.current?(result.references.find(item=>item.id===current?.id)||null):current);
      if(openTask&&moodboardTaskIntent(locationRef.current.selection,catalog.current?.find(item=>item.id===id),result.tasks))setComposer(true);
      return result;
    }catch(reason){if(scope.current()&&generation===loadGeneration.current)setError(reason.message);if(options.throwOnError)throw reason;}
    finally{if(scope.current()&&generation===loadGeneration.current)setLoading(false)}
  };
  useEffect(()=>{void load(boardId,boardObservation.current,true);const own=boardLoader.current;return()=>own?.cancel()},[boardId,boardEpoch]);
  const origin=boardObservation.current,originCurrent=()=>mounted.current&&boardObservation.current===origin;
  const captureOperation=(active=()=>true)=>createCapturedRequest({session:sesion,readSession:getSesion,request:api,isActive:()=>originCurrent()&&active()});
  const reloadOperation=scope=>load(origin.id,origin,false,{scope,throwOnError:true});
  const onOperationBusy=(owner,busy,recovery=false)=>{
    if(busy){if(!originCurrent())return;operationOwners.current.add(owner);}
    else operationOwners.current.delete(owner);
    if(recovery&&originCurrent())recoveryOwners.current.add(owner);else recoveryOwners.current.delete(owner);
    if(mounted.current)setOperationBusy(operationOwners.current.size>0);
  };
  const finishReference=scope=>{
    scope.assertCurrent();if(!originCurrent())return;
    const url=new URL(window.location.href);url.searchParams.delete('task');
    window.history.replaceState(window.history.state,'',`${url.pathname}${url.search}${url.hash}`);
    const next={...locationRef.current,selection:{...locationRef.current.selection,taskId:null}};
    locationRef.current=next;setLocation(next);setComposer(false);
  };
  const board=boards.find(b=>b.id===boardId),counts=refs.reduce((a,r)=>({...a,[r.estado]:(a[r.estado]||0)+1}),{}),visible=useMemo(()=>refs.filter(r=>status==="all"?r.estado!=="descartada":r.estado===status).filter(r=>category==="all"||String(r.category_id)===String(category)).filter(r=>`${r.titulo} ${r.nota} ${(r.etiquetas||[]).join(" ")}`.toLowerCase().includes(query.toLowerCase())),[refs,status,category,query]);
  const update=async(id,change,guard=captureOperation())=>{guard.assertCurrent();const saved=await guard.request(`/api/moodboards/references/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(change)});guard.assertCurrent();verifiedMoodboardReference(saved,origin.id);if(saved.id!==id)throw new Error('La respuesta no corresponde a la referencia.');const current=refs.find(r=>r.id===id),merged={...current,...saved};if(change.category_id)merged.categoria=categories.find(c=>c.id===Number(change.category_id))?.nombre;setRefs(all=>guard.current()?all.map(r=>r.id===id?merged:r):all);setSelected(s=>guard.current()&&s?.id===id?merged:s);return merged;};
  const remove=async(item,guard=captureOperation())=>{guard.assertCurrent();if(!confirm(`Eliminar definitivamente “${item.titulo}”? Esta acción no se puede deshacer.`))return;guard.assertCurrent();await guard.request(`/api/moodboards/references/${item.id}`,{method:"DELETE"});guard.assertCurrent();setRefs(all=>guard.current()?all.filter(r=>r.id!==item.id):all);setSelected(null);};
  if(loading&&!boards.length)return <main className="moodboard-loading-page"><span>✦</span><strong>Preparando los moodboards…</strong></main>;
  return <main className="moodboard-preview-shell">
    <aside className="moodboard-brand-rail"><div className="moodboard-rail-heading"><span>Moodboards</span><small>Todos los clientes activos</small></div><nav aria-label="Marcas">{boards.map(b=><button key={b.id} disabled={operationBusy} className={b.id===boardId?"active":""} onClick={()=>chooseBoard(b.id)}><span className="moodboard-brand-avatar">{b.nombre.charAt(0)}</span><span><strong>{b.nombre}</strong><small>{b.clientes.length>1?`${b.clientes.length} cuentas compartidas`:`${b.total_referencias} referencias`}</small></span></button>)}</nav></aside>
    <section className="moodboard-workspace"><header className="moodboard-header">
      <div className="moodboard-title-row"><div><span className="moodboard-eyebrow">Criterio visual de marca</span><h1>{board?.nombre||"Moodboard"}</h1><p>{board?.clientes?.length>1?`Compartido entre ${board.clientes.map(c=>c.nombre).join(" y ")}.`:"Referencias para mantener una dirección visual coherente."}</p></div><button className="moodboard-add-primary" disabled={!board||operationBusy} onClick={()=>{if(!operationOwners.current.size)setComposer(true)}}><span>＋</span>Nueva referencia</button></div>
      <div className="moodboard-tools"><label className="moodboard-search"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar por idea o etiqueta…"/></label><div className="moodboard-status-tabs"><Filter value="all" current={status} set={setStatus} label="Todo" count={(counts.aprobada||0)+(counts.libre||0)}/><Filter value="aprobada" current={status} set={setStatus} label="Aprobadas" count={counts.aprobada||0}/><Filter value="libre" current={status} set={setStatus} label="Libres" count={counts.libre||0}/><Filter value="descartada" current={status} set={setStatus} label="Descartadas" count={counts.descartada||0}/></div><label className="moodboard-category-filter">Categoría<select value={category} onChange={e=>setCategory(e.target.value)}><option value="all">Todas</option>{categories.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label><button className="moodboard-category-edit" disabled={!board||operationBusy} onClick={()=>{if(!operationOwners.current.size)setCategoryEditor(true)}}>Editar categorías</button></div>
    </header>
      <div className="moodboard-initialize"><button type="button" onClick={prepareBoards} disabled={initializing||operationBusy}>{initializing?'Preparando…':'Preparar clientes nuevos'}</button>{!board&&<span>Prepará los clientes para agregar referencias reales.</span>}</div>
      {error&&<div className="moodboard-error">{error}</div>}<div className="moodboard-gallery-label"><span>{visible.length} referencias</span><small>Las aprobadas aparecen primero</small></div>{loading?<Empty loading/>:visible.length?<div className="moodboard-masonry">{visible.map(item=><Card key={item.id} item={item} open={()=>{if(!operationOwners.current.size)setSelected(item)}}/>)}</div>:<Empty/>}
    </section>
    {selected&&<ReferencePanel key={`${boardEpoch}:${selected.id}`} boardId={origin.id} item={selected} tasks={tasks} capture={captureOperation} onBusy={onOperationBusy} close={()=>{if(originCurrent())setSelected(null)}} update={update} remove={remove} reload={reloadOperation}/>} {composer&&board&&<Composer key={`${boardEpoch}:composer`} board={board} categories={categories} initialTask={moodboardTaskIntent(location.selection,board,tasks)} capture={captureOperation} onBusy={onOperationBusy} reload={reloadOperation} close={()=>{if(originCurrent())setComposer(false)}} saved={finishReference}/>} {categoryEditor&&board&&<CategoryEditor key={`${boardEpoch}:categories`} boardId={boardId} categories={categories} close={()=>{if(originCurrent())setCategoryEditor(false)}} saved={()=>{if(!originCurrent())return;setCategoryEditor(false);void load(origin.id,origin)}}/>}
  </main>
}
function Filter({value,current,set,label,count}){return <button className={current===value?"active":""} onClick={()=>set(value)}>{label} <b>{count}</b></button>}
function Empty({loading=false}){return <div className="moodboard-empty"><span className={loading?"moodboard-spinner":""}>{loading?"✦":"⌕"}</span><h2>{loading?"Cargando referencias…":"No encontramos referencias"}</h2>{!loading&&<p>Probá quitando un filtro o cargá una nueva referencia.</p>}</div>}
function Card({item,open}){return <article className={`moodboard-card status-${item.estado}`} tabIndex="0" onClick={open} onKeyDown={e=>e.key==="Enter"&&open()}><div className="moodboard-card-media">{item.tipo_fuente==="pinterest"?<div className="moodboard-link-preview"><span>P</span><strong>{domain(item.enlace_externo)}</strong><small>Abrir referencia</small></div>:<AuthImage item={item}/>}<span className={`moodboard-status-badge ${item.estado}`}>{STATUS[item.estado]?.icon} {STATUS[item.estado]?.label}</span>{item.tipo_fuente==="pinterest"&&<span className="moodboard-source-badge">P</span>}</div><div className="moodboard-card-copy"><span className="moodboard-card-category">{item.categoria||"Sin categoría"}</span><h2>{item.titulo}</h2><p>{item.nota}</p><div className="moodboard-card-tags">{(item.etiquetas||[]).map(t=><span key={t}>#{t}</span>)}</div><footer><span className="moodboard-mini-avatar">{item.autor_nombre.charAt(0)}</span><span>{item.autor_nombre}</span>{item.tareas?.length>0&&<b>⌁ {item.tareas.length}</b>}</footer></div></article>}

function useMoodboardOperation(capture,factory,onBusy){
  const mounted=useRef(false),pending=useRef(false),[,paint]=useState(0),[error,setError]=useState("");
  const owner=useRef(Symbol('moodboard-operation'));
  useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;onBusy?.(owner.current,false)}},[]);
  const captureCurrent=()=>capture(()=>mounted.current);
  const [model]=useState(()=>factory(captureCurrent));
  const run=async(action,done)=>{
    if(pending.current)return;
    const guard=captureCurrent();if(!guard.current())return;
    pending.current=true;onBusy?.(owner.current,true);setError("");paint(n=>n+1);
    try{const result=await action(guard);guard.assertCurrent();done?.(result);}
    catch(reason){if(guard.current())setError(reason.message||"No se pudo confirmar la operación.");}
    finally{pending.current=false;onBusy?.(owner.current,false,mounted.current&&guard.current()&&!['idle','complete'].includes(model.snapshot.phase));if(guard.current())paint(n=>n+1);}
  };
  return{model,run,error,setError,busy:pending.current||model.snapshot.busy,captureCurrent};
}
function ReferencePanel({boardId,item,tasks,capture,close,update,remove,reload,onBusy}){
 const {model,run,error,busy}=useMoodboardOperation(capture,own=>createMoodboardTaskLinkOperation({boardId,reference:item,capture:own,refresh:reload}),onBusy);
 useEffect(()=>{if(!model.snapshot.locked&&!model.snapshot.busy)model.observe(item)},[item,model,busy]);
 const state=model.snapshot,locked=busy||state.locked;
 const isLinked=taskId=>state.locked?model.isLinked(taskId):(item.tareas||[]).some(task=>task.id===taskId);
 const leave=()=>{if(!busy)close()};
 const toggle=task=>void run(()=>model.change(task.id,!isLinked(task.id)));
return <div className="moodboard-panel-layer"><button className="moodboard-panel-backdrop" onClick={leave}/><aside className="moodboard-detail-panel"><header><span>Referencia visual</span><button onClick={leave}>×</button></header>{item.tipo_fuente==="pinterest"?<a className="moodboard-link-preview detail" href={item.enlace_externo} target="_blank" rel="noreferrer"><span>P</span><strong>Abrir en Pinterest</strong></a>:<AuthImage item={item} className="moodboard-detail-image" alt={item.titulo}/>}<div className="moodboard-detail-body"><div className="moodboard-detail-meta"><span>{item.categoria}</span><small>{item.autor_nombre} · {new Date(item.created_at).toLocaleDateString("es-AR")}</small></div><h2>{item.titulo}</h2><p>{item.nota}</p><div className="moodboard-card-tags">{(item.etiquetas||[]).map(t=><span key={t}>#{t}</span>)}</div><section className="moodboard-detail-section"><label>Estado</label><div className="moodboard-state-actions">{Object.entries(STATUS).map(([key,value])=><button key={key} className={item.estado===key?`active ${key}`:""} disabled={locked} onClick={()=>void run(guard=>update(item.id,{status:key},guard))}>{value.icon} {value.label}</button>)}</div></section><section className="moodboard-detail-section"><label>Vinculada a tareas</label><div className="moodboard-task-links">{tasks.map(task=><label key={task.id}><input type="checkbox" disabled={locked} checked={isLinked(task.id)} onChange={()=>toggle(task)}/><span>{task.titulo}</span></label>)}</div></section>{error&&<p className="moodboard-error" role="alert">{error}</p>}{state.locked&&<section className="moodboard-detail-section moodboard-recovery"><p>{state.writeConfirmed?"Vínculo guardado; falta actualizar la vista.":"No se pudo confirmar el vínculo. Actualizá para revisar los vínculos visibles; su ausencia no confirma una eliminación."}</p><button disabled={busy} onClick={()=>void run(()=>model.refresh())}>Actualizar vínculos</button>{state.canRetryWrite&&<button disabled={busy} onClick={()=>void run(()=>model.retryWrite())}>Reintentar el mismo vínculo</button>}</section>}<button className="moodboard-delete" disabled={locked} onClick={()=>void run(guard=>remove(item,guard))}>Eliminar referencia</button></div></aside></div>}

function Composer({board,categories,initialTask,capture,reload,close,saved,onBusy}){
 const[kind,setKind]=useState("image"),[image,setImage]=useState(""),[url,setUrl]=useState(""),[title,setTitle]=useState(""),[category,setCategory]=useState(categories[0]?.id||""),[note,setNote]=useState(""),[tags,setTags]=useState("");
 const {model,run,error,setError,busy,captureCurrent}=useMoodboardOperation(capture,own=>createMoodboardReferenceOperation({boardId:board.id,taskId:initialTask??null,capture:own,refresh:reload}),onBusy);
 const reader=useRef(null);
 useEffect(()=>()=>reader.current?.abort(),[]);
 const state=model.snapshot,locked=busy||state.phase!=="idle";
 const pick=e=>{if(locked)return;const f=e.target.files?.[0];if(!f)return;if(!/^image\/(jpeg|png)$/.test(f.type))return setError("Elegí una imagen JPG o PNG.");if(f.size>10*1024*1024)return setError("La imagen no puede superar 10 MB.");const guard=captureCurrent();if(!guard.current())return;reader.current?.abort();const r=new FileReader();reader.current=r;r.onload=()=>{if(guard.current()&&reader.current===r)setImage(String(r.result||""))};r.onerror=()=>{if(guard.current())setError("No se pudo leer la imagen.")};r.readAsDataURL(f)};
 const completed=result=>{if(model.snapshot.phase==="complete")saved(result.scope)};
 const submit=e=>{e.preventDefault();if(locked)return;void run(()=>model.create({title,note,category_id:Number(category),tags:tags.split(",").map(t=>t.trim()).filter(Boolean),external_url:kind==="link"?url:null,image_data:kind==="image"?image:null}),completed)};
 const finish=()=>void run(()=>model.refresh(),()=>saved(model.finish().scope));
 const leave=()=>{if(busy)return;if(state.phase==="idle")close();else finish()};
 return <div className="moodboard-compose-layer"><button className="moodboard-panel-backdrop" onClick={leave}/><form className="moodboard-composer" onSubmit={submit}><header><div><span>Nueva referencia</span><h2>{board?.nombre}</h2></div><button type="button" onClick={leave}>×</button></header><fieldset disabled={locked} style={{border:0,padding:0,margin:0,minWidth:0}}><div className="moodboard-kind-tabs"><button type="button" className={kind==="image"?"active":""} onClick={()=>setKind("image")}>Subir imagen</button><button type="button" className={kind==="link"?"active":""} onClick={()=>setKind("link")}>Pegar enlace</button></div>{kind==="image"?<label className={`moodboard-dropzone ${image?"has-preview":""}`}>{image?<img src={image} alt="Vista previa"/>:<><span>＋</span><strong>Elegí una imagen</strong><small>JPG o PNG · máximo 10 MB</small></>}<input type="file" accept="image/jpeg,image/png" onChange={pick}/></label>:<label className="moodboard-field"><span>Enlace o Pin de Pinterest</span><input type="url" required value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://pinterest.com/pin/…"/></label>}<div className="moodboard-form-grid"><label className="moodboard-field"><span>Título <small>opcional</small></span><input value={title} onChange={e=>setTitle(e.target.value)}/></label><label className="moodboard-field"><span>Categoría *</span><select required value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label></div><label className="moodboard-field"><span>¿Qué nos interesa de esta referencia? *</span><textarea required rows="4" value={note} onChange={e=>setNote(e.target.value)}/></label><label className="moodboard-field"><span>Etiquetas <small>separadas por coma</small></span><input value={tags} onChange={e=>setTags(e.target.value)}/></label></fieldset>{error&&<div role="alert" className="moodboard-error">{error}</div>}{state.phase!=="idle"&&<section className="moodboard-detail-section moodboard-recovery"><p>{state.createdId?(state.taskId&&state.observedLinked!==true?"Referencia guardada; falta vincularla o confirmar su vínculo visible.":"Referencia guardada; revisá la versión actual."):"No pudimos confirmar la creación. Revisá la lista antes de crear otra referencia."}</p>{state.createdId&&<p>Referencia #{state.createdId}</p>}<button type="button" disabled={busy} onClick={()=>void run(()=>model.refresh())}>Actualizar y revisar</button>{state.canRetryLink&&<button type="button" disabled={busy} onClick={()=>void run(()=>model.retryLink(),completed)}>Reintentar vínculo</button>}<button type="button" disabled={busy} onClick={finish}>{state.createdId?"Finalizar con referencia guardada":"Volver a la lista revisada"}</button></section>}<footer><p>Se guardará como <strong>Libre</strong>.</p><div><button type="button" onClick={leave}>Cancelar</button>{state.phase==="idle"&&<button className="primary" disabled={busy}>{busy?"Guardando…":"Guardar referencia"}</button>}</div></footer></form></div>}

function CategoryEditor({boardId,categories,close,saved}){const[draft,setDraft]=useState(categories.map(c=>({...c}))),[newCategory,setNewCategory]=useState("");const save=async()=>{for(const item of draft.filter(i=>i.changed&&i.nombre.trim()))await api(`/api/moodboards/categories/${item.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:item.nombre})});if(newCategory.trim())await api(`/api/moodboards/boards/${boardId}/categories`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:newCategory})});saved()};return <div className="moodboard-compose-layer"><button className="moodboard-panel-backdrop" onClick={close}/><section className="moodboard-category-modal"><header><div><span>Organización</span><h2>Categorías</h2></div><button onClick={close}>×</button></header><p>Usá pocas categorías claras. Las etiquetas sirven para los detalles.</p><div className="moodboard-category-list">{draft.map((item,index)=><div key={item.id}><span>⠿</span><input value={item.nombre} onChange={e=>setDraft(all=>all.map((value,i)=>i===index?{...value,nombre:e.target.value,changed:true}:value))}/><button onClick={async()=>{if(!confirm(`Eliminar “${item.nombre}”?`))return;await api(`/api/moodboards/categories/${item.id}`,{method:"DELETE"});setDraft(all=>all.filter(v=>v.id!==item.id))}}>Eliminar</button></div>)}</div><div className="moodboard-category-add"><input value={newCategory} onChange={e=>setNewCategory(e.target.value)} placeholder="Nueva categoría"/></div><footer><button onClick={close}>Cancelar</button><button className="primary" onClick={save}>Guardar cambios</button></footer></section></div>}
