// UI lifetime only: never reads/writes drafts, guard registries, routes or history.
export function createNavigationDiscardController({readLifetime,getDocument=()=>globalThis.document}={}){
  let owner=null,host=null,pending=null,snapshot=null,serial=0;
  const listeners=new Set();
  const emit=()=>{for(const listener of [...listeners])listener();};
  const valid=record=>{
    try{return Boolean(record&&owner===record.owner&&owner.active&&host===record.host&&host.active&&readLifetime()===owner.lifetime
      &&!record.intent.signal.aborted&&record.intent.isCurrent()===true);}catch{return false;}
  };
  function settle(record,answer){
    if(!record||pending!==record)return false;
    const accepted=answer===true&&valid(record);
    pending=null;snapshot=null;try{record.intent.signal.removeEventListener('abort',record.abort);}catch{/* Resolution must still deny safely. */}
    record.resolve(accepted);emit();return accepted;
  }
  return Object.freeze({
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    getSnapshot:()=>snapshot,
    getServerSnapshot:()=>null,
    attachHost(){if(host)host.active=false;if(pending)settle(pending,false);const lease={active:true};host=lease;return lease;},
    detachHost(lease){if(host!==lease)return;lease.active=false;if(pending)settle(pending,false);host=null;},
    activate(lifetime){
      if(owner)owner.active=false;
      if(pending)settle(pending,false);
      const lease={lifetime,active:Boolean(lifetime&&typeof lifetime==='object')};owner=lease;return lease;
    },
    deactivate(lease){if(owner!==lease)return;lease.active=false;if(pending)settle(pending,false);owner=null;},
    request(intent){
      if(pending||!owner?.active||!host?.active||!intent||typeof intent.isCurrent!=='function'||typeof intent.signal?.aborted!=='boolean'
        ||typeof intent.signal.addEventListener!=='function'||typeof intent.signal.removeEventListener!=='function')return Promise.resolve(false);
      const record={owner,host,intent,resolve:null,abort:null,view:null};
      if(!valid(record))return Promise.resolve(false);
      let doc,invoker=null,fallback=null;
      try{doc=getDocument?.();invoker=doc?.activeElement??null;
        // The mobile menu may still say Cerrar during the click's batched update.
        fallback=intent.fallbackFocus??doc?.querySelector?.('.sidebar button[aria-label="Abrir menú"], .sidebar button[aria-label="Cerrar menú"]')??null;
      }catch{/* Missing DOM cannot grant approval; the modal will deny if unavailable. */}
      if(pending||!valid(record))return Promise.resolve(false);
      const promise=new Promise(resolve=>{record.resolve=resolve;});
      record.view=Object.freeze({id:++serial,invoker,fallback});record.abort=()=>settle(record,false);
      pending=record;snapshot=record.view;
      try{intent.signal.addEventListener('abort',record.abort,{once:true});}catch{settle(record,false);return promise;}
      if(!valid(record))settle(record,false);else emit();
      return promise;
    },
    isCurrent(view){return pending?.view===view&&valid(pending);},
    resolve(view,answer){return pending?.view===view?settle(pending,answer):false;},
  });
}
