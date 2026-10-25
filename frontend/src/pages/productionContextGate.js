const fields=['dirty','observation','epoch','version','visitObservation','location'];
// Consent owns one destination callback and the exact original form/session
// observation. It never reads/writes business records or performs navigation.
export function createProductionContextGate(){
  let owner=null,pending=null;
  const invalidate=()=>{const held=pending;pending=null;held?.controller.abort();};
  return Object.freeze({
    get pending(){return pending!==null;},
    activate(){invalidate();if(owner)owner.active=false;owner={active:true};return owner;},
    deactivate(lease){if(owner!==lease)return;lease.active=false;invalidate();owner=null;},
    invalidate,
    run(action,{capture,readState,confirm,onDiscard}){
      if(!owner?.active||pending||typeof action!=='function')return false;
      const lease=owner;let scope,state;
      try{scope=capture();state={...readState()};if(scope.current()!==true||state.busy)return false;}catch{return false;}
      const live=()=>{
        try{const next=readState();return owner===lease&&lease.active&&scope.current()===true&&!next.busy
          &&fields.every(field=>Object.is(next[field],state[field]));}catch{return false;}
      };
      const execute=discard=>{if(discard)onDiscard();if(scope.current()!==true||owner!==lease||!lease.active)return false;return action();};
      if(!state.dirty)return live()?execute(false):false;
      const held={controller:new AbortController()};pending=held;
      const current=()=>pending===held&&!held.controller.signal.aborted&&live();
      let answer;
      try{answer=confirm({signal:held.controller.signal,isCurrent:current});}catch{invalidate();return false;}
      return Promise.resolve(answer).then(accepted=>{
        if(!current()){if(pending===held)invalidate();return false;}
        const proceed=accepted===true;invalidate();return proceed?execute(true):false;
      },()=>{if(pending===held)invalidate();return false;});
    },
  });
}
