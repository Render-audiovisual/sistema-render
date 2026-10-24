import React,{useId,useLayoutEffect,useRef,useSyncExternalStore} from 'react';
import {createNavigationDiscardController} from './navigationDiscardController.js';
import './NavigationDiscardHost.css';

// No root state/subscription: opening the dialog rerenders only the child host,
// not App or editors whose current observations authorize the pending request.
export function useNavigationConfirmation({lifetime}){
  const latestLifetime=useRef(lifetime);latestLifetime.current=lifetime;
  const controllerRef=useRef(null),requestRef=useRef(null);
  if(!controllerRef.current)controllerRef.current=createNavigationDiscardController({readLifetime:()=>latestLifetime.current});
  if(!requestRef.current)requestRef.current=intent=>controllerRef.current.request(intent);
  const controller=controllerRef.current;
  useLayoutEffect(()=>{const lease=controller.activate(lifetime);return()=>controller.deactivate(lease);},[controller,lifetime]);
  return {request:requestRef.current,dialog:<NavigationDiscardHost controller={controller}/>};
}

export function NavigationDiscardHost({controller}){
  const request=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getServerSnapshot);
  useLayoutEffect(()=>{const lease=controller.attachHost();return()=>controller.detachHost(lease);},[controller]);
  return request?<NavigationDiscardModal key={request.id} controller={controller} request={request}/>:null;
}

function NavigationDiscardModal({controller,request}){
  const titleId=useId(),descriptionId=useId(),dialogRef=useRef(null),keepRef=useRef(null),leaveRef=useRef(null),sessionRef=useRef(null),handledRef=useRef(false);
  function finish(discard=false){
    const session=sessionRef.current;
    if(!session?.active||handledRef.current)return;
    handledRef.current=true;
    const current=controller.isCurrent(request);
    try{if(session.dialog.open)session.dialog.close();}
    catch{controller.resolve(request,false);return;}
    // No explicit focus transfer on discard, invalidation, cleanup or unmount.
    if(!discard&&current&&controller.isCurrent(request)){
      const usable=element=>element?.isConnected&&typeof element.focus==='function'&&!element.disabled
        &&!element.matches?.(':disabled')&&!element.closest?.('[inert],[hidden],[aria-hidden="true"]')
        &&typeof element.getClientRects==='function'&&element.getClientRects().length>0;
      const target=usable(request.invoker)?request.invoker:usable(request.fallback)?request.fallback:null;
      try{target?.focus({preventScroll:true});}catch{/* A failed focus transfer is never approval. */}
    }
    controller.resolve(request,discard&&current);
  }
  useLayoutEffect(()=>{
    const dialog=dialogRef.current;
    if(!dialog){controller.resolve(request,false);return undefined;}
    const session={dialog,active:true};sessionRef.current=session;
    const closed=event=>{event.stopPropagation();if(session.active&&!dialog.open)finish(false);};
    dialog.addEventListener('close',closed);
    try{
      if(!controller.isCurrent(request)||!dialog.isConnected)throw new Error('Dialog unavailable');
      if(!dialog.open)dialog.showModal();
      keepRef.current?.focus({preventScroll:true});
    }catch{finish(false);}
    return()=>{
      session.active=false;dialog.removeEventListener('close',closed);
      try{if(dialog.open)dialog.close();}catch{/* Cleanup cannot grant consent or transfer focus. */}
      if(sessionRef.current===session)sessionRef.current=null;
    };
  },[controller,request]);
  return <dialog ref={dialogRef} className="render-navigation-discard" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}
    onClick={event=>event.stopPropagation()}
    onCancel={event=>{event.preventDefault();event.stopPropagation();finish(false);}}
    onKeyDownCapture={event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();finish(false);return;}
      if(event.key!=='Tab'||event.altKey||event.ctrlKey||event.metaKey)return;
      const dialog=dialogRef.current;
      if(!dialog?.open||!sessionRef.current?.active||handledRef.current||!controller.isCurrent(request))return;
      const controls=[keepRef.current,leaveRef.current].filter(element=>element?.isConnected&&!element.disabled
        &&!element.matches?.(':disabled')&&element.getClientRects().length>0);
      if(!controls.length)return;
      const first=controls[0],last=controls.at(-1),active=dialog.ownerDocument.activeElement;
      const target=event.shiftKey?(active===first||!controls.includes(active)?last:null):(active===last||!controls.includes(active)?first:null);
      if(target){event.preventDefault();event.stopPropagation();try{target.focus({preventScroll:true});}catch{/* Never turn a focus failure into navigation. */}}
    }}
    onKeyUpCapture={event=>{if(event.key==='Escape')event.stopPropagation();}}>
    <h2 id={titleId}>¿Descartar los cambios y salir?</h2>
    <p id={descriptionId}>Hay cambios sin guardar. Si salís, perderás lo que editaste sin guardar. Salir no cancela lo que ya se haya guardado.</p>
    <div className="render-navigation-discard-actions">
      <button ref={keepRef} type="button" autoFocus onClick={()=>finish(false)}>Seguir editando</button>
      <button ref={leaveRef} type="button" className="render-navigation-discard-leave" onClick={()=>finish(true)}>Descartar y salir</button>
    </div>
  </dialog>;
}
